const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { creerAgentSchema, modifierAgentSchema } = require('../validation/agents.schemas');

const router = express.Router();

const COLONNES_PUBLIQUES = 'id, nom, prenom, email, role_agent, telephone, adresse, photo_url, actif, created_at';

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT ${COLONNES_PUBLIQUES} FROM agent ORDER BY nom, prenom`);
  res.json(rows);
}));

// GET /agents/:id -> fiche d'un agent précis (réservé à l'admin, pour la consultation de
// profil depuis /admin/comptes -> Profil, comme /utilisateurs/:id pour un enseignant).
router.get('/:id', authenticate, authorize('admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT ${COLONNES_PUBLIQUES} FROM agent WHERE id = $1`, [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Agent introuvable.');
  res.json(rows[0]);
}));

router.post('/', authenticate, authorize('admin'), validate({ body: creerAgentSchema }), asyncHandler(async (req, res) => {
  const { nom, prenom, email, mot_de_passe, role_agent, telephone, adresse } = req.body;

  const { rows: existant } = await query('SELECT id FROM agent WHERE email = $1', [email]);
  if (existant[0]) throw new ApiError(409, 'Un agent avec cet email existe déjà.');

  const hash = await bcrypt.hash(mot_de_passe, 10);
  const { rows } = await query(
    `INSERT INTO agent (nom, prenom, email, mot_de_passe, role_agent, telephone, adresse)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, nom, prenom, email, role_agent, telephone, adresse, actif, created_at`,
    [nom, prenom, email, hash, role_agent, telephone, adresse]
  );
  res.status(201).json(rows[0]);
}));

router.put('/:id', authenticate, authorize('admin'), validate({ params: idParamSchema, body: modifierAgentSchema }), asyncHandler(async (req, res) => {
  const { nom, prenom, email, mot_de_passe, role_agent, telephone, adresse, actif } = req.body;

  if (email !== undefined) {
    const { rows: existant } = await query('SELECT id FROM agent WHERE email = $1 AND id <> $2', [email, req.params.id]);
    if (existant[0]) throw new ApiError(409, 'Un autre agent utilise déjà cet email.');
  }

  const fields = [];
  const values = [];
  let i = 1;
  const push = (col, val) => { fields.push(`${col} = $${i++}`); values.push(val); };

  if (nom !== undefined) push('nom', nom);
  if (prenom !== undefined) push('prenom', prenom);
  if (email !== undefined) push('email', email);
  if (role_agent !== undefined) push('role_agent', role_agent);
  if (telephone !== undefined) push('telephone', telephone);
  if (adresse !== undefined) push('adresse', adresse);
  if (actif !== undefined) push('actif', actif);
  if (mot_de_passe) { push('mot_de_passe', await bcrypt.hash(mot_de_passe, 12)); fields.push('security_version = security_version + 1'); }

  if (fields.length === 0) throw new ApiError(400, 'Aucune donnée à modifier.');
  values.push(req.params.id);

  const { rows } = await query(
    `UPDATE agent SET ${fields.join(', ')} WHERE id = $${i}
     RETURNING id, nom, prenom, email, role_agent, telephone, adresse, actif`,
    values
  );
  if (!rows[0]) throw new ApiError(404, 'Agent introuvable.');
  res.json(rows[0]);
}));

router.delete('/:id', authenticate, authorize('admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE agent SET actif = FALSE WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Agent introuvable.');
  res.status(204).send();
}));

module.exports = router;
