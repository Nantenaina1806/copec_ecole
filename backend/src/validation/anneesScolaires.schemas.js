const { z, entierPositif, texte } = require('./common');

const dateChaine = z.string().trim().min(8, 'date invalide.');

const creerAnneeSchema = z
  .object({
    libelle: texte({ max: 50 }),
    date_debut: dateChaine,
    date_fin: dateChaine,
  })
  .refine((d) => new Date(d.date_fin) > new Date(d.date_debut), {
    message: 'La date de fin doit être postérieure à la date de début.',
    path: ['date_fin'],
  });

const modifierAnneeSchema = z
  .object({
    date_debut: dateChaine,
    date_fin: dateChaine,
  })
  .refine((d) => new Date(d.date_fin) > new Date(d.date_debut), {
    message: 'La date de fin doit être postérieure à la date de début.',
    path: ['date_fin'],
  });

const mappingPromotionSchema = z.object({
  classe_source_id: entierPositif(),
  classe_cible_id: entierPositif(),
  // Élèves à NE PAS promouvoir depuis cette classe (redoublants, dossiers en attente, etc.).
  // Optionnel : par défaut, tous les élèves "inscrit" de la classe source sont promus.
  eleve_ids_exclus: z.array(entierPositif()).optional().default([]),
});

const promotionSchema = z.object({
  mappings: z.array(mappingPromotionSchema).min(1, 'mappings (tableau non vide) est requis.'),
  annee_cible_id: entierPositif(),
});

const dupliquerStructureSchema = z.object({
  annee_source_id: entierPositif(),
});

module.exports = { creerAnneeSchema, modifierAnneeSchema, promotionSchema, dupliquerStructureSchema };
