import { useMemo, useState } from 'react';
import {
  LayoutDashboard, BookOpen, ClipboardList, Bell, LogOut,
  GraduationCap, CalendarClock, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useFetch } from '../hooks/useFetch';
import { LoadingScreen, ErrorState, EmptyState, SkeletonStatCards } from '../components/Feedback';
import { Badge } from '../components/Shared';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import EmploiDuTempsGrid from '../components/EmploiDuTempsGrid';
import { toArray } from '../utils/array';

const TABS = [
  { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { key: 'edt', label: 'Emploi du temps', icon: CalendarClock },
  { key: 'notes', label: 'Mes notes', icon: GraduationCap },
  { key: 'devoirs', label: 'Devoirs', icon: BookOpen },
  { key: 'notifications', label: 'Notifications', icon: Bell },
];

function noteTone(valeur, bareme = 20) {
  const ratio = Number(valeur) / Number(bareme || 20);
  if (ratio >= 0.7) return 'green';
  if (ratio >= 0.5) return 'amber';
  return 'red';
}

function estEnRetard(dateLimite) {
  if (!dateLimite) return false;
  return new Date(dateLimite) < new Date(new Date().toDateString());
}

export default function EspaceEtudiant() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('dashboard');
  const { data, loading, error, reload } = useFetch(() => client.get(`/eleves/${user.id}/fiche`).then((r) => r.data), []);
  const { data: rawNotifications, loading: loadingNotif, error: errorNotif, reload: reloadNotif } = useFetch(
    () => client.get('/communication/notifications').then((r) => r.data),
    []
  );
  const { data: rawDevoirs, loading: loadingDevoirs, error: errorDevoirs, reload: reloadDevoirs } = useFetch(
    () => (data?.inscription?.classe_id
      ? client.get('/devoirs', { params: { classe_id: data.inscription.classe_id } }).then((r) => r.data)
      : Promise.resolve([])),
    [data?.inscription?.classe_id]
  );
  const notifications = toArray(rawNotifications);
  const devoirs = toArray(rawDevoirs);

  const stats = useMemo(() => {
    const notes = data?.notes || [];
    const moyenne = notes.length
      ? notes.reduce((s, n) => s + (Number(n.note_valeur) / Number(n.bareme || 20)) * 20, 0) / notes.length
      : null;
    const nonLues = (notifications || []).filter((n) => !n.lu).length;
    const aRendre = (devoirs || []).filter((d) => !estEnRetard(d.date_limite)).length;
    return { moyenne, nonLues, aRendre, nbNotes: notes.length, nbCours: data?.emploi_du_temps?.length || 0 };
  }, [data, notifications, devoirs]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-brand-950 text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-accent-500 flex items-center justify-center font-bold text-brand-950 shrink-0">
              {user?.prenom?.[0]}{user?.nom?.[0]}
            </div>
            <div>
              <p className="font-bold text-sm leading-tight">{user?.prenom} {user?.nom}</p>
              <p className="text-[11px] text-brand-300">
                Espace étudiant{data?.inscription?.classe_nom ? ` — ${data.inscription.classe_nom}` : ''}
              </p>
            </div>
          </div>
          <button
            className="inline-flex items-center gap-1.5 text-sm text-brand-200 hover:text-white rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            onClick={logout}
            aria-label="Se déconnecter"
          >
            <LogOut size={15} aria-hidden="true" /> <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <nav className="flex gap-1 mb-5 flex-wrap bg-white rounded-xl border border-slate-100 p-1.5 shadow-card" aria-label="Sections de l'espace étudiant">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active ? 'bg-brand-800 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={16} strokeWidth={2} aria-hidden="true" /> {t.label}
              </button>
            );
          })}
        </nav>

        {loading && <SkeletonStatCards count={4} />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {data && (
          <>
            {tab === 'dashboard' && (
              <div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                  <StatCard
                    label="Moyenne générale"
                    value={stats.moyenne === null ? '—' : `${stats.moyenne.toFixed(1)}/20`}
                    icon={<GraduationCap size={18} />}
                    tone={stats.moyenne !== null && stats.moyenne < 10 ? 'red' : 'brand'}
                  />
                  <StatCard label="Notes reçues" value={stats.nbNotes} icon={<ClipboardList size={18} />} tone="accent" />
                  <StatCard label="Devoirs à rendre" value={stats.aRendre} icon={<BookOpen size={18} />} tone={stats.aRendre ? 'accent' : 'slate'} />
                  <StatCard label="Notifications non lues" value={stats.nonLues} icon={<Bell size={18} />} tone={stats.nonLues ? 'red' : 'slate'} />
                </div>

                <div className="card">
                  <h3 className="font-semibold text-slate-800 mb-1">Cette semaine</h3>
                  <p className="text-sm text-slate-500 mb-4">{stats.nbCours} cours à l&apos;emploi du temps.</p>
                  <EmploiDuTempsGrid edt={data.emploi_du_temps} />
                </div>
              </div>
            )}

            {tab === 'edt' && (
              <div className="card">
                <EmploiDuTempsGrid edt={data.emploi_du_temps} />
              </div>
            )}

            {tab === 'notes' && (
              <div className="card">
                <DataTable
                  rows={data.notes}
                  pageSize={15}
                  emptyLabel="Aucune note pour le moment."
                  columns={[
                    { key: 'matiere_nom', label: 'Matière', sortable: true },
                    { key: 'bimestre_libelle', label: 'Bimestre' },
                    {
                      key: 'note_valeur', label: 'Note', sortable: true,
                      render: (n) => <Badge tone={noteTone(n.note_valeur, n.bareme)}>{n.note_valeur}/{n.bareme || 20}</Badge>,
                    },
                  ]}
                />
              </div>
            )}
          </>
        )}

        {tab === 'devoirs' && (
          <div>
            {loadingDevoirs && <LoadingScreen />}
            {errorDevoirs && <ErrorState message={errorDevoirs} onRetry={reloadDevoirs} />}
            {!loadingDevoirs && !errorDevoirs && (
              (devoirs || []).length === 0 ? (
                <EmptyState icon={BookOpen} title="Aucun devoir assigné" description="Les devoirs publiés par tes enseignants apparaîtront ici." />
              ) : (
                <div className="space-y-3">
                  {devoirs.map((d) => {
                    const enRetard = estEnRetard(d.date_limite);
                    return (
                      <div key={d.id} className="card">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-sm text-slate-800">{d.titre}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{d.matiere_nom}</p>
                          </div>
                          {d.date_limite && (
                            <Badge tone={enRetard ? 'red' : 'green'}>
                              {enRetard ? 'Délai dépassé' : `À rendre le ${new Date(d.date_limite).toLocaleDateString('fr-FR')}`}
                            </Badge>
                          )}
                        </div>
                        {d.consignes && <p className="text-sm text-slate-600 mt-2 whitespace-pre-line">{d.consignes}</p>}
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        )}

        {tab === 'notifications' && (
          <div>
            {loadingNotif && <LoadingScreen />}
            {errorNotif && <ErrorState message={errorNotif} onRetry={reloadNotif} />}
            {!loadingNotif && !errorNotif && (
              (notifications || []).length === 0 ? (
                <EmptyState icon={Bell} title="Aucune notification" description="Les messages de l'administration apparaîtront ici." />
              ) : (
                <div className="space-y-3">
                  {notifications.map((n) => (
                    <div key={n.id} className={`card ${n.lu ? '' : '!border-brand-200 !bg-brand-50'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-sm text-slate-800 flex items-center gap-1.5">
                          {n.lu ? <CheckCircle2 size={14} className="text-slate-400" aria-hidden="true" /> : <AlertTriangle size={14} className="text-brand-700" aria-hidden="true" />}
                          {n.titre || 'Notification'}
                        </p>
                        {!n.lu && <Badge tone="brand">Nouveau</Badge>}
                      </div>
                      <p className="text-sm text-slate-600 mt-1.5">{n.message}</p>
                      <p className="text-xs text-slate-400 mt-1.5">{new Date(n.created_at).toLocaleString('fr-FR')}</p>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </main>
    </div>
  );
}
