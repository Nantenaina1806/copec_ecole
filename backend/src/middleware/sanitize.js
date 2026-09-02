// ---------------------------------------------------------------------------
// Assainissement générique des entrées, appliqué globalement à req.body,
// req.query et req.params AVANT les validateurs Zod de chaque route.
//
// Rôle exact (défense en profondeur, ne remplace pas la validation Zod) :
//   1. Bloque la pollution de prototype (__proto__ / constructor / prototype
//      comme clé d'objet), un vecteur classique d'attaque sur du JSON non filtré.
//   2. Retire les caractères de contrôle et les octets nuls des chaînes
//      (peuvent casser des colonnes SQL, des exports, des logs).
//   3. Retire les balises <script> brutes et handlers "javascript:" des
//      chaînes — utile car plusieurs champs texte libre (observations,
//      messages, actualités...) sont réaffichés tels quels côté frontend.
//   4. Trim les chaînes.
//
// Les requêtes PostgreSQL du projet utilisent déjà systématiquement des
// requêtes paramétrées ($1, $2...), donc l'injection SQL classique n'est pas
// le risque ici — ce middleware cible le XSS stocké et la pollution d'objet.
// ---------------------------------------------------------------------------

const CLES_INTERDITES = new Set(['__proto__', 'constructor', 'prototype']);

// eslint-disable-next-line no-control-regex
const CARACTERES_CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BALISE_SCRIPT = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const JAVASCRIPT_URI = /javascript\s*:/gi;

function nettoyerChaine(s) {
  return s.replace(CARACTERES_CONTROLE, '').replace(BALISE_SCRIPT, '').replace(JAVASCRIPT_URI, '').trim();
}

function nettoyer(valeur, profondeur = 0) {
  if (profondeur > 20) return valeur; // garde-fou anti objets circulaires/trop imbriqués

  if (typeof valeur === 'string') return nettoyerChaine(valeur);

  if (Array.isArray(valeur)) return valeur.map((v) => nettoyer(v, profondeur + 1));

  if (valeur && typeof valeur === 'object') {
    const resultat = {};
    for (const cle of Object.keys(valeur)) {
      if (CLES_INTERDITES.has(cle)) continue; // supprime silencieusement, ne bloque pas la requête
      resultat[cle] = nettoyer(valeur[cle], profondeur + 1);
    }
    return resultat;
  }

  return valeur;
}

function sanitizeInput(req, res, next) {
  if (req.body && typeof req.body === 'object') req.body = nettoyer(req.body);
  if (req.query && typeof req.query === 'object') req.query = nettoyer(req.query);
  if (req.params && typeof req.params === 'object') req.params = nettoyer(req.params);
  next();
}

module.exports = { sanitizeInput };
