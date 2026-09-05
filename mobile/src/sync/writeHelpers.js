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

export async function saisirDevoir(db, {
  classe_id, matiere_id, enseignant_id, annee_scolaire_id,
  titre, consignes = null, date_assignation, date_limite = null,
}) {
  const id = generateLocalId();
  const row = { id, classe_id, matiere_id, enseignant_id, annee_scolaire_id, titre, consignes, date_assignation, date_limite };
  await db.run('BEGIN TRANSACTION', []);
  try {
    await db.run(
      `INSERT INTO devoir
        (id, classe_id, matiere_id, enseignant_id, annee_scolaire_id, titre, consignes, date_assignation, date_limite, _pending_sync)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, classe_id, matiere_id, enseignant_id, annee_scolaire_id, titre, consignes, date_assignation, date_limite],
    );
    await queueLocalChange(db, { table_name: 'devoir', operation: 'INSERT', row_key: { id }, new_row: row });
    await db.run('COMMIT', []);
  } catch (err) {
    await db.run('ROLLBACK', []);
    throw err;
  }
}

export async function enregistrerAbsenceEleve(db, {
  eleve_id, emploi_du_temps_id = null, date_absence, motif = null, justifiee = false,
}) {
  const id = generateLocalId();
  const row = { id, eleve_id, emploi_du_temps_id, date_absence, motif, justifiee: justifiee ? 1 : 0 };
  await db.run('BEGIN TRANSACTION', []);
  try {
    await db.run(
      `INSERT INTO absence_eleve (id, eleve_id, emploi_du_temps_id, date_absence, motif, justifiee, _pending_sync)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, eleve_id, emploi_du_temps_id, date_absence, motif, justifiee ? 1 : 0],
    );
    await queueLocalChange(db, { table_name: 'absence_eleve', operation: 'INSERT', row_key: { id }, new_row: row });
    await db.run('COMMIT', []);
  } catch (err) {
    await db.run('ROLLBACK', []);
    throw err;
  }
}
