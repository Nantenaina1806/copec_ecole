const { z, texte } = require('./common');

const creerVisiteurSchema = z.object({
  nom: texte({ max: 100 }),
  prenom: texte({ max: 100, requis: false }),
  telephone: texte({ max: 30, requis: false }),
  motif: texte({ max: 200 }),
  personne_visitee: texte({ max: 200, requis: false }),
  badge: texte({ max: 50, requis: false }),
  observation: texte({ max: 1000, requis: false }),
});

const modifierSortieSchema = z.object({
  heure_sortie: z.string().datetime().optional(),
  observation: texte({ max: 1000, requis: false }),
}).refine((d) => Object.keys(d).length > 0, { message: 'Aucune donnée à modifier.' });

module.exports = { creerVisiteurSchema, modifierSortieSchema };
