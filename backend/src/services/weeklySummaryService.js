const { query } = require('../config/db');
const { askAssistant, saveMessage } = require('./assistantService');

const PROMPT_RESUME_HEBDO =
  "Manaova famintinana isan-kerinandro ho an'ny sekoly COPEC momba an'ireto lafiny ireto: " +
  "1) fivoaran'ny fahatongavan'ny mpianatra (tendance_absences_eleves), " +
  "2) mpianatra mahantra vokatra raha misy vaovao (moyennes_eleves), " +
  "3) fandoavam-bola (finances_resume), " +
  "4) raharaha discipline vaovao (discipline_incidents), " +
  "5) raha misy conflits_emploi_du_temps. " +
  "Ataovy fintina, mazava, misy lisitra fohy, tsy an-tsipirihany loatra — toy ny famintinana homena mpampianatra amin'ny fivoriana.";

/**
 * genererEtDiffuserResumeHebdomadaire()
 * Génère un résumé hebdomadaire en réutilisant le raisonnement + les outils de l'assistant
 * admin (askAssistant), puis le dépose comme message "assistant" dans le fil de discussion
 * de chaque admin actif — il apparaît donc automatiquement la prochaine fois qu'un admin
 * ouvre le widget, sans action requise de sa part. Aucune action d'écriture métier n'est
 * exécutée (l'assistant n'utilise ici que des outils de lecture).
 */
async function genererEtDiffuserResumeHebdomadaire() {
  const { rows: admins } = await query(
    `SELECT id, nom, prenom FROM utilisateur WHERE role = 'admin' AND actif = TRUE`
  );
  if (!admins.length) return { diffuse: 0 };

  // Un seul appel au modèle : le contenu du résumé est le même pour tous les admins,
  // adminUser n'est utilisé ici que si un outil d'écriture était appelé (ce qui n'arrive
  // pas pour cette question), donc le premier admin actif suffit comme contexte d'appel.
  const { reply } = await askAssistant(PROMPT_RESUME_HEBDO, [], admins[0]);
  const texte = `📅 Famintinana isan-kerinandro (automatika)\n\n${reply}`;

  await Promise.all(admins.map((a) => saveMessage(a.id, 'assistant', texte)));

  return { diffuse: admins.length };
}

module.exports = { genererEtDiffuserResumeHebdomadaire };
