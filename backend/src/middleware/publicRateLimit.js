// Limiteur de débit simple, en mémoire, pour les endpoints publics (non authentifiés).
// Suffisant pour un seul serveur ; à remplacer par une solution partagée (Redis...) si
// l'application tourne un jour sur plusieurs instances.

const hits = new Map(); // ip -> [timestamps]

function publicRateLimit({ windowMs = 60_000, max = 8 } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'inconnu';
    const now = Date.now();
    const timestamps = (hits.get(ip) || []).filter((t) => now - t < windowMs);

    if (timestamps.length >= max) {
      return res.status(429).json({ error: 'Fahatapiazana : miandrasa kely vao manoratra hafatra vaovao.' });
    }

    timestamps.push(now);
    hits.set(ip, timestamps);
    next();
  };
}

// Nettoyage périodique pour éviter une fuite mémoire sur les IP inactives.
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of hits.entries()) {
    const kept = timestamps.filter((t) => now - t < 5 * 60_000);
    if (kept.length === 0) hits.delete(ip);
    else hits.set(ip, kept);
  }
}, 5 * 60_000).unref();

module.exports = { publicRateLimit };
