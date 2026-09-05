import { enregistrerAbsenceEleve, enregistrerAppelClasse, saisirDevoir, saisirNote } from './sync/writeHelpers';
import { queueLocalChange } from './sync/syncClient';
import { generateLocalId } from './sync/idGenerator';

const CACHEABLE_GETS = [
  ['/classes', 'classe'],
  ['/matieres', 'matiere'],
  ['/bimestres', 'bimestre'],
  ['/annees-scolaires', 'annee_scolaire'],
  ['/eleves', 'eleve'],
  ['/emploi-du-temps', 'emploi_du_temps'],
  ['/affectations/enseignant-matiere-classe', 'enseignant_matiere_classe'],
  ['/inscriptions', 'inscription'],
  ['/devoirs', 'devoir'],
  ['/notes', 'note'],
  ['/pointage/enseignant/a-valider', 'pointage_enseignant'],
  ['/parents', 'parent'],
  ['/salles', 'salle'],
  ['/finance/frais', 'frais_scolaire'],
  ['/finance/paiements', 'paiement'],
  ['/messages', 'message_parent'],
];

const CRUD_TABLES = [
  ['/eleves', 'eleve'],
  ['/classes', 'classe'],
  ['/matieres', 'matiere'],
  ['/parents', 'parent'],
  ['/inscriptions', 'inscription'],
  ['/finance/frais', 'frais_scolaire'],
  ['/finance/paiements', 'paiement'],
  ['/communication/messages', 'message_parent'],
];

function pathOf(config) {
  return String(config?.url || '').split('?')[0].replace(/\/$/, '') || '/';
}

function rowsFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function columns(db, table) {
  const result = await db.query(`PRAGMA table_info(${table})`, []);
  return (result.values || []).map((column) => column.name);
}

async function cacheRows(db, table, rows) {
  if (!rows.length) return;
  const allowed = await columns(db, table);
  if (!allowed.length) return;
  for (const row of rows) {
    if (row?.id === undefined || row?.id === null) continue;
    const names = allowed.filter((name) => Object.prototype.hasOwnProperty.call(row, name));
    if (!names.length) continue;
    const placeholders = names.map(() => '?').join(',');
    await db.run(
      `INSERT INTO ${table} (${names.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${names.filter((name) => name !== 'id').map((name) => `${name}=excluded.${name}`).join(',') || 'id=id'}`,
      names.map((name) => row[name] ?? null),
    );
  }
}

function matchingCache(path) {
  return CACHEABLE_GETS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
}

function matchingCrud(path) {
  return CRUD_TABLES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
}

function parseData(config) {
  if (!config?.data) return {};
  if (typeof config.data === 'string') {
    try { return JSON.parse(config.data); } catch { return {}; }
  }
  return config.data;
}

async function activeYear(db) {
  const result = await db.query('SELECT id FROM annee_scolaire WHERE actif = 1 ORDER BY id DESC LIMIT 1', []);
  return result.values?.[0]?.id || null;
}

async function readOffline(db, config) {
  const path = pathOf(config);
  const params = config.params || {};
  if (path === '/classes') {
    const result = await db.query('SELECT * FROM classe ORDER BY nom', []);
    return result.values || [];
  }
  if (path === '/matieres') {
    const result = await db.query('SELECT * FROM matiere WHERE actif = 1 ORDER BY nom', []);
    return result.values || [];
  }
  if (path === '/bimestres') {
    const result = await db.query('SELECT * FROM bimestre ORDER BY numero', []);
    return result.values || [];
  }
  if (path === '/annees-scolaires') {
    const result = await db.query('SELECT * FROM annee_scolaire ORDER BY id DESC', []);
    return result.values || [];
  }
  if (path === '/eleves') {
    const result = await db.query(
      `SELECT e.*, i.classe_id, i.annee_scolaire_id, i.statut AS inscription_statut
       FROM eleve e LEFT JOIN inscription i ON i.eleve_id = e.id
       WHERE (? IS NULL OR i.classe_id = ?) AND e.actif = 1 ORDER BY e.nom, e.prenom`,
      [params.classe_id || null, params.classe_id || null],
    );
    return result.values || [];
  }
  if (path === '/emploi-du-temps') {
    const result = await db.query(
      `SELECT edt.*, c.nom AS classe_nom, m.nom AS matiere_nom
       FROM emploi_du_temps edt LEFT JOIN classe c ON c.id = edt.classe_id
       LEFT JOIN matiere m ON m.id = edt.matiere_id
       WHERE (? IS NULL OR edt.enseignant_id = ?) AND edt.actif = 1
       ORDER BY edt.jour, edt.heure_debut`,
      [params.enseignant_id || null, params.enseignant_id || null],
    );
    return result.values || [];
  }
  if (path === '/affectations/enseignant-matiere-classe') {
    const result = await db.query(
      `SELECT emc.*, c.nom AS classe_nom, m.nom AS matiere_nom
       FROM enseignant_matiere_classe emc LEFT JOIN classe c ON c.id = emc.classe_id
       LEFT JOIN matiere m ON m.id = emc.matiere_id WHERE (? IS NULL OR emc.enseignant_id = ?)`,
      [params.enseignant_id || null, params.enseignant_id || null],
    );
    return result.values || [];
  }
  if (path === '/devoirs') {
    const result = await db.query('SELECT * FROM devoir ORDER BY date_assignation DESC, id DESC', []);
    return result.values || [];
  }
  if (path === '/notes') {
    const result = await db.query('SELECT * FROM note ORDER BY id DESC', []);
    return result.values || [];
  }
  if (path === '/historique') return { rows: [] };
  if (path === '/statistiques') return { presence_par_statut: [], presence_par_classe: [], moyenne_par_classe: [] };
  const match = matchingCache(path);
  if (match) {
    const result = await db.query(`SELECT * FROM ${match[1]} ORDER BY id DESC`, []);
    return result.values || [];
  }
  return [];
}

async function genericCrudWrite(db, config, table) {
  const method = String(config.method || 'post').toLowerCase();
  const path = pathOf(config);
  const data = parseData(config);
  const allowed = await columns(db, table);
  const idFromPath = path.match(/\/(\d+)$/)?.[1];
  if (method === 'post') {
    const id = data.id ?? generateLocalId();
    const row = { ...data, id };
    const names = allowed.filter((name) => Object.prototype.hasOwnProperty.call(row, name));
    await db.run(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`, names.map((name) => row[name] ?? null));
    await queueLocalChange(db, { table_name: table, operation: 'INSERT', row_key: { id }, new_row: row });
    return { ...row, offline: true };
  }
  if (!idFromPath) throw new Error('Identifiant absent pour cette action offline.');
  const id = Number(idFromPath);
  const current = await db.query(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`, [id]);
  const oldRow = current.values?.[0];
  if (!oldRow) throw new Error('Ligne absente du cache local.');
  if (method === 'delete') {
    await db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
    await queueLocalChange(db, { table_name: table, operation: 'DELETE', row_key: { id }, old_row: oldRow });
    return { id, offline: true };
  }
  const row = { ...oldRow, ...data, id };
  const names = allowed.filter((name) => name !== 'id' && Object.prototype.hasOwnProperty.call(data, name));
  if (names.length) await db.run(`UPDATE ${table} SET ${names.map((name) => `${name} = ?`).join(', ')} WHERE id = ?`, [...names.map((name) => row[name] ?? null), id]);
  await queueLocalChange(db, { table_name: table, operation: 'UPDATE', row_key: { id }, old_row: oldRow, new_row: row });
  return { ...row, offline: true };
}

async function writeOffline(db, config) {
  const path = pathOf(config);
  const data = parseData(config);
  const user = JSON.parse(localStorage.getItem('copec_user') || '{}');
  const year = data.annee_scolaire_id || await activeYear(db);
  if (config.method?.toLowerCase() === 'post' && path === '/pointage/appel') {
    await enregistrerAppelClasse(db, { ...data, enseignant_id: user.id, annee_scolaire_id: year, date_pointage: data.date_pointage || new Date().toISOString().slice(0, 10) });
    return { offline: true, message: 'Appel enregistré localement.' };
  }
  if (config.method?.toLowerCase() === 'post' && path === '/notes') {
    await saisirNote(db, { ...data, enseignant_id: user.id, annee_scolaire_id: year });
    return { offline: true, message: 'Note enregistrée localement.' };
  }
  if (config.method?.toLowerCase() === 'post' && path === '/devoirs') {
    await saisirDevoir(db, { ...data, enseignant_id: user.id, annee_scolaire_id: year, date_assignation: data.date_assignation || new Date().toISOString().slice(0, 10) });
    return { offline: true, message: 'Devoir enregistré localement.' };
  }
  if (config.method?.toLowerCase() === 'post' && path === '/absences/eleves') {
    await enregistrerAbsenceEleve(db, data);
    return { offline: true, message: 'Absence enregistrée localement.' };
  }
  const crud = matchingCrud(path);
  if (crud) return genericCrudWrite(db, config, crud[1]);
  throw new Error('Cette action nécessite une connexion Internet dans cette version.');
}

export function createOfflineBridge(db, syncNow) {
  return {
    async cacheResponse(config, data) {
      if (String(config?.method || 'get').toLowerCase() !== 'get') return;
      const match = matchingCache(pathOf(config));
      if (match) await cacheRows(db, match[1], rowsFrom(data));
    },
    async requestOffline(config) {
      const method = String(config?.method || 'get').toLowerCase();
      const data = method === 'get' ? await readOffline(db, config) : await writeOffline(db, config);
      if (method !== 'get') syncNow();
      return data;
    },
  };
}
