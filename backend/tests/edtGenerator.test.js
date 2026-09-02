'use strict';

// Tests unitaires pour services/edtGenerator.js.
// Exécution : npm test (utilise le test runner intégré à Node, aucune dépendance à installer).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  genererEmploiDuTemps,
  decomposerHeures,
  overlap,
  JOURS,
} = require('../src/services/edtGenerator');

// ---------------------------------------------------------------------------
// decomposerHeures — règle "sacrée" X. de décomposition des heures/semaine
// ---------------------------------------------------------------------------
test('decomposerHeures : décompose chaque volume 2..8h selon la règle officielle', () => {
  assert.deepEqual(decomposerHeures(2), [2]);
  assert.deepEqual(decomposerHeures(3), [2, 1]);
  assert.deepEqual(decomposerHeures(4), [2, 2]);
  assert.deepEqual(decomposerHeures(5), [2, 2, 1]);
  assert.deepEqual(decomposerHeures(6), [2, 2, 2]);
  assert.deepEqual(decomposerHeures(7), [2, 2, 2, 1]);
  assert.deepEqual(decomposerHeures(8), [2, 2, 2, 2]);
});

test('decomposerHeures : chaque décomposition totalise bien le volume demandé', () => {
  for (let h = 2; h <= 8; h += 1) {
    const total = decomposerHeures(h).reduce((a, b) => a + b, 0);
    assert.equal(total, h, `la décomposition de ${h}h ne totalise pas ${h}h`);
  }
});

test('decomposerHeures : rejette un volume hors [2,8]', () => {
  assert.throws(() => decomposerHeures(1), /non supporté/);
  assert.throws(() => decomposerHeures(9), /non supporté/);
  assert.throws(() => decomposerHeures(0), /non supporté/);
});

// ---------------------------------------------------------------------------
// overlap — formule de chevauchement horaire (règle XXI.)
// ---------------------------------------------------------------------------
test('overlap : détecte un chevauchement partiel', () => {
  assert.equal(overlap('08:00', '10:00', '09:00', '11:00'), true);
});

test('overlap : deux créneaux contigus (fin == début) ne se chevauchent pas', () => {
  assert.equal(overlap('08:00', '10:00', '10:00', '12:00'), false);
});

test('overlap : créneaux disjoints', () => {
  assert.equal(overlap('08:00', '09:00', '10:00', '11:00'), false);
});

test('overlap : un créneau inclus dans un autre est bien détecté', () => {
  assert.equal(overlap('08:00', '12:00', '09:00', '10:00'), true);
});

// ---------------------------------------------------------------------------
// genererEmploiDuTemps — cas simple qui doit réussir
// ---------------------------------------------------------------------------
test('genererEmploiDuTemps : place correctement une classe simple sans conflit', () => {
  const matieres = [
    { matiere_id: 1, nom: 'Mathématiques', heures_semaine: 4, enseignants: [{ enseignant_id: 10, nom: 'Rakoto' }] },
    { matiere_id: 2, nom: 'Malagasy', heures_semaine: 3, enseignants: [{ enseignant_id: 11, nom: 'Rabe' }] },
  ];

  const resultat = genererEmploiDuTemps({ matieres, classeId: 1, salle: 'Salle A' });

  assert.equal(resultat.success, true);
  assert.equal(resultat.limiteAtteinte, false);
  assert.equal(resultat.incomplet.length, 0);

  // Le volume total placé doit correspondre à la somme des heures_semaine demandées.
  const totalMinutes = resultat.placements.reduce((acc, p) => {
    const [h1, m1] = p.heure_debut.split(':').map(Number);
    const [h2, m2] = p.heure_fin.split(':').map(Number);
    return acc + ((h2 * 60 + m2) - (h1 * 60 + m1));
  }, 0);
  assert.equal(totalMinutes, (4 + 3) * 60);
});

test('genererEmploiDuTemps : aucun chevauchement enseignant/classe dans le résultat', () => {
  const matieres = [
    { matiere_id: 1, nom: 'Mathématiques', heures_semaine: 6, enseignants: [{ enseignant_id: 10, nom: 'Rakoto' }] },
    { matiere_id: 2, nom: 'Physique', heures_semaine: 4, enseignants: [{ enseignant_id: 10, nom: 'Rakoto' }] }, // même enseignant
    { matiere_id: 3, nom: 'Malagasy', heures_semaine: 4, enseignants: [{ enseignant_id: 11, nom: 'Rabe' }] },
  ];

  const resultat = genererEmploiDuTemps({ matieres, classeId: 1, salle: 'Salle A' });
  assert.equal(resultat.success, true);

  // Vérifie qu'aucun couple de placements du même enseignant ne se chevauche le même jour.
  const parEnseignantJour = new Map();
  for (const p of resultat.placements) {
    const cle = `${p.enseignant_id}-${p.jour}`;
    const existants = parEnseignantJour.get(cle) || [];
    for (const autre of existants) {
      assert.equal(
        overlap(p.heure_debut, p.heure_fin, autre.heure_debut, autre.heure_fin),
        false,
        `conflit enseignant détecté : ${cle} ${p.heure_debut}-${p.heure_fin} vs ${autre.heure_debut}-${autre.heure_fin}`
      );
    }
    existants.push(p);
    parEnseignantJour.set(cle, existants);
  }
});

test('genererEmploiDuTemps : une matière n\'est jamais programmée deux fois le même jour (règle XI)', () => {
  const matieres = [
    { matiere_id: 1, nom: 'Mathématiques', heures_semaine: 8, enseignants: [{ enseignant_id: 10, nom: 'Rakoto' }] },
  ];
  const resultat = genererEmploiDuTemps({ matieres, classeId: 1, salle: 'Salle A' });
  assert.equal(resultat.success, true);

  const joursUtilises = resultat.placements.filter((p) => p.matiere_id === 1).map((p) => p.jour);
  const joursUniques = new Set(joursUtilises);
  assert.equal(joursUniques.size, joursUtilises.length, 'la même matière apparaît deux fois le même jour');
});

// ---------------------------------------------------------------------------
// genererEmploiDuTemps — garde-fou anti-explosion combinatoire (item 7)
// ---------------------------------------------------------------------------
test('genererEmploiDuTemps : s\'arrête proprement (limiteAtteinte=true) quand maxTentatives est dépassé', () => {
  // Grille volontairement impossible à satisfaire entièrement (trop de matières/enseignants
  // pour le nombre de créneaux disponibles) + maxTentatives très bas pour un test déterministe
  // et rapide : on vérifie seulement que le garde-fou coupe la recherche, pas qu'il en existe
  // une combinaison particulière.
  const matieres = Array.from({ length: 6 }, (_, i) => ({
    matiere_id: i + 1,
    nom: `Matière ${i + 1}`,
    heures_semaine: 8,
    enseignants: [
      { enseignant_id: 100, nom: 'Prof unique A' },
      { enseignant_id: 101, nom: 'Prof unique B' },
    ],
  }));

  const resultat = genererEmploiDuTemps({ matieres, classeId: 1, salle: 'Salle A', maxTentatives: 50 });

  assert.equal(resultat.limiteAtteinte, true);
  assert.equal(resultat.success, false);
  assert.ok(resultat.tentatives > 50, 'le compteur de tentatives devrait dépasser la limite fixée');
});

test('genererEmploiDuTemps : termine rapidement même sur un cas très contraint (pas de blocage du process)', () => {
  const matieres = Array.from({ length: 8 }, (_, i) => ({
    matiere_id: i + 1,
    nom: `Matière ${i + 1}`,
    heures_semaine: 8,
    enseignants: [{ enseignant_id: 100 + (i % 2), nom: `Prof ${i % 2}` }],
  }));

  const debut = Date.now();
  const resultat = genererEmploiDuTemps({ matieres, classeId: 1, salle: 'Salle A' }); // maxTentatives par défaut (20000)
  const dureeMs = Date.now() - debut;

  assert.ok(dureeMs < 3000, `la génération a pris ${dureeMs}ms, le garde-fou ne semble pas efficace`);
  assert.equal(typeof resultat.success, 'boolean');
});

test('genererEmploiDuTemps : aucun enseignant candidat -> échec propre (pas d\'exception, pas d\'exploration inutile)', () => {
  const matieres = [
    { matiere_id: 1, nom: 'Mathématiques', heures_semaine: 4, enseignants: [] }, // pas d'enseignant assigné
  ];
  const resultat = genererEmploiDuTemps({ matieres, classeId: 1, salle: 'Salle A' });
  assert.equal(resultat.success, false);
  assert.equal(resultat.limiteAtteinte, false);
  assert.equal(resultat.incomplet.length > 0, true);
});


test('genererEmploiDuTemps : respecte les occupations publiées des autres classes', () => {
  const matieres = [
    { matiere_id: 1, nom: 'Mathématiques', heures_semaine: 2, enseignants: [{ enseignant_id: 10, nom: 'Rakoto' }] },
  ];
  const resultat = genererEmploiDuTemps({
    matieres,
    classeId: 2,
    salle: 'Salle A',
    salleId: 5,
    existingPlacements: [
      { classe_id: 1, matiere_id: 9, enseignant_id: 10, salle_id: 5, salle: 'Salle A', jour: 'Lundi', heure_debut: '07:30', heure_fin: '09:30' },
    ],
  });
  assert.equal(resultat.success, true);
  assert.ok(resultat.placements.every((p) => !(p.jour === 'Lundi' && p.heure_debut < '09:30' && p.heure_fin > '07:30')));
});

test('genererEmploiDuTemps : une salle occupée ailleurs bloque le même créneau', () => {
  const matieres = [
    { matiere_id: 1, nom: 'Français', heures_semaine: 2, enseignants: [{ enseignant_id: 11, nom: 'Rabe' }] },
  ];
  const resultat = genererEmploiDuTemps({
    matieres,
    classeId: 2,
    salle: 'Salle A',
    salleId: 5,
    existingPlacements: [
      { classe_id: 1, matiere_id: 9, enseignant_id: 99, salle_id: 5, salle: 'Salle A', jour: 'Lundi', heure_debut: '07:30', heure_fin: '09:30' },
    ],
  });
  assert.equal(resultat.success, true);
  assert.ok(resultat.placements.every((p) => !(p.jour === 'Lundi' && p.heure_debut < '09:30' && p.heure_fin > '07:30')));
});
