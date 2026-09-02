const { query } = require('../config/db');

const { localDateString, localMinutes, localDayName, localTimeString } = require('./timeService');

const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// Marges métier (en minutes) — cf. règles validées avec l'utilisateur.
const MARGE_OUVERTURE_AVANT_MIN = 15; // le scan s'ouvre 15 min avant heure_debut
const MARGE_FERMETURE_APRES_MIN = 15; // le scan se ferme 15 min après heure_fin
const MARGE_GPS_MOCK_REFUS = true; // un GPS "mock" détecté => refus systématique

// Écart maximum toléré (minutes) entre l'horloge du téléphone (timestamp_local, utilisée pour
// calculer retard/départ anticipé/durée payée) et l'horloge du serveur à la réception du scan.
// Au-delà, l'horloge du téléphone n'est plus fiable pour un calcul qui impacte la paie (RG paie) :
// on ne rejette pas le scan (l'enseignant était bien sur place, le GPS le confirme), mais on le
// bascule en attente de validation admin plutôt que de faire confiance aveuglément au calcul auto.
const MARGE_HORLOGE_SUSPECTE_MIN = 10;

/**
 * Distance en mètres entre deux points GPS (formule de Haversine).
 */
function distanceMetres(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Découpe un timestamp local (ISO string envoyé par le téléphone) en { dateStr, jour, minutesDuJour, dateObj }.
 * Le timestamp est celui du téléphone au moment du scan (fiable pour "quand", pas pour "si validé").
 */
function decomposerTimestamp(timestampLocal) {
  const dateObj = new Date(timestampLocal);
  if (Number.isNaN(dateObj.getTime())) return null;
  const jour = localDayName(dateObj);
  const dateStr = localDateString(dateObj);
  const minutesDuJour = localMinutes(dateObj);
  return { dateObj, jour, dateStr, minutesDuJour };
}

function heureToMinutes(heureStr) {
  // heureStr type 'HH:MM:SS' (colonne TIME de Postgres)
  const [h, m] = heureStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Cherche le cours de l'emploi du temps correspondant à un scan :
 * même enseignant, même salle, bon jour de semaine, heure dans la fenêtre [debut-15min, fin+15min].
 * Retourne le cours le plus proche en heure si plusieurs (ne devrait pas arriver, EDT sans chevauchement).
 */
async function trouverCoursPourScan({ enseignantId, salleId, timestampLocal }) {
  const t = decomposerTimestamp(timestampLocal);
  if (!t) return { erreur: 'timestamp_invalide' };

  const { rows } = await query(
    `SELECT edt.*, c.nom AS classe_nom, m.nom AS matiere_nom
     FROM emploi_du_temps edt
     JOIN classe c ON c.id = edt.classe_id
     JOIN matiere m ON m.id = edt.matiere_id
     WHERE edt.enseignant_id = $1 AND edt.salle_id = $2 AND edt.jour = $3 AND edt.actif = TRUE`,
    [enseignantId, salleId, t.jour]
  );

  for (const cours of rows) {
    const debutFenetre = heureToMinutes(cours.heure_debut) - MARGE_OUVERTURE_AVANT_MIN;
    const finFenetre = heureToMinutes(cours.heure_fin) + MARGE_FERMETURE_APRES_MIN;
    if (t.minutesDuJour >= debutFenetre && t.minutesDuJour <= finFenetre) {
      return { cours, dateStr: t.dateStr, dateObj: t.dateObj };
    }
  }

  return { erreur: rows.length ? 'hors_horaire' : 'salle_incorrecte', dateStr: t.dateStr, dateObj: t.dateObj };
}

/**
 * Valide la position GPS d'un scan par rapport au géofence de la salle.
 */
function validerGps({ salle, latitude, longitude, isMockLocation }) {
  if (isMockLocation && MARGE_GPS_MOCK_REFUS) {
    return { valide: false, raison: 'gps_suspect' };
  }
  if (latitude == null || longitude == null) {
    return { valide: null, raison: 'gps_indisponible' }; // ni accepté ni refusé -> à vérifier par un admin
  }
  if (salle.latitude == null || salle.longitude == null) {
    return { valide: null, raison: 'salle_sans_geofence' }; // salle pas encore configurée -> à vérifier
  }
  const distance = distanceMetres(Number(salle.latitude), Number(salle.longitude), latitude, longitude);
  if (distance <= salle.rayon_metres) {
    return { valide: true, distance };
  }
  return { valide: false, raison: 'hors_perimetre', distance };
}

/**
 * Calcule le retard (minutes) d'une entrée par rapport à heure_debut prévue.
 * Une marge de tolérance de 5 min est appliquée avant de compter du retard (évite de sanctionner les secondes).
 */
function calculerRetard(heureDebutPrevue, dateObj, toleranceMin = 5) {
  const diffMin = localMinutes(dateObj) - heureToMinutes(heureDebutPrevue);
  return Math.max(0, diffMin - toleranceMin);
}

function calculerDepartAnticipe(heureFinPrevue, dateObj, toleranceMin = 5) {
  const diffMin = heureToMinutes(heureFinPrevue) - localMinutes(dateObj);
  return Math.max(0, diffMin - toleranceMin);
}

function dureePrevueMinutes(heureDebut, heureFin) {
  return heureToMinutes(heureFin) - heureToMinutes(heureDebut);
}

/**
 * Écart (en minutes, toujours positif) entre l'horloge déclarée par le téléphone (dateObjClient,
 * dérivée de timestamp_local) et l'horloge du serveur au moment de la réception (dateObjServeur).
 * Un écart important signale une horloge de téléphone mal réglée (volontairement ou non) : les
 * champs retard_minutes/depart_anticipe_minutes/duree_payee_minutes calculés à partir de
 * timestamp_local deviennent alors peu fiables pour la paie.
 */
function ecartHorlogeMinutes(dateObjClient, dateObjServeur) {
  if (!dateObjClient || !dateObjServeur) return null;
  return Math.abs(dateObjServeur.getTime() - dateObjClient.getTime()) / 60000;
}

/**
 * true si l'écart d'horloge dépasse la tolérance -> le scan doit être mis en attente de
 * validation admin (statut_validation = 'en_attente_validation', raison 'horloge_suspecte')
 * même si le GPS est par ailleurs valide.
 */
function horlogeSuspecte(dateObjClient, dateObjServeur, toleranceMin = MARGE_HORLOGE_SUSPECTE_MIN) {
  const ecart = ecartHorlogeMinutes(dateObjClient, dateObjServeur);
  return ecart !== null && ecart > toleranceMin;
}

module.exports = {
  JOURS,
  MARGE_OUVERTURE_AVANT_MIN,
  MARGE_FERMETURE_APRES_MIN,
  MARGE_HORLOGE_SUSPECTE_MIN,
  distanceMetres,
  decomposerTimestamp,
  heureToMinutes,
  trouverCoursPourScan,
  validerGps,
  calculerRetard,
  calculerDepartAnticipe,
  dureePrevueMinutes,
  ecartHorlogeMinutes,
  horlogeSuspecte,
};
