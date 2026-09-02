const express = require('express');
const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { historiqueQuerySchema } = require('../validation/reporting.schemas');

const router = express.Router();

// Chaque domaine expose une fonction qui retourne des lignes déjà normalisées :
// { id, type, date, eleve_nom, eleve_prenom, titre, detail, auteur }

// `scope` = { type: 'utilisateur'|'agent', id } quand l'utilisateur connecté n'est pas admin :
// chaque fetcher ne renvoie alors que ce que CETTE personne a elle-même produit (auteur = elle),
// et renvoie [] sans requêter si le type de scope ne correspond à aucune colonne "auteur" du domaine.

async function fetchPresences({ eleve_id, classe_id, date_debut, date_fin, scope }) {
  // Les élèves sont pointés soit par leur enseignant (p.enseignant_id = le prof du cours, cf.
  // emploi_du_temps), soit par un agent qui a fait l'appel à sa place — seul le surveillant a
  // le droit de le faire (POST /pointage/appel, authorize('enseignant','admin','surveillant')),
  // d'où p.agent_id. On ne calcule cette section que pour un scope qui peut produire l'un des deux.
  if (scope && scope.type !== 'utilisateur' && scope.type !== 'agent') return [];
  const conditions = []; const params = [];
  if (eleve_id) { params.push(eleve_id); conditions.push(`p.eleve_id = $${params.length}`); }
  if (classe_id) { params.push(classe_id); conditions.push(`p.classe_id = $${params.length}`); }
  if (date_debut) { params.push(date_debut); conditions.push(`p.date_pointage >= $${params.length}`); }
  if (date_fin) { params.push(date_fin); conditions.push(`p.date_pointage <= $${params.length}`); }
  if (scope) {
    params.push(scope.id);
    conditions.push(scope.type === 'agent' ? `p.agent_id = $${params.length}` : `p.enseignant_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT p.id, p.date_pointage AS date, p.statut, e.nom AS eleve_nom, e.prenom AS eleve_prenom,
            c.nom AS classe_nom, COALESCE(a.nom, u.nom) AS auteur_nom, COALESCE(a.prenom, u.prenom) AS auteur_prenom
     FROM pointage_eleve p
     JOIN eleve e ON e.id = p.eleve_id
     JOIN classe c ON c.id = p.classe_id
     LEFT JOIN utilisateur u ON u.id = p.enseignant_id
     LEFT JOIN agent a ON a.id = p.agent_id
     ${where} ORDER BY p.date_pointage DESC, p.id DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({
    id: `presence-${r.id}`,
    type: 'presence',
    date: r.date,
    eleve_nom: r.eleve_nom,
    eleve_prenom: r.eleve_prenom,
    titre: `Présence — ${r.statut}`,
    detail: r.classe_nom,
    auteur: r.auteur_nom ? `${r.auteur_prenom || ''} ${r.auteur_nom}`.trim() : null,
  }));
}

async function fetchNotes({ eleve_id, classe_id, date_debut, date_fin, scope }) {
  if (scope && scope.type !== 'utilisateur') return []; // seuls les enseignants posent des notes
  const conditions = []; const params = [];
  if (eleve_id) { params.push(eleve_id); conditions.push(`n.eleve_id = $${params.length}`); }
  if (classe_id) { params.push(classe_id); conditions.push(`n.classe_id = $${params.length}`); }
  if (date_debut) { params.push(date_debut); conditions.push(`n.created_at >= $${params.length}`); }
  if (date_fin) { params.push(date_fin); conditions.push(`n.created_at <= $${params.length}`); }
  if (scope) { params.push(scope.id); conditions.push(`n.enseignant_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT n.id, n.created_at AS date, n.note_valeur, n.type_evaluation, e.nom AS eleve_nom, e.prenom AS eleve_prenom,
            m.nom AS matiere_nom, u.nom AS auteur_nom, u.prenom AS auteur_prenom
     FROM note n
     JOIN eleve e ON e.id = n.eleve_id
     JOIN matiere m ON m.id = n.matiere_id
     LEFT JOIN utilisateur u ON u.id = n.enseignant_id
     ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({
    id: `note-${r.id}`,
    type: 'note',
    date: r.date,
    eleve_nom: r.eleve_nom,
    eleve_prenom: r.eleve_prenom,
    titre: `Note — ${r.matiere_nom} (${Number(r.note_valeur)}/20)`,
    detail: r.type_evaluation,
    auteur: r.auteur_nom ? `${r.auteur_prenom || ''} ${r.auteur_nom}`.trim() : null,
  }));
}

// Historique financier de l'économie : encaissements (paiements des élèves) ET décaissements
// (dépenses de l'établissement) — les deux relèvent du même rôle 'economie' au quotidien.
// Les dépenses n'étant jamais liées à un élève, on ne les inclut pas quand un filtre eleve_id
// est actif (ce filtre n'aurait alors aucun sens pour elles) ; la colonne « Élève » du tableau
// affiche déjà '—' pour les lignes sans élève (cf. fetchDiscipline/fetchPresences existants).
async function fetchPaiements({ eleve_id, date_debut, date_fin, scope }) {
  const conditions = []; const params = [];
  if (eleve_id) { params.push(eleve_id); conditions.push(`p.eleve_id = $${params.length}`); }
  if (date_debut) { params.push(date_debut); conditions.push(`p.date_paiement >= $${params.length}`); }
  if (date_fin) { params.push(date_fin); conditions.push(`p.date_paiement <= $${params.length}`); }
  if (scope) {
    params.push(scope.id);
    conditions.push(scope.type === 'agent' ? `p.agent_id = $${params.length}` : `p.utilisateur_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT p.id, p.date_paiement AS date, p.montant, p.mode_paiement, e.nom AS eleve_nom, e.prenom AS eleve_prenom,
            COALESCE(u.nom, a.nom) AS auteur_nom, COALESCE(u.prenom, a.prenom) AS auteur_prenom
     FROM paiement p
     JOIN eleve e ON e.id = p.eleve_id
     LEFT JOIN utilisateur u ON u.id = p.utilisateur_id
     LEFT JOIN agent a ON a.id = p.agent_id
     ${where} ORDER BY p.date_paiement DESC, p.id DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({
    id: `paiement-${r.id}`,
    type: 'finance',
    date: r.date,
    eleve_nom: r.eleve_nom,
    eleve_prenom: r.eleve_prenom,
    titre: `Paiement reçu — ${Number(r.montant).toLocaleString('fr-FR')} Ar`,
    detail: r.mode_paiement,
    auteur: r.auteur_nom ? `${r.auteur_prenom || ''} ${r.auteur_nom}`.trim() : null,
  }));
}

async function fetchDepenses({ eleve_id, date_debut, date_fin, scope }) {
  if (eleve_id) return []; // une dépense n'est jamais liée à un élève précis
  const conditions = []; const params = [];
  if (date_debut) { params.push(date_debut); conditions.push(`d.date_depense >= $${params.length}`); }
  if (date_fin) { params.push(date_fin); conditions.push(`d.date_depense <= $${params.length}`); }
  if (scope) {
    params.push(scope.id);
    conditions.push(scope.type === 'agent' ? `d.agent_id = $${params.length}` : `d.utilisateur_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT d.id, d.date_depense AS date, d.montant, d.libelle, d.mode_paiement, c.nom AS categorie_nom,
            COALESCE(u.nom, a.nom) AS auteur_nom, COALESCE(u.prenom, a.prenom) AS auteur_prenom
     FROM depense d
     JOIN categorie_depense c ON c.id = d.categorie_id
     LEFT JOIN utilisateur u ON u.id = d.utilisateur_id
     LEFT JOIN agent a ON a.id = d.agent_id
     ${where} ORDER BY d.date_depense DESC, d.id DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({
    id: `depense-${r.id}`,
    type: 'finance',
    date: r.date,
    eleve_nom: null,
    eleve_prenom: null,
    titre: `Dépense — ${r.libelle} : ${Number(r.montant).toLocaleString('fr-FR')} Ar`,
    detail: `${r.categorie_nom} · ${r.mode_paiement}`,
    auteur: r.auteur_nom ? `${r.auteur_prenom || ''} ${r.auteur_nom}`.trim() : null,
  }));
}

async function fetchFinances(filters) {
  const [paiements, depenses] = await Promise.all([fetchPaiements(filters), fetchDepenses(filters)]);
  return [...paiements, ...depenses];
}

async function fetchDiscipline({ eleve_id, date_debut, date_fin, scope }) {
  const conditions = []; const params = [];
  if (eleve_id) { params.push(eleve_id); conditions.push(`d.eleve_id = $${params.length}`); }
  if (date_debut) { params.push(date_debut); conditions.push(`d.date_incident >= $${params.length}`); }
  if (date_fin) { params.push(date_fin); conditions.push(`d.date_incident <= $${params.length}`); }
  if (scope) {
    params.push(scope.id);
    conditions.push(scope.type === 'agent' ? `d.auteur_agent_id = $${params.length}` : `d.auteur_utilisateur_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT d.id, d.date_incident AS date, d.type_incident, d.gravite, e.nom AS eleve_nom, e.prenom AS eleve_prenom,
            COALESCE(u.nom, a.nom) AS auteur_nom, COALESCE(u.prenom, a.prenom) AS auteur_prenom
     FROM discipline d
     JOIN eleve e ON e.id = d.eleve_id
     LEFT JOIN utilisateur u ON u.id = d.auteur_utilisateur_id
     LEFT JOIN agent a ON a.id = d.auteur_agent_id
     ${where} ORDER BY d.date_incident DESC, d.id DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({
    id: `discipline-${r.id}`,
    type: 'discipline',
    date: r.date,
    eleve_nom: r.eleve_nom,
    eleve_prenom: r.eleve_prenom,
    titre: `Discipline — ${r.type_incident}`,
    detail: `Gravité : ${r.gravite}`,
    auteur: r.auteur_nom ? `${r.auteur_prenom || ''} ${r.auteur_nom}`.trim() : null,
  }));
}

// Présence des enseignants eux-mêmes (pointage_enseignant) — déclarée manuellement par un agent
// (admin/surveillant, cf. POST /pointage/enseignant) ou auto-déclarée par l'enseignant via scan QR.
// Absente d'Historique jusqu'ici (aucun rôle, y compris admin, ne pouvait la consulter ici) alors
// que le surveillant gère ce suivi au quotidien (cf. Présences > onglet Absences enseignants).
async function fetchPresenceEnseignant({ date_debut, date_fin, scope }) {
  const conditions = []; const params = [];
  if (date_debut) { params.push(date_debut); conditions.push(`pen.date_pointage >= $${params.length}`); }
  if (date_fin) { params.push(date_fin); conditions.push(`pen.date_pointage <= $${params.length}`); }
  if (scope) {
    params.push(scope.id);
    conditions.push(scope.type === 'agent' ? `pen.agent_id = $${params.length}` : `pen.enseignant_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT pen.id, pen.date_pointage AS date, pen.statut, pen.source,
            u.nom AS enseignant_nom, u.prenom AS enseignant_prenom,
            a.nom AS auteur_nom, a.prenom AS auteur_prenom
     FROM pointage_enseignant pen
     JOIN utilisateur u ON u.id = pen.enseignant_id
     LEFT JOIN agent a ON a.id = pen.agent_id
     ${where} ORDER BY pen.date_pointage DESC, pen.id DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({
    id: `pointage_enseignant-${r.id}`,
    type: 'presence_enseignant',
    date: r.date,
    eleve_nom: null,
    eleve_prenom: null,
    titre: `Présence enseignant — ${r.statut}`,
    detail: `${r.enseignant_prenom || ''} ${r.enseignant_nom}`.trim() + (r.source === 'scan_qr' ? ' (auto-déclarée par scan QR)' : ''),
    auteur: r.auteur_nom
      ? `${r.auteur_prenom || ''} ${r.auteur_nom}`.trim()
      : (r.source === 'scan_qr' ? `${r.enseignant_prenom || ''} ${r.enseignant_nom}`.trim() : null),
  }));
}

// Absences déclarées par le secrétariat/surveillant (table absence_eleve, onglet "Absences
// élèves" de Présences) — distinctes de "presence" ci-dessus qui vient de l'appel en classe
// (pointage_eleve, tenu par l'enseignant ou le surveillant). auteur_utilisateur_id/auteur_agent_id
// n'existaient pas avant sur cette table : ce module était donc jusqu'ici invisible ici comme
// dans le Journal d'Audit, alors que le secrétariat le gère au quotidien sans l'admin.
async function fetchAbsenceEleve({ eleve_id, date_debut, date_fin, scope }) {
  const conditions = []; const params = [];
  if (eleve_id) { params.push(eleve_id); conditions.push(`ae.eleve_id = $${params.length}`); }
  if (date_debut) { params.push(date_debut); conditions.push(`ae.date_absence >= $${params.length}`); }
  if (date_fin) { params.push(date_fin); conditions.push(`ae.date_absence <= $${params.length}`); }
  if (scope) {
    params.push(scope.id);
    conditions.push(scope.type === 'agent' ? `ae.auteur_agent_id = $${params.length}` : `ae.auteur_utilisateur_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT ae.id, ae.date_absence AS date, ae.motif, ae.justifiee, e.nom AS eleve_nom, e.prenom AS eleve_prenom,
            COALESCE(u.nom, a.nom) AS auteur_nom, COALESCE(u.prenom, a.prenom) AS auteur_prenom
     FROM absence_eleve ae
     JOIN eleve e ON e.id = ae.eleve_id
     LEFT JOIN utilisateur u ON u.id = ae.auteur_utilisateur_id
     LEFT JOIN agent a ON a.id = ae.auteur_agent_id
     ${where} ORDER BY ae.date_absence DESC, ae.id DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({
    id: `absence_eleve-${r.id}`,
    type: 'absence_eleve',
    date: r.date,
    eleve_nom: r.eleve_nom,
    eleve_prenom: r.eleve_prenom,
    titre: `Absence — ${r.justifiee ? 'justifiée' : 'non justifiée'}`,
    detail: r.motif || null,
    auteur: r.auteur_nom ? `${r.auteur_prenom || ''} ${r.auteur_nom}`.trim() : null,
  }));
}

// Même chose côté enseignants (table absence_enseignant, onglet "Absences enseignants").
async function fetchAbsenceEnseignant({ date_debut, date_fin, scope }) {
  const conditions = []; const params = [];
  if (date_debut) { params.push(date_debut); conditions.push(`ae.date_absence >= $${params.length}`); }
  if (date_fin) { params.push(date_fin); conditions.push(`ae.date_absence <= $${params.length}`); }
  if (scope) {
    params.push(scope.id);
    conditions.push(scope.type === 'agent' ? `ae.auteur_agent_id = $${params.length}` : `ae.auteur_utilisateur_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT ae.id, ae.date_absence AS date, ae.motif, ae.justifiee,
            u.nom AS enseignant_nom, u.prenom AS enseignant_prenom,
            COALESCE(au.nom, a.nom) AS auteur_nom, COALESCE(au.prenom, a.prenom) AS auteur_prenom
     FROM absence_enseignant ae
     JOIN utilisateur u ON u.id = ae.enseignant_id
     LEFT JOIN utilisateur au ON au.id = ae.auteur_utilisateur_id
     LEFT JOIN agent a ON a.id = ae.auteur_agent_id
     ${where} ORDER BY ae.date_absence DESC, ae.id DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({
    id: `absence_enseignant-${r.id}`,
    type: 'absence_enseignant',
    date: r.date,
    eleve_nom: null,
    eleve_prenom: null,
    titre: `Absence enseignant — ${r.justifiee ? 'justifiée' : 'non justifiée'}`,
    detail: `${r.enseignant_prenom || ''} ${r.enseignant_nom}`.trim() + (r.motif ? ` · ${r.motif}` : ''),
    auteur: r.auteur_nom ? `${r.auteur_prenom || ''} ${r.auteur_nom}`.trim() : null,
  }));
}

const FETCHERS = {
  presence: fetchPresences,
  presence_enseignant: fetchPresenceEnseignant,
  absence_eleve: fetchAbsenceEleve,
  absence_enseignant: fetchAbsenceEnseignant,
  note: fetchNotes,
  finance: fetchFinances,
  discipline: fetchDiscipline,
};

// GET /historique?type=presence|note|finance|discipline (répétable, défaut = tous) + eleve_id, classe_id, date_debut, date_fin
// Admin -> historique complet de l'établissement (ou, avec ?enseignant_id=, celui d'un enseignant précis
// consulté depuis sa fiche — vue en lecture seule, /admin/enseignants/:id/espace).
// Enseignant -> uniquement ses propres présences/notes. Agent (secretaire/economie/surveillant) ->
// uniquement ce que ce rôle produit réellement (finances/discipline pour tous, + appel et/ou
// absences déclarées selon le rôle, cf. TYPES_PAR_ROLE côté frontend). Déterminé automatiquement
// depuis le login (req.user).
router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ query: historiqueQuerySchema }), asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  // Un admin peut aussi consulter l'historique d'un agent précis (?agent_id=), en lecture seule
  // depuis sa fiche (/admin/comptes -> Profil), comme il le fait déjà pour un enseignant.
  const agentConsulte = isAdmin ? req.query.agent_id : null;
  const enseignantConsulte = isAdmin && !agentConsulte ? req.query.enseignant_id : null;
  const scope = agentConsulte
    ? { type: 'agent', id: agentConsulte }
    : enseignantConsulte
      ? { type: 'utilisateur', id: enseignantConsulte }
      : (isAdmin ? null : { type: req.user.type, id: req.user.id });

  // Un agent (non-enseignant) n'est jamais auteur de notes : on ne propose ce type par défaut
  // qu'à l'admin ou à un enseignant. "presence"/"presence_enseignant" (appel) et
  // "absence_eleve"/"absence_enseignant" (déclarations) restent proposés à un agent — chaque
  // rôle n'en alimentant réellement qu'une partie (surveillant : appel + les deux absences ;
  // secretaire : les deux absences seulement) ; le frontend (TYPES_PAR_ROLE) filtre déjà
  // l'affichage par rôle, ces sections seront simplement vides pour le reste, comme "finance"
  // l'est déjà pour un surveillant.
  const typesParDefaut = !scope || scope.type === 'utilisateur'
    ? Object.keys(FETCHERS)
    : ['presence', 'presence_enseignant', 'absence_eleve', 'absence_enseignant', 'finance', 'discipline'];

  const filters = {
    eleve_id: req.query.eleve_id,
    classe_id: req.query.classe_id,
    date_debut: req.query.date_debut,
    date_fin: req.query.date_fin,
    scope,
  };
  const typesDemandes = [].concat(req.query.type || typesParDefaut).filter((t) => FETCHERS[t]);

  const resultats = await Promise.all(typesDemandes.map((t) => FETCHERS[t](filters)));
  const rows = resultats.flat().sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json({ scope: scope ? 'agent' : 'admin', rows: rows.slice(0, 300) });
}));

module.exports = router;
