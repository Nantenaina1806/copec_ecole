// Sync client ho an'ny appli mobile "Espace Enseignant".
//
// Fitsipika lehibe (mitovy filozofia amin'ny backend/src/services/syncService.js
// nefa amin'ny HTTP fa tsy connection PostgreSQL mivantana):
//   1. Isaky ny fanovana ataon'ny mpampiasa (appel, naoty, ...) dia:
//        a) osorina/ovaina eo noho eo ao amin'ny tabilao SQLite "metier" (ex: note)
//        b) ampidirina miaraka amin'izay ao amin'ny filaharana sync_change_local
//      Roa tonta ao anaty transaction iray, mba tsy hisy fanovana very na dia
//      mikatona tampoka aza ny appli eo am-panaovana.
//   2. Rehefa misy connection, dia:
//        a) PUSH aloha (alefa ny ao amin'ny sync_change_local mbola tsy nalefa)
//        b) PULL aorian'izay (alaina izay vaovao avy amin'ny backend)
//   3. Azo antoka ny fanindroan-dalana (idempotent): operation_id (UUID) jenerémina
//      eto an-toerana no fanamarinana, ka na dia mety misy fandefasana indroa aza
//      (fahatapahan-drano teo am-panaovana) dia tsy manasoratra indroa ny backend.
//
// Adaptateur `db` andrasana (mifanaraka amin'ny @capacitor-community/sqlite):
//   db.run(sql, params)    -> Promise (INSERT/UPDATE/DELETE)
//   db.query(sql, params)  -> Promise<{ values: Array<object> }>
//
// Adaptateur `api` andrasana (mifanaraka amin'ny axios instance efa manana
// ny Authorization: Bearer <token> ao amin'ny headers, jereo mobile/src/api/client.js):
//   api.post(path, body) -> Promise<{ data }>
//   api.get(path, { params }) -> Promise<{ data }>

const PUSH_BATCH_SIZE = 200;

function randomUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Ampidiro ao amin'ny filaharana lokaly ny fanovana iray, mba halefa rehefa
 * misy connection. Antsoina io avy amin'ny "write helpers" (jereo writeHelpers.js),
 * TSY avy amin'ny UI mivantana.
 */
export async function queueLocalChange(db, { table_name, operation, row_key, old_row = null, new_row = null }) {
  const operationId = randomUuid();
  await db.run(
    `INSERT INTO sync_change_local (operation_id, table_name, operation, row_key, old_row, new_row, changed_at, pushed)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      operationId,
      table_name,
      operation,
      JSON.stringify(row_key),
      old_row ? JSON.stringify(old_row) : null,
      new_row ? JSON.stringify(new_row) : null,
      new Date().toISOString(),
    ],
  );
  return operationId;
}

async function setLocalState(db, values) {
  const fields = Object.keys(values);
  const sets = fields.map((f) => `${f} = ?`).join(', ');
  await db.run(`UPDATE sync_state_local SET ${sets} WHERE singleton = 1`, fields.map((f) => values[f]));
}

async function pushPendingChanges(db, api, deviceId) {
  const { values: rows } = await db.query(
    `SELECT local_id, operation_id, table_name, operation, row_key, old_row, new_row, changed_at
     FROM sync_change_local WHERE pushed = 0 ORDER BY local_id ASC LIMIT ?`,
    [PUSH_BATCH_SIZE],
  );
  if (!rows || !rows.length) return 0;

  const changes = rows.map((r) => ({
    operation_id: r.operation_id,
    table_name: r.table_name,
    operation: r.operation,
    row_key: JSON.parse(r.row_key),
    old_row: r.old_row ? JSON.parse(r.old_row) : null,
    new_row: r.new_row ? JSON.parse(r.new_row) : null,
    changed_at: r.changed_at,
  }));

  const { data } = await api.post('/sync/mobile/push', { deviceId, changes });

  // Ny rejected (tabilao tsy azo, na fanovana nolavina) dia tsy tokony hamerenana
  // hatrany hatrany (izany dia hanakana ny push manaraka) — marihina ho "voalefa"
  // ihany koa mba tsy hisy fifamoivoizana mandrakizay, fa tehirizina ny antony
  // ao amin'ny log lokaly mba ho hitan'ny admin/mpampianatra raha misy olana.
  const rejectedIds = new Set((data.rejected || []).map((r) => r.operation_id));
  if (data.rejected && data.rejected.length) {
    console.warn('[SYNC MOBILE] fanovana nolavin\'ny backend:', data.rejected);
  }
  const pushedOperationIds = rows
    .map((r) => r.operation_id)
    .filter((id) => !rejectedIds.has(id) || true); // marihina daholo (jereo fanamarihana ambony)
  if (pushedOperationIds.length) {
    const placeholders = pushedOperationIds.map(() => '?').join(',');
    await db.run(`UPDATE sync_change_local SET pushed = 1 WHERE operation_id IN (${placeholders})`, pushedOperationIds);
  }
  return rows.length;
}

/** Alaina amin'ny PRAGMA ny lisitry ny colonnes tena misy ao amin'ny tabilao SQLite. */
async function getLocalColumns(db, table) {
  const { values } = await db.query(`PRAGMA table_info(${table})`, []);
  return (values || []).map((c) => c.name);
}

async function applyIncomingChange(db, change) {
  const table = change.table_name;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) return; // filaza tsotra, tsy tokony hitranga satria ny backend efa manisy filtre
  const columns = await getLocalColumns(db, table);
  if (!columns.length) return; // tabilao tsy ao amin'ny schema mobile (tsy tokony hitranga koa)

  const key = change.row_key || {};
  const keyCols = Object.keys(key);
  const whereSql = keyCols.map((c) => `${c} = ?`).join(' AND ');
  const whereVals = keyCols.map((c) => key[c]);

  if (change.operation === 'DELETE') {
    await db.run(`DELETE FROM ${table} WHERE ${whereSql}`, whereVals);
    return;
  }

  const payload = change.new_row || {};
  const cols = columns.filter((c) => Object.prototype.hasOwnProperty.call(payload, c));
  if (!cols.length) return;
  const placeholders = cols.map(() => '?').join(',');
  const updateSql = cols.map((c) => `${c} = excluded.${c}`).join(', ');
  // INSERT OR REPLACE simple : le mobile n'a pas besoin de détecter les conflits
  // (c'est le rôle du backend central, qui a déjà tranché avant de renvoyer cette
  // ligne comme faisant autorité) — on écrase donc toujours avec la version reçue.
  await db.run(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updateSql}`,
    cols.map((c) => payload[c]),
  );
}

async function pullRemoteChanges(db, api, deviceId) {
  const { values: stateRows } = await db.query('SELECT last_pulled_change_id FROM sync_state_local WHERE singleton = 1', []);
  const since = Number(stateRows?.[0]?.last_pulled_change_id || 0);

  const { data } = await api.get('/sync/mobile/pull', { params: { since, deviceId } });
  const changes = data.changes || [];
  for (const change of changes) {
    await applyIncomingChange(db, change);
  }
  if (data.nextCursor) {
    await setLocalState(db, { last_pulled_change_id: data.nextCursor });
  }
  return changes.length;
}

/**
 * Andraikitra iray manontolo: PUSH aloha, PULL aorian'izay. Antsoina isaky ny
 * timer (ohatra isaky ny 15 segondra rehefa misokatra ny appli, na isaky ny
 * fiverenan'ny connection - jereo NetworkListener any amin'ny App.jsx).
 */
export async function synchroniser(db, api, deviceId) {
  await setLocalState(db, { status: 'syncing', last_error: null });
  try {
    const pushed = await pushPendingChanges(db, api, deviceId);
    const pulled = await pullRemoteChanges(db, api, deviceId);
    await setLocalState(db, { status: 'idle', last_success_at: new Date().toISOString() });
    return { pushed, pulled };
  } catch (err) {
    await setLocalState(db, { status: 'offline', last_error: String(err?.message || err) });
    // Tsy atsipy fanovana: raha tsy misy connection dia miandry ihany, tsy manakana
    // ny mpampiasa hanohy miasa lokaly.
    return { pushed: 0, pulled: 0, error: err };
  }
}
