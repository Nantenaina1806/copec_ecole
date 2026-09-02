const express = require('express');
const { pool, query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, invalidatePermissionCache } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, authorize('admin'));

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT p.id,p.code,p.libelle,p.module,COALESCE(array_agg(rp.role ORDER BY rp.role) FILTER (WHERE rp.role IS NOT NULL), '{}') AS roles
    FROM permission p LEFT JOIN role_permission rp ON rp.permission_id=p.id GROUP BY p.id ORDER BY p.module,p.code`);
  res.json(rows);
}));

router.put('/role/:role', asyncHandler(async (req, res) => {
  const role = String(req.params.role || '').trim();
  const roles = ['admin','enseignant','secretaire','economie','surveillant','accueil'];
  if (!roles.includes(role)) throw new ApiError(400, 'Rôle invalide.');
  if (!Array.isArray(req.body.permissions)) throw new ApiError(400, 'permissions doit être un tableau.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM role_permission WHERE role=$1', [role]);
    if (req.body.permissions.length) {
      await client.query(`INSERT INTO role_permission(role,permission_id) SELECT $1,id FROM permission WHERE code = ANY($2::text[])`, [role, req.body.permissions]);
    }
    await client.query('COMMIT'); invalidatePermissionCache();
    res.json({ role, permissions: req.body.permissions });
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}));
module.exports = router;
