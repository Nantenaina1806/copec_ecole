const express = require('express');
const { pool, query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { applyChange, withSyncFlag } = require('../services/syncService');
const { isMobileTable, isMobileWritable, canWriteMobileTable } = require('../config/mobileSyncTables');

const router = express.Router();

const MAX_BATCH = 200;

function isValidDeviceId(id) {
  return typeof id === 'string' && /^MOBILE-[a-zA-Z0-9-]{8,80}$/.test(id);
}

// ---------------------------------------------------------------------------
// POST /api/sync/mobile/push
// Corps attendu :
//   { deviceId: "MOBILE-<uuid>", changes: [ { operation_id, table_name,
//       operation, row_key, old_row, new_row, changed_at }, ... ] }
//
// Chaque `operation_id` est un UUID généré côté téléphone (voir mobile/src/sync/
// syncClient.js) : il sert de clé d'idempotence, donc renvoyer deux fois le même
// changement (ex: après une coupure réseau) ne le duplique jamais.
//
// IMPORTANT : cette route n'a de sens que sur l'instance backend déployée sur
// Internet, dont DATABASE_URL (config/db.js -> `pool`) pointe DIRECTEMENT vers
// Neon (le central). `applyChange` écrit donc directement dans le central, et
// republie l'opération dans sync_change pour que les PC (via pullCentralChanges)
// la récupèrent au prochain cycle. Ne jamais monter cette route sur un backend
// dont `pool` est une base locale PC (electron/local-postgres.cjs) — ce serait un
// device de plus derrière un LAN, pas la voie directe attendue pour le mobile.
// ---------------------------------------------------------------------------
router.post('/mobile/push', authenticate, async (req, res, next) => {
  try {
    if (req.user.type !== 'utilisateur' && req.user.type !== 'agent') {
      return res.status(403).json({ error: 'Cette synchronisation est réservée au personnel autorisé.' });
    }
    const { deviceId, changes } = req.body || {};
    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'deviceId invalide (attendu: MOBILE-<uuid>).' });
    }
    if (!Array.isArray(changes) || changes.length === 0) {
      return res.json({ applied: 0, rejected: [] });
    }
    if (changes.length > MAX_BATCH) {
      return res.status(400).json({ error: `Trop de changements en un seul envoi (max ${MAX_BATCH}).` });
    }

    await query(`
      INSERT INTO sync_device(device_id, nom, type, actif, last_seen_at)
      VALUES ($1, $2, 'mobile', TRUE, CURRENT_TIMESTAMP)
      ON CONFLICT (device_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP, actif = TRUE
    `, [deviceId, `${req.user.nom || ''} ${req.user.prenom || ''}`.trim() || deviceId]);

    let applied = 0;
    const rejected = [];
    const client = await pool.connect();
    try {
      for (const change of changes) {
        const table = change && change.table_name;
        if (!isMobileTable(table)) {
          rejected.push({ operation_id: change?.operation_id, reason: `Table non autorisée pour le mobile: ${table}` });
          continue;
        }
        if (!isMobileWritable(table) || !canWriteMobileTable(table, req.user.role)) {
          rejected.push({ operation_id: change?.operation_id, reason: `Table en lecture seule pour le mobile: ${table}` });
          continue;
        }
        if (!change.operation_id || !change.row_key || !['INSERT', 'UPDATE', 'DELETE'].includes(change.operation)) {
          rejected.push({ operation_id: change?.operation_id, reason: 'Changement malformé.' });
          continue;
        }
        // Un utilisateur ne synchronise que les lignes qu'il est autorisé à
        // créer. Le serveur reste l'autorité finale sur les permissions métier.
        if (change.new_row && Object.prototype.hasOwnProperty.call(change.new_row, 'enseignant_id')) {
          if (req.user.role === 'enseignant') change.new_row.enseignant_id = req.user.id;
        }

        await client.query('BEGIN');
        try {
          const existing = await client.query(
            `SELECT 1 FROM sync_change WHERE operation_id = $1`,
            [change.operation_id],
          );
          if (existing.rows.length) {
            // Déjà appliqué lors d'un envoi précédent (retry après coupure réseau).
            await client.query('COMMIT');
            applied += 1;
            continue;
          }
          await withSyncFlag(client, () => applyChange(client, change));
          await client.query(`
            INSERT INTO sync_change(operation_id, source_device_id, table_name, operation, row_key, old_row, new_row, changed_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (operation_id) DO NOTHING
          `, [change.operation_id, deviceId, change.table_name, change.operation, change.row_key, change.old_row || null, change.new_row || null, change.changed_at || new Date()]);
          await client.query('COMMIT');
          applied += 1;
        } catch (err) {
          await client.query('ROLLBACK');
          rejected.push({ operation_id: change.operation_id, reason: err.message });
        }
      }
    } finally {
      client.release();
    }

    res.json({ applied, rejected });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/sync/mobile/pull?since=<cursor>&deviceId=MOBILE-<uuid>
// Renvoie jusqu'à MAX_BATCH changements (table_name limité aux tables mobiles)
// survenus après `since`, en excluant ceux émis par ce device lui-même.
// Le mobile applique les lignes reçues dans sa SQLite locale puis renvoie le
// plus grand `id` reçu comme prochain `since`.
// ---------------------------------------------------------------------------
router.get('/mobile/pull', authenticate, async (req, res, next) => {
  try {
    const since = Number(req.query.since || 0);
    const deviceId = String(req.query.deviceId || '');
    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: 'deviceId invalide (attendu: MOBILE-<uuid>).' });
    }
    const tables = Object.keys(require('../config/mobileSyncTables').MOBILE_TABLES);
    const { rows } = await pool.query(`
      SELECT id, operation_id, source_device_id, table_name, operation, row_key, old_row, new_row, changed_at
      FROM sync_change
      WHERE id > $1 AND source_device_id <> $2 AND table_name = ANY($3::text[])
      ORDER BY id ASC
      LIMIT ${MAX_BATCH}
    `, [since, deviceId, tables]);

    await query(`
      UPDATE sync_device SET last_seen_at = CURRENT_TIMESTAMP WHERE device_id = $1
    `, [deviceId]);

    const nextCursor = rows.length ? rows[rows.length - 1].id : since;
    res.json({ changes: rows, nextCursor });
  } catch (err) { next(err); }
});

module.exports = router;
