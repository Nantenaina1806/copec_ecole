// Ohatra concret: ny endriny tokony hanorenana ny UI screens (EspaceEnseignant
// mobile) rehefa manoratra zavatra. Ny fitsipika: NY IREZY IHANY no manoratra
// mivantana ao amin'ny SQLite lokaly + queueLocalChange — tsy misy screen manao
// db.run() mivantana, mba hitovy fomba foana ny fanoratana sy hisian'ny sync.

import { queueLocalChange } from './syncClient';
import { generateLocalId } from './idGenerator';

/**
 * Fanaovana ny "appel" ho an'ny classe iray manontolo, indray mandeha (mitovy
 * amin'ny POST /pointage/appel efa ampiasain'ny PC — jereo frontend/src/pages/
 * EspaceEnseignant.jsx, fonction submit() ao amin'ny FaireAppel). `presences` dia
 * lisitry { eleve_id, statut }.
 */
export async function enregistrerAppelClasse(db, {
  emploi_du_temps_id, classe_id, annee_scolaire_id, enseignant_id, date_pointage, presences,
}) {
  await db.run('BEGIN TRANSACTION', []);
  try {
    for (const { eleve_id, statut } of presences) {
      const id = generateLocalId();
      await db.run(
        `INSERT INTO pointage_eleve
           (id, eleve_id, classe_id, annee_scolaire_id, enseignant_id, emploi_du_temps_id, date_pointage, statut, commentaire, _pending_sync)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
        [id, eleve_id, classe_id, annee_scolaire_id, enseignant_id, emploi_du_temps_id, date_pointage, statut],
      );
      await queueLocalChange(db, {
        table_name: 'pointage_eleve',
        operation: 'INSERT',
        row_key: { id },
        new_row: { id, eleve_id, classe_id, annee_scolaire_id, enseignant_id, emploi_du_temps_id, date_pointage, statut, commentaire: null },
      });
    }
    await db.run('COMMIT', []);
  } catch (err) {
    await db.run('ROLLBACK', []);
    throw err;
  }
}

/** Fampidirana naoty ho an'ny mpianatra iray. */
export async function saisirNote(db, {
  eleve_id, classe_id, matiere_id, enseignant_id, annee_scolaire_id, bimestre_id,
  note_valeur, type_evaluation = null, coefficient_evaluation = 1, commentaire = null,
}) {
  const id = generateLocalId();
  await db.run('BEGIN TRANSACTION', []);
  try {
    await db.run(
      `INSERT INTO note
         (id, eleve_id, classe_id, matiere_id, enseignant_id, annee_scolaire_id, bimestre_id, note_valeur, type_evaluation, coefficient_evaluation, commentaire, _pending_sync)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, eleve_id, classe_id, matiere_id, enseignant_id, annee_scolaire_id, bimestre_id, note_valeur, type_evaluation, coefficient_evaluation, commentaire],
    );
    await queueLocalChange(db, {
      table_name: 'note',
      operation: 'INSERT',
      row_key: { id },
      new_row: { id, eleve_id, classe_id, matiere_id, enseignant_id, annee_scolaire_id, bimestre_id, note_valeur, type_evaluation, coefficient_evaluation, commentaire },
    });
    await db.run('COMMIT', []);
  } catch (err) {
    await db.run('ROLLBACK', []);
    throw err;
  }
}
