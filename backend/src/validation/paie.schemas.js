const { z, entierPositif, enumParmi } = require('./common');

const TYPES_SALAIRE = ['horaire', 'mensuel'];
const STATUTS_PAIE = ['prepare', 'valide', 'paye', 'annule'];

const nombreOptionnel = z.coerce.number().optional();
const mois = z.coerce.number().int().min(1, 'mois doit être entre 1 et 12.').max(12, 'mois doit être entre 1 et 12.');
const annee = z.coerce.number().int().min(2000).max(2100);

const creerSalaireSchema = z.object({
  enseignant_id: entierPositif(),
  type_salaire: enumParmi(TYPES_SALAIRE, 'type_salaire'),
  montant: z.coerce.number().positive('montant doit être positif.'),
  date_debut: z.string().trim().min(8, 'date_debut invalide.'),
});

const creerPaieSchema = z.object({
  enseignant_id: entierPositif(),
  salaire_id: entierPositif({ requis: false }),
  mois,
  annee,
  heures_normales: nombreOptionnel,
  heures_supplementaires: nombreOptionnel,
  prime: nombreOptionnel,
  retenue: nombreOptionnel,
});

const modifierPaieSchema = z.object({
  salaire_id: entierPositif({ requis: false }),
  heures_normales: nombreOptionnel,
  heures_supplementaires: nombreOptionnel,
  prime: nombreOptionnel,
  retenue: nombreOptionnel,
});

const genererPaieSchema = z.object({ mois, annee });

const calculHeuresQuerySchema = z.object({
  enseignant_id: entierPositif({ requis: false }),
  mois,
  annee,
});

const statutPaieSchema = z.object({
  statut: enumParmi(STATUTS_PAIE, 'statut'),
  date_paiement: z.string().trim().min(8).optional().or(z.literal('')),
  mode_paiement: enumParmi(['especes','virement','cheque','mobile_money','carte','autre'], 'mode_paiement').optional().nullable(),
  reference_paiement: z.string().trim().max(100).optional().nullable(),
});

module.exports = {
  TYPES_SALAIRE,
  STATUTS_PAIE,
  creerSalaireSchema,
  creerPaieSchema,
  modifierPaieSchema,
  genererPaieSchema,
  calculHeuresQuerySchema,
  statutPaieSchema,
};
