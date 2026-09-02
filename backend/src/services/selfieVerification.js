// ============================================================================
// Vérification selfie (2e facteur) avant pointage QR salle
// ============================================================================
// IMPORTANT — limite honnête de cette approche :
// Le matching facial (comparaison des 128 descripteurs) se fait CÔTÉ CLIENT
// (face-api.js, dans le navigateur du téléphone), pour rester 100% hors-ligne
// comme le reste du système de pointage. Le serveur ne reçoit donc PAS la photo
// à chaque scan, seulement le score de similarité calculé par le téléphone et
// l'heure de cette vérification. Le serveur applique des garde-fous (score dans
// le seuil attendu, vérification récente) mais ne peut pas re-calculer lui-même
// la comparaison faciale. Un téléphone compromis (JS modifié en DevTools) pourrait
// théoriquement forger ces valeurs — c'est un frein sérieux contre le "prêt de
// compte" occasionnel entre collègues, pas une biométrie inviolable de niveau
// bancaire. À documenter clairement pour la direction de l'école.

// Distance euclidienne max entre 2 descripteurs faciaux pour considérer que
// c'est la même personne (face-api.js recommande ~0.6 ; on est plus strict).
const SEUIL_MATCH_DEFAUT = 0.5;

// Durée de validité d'une preuve de vérification selfie avant un scan QR.
// Empêche de réutiliser un vieux "succès" de vérification plus tard dans la journée.
const FRAICHEUR_MAX_MINUTES = 3;

const TAILLE_DESCRIPTEUR = 128; // face-api.js : FaceRecognitionNet -> Float32Array(128)

/**
 * Vérifie que le descripteur envoyé a la forme attendue (128 nombres finis).
 */
function descripteurValide(descriptor) {
  return Array.isArray(descriptor)
    && descriptor.length === TAILLE_DESCRIPTEUR
    && descriptor.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Valide la "preuve de vérification selfie" jointe à un scan de pointage.
 * Retourne { valide: boolean, raison?: string }
 *
 * @param {object} preuve - { verifie_a: string(ISO), score: number }
 * @param {Date} maintenant - horloge serveur (référence fiable)
 */
function validerPreuveSelfie(preuve, maintenant = new Date()) {
  if (!preuve || typeof preuve !== 'object') {
    return { valide: false, raison: 'selfie_manquante' };
  }
  const { verifie_a, score } = preuve;

  if (!verifie_a || Number.isNaN(Date.parse(verifie_a))) {
    return { valide: false, raison: 'selfie_horodatage_invalide' };
  }
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
    return { valide: false, raison: 'selfie_score_invalide' };
  }
  if (score > SEUIL_MATCH_DEFAUT) {
    return { valide: false, raison: 'selfie_visage_non_reconnu' };
  }

  const ecartMinutes = Math.abs(maintenant.getTime() - new Date(verifie_a).getTime()) / 60000;
  if (ecartMinutes > FRAICHEUR_MAX_MINUTES) {
    return { valide: false, raison: 'selfie_expiree' };
  }

  return { valide: true };
}

module.exports = {
  SEUIL_MATCH_DEFAUT,
  FRAICHEUR_MAX_MINUTES,
  TAILLE_DESCRIPTEUR,
  descripteurValide,
  validerPreuveSelfie,
};
