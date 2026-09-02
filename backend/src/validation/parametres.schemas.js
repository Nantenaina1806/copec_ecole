const { z, texte } = require('./common');

const COULEUR_HEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const couleurHex = z.string().trim().regex(COULEUR_HEX, 'Couleur invalide (format hexadécimal attendu, ex. #1b3c62).');

const modifierParametresSchema = z.object({
  nom_ecole: texte({ max: 200 }),
  slogan: texte({ max: 300, requis: false }),
  adresse: texte({ max: 255, requis: false }),
  telephone: texte({ max: 30, requis: false }),
  email: texte({ max: 255, requis: false }),
  couleur_principale: couleurHex.optional().nullable(),
  couleur_accent: couleurHex.optional().nullable(),
  devise: texte({ max: 10, requis: false }),
  jour_echeance_defaut: z.coerce.number().int().min(1, "Le jour d'échéance par défaut doit être entre 1 et 28.").max(28, "Le jour d'échéance par défaut doit être entre 1 et 28.").optional().nullable(),
  relance_seuil_jours: z.coerce.number().int().nonnegative('Le seuil de relance (jours) ne peut pas être négatif.').optional().nullable(),
  relance_frequence_jours: z.coerce.number().int().min(1, 'La fréquence de relance (jours) doit être au moins 1.').optional().nullable(),
});

module.exports = { modifierParametresSchema };
