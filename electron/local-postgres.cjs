'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const LOCAL_PORT = Number(process.env.COPEC_PG_PORT || 54329);
let postgresProcess = null;
let pgRoot = null;
let dataDir = null;

function findPgRoot() {
  const candidates = [];
  if (process.env.COPEC_POSTGRES_ROOT) candidates.push(process.env.COPEC_POSTGRES_ROOT);
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'postgresql'));
  if (process.env.COPEC_DESKTOP) candidates.push(path.join(process.cwd(), 'vendor', 'postgresql'));
  candidates.push(path.join(__dirname, '..', 'vendor', 'postgresql'));
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(path.join(candidate, 'bin', process.platform === 'win32' ? 'postgres.exe' : 'postgres')) && fs.existsSync(path.join(candidate, 'share', 'postgresql.conf.sample'))) return candidate;
  }
  throw new Error('PostgreSQL embarqué introuvable. Le build Windows doit contenir vendor/postgresql (bin + lib + share).');
}

function exe(name) {
  return path.join(pgRoot, 'bin', process.platform === 'win32' ? `${name}.exe` : name);
}

function canConnect(port = LOCAL_PORT) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
  });
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${path.basename(command)} (${code}): ${stderr || stdout}`)));
  });
}

async function initCluster(password) {
  fs.mkdirSync(dataDir, { recursive: true });
  const marker = path.join(dataDir, 'PG_VERSION');
  if (fs.existsSync(marker)) return false;
  const pwFile = path.join(path.dirname(dataDir), 'pg-password.txt');
  fs.writeFileSync(pwFile, password, { encoding: 'utf8' });
  try {
    await run(exe('initdb'), ['-D', dataDir, '-U', 'postgres', '--pwfile', pwFile, '--encoding', 'UTF8', '--locale', 'C']);
    return true;
  } finally { try { fs.unlinkSync(pwFile); } catch {} }
}

async function startLocalPostgres({ userData, password }) {
  pgRoot = findPgRoot();
  dataDir = path.join(userData, 'postgres', 'data');
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  await initCluster(password);

  if (await canConnect()) return { port: LOCAL_PORT, dataDir, pgRoot, alreadyRunning: true };

  await run(exe('pg_ctl'), [
    '-D', dataDir,
    '-o', `-p ${LOCAL_PORT} -h 127.0.0.1`,
    '-w', 'start',
  ], { PGROOT: pgRoot });

  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (await canConnect()) {
      postgresProcess = true;
      return { port: LOCAL_PORT, dataDir, pgRoot, alreadyRunning: false };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('PostgreSQL local n’a pas démarré à temps.');
}

async function stopLocalPostgres() {
  if (!dataDir || !fs.existsSync(dataDir)) return;
  try { await run(exe('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop']); } catch (err) { console.warn('[POSTGRES LOCAL] arrêt:', err.message); }
  postgresProcess = null;
}

module.exports = { startLocalPostgres, stopLocalPostgres, LOCAL_PORT };
