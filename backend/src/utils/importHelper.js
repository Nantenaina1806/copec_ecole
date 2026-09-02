const { pool } = require('../config/db');

const MAX_LIGNES_IMPORT = 2000;

/**
 * Exécute un import en masse, ligne par ligne, en isolant chaque ligne dans son propre
 * SAVEPOINT PostgreSQL : si une ligne viole une contrainte (doublon, référence invalide,
 * règle métier...), SEULE cette ligne est annulée — les lignes déjà importées avec succès
 * restent acquises et les lignes suivantes continuent d'être traitées normalement.
 * C'est ce qui garantit qu'un import ne peut jamais laisser la base de données dans un état
 * incohérent (contrairement à une boucle de simples INSERT sans transaction, où une erreur
 * SQL sur une ligne interrompt la connexion et invalide silencieusement toute la suite).
 *
 * @param {Array<object>} rows - lignes brutes issues du fichier Excel/CSV importé.
 * @param {(client: import('pg').PoolClient, row: object, index: number) => Promise<object>} processRow
 *   Doit valider + insérer/mettre à jour la ligne avec `client.query(...)` (jamais le `query`
 *   global du pool, pour rester dans la même transaction), et retourner la ligne créée.
 *   Toute erreur levée (ApiError ou erreur PostgreSQL) fait échouer uniquement cette ligne.
 * @returns {Promise<{total:number, importes:number, echoues:number, erreurs:Array, lignes:Array}>}
 */
async function runImport(rows, processRow) {
  if (!Array.isArray(rows) || rows.length === 0) {
    const err = new Error('Aucune ligne à importer.');
    err.status = 400;
    throw err;
  }
  if (rows.length > MAX_LIGNES_IMPORT) {
    const err = new Error(`Trop de lignes dans le fichier (${MAX_LIGNES_IMPORT} maximum par import).`);
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  const succes = [];
  const erreurs = [];
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i += 1) {
      const savepoint = `sp_import_${i}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const inserted = await processRow(client, rows[i], i);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        succes.push(inserted);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        // ligne + 2 : la ligne 1 du fichier Excel est l'en-tête, donc la 1ère donnée est la ligne 2.
        erreurs.push({ ligne: i + 2, message: messageErreurLigne(err) });
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    // Erreur inattendue en dehors d'une ligne (ex. connexion perdue) : on annule tout l'import
    // plutôt que de renvoyer un résultat partiel et incertain.
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return {
    total: rows.length,
    importes: succes.length,
    echoues: erreurs.length,
    erreurs,
    lignes: succes,
  };
}

// Traduit les erreurs PostgreSQL courantes (mêmes codes que middleware/errorHandler.js) en
// message clair par ligne, pour que l'utilisateur sache exactement quoi corriger dans son fichier.
function messageErreurLigne(err) {
  if (err.status && err.message) return err.message; // ApiError métier déjà explicite
  if (err.code === '23505') return `Doublon : cet enregistrement existe déjà. (${err.detail || ''})`.trim();
  if (err.code === '23503') return `Référence invalide : donnée liée introuvable. (${err.detail || ''})`.trim();
  if (err.code === '23514') return 'Donnée invalide : règle métier non respectée.';
  if (err.code === '22P02') return 'Format de donnée invalide.';
  if (err.code === '23502') return `Champ obligatoire manquant. (${err.column || ''})`.trim();
  return err.message || 'Erreur inconnue.';
}

// Petits utilitaires de nettoyage partagés par tous les routers d'import (les fichiers Excel
// renvoient souvent des chaînes vides, des espaces superflus ou des nombres en texte).
const texte = (v) => (v === undefined || v === null ? '' : String(v).trim());
const optionnel = (v) => (texte(v) === '' ? null : texte(v));
const nombre = (v) => {
  if (v === undefined || v === null || texte(v) === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isNaN(n) ? null : n;
};
const booleen = (v) => {
  const t = texte(v).toLowerCase();
  return ['1', 'oui', 'vrai', 'true', 'x', 'yes'].includes(t);
};

module.exports = { runImport, MAX_LIGNES_IMPORT, texte, optionnel, nombre, booleen };
