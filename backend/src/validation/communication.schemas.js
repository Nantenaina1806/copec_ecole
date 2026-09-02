const { z, entierPositif, texte, texteLong, booleen, enumParmi } = require('./common');

const CANAUX_MESSAGE = ['interne', 'sms', 'email'];

const creerActualiteSchema = z.object({
  titre: texte({ max: 200 }),
  contenu: texteLong({ max: 20000, requis: true }),
  image_url: texte({ max: 1000, requis: false }),
  publie: booleen.optional(),
});

const modifierActualiteSchema = z.object({
  titre: texte({ max: 200, requis: false }),
  contenu: texteLong({ max: 20000 }),
  image_url: texte({ max: 1000, requis: false }),
  publie: booleen.optional(),
});

const creerNotificationSchema = z.object({
  eleve_id: entierPositif(),
  titre: texte({ max: 200, requis: false }),
  message: texteLong({ max: 5000, requis: true }),
  type_notification: texte({ max: 50, requis: false }),
});

const creerMessageSchema = z.object({
  parent_id: entierPositif(),
  eleve_id: entierPositif({ requis: false }),
  sujet: texte({ max: 200, requis: false }),
  message: texteLong({ max: 5000, requis: true }),
  canal: enumParmi(CANAUX_MESSAGE, 'canal').optional(),
});

module.exports = { creerActualiteSchema, modifierActualiteSchema, creerNotificationSchema, creerMessageSchema };
