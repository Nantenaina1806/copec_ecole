const { z, entierPositif, texte, enumParmi } = require('./common');

const SCOPES = ['tous', 'classe', 'niveau', 'eleve', 'selection'];
const CANAUX = ['email', 'whatsapp', 'les_deux'];

const envoyerRapportSchema = z.object({
  scope_type: enumParmi(SCOPES, 'scope_type'),
  // scope_valeur change de forme selon scope_type (id de classe/niveau/élève, ou JSON d'ids pour
  // "selection", vide pour "tous") — validé au format générique ici, sa cohérence avec
  // scope_type et son parsing JSON restent vérifiés dans la route (voir routes/rapports.js).
  scope_valeur: z.union([z.string(), z.number()]).optional().nullable(),
  contenu: texte({ max: 5000 }),
  canal: enumParmi(CANAUX, 'canal'),
  bimestre_id: entierPositif({ requis: false }),
});

module.exports = { SCOPES, CANAUX, envoyerRapportSchema };
