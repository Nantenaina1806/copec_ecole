'use strict';

const $ = (id) => document.getElementById(id);
const status = $('status');
const databaseUrl = $('databaseUrl');
const publicAppUrl = $('publicAppUrl');
const groqApiKey = $('groqApiKey');
const emailFrom = $('emailFrom');
const test = $('test');
const save = $('save');

function setStatus(message, type = '') {
  status.className = `status ${type}`;
  status.textContent = message || '';
}

function payload() {
  return {
    databaseUrl: databaseUrl.value.trim(),
    publicAppUrl: publicAppUrl.value.trim(),
    groqApiKey: groqApiKey.value.trim(),
    emailFrom: emailFrom.value.trim(),
  };
}

async function testConnection() {
  setStatus('Test de la connexion centrale en cours…');
  test.disabled = true;
  try {
    const result = await window.copec.testConnection(databaseUrl.value.trim());
    setStatus(`Connexion centrale réussie — base : ${result.database} · utilisateur : ${result.user}`, 'ok');
  } catch (error) {
    setStatus(error.message || 'Connexion impossible.', 'error');
  } finally { test.disabled = false; }
}

async function saveConfig() {
  if (databaseUrl.value.trim()) {
    try { await window.copec.testConnection(databaseUrl.value.trim()); }
    catch (error) { setStatus(error.message || 'Connexion centrale impossible.', 'error'); return; }
  }
  setStatus('Configuration et préparation de la base… Cela peut prendre quelques secondes.');
  test.disabled = true;
  save.disabled = true;
  try {
    const result = await window.copec.saveConfig(payload());
    const text = result.syncEnabled ? 'Base locale prête · synchronisation automatique activée.' : 'Base locale prête · mode 100% hors connexion.';
    setStatus(`${text} Démarrage de l’application…`, 'ok');
  } catch (error) {
    setStatus(error.message || 'Configuration impossible.', 'error');
    test.disabled = false;
    save.disabled = false;
  }
}

test.addEventListener('click', testConnection);
save.addEventListener('click', saveConfig);
databaseUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveConfig(); });
window.copec.onSetupError((message) => setStatus(message, 'error'));
window.copec.onSetupDefaults((defaults) => {
  if (!databaseUrl.value && defaults?.databaseUrl) databaseUrl.value = defaults.databaseUrl;
});
