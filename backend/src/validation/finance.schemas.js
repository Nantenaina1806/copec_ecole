const { z, entierPositif, nombrePositif, texte, texteLong, dateISO } = require('./common');

const MODES_PAIEMENT = ['especes', 'virement', 'cheque', 'mobile_money', 'carte', 'autre'];
const modePaiement = z.enum(MODES_PAIEMENT, {
  errorMap: () => ({ message: `mode_paiement doit être l'un de : ${MODES_PAIEMENT.join(', ')}` }),
});

// Montant monétaire : positif, borné à 2 décimales (DECIMAL(12,2) côté DB) pour éviter
// qu'un flottant JS mal arrondi (0.1 + 0.2 ...) ne s'insère silencieusement en base.
const montant = z.coerce.number({ invalid_type_error: 'montant doit être un nombre.' }).positive('Le montant doit être positif.')
  .refine((v) => Number.isInteger(Math.round(v * 100)), { message: 'montant ne peut avoir plus de 2 décimales.' });
const montantNonNegatif = z.coerce.number({ invalid_type_error: 'doit être un nombre.' }).nonnegative('Le montant ne peut pas être négatif.');

const upsertTarifSchema = z.object({
  niveau_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
  type_frais: texte({ max: 50 }),
  libelle: texte({ max: 200, requis: false }),
  montant: montantNonNegatif,
  recurrent_mensuel: z.coerce.boolean().optional(),
  jour_echeance: z.coerce.number().int().min(1).max(28).optional().nullable(),
});

const genererFraisSchema = z.object({
  annee_scolaire_id: entierPositif(),
  mois: z.coerce.number().int().min(1, 'mois doit être entre 1 et 12.').max(12, 'mois doit être entre 1 et 12.'),
  date_echeance: dateISO.optional().or(z.literal('')),
});

const creerFraisSchema = z.object({
  eleve_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
  type_frais: texte({ max: 50 }),
  libelle: texte({ max: 200, requis: false }),
  montant_total: montant,
  mois: z.coerce.number().int().min(1).max(12).optional(),
  date_echeance: dateISO.optional().or(z.literal('')),
});

const creerPaiementSchema = z.object({
  frais_id: entierPositif(),
  montant,
  mode_paiement: modePaiement,
  reference_paiement: texte({ max: 100, requis: false }),
  caisse_id: entierPositif({ requis: false }),
});

const paiementLotSchema = z.object({
  frais_ids: z.array(entierPositif()).min(1, 'frais_ids (tableau non vide) est requis.'),
  montant,
  mode_paiement: modePaiement,
  reference_paiement: texte({ max: 100, requis: false }),
  caisse_id: entierPositif({ requis: false }),
});

const creerDepenseSchema = z.object({
  categorie_id: entierPositif(),
  libelle: texte({ max: 200 }),
  montant,
  date_depense: dateISO.optional().or(z.literal('')),
  mode_paiement: modePaiement,
  reference: texte({ max: 100, requis: false }),
  observation: texteLong(),
  caisse_id: entierPositif({ requis: false }),
});

const clotureCaisseSchema = z.object({
  solde_reel: z.coerce.number({ invalid_type_error: 'solde_reel doit être un nombre.' }),
  commentaire: texteLong(),
  date_cloture: dateISO.optional().or(z.literal('')),
});

const relancesGenererSchema = z.object({
  frais_id: entierPositif({ requis: false }),
});

module.exports = {
  MODES_PAIEMENT,
  upsertTarifSchema,
  genererFraisSchema,
  creerFraisSchema,
  creerPaiementSchema,
  paiementLotSchema,
  creerDepenseSchema,
  clotureCaisseSchema,
  relancesGenererSchema,
};
