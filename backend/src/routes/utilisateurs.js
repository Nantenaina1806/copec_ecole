const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { supprimerSelfieLocal } = require('../middleware/upload');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { creerUtilisateurSchema, modifierUtilisateurSchema } = require('../validation/utilisateurs.schemas');

const router = express.Router();

const COLONNES_PUBLIQUES = `id, nom, prenom, email, role, telephone, adresse, photo_url, actif, created_at,
            compte_confirme, selfie_confirmee_le`;

// GET /utilisateurs -> liste des comptes admin/enseignant (visible par staff)
router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT ${COLONNES_PUBLIQUES} FROM utilisateur ORDER BY nom, prenom`);
  res.json(rows);
}));

router.get('/:id', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, nom, prenom, email, role, telephone, adresse, photo_url, actif, created_at
     FROM utilisateur WHERE id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Compte introuvable.');
  res.json(rows[0]);
}));

// POST /utilisateurs -> créer un compte (admin uniquement)
router.post('/', authenticate, authorize('admin'), validate({ body: creerUtilisateurSchema }), asyncHandler(async (req, res) => {
  const { nom, prenom, email, mot_de_passe, role, telephone, adresse } = req.body;

  const { rows: existant } = await query('SELECT id FROM utilisateur WHERE email = $1', [email]);
  if (existant[0]) throw new ApiError(409, 'Un compte avec cet email existe déjà.');

  const hash = await bcrypt.hash(mot_de_passe, 10);
  const { rows } = await query(
    `INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, role, telephone, adresse)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, nom, prenom, email, role, telephone, adresse, actif, created_at`,
    [nom, prenom, email, hash, role, telephone, adresse]
  );

  await query(
    `INSERT INTO audit_log (utilisateur_id, action, table_nom, record_id, nouvelle_valeur) VALUES ($1,'creation','utilisateur',$2,$3)`,
    [req.user.id, rows[0].id, JSON.stringify({ email, role })]
  );

  res.status(201).json(rows[0]);
}));

// PUT /utilisateurs/:id -> modifier (admin uniquement). Le mot de passe est optionnel.
router.put('/:id', authenticate, authorize('admin'), validate({ params: idParamSchema, body: modifierUtilisateurSchema }), asyncHandler(async (req, res) => {
  const { nom, prenom, email, mot_de_passe, role, telephone, adresse, actif } = req.body;

  if (email !== undefined) {
    const { rows: existant } = await query('SELECT id FROM utilisateur WHERE email = $1 AND id <> $2', [email, req.params.id]);
    if (existant[0]) throw new ApiError(409, 'Un autre compte utilise déjà cet email.');
  }

  const fields = [];
  const values = [];
  let i = 1;
  const push = (col, val) => { fields.push(`${col} = $${i++}`); values.push(val); };

  if (nom !== undefined) push('nom', nom);
  if (prenom !== undefined) push('prenom', prenom);
  if (email !== undefined) push('email', email);
  if (role !== undefined) push('role', role);
  if (telephone !== undefined) push('telephone', telephone);
  if (adresse !== undefined) push('adresse', adresse);
  if (actif !== undefined) push('actif', actif);
  if (mot_de_passe) { push('mot_de_passe', await bcrypt.hash(mot_de_passe, 12)); fields.push('security_version = security_version + 1'); }

  if (fields.length === 0) throw new ApiError(400, 'Aucune donnée à modifier.');
  values.push(req.params.id);

  const { rows } = await query(
    `UPDATE utilisateur SET ${fields.join(', ')} WHERE id = $${i}
     RETURNING id, nom, prenom, email, role, telephone, adresse, actif, photo_url`,
    values
  );
  if (!rows[0]) throw new ApiError(404, 'Compte introuvable.');
  res.json(rows[0]);
}));

// DELETE /utilisateurs/:id -> désactiver un compte plutôt que le supprimer physiquement
router.delete('/:id', authenticate, authorize('admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE utilisateur SET actif = FALSE WHERE id = $1 RETURNING id`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Compte introuvable.');
  res.status(204).send();
}));

// PUT /utilisateurs/:id/reset-selfie -> admin uniquement. Efface la photo de
// référence + le descripteur facial : l'enseignant devra refaire la confirmation
// (selfie) à sa prochaine connexion. Utile en cas de photo floue/mauvaise lumière,
// changement notable d'apparence, ou compte partagé par erreur au départ.
router.put('/:id/reset-selfie', authenticate, authorize('admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows: [cible] } = await query('SELECT id, selfie_reference_url FROM utilisateur WHERE id = $1', [req.params.id]);
  if (!cible) throw new ApiError(404, 'Compte introuvable.');

  const { rows } = await query(
    `UPDATE utilisateur
     SET selfie_reference_url = NULL, selfie_descriptor = NULL, compte_confirme = FALSE,
         selfie_confirmee_le = NULL, selfie_reset_par_id = $1, selfie_reset_le = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id, nom, prenom, email, compte_confirme`,
    [req.user.id, req.params.id]
  );

  supprimerSelfieLocal(cible.selfie_reference_url);

  await query(
    `INSERT INTO audit_log (utilisateur_id, action, table_nom, record_id, nouvelle_valeur)
     VALUES ($1, 'modification', 'utilisateur', $2, $3)`,
    [req.user.id, req.params.id, JSON.stringify({ evenement: 'reset_selfie_reference' })]
  );

  res.json(rows[0]);
}));

module.exports = router;
