const { z, entierPositif, texteLong, enumParmi } = require('./common');

const STATUTS_INSCRIPTION = ['inscrit', 'en_cours', 'termine', 'abandonne', 'exclu'];

const creerInscriptionSchema = z.object({
  eleve_id: entierPositif(),
  classe_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
  numero_classe: entierPositif({ requis: false }),
  observation: texteLong(),
});

const modifierInscriptionSchema = z
  .object({
    classe_id: entierPositif({ requis: false }),
    numero_classe: entierPositif({ requis: false }),
    statut: enumParmi(STATUTS_INSCRIPTION, 'statut').optional(),
    observation: texteLong(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Aucune donnée à modifier.' });

module.exports = { STATUTS_INSCRIPTION, creerInscriptionSchema, modifierInscriptionSchema };
