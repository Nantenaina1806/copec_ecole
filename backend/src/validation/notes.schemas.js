const { z, entierPositif, texteLong, texte } = require('./common');

// note_valeur : borne large ici (Zod), la borne métier précise (0-20, cf. RG) reste
// vérifiée par noteValeurValide() dans la route pour garder son message dédié.
const noteValeur = z.coerce.number({ invalid_type_error: 'note_valeur doit être un nombre.' });

const creerNoteSchema = z.object({
  eleve_id: entierPositif(),
  matiere_id: entierPositif(),
  bimestre_id: entierPositif(),
  note_valeur: noteValeur,
  enseignant_id: entierPositif({ requis: false }),
  type_evaluation: texte({ max: 50, requis: false }),
  coefficient_evaluation: entierPositif({ requis: false }),
  commentaire: texteLong(),
});

const modifierNoteSchema = z
  .object({
    note_valeur: noteValeur.optional(),
    commentaire: texteLong(),
    type_evaluation: texte({ max: 50, requis: false }),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Aucune donnée à modifier.' });

const notesEnMasseSchema = z.object({
  matiere_id: entierPositif(),
  bimestre_id: entierPositif(),
  enseignant_id: entierPositif({ requis: false }),
  type_evaluation: texte({ max: 50, requis: false }),
  coefficient_evaluation: entierPositif({ requis: false }),
  notes: z.array(z.object({
    eleve_id: entierPositif(),
    note_valeur: noteValeur,
    commentaire: texteLong(),
  })).min(1).max(200),
});

module.exports = { creerNoteSchema, modifierNoteSchema, notesEnMasseSchema };
