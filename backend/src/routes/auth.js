const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
const { enregistrerSelfieBase64, urlSelfie, supprimerSelfieLocal } = require('../middleware/upload');
const { descripteurValide } = require('../services/selfieVerification');
const { validate } = require('../middleware/validate');
const { loginSchema, loginEleveSchema, majProfilSchema, confirmerCompteSchema } = require('../validation/auth.schemas');

const router = express.Router();


function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

// Réponse volontairement identique (message + code 401) que l'email existe ou
// non / que ce soit le mot de passe qui soit faux, pour ne pas laisser un
// attaquant énumérer les comptes existants via les messages d'erreur.
const IDENTIFIANTS_INVALIDES = 'Mot de passe ou email incorrect.';

// POST /auth/login  -> admin / enseignant (table utilisateur)
router.post('/login', validate({ body: loginSchema }), asyncHandler(async (req, res) => {
  const { email, mot_de_passe } = req.body;

  const { rows } = await query('SELECT * FROM utilisateur WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !user.actif) throw new ApiError(401, IDENTIFIANTS_INVALIDES);

  const valid = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
  if (!valid) throw new ApiError(401, IDENTIFIANTS_INVALIDES);

  const token = signToken({
    id: user.id,
    type: 'utilisateur',
    role: user.role, // 'admin' | 'enseignant'
    security_version: user.security_version || 0,
    email: user.email,
    nom: user.nom,
    prenom: user.prenom,
  });

  res.setHeader('Set-Cookie', `copec_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);

  await query(
    `INSERT INTO audit_log (utilisateur_id, action, table_nom, record_id) VALUES ($1, 'connexion', 'utilisateur', $1)`,
    [user.id]
  );

  res.json({
    token,
    user: {
      id: user.id, nom: user.nom, prenom: user.prenom, email: user.email, role: user.role,
      photo_url: user.photo_url, compte_confirme: user.compte_confirme,
    },
  });
}));

// POST /auth/login-agent -> agents (secrétaire, économe, surveillant)
router.post('/login-agent', validate({ body: loginSchema }), asyncHandler(async (req, res) => {
  const { email, mot_de_passe } = req.body;

  const { rows } = await query('SELECT * FROM agent WHERE email = $1', [email]);
  const agent = rows[0];
  if (!agent || !agent.actif) throw new ApiError(401, IDENTIFIANTS_INVALIDES);

  const valid = await bcrypt.compare(mot_de_passe, agent.mot_de_passe);
  if (!valid) throw new ApiError(401, IDENTIFIANTS_INVALIDES);

  const token = signToken({
    id: agent.id,
    type: 'agent',
    role: agent.role_agent,
    security_version: agent.security_version || 0,
    email: agent.email,
    nom: agent.nom,
    prenom: agent.prenom,
  });

  res.setHeader('Set-Cookie', `copec_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);

  await query(
    `INSERT INTO audit_log (agent_id, action, table_nom, record_id) VALUES ($1, 'connexion', 'agent', $1)`,
    [agent.id]
  );

  res.json({
    token,
    user: { id: agent.id, nom: agent.nom, prenom: agent.prenom, email: agent.email, role: agent.role_agent, photo_url: agent.photo_url },
  });
}));

// POST /auth/login-eleve -> élève : matricule + email
router.post('/login-eleve', validate({ body: loginEleveSchema }), asyncHandler(async (req, res) => {
  const { matricule, email } = req.body;

  const { rows } = await query('SELECT * FROM eleve WHERE matricule = $1 AND email = $2', [matricule, email]);
  const eleve = rows[0];
  if (!eleve || !eleve.actif) throw new ApiError(401, IDENTIFIANTS_INVALIDES);

  const token = signToken({
    id: eleve.id,
    type: 'eleve',
    role: 'eleve',
    matricule: eleve.matricule,
    nom: eleve.nom,
    prenom: eleve.prenom,
  });

  res.json({
    token,
    user: { id: eleve.id, nom: eleve.nom, prenom: eleve.prenom, matricule: eleve.matricule, photo_url: eleve.photo_url },
  });
}));

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `copec_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.status(204).send();
});

// GET /auth/me -> profil de l'utilisateur connecté (quel que soit son type)
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const { id, type } = req.user;
  let row;
  if (type === 'utilisateur') {
    ({ rows: [row] } = await query(
      'SELECT id, nom, prenom, email, role, telephone, photo_url, actif, compte_confirme, selfie_confirmee_le FROM utilisateur WHERE id = $1',
      [id]
    ));
  } else if (type === 'agent') {
    ({ rows: [row] } = await query('SELECT id, nom, prenom, email, role_agent AS role, telephone, photo_url, actif FROM agent WHERE id = $1', [id]));
  } else {
    ({ rows: [row] } = await query('SELECT id, nom, prenom, matricule, email, photo_url, actif FROM eleve WHERE id = $1', [id]));
  }
  if (!row) throw new ApiError(404, 'Utilisateur introuvable.');
  // Pour les comptes staff (utilisateur / agent) : joindre la liste des permissions
  // (codes) attribuées au rôle afin que le frontend puisse rendre les actions au
  // niveau 'permission' et éviter des 403 inattendus.
  if (type === 'utilisateur' || type === 'agent') {
    const { rows: permRows } = await query(
      'SELECT p.code FROM permission p JOIN role_permission rp ON rp.permission_id=p.id WHERE rp.role=$1',
      [row.role]
    );
    row.permissions = permRows.map((r) => r.code);
  } else {
    row.permissions = [];
  }

  res.json(row);
}));

// PUT /auth/me -> l'utilisateur connecté modifie SON propre profil (quel que soit son type).
// Volontairement limité à la photo et au mot de passe (voir demande) : pas de nom/email/role ici.
router.put('/me', authenticate, validate({ body: majProfilSchema }), asyncHandler(async (req, res) => {
  const { id, type } = req.user;
  const { photo_url, mot_de_passe_actuel, nouveau_mot_de_passe } = req.body;

  const table = type === 'utilisateur' ? 'utilisateur' : type === 'agent' ? 'agent' : 'eleve';

  const fields = [];
  const values = [];
  let i = 1;
  const push = (col, val) => { fields.push(`${col} = $${i++}`); values.push(val); };

  if (photo_url !== undefined) push('photo_url', photo_url);

  if (nouveau_mot_de_passe) {
    if (table === 'eleve') throw new ApiError(400, "Les élèves n'ont pas de mot de passe à modifier.");
    if (!mot_de_passe_actuel) throw new ApiError(400, 'Le mot de passe actuel est requis pour le changer.');

    const { rows: cur } = await query(`SELECT mot_de_passe FROM ${table} WHERE id = $1`, [id]);
    if (!cur[0]) throw new ApiError(404, 'Compte introuvable.');
    const valid = await bcrypt.compare(mot_de_passe_actuel, cur[0].mot_de_passe);
    if (!valid) throw new ApiError(401, 'Mot de passe actuel incorrect.');

    push('mot_de_passe', await bcrypt.hash(nouveau_mot_de_passe, 12));
    fields.push(`security_version = security_version + 1`);
  }

  if (!fields.length) throw new ApiError(400, 'Aucune donnée à modifier.');
  values.push(id);

  const returningCols = table === 'eleve'
    ? 'id, nom, prenom, matricule, email, photo_url'
    : 'id, nom, prenom, email, photo_url';

  const { rows } = await query(
    `UPDATE ${table} SET ${fields.join(', ')} WHERE id = $${i} RETURNING ${returningCols}`,
    values
  );
  if (!rows[0]) throw new ApiError(404, 'Compte introuvable.');
  res.json({ ...rows[0], password_changed: Boolean(nouveau_mot_de_passe) });
}));

// ============================================================================
// Vérification 2 facteurs par selfie (voir database/schema.sql, table utilisateur)
// ============================================================================

// GET /auth/selfie-statut -> l'utilisateur connecté vérifie s'il doit encore
// confirmer son compte, et récupère son descripteur de référence (pour matching
// 100% côté client, hors-ligne, à chaque accès au Pointage).
router.get('/selfie-statut', authenticate, asyncHandler(async (req, res) => {
  const { id, type } = req.user;
  if (type !== 'utilisateur') {
    return res.json({ concerne: false });
  }
  const { rows: [row] } = await query(
    `SELECT compte_confirme, selfie_descriptor, selfie_confirmee_le, selfie_reference_url
     FROM utilisateur WHERE id = $1`,
    [id]
  );
  if (!row) throw new ApiError(404, 'Compte introuvable.');
  res.json({
    concerne: true,
    compte_confirme: row.compte_confirme,
    selfie_descriptor: row.compte_confirme ? row.selfie_descriptor : null,
    selfie_confirmee_le: row.selfie_confirmee_le,
    selfie_reference_url: row.compte_confirme ? row.selfie_reference_url : null,
  });
}));

// POST /auth/confirmer-compte -> enregistre la photo + le descripteur facial de
// référence, UNE SEULE FOIS. Bloqué si déjà confirmé (voir /admin/utilisateurs
// /:id/reset-selfie pour la réinitialisation par un admin).
router.post('/confirmer-compte', authenticate, validate({ body: confirmerCompteSchema }), asyncHandler(async (req, res) => {
  const { id, type } = req.user;
  if (type !== 'utilisateur') {
    throw new ApiError(400, "La confirmation de compte par selfie ne concerne que les comptes admin/enseignant.");
  }
  const { photo_base64, descriptor } = req.body;
  if (!descripteurValide(descriptor)) {
    throw new ApiError(400, "Descripteur facial invalide ou absent (aucun visage détecté clairement sur la photo).");
  }

  const { rows: [existant] } = await query('SELECT compte_confirme FROM utilisateur WHERE id = $1', [id]);
  if (!existant) throw new ApiError(404, 'Compte introuvable.');
  if (existant.compte_confirme) {
    throw new ApiError(409, "Ce compte est déjà confirmé. Contactez un administrateur pour réinitialiser la photo de référence.");
  }

  const nomFichier = await enregistrerSelfieBase64(photo_base64, id);
  const url = urlSelfie(req, nomFichier);

  const { rows: [row] } = await query(
    `UPDATE utilisateur
     SET selfie_reference_url = $1, selfie_descriptor = $2, compte_confirme = TRUE, selfie_confirmee_le = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING id, compte_confirme, selfie_confirmee_le, selfie_reference_url`,
    [url, JSON.stringify(descriptor), id]
  );

  await query(
    `INSERT INTO audit_log (utilisateur_id, action, table_nom, record_id, nouvelle_valeur)
     VALUES ($1, 'modification', 'utilisateur', $1, $2)`,
    [id, JSON.stringify({ evenement: 'confirmation_compte_selfie' })]
  );

  res.status(201).json(row);
}));

module.exports = router;
