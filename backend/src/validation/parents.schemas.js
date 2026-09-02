const { z, entierPositif, texte, booleen } = require('./common');

const creerParentSchema = z.object({
  nom: texte({ max: 100 }),
  prenom: texte({ max: 100, requis: false }),
  telephone: texte({ max: 30 }),
  telephone_2: texte({ max: 30, requis: false }),
  email: texte({ max: 255, requis: false }),
  profession: texte({ max: 150, requis: false }),
  adresse: texte({ max: 255, requis: false }),
});

const modifierParentSchema = z.object({
  nom: texte({ max: 100, requis: false }),
  prenom: texte({ max: 100, requis: false }),
  telephone: texte({ max: 30, requis: false }),
  telephone_2: texte({ max: 30, requis: false }),
  email: texte({ max: 255, requis: false }),
  profession: texte({ max: 150, requis: false }),
  adresse: texte({ max: 255, requis: false }),
});

const lierParentSchema = z.object({
  eleve_id: entierPositif(),
  parent_id: entierPositif(),
  lien_parente: texte({ max: 50 }),
  responsable_principal: booleen.optional(),
  autorise_retrait: booleen.optional(),
  recoit_notifications: booleen.optional(),
});

module.exports = { creerParentSchema, modifierParentSchema, lierParentSchema };
