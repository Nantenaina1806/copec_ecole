const { Pool } = require('pg');
require('dotenv').config();

// Neon (et la plupart des hébergeurs PostgreSQL cloud) exigent une connexion SSL et
// fournissent une URL de connexion unique plutôt que des variables PGHOST/PGUSER séparées.
// Si DATABASE_URL est présent dans .env, on l'utilise en priorité (cas Neon).
// Sinon, on retombe sur les variables PG* classiques (cas PostgreSQL local).
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // requis par Neon
      max: 20,
      idleTimeoutMillis: 30000,
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'gestion_ecole',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      max: 20,
      idleTimeoutMillis: 30000,
    };

const pool = new Pool(poolConfig);

// Le trigger de synchronisation lit ces paramètres par connexion PostgreSQL.
// Ils sont appliqués à chaque nouveau client du pool afin que toutes les écritures
// soient correctement attribuées au serveur local ou central sans toucher aux routes métier.
pool.on('connect', (client) => {
  const deviceId = process.env.SYNC_DEVICE_ID || 'CENTRAL-SERVER';
  client.query("SELECT set_config('copec.sync_device', $1, false)", [deviceId]).catch((err) => {
    console.warn('[SYNC] Impossible de définir copec.sync_device :', err.message);
  });
});

pool.on('error', (err) => {
  console.error('Erreur inattendue du pool PostgreSQL :', err);
});

// Codes d'erreur réseau/connexion (pas des erreurs SQL métier) où retenter a du sens :
// la connexion au pool a été coupée/refusée, pas la requête elle-même qui a échoué.
const CODES_RETRYABLES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', '57P01', '57P03']);
const NB_TENTATIVES_MAX = 3; // essai initial + 2 nouvelles tentatives
const DELAI_BASE_MS = 150;

function estRetryable(err) {
  return CODES_RETRYABLES.has(err.code);
}

// On ne retente automatiquement QUE les requêtes en lecture seule (SELECT/WITH ... SELECT).
// Retenter une écriture (INSERT/UPDATE/DELETE) après une coupure réseau serait dangereux :
// si la commande avait déjà atteint PostgreSQL avant la coupure, la rejouer l'appliquerait
// deux fois (double paiement, double insertion...). Pour les écritures, on se contente donc
// de logguer clairement l'échec et de laisser l'appelant (et son transaction éventuelle) gérer.
function estLectureSeule(text) {
  return /^\s*(select|with)\b/i.test(text);
}

function attendre(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Petit helper pour logguer les requêtes lentes en dev, et retenter les lectures
// interrompues par une coupure de connexion transitoire (utile en particulier sur les
// hébergeurs cloud dont le pool PostgreSQL peut couper une connexion idle sans préavis).
async function query(text, params, _tentative = 1) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production' && duration > 200) {
      console.warn(`[SQL LENT] ${duration}ms :: ${text}`);
    }
    return res;
  } catch (err) {
    if (estRetryable(err) && estLectureSeule(text) && _tentative < NB_TENTATIVES_MAX) {
      const delai = DELAI_BASE_MS * _tentative;
      console.warn(
        `[SQL] Connexion interrompue (${err.code}), nouvel essai ${_tentative}/${NB_TENTATIVES_MAX - 1} dans ${delai}ms...`
      );
      await attendre(delai);
      return query(text, params, _tentative + 1);
    }
    throw err;
  }
}

module.exports = { pool, query };
