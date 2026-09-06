import { useState, useEffect, useRef, useId } from 'react';
import { Bell, Menu, Search, ChevronDown, UserRound, LogOut, ArrowUpRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useFetch } from '../hooks/useFetch';
import { SECTIONS } from './Sidebar';
import ProfileModal from './ProfileModal';
import SyncStatus from './SyncStatus';
import { getServerNow, syncServerClock } from '../utils/serverClock';

// Rôles qui ont accès au fil de notifications (miroir de ROLES_ADMIN_AGENT côté backend) :
// admin + agents (secrétaire, économe, surveillant). Les enseignants n'y ont pas accès.
const ROLES_NOTIFICATIONS = ['admin', 'secretaire', 'economie', 'surveillant', 'accueil'];
const CLE_DERNIERE_LECTURE = 'copec_notif_vu';
const INTERVALLE_POLL_MS = 30000;

function formaterRelatif(dateStr) {
  const date = new Date(dateStr);
  const diffSec = Math.max(0, Math.round((getServerNow().getTime() - date.getTime()) / 1000));
  if (diffSec < 60) return "à l'instant";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffJ = Math.round(diffH / 24);
  return `il y a ${diffJ} j`;
}

function NotificationBell({ user }) {
  const [open, setOpen] = useState(false);
  const [dernierVu, setDernierVu] = useState(() => localStorage.getItem(CLE_DERNIERE_LECTURE) || null);
  const ref = useRef(null);
  const navigate = useNavigate();

  const peutVoir = ROLES_NOTIFICATIONS.includes(user?.role);

  // useFetch (comme partout ailleurs dans l'appli) se charge de l'appel initial ;
  // on se contente ici de déclencher un rechargement périodique via reload().
  const { data, reload } = useFetch(
    () => (peutVoir
      ? client.get('/audit/notifications', { params: { limit: 15 } }).then((r) => r.data)
      : Promise.resolve([])),
    [peutVoir]
  );
  const items = data || [];

  useEffect(() => {
    if (!peutVoir) return undefined;
    const id = setInterval(reload, INTERVALLE_POLL_MS);
    return () => clearInterval(id);
  }, [peutVoir, reload]);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (!peutVoir) return null;

  const nonLues = dernierVu ? items.filter((n) => new Date(n.date_action) > new Date(dernierVu)).length : items.length;

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) {
        const now = getServerNow().toISOString();
        localStorage.setItem(CLE_DERNIERE_LECTURE, now);
        setDernierVu(now);
      }
      return next;
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className="relative text-slate-500 hover:text-slate-800 p-1" aria-label="Notifications" aria-haspopup="true" aria-expanded={open}>
        <Bell size={20} />
        {nonLues > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center font-semibold">
            {nonLues > 9 ? '9+' : nonLues}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white rounded-lg shadow-xl border border-slate-100 py-1 z-30">
          <div className="px-3 py-2 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800">Notifications</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-3 py-4 text-sm text-slate-400 text-center">Aucune activité récente.</p>
            )}
            {items.map((n) => {
              const target = n.type === 'inscription' || n.type === 'note' || n.type === 'finance' || n.type === 'discipline'
                ? (n.target_id ? `/admin/eleves/${n.target_id}` : `/admin/${n.type === 'finance' ? 'finances' : n.type === 'discipline' ? 'vie-scolaire' : n.type === 'note' ? 'notes' : 'eleves'}`)
                : n.type === 'appel' ? '/admin/presences' : '/admin/historique';
              return (
                <button key={`${n.type}-${n.id}`} type="button" onClick={() => { setOpen(false); navigate(target); }} className="w-full text-left px-3 py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50 focus:outline-none focus:bg-brand-50">
                  <p className="text-sm text-slate-700">{n.message}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{n.acteur} · {formaterRelatif(n.date_action)}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Topbar({ active, onToggleMobile }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(getServerNow());
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    const openProfile = () => setProfileOpen(true);
    window.addEventListener('copec:profile', openProfile);
    return () => window.removeEventListener('copec:profile', openProfile);
  }, []);
  const [search, setSearch] = useState('');
  const [globalResults, setGlobalResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const userMenuRef = useRef(null);
  const searchRef = useRef(null);
  const userMenuId = useId();

  useEffect(() => {
    const id = setInterval(() => setNow(getServerNow()), 1000);
    const sync = () => { if (document.visibilityState === 'visible') syncServerClock(true).then(setNow); };
    const onVisible = () => sync();
    document.addEventListener('visibilitychange', onVisible);
    const syncId = setInterval(() => syncServerClock(true).then(setNow), 60_000);
    return () => { clearInterval(id); clearInterval(syncId); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onOutside = (e) => { if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onOutside); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try { const { data } = await client.get('/recherche', { params: { q } }); if (!cancelled) setGlobalResults(data || []); }
      catch { if (!cancelled) setGlobalResults([]); }
      finally { if (!cancelled) setSearching(false); }
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  useEffect(() => {
    const focusSearch = () => { searchRef.current?.focus(); };
    window.addEventListener('copec:focus-search', focusSearch);
    return () => window.removeEventListener('copec:focus-search', focusSearch);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const section = SECTIONS.find((s) => s.key === active);
  const initials = `${user?.prenom?.[0] || ''}${user?.nom?.[0] || ''}`.toUpperCase() || 'U';
  const visibleSections = SECTIONS.filter((s) => s.roles.includes(user?.role));
  const matches = search.trim() ? visibleSections.filter((s) => s.label.toLowerCase().includes(search.toLowerCase())).slice(0, 6) : [];
  const displayedGlobalResults = search.trim().length >= 2 ? globalResults : [];
  const hasSearchResults = matches.length > 0 || displayedGlobalResults.length > 0;
  const roleLabel = { admin: 'Administrateur', enseignant: 'Enseignant', secretaire: 'Secrétaire', economie: 'Économe', surveillant: 'Surveillant', accueil: 'Accueil' }[user?.role] || user?.role;
  const ouvrirResultat = (event, href) => {
    event.preventDefault();
    setSearch('');
    navigate(href);
  };

  return (
    <header className="sticky top-0 z-20 h-16 md:h-[76px] border-b border-slate-200/80 bg-white/90 shadow-[0_1px_0_rgba(18,45,82,.02),0_6px_20px_rgba(18,45,82,.035)] backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="h-full px-3 sm:px-4 md:px-6 flex items-center gap-2 sm:gap-4">
        <button type="button" className="md:hidden shrink-0 h-10 w-10 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50" onClick={onToggleMobile} aria-label="Ouvrir le menu">
          <Menu size={20} className="mx-auto" />
        </button>

        <div className="hidden lg:block min-w-0 w-[250px] xl:w-[310px]">
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-slate-400">Espace de gestion</p>
          <h1 className="font-display text-lg font-extrabold text-slate-900 tracking-tight truncate">{section?.label || 'Tableau de bord'}</h1>
        </div>

        <SyncStatus />

        <div className="relative flex-1 min-w-0 max-w-xl">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setSearch(''); }}
            className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/80 pl-10 pr-14 text-sm text-slate-800 outline-none transition focus:bg-white focus:border-brand-300 focus:ring-4 focus:ring-brand-500/10"
            placeholder="Rechercher élèves, classes, enseignants…"
            aria-label="Recherche globale"
          />
          <kbd className="hidden sm:inline-flex absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">Ctrl K</kbd>
          {(matches.length > 0 || displayedGlobalResults.length > 0 || searching) && (
            <div className="absolute left-0 right-0 top-12 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-card-lg z-50 max-h-[420px] overflow-y-auto">
              {matches.map((item) => <a key={`section-${item.key}`} href={item.hrefByRole?.[user?.role] || `/admin/${item.key}`} onClick={(event) => ouvrirResultat(event, item.hrefByRole?.[user?.role] || `/admin/${item.key}`)} className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-800"><span>{item.labelByRole?.[user?.role] || item.label}</span><span className="text-[10px] text-slate-400">Section</span></a>)}
              {displayedGlobalResults.map((item) => (
                <a key={`${item.type}-${item.id}`} href={item.href || '/admin'} onClick={(event) => ouvrirResultat(event, item.href || '/admin')} className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-800">
                  <span className="min-w-0"><b className="font-semibold truncate block">{item.label || `${item.prenom || ''} ${item.nom || item.recu_numero || item.email || ''}`}</b><span className="block text-[10px] text-slate-400 uppercase">{item.type}{item.matiere_nom ? ` · ${item.matiere_nom}` : ''}{item.role ? ` · ${item.role}` : ''}</span></span>
                  <ArrowUpRight size={13} className="shrink-0 text-slate-300" />
                </a>
              ))}
              {searching && <div className="px-3 py-2 text-xs text-slate-400">Recherche…</div>}
              {!searching && search.trim().length >= 2 && !hasSearchResults && <div className="px-3 py-3 text-sm text-slate-500">Aucun résultat pour « {search.trim()} ».</div>}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="hidden xl:flex flex-col items-end mr-1">
            <span className="text-xs font-semibold text-slate-700 data-mono">{now.toLocaleTimeString('fr-FR', { timeZone: 'Indian/Antananarivo', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="text-[10px] text-slate-400 capitalize">{now.toLocaleDateString('fr-FR', { timeZone: 'Indian/Antananarivo', weekday: 'short', day: 'numeric', month: 'short' })}</span>
          </div>
          <NotificationBell user={user} />
          <div className="relative" ref={userMenuRef}>
            <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-1.5 py-1.5 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" aria-haspopup="true" aria-expanded={menuOpen} aria-controls={userMenuId}>
              {user?.photo_url ? <img src={user.photo_url} alt="" className="h-8 w-8 rounded-lg object-cover" /> : <div className="h-8 w-8 rounded-lg bg-brand-900 text-white flex items-center justify-center text-xs font-bold">{initials}</div>}
              <span className="hidden lg:block text-left pr-1">
                <span className="block text-xs font-bold text-slate-800 leading-tight max-w-28 truncate">{user?.prenom} {user?.nom}</span>
                <span className="block text-[10px] text-slate-400 leading-tight">{roleLabel}</span>
              </span>
              <ChevronDown size={14} className="hidden lg:block text-slate-400" />
            </button>
            {menuOpen && (
              <div id={userMenuId} role="menu" className="absolute right-0 mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-card-lg z-50">
                <div className="px-3 py-3 mb-1 rounded-xl bg-slate-50">
                  <p className="text-sm font-bold text-slate-800 truncate">{user?.prenom} {user?.nom}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{user?.email || roleLabel}</p>
                </div>
                <button role="menuitem" onClick={() => { setMenuOpen(false); setProfileOpen(true); }} className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"><UserRound size={16} /> Modifier le profil</button>
                <button role="menuitem" onClick={logout} className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"><LogOut size={16} /> Déconnexion</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </header>
  );
}
