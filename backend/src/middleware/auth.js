const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const permissionCache = new Map();
const PERMISSION_CACHE_MS = 60_000;

/**
 * Vérifie le token JWT et attache req.user = { id, type, role, email, nom, prenom }
 * type: 'utilisateur' (admin/enseignant) | 'agent' | 'eleve'
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const cookieHeader = req.headers.cookie || '';
  const cookieToken = cookieHeader.split(';').map((x) => x.trim()).find((x) => x.startsWith('copec_session='))?.slice('copec_session='.length) || null;
  const token = header.startsWith('Bearer ') ? header.slice(7) : cookieToken;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Défense en profondeur : un token techniquement valide mais dont le
    // payload ne correspond pas à ce que signToken() produit (ex: signé avec
    // un ancien format, ou falsifié avec un secret devenu invalide entre-temps)
    // ne doit pas être accepté silencieusement.
    if (!payload || typeof payload.id === 'undefined' || !payload.role || !payload.type) {
      return res.status(401).json({ error: 'Token invalide ou expiré.' });
    }
    // Révocation côté serveur : le changement/réinitialisation du mot de passe
    // incrémente security_version et invalide immédiatement les anciens JWT.
    const table = payload.type === 'utilisateur' ? 'utilisateur' : payload.type === 'agent' ? 'agent' : null;
    if (table) {
      query(`SELECT actif, security_version FROM ${table} WHERE id=$1`, [payload.id]).then(({ rows }) => {
        const row = rows[0];
        if (!row || !row.actif || Number(row.security_version || 0) !== Number(payload.security_version || 0)) {
          return res.status(401).json({ error: 'Session révoquée, veuillez vous reconnecter.' });
        }
        req.user = payload; return next();
      }).catch(next);
      return;
    }
    req.user = payload;
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter.' });
    }
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

/**
 * Autorise uniquement certains rôles applicatifs.
 * Exemples de roles: 'admin', 'enseignant', 'secretaire', 'economie', 'surveillant', 'eleve'
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentification requise.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Accès refusé : vous n'avez pas les droits pour cette action." });
    }
    return next();
  };
}

function authorizePermission(permission) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
    if (req.user.role === 'admin') return next();
    try {
      const cached = permissionCache.get(req.user.role);
      let permissions = cached && cached.expires > Date.now() ? cached.value : null;
      if (!permissions) {
        const { rows } = await query('SELECT p.code FROM permission p JOIN role_permission rp ON rp.permission_id=p.id WHERE rp.role=$1', [req.user.role]);
        permissions = new Set(rows.map((r) => r.code));
        permissionCache.set(req.user.role, { value: permissions, expires: Date.now() + PERMISSION_CACHE_MS });
      }
      if (!permissions.has(permission)) return res.status(403).json({ error: `Accès refusé : permission ${permission} requise.` });
      return next();
    } catch (err) { return next(err); }
  };
}
function invalidatePermissionCache() { permissionCache.clear(); }

// Regroupements pratiques
const ROLES_ADMIN = ['admin'];
const ROLES_AGENTS = ['secretaire', 'economie', 'surveillant', 'accueil'];
const ROLES_ADMIN_AGENT = [...ROLES_ADMIN, ...ROLES_AGENTS];
const ROLES_ADMIN_ENSEIGNANT = ['admin', 'enseignant'];
const ROLES_TOUS_STAFF = ['admin', 'enseignant', ...ROLES_AGENTS];
// Resaka vola (frais, paiements, dépenses, caisse, paie enseignant) : admin + economie ihany —
// tsy an'ny secretaire na ny surveillant intsony (fitsinjaran-draharaha isaky ny agent).
const ROLES_FINANCE = ['admin', 'economie'];
// Un enseignant peut consulter SA PROPRE paie (grille, heures, bulletins) sans avoir les
// droits finance complets — les routes qui utilisent ce groupe forcent enseignant_id =
// req.user.id côté serveur quand req.user.role === 'enseignant', pour qu'il ne puisse
// jamais lire la paie d'un collègue en changeant le paramètre de la requête.
const ROLES_FINANCE_ENSEIGNANT = [...ROLES_FINANCE, 'enseignant'];
// Bulletins (lecture, génération par classe) : admin + secretaire ihany — tsy an'ny economie
// na ny surveillant (fitsinjaran-draharaha isaky ny agent).
const ROLES_BULLETINS = ['admin', 'secretaire'];

module.exports = {
  authenticate,
  authorize,
  authorizePermission,
  invalidatePermissionCache,
  ROLES_ADMIN,
  ROLES_AGENTS,
  ROLES_ADMIN_AGENT,
  ROLES_ADMIN_ENSEIGNANT,
  ROLES_TOUS_STAFF,
  ROLES_FINANCE,
  ROLES_FINANCE_ENSEIGNANT,
  ROLES_BULLETINS,
};
