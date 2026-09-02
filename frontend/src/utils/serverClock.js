import client from '../api/client';

const OFFSET_KEY = 'copec_server_clock_offset_ms';
let offsetMs = Number(localStorage.getItem(OFFSET_KEY) || 0);
let lastSyncAt = 0;
let syncing = null;

export function getServerNow() {
  return new Date(Date.now() + offsetMs);
}

export function getServerNowIso() {
  return getServerNow().toISOString();
}

export function getServerToday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Antananarivo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(getServerNow());
  const v = Object.fromEntries(p.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

export function getServerYear() {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'Indian/Antananarivo', year: 'numeric' }).format(getServerNow()));
}

export function getServerMonth() {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'Indian/Antananarivo', month: 'numeric' }).format(getServerNow()));
}

export async function syncServerClock(force = false) {
  if (!force && Date.now() - lastSyncAt < 60_000) return getServerNow();
  if (syncing) return syncing;
  const started = Date.now();
  syncing = client.get('/system/time', { timeout: 5000 })
    .then(({ data }) => {
      const received = Date.now();
      const serverMs = new Date(data.now).getTime();
      // Milieu de l'aller-retour : réduit l'erreur réseau de quelques ms.
      offsetMs = serverMs - Math.round((started + received) / 2);
      localStorage.setItem(OFFSET_KEY, String(offsetMs));
      lastSyncAt = received;
      return getServerNow();
    })
    .catch(() => getServerNow())
    .finally(() => { syncing = null; });
  return syncing;
}

// Synchronisation immédiate au chargement. Le dernier offset est conservé hors-ligne,
// puis recalé automatiquement dès que le serveur est joignable.
syncServerClock();
