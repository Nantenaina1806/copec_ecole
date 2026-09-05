// Tabilao azo jerena/ovaina avy amin'ny appli mobile.
//
// Tsy maintsy voafaritra eto ny tabilao tsirairay alohan'ny hahafahany mandalo
// amin'ny /api/sync/mobile/push sy /pull — mba tsy hisy tabilao tsy nofaritana
// (ohatra: paie, mouvement_caisse...) voasoratra na vakina avy amin'ny téléphone.
//
// readOnly = true  -> azo jerena (pull) fa tsy azo ovaina avy amin'ny mobile (push
//                      hitondra izany dia holaviana).
// readOnly = false -> azo jerena AMAN azo ovaina avy amin'ny mobile.
// writableRoles limite aussi le push generique; les routes metier restent
// l'autorite pour les validations detaillees.

const MOBILE_TABLES = {
  // --- Référence / lecture seule ---
  annee_scolaire: { readOnly: true },
  bimestre: { readOnly: true },
  matiere: { readOnly: true },
  classe: { readOnly: true },
  classe_matiere: { readOnly: true },
  niveau: { readOnly: true },
  enseignant_matiere: { readOnly: true },
  enseignant_matiere_classe: { readOnly: true },
  // Les lignes de scolarite sont aussi modifiables par les roles autorises ci-dessous.
  emploi_du_temps: { readOnly: true },
  salaire_enseignant: { readOnly: true },
  utilisateur: { readOnly: true },

  // --- Écriture depuis le mobile ---
  pointage_enseignant: { readOnly: false, writableRoles: ['admin', 'enseignant'] },
  pointage_eleve: { readOnly: false, writableRoles: ['admin', 'enseignant', 'surveillant'] },
  note: { readOnly: false, writableRoles: ['admin', 'enseignant', 'secretaire'] },
  devoir: { readOnly: false, writableRoles: ['admin', 'enseignant'] },
  absence_enseignant: { readOnly: false, writableRoles: ['admin', 'enseignant', 'secretaire', 'surveillant'] },
  absence_eleve: { readOnly: false, writableRoles: ['admin', 'secretaire', 'surveillant'] },
  inscription: { readOnly: false, writableRoles: ['admin', 'secretaire', 'surveillant'] },
  eleve: { readOnly: false, writableRoles: ['admin', 'secretaire'] },
  parent: { readOnly: false, writableRoles: ['admin', 'secretaire'] },
  eleve_parent: { readOnly: false, writableRoles: ['admin', 'secretaire'] },
  tarif_frais: { readOnly: false, writableRoles: ['admin', 'economie'] },
  frais_scolaire: { readOnly: false, writableRoles: ['admin', 'economie'] },
  paiement: { readOnly: false, writableRoles: ['admin', 'economie'] },
  message_parent: { readOnly: false, writableRoles: ['admin', 'secretaire', 'enseignant', 'surveillant'] },
};

function isMobileTable(tableName) {
  return Object.prototype.hasOwnProperty.call(MOBILE_TABLES, tableName);
}

function isMobileWritable(tableName) {
  return isMobileTable(tableName) && MOBILE_TABLES[tableName].readOnly === false;
}

function canWriteMobileTable(tableName, role) {
  const table = MOBILE_TABLES[tableName];
  return Boolean(table && !table.readOnly && table.writableRoles?.includes(role));
}

module.exports = { MOBILE_TABLES, isMobileTable, isMobileWritable, canWriteMobileTable };
