'use strict';

// Tests unitaires pour services/presenceScan.js (fonctions pures uniquement — trouverCoursPourScan
// est exclue ici car elle interroge la base ; elle relève plutôt d'un test d'intégration avec DB).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  distanceMetres,
  decomposerTimestamp,
  validerGps,
  calculerRetard,
  calculerDepartAnticipe,
  dureePrevueMinutes,
  ecartHorlogeMinutes,
  horlogeSuspecte,
  MARGE_HORLOGE_SUSPECTE_MIN,
} = require('../src/services/presenceScan');

// ---------------------------------------------------------------------------
// distanceMetres — formule de Haversine
// ---------------------------------------------------------------------------
test('distanceMetres : distance nulle entre un point et lui-même', () => {
  assert.equal(distanceMetres(-21.4536, 47.0854, -21.4536, 47.0854), 0);
});

test('distanceMetres : distance connue Antananarivo -> Toamasina (~ 260 km)', () => {
  // Repères géographiques connus, tolérance large (formule à vol d'oiseau).
  const d = distanceMetres(-18.8792, 47.5079, -18.1492, 49.4023);
  assert.ok(d > 200000 && d < 300000, `distance obtenue: ${d}m, attendu ~200-300km`);
});

test('distanceMetres : renvoie null si une coordonnée manque', () => {
  assert.equal(distanceMetres(null, 47.0854, -21.4536, 47.0854), null);
  assert.equal(distanceMetres(-21.4536, 47.0854, -21.4536, null), null);
});

// ---------------------------------------------------------------------------
// decomposerTimestamp
// ---------------------------------------------------------------------------
test('decomposerTimestamp : extrait correctement jour/date/minutes', () => {
  // 2026-08-24 = un lundi
  const r = decomposerTimestamp('2026-08-24T07:45:00.000Z');
  assert.equal(r.dateStr, '2026-08-24');
  assert.equal(r.jour, 'Lundi');
  assert.equal(r.minutesDuJour, 7 * 60 + 45);
});

test('decomposerTimestamp : renvoie null pour un timestamp invalide', () => {
  assert.equal(decomposerTimestamp('pas-une-date'), null);
});

// ---------------------------------------------------------------------------
// validerGps
// ---------------------------------------------------------------------------
test('validerGps : refuse systématiquement une position mock', () => {
  const r = validerGps({
    salle: { latitude: -21.4536, longitude: 47.0854, rayon_metres: 100 },
    latitude: -21.4536,
    longitude: 47.0854,
    isMockLocation: true,
  });
  assert.equal(r.valide, false);
  assert.equal(r.raison, 'gps_suspect');
});

test('validerGps : position manquante -> en attente (ni accepté ni refusé)', () => {
  const r = validerGps({
    salle: { latitude: -21.4536, longitude: 47.0854, rayon_metres: 100 },
    latitude: null,
    longitude: null,
    isMockLocation: false,
  });
  assert.equal(r.valide, null);
  assert.equal(r.raison, 'gps_indisponible');
});

test('validerGps : salle sans géofence configuré -> en attente', () => {
  const r = validerGps({
    salle: { latitude: null, longitude: null, rayon_metres: 100 },
    latitude: -21.4536,
    longitude: 47.0854,
    isMockLocation: false,
  });
  assert.equal(r.valide, null);
  assert.equal(r.raison, 'salle_sans_geofence');
});

test('validerGps : position dans le rayon -> valide', () => {
  const r = validerGps({
    salle: { latitude: -21.4536, longitude: 47.0854, rayon_metres: 100 },
    latitude: -21.4536, // même point -> distance 0
    longitude: 47.0854,
    isMockLocation: false,
  });
  assert.equal(r.valide, true);
});

test('validerGps : position hors rayon -> refusé', () => {
  const r = validerGps({
    salle: { latitude: -21.4536, longitude: 47.0854, rayon_metres: 50 },
    latitude: -21.46, // à plusieurs centaines de mètres
    longitude: 47.0854,
    isMockLocation: false,
  });
  assert.equal(r.valide, false);
  assert.equal(r.raison, 'hors_perimetre');
});

// ---------------------------------------------------------------------------
// calculerRetard / calculerDepartAnticipe
// ---------------------------------------------------------------------------
test('calculerRetard : aucun retard si arrivée avant l\'heure prévue', () => {
  const dateObj = new Date('2026-08-24T07:25:00');
  assert.equal(calculerRetard('07:30:00', dateObj), 0);
});

test('calculerRetard : la tolérance de 5 min absorbe les petits écarts', () => {
  const dateObj = new Date('2026-08-24T07:33:00'); // 3 min après l'heure prévue
  assert.equal(calculerRetard('07:30:00', dateObj), 0);
});

test('calculerRetard : retard réel = écart moins la tolérance', () => {
  const dateObj = new Date('2026-08-24T07:50:00'); // 20 min après
  assert.equal(calculerRetard('07:30:00', dateObj), 15); // 20 - 5
});

test('calculerDepartAnticipe : aucun départ anticipé si sortie après l\'heure prévue', () => {
  const dateObj = new Date('2026-08-24T16:05:00');
  assert.equal(calculerDepartAnticipe('16:00:00', dateObj), 0);
});

test('calculerDepartAnticipe : départ anticipé réel = écart moins la tolérance', () => {
  const dateObj = new Date('2026-08-24T15:40:00'); // 20 min avant
  assert.equal(calculerDepartAnticipe('16:00:00', dateObj), 15); // 20 - 5
});

// ---------------------------------------------------------------------------
// dureePrevueMinutes
// ---------------------------------------------------------------------------
test('dureePrevueMinutes : calcule correctement la durée d\'un cours', () => {
  assert.equal(dureePrevueMinutes('08:00:00', '10:00:00'), 120);
  assert.equal(dureePrevueMinutes('16:00:00', '17:00:00'), 60);
});

// ---------------------------------------------------------------------------
// ecartHorlogeMinutes / horlogeSuspecte (item 8 : fiabilité paie)
// ---------------------------------------------------------------------------
test('ecartHorlogeMinutes : nul si les deux horloges concordent', () => {
  const t = new Date('2026-08-24T07:30:00.000Z');
  assert.equal(ecartHorlogeMinutes(t, new Date(t)), 0);
});

test('ecartHorlogeMinutes : calcule l\'écart en minutes, dans les deux sens', () => {
  const client = new Date('2026-08-24T07:00:00.000Z');
  const serveurApres = new Date('2026-08-24T07:12:00.000Z'); // téléphone 12 min en retard
  const serveurAvant = new Date('2026-08-24T06:48:00.000Z'); // téléphone 12 min en avance
  assert.equal(ecartHorlogeMinutes(client, serveurApres), 12);
  assert.equal(ecartHorlogeMinutes(client, serveurAvant), 12);
});

test('ecartHorlogeMinutes : null si une des deux dates manque', () => {
  assert.equal(ecartHorlogeMinutes(null, new Date()), null);
  assert.equal(ecartHorlogeMinutes(new Date(), null), null);
});

test('horlogeSuspecte : false sous la tolérance par défaut', () => {
  const client = new Date('2026-08-24T07:00:00.000Z');
  const serveur = new Date(client.getTime() + (MARGE_HORLOGE_SUSPECTE_MIN - 1) * 60000);
  assert.equal(horlogeSuspecte(client, serveur), false);
});

test('horlogeSuspecte : true au-dessus de la tolérance par défaut', () => {
  const client = new Date('2026-08-24T07:00:00.000Z');
  const serveur = new Date(client.getTime() + (MARGE_HORLOGE_SUSPECTE_MIN + 1) * 60000);
  assert.equal(horlogeSuspecte(client, serveur), true);
});

test('horlogeSuspecte : respecte une tolérance personnalisée', () => {
  const client = new Date('2026-08-24T07:00:00.000Z');
  const serveur = new Date(client.getTime() + 3 * 60000);
  assert.equal(horlogeSuspecte(client, serveur, 5), false);
  assert.equal(horlogeSuspecte(client, serveur, 2), true);
});
