'use strict';

const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');

const router = express.Router();
const { localMonthYear } = require('../services/timeService');

function scopeForUser(user) {
  if (user.role === 'admin' || user.role === 'economie' || user.role === 'secretaire' || user.role === 'surveillant') return null;
  if (user.role === 'enseignant') return { type: 'enseignant', id: Number(user.id) };
  // Les autres rôles ne doivent jamais recevoir silencieusement une vue globale.
  return { type: 'none', id: null };
}

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const scope = scopeForUser(req.user);
  if (scope?.type === 'none') throw new ApiError(403, 'Accès refusé à ce centre de pilotage.');
  const activeYear = await query(`SELECT id, libelle FROM annee_scolaire WHERE actif = TRUE LIMIT 1`);
  const anneeId = activeYear.rows[0]?.id || null;
  const { mois: month, annee: year } = localMonthYear(new Date());

  if (!anneeId) {
    return res.json({ annee_scolaire: null, kpis: {}, alerts: [], risks: [], finance: {}, workload: {}, classes: [] });
  }

  const teacherFilterNote = scope ? 'AND n.enseignant_id = $2' : '';
  const teacherFilterPointage = scope ? 'AND p.enseignant_id = $2' : '';
  const teacherFilterClass = scope ? `AND EXISTS (
      SELECT 1 FROM enseignant_matiere_classe emc
      WHERE emc.enseignant_id = $2 AND emc.classe_id = ins.classe_id AND emc.annee_scolaire_id = $1
    )` : '';
  const baseParams = scope ? [anneeId, scope.id] : [anneeId];

  const [
    effectif,
    presence,
    notes,
    finances,
    expenses,
    payroll,
    payrollPending,
    incidents,
    pendingBulletins,
    nonInscrits,
    impayes,
    risks,
    classes,
    overdueHomework,
    edtConflicts,
    activity,
    cashResult,
  ] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM inscription i WHERE i.annee_scolaire_id = $1 AND i.statut = 'inscrit' ${scope ? `AND EXISTS (SELECT 1 FROM enseignant_matiere_classe emc WHERE emc.enseignant_id = $2 AND emc.classe_id=i.classe_id AND emc.annee_scolaire_id=$1)` : ''}`, baseParams),
    query(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE p.statut='present')::int AS presents,
      COUNT(*) FILTER (WHERE p.statut='absent')::int AS absents,
      COUNT(*) FILTER (WHERE p.statut='retard')::int AS retards
      FROM pointage_eleve p
      WHERE p.annee_scolaire_id=$1 AND p.date_pointage >= CURRENT_DATE - INTERVAL '30 days' ${scope ? 'AND p.enseignant_id=$2' : ''}`, baseParams),
    query(`SELECT COUNT(*)::int AS total,
      ROUND(AVG(n.note_valeur),2) AS moyenne,
      COUNT(*) FILTER (WHERE n.note_valeur < 10)::int AS faibles
      FROM note n WHERE n.annee_scolaire_id=$1 ${teacherFilterNote}`, baseParams),
    query(`SELECT COALESCE(SUM(f.montant_total),0) AS attendu,
      COALESCE((SELECT SUM(p.montant * CASE WHEN p.is_avoir THEN -1 ELSE 1 END) FROM paiement p JOIN frais_scolaire f2 ON f2.id=p.frais_id WHERE f2.annee_scolaire_id=$1),0) AS paye,
      COUNT(*) FILTER (WHERE f.statut IN ('impaye','partiel'))::int AS dossiers_impayes
      FROM frais_scolaire f WHERE f.annee_scolaire_id=$1`, [anneeId]),
    query(`SELECT COALESCE(SUM(montant),0) AS total, COUNT(*)::int AS count
      FROM depense WHERE date_depense >= date_trunc('month', CURRENT_DATE)::date AND date_depense < (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date`),
    query(`SELECT COALESCE(SUM(salaire_net),0) AS total, COUNT(*)::int AS count
      FROM paie WHERE annee=$1 AND mois=$2 AND statut <> 'annule'`, [year, month]),
    query(`SELECT COUNT(*) FILTER (WHERE statut='a_verifier')::int AS a_verifier,
      COUNT(*) FILTER (WHERE statut='incomplet')::int AS incomplets,
      COUNT(*)::int AS total
      FROM controle_paie WHERE annee=$1 AND mois=$2`, [year, month]),
    query(`SELECT COUNT(*)::int AS total FROM discipline WHERE date_incident >= CURRENT_DATE - INTERVAL '30 days'`),
    query(`SELECT COUNT(*)::int AS total FROM bulletin b WHERE b.annee_scolaire_id=$1
      AND b.bimestre_id IN (SELECT id FROM bimestre WHERE annee_scolaire_id=$1 AND actif=TRUE)`, [anneeId]),
    query(`SELECT COUNT(*)::int AS total FROM eleve e WHERE e.actif=TRUE AND NOT EXISTS (
      SELECT 1 FROM inscription i WHERE i.eleve_id=e.id AND i.annee_scolaire_id=$1
    )`, [anneeId]),
    query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(GREATEST(f.montant_total-COALESCE(p.total_paye,0),0)),0) AS reste
      FROM frais_scolaire f LEFT JOIN (
        SELECT frais_id, SUM(montant) total_paye FROM paiement GROUP BY frais_id
      ) p ON p.frais_id=f.id
      WHERE f.annee_scolaire_id=$1 AND f.statut IN ('impaye','partiel')`, [anneeId]),
    query(`WITH base AS (
      SELECT e.id, e.nom, e.prenom, e.matricule, c.nom AS classe,
        COALESCE(a.absences,0)::int AS absences,
        COALESCE(a.retards,0)::int AS retards,
        COALESCE(n.moyenne,0)::numeric AS moyenne,
        0::int AS devoirs,
        COALESCE(i.impaye,0)::numeric AS impaye
      FROM eleve e
      JOIN inscription ins ON ins.eleve_id=e.id AND ins.annee_scolaire_id=$1 AND ins.statut='inscrit'
      JOIN classe c ON c.id=ins.classe_id
      LEFT JOIN (
        SELECT eleve_id, COUNT(*) FILTER (WHERE statut='absent') absences, COUNT(*) FILTER (WHERE statut='retard') retards
        FROM pointage_eleve WHERE annee_scolaire_id=$1 AND date_pointage >= CURRENT_DATE - INTERVAL '30 days' ${scope ? 'AND enseignant_id=$2' : ''}
        GROUP BY eleve_id
      ) a ON a.eleve_id=e.id
      LEFT JOIN (
        SELECT eleve_id, ROUND(AVG(note_valeur),2) moyenne FROM note WHERE annee_scolaire_id=$1 ${scope ? 'AND enseignant_id=$2' : ''} GROUP BY eleve_id
      ) n ON n.eleve_id=e.id
      LEFT JOIN (
        SELECT f.eleve_id, SUM(GREATEST(f.montant_total-COALESCE(p.total_paye,0),0)) impaye
        FROM frais_scolaire f LEFT JOIN (SELECT frais_id,SUM(montant) total_paye FROM paiement GROUP BY frais_id) p ON p.frais_id=f.id
        WHERE f.annee_scolaire_id=$1 GROUP BY f.eleve_id
      ) i ON i.eleve_id=e.id
      WHERE e.actif=TRUE ${teacherFilterClass}
    )
    SELECT *,
      LEAST(10, ROUND(absences/3.0))::int AS score_absence,
      CASE WHEN moyenne > 0 AND moyenne < 8 THEN 3 WHEN moyenne > 0 AND moyenne < 10 THEN 2 WHEN moyenne > 0 AND moyenne < 12 THEN 1 ELSE 0 END AS score_note,
      LEAST(2, retards/3)::int AS score_retard,
      CASE WHEN impaye > 0 THEN 1 ELSE 0 END AS score_finance,
      (LEAST(10, ROUND(absences/3.0)) +
       CASE WHEN moyenne > 0 AND moyenne < 8 THEN 3 WHEN moyenne > 0 AND moyenne < 10 THEN 2 WHEN moyenne > 0 AND moyenne < 12 THEN 1 ELSE 0 END +
       LEAST(2, retards/3)::int + CASE WHEN impaye > 0 THEN 1 ELSE 0 END) AS score
    FROM base ORDER BY score DESC, absences DESC, moyenne ASC NULLS LAST LIMIT 10`, baseParams),
    query(`SELECT c.id, c.nom,
      COALESCE((SELECT COUNT(*) FROM inscription i WHERE i.classe_id=c.id AND i.annee_scolaire_id=$1 AND i.statut='inscrit'),0)::int AS effectif,
      COALESCE((SELECT ROUND(AVG(n.note_valeur),2) FROM note n WHERE n.classe_id=c.id AND n.annee_scolaire_id=$1 ${scope ? 'AND n.enseignant_id=$2' : ''}),0) AS moyenne,
      COALESCE((SELECT ROUND(100.0*COUNT(*) FILTER (WHERE p.statut='present')/NULLIF(COUNT(*),0),1) FROM pointage_eleve p WHERE p.classe_id=c.id AND p.annee_scolaire_id=$1 AND p.date_pointage >= CURRENT_DATE - INTERVAL '30 days' ${scope ? 'AND p.enseignant_id=$2' : ''}),0) AS presence
      FROM classe c
      WHERE c.annee_scolaire_id=$1 ${scope ? `AND EXISTS (SELECT 1 FROM enseignant_matiere_classe emc WHERE emc.enseignant_id=$2 AND emc.classe_id=c.id AND emc.annee_scolaire_id=$1)` : ''}
      ORDER BY c.nom`, baseParams),
    query(`SELECT COUNT(*)::int AS total FROM devoir d WHERE d.annee_scolaire_id=$1 AND d.date_limite < CURRENT_DATE AND d.envoye=TRUE ${scope ? 'AND d.enseignant_id=$2' : ''}`, baseParams),
    query(`WITH conflicts AS (
      SELECT a.id FROM emploi_du_temps a JOIN emploi_du_temps b ON a.id<b.id
      WHERE a.annee_scolaire_id=$1 AND b.annee_scolaire_id=$1 AND a.actif=TRUE AND b.actif=TRUE
      AND a.jour=b.jour AND a.heure_debut<b.heure_fin AND b.heure_debut<a.heure_fin
      AND (a.classe_id=b.classe_id OR a.enseignant_id=b.enseignant_id OR (a.salle_id IS NOT NULL AND a.salle_id=b.salle_id))
    ) SELECT COUNT(*)::int AS total FROM conflicts`, [anneeId]),
    query(`SELECT COUNT(*) FILTER (WHERE date_action >= CURRENT_DATE)::int AS aujourd_hui,
      COUNT(*) FILTER (WHERE date_action >= CURRENT_DATE-INTERVAL '7 days')::int AS semaine
      FROM audit_log`),
    query(`SELECT COALESCE(SUM(solde_theorique),0) AS solde FROM v_solde_caisse`),
  ]);

  const expected = Number(finances.rows[0]?.attendu || 0);
  const collected = Number(finances.rows[0]?.paye || 0);
  const recovery = expected > 0 ? Math.round((collected / expected) * 1000) / 10 : 0;
  const pTotal = Number(presence.rows[0]?.total || 0);
  const pPresent = Number(presence.rows[0]?.presents || 0);
  const presenceRate = pTotal > 0 ? Math.round((pPresent / pTotal) * 1000) / 10 : null;
  const expenseMonth = Number(expenses.rows[0]?.total || 0);
  const payrollMonth = Number(payroll.rows[0]?.total || 0);
  const cash = Number(cashResult.rows[0]?.solde || 0);
  const forecast = cash + Number(finances.rows[0]?.paye || 0) - expenseMonth - payrollMonth;

  const alerts = [];
  const push = (severity, code, title, detail, href) => alerts.push({ severity, code, title, detail, href });
  if (Number(nonInscrits.rows[0]?.total || 0) > 0) push('warning','DOSSIERS_INCOMPLETS','Dossiers sans inscription',`${nonInscrits.rows[0].total} élève(s) actif(s) ne sont pas inscrits pour l'année active.`,'/admin/eleves');
  if (Number(impayes.rows[0]?.total || 0) > 0) push('danger','IMPAYES','Écolage à relancer',`${impayes.rows[0].total} dossier(s) présentent un impayé ou un paiement partiel (${Number(impayes.rows[0].reste).toLocaleString('fr-FR')} Ar restants).`,'/admin/finances');
  if (Number(payrollPending.rows[0]?.a_verifier || 0) > 0) push('warning','PAIE_A_VERIFIER','Paies à vérifier',`${payrollPending.rows[0].a_verifier} contrôle(s) de paie sont encore à vérifier.`,'/admin/paie');
  if (Number(edtConflicts.rows[0]?.total || 0) > 0) push('danger','EDT_CONFLIT',"Conflits d'emploi du temps",`${edtConflicts.rows[0].total} conflit(s) de classe, enseignant ou salle ont été détectés.`,'/admin/emploi-du-temps');
  if (Number(notes.rows[0]?.faibles || 0) > 0) push('warning','NOTES_FAIBLES','Résultats à surveiller',`${notes.rows[0].faibles} note(s) sont inférieures à 10/20.`,'/admin/notes');
  if (Number(incidents.rows[0]?.total || 0) > 0) push('warning','DISCIPLINE','Incidents récents',`${incidents.rows[0].total} incident(s) de discipline ont été signalés sur les 30 derniers jours.`,'/admin/vie-scolaire');
  if (Number(overdueHomework.rows[0]?.total || 0) > 0) push('info','DEVOIRS_RETARD','Devoirs arrivés à échéance',`${overdueHomework.rows[0].total} devoir(s) ont dépassé leur date limite.`,'/admin/devoirs');
  if (presenceRate !== null && presenceRate < 90) push('warning','PRESENCE','Présence à surveiller',`Le taux de présence sur 30 jours est de ${presenceRate}%.`,'/admin/presences');

  alerts.sort((a,b) => ({danger:0,warning:1,info:2}[a.severity]-({danger:0,warning:1,info:2}[b.severity])));

  res.json({
    annee_scolaire: activeYear.rows[0],
    scope: scope ? 'enseignant' : 'etablissement',
    generated_at: new Date().toISOString(),
    kpis: {
      effectif: Number(effectif.rows[0]?.total || 0),
      presence_30j: presenceRate,
      notes_moyenne: notes.rows[0]?.moyenne == null ? null : Number(notes.rows[0].moyenne),
      notes_faibles: Number(notes.rows[0]?.faibles || 0),
      recouvrement: recovery,
      incidents_30j: Number(incidents.rows[0]?.total || 0),
      bulletins: Number(pendingBulletins.rows[0]?.total || 0),
    },
    alerts: alerts.slice(0, 12),
    risks: risks.rows.map((r) => ({
      ...r,
      moyenne: r.moyenne == null ? null : Number(r.moyenne),
      impaye: Number(r.impaye || 0),
      score: Number(r.score || 0),
      niveau: Number(r.score || 0) >= 7 ? 'élevé' : Number(r.score || 0) >= 4 ? 'vigilance' : 'normal',
    })),
    finance: {
      attendu: expected,
      paye: collected,
      reste: Math.max(0, expected-collected),
      recouvrement: recovery,
      depenses_mois: expenseMonth,
      paie_mois: payrollMonth,
      caisse_theorique: cash,
      solde_previsionnel: forecast,
    },
    workload: {
      paies_a_verifier: Number(payrollPending.rows[0]?.a_verifier || 0),
      paies_incompletes: Number(payrollPending.rows[0]?.incomplets || 0),
      devoirs_echus: Number(overdueHomework.rows[0]?.total || 0),
    },
    classes: classes.rows.map((r) => ({ ...r, effectif: Number(r.effectif || 0), moyenne: Number(r.moyenne || 0), presence: Number(r.presence || 0) })),
    integrity: { edt_conflicts: Number(edtConflicts.rows[0]?.total || 0) },
    activity: { aujourd_hui: Number(activity.rows[0]?.aujourd_hui || 0), semaine: Number(activity.rows[0]?.semaine || 0) },
    engines: [
      { code: 'RULES', label: 'Contrôles métier', status: 'actif', description: 'Notes, inscriptions, paiements, validations et cohérence des données.' },
      { code: 'EDT', label: 'Détection conflits EDT', status: 'actif', description: 'Classe, enseignant et salle ne peuvent pas se chevaucher.' },
      { code: 'RISK', label: 'Score élèves à surveiller', status: 'actif', description: 'Présence, notes, retards et impayés produisent un indicateur d’attention.' },
      { code: 'FINANCE', label: 'Pilotage financier', status: 'actif', description: 'Recouvrement, dépenses, paie et solde prévisionnel.' },
      { code: 'AUDIT', label: 'Traçabilité', status: 'actif', description: 'Les opérations sensibles restent consultables dans le journal d’audit.' },
    ],
  });
}));

module.exports = router;
