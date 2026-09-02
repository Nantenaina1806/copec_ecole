import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  LayoutDashboard, Mail, Phone, ArrowLeft, History, BarChart3, Wallet, AlertTriangle,
} from 'lucide-react';
import client from '../api/client';
import { useEcole } from '../context/EcoleContext';
import { useFetch } from '../hooks/useFetch';
import { LoadingScreen, ErrorState } from '../components/Feedback';
import DataTable from '../components/DataTable';
import { Badge } from '../components/Shared';
import StatCard from '../components/StatCard';

const ROLE_LABELS = { secretaire: 'Secrétaire', economie: 'Économe', surveillant: 'Surveillant' };

const TYPE_LABEL = { finance: 'Paiement encaissé', discipline: 'Incident signalé' };
const TYPE_TONE = { finance: 'green', discipline: 'amber' };

const TABS = [
  { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { key: 'historique', label: 'Historique', icon: History },
  { key: 'statistiques', label: 'Statistiques', icon: BarChart3 },
];

function initialesDe(nom, prenom) {
  return `${prenom?.[0] || ''}${nom?.[0] || ''}`.toUpperCase() || '?';
}

// Fiche en lecture seule d'un agent (secretaire/economie/surveillant), consultée uniquement par
// l'admin depuis /admin/comptes -> Profil — même esprit que /admin/enseignants/:id/espace, mais
// centré sur ce que cet agent voit lui-même dans son propre tableau de bord/historique/statistiques
// (finances qu'il a encaissées, incidents de discipline qu'il a signalés — cf. backend/src/routes
// dashboard.js, historique.js, statistiques.js, scope agent_id).
export default function EspaceAgent() {
  const { id } = useParams();
  const ecole = useEcole();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab = TABS.some((t) => t.key === requestedTab) ? requestedTab : 'dashboard';
  const setTab = (key) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('tab', key);
    return next;
  });

  const { data: agent, loading: loadingAgent, error: errorAgent } = useFetch(
    () => client.get(`/agents/${id}`).then((r) => r.data),
    [id]
  );

  if (loadingAgent) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><LoadingScreen /></div>;
  if (errorAgent) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><ErrorState message={errorAgent} /></div>;

  const initials = initialesDe(agent?.nom, agent?.prenom);
  const roleLabel = ROLE_LABELS[agent?.role_agent] || agent?.role_agent;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-brand-950 text-white">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-white flex items-center justify-center p-1 overflow-hidden">
              <img src={ecole.logo_url || '/logo.jpg'} alt={ecole.nom_ecole} className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="font-bold leading-tight">{ecole.nom_ecole}</p>
              <p className="text-xs text-brand-300">Espace {roleLabel} — vue Admin</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-sm font-semibold">
              {initials}
            </div>
            <div className="text-right">
              <p className="font-semibold text-sm leading-tight">{agent?.nom?.toUpperCase()} {agent?.prenom}</p>
              <p className="text-xs text-brand-300">Consulté par l’administration</p>
            </div>
            <Link to="/admin/comptes" className="btn !bg-white/10 !text-white border border-white/20 hover:!bg-white/20">
              <ArrowLeft size={16} /> Retour
            </Link>
          </div>
        </div>
      </header>
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-2.5 flex flex-wrap items-center gap-5 text-sm text-slate-500">
          <Badge tone="brand">{roleLabel}</Badge>
          {agent?.email && <span className="flex items-center gap-1.5"><Mail size={14} /> {agent.email}</span>}
          {agent?.telephone && <span className="flex items-center gap-1.5"><Phone size={14} /> {agent.telephone}</span>}
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <div className="flex gap-1 mb-5 flex-wrap bg-white rounded-xl border border-slate-100 p-1.5 shadow-card">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active ? 'bg-brand-800 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={16} strokeWidth={2} /> {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'dashboard' && <DashboardAgent agentId={id} />}
        {tab === 'historique' && <HistoriqueAgent agentId={id} />}
        {tab === 'statistiques' && <StatistiquesAgent agentId={id} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tableau de bord — récapitulatif du jour pour cet agent (mes_activites, scope=agent).
// ---------------------------------------------------------------------------
function DashboardAgent({ agentId }) {
  const { data, loading, error, reload } = useFetch(
    () => client.get('/dashboard', { params: { agent_id: agentId } }).then((r) => r.data),
    [agentId]
  );

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const activites = data.mes_activites || {};

  return (
    <div>
      <div className="card mb-4">
        <h3 className="font-semibold text-slate-800 mb-1">Activité du jour</h3>
        <p className="text-sm text-slate-500">Ce que cet agent a lui-même encaissé/signalé aujourd’hui et sur la semaine.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Paiements encaissés aujourd’hui"
          value={activites.nb_paiements_aujourdhui ?? 0}
          sub={activites.paiements_encaisses_aujourdhui ? `${Number(activites.paiements_encaisses_aujourdhui).toLocaleString('fr-FR')} Ar` : undefined}
          icon="💰" tone="brand"
        />
        <StatCard
          label="Incidents signalés (7 jours)"
          value={activites.incidents_signales_semaine ?? 0}
          icon="⚠️" tone="accent"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historique — finances encaissées + discipline signalée par cet agent (scope automatique
// côté backend : un agent n'est jamais auteur de présences/notes).
// ---------------------------------------------------------------------------
function HistoriqueAgent({ agentId }) {
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');

  const { data: reponse, loading, error, reload } = useFetch(
    () => client.get('/historique', {
      params: { agent_id: agentId, date_debut: dateDebut || undefined, date_fin: dateFin || undefined },
    }).then((r) => r.data),
    [agentId, dateDebut, dateFin]
  );
  const rows = reponse?.rows || [];

  return (
    <div>
      <div className="card mb-4">
        <h3 className="font-semibold text-slate-800 mb-1">Historique</h3>
        <p className="text-sm text-slate-500 mb-4">Paiements encaissés et incidents de discipline enregistrés par cet agent.</p>
        <div className="flex flex-wrap gap-3">
          <div className="max-w-xs flex-1">
            <label className="label">Du</label>
            <input type="date" className="input" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="label">Au</label>
            <input type="date" className="input" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={rows}
          pageSize={20}
          columns={[
            { key: 'date', label: 'Date', sortable: true, render: (r) => new Date(r.date).toLocaleDateString('fr-FR') },
            { key: 'type', label: 'Type', sortable: true, render: (r) => <Badge tone={TYPE_TONE[r.type] || 'slate'}>{TYPE_LABEL[r.type] || r.type}</Badge> },
            { key: 'eleve', label: 'Élève', sortValue: (r) => `${r.eleve_nom || ''} ${r.eleve_prenom || ''}`, render: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom || ''}`.trim() || '—' },
            { key: 'titre', label: 'Événement' },
            { key: 'detail', label: 'Détail', render: (r) => r.detail || '—' },
          ]}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statistiques — chiffres propres à cet agent (paiements qu'il a encaissés, discipline qu'il a
// signalée), sur la période choisie.
// ---------------------------------------------------------------------------
function StatistiquesAgent({ agentId }) {
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');

  const { data, loading, error, reload } = useFetch(
    () => client.get('/statistiques', {
      params: { agent_id: agentId, date_debut: dateDebut || undefined, date_fin: dateFin || undefined },
    }).then((r) => r.data),
    [agentId, dateDebut, dateFin]
  );

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div>
      <div className="card mb-4">
        <h3 className="font-semibold text-slate-800 mb-1">Statistiques</h3>
        <p className="text-sm text-slate-500 mb-4">Chiffres propres à cet agent, sur la période choisie.</p>
        <div className="flex flex-wrap gap-3">
          <div className="max-w-xs flex-1">
            <label className="label">Du</label>
            <input type="date" className="input" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="label">Au</label>
            <input type="date" className="input" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Total encaissé"
          value={`${Number(data.finances?.total_paye || 0).toLocaleString('fr-FR')} Ar`}
          icon={<Wallet size={18} />} tone="brand"
        />
        <StatCard
          label="Nombre de paiements"
          value={data.finances?.nb_paiements ?? 0}
          icon={<Wallet size={18} />} tone="accent"
        />
        <StatCard
          label="Incidents signalés"
          value={(data.discipline_par_type || []).reduce((s, r) => s + Number(r.count), 0)}
          icon={<AlertTriangle size={18} />} tone="red"
        />
      </div>

      <div className="card">
        <h3 className="font-semibold text-slate-800 mb-4">Discipline par type</h3>
        {(!data.discipline_par_type || data.discipline_par_type.length === 0) ? (
          <p className="text-sm text-slate-400">Aucune donnée sur la période.</p>
        ) : (
          <DataTable
            rows={data.discipline_par_type}
            pageSize={10}
            columns={[
              { key: 'type_incident', label: 'Type' },
              { key: 'gravite', label: 'Gravité' },
              { key: 'count', label: 'Occurrences' },
            ]}
          />
        )}
      </div>
    </div>
  );
}
