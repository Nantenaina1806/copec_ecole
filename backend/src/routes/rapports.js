const express = require('express');
const { query, pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { envoyerRapportSchema } = require('../validation/rapports.schemas');
const { deliverToParent } = require('../services/communicationDelivery');

const router = express.Router();

// GET /rapports -> historique des envois (avec le nom de l'auteur, admin ou agent).
router.get('/', authenticate, authorize('admin', 'secretaire', 'surveillant'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT er.*,
            COALESCE(u.nom, ag.nom) AS auteur_nom,
            COALESCE(u.prenom, ag.prenom) AS auteur_prenom
     FROM envoi_rapport er
     LEFT JOIN utilisateur u ON u.id = er.auteur_id
     LEFT JOIN agent ag ON ag.id = er.agent_id
     ORDER BY er.created_at DESC`
  );
  res.json(rows);
}));

/**
 * POST /rapports/envoyer -> envoi groupé (bulletin/relevé/actualité) à un scope de destinataires.
 * Les canaux externes sont réellement appelés par services/notificationProviders.js. Si un
 * fournisseur ou un contact manque, le détail conserve explicitement l'échec/non-applicable.
 *
 * Correctif : l'auteur peut être un compte "utilisateur" (admin) OU un "agent" (secrétaire,
 * surveillant...) — l'ancien code écrivait toujours req.user.id dans auteur_id (FK -> utilisateur),
 * ce qui provoquait une violation de contrainte pour tout envoi fait par un agent. On distingue
 * maintenant auteur_id/agent_id comme pour les actualités.
 */
router.post('/envoyer', authenticate, authorize('admin', 'secretaire', 'surveillant'), validate({ body: envoyerRapportSchema }), asyncHandler(async (req, res) => {
  const { scope_type, scope_valeur, contenu, canal, bimestre_id } = req.body;
  let eleveIds = [];
  if (scope_type === 'tous') {
    const { rows } = await query(`SELECT id FROM eleve WHERE actif = TRUE`); eleveIds = rows.map(r => r.id);
  } else if (scope_type === 'classe') {
    const { rows } = await query(`SELECT eleve_id AS id FROM inscription WHERE classe_id=$1 AND statut='inscrit'`, [scope_valeur]); eleveIds=rows.map(r=>r.id);
  } else if (scope_type === 'niveau') {
    const { rows } = await query(`SELECT i.eleve_id AS id FROM inscription i JOIN classe c ON c.id=i.classe_id WHERE c.niveau_id=$1 AND i.statut='inscrit'`, [scope_valeur]); eleveIds=rows.map(r=>r.id);
  } else if (scope_type === 'eleve') eleveIds=[Number(scope_valeur)];
  else if (scope_type === 'selection') {
    try { const parsed=JSON.parse(scope_valeur||'[]'); if(!Array.isArray(parsed)) throw new Error(); eleveIds=parsed.map(Number).filter(Number.isInteger); }
    catch { throw new ApiError(400, 'scope_valeur invalide.'); }
  }
  const { rows: envoiRows } = await query(`INSERT INTO envoi_rapport(auteur_id,agent_id,scope_type,scope_valeur,contenu,canal,bimestre_id,nb_destinataires) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [req.user.type==='utilisateur'?req.user.id:null, req.user.type==='agent'?req.user.id:null, scope_type,String(scope_valeur||''),contenu,canal,bimestre_id||null,eleveIds.length]);
  const envoiId=envoiRows[0].id; let nbEmail=0,nbWhatsapp=0,nbEchecs=0;
  for (const eleveId of eleveIds) {
    const { rows: parents } = await query(`SELECT p.id,p.email,p.telephone,p.nom,p.prenom FROM eleve_parent ep JOIN parent p ON p.id=ep.parent_id WHERE ep.eleve_id=$1 AND ep.responsable_principal=TRUE LIMIT 1`, [eleveId]);
    const parent=parents[0]; let emailStatus=null,waStatus=null,errors=[];
    let canalReussi = false;
    if (canal==='email'||canal==='les_deux') {
      const r=parent?.email ? await deliverToParent({parent:{email:parent.email},contenu,subject:'Communication COPEC'}).then(x=>x.email) : {status:'non_applicable',error:'Email absent'};
      emailStatus=r.status === 'non_configure' ? 'echec' : r.status;
      if(r.ok) { nbEmail++; canalReussi = true; } else if(r.error) errors.push(`email: ${r.error}`);
      await query(`INSERT INTO notification_delivery(channel,destination,status,provider_id,error) VALUES('email',$1,$2,$3,$4)`, [parent?.email||null,r.status,r.provider_id||null,r.error||null]);
    }
    if (canal==='whatsapp'||canal==='les_deux') {
      const r=parent?.telephone ? await deliverToParent({parent:{telephone:parent.telephone},contenu}).then(x=>x.whatsapp) : {status:'non_applicable',error:'Téléphone absent'};
      waStatus=r.status === 'non_configure' ? 'echec' : r.status;
      if(r.ok) { nbWhatsapp++; canalReussi = true; } else if(r.error) errors.push(`whatsapp: ${r.error}`);
      await query(`INSERT INTO notification_delivery(channel,destination,status,provider_id,error) VALUES('whatsapp',$1,$2,$3,$4)`, [parent?.telephone||null,r.status,r.provider_id||null,r.error||null]);
    }
    if (!canalReussi) nbEchecs++;
    await query(`INSERT INTO envoi_rapport_detail(envoi_rapport_id,eleve_id,email_statut,whatsapp_statut,erreur) VALUES($1,$2,$3,$4,$5)`, [envoiId,eleveId,emailStatus,waStatus,errors.join('; ')||null]);
  }
  const { rows } = await query(`UPDATE envoi_rapport SET nb_envoyes_email=$1,nb_envoyes_whatsapp=$2,nb_echecs=$3 WHERE id=$4 RETURNING *`, [nbEmail,nbWhatsapp,nbEchecs,envoiId]);
  res.status(201).json(rows[0]);
}));
router.get('/:id/detail', authenticate, authorize('admin', 'secretaire', 'surveillant'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT erd.*, e.nom, e.prenom FROM envoi_rapport_detail erd JOIN eleve e ON e.id = erd.eleve_id
     WHERE erd.envoi_rapport_id = $1`,
    [req.params.id]
  );
  res.json(rows);
}));

module.exports = router;
