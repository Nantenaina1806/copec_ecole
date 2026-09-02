const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_ADMIN_AGENT } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { auditQuerySchema, notificationsAuditQuerySchema } = require('../validation/reporting.schemas');

const router = express.Router();

// GET /audit/notifications -> fil d'activité résumé (appels faits, nouvelles inscriptions…)
// pour la cloche de notification du tableau de bord. Distinct du journal d'audit brut ci-dessous
// (accès admin + agents, pas seulement admin, et messages déjà mis en forme pour l'UI).
router.get('/notifications', authenticate, authorize(...ROLES_ADMIN_AGENT), validate({ query: notificationsAuditQuerySchema }), asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const { rows } = await query(
    `SELECT * FROM (
       (SELECT al.id, 'appel' AS type,
               al.record_id AS target_id,
               'Appel effectué pour ' || c.nom
                 || CASE WHEN m.nom IS NOT NULL THEN ' (' || m.nom || ')' ELSE '' END
                 || ' — ' || COALESCE((al.nouvelle_valeur->>'nb_eleves') || ' élève(s)', '') AS message,
               al.date_action,
               COALESCE(u.prenom || ' ' || u.nom, a.prenom || ' ' || a.nom, 'Système') AS acteur
        FROM audit_log al
        JOIN emploi_du_temps edt ON edt.id = al.record_id
        JOIN classe c ON c.id = edt.classe_id
        LEFT JOIN matiere m ON m.id = edt.matiere_id
        LEFT JOIN utilisateur u ON u.id = al.utilisateur_id
        LEFT JOIN agent a ON a.id = al.agent_id
        WHERE al.table_nom = 'pointage_eleve' AND al.action = 'creation')
       UNION ALL
       (SELECT al.id, 'inscription' AS type,
               i.eleve_id AS target_id,
               'Nouvel élève inscrit : ' || e.prenom || ' ' || e.nom || ' — ' || c2.nom AS message,
               al.date_action,
               COALESCE(u.prenom || ' ' || u.nom, a.prenom || ' ' || a.nom, 'Système') AS acteur
        FROM audit_log al
        JOIN inscription i ON i.id = al.record_id
        JOIN eleve e ON e.id = i.eleve_id
        JOIN classe c2 ON c2.id = i.classe_id
        LEFT JOIN utilisateur u ON u.id = al.utilisateur_id
        LEFT JOIN agent a ON a.id = al.agent_id
        WHERE al.table_nom = 'inscription' AND al.action = 'creation')
       UNION ALL
       (SELECT n.id, 'note' AS type,
               n.eleve_id AS target_id,
               'Note ajoutée — ' || e.nom || ' ' || e.prenom || ' : ' || m.nom || ' (' || n.note_valeur || '/20)' AS message,
               n.created_at AS date_action,
               COALESCE(u.prenom || ' ' || u.nom, 'Système') AS acteur
        FROM note n
        JOIN eleve e ON e.id = n.eleve_id
        JOIN matiere m ON m.id = n.matiere_id
        LEFT JOIN utilisateur u ON u.id = n.enseignant_id)
       UNION ALL
       (SELECT p.id, 'finance' AS type,
               p.eleve_id AS target_id,
               'Paiement enregistré — ' || e.nom || ' ' || e.prenom || ' : ' || p.montant || ' Ar' AS message,
               p.created_at AS date_action,
               COALESCE(u.prenom || ' ' || u.nom, a.prenom || ' ' || a.nom, 'Système') AS acteur
        FROM paiement p
        JOIN eleve e ON e.id = p.eleve_id
        LEFT JOIN utilisateur u ON u.id = p.utilisateur_id
        LEFT JOIN agent a ON a.id = p.agent_id)
       UNION ALL
       (SELECT d.id, 'discipline' AS type,
               d.eleve_id AS target_id,
               'Incident discipline — ' || e.nom || ' ' || e.prenom || ' : ' || d.type_incident AS message,
               d.created_at AS date_action,
               COALESCE(u.prenom || ' ' || u.nom, a.prenom || ' ' || a.nom, 'Système') AS acteur
        FROM discipline d
        JOIN eleve e ON e.id = d.eleve_id
        LEFT JOIN utilisateur u ON u.id = d.auteur_utilisateur_id
        LEFT JOIN agent a ON a.id = d.auteur_agent_id)
     ) fil
     ORDER BY date_action DESC
     LIMIT $1`,
    [limit]
  );
  res.json(rows);
}));

// Journal d'audit -> lecture seule, admin uniquement (XLIV : traçabilité)
router.get('/', authenticate, authorize('admin'), validate({ query: auditQuerySchema }), asyncHandler(async (req, res) => {
  const { table_nom, action, utilisateur_id, limit } = req.query;
  const conditions = []; const params = [];
  if (table_nom) { params.push(table_nom); conditions.push(`table_nom = $${params.length}`); }
  if (action) { params.push(action); conditions.push(`action = $${params.length}`); }
  if (utilisateur_id) { params.push(utilisateur_id); conditions.push(`utilisateur_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Number(limit) || 100, 500));
  const { rows } = await query(
    `SELECT al.*, u.nom AS utilisateur_nom, a.nom AS agent_nom
     FROM audit_log al
     LEFT JOIN utilisateur u ON u.id = al.utilisateur_id
     LEFT JOIN agent a ON a.id = al.agent_id
     ${where} ORDER BY al.date_action DESC LIMIT $${params.length}`,
    params
  );
  res.json(rows);
}));

module.exports = router;
