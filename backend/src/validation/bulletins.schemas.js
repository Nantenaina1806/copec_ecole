const { z, entierPositif, texte, texteLong } = require('./common');

const genererClasseSchema = z.object({
  classe_id: entierPositif(),
  bimestre_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
});

const modifierBulletinSchema = z
  .object({
    appreciation_generale: texteLong({ max: 1000 }),
    decision: texte({ max: 100, requis: false }),
  })
  .refine((d) => d.appreciation_generale !== undefined || d.decision !== undefined, {
    message: 'Rien à mettre à jour : appreciation_generale et/ou decision requis.',
  });

module.exports = { genererClasseSchema, modifierBulletinSchema };
