const { z, texte, booleen } = require('./common');

const latitude = z.coerce.number().min(-90).max(90);
const longitude = z.coerce.number().min(-180).max(180);
const rayonMetres = z.coerce.number().int().positive().max(5000);

const creerSalleSchema = z.object({
  nom: texte({ max: 100 }),
  latitude: latitude.optional().nullable(),
  longitude: longitude.optional().nullable(),
  rayon_metres: rayonMetres.optional(),
});

const modifierSalleSchema = z.object({
  nom: texte({ max: 100, requis: false }),
  latitude: latitude.optional().nullable(),
  longitude: longitude.optional().nullable(),
  rayon_metres: rayonMetres.optional(),
  actif: booleen.optional(),
});

module.exports = { creerSalleSchema, modifierSalleSchema };
