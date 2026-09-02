const crypto = require('crypto');
const { query } = require('../config/db');
const { callGroq: callGroqShared } = require('./groqClient');
const { localDateString, localTimeString, localDayName, localMonthYear } = require('./timeService');
const ACTION_TOKEN_TTL_MS = 5 * 60 * 1000;

function createActionToken(adminUser, tool, args, id, now = Date.now()) {
  const payload = JSON.stringify({ sub: String(adminUser.id), tool, args, id, exp: now + ACTION_TOKEN_TTL_MS });
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET non configuré correctement.');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyActionToken(token, adminUser, tool, args) {
  if (typeof token !== 'string' || !token.includes('.')) throw new Error('Confirmation expirée ou invalide. Veuillez relancer la demande.');
  const [body, sig] = token.split('.');
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET non configuré correctement.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Confirmation invalide. Veuillez relancer la demande.');
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new Error('Confirmation invalide.'); }
  if (String(payload.sub) !== String(adminUser.id) || payload.tool !== tool || Date.now() > Number(payload.exp || 0)) {
    throw new Error('Confirmation expirée ou non autorisée. Veuillez relancer la demande.');
  }
  const canonical = JSON.stringify(payload.args || {});
  if (canonical !== JSON.stringify(args || {})) throw new Error('Les paramètres de l’action ont été modifiés. Veuillez relancer la demande.');
  return payload;
}

// ---------------------------------------------------------------------------
// OUTILS DE LECTURE — exécutés immédiatement, aucune conséquence en base.
// ---------------------------------------------------------------------------

async function anneeActiveId() {
  const { rows } = await query('SELECT id FROM annee_scolaire WHERE actif = TRUE LIMIT 1');
  return rows[0]?.id || null;
}

const READ_IMPLEMENTATIONS = {
  async date_heure_ecole() {
    const now = new Date();
    const { mois, annee } = localMonthYear(now);
    return { date: localDateString(now), heure: localTimeString(now), jour: localDayName(now), mois, annee, timezone: process.env.APP_TIMEZONE || 'Indian/Antananarivo' };
  },

  async fiche_eleve({ terme } = {}) {
    if (!terme || !terme.trim()) return { error: 'terme requis.' };
    const like = `%${terme.trim()}%`;
    const anneeId = await anneeActiveId();
    const { rows: candidats } = await query(`
      SELECT e.id, e.nom, e.prenom, e.matricule, e.date_naissance, e.sexe,
             c.id AS classe_id, c.nom AS classe, a.libelle AS annee
      FROM eleve e
      LEFT JOIN inscription i ON i.eleve_id=e.id AND i.annee_scolaire_id=$2 AND i.statut='inscrit'
      LEFT JOIN classe c ON c.id=i.classe_id
      LEFT JOIN annee_scolaire a ON a.id=i.annee_scolaire_id
      WHERE e.actif=TRUE AND (e.nom ILIKE $1 OR e.prenom ILIKE $1 OR e.matricule ILIKE $1)
      ORDER BY e.nom,e.prenom LIMIT 8`, [like, anneeId]);
    if (!candidats.length) return { candidats: [] };
    if (candidats.length > 1) return { candidats, message: 'Plusieurs élèves correspondent ; précise le matricule pour une fiche unique.' };
    const e = candidats[0];
    const [notes, abs, discipline, parents] = await Promise.all([
      query(`SELECT m.nom AS matiere, ROUND(SUM(n.note_valeur*n.coefficient_evaluation)/NULLIF(SUM(n.coefficient_evaluation),0),2) AS moyenne, COUNT(*) AS nb_notes FROM note n JOIN matiere m ON m.id=n.matiere_id WHERE n.eleve_id=$1 GROUP BY m.id,m.nom ORDER BY m.nom`, [e.id]),
      query(`SELECT statut, COUNT(*)::int AS total FROM pointage_eleve WHERE eleve_id=$1 GROUP BY statut`, [e.id]),
      query(`SELECT date_incident,type_incident,gravite,description FROM discipline WHERE eleve_id=$1 ORDER BY date_incident DESC LIMIT 10`, [e.id]),
      query(`SELECT p.nom,p.prenom,p.telephone,p.email,ep.lien_parente,ep.responsable_principal FROM eleve_parent ep JOIN parent p ON p.id=ep.parent_id WHERE ep.eleve_id=$1 ORDER BY ep.responsable_principal DESC,p.nom`, [e.id]),
    ]);
    return { eleve: e, notes: notes.rows, absences: abs.rows, discipline: discipline.rows, parents: parents.rows };
  },
  async effectifs_generaux() {
    const anneeId = await anneeActiveId();
    const [eleves, classes, enseignants, agents] = await Promise.all([
      query(`SELECT COUNT(*) FROM eleve WHERE actif = TRUE`),
      query(`SELECT COUNT(*) FROM classe WHERE annee_scolaire_id = $1`, [anneeId]),
      query(`SELECT COUNT(*) FROM utilisateur WHERE role = 'enseignant' AND actif = TRUE`),
      query(`SELECT COUNT(*) FROM agent WHERE actif = TRUE`),
    ]);
    return {
      total_eleves: Number(eleves.rows[0].count),
      total_classes: Number(classes.rows[0].count),
      total_enseignants: Number(enseignants.rows[0].count),
      total_agents: Number(agents.rows[0].count),
    };
  },

  async effectif_par_classe() {
    const anneeId = await anneeActiveId();
    const { rows } = await query(
      `SELECT c.nom, COUNT(i.id) AS effectif FROM classe c
       LEFT JOIN inscription i ON i.classe_id = c.id AND i.statut = 'inscrit'
       WHERE c.annee_scolaire_id = $1 GROUP BY c.nom ORDER BY c.nom`,
      [anneeId]
    );
    return rows;
  },

  async liste_enseignants({ actif_seulement = true } = {}) {
    const { rows } = await query(
      `SELECT nom, prenom, email, telephone, actif FROM utilisateur
       WHERE role = 'enseignant' ${actif_seulement ? 'AND actif = TRUE' : ''} ORDER BY nom`
    );
    return rows;
  },

  async rechercher_eleve({ terme } = {}) {
    if (!terme || !terme.trim()) return { error: 'terme de recherche requis (nom, prénom ou matricule).' };
    const anneeId = await anneeActiveId();
    const like = `%${terme.trim()}%`;
    const { rows } = await query(
      `SELECT e.id, e.nom, e.prenom, e.matricule, c.nom AS classe
       FROM eleve e
       LEFT JOIN inscription i ON i.eleve_id = e.id AND i.statut = 'inscrit' AND i.annee_scolaire_id = $2
       LEFT JOIN classe c ON c.id = i.classe_id
       WHERE e.actif = TRUE AND (e.matricule ILIKE $1 OR e.nom ILIKE $1 OR e.prenom ILIKE $1)
       ORDER BY e.nom LIMIT 10`,
      [like, anneeId]
    );
    return rows;
  },

  async liste_eleves({ classe_nom } = {}) {
    const anneeId = await anneeActiveId();
    const conds = [`e.actif = TRUE`, `i.statut = 'inscrit'`, `i.annee_scolaire_id = $1`];
    const params = [anneeId];
    if (classe_nom) { params.push(`%${classe_nom.trim()}%`); conds.push(`c.nom ILIKE $${params.length}`); }
    const { rows } = await query(
      `SELECT e.nom, e.prenom, e.matricule, c.nom AS classe
       FROM eleve e
       JOIN inscription i ON i.eleve_id = e.id
       LEFT JOIN classe c ON c.id = i.classe_id
       WHERE ${conds.join(' AND ')}
       ORDER BY c.nom, e.nom LIMIT 150`,
      params
    );
    return { total: rows.length, eleves: rows };
  },

  async depenses_caisses({ limite = 30 } = {}) {
    const lim = Math.min(Math.max(Number(limite) || 30, 1), 100);
    const [{ rows: caisses }, { rows: depenses }] = await Promise.all([
      query(
        `SELECT c.nom,
                c.solde_initial
                  + COALESCE((SELECT SUM(montant) FROM mouvement_caisse WHERE caisse_id = c.id AND type_mouvement='entree'), 0)
                  - COALESCE((SELECT SUM(montant) FROM mouvement_caisse WHERE caisse_id = c.id AND type_mouvement='sortie'), 0)
                  AS solde_actuel
         FROM caisse c ORDER BY c.nom`
      ),
      query(
        `SELECT d.libelle, d.montant, d.date_depense, d.mode_paiement, cd.nom AS categorie_nom
         FROM depense d JOIN categorie_depense cd ON cd.id = d.categorie_id
         ORDER BY d.date_depense DESC LIMIT ${lim}`
      ),
    ]);
    return { caisses, depenses_recentes: depenses };
  },

  // Regroupe plusieurs vérifications simples et factuelles (jamais d'accusation) pour aider
  // l'admin à repérer des signaux à vérifier manuellement : mouvements financiers, présence du
  // personnel, suppressions dans le journal d'audit. Chaque section renvoie des FAITS bruts —
  // c'est à l'admin (avec l'aide du modèle dans sa réponse) d'interpréter et de creuser.
  async surveillance_anomalies({ jours = 30 } = {}) {
    const j = Math.min(Math.max(Number(jours) || 30, 1), 365);
    const [
      { rows: suppressionsSensibles },
      { rows: enseignantsAbsenteistes },
      { rows: depensesElevees },
      { rows: paiementsSansRecu },
    ] = await Promise.all([
      // 1. Suppressions récentes sur des tables sensibles (finance, notes, discipline, paie)
      query(
        `SELECT al.table_nom, al.date_action, COALESCE(u.nom || ' ' || u.prenom, a.nom || ' ' || a.prenom, 'inconnu') AS acteur
         FROM audit_log al
         LEFT JOIN utilisateur u ON u.id = al.utilisateur_id
         LEFT JOIN agent a ON a.id = al.agent_id
         WHERE al.action = 'suppression'
           AND al.table_nom IN ('paiement','frais_scolaire','depense','mouvement_caisse','note','paie','salaire_enseignant')
           AND al.date_action >= CURRENT_DATE - ($1 || ' days')::interval
         ORDER BY al.date_action DESC LIMIT 50`,
        [j]
      ),
      // 2. Enseignants avec beaucoup d'absences non justifiées récentes ("mpiasa tsy miasa")
      query(
        `SELECT u.nom, u.prenom, COUNT(*) AS nb_absences
         FROM absence_enseignant ae JOIN utilisateur u ON u.id = ae.enseignant_id
         WHERE ae.date_absence >= CURRENT_DATE - ($1 || ' days')::interval
           AND (ae.justifiee IS NULL OR ae.justifiee = FALSE)
         GROUP BY u.id, u.nom, u.prenom
         HAVING COUNT(*) >= 3
         ORDER BY nb_absences DESC LIMIT 20`,
        [j]
      ),
      // 3. Dépenses individuelles inhabituellement élevées par rapport à la moyenne récente
      query(
        `SELECT d.libelle, d.montant, d.date_depense, cd.nom AS categorie_nom
         FROM depense d JOIN categorie_depense cd ON cd.id = d.categorie_id
         WHERE d.date_depense >= CURRENT_DATE - ($1 || ' days')::interval
           AND d.montant > (SELECT AVG(montant) * 3 FROM depense WHERE date_depense >= CURRENT_DATE - ($1 || ' days')::interval)
         ORDER BY d.montant DESC LIMIT 20`,
        [j]
      ),
      // 4. Paiements enregistrés sans numéro de reçu (traçabilité faible)
      query(
        `SELECT p.montant, p.mode_paiement, p.date_paiement, e.nom, e.prenom
         FROM paiement p JOIN eleve e ON e.id = p.eleve_id
         WHERE (p.recu_numero IS NULL OR p.recu_numero = '')
           AND p.date_paiement >= CURRENT_DATE - ($1 || ' days')::interval
         ORDER BY p.date_paiement DESC LIMIT 20`,
        [j]
      ),
    ]);
    return {
      periode_jours: j,
      suppressions_donnees_sensibles: suppressionsSensibles,
      enseignants_absences_frequentes_non_justifiees: enseignantsAbsenteistes,
      depenses_inhabituellement_elevees: depensesElevees,
      paiements_sans_recu: paiementsSansRecu,
      note: "Ce sont des signaux factuels à vérifier — ce n'est pas une preuve de fraude. Toujours croiser avec le contexte avant d'agir.",
    };
  },

  async structure_base_donnees() {
    const { rows } = await query(
      `SELECT table_name,
              (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS nb_colonnes
       FROM information_schema.tables t
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    return { total_tables: rows.length, tables: rows };
  },

  async salaires_enseignants({ enseignant_nom } = {}) {
    const conds = [];
    const params = [];
    if (enseignant_nom) {
      params.push(`%${enseignant_nom.trim()}%`);
      conds.push(`(u.nom ILIKE $${params.length} OR u.prenom ILIKE $${params.length})`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT u.nom, u.prenom, s.type_salaire, s.montant, s.date_debut, s.date_fin, s.actif
       FROM salaire_enseignant s JOIN utilisateur u ON u.id = s.enseignant_id
       ${where} ORDER BY s.actif DESC, u.nom LIMIT 100`,
      params
    );
    return rows;
  },

  async paie_bulletins({ enseignant_nom, mois, annee } = {}) {
    const conds = [];
    const params = [];
    if (enseignant_nom) {
      params.push(`%${enseignant_nom.trim()}%`);
      conds.push(`(u.nom ILIKE $${params.length} OR u.prenom ILIKE $${params.length})`);
    }
    if (mois) { params.push(mois); conds.push(`p.mois = $${params.length}`); }
    if (annee) { params.push(annee); conds.push(`p.annee = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT p.*, u.nom, u.prenom FROM paie p JOIN utilisateur u ON u.id = p.enseignant_id
       ${where} ORDER BY p.annee DESC, p.mois DESC LIMIT 100`,
      params
    );
    return rows;
  },

  async liste_parents({ eleve_nom } = {}) {
    if (eleve_nom) {
      const like = `%${eleve_nom.trim()}%`;
      const { rows } = await query(
        `SELECT p.nom, p.prenom, p.telephone, p.email, ep.lien_parente, ep.responsable_principal, e.nom AS eleve_nom, e.prenom AS eleve_prenom
         FROM eleve_parent ep
         JOIN parent p ON p.id = ep.parent_id
         JOIN eleve e ON e.id = ep.eleve_id
         WHERE e.nom ILIKE $1 OR e.prenom ILIKE $1 LIMIT 50`,
        [like]
      );
      return rows;
    }
    const { rows } = await query(
      `SELECT p.nom, p.prenom, p.telephone, p.email,
              COALESCE(json_agg(json_build_object('eleve', e.nom || ' ' || e.prenom, 'lien', ep.lien_parente))
                FILTER (WHERE e.id IS NOT NULL), '[]') AS enfants
       FROM parent p
       LEFT JOIN eleve_parent ep ON ep.parent_id = p.id
       LEFT JOIN eleve e ON e.id = ep.eleve_id
       GROUP BY p.id ORDER BY p.nom LIMIT 100`
    );
    return rows;
  },

  async actualites_recentes({ limite = 10 } = {}) {
    const lim = Math.min(Math.max(Number(limite) || 10, 1), 50);
    const { rows } = await query(
      `SELECT titre, contenu, publie, created_at FROM actualite ORDER BY created_at DESC LIMIT ${lim}`
    );
    return rows;
  },

  async journal_audit({ table_nom, action, limite = 30 } = {}) {
    const conds = [];
    const params = [];
    if (table_nom) { params.push(table_nom); conds.push(`table_nom = $${params.length}`); }
    if (action) { params.push(action); conds.push(`action = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const lim = Math.min(Math.max(Number(limite) || 30, 1), 100);
    const { rows } = await query(
      `SELECT al.table_nom, al.action, al.date_action, u.nom AS utilisateur_nom, a.nom AS agent_nom
       FROM audit_log al
       LEFT JOIN utilisateur u ON u.id = al.utilisateur_id
       LEFT JOIN agent a ON a.id = al.agent_id
       ${where} ORDER BY al.date_action DESC LIMIT ${lim}`,
      params
    );
    return rows;
  },

  async affectations_enseignants({ enseignant_nom, classe_nom } = {}) {
    const conds = [];
    const params = [];
    if (enseignant_nom) {
      params.push(`%${enseignant_nom.trim()}%`);
      conds.push(`(u.nom ILIKE $${params.length} OR u.prenom ILIKE $${params.length})`);
    }
    if (classe_nom) { params.push(`%${classe_nom.trim()}%`); conds.push(`c.nom ILIKE $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT u.nom AS enseignant_nom, u.prenom AS enseignant_prenom, m.nom AS matiere_nom, c.nom AS classe_nom
       FROM enseignant_matiere_classe emc
       JOIN utilisateur u ON u.id = emc.enseignant_id
       JOIN matiere m ON m.id = emc.matiere_id
       JOIN classe c ON c.id = emc.classe_id
       ${where} ORDER BY c.nom, m.nom LIMIT 100`,
      params
    );
    return rows;
  },

  async liste_agents({ actif_seulement = true } = {}) {
    const { rows } = await query(
      `SELECT nom, prenom, email, role_agent, telephone, actif FROM agent
       ${actif_seulement ? 'WHERE actif = TRUE' : ''} ORDER BY nom, prenom`
    );
    return rows;
  },

  async liste_classes() {
    const anneeId = await anneeActiveId();
    const { rows } = await query(
      `SELECT c.nom, n.nom AS niveau_nom, cy.nom AS cycle_nom,
              u.nom AS titulaire_nom, u.prenom AS titulaire_prenom,
              (SELECT COUNT(*) FROM inscription i WHERE i.classe_id = c.id AND i.statut = 'inscrit') AS effectif
       FROM classe c
       JOIN niveau n ON n.id = c.niveau_id
       JOIN cycle cy ON cy.id = n.cycle_id
       LEFT JOIN utilisateur u ON u.id = c.titulaire_id
       WHERE c.annee_scolaire_id = $1
       ORDER BY cy.ordre, n.ordre, c.nom`,
      [anneeId]
    );
    return rows;
  },

  async liste_matieres() {
    const { rows } = await query(`SELECT nom, code, couleur FROM matiere ORDER BY nom`);
    return rows;
  },

  async liste_salles() {
    const { rows } = await query(
      `SELECT nom, rayon_metres, latitude IS NOT NULL AS geolocalisee, actif FROM salle ORDER BY nom`
    );
    return rows;
  },

  async emploi_du_temps({ classe_nom, enseignant_nom, jour } = {}) {
    const anneeId = await anneeActiveId();
    const conds = [`edt.actif = TRUE`, `edt.annee_scolaire_id = $1`];
    const params = [anneeId];
    if (classe_nom) { params.push(`%${classe_nom.trim()}%`); conds.push(`c.nom ILIKE $${params.length}`); }
    if (jour) { params.push(jour.trim()); conds.push(`edt.jour ILIKE $${params.length}`); }
    if (enseignant_nom) {
      params.push(`%${enseignant_nom.trim()}%`);
      conds.push(`(u.nom ILIKE $${params.length} OR u.prenom ILIKE $${params.length})`);
    }
    const { rows } = await query(
      `SELECT edt.jour, edt.heure_debut, edt.heure_fin, c.nom AS classe_nom, m.nom AS matiere_nom,
              u.nom AS enseignant_nom, u.prenom AS enseignant_prenom
       FROM emploi_du_temps edt
       JOIN classe c ON c.id = edt.classe_id
       JOIN matiere m ON m.id = edt.matiere_id
       JOIN utilisateur u ON u.id = edt.enseignant_id
       WHERE ${conds.join(' AND ')}
       ORDER BY CASE edt.jour WHEN 'Lundi' THEN 1 WHEN 'Mardi' THEN 2 WHEN 'Mercredi' THEN 3
         WHEN 'Jeudi' THEN 4 WHEN 'Vendredi' THEN 5 ELSE 6 END, edt.heure_debut
       LIMIT 60`,
      params
    );
    return rows;
  },

  async notes_recentes({ classe_nom, matiere_nom, limite = 20 } = {}) {
    const anneeId = await anneeActiveId();
    const conds = [`n.annee_scolaire_id = $1`];
    const params = [anneeId];
    if (classe_nom) { params.push(`%${classe_nom.trim()}%`); conds.push(`c.nom ILIKE $${params.length}`); }
    if (matiere_nom) { params.push(`%${matiere_nom.trim()}%`); conds.push(`m.nom ILIKE $${params.length}`); }
    const lim = Math.min(Math.max(Number(limite) || 20, 1), 100);
    const { rows } = await query(
      `SELECT n.note_valeur, n.type_evaluation, n.created_at, e.nom AS eleve_nom, e.prenom AS eleve_prenom,
              m.nom AS matiere_nom, c.nom AS classe_nom
       FROM note n
       JOIN eleve e ON e.id = n.eleve_id
       JOIN matiere m ON m.id = n.matiere_id
       JOIN classe c ON c.id = n.classe_id
       WHERE ${conds.join(' AND ')}
       ORDER BY n.created_at DESC LIMIT ${lim}`,
      params
    );
    return rows;
  },

  async devoirs_recents({ classe_nom, a_venir_seulement = true } = {}) {
    const conds = [];
    const params = [];
    if (classe_nom) { params.push(`%${classe_nom.trim()}%`); conds.push(`c.nom ILIKE $${params.length}`); }
    if (a_venir_seulement) conds.push(`d.date_limite >= CURRENT_DATE`);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT d.titre, d.date_assignation, d.date_limite, c.nom AS classe_nom, m.nom AS matiere_nom
       FROM devoir d JOIN classe c ON c.id = d.classe_id JOIN matiere m ON m.id = d.matiere_id
       ${where} ORDER BY d.date_limite ASC LIMIT 50`,
      params
    );
    return rows;
  },

  async examens_recents({ classe_nom } = {}) {
    const anneeId = await anneeActiveId();
    const conds = [`e.annee_scolaire_id = $1`];
    const params = [anneeId];
    if (classe_nom) { params.push(`%${classe_nom.trim()}%`); conds.push(`c.nom ILIKE $${params.length}`); }
    const { rows } = await query(
      `SELECT e.nom, e.type_examen, e.date_debut, e.date_fin, c.nom AS classe_nom
       FROM examen e JOIN classe c ON c.id = e.classe_id
       WHERE ${conds.join(' AND ')} ORDER BY e.date_debut DESC LIMIT 50`,
      params
    );
    return rows;
  },

  async absences_eleves({ date_debut, date_fin, classe_nom } = {}) {
    const anneeId = await anneeActiveId();
    const conds = [`p.annee_scolaire_id = $1`, `p.statut IN ('absent','retard')`];
    const params = [anneeId];
    if (date_debut) { params.push(date_debut); conds.push(`p.date_pointage >= $${params.length}`); }
    if (date_fin) { params.push(date_fin); conds.push(`p.date_pointage <= $${params.length}`); }
    if (classe_nom) { params.push(`%${classe_nom}%`); conds.push(`c.nom ILIKE $${params.length}`); }
    if (!date_debut && !date_fin) conds.push(`p.date_pointage = CURRENT_DATE`);

    const whereSql = conds.join(' AND ');
    const [{ rows: totalRows }, { rows }] = await Promise.all([
      query(
        `SELECT p.statut, COUNT(*) FROM pointage_eleve p JOIN classe c ON c.id = p.classe_id WHERE ${whereSql} GROUP BY p.statut`,
        params
      ),
      query(
        `SELECT p.date_pointage, p.statut, e.nom, e.prenom, c.nom AS classe
         FROM pointage_eleve p
         JOIN eleve e ON e.id = p.eleve_id
         JOIN classe c ON c.id = p.classe_id
         WHERE ${whereSql}
         ORDER BY p.date_pointage DESC LIMIT 50`,
        params
      ),
    ]);
    return { resume: totalRows, detail: rows };
  },

  async absences_enseignants({ date_debut, date_fin } = {}) {
    const conds = [];
    const params = [];
    if (date_debut) { params.push(date_debut); conds.push(`a.date_absence >= $${params.length}`); }
    if (date_fin) { params.push(date_fin); conds.push(`a.date_absence <= $${params.length}`); }
    if (!date_debut && !date_fin) conds.push(`a.date_absence = CURRENT_DATE`);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT a.date_absence, a.motif, a.justifiee, u.nom, u.prenom
       FROM absence_enseignant a JOIN utilisateur u ON u.id = a.enseignant_id
       ${where} ORDER BY a.date_absence DESC LIMIT 100`,
      params
    );
    return rows;
  },

  async finances_resume() {
    const anneeId = await anneeActiveId();
    const [{ rows }, { rows: impayes }] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(montant_total),0) AS total_attendu,
                COALESCE(SUM(CASE WHEN statut='paye' THEN montant_total ELSE 0 END),0) AS total_paye
         FROM frais_scolaire WHERE annee_scolaire_id = $1`,
        [anneeId]
      ),
      query(
        `SELECT e.nom, e.prenom, e.matricule,
                SUM(f.montant_total) - COALESCE(p.total_paye, 0) AS solde_du
         FROM frais_scolaire f
         JOIN eleve e ON e.id = f.eleve_id
         LEFT JOIN (SELECT frais_id, SUM(montant) AS total_paye FROM paiement GROUP BY frais_id) p ON p.frais_id = f.id
         WHERE f.annee_scolaire_id = $1 AND f.statut != 'annule'
         GROUP BY e.id, e.nom, e.prenom, e.matricule, p.total_paye
         HAVING SUM(f.montant_total) - COALESCE(p.total_paye, 0) > 0
         ORDER BY solde_du DESC LIMIT 10`,
        [anneeId]
      ),
    ]);
    return { resume: rows[0], top_impayes: impayes };
  },

  async discipline_incidents({ date_debut, date_fin } = {}) {
    const conds = [];
    const params = [];
    if (date_debut) { params.push(date_debut); conds.push(`d.date_incident >= $${params.length}`); }
    if (date_fin) { params.push(date_fin); conds.push(`d.date_incident <= $${params.length}`); }
    if (!date_debut && !date_fin) conds.push(`d.date_incident >= CURRENT_DATE - INTERVAL '30 days'`);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [{ rows: parType }, { rows: recents }] = await Promise.all([
      query(`SELECT type_incident, gravite, COUNT(*) FROM discipline d ${where} GROUP BY type_incident, gravite`, params),
      query(
        `SELECT d.date_incident, d.type_incident, d.gravite, e.nom, e.prenom
         FROM discipline d JOIN eleve e ON e.id = d.eleve_id ${where}
         ORDER BY d.date_incident DESC LIMIT 20`,
        params
      ),
    ]);
    return { par_type: parType, recents };
  },

  // Compare le taux de présence des élèves entre deux périodes consécutives de même durée,
  // pour repérer une tendance (amélioration ou dégradation) plutôt qu'une photo instantanée.
  async tendance_absences_eleves({ classe_nom, jours = 30 } = {}) {
    const j = Math.min(Math.max(Number(jours) || 30, 7), 180);
    const anneeId = await anneeActiveId();
    const conds = [`p.annee_scolaire_id = $1`];
    const params = [anneeId];
    if (classe_nom) { params.push(`%${classe_nom.trim()}%`); conds.push(`c.nom ILIKE $${params.length}`); }
    const whereBase = conds.join(' AND ');
    const jParamIndex = params.length + 1; // position de "jours" une fois ajouté à params

    const [{ rows: periodeRecente }, { rows: periodePrecedente }] = await Promise.all([
      query(
        `SELECT c.nom AS classe, p.statut, COUNT(*) AS total
         FROM pointage_eleve p JOIN classe c ON c.id = p.classe_id
         WHERE ${whereBase} AND p.date_pointage >= CURRENT_DATE - ($${jParamIndex} || ' days')::interval
         GROUP BY c.nom, p.statut ORDER BY c.nom`,
        [...params, j]
      ),
      query(
        `SELECT c.nom AS classe, p.statut, COUNT(*) AS total
         FROM pointage_eleve p JOIN classe c ON c.id = p.classe_id
         WHERE ${whereBase}
           AND p.date_pointage < CURRENT_DATE - ($${jParamIndex} || ' days')::interval
           AND p.date_pointage >= CURRENT_DATE - (($${jParamIndex}::int) * 2 || ' days')::interval
         GROUP BY c.nom, p.statut ORDER BY c.nom`,
        [...params, j]
      ),
    ]);

    return {
      periode_jours: j,
      periode_recente: { du: `il y a ${j} jours`, au: "aujourd'hui", detail: periodeRecente },
      periode_precedente: { du: `il y a ${j * 2} jours`, au: `il y a ${j} jours`, detail: periodePrecedente },
      note: "Compare les décomptes absent/retard/present entre les deux périodes de même durée pour juger si la présence s'améliore ou se dégrade.",
    };
  },

  // Calcule la moyenne pondérée par élève (et par matière si précisée), pour repérer
  // les élèves ou les classes en difficulté — pas seulement les dernières notes brutes.
  async moyennes_eleves({ classe_nom, matiere_nom, seuil_alerte = 10, limite = 20 } = {}) {
    const anneeId = await anneeActiveId();
    const conds = [`n.annee_scolaire_id = $1`];
    const params = [anneeId];
    if (classe_nom) { params.push(`%${classe_nom.trim()}%`); conds.push(`c.nom ILIKE $${params.length}`); }
    if (matiere_nom) { params.push(`%${matiere_nom.trim()}%`); conds.push(`m.nom ILIKE $${params.length}`); }
    const seuil = Math.min(Math.max(Number(seuil_alerte) || 10, 0), 20);
    const lim = Math.min(Math.max(Number(limite) || 20, 1), 100);

    const { rows } = await query(
      `SELECT e.nom, e.prenom, c.nom AS classe_nom,
              ${matiere_nom ? 'm.nom AS matiere_nom,' : ''}
              ROUND(SUM(n.note_valeur * n.coefficient_evaluation) / NULLIF(SUM(n.coefficient_evaluation), 0), 2) AS moyenne,
              COUNT(*) AS nb_notes
       FROM note n
       JOIN eleve e ON e.id = n.eleve_id
       JOIN classe c ON c.id = n.classe_id
       JOIN matiere m ON m.id = n.matiere_id
       WHERE ${conds.join(' AND ')}
       GROUP BY e.id, e.nom, e.prenom, c.nom ${matiere_nom ? ', m.nom' : ''}
       HAVING ROUND(SUM(n.note_valeur * n.coefficient_evaluation) / NULLIF(SUM(n.coefficient_evaluation), 0), 2) <= $${params.length + 1}
       ORDER BY moyenne ASC LIMIT ${lim}`,
      [...params, seuil]
    );
    return { seuil_alerte: seuil, eleves_en_difficulte: rows };
  },

  // Vue de pilotage compacte pour l'accueil de l'assistant : uniquement des indicateurs
  // factuels et actionnables. Les valeurs sont calculées côté serveur, jamais inventées par l'IA.
  async tableau_bord_assistant({ jours = 30 } = {}) {
    const j = Math.min(Math.max(Number(jours) || 30, 1), 365);
    const anneeId = await anneeActiveId();
    const [effectifs, absEleves, absEns, conflits, finances, anomalies] = await Promise.all([
      READ_IMPLEMENTATIONS.effectifs_generaux(),
      READ_IMPLEMENTATIONS.absences_eleves({ date_debut: localDateString(), date_fin: localDateString() }),
      READ_IMPLEMENTATIONS.absences_enseignants({ date_debut: localDateString(), date_fin: localDateString() }),
      READ_IMPLEMENTATIONS.conflits_emploi_du_temps(),
      READ_IMPLEMENTATIONS.finances_resume(),
      READ_IMPLEMENTATIONS.surveillance_anomalies({ jours: j }),
    ]);
    const { rows: heures } = await query(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (heure_fin - heure_debut))/3600),0) AS heures_planifiees,
              COUNT(*) AS cours
       FROM emploi_du_temps
       WHERE annee_scolaire_id = $1 AND actif = TRUE`,
      [anneeId]
    );
    return {
      periode_jours: j,
      effectifs,
      aujourd_hui: { absences_eleves: absEleves, absences_enseignants: absEns },
      emploi_du_temps: {
        cours: Number(heures[0]?.cours || 0),
        heures_planifiees: Number(Number(heures[0]?.heures_planifiees || 0).toFixed(2)),
        conflits_enseignant: conflits.conflits_enseignant.length,
        conflits_salle: conflits.conflits_salle.length,
      },
      finances,
      signaux: {
        suppressions_sensibles: anomalies.suppressions_donnees_sensibles.length,
        absences_enseignants_a_verifier: anomalies.enseignants_absences_frequentes_non_justifiees.length,
        depenses_elevees_a_verifier: anomalies.depenses_inhabituellement_elevees.length,
        paiements_sans_recu: anomalies.paiements_sans_recu.length,
      },
    };
  },

  // Détecte les conflits d'emploi du temps de l'année active : un enseignant ou une salle
  // affecté(e) à deux cours qui se chevauchent le même jour.
  async conflits_emploi_du_temps() {
    const anneeId = await anneeActiveId();
    const [{ rows: conflitsEnseignant }, { rows: conflitsSalle }] = await Promise.all([
      query(
        `SELECT a.jour, u.nom, u.prenom,
                a.heure_debut AS debut_a, a.heure_fin AS fin_a, ca.nom AS classe_a,
                b.heure_debut AS debut_b, b.heure_fin AS fin_b, cb.nom AS classe_b
         FROM emploi_du_temps a
         JOIN emploi_du_temps b ON a.enseignant_id = b.enseignant_id AND a.jour = b.jour AND a.id < b.id
         JOIN utilisateur u ON u.id = a.enseignant_id
         JOIN classe ca ON ca.id = a.classe_id
         JOIN classe cb ON cb.id = b.classe_id
         WHERE a.annee_scolaire_id = $1 AND b.annee_scolaire_id = $1
           AND a.actif = TRUE AND b.actif = TRUE
           AND a.heure_debut < b.heure_fin AND b.heure_debut < a.heure_fin
         ORDER BY a.jour, a.heure_debut`,
        [anneeId]
      ),
      query(
        `SELECT a.jour, a.salle,
                a.heure_debut AS debut_a, a.heure_fin AS fin_a, ca.nom AS classe_a,
                b.heure_debut AS debut_b, b.heure_fin AS fin_b, cb.nom AS classe_b
         FROM emploi_du_temps a
         JOIN emploi_du_temps b ON a.salle_id = b.salle_id AND a.salle_id IS NOT NULL
           AND a.jour = b.jour AND a.id < b.id
         JOIN classe ca ON ca.id = a.classe_id
         JOIN classe cb ON cb.id = b.classe_id
         WHERE a.annee_scolaire_id = $1 AND b.annee_scolaire_id = $1
           AND a.actif = TRUE AND b.actif = TRUE
           AND a.heure_debut < b.heure_fin AND b.heure_debut < a.heure_fin
         ORDER BY a.jour, a.heure_debut`,
        [anneeId]
      ),
    ]);
    return {
      conflits_enseignant: conflitsEnseignant,
      conflits_salle: conflitsSalle,
      note: 'Deux cours se chevauchent : soit un même enseignant sur deux classes en même temps, soit une même salle utilisée par deux cours en même temps.',
    };
  },
};

// ---------------------------------------------------------------------------
// OUTILS D'ÉCRITURE — jamais exécutés directement pendant la conversation.
// Le modèle ne fait que les "proposer" (voir askAssistant) ; seule
// executeConfirmedAction() les exécute réellement, après confirmation
// explicite de l'admin dans l'interface (bouton "Ekena").
// ---------------------------------------------------------------------------

const WRITE_IMPLEMENTATIONS = {
  async creer_actualite({ titre, contenu, publie = true } = {}, adminUser) {
    if (!titre || !contenu) throw new Error('titre et contenu sont requis.');
    const { rows } = await query(
      `INSERT INTO actualite (titre, contenu, auteur_id, publie, date_publication)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, titre`,
      [titre, contenu, adminUser.id, !!publie, publie ? new Date() : null]
    );
    return { id: rows[0].id, message: `Actualité « ${rows[0].titre} » créée.` };
  },

  async enregistrer_absence_eleve({ eleve_id, date_absence, motif, justifiee = false } = {}) {
    if (!eleve_id || !date_absence) throw new Error('eleve_id et date_absence sont requis.');
    const eleve = await query(`SELECT nom, prenom FROM eleve WHERE id = $1 AND actif = TRUE`, [eleve_id]);
    if (!eleve.rows[0]) throw new Error('Élève introuvable ou inactif.');
    const { rows } = await query(
      `INSERT INTO absence_eleve (eleve_id, date_absence, motif, justifiee)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [eleve_id, date_absence, motif || null, !!justifiee]
    );
    return { id: rows[0].id, message: `Absence enregistrée pour ${eleve.rows[0].prenom || ''} ${eleve.rows[0].nom} le ${date_absence}.` };
  },

  async signaler_incident_discipline({ eleve_id, date_incident, type_incident, description, gravite = 'faible' } = {}, adminUser) {
    if (!eleve_id || !date_incident || !type_incident) throw new Error('eleve_id, date_incident et type_incident sont requis.');
    const eleve = await query(`SELECT nom, prenom FROM eleve WHERE id = $1 AND actif = TRUE`, [eleve_id]);
    if (!eleve.rows[0]) throw new Error('Élève introuvable ou inactif.');
    const { rows } = await query(
      `INSERT INTO discipline (eleve_id, date_incident, type_incident, description, gravite, auteur_utilisateur_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [eleve_id, date_incident, type_incident, description || null, gravite, adminUser.id]
    );
    return { id: rows[0].id, message: `Incident de discipline enregistré pour ${eleve.rows[0].prenom || ''} ${eleve.rows[0].nom}.` };
  },
};

const WRITE_TOOL_NAMES = new Set(Object.keys(WRITE_IMPLEMENTATIONS));
const READ_TOOL_NAMES = new Set(Object.keys(READ_IMPLEMENTATIONS));

const TOOLS = [
  // --- lecture ---
  { type: 'function', function: { name: 'date_heure_ecole', description: "Donne la date, l'heure et le jour officiels du serveur COPEC dans le fuseau de l'école. À utiliser dès qu'une question dépend d'aujourd'hui, maintenant, du mois ou de l'année en cours.", parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'fiche_eleve', description: "Retourne une fiche synthétique d'un élève à partir de son nom, prénom ou matricule : identité scolaire, classe active, moyennes par matière, absences/retards, incidents récents et parents. Si plusieurs élèves correspondent, retourne les candidats sans choisir arbitrairement.", parameters: { type: 'object', properties: { terme: { type: 'string' } }, required: ['terme'] } } },
  {
    type: 'function',
    function: {
      name: 'effectifs_generaux',
      description:
        "Retourne les effectifs globaux de l'école : nombre total d'élèves actifs, de classes (année active), d'enseignants actifs et d'agents actifs.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'effectif_par_classe',
      description: "Retourne le nombre d'élèves inscrits, classe par classe, pour l'année scolaire active.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'liste_enseignants',
      description: 'Retourne la liste des enseignants avec nom, prénom, email, téléphone et statut actif.',
      parameters: {
        type: 'object',
        properties: { actif_seulement: { type: 'boolean', description: 'Ne renvoyer que les enseignants actifs (true par défaut).' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rechercher_eleve',
      description:
        "Recherche un ou plusieurs élèves par nom, prénom ou matricule. À utiliser SYSTÉMATIQUEMENT avant tout outil d'écriture nécessitant un eleve_id, afin d'obtenir l'identifiant exact — ne jamais deviner un eleve_id.",
      parameters: {
        type: 'object',
        properties: { terme: { type: 'string', description: 'Nom, prénom ou matricule (partiel ou complet) à rechercher.' } },
        required: ['terme'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'liste_eleves',
      description:
        "Retourne la liste complète des élèves inscrits (nom, prénom, matricule, classe) pour l'année scolaire active. Utiliser cet outil pour toute demande de liste globale ou par classe des élèves (jusqu'à 150 élèves). Pour chercher UN élève précis par nom/matricule, utiliser plutôt rechercher_eleve.",
      parameters: {
        type: 'object',
        properties: {
          classe_nom: { type: 'string', description: 'Filtrer par nom (ou partie) de classe (optionnel) ; si absent, retourne tous les élèves.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'depenses_caisses',
      description: "Retourne le solde actuel de chaque caisse et les dépenses récentes (libellé, montant, catégorie, mode de paiement). Utile pour toute question sur les finances de fonctionnement de l'école (hors frais de scolarité des élèves).",
      parameters: {
        type: 'object',
        properties: { limite: { type: 'integer', description: 'Nombre de dépenses récentes à retourner (30 par défaut, 100 max).' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'surveillance_anomalies',
      description:
        "Regroupe plusieurs vérifications factuelles pour aider à repérer des signaux à surveiller sur la période demandée : suppressions dans le journal d'audit sur des tables sensibles (paiements, notes, paie...), enseignants avec absences fréquentes non justifiées (personnel qui ne travaille pas), dépenses inhabituellement élevées, paiements sans numéro de reçu. À utiliser quand l'admin demande une vérification, une surveillance, s'il y a un risque de fraude/corruption, ou si le personnel ne travaille pas. Les résultats sont des FAITS BRUTS à interpréter avec prudence — jamais une preuve ni une accusation.",
      parameters: {
        type: 'object',
        properties: { jours: { type: 'integer', description: 'Taille de la fenêtre en jours à analyser (30 par défaut, 365 max).' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'structure_base_donnees',
      description: "Retourne des informations techniques sur la base de données de l'application : nombre total de tables et, pour chacune, son nom et son nombre de colonnes. À utiliser pour toute question du type « combien de tables », « quelles sont les tables », « structure de la base ».",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'salaires_enseignants',
      description: "Retourne les grilles de salaire des enseignants (type de salaire, montant, dates, statut actif). Donnée sensible réservée à l'admin — jamais à révéler dans un autre contexte que cette conversation admin.",
      parameters: {
        type: 'object',
        properties: { enseignant_nom: { type: 'string', description: 'Filtrer par nom ou prénom (optionnel).' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'paie_bulletins',
      description: "Retourne les bulletins de paie des enseignants, filtrables par enseignant, mois et/ou année. Donnée sensible réservée à l'admin.",
      parameters: {
        type: 'object',
        properties: {
          enseignant_nom: { type: 'string', description: 'Filtrer par nom ou prénom (optionnel).' },
          mois: { type: 'integer', description: 'Mois (1-12) (optionnel).' },
          annee: { type: 'integer', description: 'Année (optionnel).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'liste_parents',
      description: "Retourne les parents/tuteurs avec coordonnées (téléphone, email) et enfants rattachés. Filtrable par nom d'élève ; sans filtre, retourne tous les parents.",
      parameters: {
        type: 'object',
        properties: { eleve_nom: { type: 'string', description: "Nom ou prénom d'élève pour ne retourner que ses parents (optionnel)." } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'actualites_recentes',
      description: "Retourne les actualités/annonces les plus récentes publiées sur le portail de l'école.",
      parameters: {
        type: 'object',
        properties: { limite: { type: 'integer', description: 'Nombre à retourner (10 par défaut, 50 max).' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'journal_audit',
      description: "Retourne le journal d'audit (traçabilité) : quelle action, sur quelle table, par qui, à quelle date. Filtrable par table et/ou type d'action.",
      parameters: {
        type: 'object',
        properties: {
          table_nom: { type: 'string', description: 'Nom de la table concernée (optionnel).' },
          action: { type: 'string', description: 'Type d\u2019action, ex. creation/modification/suppression (optionnel).' },
          limite: { type: 'integer', description: 'Nombre à retourner (30 par défaut, 200 max).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'affectations_enseignants',
      description: "Retourne quel enseignant enseigne quelle matière dans quelle classe (affectations), filtrable par enseignant et/ou classe.",
      parameters: {
        type: 'object',
        properties: {
          enseignant_nom: { type: 'string', description: 'Filtrer par nom ou prénom (optionnel).' },
          classe_nom: { type: 'string', description: 'Filtrer par nom (ou partie) de classe (optionnel).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'liste_agents',
      description: "Retourne la liste des agents (secrétaire, économe, surveillant) avec nom, prénom, email, rôle, téléphone et statut actif.",
      parameters: {
        type: 'object',
        properties: { actif_seulement: { type: 'boolean', description: 'Ne renvoyer que les agents actifs (true par défaut).' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'liste_classes',
      description: "Retourne la liste des classes de l'année active : niveau, cycle, titulaire, effectif.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'liste_matieres',
      description: "Retourne la liste des matières enseignées (nom, code, couleur).",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'liste_salles',
      description: "Retourne la liste des salles (nom, rayon de géofence, si géolocalisée, statut actif). Ne divulgue jamais le code QR.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'emploi_du_temps',
      description: "Retourne l'emploi du temps (jour, heure, classe, matière, enseignant) de l'année active, filtrable par classe, enseignant ou jour.",
      parameters: {
        type: 'object',
        properties: {
          classe_nom: { type: 'string', description: 'Filtrer par nom (ou partie) de classe (optionnel).' },
          enseignant_nom: { type: 'string', description: 'Filtrer par nom ou prénom d\u2019enseignant (optionnel).' },
          jour: { type: 'string', description: 'Filtrer par jour (Lundi, Mardi, ...) (optionnel).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notes_recentes',
      description: "Retourne les notes les plus récentes (élève, matière, classe, valeur), filtrables par classe et/ou matière.",
      parameters: {
        type: 'object',
        properties: {
          classe_nom: { type: 'string', description: 'Filtrer par nom (ou partie) de classe (optionnel).' },
          matiere_nom: { type: 'string', description: 'Filtrer par nom (ou partie) de matière (optionnel).' },
          limite: { type: 'integer', description: 'Nombre de notes à retourner (20 par défaut, 100 max).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'devoirs_recents',
      description: "Retourne les devoirs (titre, dates, classe, matière), par défaut uniquement ceux dont la date limite n'est pas encore passée.",
      parameters: {
        type: 'object',
        properties: {
          classe_nom: { type: 'string', description: 'Filtrer par nom (ou partie) de classe (optionnel).' },
          a_venir_seulement: { type: 'boolean', description: "Ne renvoyer que les devoirs dont la date limite n'est pas passée (true par défaut)." },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'examens_recents',
      description: "Retourne les examens de l'année active (nom, type, dates, classe), filtrables par classe.",
      parameters: {
        type: 'object',
        properties: { classe_nom: { type: 'string', description: 'Filtrer par nom (ou partie) de classe (optionnel).' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'absences_eleves',
      description:
        "Retourne les absences/retards d'élèves sur une période (par défaut aujourd'hui) : résumé par statut et détail nominatif. Filtrable par nom de classe.",
      parameters: {
        type: 'object',
        properties: {
          date_debut: { type: 'string', description: 'AAAA-MM-JJ (optionnel).' },
          date_fin: { type: 'string', description: 'AAAA-MM-JJ (optionnel).' },
          classe_nom: { type: 'string', description: 'Filtrer par nom (ou partie) de classe (optionnel).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'absences_enseignants',
      description: "Retourne les absences d'enseignants sur une période (par défaut aujourd'hui).",
      parameters: {
        type: 'object',
        properties: {
          date_debut: { type: 'string', description: 'AAAA-MM-JJ (optionnel).' },
          date_fin: { type: 'string', description: 'AAAA-MM-JJ (optionnel).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finances_resume',
      description: "Retourne le résumé financier de l'année active (attendu vs payé) et le top 10 des élèves les plus endettés.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'discipline_incidents',
      description: "Retourne les incidents de discipline sur une période (par défaut 30 derniers jours) : résumé par type/gravité et incidents récents.",
      parameters: {
        type: 'object',
        properties: {
          date_debut: { type: 'string', description: 'AAAA-MM-JJ (optionnel).' },
          date_fin: { type: 'string', description: 'AAAA-MM-JJ (optionnel).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tendance_absences_eleves',
      description:
        "Compare le nombre d'absences/retards/présences entre deux périodes consécutives de même durée (par défaut 30 jours) pour dire si l'assiduité s'améliore ou se dégrade — à utiliser pour toute question sur une TENDANCE ou une ÉVOLUTION de la présence des élèves, pas juste une photo du jour.",
      parameters: {
        type: 'object',
        properties: {
          classe_nom: { type: 'string', description: 'Filtrer par nom (ou partie) de classe (optionnel).' },
          jours: { type: 'integer', description: 'Taille de chaque période en jours (30 par défaut, entre 7 et 180).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'moyennes_eleves',
      description:
        "Calcule la moyenne pondérée (par coefficient) de chaque élève et retourne ceux en dessous d'un seuil (10/20 par défaut) — à utiliser pour repérer les élèves ou une classe en difficulté scolaire, pas juste les dernières notes brutes.",
      parameters: {
        type: 'object',
        properties: {
          classe_nom: { type: 'string', description: 'Filtrer par nom (ou partie) de classe (optionnel).' },
          matiere_nom: { type: 'string', description: 'Filtrer par nom (ou partie) de matière (optionnel).' },
          seuil_alerte: { type: 'number', description: 'Ne retourner que les moyennes à ce seuil ou en dessous (10 par défaut, sur 20).' },
          limite: { type: 'integer', description: 'Nombre max de résultats (20 par défaut, 100 max).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tableau_bord_assistant',
      description: "Retourne le tableau de bord synthétique de l'administrateur : effectifs, absences du jour, emploi du temps, conflits, finances et signaux d'anomalie à vérifier. À utiliser pour une vue globale de l'école ou quand l'admin demande la situation générale.",
      parameters: {
        type: 'object',
        properties: { jours: { type: 'integer', description: 'Période des signaux à surveiller, 30 jours par défaut, 365 max.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'conflits_emploi_du_temps',
      description:
        "Détecte les conflits dans l'emploi du temps de l'année active : un même enseignant ou une même salle affecté(e) à deux cours qui se chevauchent le même jour. À utiliser pour toute question sur des conflits, doublons ou incohérences d'emploi du temps.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // --- écriture (jamais exécutés directement — voir askAssistant) ---
  {
    type: 'function',
    function: {
      name: 'creer_actualite',
      description: "Propose la création d'une actualité/annonce publiée sur le portail de l'école. Nécessite confirmation de l'admin avant exécution.",
      parameters: {
        type: 'object',
        properties: {
          titre: { type: 'string' },
          contenu: { type: 'string' },
          publie: { type: 'boolean', description: 'Publier immédiatement (true par défaut).' },
        },
        required: ['titre', 'contenu'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enregistrer_absence_eleve',
      description:
        "Propose d'enregistrer une absence d'élève. eleve_id DOIT provenir d'un appel préalable à rechercher_eleve. Nécessite confirmation de l'admin avant exécution.",
      parameters: {
        type: 'object',
        properties: {
          eleve_id: { type: 'integer' },
          date_absence: { type: 'string', description: 'AAAA-MM-JJ' },
          motif: { type: 'string' },
          justifiee: { type: 'boolean' },
        },
        required: ['eleve_id', 'date_absence'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'signaler_incident_discipline',
      description:
        "Propose d'enregistrer un incident de discipline pour un élève. eleve_id DOIT provenir d'un appel préalable à rechercher_eleve. Nécessite confirmation de l'admin avant exécution.",
      parameters: {
        type: 'object',
        properties: {
          eleve_id: { type: 'integer' },
          date_incident: { type: 'string', description: 'AAAA-MM-JJ' },
          type_incident: {
            type: 'string',
            enum: ['absence_non_justifiee', 'retard_repete', 'violence', 'triche', 'comportement', 'autre'],
          },
          description: { type: 'string' },
          gravite: { type: 'string', enum: ['faible', 'moyenne', 'grave', 'tres_grave'] },
        },
        required: ['eleve_id', 'date_incident', 'type_incident'],
      },
    },
  },
];

const SYSTEM_PROMPT = `Tu es l'assistant interne de l'école COPEC, utilisé UNIQUEMENT par l'administrateur de l'établissement (accès déjà réservé à l'admin — aucun autre rôle n'a accès à cette conversation).

Ton rôle : être un copilote de direction extrêmement fiable, précis et pragmatique, puis aider concrètement l'administrateur à gérer et à résoudre des problèmes dans TOUS les domaines de l'école — élèves, enseignants, agents, parents, classes, matières, emploi du temps, salles, présences/absences, notes, devoirs, examens, finances/paiements des élèves, salaires et paie des enseignants, discipline, actualités, audit/traçabilité — en t'appuyant sur les outils disponibles. Comme l'admin, tu as accès à l'ensemble de ces données ; n'hésite pas à croiser plusieurs outils dans une même réponse si cela aide à répondre plus complètement ou à diagnostiquer un problème. N'invente jamais un chiffre ou une donnée : si l'information n'est pas disponible via un outil, dis-le clairement plutôt que de deviner. Pour toute date/heure relative, utilise date_heure_ecole ou les données serveur ; ne te base jamais sur l'horloge du PC de l'admin. Quand une question nécessite plusieurs sources, enchaîne les outils plutôt que de donner une réponse partielle. Si la question est ambiguë, demande la précision minimale nécessaire (nom + matricule si besoin).

Les données de salaire/paie sont sensibles : tu peux les utiliser librement ici car c'est l'admin qui te parle, mais ne les répète jamais hors de cette conversation ni ne les mélange avec des réponses destinées à d'autres rôles (l'application ne propose de toute façon cet assistant qu'à l'admin).

Tu es aussi un CONSEILLER, pas seulement un outil de consultation — c'est même ton rôle le plus important : tu as accès simultanément à TOUTES les données de l'école (élèves, présences, notes, finances, paie, discipline, audit...) alors que l'admin, lui, doit consulter ces domaines un par un dans l'interface. Tu peux donc souvent voir des liens ou des problèmes qu'il ne verrait pas seul en croisant plusieurs sources à la fois — utilise activement cet avantage.

Pour une demande de situation générale, de tableau de bord, de « comment va l'école ? » ou d'ouverture de l'assistant, utilise en priorité tableau_bord_assistant puis approfondis uniquement les indicateurs anormaux.

Dès que l'admin décrit un problème, une inquiétude ou une situation à régler (pas seulement fraude/corruption — aussi désorganisation, retards, mauvais résultats d'une classe, absentéisme des élèves, conflit d'emploi du temps, impayés, sous-effectif, etc.), suis TOUJOURS ce raisonnement avant de répondre :
1. INVESTIGUER — identifie tous les outils de lecture pertinents (souvent plus d'un) et appelle-les pour rassembler des faits précis ; ne réponds jamais uniquement à partir d'une impression générale.
2. CROISER — si un chiffre semble anormal, vérifie-le sous un autre angle avec un second outil avant de le présenter comme significatif (ex. une dépense élevée : compare-la à la moyenne récente ; un enseignant absent : vérifie aussi ses affectations et son historique de paie).
3. RÉPONDRE avec cette structure courte, toujours dans cet ordre :
   - **Constat** : ce que montrent les données, en chiffres précis (pas de généralités).
   - **Cause probable** (si déductible des faits — sinon dis que la cause n'est pas déterminable avec les données disponibles).
   - **Soso-kevitra / Recommandations** : 2 à 4 actions concrètes, classées de la plus urgente à la moins urgente, formulées comme des actions que l'admin peut faire aujourd'hui (« convoquez... », « demandez un justificatif pour... », « vérifiez auprès de... », « bloquez/ajustez... »). Une action par ligne, pas de blabla autour.
Pour toute question de surveillance, de vérification ou de risque de fraude/corruption, appelle systématiquement surveillance_anomalies (et croise avec journal_audit, paie_bulletins, absences_enseignants, depenses_caisses selon le cas) avant de répondre. Présente toujours les constats comme des SIGNAUX À VÉRIFIER, jamais comme une accusation ou une certitude — les outils renvoient des faits bruts, l'interprétation finale et toute décision (sanction, convocation, etc.) reviennent à l'admin. Ne recommande jamais une sanction précise (renvoi, retenue sur salaire...) — seulement des étapes de vérification ou d'action administrative (convocation, demande d'explication, mise en garde).

Si la question ne concerne pas la gestion de cette école (culture générale, actualité, politique, une autre organisation, etc.), refuse poliment et rappelle en une phrase que tu réponds uniquement aux questions liées à la gestion de l'école COPEC. Ne réponds jamais à une question de culture générale même si tu penses en connaître la réponse.

Tu peux aussi, à la demande de l'admin, RÉDIGER DES LEÇONS ET DES EXERCICES pour n'importe quelle classe/matière de l'école (ex. « fais-moi une leçon de géométrie pour la 6ème », « donne-moi 5 exercices de conjugaison pour le CM2 »). Règles pour cet usage :
1. Avant de rédiger, vérifie la classe et/ou la matière demandées avec liste_classes / liste_matieres si tu n'es pas sûr qu'elles existent réellement à l'école — ne rédige jamais pour une classe ou une matière qui n'existe pas dans la base.
2. Ce contenu vient de tes connaissances générales, PAS du programme scolaire officiel malgache que tu ne connais pas précisément : dis-le clairement en une courte phrase à la fin (« torolàlana fototra ihany, jereo indray mba hifanaraka amin'ny programme ofisialy »), sans que cela alourdisse le reste de la réponse.
3. Structure une leçon simplement : objectif, contenu/explication, un ou deux exemples, puis les exercices avec leur correction séparée à la fin (pas mélangée aux énoncés).
4. Adapte le niveau de langue et de difficulté à la classe demandée.
5. Cette activité n'écrit jamais rien en base (ce n'est pas une actualité ni un devoir enregistré) — c'est un contenu que l'admin peut copier/transmettre lui-même.

Tu peux aussi RÉDIGER DES TARATASY/COURRIERS pour l'admin (convocation à un parent ou à un enseignant, lettre d'information, rappel de paiement, courrier de mise en garde disciplinaire...) : utilise rechercher_eleve ou liste_enseignants/liste_agents pour obtenir les noms exacts, appuie-toi sur les données réelles disponibles (montant dû, nombre d'absences...) sans jamais inventer un chiffre, et rédige un texte prêt à copier — poli, clair, adapté au destinataire. Comme pour les leçons, ceci n'écrit rien en base ; c'est à l'admin de l'envoyer lui-même.

Tu peux TRADUIRE (français ↔ malagasy) n'importe quel texte que l'admin te donne ou que tu as toi-même généré, sur simple demande.

Tu peux FAIRE UN COMPTE-RENDU/RÉSUMÉ pour une réunion ou un rapport (ex. « fais un résumé pour la réunion des enseignants sur les résultats du mois dernier ») : identifie les outils pertinents (notes_recentes, moyennes_eleves, absences_eleves, tendance_absences_eleves, finances_resume, discipline_incidents selon le sujet), rassemble les faits, puis rédige un texte suivi et lisible (pas juste une liste de chiffres bruts) que l'admin peut lire ou distribuer tel quel.

Tu disposes aussi d'outils D'ÉCRITURE (créer une actualité, enregistrer une absence, signaler un incident de discipline). Règles STRICTES pour ces outils :
1. Ils ne modifient JAMAIS la base immédiatement quand tu les appelles — ta demande est seulement mise en attente de confirmation par l'admin via l'interface. Tu n'as donc pas à demander la permission avant de les appeler, mais tu dois toujours, dans ta réponse finale, résumer clairement et précisément ce que tu proposes de faire (quoi, pour qui, quand) et indiquer que l'admin doit confirmer via les boutons affichés.
2. N'appelle JAMAIS un outil d'écriture nécessitant un eleve_id sans avoir d'abord appelé rechercher_eleve pour obtenir l'identifiant exact. Si la recherche renvoie plusieurs élèves possibles ou aucun, NE PROPOSE AUCUNE ACTION : demande d'abord à l'admin de préciser (matricule de préférence).
3. Ne propose qu'UNE SEULE action d'écriture à la fois.
4. Ne propose jamais d'action si des informations essentielles manquent (ex. date) — demande-les d'abord.

Pour une simple question factuelle (« combien d'élèves », « liste des... »), réponds directement sans forcer la structure Constat/Cause/Soso-kevitra — cette structure ne s'applique qu'aux problèmes à résoudre. Réponds toujours de façon brève, claire et directement utile pour un administrateur (listes ou chiffres quand c'est pertinent, pas de longs paragraphes) — sauf pour une leçon/exercice demandée explicitement, où un contenu plus long et structuré est normal. Réponds dans la même langue que la question posée (français ou malagasy).

IMPORTANT — NE RECOPIE JAMAIS UNE LISTE BRUTE ENTIÈRE dans ta réponse, même si l'outil te renvoie beaucoup de lignes (ex. liste_eleves, journal_audit, emploi_du_temps...). Ces réponses volumineuses restent dans l'historique de conversation et finissent par faire planter l'assistant (erreur « payload trop volumineux »). À la place :
- Donne d'abord le total/chiffre clé (« 87 élèves trouvés »).
- Cite au maximum 8 à 10 éléments les plus pertinents (les premiers, les plus récents, ou ceux qui répondent le mieux à la question), jamais la totalité.
- Termine par une phrase du type « Précisez un filtre (classe, nom...) si vous voulez une liste plus ciblée, ou consultez la page correspondante dans l'application pour l'export complet. »
Cette règle de concision s'applique à toutes les réponses de type liste, y compris dans un compte-rendu — reste toujours synthétique, jamais exhaustif.`;

async function callGroq(messages) {
  return callGroqShared(messages, { tools: TOOLS, temperature: 0.15, max_tokens: 3000 });
}

// Filet de sécurité final : si, malgré les troncatures ci-dessus, Groq renvoie quand même
// une erreur 413 (payload trop volumineux), on retente UNE fois avec un message minimal
// (system + question de l'admin seule, sans historique ni résultats d'outils accumulés)
// plutôt que de faire échouer toute la réponse et d'obliger l'admin à cliquer sur la
// poubelle pour une question qui, elle, était pourtant simple.
async function callGroqAvecRetry(messages, userMessage) {
  try {
    return await callGroq(messages);
  } catch (err) {
    if (err.status !== 413) throw err;
    const system = messages[0];
    return callGroq([system, { role: 'user', content: userMessage }]);
  }
}

const MAX_TOOL_ROUNDS = 8;

/**
 * askAssistant(userMessage, history, adminUser)
 * history: [{ role: 'user'|'assistant', content }] — déjà chargé depuis la base (voir loadHistory).
 * adminUser: req.user (authentifié, role 'admin').
 * Retourne { reply: string, pendingAction: { id, tool, args } | null }.
 * pendingAction n'est JAMAIS exécuté ici — voir executeConfirmedAction().
 */
// ---------------------------------------------------------------------------
// Limite la taille de l'historique envoyé à Groq à chaque appel.
//
// Pourquoi : l'historique (table assistant_conversation) persiste TOUTES les
// réponses passées de l'assistant pour un admin, y compris d'anciennes
// réponses volumineuses (ex. une longue liste d'élèves, un compte-rendu
// détaillé...). Sur un compte utilisé depuis longtemps, ces 16 derniers
// échanges peuvent à eux seuls dépasser la limite de taille de requête de
// l'API Groq -> erreur 413 (Payload Too Large), même pour une toute petite
// question. On coupe donc chaque message trop long ET on limite le budget
// total de caractères de l'historique (en gardant les échanges les plus
// récents), en plus de la limite de 16 échanges déjà en place.
// ---------------------------------------------------------------------------
const MAX_CHARS_PAR_MESSAGE = 4000;
const MAX_CHARS_HISTORIQUE_TOTAL = 24000;

// ---------------------------------------------------------------------------
// Troncature des résultats d'outils DANS LE TOUR EN COURS.
//
// Pourquoi : buildBoundedHistory() ci-dessus ne borne que les messages déjà
// sauvegardés en base (user/assistant). Mais un seul appel à askAssistant()
// peut enchaîner jusqu'à MAX_TOOL_ROUNDS tours d'outils, et chaque outil de
// lecture peut renvoyer beaucoup de lignes (liste_eleves, journal_audit,
// surveillance_anomalies qui cumule 4 requêtes...). Sans limite, CE payload
// grossit sans borne pendant un seul échange, même avec un historique vide
// -> c'était la cause la plus fréquente du 413, pas l'historique.
// ---------------------------------------------------------------------------
const TOOL_RESULT_MAX_CHARS = 6000; // taille max d'un résultat d'outil au moment où il est ajouté au tour en cours
const TOOL_RESULT_MAX_CHARS_ANCIEN = 1200; // re-compression d'un résultat une fois son tour terminé (le modèle l'a déjà exploité pour décider de la suite)

function tronqueTexte(texte, maxChars, note) {
  if (texte.length <= maxChars) return texte;
  return `${texte.slice(0, maxChars)}…${note}`;
}

function buildBoundedHistory(history) {
  const tronque = (texte) => (
    texte.length > MAX_CHARS_PAR_MESSAGE
      ? `${texte.slice(0, MAX_CHARS_PAR_MESSAGE)}\n[…réponse tronquée, trop longue pour être renvoyée en contexte…]`
      : texte
  );

  const recents = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map((m) => ({ role: m.role, content: tronque(m.content) }));

  // Repart des plus récents vers les plus anciens, en ne gardant que ce qui
  // tient dans le budget total — évite de couper au milieu d'un échange.
  let budget = MAX_CHARS_HISTORIQUE_TOTAL;
  const retenus = [];
  for (let i = recents.length - 1; i >= 0; i--) {
    const taille = recents[i].content.length;
    if (retenus.length > 0 && budget - taille < 0) break;
    budget -= taille;
    retenus.unshift(recents[i]);
  }
  return retenus;
}


async function fallbackAssistant(userMessage) {
  const text = String(userMessage || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const secours = "Mode secours actif : le service IA externe est momentanément indisponible. Les chiffres ci-dessous proviennent directement de la base COPEC.";
  try {
    if (text.includes('heure') || text.includes('date') || text.includes("aujourd'hui") || text.includes('maintenant')) {
      const d = await READ_IMPLEMENTATIONS.date_heure_ecole();
      return `${secours}\n\n**Heure officielle COPEC** : ${d.jour} ${d.date} à ${d.heure} (${d.timezone}).`;
    }
    if (text.includes('eleve') && (text.includes('fiche') || text.includes('qui est') || text.includes('details') || text.includes('dossier'))) {
      const terme = String(userMessage).replace(/.*?eleve(?:s)?/i, '').replace(/^(de|du|d')\s*/i, '').trim();
      if (terme) {
        const d = await READ_IMPLEMENTATIONS.fiche_eleve({ terme });
        if (d.eleve) return `${secours}\n\n**${d.eleve.prenom || ''} ${d.eleve.nom}** — ${d.eleve.matricule} — classe ${d.eleve.classe || 'non renseignée'}.\nNotes : ${d.notes.length} matière(s). Présences : ${(d.absences || []).map((x) => `${x.statut}: ${x.total}`).join(' · ') || 'aucun pointage'}.`;
      }
    }
    if (text.includes('note') || text.includes('resultat')) {
      const d = await READ_IMPLEMENTATIONS.notes_recentes({ limite: 10 });
      return `${secours}\n\n**Notes récentes** : ${d.length} résultat(s) récupéré(s). ${d.slice(0, 6).map((x) => `${x.eleve_prenom || ''} ${x.eleve_nom} — ${x.matiere_nom} : ${x.note_valeur}/20`).join(' ; ')}`;
    }
    if (text.includes('emploi') || text.includes('edt') || text.includes('conflit')) {
      const data = await READ_IMPLEMENTATIONS.conflits_emploi_du_temps();
      const ens = data.conflits_enseignant.length;
      const salles = data.conflits_salle.length;
      return `${secours}\n\n**Constat** : ${ens} conflit(s) enseignant et ${salles} conflit(s) de salle détecté(s) dans l'emploi du temps actif.\n\n**Recommandation** : ouvrez « Emploi du temps » pour vérifier les créneaux signalés.`;
    }
    if (text.includes('finance') || text.includes('impaye') || text.includes('ecolage') || text.includes('caisse')) {
      const data = await READ_IMPLEMENTATIONS.finances_resume();
      const r = data.resume || {};
      const attendu = Number(r.total_attendu || 0).toLocaleString('fr-FR');
      const paye = Number(r.total_paye || 0).toLocaleString('fr-FR');
      return `${secours}\n\n**Constat** : ${paye} Ar perçus sur ${attendu} Ar attendus. ${data.top_impayes?.length || 0} dossier(s) apparaissent parmi les principaux impayés.\n\n**Recommandation** : vérifiez les dossiers impayés dans « Finances ».`;
    }
    if (text.includes('eleve') || text.includes('absence') || text.includes('presence')) {
      const [eff, abs] = await Promise.all([
        READ_IMPLEMENTATIONS.effectifs_generaux(),
        READ_IMPLEMENTATIONS.absences_eleves(),
      ]);
      const resume = (abs.resume || []).map((r) => `${r.statut}: ${r.count}`).join(' · ') || 'aucun pointage aujourd’hui';
      return `${secours}\n\n**Constat** : ${eff.total_eleves} élève(s) actif(s). Présences/absences élèves aujourd'hui : ${resume}.\n\n**Recommandation** : utilisez « Présences & Absences » pour le détail nominatif.`;
    }
    if (text.includes('enseignant') || text.includes('prof')) {
      const abs = await READ_IMPLEMENTATIONS.absences_enseignants();
      return `${secours}\n\n**Constat** : ${abs.length} absence(s) enseignant enregistrée(s) aujourd'hui.\n\n**Recommandation** : consultez « Présences & Absences » pour vérifier les motifs et justificatifs.`;
    }
    if (text.includes('anomal') || text.includes('fraude') || text.includes('corruption')) {
      const data = await READ_IMPLEMENTATIONS.surveillance_anomalies({ jours: 30 });
      const total = Object.values(data).filter(Array.isArray).reduce((n, a) => n + a.length, 0);
      return `${secours}\n\n**Constat** : ${total} signal(s) factuel(s) à vérifier sur les 30 derniers jours. Il ne s'agit pas d'une preuve de fraude.\n\n**Recommandation** : ouvrez le Journal d'Audit et les modules concernés avant toute décision.`;
    }
    const data = await READ_IMPLEMENTATIONS.tableau_bord_assistant({ jours: 30 });
    return `${secours}\n\n**Situation rapide** : ${data.effectifs.total_eleves} élèves, ${data.effectifs.total_classes} classes, ${data.effectifs.total_enseignants} enseignants actifs. Emploi du temps : ${data.emploi_du_temps.cours} cours. Signaux à vérifier : ${Object.values(data.signaux).reduce((a, n) => a + Number(n || 0), 0)}.\n\nPour une analyse IA complète, réessayez lorsque le service Groq est disponible.`;
  } catch (err) {
    return `Le service IA est indisponible et le mode secours n'a pas pu lire toutes les données. Vérifiez PostgreSQL puis réessayez. (${err.message})`;
  }
}

async function askAssistant(userMessage, history = [], adminUser) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...buildBoundedHistory(history),
    { role: 'user', content: userMessage },
  ];

  let pendingAction = null;
  // Index du début du tour d'outils EN COURS dans `messages` — tout ce qui précède cet
  // index appartient à un tour déjà terminé et peut être re-compressé au tour suivant.
  let indexDebutTour = messages.length;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (round > 0) {
      for (let i = 0; i < indexDebutTour; i++) {
        const m = messages[i];
        if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > TOOL_RESULT_MAX_CHARS_ANCIEN) {
          messages[i] = { ...m, content: tronqueTexte(m.content, TOOL_RESULT_MAX_CHARS_ANCIEN, "[résultat d'un tour précédent, déjà exploité — compressé pour la suite]") };
        }
      }
    }

    let data;
    try {
      data = await callGroqAvecRetry(messages, userMessage);
    } catch (err) {
      if ([401, 403, 502, 503].includes(err.status)) {
        return { reply: await fallbackAssistant(userMessage), pendingAction: null, fallback: true };
      }
      throw err;
    }
    const choice = data.choices?.[0]?.message;
    if (!choice) throw new Error("Réponse inattendue de l'assistant.");

    if (choice.tool_calls?.length) {
      indexDebutTour = messages.length;
      messages.push({ role: 'assistant', content: choice.content || null, tool_calls: choice.tool_calls });

      for (const toolCall of choice.tool_calls) {
        const fnName = toolCall.function?.name;
        let args = {};
        try { args = JSON.parse(toolCall.function?.arguments || '{}'); } catch { /* arguments vides ou invalides */ }

        let result;
        if (READ_TOOL_NAMES.has(fnName)) {
          try {
            result = await READ_IMPLEMENTATIONS[fnName](args);
          } catch (err) {
            result = { error: `Erreur lors de l'exécution de l'outil : ${err.message}` };
          }
        } else if (WRITE_TOOL_NAMES.has(fnName)) {
          if (pendingAction) {
            result = { error: "Une seule action d'écriture peut être proposée à la fois. Fais confirmer ou annuler la précédente d'abord." };
          } else {
            const id = crypto.randomUUID();
            pendingAction = { id, tool: fnName, args, confirmation_token: createActionToken(adminUser, fnName, args, id) };
            result = {
              status: 'en_attente_de_confirmation',
              message:
                "Action préparée mais NON exécutée : elle attend la confirmation explicite de l'administrateur dans l'interface. Résume maintenant clairement cette proposition dans ta réponse finale.",
            };
          }
        } else {
          result = { error: `Outil inconnu : ${fnName}` };
        }

        const contenuTronque = tronqueTexte(
          JSON.stringify(result),
          TOOL_RESULT_MAX_CHARS,
          "[résultat tronqué, trop volumineux — synthétise, ou redemande avec un filtre plus précis (classe, nom, période...)]"
        );
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: contenuTronque });
      }
      continue; // reboucle : laisse le modèle formuler sa réponse finale
    }

    return { reply: choice.content?.trim() || "Je n'ai pas pu formuler de réponse.", pendingAction };
  }

  return { reply: "Désolé, je n'arrive pas à traiter cette demande pour le moment. Réessayez avec une question plus précise.", pendingAction: null };
}

/**
 * executeConfirmedAction(tool, args, adminUser)
 * Seule fonction qui écrit réellement en base — appelée uniquement après clic
 * explicite de l'admin sur "Ekena / Confirmer" côté frontend (voir routes/assistant.js).
 */
async function executeConfirmedAction(tool, args, adminUser, confirmationToken) {
  if (!WRITE_TOOL_NAMES.has(tool)) throw new Error('Action inconnue ou non autorisée.');
  verifyActionToken(confirmationToken, adminUser, tool, args);
  const result = await WRITE_IMPLEMENTATIONS[tool](args || {}, adminUser);
  try {
    await query(`INSERT INTO audit_log (utilisateur_id, action, table_nom, record_id, nouvelle_valeur) VALUES ($1,$2,$3,$4,$5)`, [adminUser.id, 'autre', 'assistant_action', null, JSON.stringify({ tool })]);
  } catch (_) { /* audit secondaire non bloquant */ }
  return result;
}

// ---------------------------------------------------------------------------
// Historique persisté (table assistant_conversation) — un fil par admin.
// ---------------------------------------------------------------------------

async function loadHistory(utilisateurId, limit = 30) {
  const { rows } = await query(
    `SELECT role, content FROM assistant_conversation WHERE utilisateur_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [utilisateurId, limit]
  );
  return rows.reverse();
}

async function saveMessage(utilisateurId, role, content) {
  await query(`INSERT INTO assistant_conversation (utilisateur_id, role, content) VALUES ($1,$2,$3)`, [utilisateurId, role, content]);
}

async function clearHistory(utilisateurId) {
  await query(`DELETE FROM assistant_conversation WHERE utilisateur_id = $1`, [utilisateurId]);
}

module.exports = {
  askAssistant,
  executeConfirmedAction,
  loadHistory,
  saveMessage,
  clearHistory,
  WRITE_TOOL_NAMES,
};
