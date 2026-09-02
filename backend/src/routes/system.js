'use strict';

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const multer = require('multer');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { config } = require('../services/notificationProviders');
const { mode, usageSummary } = require('../services/communicationGuard');

const execFileAsync = promisify(execFile);
const router = express.Router();
const BACKUP_DIR = path.resolve(process.env.COPEC_BACKUP_DIR || path.join(process.cwd(), 'backups'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === '.sql') });

function assertAdmin(req) {
  if (req.user?.role !== 'admin') throw new ApiError(403, 'Action réservée à l’administrateur.');
}
function dbEnv() {
  const url = process.env.DATABASE_URL;
  if (url) return { url };
  return { host: process.env.PGHOST, port: process.env.PGPORT || '5432', user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE };
}
function providerStatus() {
  const c = config();
  return {
    mode: mode(),
    email: { configured: c.emailProvider === 'resend' && Boolean(c.resendKey && c.emailFrom), provider: c.emailProvider || null },
    whatsapp: { configured: Boolean(c.waToken && c.waPhoneId), provider: 'meta-cloud-api' },
  };
}
async function sha256File(file) {
  return new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); const s = fs.createReadStream(file); s.on('error', reject); s.on('data', d => h.update(d)); s.on('end', () => resolve(h.digest('hex'))); });
}

router.get('/status', authenticate, authorize('admin'), asyncHandler(async (_req, res) => {
  const started = Date.now();
  let database = { status: 'error' };
  try { await query('SELECT 1'); database = { status: 'ok', latency_ms: Date.now() - started }; } catch (e) { database = { status: 'error', error: e.message }; }
  const storagePath = path.resolve(process.env.COPEC_UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
  const backupPath = BACKUP_DIR;
  const stat = (p) => { try { const s = fs.statSync(p); return { exists: true, writable: (() => { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; } })(), bytes: s.isDirectory() ? null : s.size }; } catch { return { exists: false, writable: false, bytes: null }; } };
  let lastBackup = null;
  try { const { rows } = await query('SELECT id, filename, size_bytes, checksum_sha256, status, created_at FROM system_backup ORDER BY created_at DESC LIMIT 1'); lastBackup = rows[0] || null; } catch {}
  res.json({ generated_at: new Date().toISOString(), node: process.version, environment: process.env.NODE_ENV || 'development', database, storage: stat(storagePath), backup_storage: stat(backupPath), providers: providerStatus(), last_backup: lastBackup });
}));

router.get('/communication', authenticate, authorize('admin','economie','secretaire','surveillant'), asyncHandler(async (_req, res) => {
  const [usage, deliveries, messages] = await Promise.all([
    usageSummary(),
    query(`SELECT channel, status, COUNT(*)::int AS total FROM notification_delivery WHERE created_at >= CURRENT_DATE - INTERVAL '30 days' GROUP BY channel,status ORDER BY channel,status`),
    query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE canal='email')::int AS email, COUNT(*) FILTER (WHERE canal='sms')::int AS sms, COUNT(*) FILTER (WHERE canal='les_deux')::int AS les_deux FROM message_parent WHERE date_envoi >= CURRENT_DATE - INTERVAL '30 days'`),
  ]);
  res.json({ mode: mode(), providers: providerStatus(), usage, deliveries: deliveries.rows, messages_30j: messages.rows[0] || {} });
}));

router.get('/backups', authenticate, authorize('admin'), asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT id, filename, size_bytes, checksum_sha256, status, error, created_at FROM system_backup ORDER BY created_at DESC LIMIT 50');
  res.json(rows);
}));

router.post('/backup', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { createBackup } = require('../services/backupService');
  const row = await createBackup({ utilisateurId: req.user.type === 'utilisateur' ? req.user.id : null, agentId: req.user.type === 'agent' ? req.user.id : null });
  await query(`INSERT INTO audit_log(utilisateur_id,agent_id,action,table_nom,record_id,nouvelle_valeur,ip_address) VALUES($1,$2,'creation','system_backup',$3,$4,$5)`, [req.user.type === 'utilisateur' ? req.user.id : null, req.user.type === 'agent' ? req.user.id : null, row.id, JSON.stringify({ filename: row.filename, size: row.size_bytes }), req.ip || null]);
  res.status(201).json({ ...row, message: 'Sauvegarde créée avec succès.' });
}));

router.post('/restore', authenticate, authorize('admin'), upload.single('backup'), asyncHandler(async (req, res) => {
  assertAdmin(req);
  if (process.env.ALLOW_DB_RESTORE !== 'true') throw new ApiError(403, 'La restauration est désactivée. Définissez ALLOW_DB_RESTORE=true après validation de votre procédure de sauvegarde.');
  if (req.body?.confirmation !== 'RESTAURER COPEC') throw new ApiError(400, 'Confirmation requise: RESTAURER COPEC.');
  if (!req.file) throw new ApiError(400, 'Fichier SQL requis.');
  if (req.file.size > 25 * 1024 * 1024) throw new ApiError(413, 'Sauvegarde trop volumineuse (25 Mo maximum via cette interface).');
  const sql = req.file.buffer.toString('utf8');
  if (!sql.trim()) throw new ApiError(400, 'Fichier SQL vide.');
  const d = dbEnv(); const env = { ...process.env }; if (!d.url && d.password) env.PGPASSWORD = d.password;
  const tmp = path.join(os.tmpdir(), `copec-restore-${crypto.randomUUID()}.sql`); fs.writeFileSync(tmp, sql, { mode: 0o600 });
  try {
    // psql est utilisé plutôt que client.query pour respecter les dumps pg_dump multi-commandes.
    const args = d.url ? [d.url, '--single-transaction', '--set', 'ON_ERROR_STOP=1', '--file', tmp] : ['--single-transaction', '--set', 'ON_ERROR_STOP=1', '--file', tmp, '--host', d.host, '--port', String(d.port), '--username', d.user, '--dbname', d.database];
    await execFileAsync('psql', args, { env, timeout: 180000, windowsHide: true });
    await query(`INSERT INTO audit_log(utilisateur_id,action,table_nom,nouvelle_valeur,ip_address) VALUES($1,'autre','system_backup',$2,$3)`, [req.user.id, JSON.stringify({ action: 'restore', original_filename: req.file.originalname }), req.ip || null]);
    res.json({ message: 'Restauration terminée. Redémarrez l’application si nécessaire.' });
  } catch (e) { throw new ApiError(500, `Restauration impossible: ${e.message}`); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}));

router.get('/download-backup/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT filename, filepath, status FROM system_backup WHERE id=$1', [req.params.id]);
  const row = rows[0]; if (!row || row.status !== 'success') throw new ApiError(404, 'Sauvegarde introuvable.');
  if (!fs.existsSync(row.filepath)) throw new ApiError(404, 'Fichier de sauvegarde absent du stockage.');
  res.download(row.filepath, row.filename);
}));

module.exports = router;
