const { z, entierPositif, texte, dateISO, booleen } = require('./common');

const creerAbsenceEleveSchema = z.object({
  eleve_id: entierPositif(),
  emploi_du_temps_id: entierPositif({ requis: false }),
  date_absence: dateISO,
  motif: texte({ max: 500, requis: false }),
  justifiee: booleen.optional(),
});

const justifierAbsenceSchema = z.object({
  document_justificatif: texte({ max: 1000, requis: false }),
});

const modifierAbsenceSchema = z.object({
  date_absence: dateISO,
  motif: texte({ max: 500, requis: false }),
});

const creerAbsenceEnseignantSchema = z.object({
  enseignant_id: entierPositif(),
  emploi_du_temps_id: entierPositif({ requis: false }),
  date_absence: dateISO,
  motif: texte({ max: 500, requis: false }),
  justifiee: booleen.optional(),
});

module.exports = {
  creerAbsenceEleveSchema,
  justifierAbsenceSchema,
  modifierAbsenceSchema,
  creerAbsenceEnseignantSchema,
};
