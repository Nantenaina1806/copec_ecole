const express = require('express');
const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const STAFF = ['admin','enseignant','secretaire','economie','surveillant','accueil'];

router.get('/', authenticate, authorize(...STAFF), asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
  const out = [];

  // Le moteur global ne cherche que dans les données auxquelles le rôle peut accéder.
  const { rows: eleves } = await query(`
    SELECT e.id, e.nom, e.prenom, e.matricule, 'eleve' AS type, '/admin/eleves/' || e.id AS href
    FROM eleve e
    WHERE e.actif=TRUE AND (e.nom ILIKE $1 ESCAPE '\\' OR e.prenom ILIKE $1 ESCAPE '\\' OR e.matricule ILIKE $1 ESCAPE '\\')
    ORDER BY e.nom, e.prenom LIMIT 10`, [like]);
  out.push(...eleves);

  const { rows: classes } = await query(`
    SELECT c.id, c.nom, n.nom AS niveau_nom, 'classe' AS type, '/admin/classes/' || c.id AS href
    FROM classe c LEFT JOIN niveau n ON n.id=c.niveau_id
    WHERE c.nom ILIKE $1 ESCAPE '\\' OR COALESCE(n.nom,'') ILIKE $1 ESCAPE '\\'
    ORDER BY c.nom LIMIT 8`, [like]);
  out.push(...classes);

  if (req.user.role === 'admin') {
    const { rows: enseignants } = await query(`
      SELECT u.id, u.nom, u.prenom, u.email, u.role AS type, '/admin/enseignants/' || u.id || '/espace' AS href
      FROM utilisateur u
      WHERE u.actif=TRUE AND (u.nom ILIKE $1 ESCAPE '\\' OR u.prenom ILIKE $1 ESCAPE '\\' OR u.email ILIKE $1 ESCAPE '\\')
      ORDER BY u.nom, u.prenom LIMIT 8`, [like]);
    out.push(...enseignants);

    const { rows: agents } = await query(`
      SELECT a.id, a.nom, a.prenom, a.email, a.role_agent AS role, 'agent' AS type, '/admin/agents/' || a.id || '/espace' AS href
      FROM agent a
      WHERE a.actif=TRUE AND (a.nom ILIKE $1 ESCAPE '\\' OR a.prenom ILIKE $1 ESCAPE '\\' OR a.email ILIKE $1 ESCAPE '\\')
      ORDER BY a.nom, a.prenom LIMIT 8`, [like]);
    out.push(...agents);
  }

  if (['admin','secretaire'].includes(req.user.role)) {
    const { rows: parents } = await query(`
      SELECT p.id, p.nom, p.prenom, p.email, 'parent' AS type, '/admin/parents?parent_id=' || p.id AS href
      FROM parent p
      WHERE p.nom ILIKE $1 ESCAPE '\\' OR p.prenom ILIKE $1 ESCAPE '\\' OR COALESCE(p.email,'') ILIKE $1 ESCAPE '\\'
      ORDER BY p.nom, p.prenom LIMIT 8`, [like]);
    out.push(...parents);
  }

  if (['admin','economie'].includes(req.user.role)) {
    const { rows: paiements } = await query(`
      SELECT p.id, p.recu_numero, p.montant, e.nom, e.prenom, 'paiement' AS type, '/admin/finances?paiement_id=' || p.id AS href
      FROM paiement p JOIN eleve e ON e.id=p.eleve_id
      WHERE p.recu_numero ILIKE $1 ESCAPE '\\' OR e.nom ILIKE $1 ESCAPE '\\' OR e.prenom ILIKE $1 ESCAPE '\\'
      ORDER BY p.created_at DESC LIMIT 8`, [like]);
    out.push(...paiements);
  }

  if (['admin','secretaire','enseignant'].includes(req.user.role)) {
    const { rows: notes } = await query(`
      SELECT n.id, e.nom, e.prenom, m.nom AS matiere_nom, n.note_valeur, 'note' AS type, '/admin/notes?eleve_id=' || e.id AS href
      FROM note n JOIN eleve e ON e.id=n.eleve_id JOIN matiere m ON m.id=n.matiere_id
      WHERE e.nom ILIKE $1 ESCAPE '\\' OR e.prenom ILIKE $1 ESCAPE '\\' OR m.nom ILIKE $1 ESCAPE '\\'
      ORDER BY n.created_at DESC LIMIT 8`, [like]);
    out.push(...notes);
  }

  // Tri global : résultats textuels pertinents d'abord, puis limitation pour garder le menu rapide.
  const normalized = out.map((x) => ({
    ...x,
    label: x.type === 'paiement'
      ? `${x.recu_numero || 'Paiement'} · ${x.prenom || ''} ${x.nom || ''}`.trim()
      : x.type === 'classe'
        ? `${x.nom}${x.niveau_nom ? ` · ${x.niveau_nom}` : ''}`
        : `${x.prenom || ''} ${x.nom || x.email || ''}`.trim(),
  }));
  res.json(normalized.slice(0, 40));
}));
module.exports = router;
