const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, authorizePermission, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { upload, urlFichier, supprimerFichierLocal, recupererObjetS3, TAILLE_MAX_OCTETS, UPLOAD_DIR, S3_ENABLED } = require('../middleware/upload');
const fs = require('fs');
const path = require('path');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { listeDocumentsQuerySchema, creerDocumentSchema } = require('../validation/documents.schemas');

const router = express.Router();

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ query: listeDocumentsQuerySchema }), asyncHandler(async (req, res) => {
  const { eleve_id } = req.query;
  const { rows } = await query('SELECT * FROM document_eleve WHERE eleve_id = $1 ORDER BY created_at DESC', [eleve_id]);
  const marker = '/uploads/documents/';
  res.json(rows.map((document) => document.fichier_url?.includes(marker)
    ? { ...document, fichier_url: `${req.protocol}://${req.get('host')}/api/documents/${document.id}/fichier` }
    : document));
}));

router.get('/:id/fichier', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT nom_fichier, fichier_url FROM document_eleve WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Document introuvable.');
  const fichierUrl = rows[0].fichier_url || '';
  const filename = path.basename(rows[0].nom_fichier || 'document');
  res.set('Content-Disposition', `inline; filename="${filename}"`);
  if (S3_ENABLED) {
    const base = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
    if (!fichierUrl.startsWith(`${base}/documents/`)) throw new ApiError(404, 'Fichier introuvable.');
    const object = await recupererObjetS3(fichierUrl.slice(base.length + 1));
    return object.Body.pipe(res);
  }
  const marker = '/uploads/documents/';
  if (!fichierUrl.includes(marker)) throw new ApiError(404, 'Fichier introuvable.');
  const localName = path.basename(fichierUrl.split(marker)[1]);
  const filePath = path.join(UPLOAD_DIR, localName);
  if (!fs.existsSync(filePath)) throw new ApiError(404, 'Fichier introuvable.');
  return res.sendFile(filePath);
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
