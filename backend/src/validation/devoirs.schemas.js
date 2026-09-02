const { z, entierPositif, texte, texteLong, dateISO } = require('./common');

const devoirSchema = z.object({
  classe_id: entierPositif(),
  matiere_id: entierPositif(),
  titre: texte({ max: 200 }),
  consignes: texteLong(),
  date_assignation: dateISO,
  date_limite: dateISO.optional().or(z.literal('')),
  fichier_url: texte({ max: 1000, requis: false }),
  enseignant_id: entierPositif({ requis: false }),
});

module.exports = { devoirSchema };
