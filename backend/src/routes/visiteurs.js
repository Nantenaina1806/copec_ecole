const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { creerVisiteurSchema, modifierSortieSchema } = require('../validation/visiteurs.schemas');

const router = express.Router();
const ROLES = ['admin', 'accueil', 'secretaire'];

router.get('/', authenticate, authorize(...ROLES), asyncHandler(async (req, res) => {
  const { statut, date } = req.query;
  const params = [];
  const conditions = [];
  if (statut) { params.push(statut); conditions.push(`v.statut = $${params.length}`); }
  if (date) { params.push(date); conditions.push(`DATE(v.heure_entree) = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(`SELECT v.*, COALESCE(u.prenom || ' ' || u.nom, a.prenom || ' ' || a.nom) AS enregistre_par
    FROM visiteur v LEFT JOIN utilisateur u ON u.id=v.utilisateur_id LEFT JOIN agent a ON a.id=v.agent_id
    ${where} ORDER BY v.heure_entree DESC LIMIT 500`, params);
  res.json(rows);
}));

router.post('/', authenticate, authorize(...ROLES), validate({ body: creerVisiteurSchema }), asyncHandler(async (req, res) => {
  const { nom, prenom, telephone, motif, personne_visitee, badge, observation } = req.body;
  const utilisateurId = req.user.type === 'utilisateur' ? req.user.id : null;
  const agentId = req.user.type === 'agent' ? req.user.id : null;
  const { rows } = await query(`INSERT INTO visiteur (nom, prenom, telephone, motif, personne_visitee, badge, observation, utilisateur_id, agent_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [nom, prenom || null, telephone || null, motif, personne_visitee || null, badge || null, observation || null, utilisateurId, agentId]);
  res.status(201).json(rows[0]);
}));

router.put('/:id/sortie', authenticate, authorize(...ROLES), validate({ params: idParamSchema, body: modifierSortieSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE visiteur SET heure_sortie = COALESCE($1::timestamptz, CURRENT_TIMESTAMP), statut='sorti', observation=COALESCE($2, observation)
    WHERE id=$3 AND statut='present' RETURNING *`, [req.body.heure_sortie || null, req.body.observation || null, req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Visiteur introuvable ou déjà sorti.');
  res.json(rows[0]);
}));

module.exports = router;
