const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');

/**
 * Fabrique un routeur CRUD générique pour une table simple.
 * Usage réservé aux tables sans logique métier complexe (RG spécifiques gérées à la main ailleurs).
 *
 * @param {Object} opts
 * @param {string} opts.table - nom de la table
 * @param {string[]} opts.columns - colonnes autorisées en écriture (insert/update)
 * @param {string} [opts.orderBy] - clause ORDER BY par défaut
 * @param {string[]} [opts.readRoles] - rôles autorisés en lecture (défaut: tous les authentifiés)
 * @param {string[]} [opts.writeRoles] - rôles autorisés en écriture (défaut: admin)
 */
function createCrudRouter({ table, columns, orderBy = 'id', readRoles = null, writeRoles = ['admin'] }) {
  const router = express.Router();

  const listMiddleware = readRoles ? [authenticate, authorize(...readRoles)] : [authenticate];
  const writeMiddleware = [authenticate, authorize(...writeRoles)];

  router.get('/', ...listMiddleware, asyncHandler(async (req, res) => {
    const { rows } = await query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
    res.json(rows);
  }));

  router.get('/:id', ...listMiddleware, validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
    const { rows } = await query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
    if (!rows[0]) throw new ApiError(404, 'Enregistrement introuvable.');
    res.json(rows[0]);
  }));

  // Trace la modification dans audit_log, comme le font les routeurs métier "manuels"
  // (utilisateurs.js, notes.js, pointage.js, ...) — pour que le CRUD générique laisse
  // la même trace qu'un module écrit à la main (voir audit d'origine, §4.2).
  const tracer = (req, action, recordId, ancienneValeur, nouvelleValeur) => query(
    `INSERT INTO audit_log (utilisateur_id, agent_id, action, table_nom, record_id, ancienne_valeur, nouvelle_valeur)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      req.user?.type === 'utilisateur' ? req.user.id : null,
      req.user?.type === 'agent' ? req.user.id : null,
      action, table, recordId,
      ancienneValeur ? JSON.stringify(ancienneValeur) : null,
      nouvelleValeur ? JSON.stringify(nouvelleValeur) : null,
    ]
  ).catch(() => {}); // l'audit ne doit jamais faire échouer l'opération métier elle-même

  router.post('/', ...writeMiddleware, asyncHandler(async (req, res) => {
    const keys = columns.filter((c) => req.body[c] !== undefined);
    if (keys.length === 0) throw new ApiError(400, 'Aucune donnée fournie.');
    const values = keys.map((k) => req.body[k]);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    await tracer(req, 'creation', rows[0].id, null, rows[0]);
    res.status(201).json(rows[0]);
  }));

  router.put('/:id', ...writeMiddleware, validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
    const keys = columns.filter((c) => req.body[c] !== undefined);
    if (keys.length === 0) throw new ApiError(400, 'Aucune donnée fournie.');
    const { rows: avant } = await query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map((k) => req.body[k]);
    const { rows } = await query(
      `UPDATE ${table} SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Enregistrement introuvable.');
    await tracer(req, 'modification', rows[0].id, avant[0] || null, rows[0]);
    res.json(rows[0]);
  }));

  router.delete('/:id', ...writeMiddleware, validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
    const { rows: avant } = await query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
    const { rowCount } = await query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw new ApiError(404, 'Enregistrement introuvable.');
    await tracer(req, 'suppression', req.params.id, avant[0] || null, null);
    res.status(204).send();
  }));

  return router;
}

module.exports = { createCrudRouter };
