const { z, texte, entierPositif, booleen } = require('./common');

const creerMatiereSchema = z.object({
  nom: texte({ max: 100 }),
  code: texte({ max: 20, requis: false }),
  coefficient: entierPositif({ requis: false }),
  actif: booleen.optional(),
  couleur: texte({ max: 30, requis: false }),
});

const modifierMatiereSchema = z
  .object({
    nom: texte({ max: 100, requis: false }),
    code: texte({ max: 20, requis: false }),
    coefficient: entierPositif({ requis: false }),
    actif: booleen.optional(),
    couleur: texte({ max: 30, requis: false }),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Aucune donnée fournie.' });

module.exports = { creerMatiereSchema, modifierMatiereSchema };
