require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { sanitizeInput } = require('./middleware/sanitize');
const { demarrerCronJobs } = require('./jobs/cron');
const { demarrerSynchronisation, arreterSynchronisation } = require('./services/syncService');
const { runMigrations } = require('./services/migrationService');
const { TIMEZONE } = require('./services/timeService');

// Vérifie au démarrage que les secrets critiques sont présents (et pas la
// valeur par défaut de .env.example) plutôt que de laisser l'application
// démarrer silencieusement avec un JWT_SECRET vide/faible.
function verifierConfiguration() {
  const manquants = [];
  if (!process.env.JWT_SECRET) manquants.push('JWT_SECRET');
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) manquants.push('JWT_SECRET (32 caractères minimum)');
  if (!process.env.APP_TIMEZONE) console.warn(`[config] APP_TIMEZONE non défini — utilisation de ${TIMEZONE}.`);
  if (!process.env.DATABASE_URL && !process.env.PGHOST) manquants.push('DATABASE_URL ou PGHOST/PGUSER/PGPASSWORD/PGDATABASE');
  if (manquants.length) {
    console.error(`Configuration manquante dans .env : ${manquants.join(', ')}. Voir .env.example.`);
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && (!process.env.BULLETIN_QR_SECRET || process.env.BULLETIN_QR_SECRET.length < 32)) {
    console.error('BULLETIN_QR_SECRET doit être défini avec au moins 32 caractères en production.');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET === 'changez_ce_secret_en_production' || process.env.JWT_SECRET === 'changez_ce_secret_local')) {
    console.error('JWT_SECRET utilise encore la valeur par défaut de .env.example — à changer avant toute mise en production.');
    process.exit(1);
  }
}
verifierConfiguration();

const app = express();
// Nécessaire derrière un reverse proxy / PaaS (Railway, Render, Nginx...) pour
// que req.ip et express-rate-limit voient la vraie IP du client (X-Forwarded-For)
// plutôt que celle du proxy.
app.set('trust proxy', 1);

// helmet bloque par défaut le chargement cross-origin des ressources statiques (CORP) ;
// on l'assouplit uniquement pour /uploads afin que le frontend (autre domaine) puisse
// afficher/télécharger les documents uploadés.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
// Avec credentials:true, le navigateur refuse l'origine '*' — on retombe sur localhost
// en dev si FRONTEND_URL n'est pas défini, plutôt que sur un wildcard non fonctionnel.
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// Assainissement générique (anti pollution de prototype, anti-XSS stocké) —
// appliqué globalement, en amont de la validation Zod propre à chaque route.
app.use(sanitizeInput);

// Fichiers uploadés (documents élèves) — servis tels quels, en dehors du préfixe /api.
const UPLOAD_ROOT = path.resolve(process.env.COPEC_UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
require('fs').mkdirSync(UPLOAD_ROOT, { recursive: true });
app.use('/uploads/public', express.static(path.join(UPLOAD_ROOT, 'public')));

// Limite générale, appliquée à toute l'API : filet de sécurité contre le
// scraping/bruteforce agressif ou un client mal codé qui boucle. Les endpoints
// sensibles (login, assistant public...) ont en plus leur propre limite, plus
// stricte, définie ci-dessous ou dans middleware/publicRateLimit.js.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});
app.use('/api', apiLimiter);

// Horloge COPEC : endpoint léger utilisé par le frontend pour synchroniser son horodatage.
// L'instant renvoyé est celui du serveur ; le fuseau métier est explicite.
app.get('/api/system/time', async (req, res) => {
  try {
    const { query } = require('./config/db');
    const { rows } = await query('SELECT CURRENT_TIMESTAMP AS now');
    res.set('Cache-Control', 'no-store');
    res.json({ now: rows[0].now, timezone: TIMEZONE });
  } catch (err) {
    res.status(503).json({ error: 'Horloge serveur indisponible.' });
  }
});



// Limite les tentatives de connexion pour freiner le bruteforce (auth uniquement)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/login-agent', authLimiter);
app.use('/api/auth/login-eleve', authLimiter);

// Le changement de mot de passe / la confirmation de compte par selfie sont
// des actions sensibles et peu fréquentes en usage normal : limite dédiée,
// plus stricte que la limite générale de l'API, pour freiner un bruteforce
// ciblé sur le mot de passe actuel (voir routes/auth.js -> PUT /auth/me).
const ecritureSensibleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard.' },
});
app.use('/api/auth/me', ecritureSensibleLimiter);
app.use('/api/auth/confirmer-compte', ecritureSensibleLimiter);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString(), service: 'copec-api' }));
app.get('/api/ready', async (req, res) => {
  try { const { query } = require('./config/db'); await query('SELECT 1'); res.json({ status: 'ready', database: 'ok', time: new Date().toISOString() }); }
  catch (err) { res.status(503).json({ status: 'not_ready', database: 'error' }); }
});

app.use('/api', routes);

// En production desktop, Electron sert le build Vite depuis le même serveur Express.
// Ainsi l'utilisateur n'a ni Vite ni navigateur à lancer séparément.
const FRONTEND_DIST = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
if (process.env.COPEC_DESKTOP === 'true' && require('fs').existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: 'Route introuvable.' }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
let server = null;
if (require.main === module) {
  server = app.listen(PORT, async () => {
    console.log(`Serveur Gestion École COPEC démarré sur le port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    console.log('Schéma DB : database/schema.sql (source de vérité unique)');
    try {
      await runMigrations();
      demarrerCronJobs();
      demarrerSynchronisation();
    } catch (err) {
      console.error('[migration] Échec des migrations additives :', err);
      process.exit(1);
    }
  });
}

module.exports = app;
module.exports.server = server;
const shutdownHandler = async (signal) => {
  if (!server) return;
  console.log(`[SERVER] Signal ${signal} reçu : fermeture propre du serveur API COPEC...`);
  try {
    await arreterSynchronisation();
    server.close(() => {
      console.log('[SERVER] Serveur HTTP fermé avec succès.');
      process.exit(0);
    });
  } catch (err) {
    console.error('[SERVER] Erreur lors de la fermeture :', err);
    process.exit(1);
  }
};
module.exports.shutdown = shutdownHandler;

process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
process.on('SIGINT', () => shutdownHandler('SIGINT'));

