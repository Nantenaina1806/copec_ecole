const { query } = require('../config/db');
const { localDateString, localDayName, localMinutes } = require('./timeService');
const { JOURS, heureToMinutes, calculerRetard, dureePrevueMinutes } = require('./presenceScan');

/**
 * À exécuter périodiquement (ex. toutes les 15 min, cf. jobs/cron.js).
 * Pour chaque cours du jour dont la fenêtre de scan est fermée (heure_fin + 15min dépassée) :
 *   - s'il n'y a AUCUN scan d'entrée -> absence automatique (statut='absent', pas d'arbitrage nécessaire)
 *   - s'il y a une entrée mais pas de sortie -> "en_attente_validation" avec une proposition de durée
 *     (heure_fin_prevue - heure_scan_entree, plafonnée à la durée du cours), à confirmer par un admin
 * Idempotent : peut être relancé sans dupliquer ni écraser des décisions déjà prises par un admin.
 */
async function cloturerScansExpires() {
  const now = new Date();
  const jour = localDayName(now);
  const todayStr = localDateString(now);
  const nowMinutes = localMinutes(now);

  const { rows: coursExpiresBruts } = await query(
    `SELECT edt.*, c.nom AS classe_nom
     FROM emploi_du_temps edt
     JOIN classe c ON c.id = edt.classe_id
     WHERE edt.jour = $1 AND edt.actif = TRUE`,
    [jour]
  );

  // Filtre "fenêtre déjà fermée" en mémoire d'abord (aucun accès DB) : réduit d'autant le lot
  // à traiter par les requêtes groupées ci-dessous.
  const coursExpires = coursExpiresBruts.filter((cours) => heureToMinutes(cours.heure_fin) + 15 < nowMinutes);

  let absencesCreees = 0;
  let sortiesManquantesFlaggees = 0;

  if (coursExpires.length > 0) {
    const edtIds = coursExpires.map((c) => c.id);

    // Deux requêtes groupées (au lieu de 2 requêtes PAR cours) : un seul aller-retour DB pour
    // récupérer tous les pointages déjà existants aujourd'hui, et un seul pour les absences
    // justifiées déjà saisies manuellement, sur l'ensemble des cours expirés du jour. Clé
    // composite (emploi_du_temps_id + enseignant_id) dans les deux Map/Set ci-dessous, comme le
    // WHERE à deux colonnes des requêtes d'origine : rien n'empêche en base deux lignes pour le
    // même créneau avec un enseignant_id différent (uk_pointage_ens / uk_abs_ens l'autorisent),
    // même si en pratique cela n'arrive pas hors anomalie de saisie — on garde donc exactement
    // la même sélectivité qu'avant.
    const [{ rows: pointagesExistants }, { rows: absencesJustifiees }] = await Promise.all([
      query(
        `SELECT * FROM pointage_enseignant WHERE date_pointage = $1 AND emploi_du_temps_id = ANY($2::int[])`,
        [todayStr, edtIds]
      ),
      query(
        `SELECT emploi_du_temps_id, enseignant_id FROM absence_enseignant WHERE date_absence = $1 AND emploi_du_temps_id = ANY($2::int[])`,
        [todayStr, edtIds]
      ),
    ]);
    const pointageParEdt = new Map(pointagesExistants.map((p) => [`${p.emploi_du_temps_id}:${p.enseignant_id}`, p]));
    const edtAvecAbsenceJustifiee = new Set(absencesJustifiees.map((a) => `${a.emploi_du_temps_id}:${a.enseignant_id}`));

    // Absences automatiques à créer : construites en mémoire, puis insérées en une seule requête
    // multi-lignes (au lieu d'un INSERT par cours sans scan).
    const aInsererEnseignantId = []; const aInsererEdtId = [];
    // Sorties manquantes à flagger : chaque ligne a une durée proposée différente (dépend de
    // l'heure de scan d'entrée), donc mise à jour ligne à ligne — mais seulement pour ce sous-lot
    // précis (déjà réduit par les filtres en mémoire ci-dessus), pas un aller-retour "lecture" par
    // cours comme avant.
    const misesAJourSortie = []; // {id, dureeProposee}

    for (const cours of coursExpires) {
      const existant = pointageParEdt.get(`${cours.id}:${cours.enseignant_id}`);

      if (!existant) {
        // Aucun scan du tout -> vérifier qu'il n'y a pas déjà une absence justifiée saisie manuellement
        if (edtAvecAbsenceJustifiee.has(`${cours.id}:${cours.enseignant_id}`)) continue;
        aInsererEnseignantId.push(cours.enseignant_id);
        aInsererEdtId.push(cours.id);
        continue;
      }

      if (existant.heure_scan_entree && !existant.heure_scan_sortie && existant.statut_validation === 'auto') {
        const entree = new Date(existant.heure_scan_entree);
        const dureeProposee = Math.max(0, Math.min(
          heureToMinutes(cours.heure_fin) - localMinutes(entree),
          dureePrevueMinutes(cours.heure_debut, cours.heure_fin)
        ));
        misesAJourSortie.push({ id: existant.id, dureeProposee });
      }
    }

    if (aInsererEnseignantId.length > 0) {
      const { rowCount } = await query(
        `INSERT INTO pointage_enseignant (enseignant_id, emploi_du_temps_id, date_pointage, statut, source, statut_validation, duree_payee_minutes)
         SELECT t.enseignant_id, t.emploi_du_temps_id, $3, 'absent', 'scan_qr', 'auto', 0
         FROM UNNEST($1::int[], $2::int[]) AS t(enseignant_id, emploi_du_temps_id)
         ON CONFLICT (enseignant_id, emploi_du_temps_id, date_pointage) DO NOTHING`,
        [aInsererEnseignantId, aInsererEdtId, todayStr]
      );
      absencesCreees = rowCount;
    }

    if (misesAJourSortie.length > 0) {
      const ids = misesAJourSortie.map((m) => m.id);
      const durees = misesAJourSortie.map((m) => m.dureeProposee);
      const { rowCount } = await query(
        `UPDATE pointage_enseignant SET
           statut_validation = 'en_attente_validation', raison_refus = 'sortie_manquante',
           duree_payee_minutes = t.duree_proposee
         FROM UNNEST($1::int[], $2::int[]) AS t(id, duree_proposee)
         WHERE pointage_enseignant.id = t.id
           AND pointage_enseignant.heure_scan_sortie IS NULL AND pointage_enseignant.statut_validation = 'auto'`,
        [ids, durees]
      );
      sortiesManquantesFlaggees = rowCount;
    }
  }

  return { absencesCreees, sortiesManquantesFlaggees, executeA: now.toISOString() };
}

module.exports = { cloturerScansExpires };
