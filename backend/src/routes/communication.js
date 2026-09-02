const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { upload, urlFichier } = require('../middleware/upload');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const {
  creerActualiteSchema, modifierActualiteSchema, creerNotificationSchema, creerMessageSchema,
} = require('../validation/communication.schemas');

const router = express.Router();

// --- Actualités --- publiques une fois publie=TRUE (visibles élèves/parents)
// Le POST/PUT/DELETE ci-dessous sont déjà ouverts à tout le staff (admin, secrétaire...) —
// le secrétariat gère donc déjà les actualités de bout en bout sans dépendre de l'admin.
router.get('/actualites', asyncHandler(async (req, res) => {
  const where = 'WHERE a.publie = TRUE';
  const { rows } = await query(
    `SELECT a.*,
            COALESCE(u.nom, ag.nom) AS auteur_nom,
            COALESCE(u.prenom, ag.prenom) AS auteur_prenom,
            COALESCE(u.role, ag.role_agent) AS auteur_role
     FROM actualite a
     LEFT JOIN utilisateur u ON u.id = a.auteur_id
     LEFT JOIN agent ag ON ag.id = a.agent_id
     ${where}
     ORDER BY a.created_at DESC`
  );
  res.json(rows);
}));

router.get('/actualites/admin', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT a.*,
            COALESCE(u.nom, ag.nom) AS auteur_nom,
            COALESCE(u.prenom, ag.prenom) AS auteur_prenom,
            COALESCE(u.role, ag.role_agent) AS auteur_role
     FROM actualite a
     LEFT JOIN utilisateur u ON u.id = a.auteur_id
     LEFT JOIN agent ag ON ag.id = a.agent_id
     ORDER BY a.created_at DESC`
  );
  res.json(rows);
}));

router.post('/actualites', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ body: creerActualiteSchema }), asyncHandler(async (req, res) => {
  const { titre, contenu, image_url, publie } = req.body;
  const { rows } = await query(
    `INSERT INTO actualite (titre, contenu, image_url, auteur_id, agent_id, publie, date_publication)
     VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $6 THEN NOW() ELSE NULL END) RETURNING *`,
    [titre, contenu, image_url || null,
      req.user.type === 'utilisateur' ? req.user.id : null,
      req.user.type === 'agent' ? req.user.id : null,
      publie || false]
  );
  res.status(201).json(rows[0]);
}));

router.put('/actualites/:id', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idParamSchema, body: modifierActualiteSchema }), asyncHandler(async (req, res) => {
  const { titre, contenu, image_url, publie } = req.body;
  const { rows } = await query(
    `UPDATE actualite SET titre = COALESCE($1,titre), contenu = COALESCE($2,contenu), image_url = COALESCE($3,image_url),
     publie = COALESCE($4,publie), date_publication = CASE WHEN $4 = TRUE THEN NOW() ELSE date_publication END, updated_at = NOW()
     WHERE id = $5 RETURNING *`,
    [titre, contenu, image_url, publie, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Actualité introuvable.');
  res.json(rows[0]);
}));

router.delete('/actualites/:id', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM actualite WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Actualité introuvable.');
  res.status(204).send();
}));

// Upload de l'image d'illustration d'une actualité (fichier séparé, comme le logo de l'école) :
// retourne l'URL à réutiliser dans le champ image_url du POST/PUT ci-dessus. Ouvert à tout le
// staff pouvant gérer les actualités, pas seulement l'admin.
router.post('/actualites/upload-image', authenticate, authorize(...ROLES_TOUS_STAFF), (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return next(err);
    return next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Aucun fichier reçu.');
  res.json({ image_url: urlFichier(req, req.file.filename) });
}));

// --- Notifications (élève) ---
router.get('/notifications', authenticate, asyncHandler(async (req, res) => {
  const eleveId = req.user.type === 'eleve' ? req.user.id : req.query.eleve_id;
  if (!eleveId) throw new ApiError(400, 'eleve_id requis.');
  const { rows } = await query('SELECT * FROM notification WHERE eleve_id = $1 ORDER BY created_at DESC', [eleveId]);
  res.json(rows);
}));

router.post('/notifications', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ body: creerNotificationSchema }), asyncHandler(async (req, res) => {
  const { eleve_id, titre, message, type_notification } = req.body;
  const { rows } = await query(
    `INSERT INTO notification (eleve_id, auteur_admin_id, agent_id, titre, message, type_notification)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [eleve_id, req.user.type === 'utilisateur' ? req.user.id : null, req.user.type === 'agent' ? req.user.id : null,
      titre || null, message, type_notification || null]
  );
  res.status(201).json(rows[0]);
}));

router.put('/notifications/:id/lu', authenticate, validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE notification SET lu = TRUE, date_lecture = NOW() WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Notification introuvable.');
  res.json(rows[0]);
}));

// --- Messages aux parents ---
router.get('/messages', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { parent_id, eleve_id } = req.query;
  const conditions = []; const params = [];
  if (parent_id) { params.push(parent_id); conditions.push(`parent_id = $${params.length}`); }
  if (eleve_id) { params.push(eleve_id); conditions.push(`eleve_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM message_parent ${where} ORDER BY date_envoi DESC`, params);
  res.json(rows);
}));

router.post('/messages', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ body: creerMessageSchema }), asyncHandler(async (req, res) => {
  const { parent_id, eleve_id, sujet, message, canal } = req.body;
  const { rows } = await query(
    `INSERT INTO message_parent (parent_id, eleve_id, auteur_utilisateur_id, auteur_agent_id, sujet, message, canal)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [parent_id, eleve_id || null, req.user.type === 'utilisateur' ? req.user.id : null,
      req.user.type === 'agent' ? req.user.id : null, sujet || null, message, canal || 'interne']
  );
  res.status(201).json(rows[0]);
}));

// Suppression d'un message : ouvert à tout le staff (admin, enseignant, secrétaire, économe,
// surveillant), comme pour les actualités ci-dessus — le surveillant doit pouvoir corriger/retirer
// un message envoyé par erreur sans dépendre de l'admin.
router.delete('/messages/:id', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM message_parent WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Message introuvable.');
  res.status(204).send();
}));

module.exports = router;
