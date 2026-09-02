const express = require('express');
const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { statistiquesQuerySchema } = require('../validation/reporting.schemas');

const router = express.Router();

// Petit utilitaire : construit un WHERE + params à partir d'une liste de conditions "$N" déjà
// formées, en ajoutant en dernier la condition de scope (auteur = utilisateur connecté) si fournie.
function buildWhere(baseConds, baseParams, scopeColumnFn) {
  const conds = [...baseConds];
  const params = [...baseParams];
  if (scopeColumnFn) {
    params.push(scopeColumnFn.id);
    conds.push(`${scopeColumnFn.column} = $${params.length}`);
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

// GET /statistiques?date_debut=&date_fin= -> vue chiffrée transversale (présences, notes, finances, discipline)
// pour l'année scolaire active, filtrable par période.
// Admin -> statistiques globales de l'établissement (ou, avec ?enseignant_id=, celles d'un enseignant
// précis consulté depuis sa fiche — vue en lecture seule, /admin/enseignants/:id/espace).
// Agent (secretaire/economie/surveillant) -> uniquement ses propres chiffres (paiements qu'il a
// encaissés, incidents qu'il a lui-même enregistrés). Enseignant -> uniquement ses propres classes.
// Déterminé automatiquement depuis le login (req.user).
router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ query: statistiquesQuerySchema }), asyncHandler(async (req, res) => {
  const { date_debut, date_fin } = req.query;
  const isAdmin = req.user.role === 'admin';
  // Un admin peut aussi consulter les statistiques d'un agent précis (?agent_id=), en lecture
  // seule depuis sa fiche (/admin/comptes -> Profil), comme il le fait déjà pour un enseignant.
  const agentConsulte = isAdmin ? req.query.agent_id : null;
  const enseignantConsulte = isAdmin && !agentConsulte ? req.query.enseignant_id : null;
  const scope = agentConsulte
    ? { type: 'agent', id: agentConsulte }
    : enseignantConsulte
      ? { type: 'utilisateur', id: enseignantConsulte }
      : (isAdmin ? null : { type: req.user.type, id: req.user.id });
  // Un agent (secretaire/economie/surveillant) n'est jamais auteur de présences/notes.
  const presenceEtNotesApplicables = !scope || scope.type === 'utilisateur';
  const scopePresence = scope && presenceEtNotesApplicables ? { column: 'p.enseignant_id', id: scope.id } : null;
  const scopeNote = scope && presenceEtNotesApplicables ? { column: 'n.enseignant_id', id: scope.id } : null;
  // L'économie a déjà accès aux chiffres financiers de TOUTE l'école ailleurs dans l'appli
  // (Finances.jsx, Paie.jsx — cf. ROLES_FINANCE) : la limiter ici à « ce qu'elle a personnellement
  // encaissé » cachait justement les indicateurs (taux de recouvrement, frais impayés) les plus
  // utiles à son propre travail quotidien. On lui montre donc les finances globales de
  // l'établissement, comme à l'admin — mais seulement sur SA propre session (pas quand un admin
  // consulte la fiche d'un autre agent : là, on veut voir ce que CET agent a personnellement fait).
  const financesGlobales = isAdmin || (req.user.role === 'economie' && !agentConsulte && !enseignantConsulte);
  // Le secrétariat saisit désormais les notes de TOUTES les classes pour le compte des
  // enseignants (cf. Notes.jsx) : elle n'en est jamais « l'auteur » au sens enseignant_id, donc
  // presenceEtNotesApplicables (qui exige scope.type === 'utilisateur') la laissait sans aucune
  // moyenne à consulter ici. Même logique que financesGlobales pour l'économie : on lui montre
  // les moyennes de TOUTE l'école (scopeNote reste null pour elle, cf. ci-dessus), pas seulement
  // ce qu'un enseignant particulier aurait posé.
  const notesGlobales = isAdmin || (req.user.role === 'secretaire' && !agentConsulte && !enseignantConsulte);
  const notesApplicables = presenceEtNotesApplicables || notesGlobales;

  const anneeActive = await query(`SELECT id, libelle FROM annee_scolaire WHERE actif = TRUE LIMIT 1`);
  const anneeId = anneeActive.rows[0]?.id || null;

  const condsPresence = []; const paramsPresence = [];
  if (date_debut) { paramsPresence.push(date_debut); condsPresence.push(`date_pointage >= $${paramsPresence.length}`); }
  if (date_fin) { paramsPresence.push(date_fin); condsPresence.push(`date_pointage <= $${paramsPresence.length}`); }

  const condsDisc = []; const paramsDisc = [];
  if (date_debut) { paramsDisc.push(date_debut); condsDisc.push(`date_incident >= $${paramsDisc.length}`); }
  if (date_fin) { paramsDisc.push(date_fin); condsDisc.push(`date_incident <= $${paramsDisc.length}`); }
  const scopeDisc = scope ? { column: scope.type === 'agent' ? 'auteur_agent_id' : 'auteur_utilisateur_id', id: scope.id } : null;
  const { where: whereDisc, params: paramsDiscFinal } = buildWhere(condsDisc, paramsDisc, scopeDisc);

  // Déclarations d'absences (élèves/enseignants) sur la période — vision globale de
  // l'établissement (pas seulement « ce que j'ai personnellement déclaré ») : c'est un
  // indicateur de pilotage (taux de justification) utile au secrétariat et au surveillant, qui
  // gèrent désormais ce module de bout en bout, comme le recouvrement l'est pour l'économie.
  const condsAbsEleve = []; const paramsAbsEleve = [];
  if (date_debut) { paramsAbsEleve.push(date_debut); condsAbsEleve.push(`date_absence >= $${paramsAbsEleve.length}`); }
  if (date_fin) { paramsAbsEleve.push(date_fin); condsAbsEleve.push(`date_absence <= $${paramsAbsEleve.length}`); }
  const whereAbsEleve = condsAbsEleve.length ? `WHERE ${condsAbsEleve.join(' AND ')}` : '';
  const condsAbsEns = []; const paramsAbsEns = [];
  if (date_debut) { paramsAbsEns.push(date_debut); condsAbsEns.push(`date_absence >= $${paramsAbsEns.length}`); }
  if (date_fin) { paramsAbsEns.push(date_fin); condsAbsEns.push(`date_absence <= $${paramsAbsEns.length}`); }
  const whereAbsEns = condsAbsEns.length ? `WHERE ${condsAbsEns.join(' AND ')}` : '';


  // Évolution vs période précédente de même durée — seulement quand l'utilisateur a choisi une
  // période précise (Du/Au) : sur "toute la période" (pas de filtre), il n'y a pas de "précédent"
  // sensé à comparer, donc on ne calcule rien (le frontend masque alors les puces d'évolution).
  let periodePrecedente = null;
  if (date_debut && date_fin) {
    const debut = new Date(date_debut);
    const fin = new Date(date_fin);
    const dureeMs = Math.max(fin.getTime() - debut.getTime(), 0);
    const finPrec = new Date(debut.getTime() - 24 * 3600 * 1000);
    const debutPrec = new Date(finPrec.getTime() - dureeMs);
    periodePrecedente = { debut: debutPrec.toISOString().slice(0, 10), fin: finPrec.toISOString().slice(0, 10) };
  }

  const [
    presenceParClasse,
    presenceParStatut,
    moyenneParClasse,
    financesResume,
    depensesResume,
    disciplineParType,
    presenceTendance,
    gestionResume,
    presenceParStatutPrec,
    disciplinePrec,
    notesResume,
    absencesEleveResume,
    absencesEnseignantResume,
  ] = await Promise.all([
    presenceEtNotesApplicables
      ? (() => {
          const { where, params } = buildWhere(condsPresence.map((c) => `p.${c}`), paramsPresence, scopePresence);
          return query(
            `SELECT c.nom AS classe, ROUND(100.0 * SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) / COUNT(*), 1) AS taux_presence
             FROM pointage_eleve p JOIN classe c ON c.id = p.classe_id
             ${where} GROUP BY c.nom ORDER BY c.nom`,
            params
          );
        })()
      : Promise.resolve({ rows: [] }),
    presenceEtNotesApplicables
      ? (() => {
          const { where, params } = buildWhere(condsPresence.map((c) => `p.${c}`), paramsPresence, scopePresence);
          return query(
            `SELECT statut, COUNT(*) AS count FROM pointage_eleve p ${where} GROUP BY statut`,
            params
          );
        })()
      : Promise.resolve({ rows: [] }),
    notesApplicables
      ? (() => {
          const condsNote = anneeId ? ['n.annee_scolaire_id = $1'] : [];
          const paramsNote = anneeId ? [anneeId] : [];
          const { where, params } = buildWhere(condsNote, paramsNote, scopeNote);
          return query(
            // Pondéré par coefficient_evaluation, comme le calcul de bulletin (cf. bulletins.js) —
            // sinon cette moyenne de classe ne correspondrait pas à celle affichée sur les bulletins.
            `SELECT c.nom AS classe,
                    ROUND(SUM(n.note_valeur * n.coefficient_evaluation) / SUM(n.coefficient_evaluation), 2) AS moyenne
             FROM note n JOIN classe c ON c.id = n.classe_id
             ${where} GROUP BY c.nom ORDER BY c.nom`,
            params
          );
        })()
      : Promise.resolve({ rows: [] }),
    financesGlobales
      ? query(
          `SELECT
             COALESCE(SUM(f.montant_total), 0) AS total_attendu,
             COALESCE((SELECT SUM(montant) FROM paiement pa JOIN frais_scolaire f2 ON f2.id = pa.frais_id WHERE f2.annee_scolaire_id = $1), 0) AS total_paye,
             COUNT(*) FILTER (WHERE f.statut = 'impaye') AS nb_impaye
           FROM frais_scolaire f WHERE f.annee_scolaire_id = $1`,
          [anneeId]
        )
      : (() => {
          // Ce que CET agent/enseignant a lui-même encaissé sur la période (pas le total attendu de l'école).
          const condsFin = []; const paramsFin = [];
          if (date_debut) { paramsFin.push(date_debut); condsFin.push(`pa.date_paiement >= $${paramsFin.length}`); }
          if (date_fin) { paramsFin.push(date_fin); condsFin.push(`pa.date_paiement <= $${paramsFin.length}`); }
          const scopeFin = { column: scope.type === 'agent' ? 'pa.agent_id' : 'pa.utilisateur_id', id: scope.id };
          const { where, params } = buildWhere(condsFin, paramsFin, scopeFin);
          return query(
            `SELECT COALESCE(SUM(pa.montant), 0) AS total_paye, COUNT(*) AS nb_paiements
             FROM paiement pa ${where}`,
            params
          );
        })(),
    // Dépenses de l'école sur la période — n'a de sens qu'avec une vue financière globale
    // (l'économie, ou l'admin) ; sinon on ne surcharge pas le tableau de bord d'un enseignant.
    financesGlobales
      ? (() => {
          const condsDep = []; const paramsDep = [];
          if (date_debut) { paramsDep.push(date_debut); condsDep.push(`date_depense >= $${paramsDep.length}`); }
          if (date_fin) { paramsDep.push(date_fin); condsDep.push(`date_depense <= $${paramsDep.length}`); }
          const where = condsDep.length ? `WHERE ${condsDep.join(' AND ')}` : '';
          return query(`SELECT COALESCE(SUM(montant), 0) AS total_depenses, COUNT(*) AS nb_depenses FROM depense ${where}`, paramsDep);
        })()
      : Promise.resolve({ rows: [{ total_depenses: 0, nb_depenses: 0 }] }),
    query(
      `SELECT type_incident, gravite, COUNT(*) AS count FROM discipline
       ${whereDisc} GROUP BY type_incident, gravite ORDER BY count DESC`,
      paramsDiscFinal
    ),
    presenceEtNotesApplicables
      ? (() => {
          const scopeTendance = scope ? { column: 'enseignant_id', id: scope.id } : null;
          const { where, params } = buildWhere(["date_pointage >= CURRENT_DATE - INTERVAL '30 days'"], [], scopeTendance);
          return query(
            `SELECT date_pointage AS date, ROUND(100.0 * SUM(CASE WHEN statut = 'present' THEN 1 ELSE 0 END) / COUNT(*), 1) AS taux_presence
             FROM pointage_eleve
             ${where} GROUP BY date_pointage ORDER BY date_pointage`,
            params
          );
        })()
      : Promise.resolve({ rows: [] }),
    // Vue "gestion" (nombre de classes / matières actives / cours planifiés à l'EDT) sur l'année
    // active : utile à l'admin et surtout au surveillant, qui gère désormais ces 3 modules mais
    // n'avait jusqu'ici aucun chiffre de synthèse sur son propre travail dans cette page.
    anneeId
      ? query(
          `SELECT
             (SELECT COUNT(*) FROM classe WHERE annee_scolaire_id = $1) AS nb_classes,
             (SELECT COUNT(*) FROM matiere WHERE actif = TRUE) AS nb_matieres,
             (SELECT COUNT(*) FROM emploi_du_temps WHERE annee_scolaire_id = $1 AND actif = TRUE) AS nb_cours`,
          [anneeId]
        )
      : Promise.resolve({ rows: [{ nb_classes: 0, nb_matieres: 0, nb_cours: 0 }] }),
    // Période précédente (même durée, immédiatement avant) pour les puces d'évolution ▲/▼.
    periodePrecedente
      ? (() => {
          const condsPresPrec = ['p.date_pointage >= $1', 'p.date_pointage <= $2'];
          const paramsPresPrec = [periodePrecedente.debut, periodePrecedente.fin];
          if (!presenceEtNotesApplicables) return Promise.resolve({ rows: [] });
          const { where, params } = buildWhere(condsPresPrec, paramsPresPrec, scopePresence);
          return query(`SELECT statut, COUNT(*) AS count FROM pointage_eleve p ${where} GROUP BY statut`, params);
        })()
      : Promise.resolve({ rows: [] }),
    periodePrecedente
      ? (() => {
          const condsDiscPrec = ['date_incident >= $1', 'date_incident <= $2'];
          const { where, params } = buildWhere(condsDiscPrec, [periodePrecedente.debut, periodePrecedente.fin], scopeDisc);
          return query(`SELECT COUNT(*) AS count FROM discipline ${where}`, params);
        })()
      : Promise.resolve({ rows: [{ count: 0 }] }),
    // Résumé notes (total saisi / moyenne générale / en difficulté <10) — même portée que
    // moyenneParClasse ci-dessus (globale pour le secrétariat, propre à l'enseignant sinon).
    notesApplicables
      ? (() => {
          const condsNote = anneeId ? ['n.annee_scolaire_id = $1'] : [];
          const paramsNote = anneeId ? [anneeId] : [];
          const { where, params } = buildWhere(condsNote, paramsNote, scopeNote);
          return query(
            `SELECT COUNT(*) AS total_notes,
                    ROUND(SUM(n.note_valeur * n.coefficient_evaluation) / NULLIF(SUM(n.coefficient_evaluation), 0), 2) AS moyenne_generale,
                    COUNT(*) FILTER (WHERE n.note_valeur < 10) AS en_difficulte
             FROM note n ${where}`,
            params
          );
        })()
      : Promise.resolve({ rows: [{ total_notes: 0, moyenne_generale: null, en_difficulte: 0 }] }),
    query(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE justifiee) AS justifiees FROM absence_eleve ${whereAbsEleve}`,
      paramsAbsEleve
    ),
    query(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE justifiee) AS justifiees FROM absence_enseignant ${whereAbsEns}`,
      paramsAbsEns
    ),
  ]);

  // Calcul des deltas d'évolution (période choisie vs période précédente de même durée).
  // null tant qu'aucune période précise n'est sélectionnée (pas de "précédent" sensé sur "tout").
  let evolution = null;
  if (periodePrecedente) {
    const tauxPresence = (rows) => {
      const total = rows.reduce((s, r) => s + Number(r.count), 0);
      const present = rows.find((r) => r.statut === 'present')?.count || 0;
      return total > 0 ? Math.round((present / total) * 100) : null;
    };
    evolution = { periode_precedente: periodePrecedente };
    if (presenceEtNotesApplicables) {
      const actuel = tauxPresence(presenceParStatut.rows);
      const precedent = tauxPresence(presenceParStatutPrec.rows);
      evolution.presence = (actuel === null || precedent === null) ? null : { actuel, precedent, delta: actuel - precedent };
    }
    const incidentsActuel = disciplineParType.rows.reduce((s, r) => s + Number(r.count), 0);
    const incidentsPrecedent = Number(disciplinePrec.rows[0]?.count || 0);
    evolution.incidents = { actuel: incidentsActuel, precedent: incidentsPrecedent, delta: incidentsActuel - incidentsPrecedent };
  }

  res.json({
    scope: scope ? 'agent' : 'admin',
    role: req.user.role,
    finances_globales: financesGlobales,
    notes_globales: notesGlobales,
    annee_scolaire: anneeActive.rows[0] || null,
    presence_par_classe: presenceParClasse.rows,
    presence_par_statut: presenceParStatut.rows,
    moyenne_par_classe: moyenneParClasse.rows,
    finances: {
      ...(financesResume.rows[0] || { total_attendu: 0, total_paye: 0, nb_impaye: 0 }),
      ...(depensesResume.rows[0] || { total_depenses: 0, nb_depenses: 0 }),
    },
    notes: notesResume.rows[0] || { total_notes: 0, moyenne_generale: null, en_difficulte: 0 },
    absences: {
      eleves: absencesEleveResume.rows[0] || { total: 0, justifiees: 0 },
      enseignants: absencesEnseignantResume.rows[0] || { total: 0, justifiees: 0 },
    },
    discipline_par_type: disciplineParType.rows,
    presence_tendance_30j: presenceTendance.rows,
    gestion: gestionResume.rows[0] || { nb_classes: 0, nb_matieres: 0, nb_cours: 0 },
    evolution,
  });
}));

module.exports = router;
