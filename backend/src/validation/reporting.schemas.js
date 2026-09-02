const { z, entierPositif } = require('./common');

// Filtres communs aux endpoints de reporting/lecture seule : tous optionnels, mais typés pour
// échouer proprement (400 clair) plutôt que de laisser un id non numérique remonter jusqu'à
// Postgres (erreur 22P02 générique) ou fausser silencieusement une requête SQL.
const dateFiltre = z.string().trim().min(8, 'date invalide.').optional();

const auditQuerySchema = z.object({
  table_nom: z.string().trim().max(100).optional(),
  action: z.string().trim().max(50).optional(),
  utilisateur_id: entierPositif({ requis: false }),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const notificationsAuditQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const dashboardQuerySchema = z.object({
  agent_id: entierPositif({ requis: false }),
  enseignant_id: entierPositif({ requis: false }),
});

const statistiquesQuerySchema = z.object({
  date_debut: dateFiltre,
  date_fin: dateFiltre,
  agent_id: entierPositif({ requis: false }),
  enseignant_id: entierPositif({ requis: false }),
});

const TYPES_HISTORIQUE = ['presence', 'presence_enseignant', 'absence_eleve', 'absence_enseignant', 'note', 'finance', 'discipline'];
const historiqueQuerySchema = z.object({
  type: z.union([z.enum(TYPES_HISTORIQUE), z.array(z.enum(TYPES_HISTORIQUE))]).optional(),
  eleve_id: entierPositif({ requis: false }),
  classe_id: entierPositif({ requis: false }),
  date_debut: dateFiltre,
  date_fin: dateFiltre,
  agent_id: entierPositif({ requis: false }),
  enseignant_id: entierPositif({ requis: false }),
});

module.exports = {
  auditQuerySchema,
  notificationsAuditQuerySchema,
  dashboardQuerySchema,
  statistiquesQuerySchema,
  historiqueQuerySchema,
};
