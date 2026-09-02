const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { creerSalleSchema, modifierSalleSchema } = require('../validation/salles.schemas');

const router = express.Router();

// GET /salles -> liste (tout le staff peut consulter, utile pour l'app enseignant)
router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM salle ORDER BY nom');
  res.json(rows);
}));

router.get('/:id', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM salle WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Salle introuvable.');
  res.json(rows[0]);
}));

// GET /salles/:id/qr -> renvoie uniquement la donnée à encoder en QR (affichage/impression côté frontend)
router.get('/:id/qr', authenticate, authorize('admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, nom, qr_code_data FROM salle WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Salle introuvable.');
  res.json(rows[0]);
}));

// POST /salles -> créer une salle (QR généré automatiquement, non modifiable ensuite sauf régénération explicite)
router.post('/', authenticate, authorize('admin'), validate({ body: creerSalleSchema }), asyncHandler(async (req, res) => {
  const { nom, latitude, longitude, rayon_metres } = req.body;
  const qr_code_data = 'QR-SALLE-' + crypto.randomBytes(16).toString('hex');
  const { rows } = await query(
    `INSERT INTO salle (nom, qr_code_data, latitude, longitude, rayon_metres)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [nom, qr_code_data, latitude ?? null, longitude ?? null, rayon_metres || 100]
  );
  res.status(201).json(rows[0]);
}));

// PUT /salles/:id -> ajuster nom / géofence (jamais le qr_code_data ici, cf. endpoint dédié)
router.put('/:id', authenticate, authorize('admin'), validate({ params: idParamSchema, body: modifierSalleSchema }), asyncHandler(async (req, res) => {
  const { nom, latitude, longitude, rayon_metres, actif } = req.body;
  const { rows } = await query(
    `UPDATE salle SET
       nom = COALESCE($1, nom),
       latitude = $2,
       longitude = $3,
       rayon_metres = COALESCE($4, rayon_metres),
       actif = COALESCE($5, actif)
     WHERE id = $6 RETURNING *`,
    [nom || null, latitude ?? null, longitude ?? null, rayon_metres || null, actif ?? null, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Salle introuvable.');
  res.json(rows[0]);
}));

// POST /salles/:id/regenerer-qr -> invalide l'ancien QR (ex. si suspecté volé/photographié et diffusé)
router.post('/:id/regenerer-qr', authenticate, authorize('admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const qr_code_data = 'QR-SALLE-' + crypto.randomBytes(16).toString('hex');
  const { rows } = await query(
    'UPDATE salle SET qr_code_data = $1 WHERE id = $2 RETURNING *',
    [qr_code_data, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Salle introuvable.');
  res.json(rows[0]);
}));

router.delete('/:id', authenticate, authorize('admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM salle WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Salle introuvable.');
  res.status(204).send();
}));

module.exports = router;
