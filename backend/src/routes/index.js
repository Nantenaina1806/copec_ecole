const express = require('express');
const { createCrudRouter } = require('../utils/genericCrud');

const router = express.Router();

// --- Modules métier complets (logique RG spécifique) ---
router.use('/auth', require('./auth'));
router.use('/auth/reset-password', require('./authReset'));
router.use('/utilisateurs', require('./utilisateurs'));
router.use('/permissions', require('./permissions'));
router.use('/agents', require('./agents'));
router.use('/annees-scolaires', require('./anneesScolaires'));
router.use('/classes', require('./classes'));
router.use('/eleves', require('./eleves'));
router.use('/inscriptions', require('./inscriptions'));
router.use('/affectations', require('./affectations'));
router.use('/emploi-du-temps', require('./emploiDuTemps'));
router.use('/pointage', require('./pointage'));
router.use('/salles', require('./salles'));
router.use('/notes', require('./notes'));
router.use('/devoirs', require('./devoirs'));
router.use('/absences', require('./absences'));
router.use('/finance', require('./finance'));
router.use('/paie', require('./paie'));
router.use('/bulletins', require('./bulletins'));
router.use('/verification-bulletins', require('./verificationBulletins'));
router.use('/parents', require('./parents'));
router.use('/examens', require('./examens'));
router.use('/vie-scolaire', require('./vieScolaire'));
router.use('/communication', require('./communication'));
router.use('/rapports', require('./rapports'));
router.use('/audit', require('./audit'));
router.use('/historique', require('./historique'));
router.use('/statistiques', require('./statistiques'));
router.use('/documents', require('./documents'));
router.use('/certificats', require('./certificats'));
router.use('/dashboard', require('./dashboard'));
router.use('/pilotage', require('./pilotage'));
router.use('/system', require('./system'));
router.use('/sync', require('./sync'));
// Endpoints HTTP dédiés à l'appli mobile enseignant (push/pull SQLite <-> central).
// Séparés de ./sync (qui sert le statut/déclenchement de la sync PC<->central via
// connexion PostgreSQL directe) car le mobile n'a jamais de connexion pg directe.
router.use('/sync', require('./syncMobile'));
router.use('/visiteurs', require('./visiteurs'));
router.use('/recherche', require('./recherche'));
router.use('/parametres', require('./parametres'));
router.use('/assistant', require('./assistant'));
router.use('/assistant-public', require('./assistantPublic'));

// --- Tables de référence simples (CRUD générique) ---
router.use('/cycles', createCrudRouter({ table: 'cycle', columns: ['nom', 'ordre'], orderBy: 'ordre' }));
router.use('/niveaux', createCrudRouter({ table: 'niveau', columns: ['cycle_id', 'nom', 'ordre'], orderBy: 'cycle_id, ordre' }));
router.use('/bimestres', createCrudRouter({
  table: 'bimestre',
  columns: ['annee_scolaire_id', 'numero', 'libelle', 'date_debut', 'date_fin', 'actif'],
  orderBy: 'annee_scolaire_id DESC, numero',
}));
router.use('/matieres', require('./matieres'));
router.use('/categories-depense', createCrudRouter({ table: 'categorie_depense', columns: ['nom', 'actif'], orderBy: 'nom' }));
// NB : la gestion des caisses (avec solde calculé) est exposée sous /finance/caisses (voir routes/finance.js)

module.exports = router;
