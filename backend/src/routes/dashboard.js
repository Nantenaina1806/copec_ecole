const express = require('express');
const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { dashboardQuerySchema } = require('../validation/reporting.schemas');

const router = express.Router();

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ query: dashboardQuerySchema }), asyncHandler(async (req, res) => {
  const { rows: annee } = await query('SELECT * FROM annee_scolaire WHERE actif = TRUE');
  const anneeId = annee[0]?.id || 0;
  const isAdmin = req.user.role === 'admin';
  // Un admin peut consulter le tableau de bord personnel d'un agent (?agent_id=) ou d'un
  // enseignant (?enseignant_id=) précis, en lecture seule, depuis sa fiche (/admin/comptes ->
  // Profil), de la même façon que /admin/enseignants/:id/espace le fait déjà.
  const agentConsulte = isAdmin ? req.query.agent_id : null;
  const enseignantConsulte = isAdmin && !agentConsulte ? req.query.enseignant_id : null;
  const scope = agentConsulte
    ? { type: 'agent', id: agentConsulte }
    : enseignantConsulte
      ? { type: 'utilisateur', id: enseignantConsulte }
      : (isAdmin ? null : { type: req.user.type, id: req.user.id });
  // Vue globale admin (chiffres de tout l'établissement) : uniquement quand l'admin consulte
  // son propre tableau de bord, pas quand il consulte celui d'un agent/enseignant précis.
  const isAdminGlobalView = isAdmin && !scope;
  // L'économie voit déjà les finances de toute l'école ailleurs dans l'appli (Finances.jsx,
  // Statistiques.jsx) : le classement des élèves les plus endettés — exactement ce qu'elle doit
  // relancer au quotidien — lui était pourtant caché ici, réservé à l'admin. `agentConsulte` étant
  // toujours null pour un non-admin, cette extension ne s'applique qu'à la propre session de
  // l'économie, jamais à une fiche consultée par un admin.
  const financesGlobales = isAdminGlobalView || req.user.role === 'economie';
  // Le surveillant voit déjà tous les incidents (GET /vie-scolaire/discipline n'est pas filtré
  // par auteur) et valide désormais les pointages enseignants (cf. authorize('admin','surveillant')
  // sur /pointage/enseignant/a-valider) : ces deux vues globales lui sont donc utiles au tableau
  // de bord, comme pour l'admin.
  const voitIncidentsGlobaux = isAdminGlobalView || req.user.role === 'surveillant';
  const voitPointagesAValider = isAdminGlobalView || req.user.role === 'surveillant';
  // Le secrétariat inscrit les élèves mais ne les affecte pas toujours à une classe dans la
  // foulée (dossier incomplet, attente de paiement, etc.) : lui signaler ces dossiers en attente
  // ici lui évite de les chercher manuellement dans la liste complète des élèves.
  const voitElevesNonInscrits = isAdminGlobalView || req.user.role === 'secretaire';

  const [eleves, classes, enseignants, agentsActifs, effectifParClasse, finances, presenceAujourdhui, presenceEnseignants7j, presenceEleves7j, elevesImpayes, incidentsRecents, elevesNonInscrits, dernieresActualites, mesActivites, pointagesAValider] = await Promise.all([
    query(`SELECT COUNT(*) FROM eleve WHERE actif = TRUE`),
    query(`SELECT COUNT(*) FROM classe WHERE annee_scolaire_id = $1`, [anneeId]),
    query(`SELECT COUNT(*) FROM utilisateur WHERE role = 'enseignant' AND actif = TRUE`),
    query(`SELECT COUNT(*) FROM agent WHERE actif = TRUE`),
    query(
      `SELECT c.nom, COUNT(i.id) AS effectif FROM classe c
       LEFT JOIN inscription i ON i.classe_id = c.id AND i.statut = 'inscrit'
       WHERE c.annee_scolaire_id = $1 GROUP BY c.nom ORDER BY c.nom`,
      [anneeId]
    ),
    query(
      `SELECT COALESCE(SUM(montant_total),0) AS total_attendu,
              COALESCE(SUM(CASE WHEN statut='paye' THEN montant_total ELSE 0 END),0) AS total_paye
       FROM frais_scolaire WHERE annee_scolaire_id = $1`,
      [anneeId]
    ),
    query(
      `SELECT statut, COUNT(*) FROM pointage_eleve WHERE date_pointage = CURRENT_DATE GROUP BY statut`
    ),
    query(`
      SELECT d::date AS date,
             COALESCE(SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END), 0)::int AS present,
             COALESCE(SUM(CASE WHEN p.statut = 'absent' THEN 1 ELSE 0 END), 0)::int AS absent,
             COALESCE(SUM(CASE WHEN p.statut = 'retard' THEN 1 ELSE 0 END), 0)::int AS retard
      FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') d
      LEFT JOIN pointage_enseignant p ON p.date_pointage = d::date
      LEFT JOIN emploi_du_temps e ON e.id = p.emploi_du_temps_id AND e.annee_scolaire_id = $1
      WHERE p.id IS NULL OR e.id IS NOT NULL
      GROUP BY d::date ORDER BY d::date
    `, [anneeId]),
    query(`
      SELECT d::date AS date,
             COALESCE(SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END), 0)::int AS present,
             COALESCE(SUM(CASE WHEN p.statut = 'absent' THEN 1 ELSE 0 END), 0)::int AS absent,
             COALESCE(SUM(CASE WHEN p.statut = 'retard' THEN 1 ELSE 0 END), 0)::int AS retard
      FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') d
      LEFT JOIN pointage_eleve p ON p.date_pointage = d::date AND p.annee_scolaire_id = $1
      GROUP BY d::date ORDER BY d::date
    `, [anneeId]),
    // Top 5 des élèves ayant le plus grand solde impayé (frais dus - paiements reçus) sur l'année active.
    financesGlobales
      ? query(
          `SELECT e.id, e.nom, e.prenom, e.matricule,
                  SUM(f.montant_total) - COALESCE(p.total_paye, 0) AS solde_du
           FROM frais_scolaire f
           JOIN eleve e ON e.id = f.eleve_id
           LEFT JOIN (
             SELECT frais_id, SUM(montant) AS total_paye FROM paiement GROUP BY frais_id
           ) p ON p.frais_id = f.id
           WHERE f.annee_scolaire_id = $1 AND f.statut != 'annule'
           GROUP BY e.id, e.nom, e.prenom, e.matricule, p.total_paye
           HAVING SUM(f.montant_total) - COALESCE(p.total_paye, 0) > 0
           ORDER BY solde_du DESC LIMIT 5`,
          [anneeId]
        )
      : Promise.resolve({ rows: [] }),
    // 5 derniers incidents de discipline, tous auteurs confondus (admin ou surveillant).
    voitIncidentsGlobaux
      ? query(
          `SELECT d.id, d.date_incident, d.type_incident, d.gravite, e.nom, e.prenom
           FROM discipline d JOIN eleve e ON e.id = d.eleve_id
           ORDER BY d.date_incident DESC, d.id DESC LIMIT 5`
        )
      : Promise.resolve({ rows: [] }),
    // 5 élèves actifs sans inscription sur l'année active (fiche créée mais pas encore
    // affectée à une classe) : ce sont exactement les dossiers que le secrétariat doit finaliser.
    voitElevesNonInscrits
      ? query(
          `SELECT e.id, e.nom, e.prenom, e.matricule
           FROM eleve e
           LEFT JOIN inscription i ON i.eleve_id = e.id AND i.annee_scolaire_id = $1
           WHERE e.actif = TRUE AND i.id IS NULL
           ORDER BY e.created_at DESC LIMIT 5`,
          [anneeId]
        )
      : Promise.resolve({ rows: [] }),
    query(`SELECT id, titre, created_at FROM actualite WHERE publie = TRUE ORDER BY created_at DESC LIMIT 5`),
    // Récapitulatif personnel : ce que CET agent/enseignant a lui-même fait, selon son login (req.user).
    // Non pertinent pour l'admin (vue déjà globale ci-dessus).
    scope
      ? query(
          `SELECT
             COALESCE((SELECT SUM(montant) FROM paiement
               WHERE date_paiement = CURRENT_DATE
               AND ${scope.type === 'agent' ? 'agent_id' : 'utilisateur_id'} = $1), 0) AS paiements_encaisses_aujourdhui,
             COALESCE((SELECT COUNT(*) FROM paiement
               WHERE date_paiement = CURRENT_DATE
               AND ${scope.type === 'agent' ? 'agent_id' : 'utilisateur_id'} = $1), 0) AS nb_paiements_aujourdhui,
             COALESCE((SELECT COUNT(*) FROM discipline
               WHERE date_incident >= CURRENT_DATE - INTERVAL '7 days'
               AND ${scope.type === 'agent' ? 'auteur_agent_id' : 'auteur_utilisateur_id'} = $1), 0) AS incidents_signales_semaine,
             -- Certificats/attestations émis par CET agent (ou utilisateur) cette semaine :
             -- indicateur d'activité propre au secrétariat (certificat_scolarite a les deux colonnes).
             COALESCE((SELECT COUNT(*) FROM certificat_scolarite
               WHERE date_emission >= CURRENT_DATE - INTERVAL '7 days'
               AND ${scope.type === 'agent' ? 'agent_id' : 'utilisateur_id'} = $1), 0) AS certificats_emis_semaine,
             -- Nouvelles inscriptions cette semaine, tous auteurs confondus (la table inscription
             -- ne trace pas qui l'a saisie) : utile au secrétariat comme indicateur d'activité
             -- du guichet, pas seulement à titre personnel.
             COALESCE((SELECT COUNT(*) FROM inscription
               WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'), 0) AS nouvelles_inscriptions_semaine
             ${scope.type === 'utilisateur' ? `,
             COALESCE((SELECT COUNT(*) FROM pointage_eleve
               WHERE date_pointage = CURRENT_DATE AND enseignant_id = $1), 0) AS appels_faits_aujourdhui` : ''}
          `,
          [scope.id]
        )
      : Promise.resolve({ rows: [null] }),
    // Nombre de pointages enseignants en attente d'arbitrage (admin ou surveillant, cf. plus haut).
    voitPointagesAValider
      ? query(`SELECT COUNT(*) FROM pointage_enseignant WHERE statut_validation = 'en_attente_validation'`)
      : Promise.resolve({ rows: [{ count: 0 }] }),
  ]);

  res.json({
    scope: isAdminGlobalView ? 'admin' : 'agent',
    finances_eleves_impayes_globales: financesGlobales,
    annee_scolaire: annee[0] || null,
    total_eleves: Number(eleves.rows[0].count),
    total_classes: Number(classes.rows[0].count),
    total_enseignants: Number(enseignants.rows[0].count),
    total_agents: Number(agentsActifs.rows[0].count),
    effectif_par_classe: effectifParClasse.rows,
    finances: finances.rows[0],
    presence_aujourdhui: presenceAujourdhui.rows,
    presence_enseignants_7j: presenceEnseignants7j.rows,
    presence_eleves_7j: presenceEleves7j.rows,
    eleves_impayes: elevesImpayes.rows,
    incidents_recents: incidentsRecents.rows,
    eleves_non_inscrits: elevesNonInscrits.rows,
    dernieres_actualites: dernieresActualites.rows,
    mes_activites: mesActivites.rows[0] || null,
    pointages_a_valider: Number(pointagesAValider.rows[0].count),
  });
}));

module.exports = router;
