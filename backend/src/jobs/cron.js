const cron = require('node-cron');
const { cloturerScansExpires } = require('../services/presenceCron');
const { genererEtDiffuserResumeHebdomadaire } = require('../services/weeklySummaryService');
const { genererRelancesRetard } = require('../services/relanceService');
const { createBackup, purgeOldBackups } = require('../services/backupService');

/**
 * Enregistre les tâches planifiées de l'application.
 * Appelé une fois au démarrage du serveur (src/server.js).
 */
function demarrerCronJobs() {
  // Toutes les 15 minutes : ferme les fenêtres de scan expirées
  // (absences automatiques + sorties manquantes à valider par un admin).
  cron.schedule('*/15 * * * *', async () => {
    try {
      const resultat = await cloturerScansExpires();
      if (resultat.absencesCreees || resultat.sortiesManquantesFlaggees) {
        console.log(
          `[cron presence] ${resultat.absencesCreees} absence(s) auto, ` +
          `${resultat.sortiesManquantesFlaggees} sortie(s) manquante(s) à valider.`
        );
      }
    } catch (err) {
      console.error('[cron presence] erreur:', err.message);
    }
  });

  // Tous les lundis à 6h : génère un résumé hebdomadaire (assistant IA) et le dépose
  // dans le fil de discussion de chaque admin actif — visible dès qu'il ouvre le widget.
  cron.schedule('0 6 * * 1', async () => {
    try {
      const resultat = await genererEtDiffuserResumeHebdomadaire();
      console.log(`[cron résumé hebdo] diffusé à ${resultat.diffuse} admin(s).`);
    } catch (err) {
      console.error('[cron résumé hebdo] erreur:', err.message);
    }
  });

  // Tous les jours à 7h : relance automatique des frais impayés/partiels en retard (voir
  // services/relanceService.js). Respecte relance_seuil_jours et relance_frequence_jours
  // (paramètres école) pour ne jamais spammer un même parent chaque jour.
  cron.schedule('0 7 * * *', async () => {
    try {
      const resultat = await genererRelancesRetard();
      if (resultat.envoyees) {
        console.log(`[cron relances] ${resultat.envoyees} relance(s) envoyée(s), ${resultat.ignorees_deja_relancees} ignorée(s) (déjà relancées récemment).`);
      }
    } catch (err) {
      console.error('[cron relances] erreur:', err.message);
    }
  });
  // Chaque nuit à 2h : sauvegarde PostgreSQL automatique si BACKUP_AUTO=true.
  // La rétention est contrôlée par BACKUP_RETENTION_DAYS (30 jours par défaut).
  cron.schedule('0 2 * * *', async () => {
    if (process.env.BACKUP_AUTO !== 'true') return;
    try {
      const backup = await createBackup();
      const deleted = await purgeOldBackups();
      console.log(`[cron backup] ${backup.filename} créé, ${deleted} ancien(s) supprimé(s).`);
    } catch (err) {
      console.error('[cron backup] erreur:', err.message);
    }
  });

}

module.exports = { demarrerCronJobs };
