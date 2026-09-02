const { z, entierPositif, booleen } = require('./common');

const enseignantMatiereSchema = z.object({
  enseignant_id: entierPositif(),
  matiere_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
});

const enseignantMatiereClasseSchema = z.object({
  enseignant_id: entierPositif(),
  matiere_id: entierPositif(),
  classe_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
  autorisation_speciale: booleen.optional(),
});

module.exports = { enseignantMatiereSchema, enseignantMatiereClasseSchema };
