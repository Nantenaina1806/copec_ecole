'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const { createRequire } = require('module');
const { startLocalPostgres, stopLocalPostgres, LOCAL_PORT } = require('./local-postgres.cjs');

const APP_NAME = 'COPEC ISAHA — Gestion École';
const DEFAULT_API_PORT = 4000;
let API_PORT = 4000;
let localPostgres = null;
const CONFIG_FILE = 'config.json';

let mainWindow = null;
let setupWindow = null;
let backendStarted = false;

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function dataPath(...parts) {
  return path.join(app.getPath('userData'), ...parts);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeConfig(config) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function generateSecret() {
  return crypto.randomBytes(48).toString('hex');
}

function normalizeDatabaseUrl(value) {
  return String(value || '').trim();
}

async function findFreePort(start = 4000) {
  const net = require('net');
  for (let port = start; port < start + 100; port += 1) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('Aucun port local libre trouvé pour COPEC.');
}

async function testDatabase(databaseUrl) {
  const backendPackage = path.join(app.getAppPath(), 'backend', 'package.json');
  const backendRequire = createRequire(backendPackage);
  const { Client } = backendRequire('pg');
  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    const result = await client.query("SELECT current_database() AS database, current_user AS user");
    return result.rows[0];
  } finally {
    await client.end();
  }
}

async function initializeEmptyDatabase(databaseUrl) {
  const backendPackage = path.join(app.getAppPath(), 'backend', 'package.json');
  const backendRequire = createRequire(backendPackage);
  const { Client } = backendRequire('pg');
  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000,
  });

  await client.connect();
  try {
    const check = await client.query("SELECT to_regclass('public.utilisateur') AS table_name");
    if (check.rows[0]?.table_name) {
      return { initialized: false, existing: true };
    }

    const root = app.getAppPath();
    const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
    const seed = fs.readFileSync(path.join(root, 'database', 'seed.sql'), 'utf8');

    await client.query(schema);
    await client.query(seed);
    return { initialized: true, existing: false };
  } finally {
    await client.end();
  }
}

function configureEnvironment(config) {
  const userData = app.getPath('userData');
  fs.mkdirSync(path.join(userData, 'uploads', 'documents'), { recursive: true });
  fs.mkdirSync(path.join(userData, 'uploads', 'selfies'), { recursive: true });
  fs.mkdirSync(path.join(userData, 'backups'), { recursive: true });

  process.env.NODE_ENV = 'production';
  process.env.PORT = String(API_PORT);
  process.env.COPEC_DESKTOP = 'true';
  process.env.APP_TIMEZONE = 'Indian/Antananarivo';
  process.env.APP_LOCALE = 'fr-FR';
  process.env.PGHOST = '127.0.0.1';
  process.env.PGPORT = String(LOCAL_PORT);
  process.env.PGDATABASE = 'gestion_ecole';
  process.env.PGUSER = 'postgres';
  process.env.PGPASSWORD = config.localDbPassword;
  delete process.env.DATABASE_URL;
  process.env.JWT_SECRET = config.jwtSecret;
  process.env.BULLETIN_QR_SECRET = config.bulletinQrSecret;
  process.env.FRONTEND_URL = `http://127.0.0.1:${API_PORT}`;
  process.env.PUBLIC_APP_URL = config.publicAppUrl || `http://127.0.0.1:${API_PORT}`;
  process.env.VITE_PUBLIC_APP_URL = process.env.PUBLIC_APP_URL;
  process.env.SYNC_ENABLED = config.centralDatabaseUrl ? 'true' : 'false';
  process.env.SYNC_DEVICE_ID = config.deviceId;
  process.env.SYNC_INTERVAL_MS = '15000';
  process.env.CENTRAL_DATABASE_URL = config.centralDatabaseUrl || '';
  process.env.COPEC_MODE = 'production';
  process.env.COPEC_UPLOAD_DIR = path.join(userData, 'uploads');
  process.env.COPEC_BACKUP_DIR = path.join(userData, 'backups');
  process.env.BACKUP_AUTO = 'false';
  process.env.ALLOW_DB_RESTORE = 'false';
  process.env.GROQ_API_KEY = config.groqApiKey || '';
  process.env.GROQ_MODEL = config.groqModel || 'openai/gpt-oss-120b';
  process.env.EMAIL_PROVIDER = config.emailProvider || 'resend';
  process.env.RESEND_API_KEY = config.resendApiKey || '';
  process.env.EMAIL_FROM = config.emailFrom || '';
  process.env.WHATSAPP_ACCESS_TOKEN = config.whatsappAccessToken || '';
  process.env.WHATSAPP_PHONE_NUMBER_ID = config.whatsappPhoneNumberId || '';
  process.env.WHATSAPP_API_VERSION = config.whatsappApiVersion || 'v23.0';
  process.env.WHATSAPP_TEMPLATE_NAME = config.whatsappTemplateName || '';
  process.env.WHATSAPP_TEMPLATE_LANGUAGE = config.whatsappTemplateLanguage || 'fr';
}

function requireBackend() {
  if (backendStarted) return;
  const backendEntry = path.join(app.getAppPath(), 'backend', 'src', 'server.js');
  configureEnvironment(readConfig());
  // Le backend Express tourne dans le processus principal Electron.
  // Cela évite d'exiger Node.js séparément sur le PC utilisateur.
  require(backendEntry);
  backendStarted = true;
}

function waitForBackend(timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${API_PORT}/api/ready`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) return resolve(body);
          if (Date.now() - started > timeoutMs) return reject(new Error(`Le backend n'est pas prêt (${res.statusCode}).`));
          setTimeout(check, 400);
        });
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) return reject(new Error('Impossible de démarrer le serveur COPEC.'));
        setTimeout(check, 400);
      });
      req.setTimeout(2500, () => req.destroy());
    };
    check();
  });
}

function createMainWindow() {
  if (mainWindow) {
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: APP_NAME,
    backgroundColor: '#f5f7fb',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(`http://127.0.0.1:${API_PORT}/`);
  return mainWindow;
}

function createSetupWindow(errorMessage = '') {
  if (setupWindow) {
    setupWindow.focus();
    setupWindow.webContents.send('setup:error', errorMessage);
    return setupWindow;
  }

  setupWindow = new BrowserWindow({
    width: 760,
    height: 720,
    resizable: false,
    title: `${APP_NAME} — Configuration`,
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  setupWindow.loadFile(path.join(__dirname, 'setup.html'));
  setupWindow.webContents.on('did-finish-load', () => {
    if (errorMessage) setupWindow.webContents.send('setup:error', errorMessage);
  });
  setupWindow.on('closed', () => { setupWindow = null; });
  return setupWindow;
}

async function launchConfiguredApp(config) {
  API_PORT = await findFreePort(DEFAULT_API_PORT);
  localPostgres = await startLocalPostgres({ userData: app.getPath('userData'), password: config.localDbPassword });
  configureEnvironment(config);
  await initializeLocalDatabase(config);
  requireBackend();
  await waitForBackend();
  createMainWindow();
  if (setupWindow) setupWindow.close();
}

async function initializeLocalDatabase(config) {
  const localUrl = `postgresql://postgres:${encodeURIComponent(config.localDbPassword)}@127.0.0.1:${LOCAL_PORT}/gestion_ecole`;
  const backendPackage = path.join(app.getAppPath(), 'backend', 'package.json');
  const backendRequire = createRequire(backendPackage);
  const { Client } = backendRequire('pg');
  const client = new Client({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const check = await client.query("SELECT to_regclass('public.utilisateur') AS table_name");
    if (!check.rows[0]?.table_name) {
      const root = app.getAppPath();
      await client.query(fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'));
      await client.query(fs.readFileSync(path.join(root, 'database', 'seed.sql'), 'utf8'));
    }
    const syncAddon = fs.readFileSync(path.join(app.getAppPath(), 'scripts', 'sync-schema-addon.sql'), 'utf8');
    await client.query(syncAddon);
    const localInit = fs.readFileSync(path.join(app.getAppPath(), 'scripts', 'sync-local-init.sql'), 'utf8');
    await client.query(localInit);
    await client.query("INSERT INTO sync_device(device_id, nom, type) VALUES($1,$2,'local-server') ON CONFLICT (device_id) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP, actif=TRUE", [config.deviceId, 'COPEC Windows']);
  } finally { await client.end(); }
}


ipcMain.handle('copec:test-connection', async (_event, payload) => {
  const databaseUrl = normalizeDatabaseUrl(payload?.databaseUrl);
  if (!databaseUrl || !/^postgres(ql)?:\/\//i.test(databaseUrl)) throw new Error('URL PostgreSQL centrale invalide.');
  const info = await testDatabase(databaseUrl);
  return { ok: true, ...info };
});

ipcMain.handle('copec:save-config', async (_event, payload) => {
  const centralDatabaseUrl = normalizeDatabaseUrl(payload?.databaseUrl);
  if (centralDatabaseUrl && !/^postgres(ql)?:\/\//i.test(centralDatabaseUrl)) throw new Error('URL PostgreSQL centrale invalide.');
  if (centralDatabaseUrl) await testDatabase(centralDatabaseUrl);

  const previous = readConfig();
  const config = {
    centralDatabaseUrl,
    localDbPassword: previous?.localDbPassword || generateSecret(),
    deviceId: previous?.deviceId || `WIN-${crypto.randomUUID()}`,
    jwtSecret: previous?.jwtSecret || generateSecret(),
    bulletinQrSecret: previous?.bulletinQrSecret || generateSecret(),
    publicAppUrl: String(payload?.publicAppUrl || '').trim(),
    groqApiKey: String(payload?.groqApiKey || '').trim(),
    groqModel: String(payload?.groqModel || 'openai/gpt-oss-120b').trim(),
    emailProvider: 'resend',
    resendApiKey: String(payload?.resendApiKey || '').trim(),
    emailFrom: String(payload?.emailFrom || '').trim(),
    whatsappAccessToken: String(payload?.whatsappAccessToken || '').trim(),
    whatsappPhoneNumberId: String(payload?.whatsappPhoneNumberId || '').trim(),
    whatsappApiVersion: 'v23.0',
    whatsappTemplateName: String(payload?.whatsappTemplateName || '').trim(),
    whatsappTemplateLanguage: 'fr',
  };
  writeConfig(config);
  await launchConfiguredApp(config);
  return { ok: true, databaseInitialized: true, syncEnabled: Boolean(centralDatabaseUrl) };
});

ipcMain.handle('copec:open-public-url', async (_event, url) => {
  const value = String(url || '').trim();
  if (/^https?:\/\//i.test(value)) await shell.openExternal(value);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) { app.quit(); } else {
app.on('second-instance', () => { if (mainWindow) mainWindow.focus(); else if (setupWindow) setupWindow.focus(); });

app.whenReady().then(async () => {
  app.setAppUserModelId('mg.copec.gestionecole');
  const config = readConfig();
  if (!config?.localDbPassword || !config?.jwtSecret || !config?.bulletinQrSecret || !config?.deviceId) {
    createSetupWindow();
    return;
  }
  try { await launchConfiguredApp(config); }
  catch (error) { console.error('[COPEC] démarrage:', error); await stopLocalPostgres().catch(() => {}); localPostgres = null; createSetupWindow(`Démarrage COPEC impossible : ${error.message}`); }
});
}

app.on('before-quit', async (event) => {
  if (localPostgres) {
    event.preventDefault();
    const pg = localPostgres;
    localPostgres = null;
    await stopLocalPostgres(pg).catch(() => {});
    app.exit(0);
  }
});

app.on('window-all-closed', () => {
  // Windows : fermer l'application lorsque la fenêtre principale est fermée.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.focus();
  else if (readConfig()) createMainWindow();
  else createSetupWindow();
});
