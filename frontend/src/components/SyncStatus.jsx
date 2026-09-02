import { useEffect, useState } from 'react';
import { CheckCircle2, CloudOff, RefreshCw, Wifi } from 'lucide-react';
import client from '../api/client';

const POLL_MS = 10000;

function labelFor(data, browserOnline) {
  if (!browserOnline) return { label: 'Hors connexion', tone: 'offline', Icon: CloudOff };
  if (!data?.enabled) return { label: 'Mode local', tone: 'local', Icon: Wifi };
  if (data.status === 'syncing') return { label: 'Synchronisation…', tone: 'syncing', Icon: RefreshCw };
  if (data.status === 'offline' || !data.centralReachable) return { label: 'Local · en attente', tone: 'offline', Icon: CloudOff };
  return { label: 'Synchronisé', tone: 'online', Icon: CheckCircle2 };
}

export default function SyncStatus() {
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const online = () => setBrowserOnline(true);
    const offline = () => setBrowserOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await client.get('/sync/status');
        if (!cancelled) setData(res.data);
      } catch { /* statut non critique */ }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const state = labelFor(data, browserOnline);
  const Icon = state.Icon;
  const pending = data?.last_error ? 'Une synchronisation sera retentée automatiquement.' : 'Les échanges avec Neon sont automatiques.';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hidden sm:flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        title={pending}
        aria-label={`État des données : ${state.label}`}
      >
        <Icon size={15} className={state.tone === 'syncing' ? 'animate-spin' : ''} />
        <span>{state.label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-card-lg">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-slate-100 p-2"><Icon size={17} /></div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800">{state.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{pending}</p>
              {data?.last_success_at && <p className="mt-2 text-[11px] text-slate-400">Dernière synchronisation : {new Date(data.last_success_at).toLocaleString('fr-FR')}</p>}
              {data?.last_error && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-700">{data.last_error}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
