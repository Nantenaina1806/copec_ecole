const express = require('express');
const bcrypt = require('bcryptjs');
const { query, pool } = require('../config/db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { sendEmail, resetToken, hashToken, config } = require('../services/notificationProviders');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false });
const generic = 'Si un compte correspondant existe, un lien de réinitialisation a été envoyé.';

router.post('/request', limiter, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'Adresse e-mail invalide.');
  const candidates = [];
  const u = await query('SELECT id, nom, prenom, email FROM utilisateur WHERE LOWER(email)=LOWER($1) AND actif=TRUE LIMIT 1', [email]);
  if (u.rows[0]) candidates.push({ type: 'utilisateur', ...u.rows[0] });
  if (!candidates.length) {
    const a = await query('SELECT id, nom, prenom, email FROM agent WHERE LOWER(email)=LOWER($1) AND actif=TRUE LIMIT 1', [email]);
    if (a.rows[0]) candidates.push({ type: 'agent', ...a.rows[0] });
  }
  // Toujours une réponse générique : pas d'énumération des comptes.
  if (!candidates.length) return res.json({ message: generic });
  const account = candidates[0];
  await query('UPDATE password_reset_token SET used_at=COALESCE(used_at, NOW()) WHERE subject_type=$1 AND subject_id=$2 AND used_at IS NULL', [account.type, account.id]);
  const raw = resetToken();
  await query('INSERT INTO password_reset_token(subject_type, subject_id, token_hash, expires_at, requested_ip) VALUES($1,$2,$3,NOW()+INTERVAL \'30 minutes\',$4)', [account.type, account.id, hashToken(raw), req.ip || null]);
  const url = `${config().appUrl}/reset-password?token=${raw}`;
  const result = await sendEmail({
    to: account.email,
    subject: 'Réinitialisation de votre mot de passe — COPEC',
    text: `Bonjour ${account.prenom || account.nom},\n\nUtilisez ce lien pour réinitialiser votre mot de passe : ${url}\n\nCe lien expire dans 30 minutes et ne peut être utilisé qu'une seule fois.`,
    html: `<p>Bonjour ${account.prenom || account.nom},</p><p>Une demande de réinitialisation de mot de passe a été reçue.</p><p><a href="${url}">Réinitialiser mon mot de passe</a></p><p>Ce lien expire dans 30 minutes et ne peut être utilisé qu'une seule fois.</p>`,
  });
  await query('INSERT INTO security_event(subject_type,subject_id,event_type,ip,user_agent,metadata) VALUES($1,$2,$3,$4,$5,$6)', [account.type, account.id, 'password_reset_requested', req.ip || null, req.get('user-agent') || null, JSON.stringify({ delivery: result.status })]);
  // On ne révèle pas au client si le fournisseur est configuré.
  res.json({ message: generic, delivery_status: process.env.NODE_ENV === 'production' ? undefined : result.status });
}));

router.post('/confirm', limiter, asyncHandler(async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.nouveau_mot_de_passe || '');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(400, 'Lien de réinitialisation invalide.');
  if (password.length < 10) throw new ApiError(400, 'Le nouveau mot de passe doit contenir au moins 10 caractères.');
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) throw new ApiError(400, 'Le nouveau mot de passe doit contenir une majuscule, une minuscule et un chiffre.');
  const { rows } = await query(`SELECT * FROM password_reset_token WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() LIMIT 1`, [hashToken(token)]);
  const row = rows[0];
  if (!row) throw new ApiError(400, 'Lien invalide, expiré ou déjà utilisé.');
  const table = row.subject_type === 'utilisateur' ? 'utilisateur' : 'agent';
  const hash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE ${table} SET mot_de_passe=$1, security_version=security_version+1, updated_at=NOW() WHERE id=$2`, [hash, row.subject_id]);
    await client.query('UPDATE password_reset_token SET used_at=NOW() WHERE id=$1', [row.id]);
    await client.query('INSERT INTO security_event(subject_type,subject_id,event_type,ip,user_agent) VALUES($1,$2,$3,$4,$5)', [row.subject_type,row.subject_id,'password_reset_completed',req.ip || null,req.get('user-agent') || null]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  res.json({ message: 'Mot de passe réinitialisé avec succès. Vous pouvez maintenant vous connecter.' });
}));
module.exports = router;
