// Cache local (offline-first) du descripteur facial de référence, pour ne pas
// dépendre du réseau à chaque accès au Pointage. Le matching lui-même reste
// toujours 100% côté client (voir utils/faceMatch.js).
//
// Sur un NOUVEL appareil (compte connecté ailleurs), le cache est vide -> une
// connexion réseau est nécessaire une première fois pour récupérer le descripteur
// depuis le serveur (GET /auth/selfie-statut), ensuite tout fonctionne hors-ligne.

const PREFIX = 'copec_selfie_descriptor_';

export function lireDescripteurCache(userId) {
  try {
    const raw = localStorage.getItem(PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function ecrireDescripteurCache(userId, descriptor) {
  try {
    localStorage.setItem(PREFIX + userId, JSON.stringify(descriptor));
  } catch {
    // stockage plein/indisponible : tant pis, on retombera sur le réseau
  }
}

export function effacerDescripteurCache(userId) {
  localStorage.removeItem(PREFIX + userId);
}
