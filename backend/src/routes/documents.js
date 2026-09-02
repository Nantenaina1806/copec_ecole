const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, authorizePermission, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { upload, urlFichier, supprimerFichierLocal, TAILLE_MAX_OCTETS } = require('../middleware/upload');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { listeDocumentsQuerySchema, creerDocumentSchema } = require('../validation/documents.schemas');

const router = express.Router();

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ query: listeDocumentsQuerySchema }), asyncHandler(async (req, res) => {
  const { eleve_id } = req.query;
  const { rows } = await query('SELECT * FROM document_eleve WHERE eleve_id = $1 ORDER BY created_at DESC', [eleve_id]);
  res.json(rows);
}));

// Accepte deux modes d'envoi :
//  - multipart/form-data avec un champ "fichier" -> upload réel, stocké sur le disque du serveur
//  - application/json avec "fichier_url" -> lien/URL externe (comportement historique, conservé)
// multer ignore silencieusement les requêtes JSON (content-type non multipart), donc une seule
// route gère les deux cas sans dupliquer la logique.
router.post('/', authenticate, authorize(...ROLES_TOUS_STAFF), authorizePermission('documents.write'), (req, res, next) => {
  upload.single('fichier')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(400, `Fichier trop volumineux (max ${TAILLE_MAX_OCTETS / (1024 * 1024)} Mo).`));
      }
      return next(err);
    }
    return next();
  });
}, validate({ body: creerDocumentSchema }), asyncHandler(async (req, res) => {
  const { eleve_id, type_document, description, date_document } = req.body;
  let { nom_fichier, fichier_url } = req.body;

  if (req.file) {
    fichier_url = urlFichier(req, req.file.filename);
    nom_fichier = nom_fichier || req.file.originalname;
  }

  if (!eleve_id || !type_document || !nom_fichier || !fichier_url) {
    if (req.file) supprimerFichierLocal(urlFichier(req, req.file.filename));
    throw new ApiError(400, "eleve_id, type_document et nom_fichier sont requis, avec soit un fichier joint, soit une URL.");
  }

  const { rows } = await query(
    `INSERT INTO document_eleve (eleve_id, type_document, nom_fichier, fichier_url, description, date_document)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [eleve_id, type_document, nom_fichier, fichier_url, description || null, date_document || null]
  );
  res.status(201).json(rows[0]);
}));

router.delete('/:id', authenticate, authorize(...ROLES_TOUS_STAFF), authorizePermission('documents.write'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT fichier_url FROM document_eleve WHERE id = $1', [req.params.id]);
  const { rowCount } = await query('DELETE FROM document_eleve WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Document introuvable.');
  if (rows[0]) supprimerFichierLocal(rows[0].fichier_url); // best-effort, laisse intacts les liens externes
  res.status(204).send();
}));

module.exports = router;
