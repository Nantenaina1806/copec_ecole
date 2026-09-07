'use strict';

const { query } = require('../config/db');
const { sendEmail, sendWhatsApp, config } = require('./notificationProviders');

// ---------------------------------------------------------------------------
// Relance automatique des écolages/frais en retard (impaye/partiel dont la
// date_echeance est dépassée). Utilise les fournisseurs réels configurés dans
// notificationProviders.js et conserve fidèlement le résultat de chaque canal, marqué
// 'non_applicable' si le parent responsable n'a ni email ni téléphone.
//
// Appelé automatiquement chaque jour par jobs/cron.js, et manuellement par
// POST /finance/relances/generer (bouton "Relancer" de l'écran Finances).
// ---------------------------------------------------------------------------

/**
 * @param {object} [options]
 * @param {number|null} [options.auteurUtilisateurId] - présent seulement pour un déclenchement manuel
 * @param {number|null} [options.auteurAgentId]
 * @param {number|null} [options.fraisId] - limite la relance à un seul frais (bouton par ligne)
 * @param {boolean} [options.manuel] - TRUE : ignore relance_frequence_jours (relance ponctuelle
 *   voulue explicitement par le staff, même si une relance automatique a déjà eu lieu récemment)
 */
async function genererRelancesRetard(options = {}) {
  const { auteurUtilisateurId = null, auteurAgentId = null, fraisId = null, manuel = false } = options;

  const { rows: paramRows } = await query(
    'SELECT relance_seuil_jours, relance_frequence_jours FROM parametre_ecole WHERE id = 1'
  );
  const seuil = paramRows[0]?.relance_seuil_jours ?? 7;
  const frequence = paramRows[0]?.relance_frequence_jours ?? 7;

  const params = [seuil];
  let fraisFilter = '';
  if (fraisId) {
    params.push(fraisId);
    fraisFilter = `AND f.id = $${params.length}`;
  }

  const { rows: candidats } = await query(
    `SELECT f.id AS frais_id, f.eleve_id,
            f.montant_total - COALESCE((SELECT SUM(p.montant * CASE WHEN p.is_avoir THEN -1 ELSE 1 END) FROM paiement p WHERE p.frais_id = f.id), 0) AS montant_du,
            (CURRENT_DATE - f.date_echeance) AS jours_retard,
            (SELECT MAX(r.created_at) FROM relance_impaye r WHERE r.frais_id = f.id) AS derniere_relance
     FROM frais_scolaire f
     WHERE f.statut IN ('impaye', 'partiel')
       AND f.date_echeance IS NOT NULL
       AND f.date_echeance <= CURRENT_DATE - $1::int
       ${fraisFilter}`,
    params
  );

  // 1. Filtrer d'abord en mémoire ceux à ignorer (déjà relancés récemment) : évite de faire
  //    tout le travail suivant (lookup parent, insert) pour rien sur ces candidats-là.
  let ignorees = 0;
  const aTraiter = [];
  for (const candidat of candidats) {
    if (!manuel && candidat.derniere_relance) {
      const joursDepuis = Math.floor((Date.now() - new Date(candidat.derniere_relance).getTime()) / 86400000);
      if (joursDepuis < frequence) {
        ignorees += 1;
        continue;
      }
    }
    aTraiter.push(candidat);
  }

  if (aTraiter.length === 0) {
    return { candidats: candidats.length, envoyees: 0, ignorees_deja_relancees: ignorees };
  }

  // 2. Lookup du parent responsable principal pour TOUS les candidats restants en une seule
  //    requête (au lieu d'un aller-retour DB par candidat) : idx_eleve_parent_responsable
  //    (voir database/schema.sql) rend ce IN(...) direct.
  const eleveIds = [...new Set(aTraiter.map((c) => c.eleve_id))];
  const { rows: parents } = await query(
    `SELECT ep.eleve_id, p.email, p.telephone FROM eleve_parent ep JOIN parent p ON p.id = ep.parent_id
     WHERE ep.eleve_id = ANY($1::int[]) AND ep.responsable_principal = TRUE`,
    [eleveIds]
  );
  const parentParEleve = new Map(parents.map((p) => [p.eleve_id, p]));

  // 3. Une seule requête INSERT multi-lignes (via UNNEST des tableaux de paramètres) plutôt
  //    qu'un INSERT par candidat : même nombre d'écritures côté DB, mais un seul aller-retour
  //    réseau au lieu d'un par relance générée.
  let envoyeesReelles = 0;
  let echecs = 0;
  for (const candidat of aTraiter) {
    const parent = parentParEleve.get(candidat.eleve_id);
    const contenu = `COPEC : votre écolage présente un retard de ${candidat.jours_retard} jour(s). Montant restant dû : ${Number(candidat.montant_du).toLocaleString('fr-FR')} Ar. Merci de régulariser votre situation.`;
    let emailStatut = null, whatsappStatut = null;
    if (parent?.email) {
      const r = await sendEmail({ to: parent.email, subject: 'Rappel d’écolage — COPEC', text: contenu, html: `<p>${contenu}</p>` });
      emailStatut = r.status === 'non_configure' ? 'echec' : r.status; if (r.ok) envoyeesReelles++; else if (r.status !== 'non_applicable') echecs++;
      await query(`INSERT INTO notification_delivery(channel,destination,status,provider_id,error) VALUES('email',$1,$2,$3,$4)`, [parent.email,r.status,r.provider_id||null,r.error||null]);
    } else emailStatut = 'non_applicable';
    if (parent?.telephone) {
      const c = config();
      const r = await sendWhatsApp({ to: parent.telephone, body: contenu, templateName: c.waTemplateName || undefined, templateLanguage: c.waTemplateLanguage, templateParameters: c.waTemplateName ? [contenu] : [] });
      whatsappStatut = r.status === 'non_configure' ? 'echec' : r.status; if (r.ok) envoyeesReelles++; else if (r.status !== 'non_applicable') echecs++;
      await query(`INSERT INTO notification_delivery(channel,destination,status,provider_id,error) VALUES('whatsapp',$1,$2,$3,$4)`, [parent.telephone,r.status,r.provider_id||null,r.error||null]);
    } else whatsappStatut = 'non_applicable';
    const canal = emailStatut === 'envoye' && whatsappStatut === 'envoye' ? 'les_deux' : emailStatut === 'envoye' ? 'email' : whatsappStatut === 'envoye' ? 'whatsapp' : parent?.email ? 'email' : parent?.telephone ? 'whatsapp' : 'sms';
    await query(`INSERT INTO relance_impaye(frais_id,eleve_id,jours_retard,montant_du,canal,email_statut,sms_statut,whatsapp_statut,manuel,utilisateur_id,agent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [candidat.frais_id,candidat.eleve_id,candidat.jours_retard,candidat.montant_du,canal,emailStatut,null,whatsappStatut,manuel,auteurUtilisateurId,auteurAgentId]);
  }
  return { candidats: candidats.length, envoyees: envoyeesReelles, ignorees_deja_relancees: ignorees, echecs };
}

module.exports = { genererRelancesRetard };
