import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, BookOpen, CheckCircle2, CircleDollarSign,
  Clock3, FileCheck2, GraduationCap, ShieldCheck, TrendingUp, Users, Wallet, Zap, RefreshCw
} from 'lucide-react';
import { BarChart, Bar, CartesianGrid, Cell, PieChart, Pie, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import client from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { LoadingScreen, ErrorState } from '../../components/Feedback';
import { SectionHeader, Badge } from '../../components/Shared';
import StatCard from '../../components/StatCard';
import { useAuth } from '../../context/AuthContext';

const money = (value) => `${Number(value || 0).toLocaleString('fr-FR')} Ar`;
const pct = (value) => value == null ? '—' : `${Number(value).toLocaleString('fr-FR')}%`;

const severityMeta = {
  danger: { label: 'Priorité haute', tone: 'red', icon: AlertTriangle },
  warning: { label: 'À surveiller', tone: 'amber', icon: Activity },
  info: { label: 'Information', tone: 'brand', icon: CheckCircle2 },
};

function Panel({ title, eyebrow, children, action, className = '' }) {
  return (
    <section className={`card ${className}`}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          {eyebrow && <p className="section-kicker mb-1">{eyebrow}</p>}
          <h3 className="font-display font-extrabold text-slate-900 tracking-tight">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children = 'Aucune donnée disponible.' }) {
  return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-400">{children}</div>;
}

function ProgressBar({ value, threshold = 80 }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  const cls = safe < threshold ? 'bg-red-500' : 'bg-brand-600';
  return <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${cls}`} style={{ width: `${safe}%` }} /></div>;
}

export default function Pilotage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch(() => client.get('/pilotage').then((r) => r.data), []);

  const classData = useMemo(() => (data?.classes || []).map((r) => ({
    name: r.nom,
    presence: Number(r.presence || 0),
    moyenne: Number(r.moyenne || 0),
  })), [data]);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const k = data.kpis || {};
  const finance = data.finance || {};
  const role = user?.role;
  const canSeeFinance = role === 'admin' || role === 'economie';
  const canSeeGlobal = data.scope === 'etablissement';
  const riskCount = (data.risks || []).filter((r) => r.niveau !== 'normal').length;
  const pie = [
    { name: 'Recouvré', value: Number(finance.paye || 0) },
    { name: 'Reste', value: Number(finance.reste || 0) },
  ].filter((r) => r.value > 0);

  return (
    <div className="page-shell space-y-6 animate-fadein">
      <SectionHeader
        title="Centre de pilotage"
        subtitle={data.annee_scolaire ? `Décision, alertes et contrôle transversal · ${data.annee_scolaire.libelle}` : 'Pilotage professionnel de l’établissement'}
        action={
          <button type="button" className="btn-secondary" onClick={reload}>
            <RefreshCw size={15} /> Actualiser
          </button>
        }
      />

      <div className="rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-950 to-brand-800 text-white p-5 md:p-6 shadow-lg shadow-brand-950/10">
        <div className="flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="h-12 w-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0"><Zap size={23} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-brand-200">Pilotage intelligent</p>
            <h2 className="font-display text-xl md:text-2xl font-extrabold mt-1">Le système transforme les données en actions.</h2>
            <p className="text-sm text-brand-100/80 mt-1 max-w-3xl">Contrôles métier, alertes, score d’attention des élèves, suivi financier et cohérence de l’emploi du temps travaillent ensemble sans remplacer la décision humaine.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 min-w-[220px]">
            <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2"><p className="text-[10px] text-brand-200">Alertes</p><p className="text-lg font-extrabold">{data.alerts?.length || 0}</p></div>
            <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2"><p className="text-[10px] text-brand-200">À surveiller</p><p className="text-lg font-extrabold">{riskCount}</p></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Élèves" value={k.effectif ?? 0} icon={<GraduationCap size={18} />} tone="brand" />
        <StatCard label="Présence 30 jours" value={pct(k.presence_30j)} icon={<Users size={18} />} tone={k.presence_30j != null && k.presence_30j < 90 ? 'red' : 'green'} />
        <StatCard label="Moyenne notes" value={k.notes_moyenne == null ? '—' : `${k.notes_moyenne}/20`} icon={<BookOpen size={18} />} tone={k.notes_moyenne != null && k.notes_moyenne < 10 ? 'red' : 'accent'} />
        <StatCard label="Recouvrement" value={canSeeFinance ? pct(k.recouvrement) : 'Protégé'} icon={<Wallet size={18} />} tone="accent" />
        <StatCard label="Incidents 30 jours" value={k.incidents_30j ?? 0} icon={<ShieldCheck size={18} />} tone={k.incidents_30j > 0 ? 'red' : 'slate'} />
      </div>

      <div className="grid xl:grid-cols-3 gap-5">
        <Panel title="Alertes à traiter" eyebrow="Priorités automatiques" className="xl:col-span-2" action={<Badge tone="brand">{data.alerts?.length || 0} signalements</Badge>}>
          {data.alerts?.length ? (
            <div className="space-y-2">
              {data.alerts.map((alert) => {
                const meta = severityMeta[alert.severity] || severityMeta.info;
                const Icon = meta.icon;
                return (
                  <div key={alert.code} className={`rounded-xl border px-3 py-3 flex items-start gap-3 ${alert.severity === 'danger' ? 'border-red-200 bg-red-50/70' : alert.severity === 'warning' ? 'border-amber-200 bg-amber-50/70' : 'border-sky-200 bg-sky-50/70'}`}>
                    <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${alert.severity === 'danger' ? 'bg-red-100 text-red-700' : alert.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}><Icon size={17} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold text-slate-900">{alert.title}</p><Badge tone={meta.tone}>{meta.label}</Badge></div>
                      <p className="text-xs text-slate-600 mt-0.5">{alert.detail}</p>
                    </div>
                    {alert.href && <Link to={alert.href} className="btn-ghost !px-2 !py-1.5 shrink-0"><ArrowRight size={15} /></Link>}
                  </div>
                );
              })}
            </div>
          ) : <Empty>Tout est calme : aucune alerte automatique.</Empty>}
        </Panel>

        <Panel title="Moteurs actifs" eyebrow="Automatisation métier">
          <div className="space-y-2">
            {(data.engines || []).map((engine) => (
              <div key={engine.code} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
                <span className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><CheckCircle2 size={16} /></span>
                <div className="min-w-0"><p className="text-xs font-bold text-slate-800">{engine.label}</p><p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{engine.description}</p></div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid xl:grid-cols-2 gap-5">
        <Panel title="Élèves à surveiller" eyebrow="Score d’attention" action={<span className="text-[11px] text-slate-400">Indicatif · décision humaine</span>}>
          {data.risks?.length ? (
            <div className="overflow-x-auto -mx-1">
              <table className="table-base min-w-[650px]">
                <thead><tr><th>Élève</th><th>Classe</th><th>Moyenne</th><th>Absences</th><th>Impayé</th><th>Score</th></tr></thead>
                <tbody>
                  {data.risks.map((r) => {
                    const tone = r.niveau === 'élevé' ? 'red' : r.niveau === 'vigilance' ? 'amber' : 'green';
                    return <tr key={r.id}>
                      <td><div className="font-semibold text-slate-800">{r.nom} {r.prenom || ''}</div><div className="text-[10px] text-slate-400 data-mono">{r.matricule}</div></td>
                      <td>{r.classe}</td>
                      <td>{r.moyenne ? `${r.moyenne}/20` : '—'}</td>
                      <td>{r.absences}</td>
                      <td>{r.impaye > 0 ? money(r.impaye) : '—'}</td>
                      <td><Badge tone={tone}>{r.score} · {r.niveau}</Badge></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty>Aucun élève ne déclenche actuellement le moteur d’attention.</Empty>}
        </Panel>

        <Panel title="Performance des classes" eyebrow="Présence + résultats">
          {classData.length ? <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={classData} margin={{ top: 10, right: 8, left: -15, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e5dd" />
                <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" unit="%" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" domain={[0,20]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar yAxisId="left" dataKey="presence" name="Présence %" fill="#3b82f6" radius={[5,5,0,0]} />
                <Bar yAxisId="right" dataKey="moyenne" name="Moyenne /20" fill="#d99a3f" radius={[5,5,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div> : <Empty />}
        </Panel>
      </div>

      {canSeeFinance && (
        <div className="grid xl:grid-cols-3 gap-5">
          <Panel title="Situation financière" eyebrow="Année scolaire" className="xl:col-span-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <div className="rounded-xl bg-slate-50 p-3"><p className="section-kicker">Attendu</p><p className="font-display font-extrabold text-lg mt-1">{money(finance.attendu)}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3"><p className="section-kicker">Encaissé</p><p className="font-display font-extrabold text-lg mt-1">{money(finance.paye)}</p></div>
              <div className="rounded-xl bg-red-50 p-3"><p className="section-kicker">Reste</p><p className="font-display font-extrabold text-lg mt-1">{money(finance.reste)}</p></div>
              <div className="rounded-xl bg-brand-50 p-3"><p className="section-kicker">Prévision</p><p className={`font-display font-extrabold text-lg mt-1 ${finance.solde_previsionnel < 0 ? 'text-red-700' : 'text-brand-800'}`}>{money(finance.solde_previsionnel)}</p></div>
            </div>
            <div className="grid md:grid-cols-2 gap-5 items-center">
              <div><div className="flex justify-between text-xs mb-2"><span className="font-semibold text-slate-600">Taux de recouvrement</span><span className="font-bold">{pct(finance.recouvrement)}</span></div><ProgressBar value={finance.recouvrement} /></div>
              <div className="grid grid-cols-2 gap-3 text-sm"><div><span className="text-slate-400 text-xs">Dépenses ce mois</span><p className="font-bold">{money(finance.depenses_mois)}</p></div><div><span className="text-slate-400 text-xs">Paie ce mois</span><p className="font-bold">{money(finance.paie_mois)}</p></div></div>
            </div>
          </Panel>
          <Panel title="Encaissement vs reste" eyebrow="Lecture rapide">
            {pie.length ? <div className="h-[240px] relative"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={65} outerRadius={90} paddingAngle={3}>{pie.map((entry, i) => <Cell key={entry.name} fill={i === 0 ? '#2f7d55' : '#e0a13b'} />)}</Pie><Tooltip formatter={(v) => money(v)} /></PieChart></ResponsiveContainer><div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><CircleDollarSign size={18} className="text-brand-700" /><span className="text-xl font-extrabold mt-1">{pct(finance.recouvrement)}</span><span className="text-[10px] text-slate-400">recouvré</span></div></div> : <Empty />}
          </Panel>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link to="/admin/emploi-du-temps" className="card card-hover group"><Clock3 size={18} className="text-brand-700" /><p className="font-bold text-sm mt-3">Contrôler l'EDT</p><p className="text-xs text-slate-400 mt-1">Conflits détectés : {data.integrity?.edt_conflicts || 0}</p><ArrowRight size={15} className="mt-3 text-slate-300 group-hover:text-brand-600" /></Link>
        <Link to="/admin/paie" className="card card-hover group"><FileCheck2 size={18} className="text-brand-700" /><p className="font-bold text-sm mt-3">Contrôler la paie</p><p className="text-xs text-slate-400 mt-1">À vérifier : {data.workload?.paies_a_verifier || 0}</p><ArrowRight size={15} className="mt-3 text-slate-300 group-hover:text-brand-600" /></Link>
        <Link to="/admin/statistiques" className="card card-hover group"><BarChart3 size={18} className="text-brand-700" /><p className="font-bold text-sm mt-3">Analyse détaillée</p><p className="text-xs text-slate-400 mt-1">Toutes les statistiques historiques</p><ArrowRight size={15} className="mt-3 text-slate-300 group-hover:text-brand-600" /></Link>
        <Link to="/admin/audit" className="card card-hover group"><ShieldCheck size={18} className="text-brand-700" /><p className="font-bold text-sm mt-3">Traçabilité</p><p className="text-xs text-slate-400 mt-1">{data.activity?.semaine || 0} actions cette semaine</p><ArrowRight size={15} className="mt-3 text-slate-300 group-hover:text-brand-600" /></Link>
      </div>

      <div className="text-[11px] text-slate-400 flex items-center gap-2 px-1"><TrendingUp size={13} /> Dernière synchronisation : {new Date(data.generated_at).toLocaleString('fr-FR')} · {canSeeGlobal ? 'vue établissement' : 'vue personnelle enseignant'}</div>
    </div>
  );
}
