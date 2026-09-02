const { z, texte, dateISO, enumParmi, booleen } = require('./common');

const sexe = enumParmi(['M', 'F'], 'sexe');

const creerEleveSchema = z.object({
  matricule: texte({ max: 50 }),
  nom: texte({ max: 100 }),
  prenom: texte({ max: 100, requis: false }),
  date_naissance: dateISO.optional().or(z.literal('')),
  lieu_naissance: texte({ max: 150, requis: false }),
  sexe: sexe.optional(),
  adresse: texte({ max: 255, requis: false }),
  telephone: texte({ max: 30, requis: false }),
  email: texte({ max: 255, requis: false }),
});

const modifierEleveSchema = z
  .object({
    nom: texte({ max: 100, requis: false }),
    prenom: texte({ max: 100, requis: false }),
    date_naissance: dateISO.optional().or(z.literal('')),
    lieu_naissance: texte({ max: 150, requis: false }),
    sexe: sexe.optional(),
    adresse: texte({ max: 255, requis: false }),
    telephone: texte({ max: 30, requis: false }),
    email: texte({ max: 255, requis: false }),
    actif: booleen.optional(),
    photo_url: texte({ max: 1000, requis: false }),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Aucune donnée à modifier.' });

module.exports = { creerEleveSchema, modifierEleveSchema };
