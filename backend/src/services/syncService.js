const { Pool } = require('pg');
const crypto = require('crypto');
const { pool, query } = require('../config/db');

const DEVICE_ID = process.env.SYNC_DEVICE_ID || 'LOCAL-SERVER';
const INTERVAL_MS = Math.max(5000, Number(process.env.SYNC_INTERVAL_MS || 15000));
const CENTRAL_DATABASE_URL = process.env.CENTRAL_DATABASE_URL || '';
const ENABLED = process.env.SYNC_ENABLED === 'true' && Boolean(CENTRAL_DATABASE_URL);

let centralPool = null;
let timer = null;
let running = false;

function getCentralPool() {
  if (!CENTRAL_DATABASE_URL) return null;
  if (!centralPool) {
    centralPool = new Pool({
      connectionString: CENTRAL_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
  }
  return centralPool;
}

async function setLocalState(values) {
  const fields = Object.keys(values);
  const sets = fields.map((f, i) => `${f}=$${i + 1}`).join(', ');
  await query(`UPDATE sync_state SET ${sets} WHERE singleton=TRUE`, fields.map((f) => values[f]));
}

async function status() {
  const { rows } = await query(`
    SELECT singleton, last_pushed_local_change_id, last_pulled_central_change_id,
           last_success_at, last_attempt_at, last_error, status
    FROM sync_state WHERE singleton=TRUE
  `);
  const local = rows[0] || {};
  let centralReachable = false;
  let pendingCentralConflicts = 0;
  if (ENABLED) {
    try {
      const central = getCentralPool();
      await central.query('SELECT 1');
      centralReachable = true;
      const conflicts = await central.query(`SELECT COUNT(*)::int AS count FROM sync_conflict WHERE status='pending' AND source_device_id=$1`, [DEVICE_ID]);
      pendingCentralConflicts = conflicts.rows[0]?.count || 0;
    } catch { /* offline */ }
  }
  return {
    enabled: ENABLED,
    deviceId: DEVICE_ID,
    centralConfigured: Boolean(CENTRAL_DATABASE_URL),
    centralReachable,
    pendingCentralConflicts,
    ...local,
  };
}

async function withSyncFlag(client, fn) {
  await client.query("SELECT set_config('copec.sync_apply','true',true)");
  return fn();
}

async function getPkWhere(client, tableName, rowKey) {
  const { rows } = await client.query(`
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
    JOIN pg_class c ON c.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=$1 AND i.indisprimary
    ORDER BY array_position(i.indkey, a.attnum)
  `, [tableName]);
  if (!rows.length) throw new Error(`Table synchronisable sans clé primaire: ${tableName}`);
  const values = [];
  const clauses = rows.map((r, i) => {
    values.push(rowKey[r.attname]);
    return `"${r.attname.replace(/"/g, '""')}" IS NOT DISTINCT FROM $${i + 1}`;
  });
  return { where: clauses.join(' AND '), values };
}

async function getTableColumns(client, tableName) {
  const { rows } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [tableName]);
  if (!rows.length) throw new Error(`Table inconnue: ${tableName}`);
  return rows.map((r) => r.column_name);
}

function ident(name) { return `"${String(name).replace(/"/g, '""')}"`; }

async function applyChange(client, change) {
  const table = change.table_name;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error(`Nom de table invalide: ${table}`);
  const columns = await getTableColumns(client, table);
  const key = change.row_key || {};
  const { where, values: keyValues } = await getPkWhere(client, table, key);
  const params = change.new_row || {};

  if (change.operation === 'INSERT') {
    const cols = columns.filter((c) => Object.prototype.hasOwnProperty.call(params, c));
    const vals = cols.map((c) => params[c]);
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
    const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(',')}) VALUES (${placeholders})`;
    try {
      await client.query(sql, vals);
    } catch (err) {
      if (err.code === '23505') {
        const { rows: conflicting } = await client.query(`SELECT to_jsonb(t) AS row FROM ${ident(table)} t WHERE ${where} LIMIT 1`, keyValues);
        await client.query(`
          INSERT INTO sync_conflict(operation_id, source_device_id, table_name, row_key, local_row, incoming_row, reason)
          VALUES($1,$2,$3,$4,$5,$6,$7)
        `, [change.operation_id, change.source_device_id, table, key, conflicting[0]?.row || null, params, 'Une contrainte unique empêche la fusion automatique de cette insertion.']);
        return;
      }
      throw err;
    }
    return;
  }

  const { rows: existing } = await client.query(`SELECT to_jsonb(t) AS row FROM ${ident(table)} t WHERE ${where} LIMIT 1`, keyValues);

  if (change.operation === 'DELETE') {
    if (!existing.length) return;
    const oldRow = change.old_row || {};
    const localRow = existing[0].row || {};
    const changedLocally = columns.some((c) => JSON.stringify(localRow[c]) !== JSON.stringify(oldRow[c]));
    if (changedLocally) {
      await client.query(`
        INSERT INTO sync_conflict(operation_id, source_device_id, table_name, row_key, local_row, incoming_row, reason)
        VALUES($1,$2,$3,$4,$5,$6,$7)
      `, [change.operation_id, change.source_device_id, table, key, localRow, null, 'Suppression distante refusée car la ligne locale a évolué.']);
      return;
    }
    await client.query(`DELETE FROM ${ident(table)} WHERE ${where}`, keyValues);
    return;
  }

  if (!existing.length) {
    // Un update peut arriver après un import partiel : on transforme alors l'update
    // en insert si le payload contient une ligne complète.
    const cols = columns.filter((c) => Object.prototype.hasOwnProperty.call(params, c));
    const vals = cols.map((c) => params[c]);
    await client.query(`INSERT INTO ${ident(table)} (${cols.map(ident).join(',')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT DO NOTHING`, vals);
    return;
  }

  // Protection contre l'écrasement silencieux : si la ligne locale a changé depuis
  // la version que l'émetteur avait lue, le changement est enregistré comme conflit.
  const oldRow = change.old_row || {};
  const localRow = existing[0].row || {};
  const comparable = columns.filter((c) => !Object.prototype.hasOwnProperty.call(key, c));
  const localDiffersFromBase = comparable.some((c) => JSON.stringify(localRow[c]) !== JSON.stringify(oldRow[c]));
  if (localDiffersFromBase) {
    await client.query(`
      INSERT INTO sync_conflict(operation_id, source_device_id, table_name, row_key, local_row, incoming_row, reason)
      VALUES($1,$2,$3,$4,$5,$6,$7)
    `, [change.operation_id, change.source_device_id, table, key, localRow, params, 'La ligne locale a été modifiée depuis la version source.']);
    return;
  }

  const setCols = columns.filter((c) => !Object.prototype.hasOwnProperty.call(key, c) && Object.prototype.hasOwnProperty.call(params, c));
  if (!setCols.length) return;
  const setValues = setCols.map((c) => params[c]);
  const allParams = [...setValues, ...keyValues];
  const setSql = setCols.map((c, i) => `${ident(c)}=$${i + 1}`).join(', ');
  const whereSql = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + setValues.length}`);
  await client.query(`UPDATE ${ident(table)} SET ${setSql} WHERE ${whereSql}`, allParams);
}

async function pushLocalChanges() {
  const central = getCentralPool();
  if (!central) return 0;
  const { rows: stateRows } = await query('SELECT last_pushed_local_change_id FROM sync_state WHERE singleton=TRUE');
  const cursor = Number(stateRows[0]?.last_pushed_local_change_id || 0);
  const { rows: changes } = await query(`
    SELECT id, operation_id, source_device_id, table_name, operation, row_key, old_row, new_row, changed_at
    FROM sync_change
    WHERE id > $1 AND source_device_id = $2
    ORDER BY id ASC
    LIMIT 200
  `, [cursor, DEVICE_ID]);
  if (!changes.length) return 0;

  const client = await central.connect();
  try {
    for (const change of changes) {
      await client.query('BEGIN');
      try {
        await withSyncFlag(client, () => applyChange(client, change));
        // Le trigger central est volontairement désactivé pendant l'application
        // pour éviter une boucle. On publie donc explicitement l'opération dans
        // la file centrale afin que les autres postes puissent la puller.
        await client.query(`
          INSERT INTO sync_change(operation_id, source_device_id, table_name, operation, row_key, old_row, new_row, changed_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (operation_id) DO NOTHING
        `, [change.operation_id, change.source_device_id, change.table_name, change.operation, change.row_key, change.old_row, change.new_row, change.changed_at]);
        await client.query('COMMIT');
        await setLocalState({ last_pushed_local_change_id: change.id });
      } catch (err) {
        await client.query('ROLLBACK');
        // Un conflit est déjà enregistré côté central si applicable. Pour les autres
        // erreurs, on arrête le lot : la prochaine tentative reprendra le même changement.
        throw err;
      }
    }
    return changes.length;
  } finally { client.release(); }
}

async function pullCentralChanges() {
  const central = getCentralPool();
  if (!central) return 0;
  const { rows: stateRows } = await query('SELECT last_pulled_central_change_id FROM sync_state WHERE singleton=TRUE');
  const cursor = Number(stateRows[0]?.last_pulled_central_change_id || 0);
  const { rows: changes } = await central.query(`
    SELECT id, operation_id, source_device_id, table_name, operation, row_key, old_row, new_row, changed_at
    FROM sync_change
    WHERE id > $1 AND source_device_id <> $2
    ORDER BY id ASC
    LIMIT 200
  `, [cursor, DEVICE_ID]);
  if (!changes.length) return 0;

  const client = await pool.connect();
  try {
    for (const change of changes) {
      await client.query('BEGIN');
      try {
        await withSyncFlag(client, () => applyChange(client, change));
        await client.query('COMMIT');
        await setLocalState({ last_pulled_central_change_id: change.id });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return changes.length;
  } finally { client.release(); }
}

async function synchroniser() {
  if (!ENABLED || running) return;
  running = true;
  await setLocalState({ status: 'syncing', last_attempt_at: new Date(), last_error: null });
  try {
    // Push d'abord : les données créées localement sont centralisées avant le pull.
    const pushed = await pushLocalChanges();
    const pulled = await pullCentralChanges();
    await setLocalState({ status: 'idle', last_success_at: new Date(), last_error: null });
    if (pushed || pulled) console.log(`[SYNC] OK — ${pushed} envoyée(s), ${pulled} reçue(s).`);
  } catch (err) {
    await setLocalState({ status: 'offline', last_error: err.message });
    console.warn(`[SYNC] en attente — ${err.message}`);
  } finally { running = false; }
}

function demarrerSynchronisation() {
  if (!ENABLED) {
    console.log('[SYNC] désactivée (SYNC_ENABLED != true ou CENTRAL_DATABASE_URL absent).');
    return;
  }
  query("SELECT set_config('copec.sync_device', $1, false)", [DEVICE_ID]).catch(() => {});
  console.log(`[SYNC] activée pour ${DEVICE_ID}, intervalle ${INTERVAL_MS}ms.`);
  synchroniser();
  timer = setInterval(synchroniser, INTERVAL_MS);
}

async function arreterSynchronisation() {
  if (timer) clearInterval(timer);
  timer = null;
  if (centralPool) await centralPool.end().catch(() => {});
  centralPool = null;
}

module.exports = {
  demarrerSynchronisation, arreterSynchronisation, synchroniser, status, DEVICE_ID,
  // Exportées pour backend/src/routes/syncMobile.js (push/pull HTTP utilisés par
  // l'application mobile enseignant). Cette instance backend, quand elle est déployée
  // sur un hébergement Internet avec DATABASE_URL pointant directement vers Neon,
  // a `pool` (config/db.js) qui EST la base centrale — donc appliquer un changement
  // mobile sur `pool` ici revient à écrire directement dans le central. Aucune
  // connexion PostgreSQL directe depuis le téléphone n'est nécessaire.
  applyChange, withSyncFlag, getPkWhere, getTableColumns,
};
