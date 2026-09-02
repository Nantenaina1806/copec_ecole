const { z, entierPositif, texte } = require('./common');

const listeDocumentsQuerySchema = z.object({
  eleve_id: entierPositif(),
});

// Après multer, tous les champs texte arrivent en chaîne — fichier_url/nom_fichier peuvent
// dépendre d'un fichier joint (voir routes/documents.js), donc restent optionnels ici ; le
// contrôle "au moins fichier OU URL" reste fait dans la route (dépend de req.file).
const creerDocumentSchema = z.object({
  eleve_id: entierPositif(),
  type_document: texte({ max: 100 }),
  description: texte({ max: 500, requis: false }),
  date_document: texte({ max: 20, requis: false }),
  nom_fichier: texte({ max: 255, requis: false }),
  fichier_url: texte({ max: 1000, requis: false }),
});

module.exports = { listeDocumentsQuerySchema, creerDocumentSchema };
