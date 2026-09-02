// Tabilao azo jerena/ovaina avy amin'ny appli mobile (mpampianatra).
//
// Tsy maintsy voafaritra eto ny tabilao tsirairay alohan'ny hahafahany mandalo
// amin'ny /api/sync/mobile/push sy /pull — mba tsy hisy tabilao tsy nofaritana
// (ohatra: paie, mouvement_caisse...) voasoratra na vakina avy amin'ny téléphone.
//
// readOnly = true  -> azo jerena (pull) fa tsy azo ovaina avy amin'ny mobile (push
//                      hitondra izany dia holaviana).
// readOnly = false -> azo jerena AMAN azo ovaina avy amin'ny mobile.

const MOBILE_TABLES = {
  // --- Référence / lecture seule ---
  annee_scolaire: { readOnly: true },
  bimestre: { readOnly: true },
  matiere: { readOnly: true },
  classe: { readOnly: true },
  classe_matiere: { readOnly: true },
  enseignant_matiere: { readOnly: true },
  enseignant_matiere_classe: { readOnly: true },
  eleve: { readOnly: true },
  inscription: { readOnly: true },
  emploi_du_temps: { readOnly: true },
  salaire_enseignant: { readOnly: true },
  salle: { readOnly: true },
  utilisateur: { readOnly: true }, // le mobile ne modifie jamais son propre compte via sync

  // --- Écriture par le mpampianatra ---
  pointage_enseignant: { readOnly: false },
  pointage_eleve: { readOnly: false },
  note: { readOnly: false },
  devoir: { readOnly: false },
  absence_enseignant: { readOnly: false },
};

function isMobileTable(tableName) {
  return Object.prototype.hasOwnProperty.call(MOBILE_TABLES, tableName);
}

function isMobileWritable(tableName) {
  return isMobileTable(tableName) && MOBILE_TABLES[tableName].readOnly === false;
}

module.exports = { MOBILE_TABLES, isMobileTable, isMobileWritable };
