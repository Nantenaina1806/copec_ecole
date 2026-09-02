import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Banknote, BarChart3, CalendarClock, CheckCircle2,
  ClipboardCheck, GraduationCap, MessageSquare, ShieldAlert, UserPlus, Users,
  Wallet, BookOpen, FileText, TrendingUp, UserCheck, UserX, Clock3
} from 'lucide-react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from 'recharts';
import client from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useAuth } from '../../context/AuthContext';
import { LoadingScreen, ErrorState } from '../../components/Feedback';
import StatCard from '../../components/StatCard';
import { SectionHeader, Badge } from '../../components/Shared';

const GRAVITE_TONE = { faible: 'slate', moyenne: 'amber', grave: 'red', tres_grave: 'red' };
const QUICK = {
  admin: [
    ['/admin/eleves?action=nouveau', 'Nouvelle inscription', UserPlus],
    ['/admin/finances', 'Nouveau paiement', Wallet],
    ['/admin/bulletins', 'Gérer les bulletins', FileText],
    ['/admin/emploi-du-temps', 'Emploi du temps', CalendarClock],
    ['/admin/rapports', 'Envoyer un rapport', MessageSquare],
    ['/admin/pilotage', 'Centre de pilotage', TrendingUp],
  ],
  economie: [
    ['/admin/finances', 'Enregistrer un paiement', Wallet],
    ['/admin/paie', 'Paie enseignants', Banknote],
    ['/admin/statistiques', 'Rapport financier', BarChart3],
  ],
  secretaire: [
    ['/admin/eleves?action=nouveau', 'Nouvelle inscription', UserPlus],
    ['/admin/certificats?action=nouveau', 'Nouveau certificat', FileText],
    ['/admin/parents?action=nouveau', 'Nouveau parent', Users],
    ['/admin/rapports', 'Envoyer un rapport', MessageSquare],
    ['/admin/pilotage', 'Centre de pilotage', TrendingUp],
  ],
  surveillant: [
    ['/admin/vie-scolaire', 'Signaler un incident', ShieldAlert],
    ['/admin/presences?tab=validation', 'Valider les pointages', ClipboardCheck],
    ['/admin/emploi-du-temps', 'Emploi du temps', CalendarClock],
    ['/admin/messagerie', 'Messagerie parents', MessageSquare],
  ],
};

const money = (v) => `${Number(v || 0).toLocaleString('fr-FR')} Ar`;
const dateLabel = (value) => new Date(value).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit' });

function PresenceTrend({ data = [], title, subtitle, accent = 'red', compact = false }) {
  const rows = data.map((r) => ({ ...r, label: dateLabel(r.date) }));
  const stroke = accent === 'amber' ? '#f59e0b' : '#ef4444';
  return (
    <Panel title={title} eyebrow={subtitle}>
      {rows.length ? (
        <div className={compact ? 'h-[230px]' : 'h-[280px]'}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 10, right: 12, left: -18, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8e5dd" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8a7f68' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#8a7f68' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e8e5dd', boxShadow: '0 8px 24px rgba(15,23,42,.08)' }} />
              <Line type="monotone" dataKey="absent" name="Absents" stroke={stroke} strokeWidth={3} dot={{ r: 3, fill: stroke }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="retard" name="Retards" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <Empty /> }
    </Panel>
  );
}


function Panel({ title, eyebrow, action, children, className = '' }) {
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

export default function TableauDeBord() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch(() => client.get('/dashboard').then((r) => r.data), []);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const role = user?.role;
  const isAdmin = data.scope === 'admin';
  const isEconomie = role === 'economie';
  const isSurveillant = role === 'surveillant';
  const isSecretaire = role === 'secretaire';
  const tauxRecouvrement = data.finances?.total_attendu > 0 ? Math.round((data.finances.total_paye / data.finances.total_attendu) * 100) : 0;
  const totalPointages = data.presence_aujourdhui.reduce((s, p) => s + Number(p.count), 0);
  const totalPresents = Number(data.presence_aujourdhui.find((p) => p.statut === 'present')?.count || 0);
  const tauxPresence = totalPointages > 0 ? Math.round((totalPresents / totalPointages) * 100) : null;
  const quick = QUICK[role] || [];
  const showFinance = isAdmin || isEconomie;
  const showImpayes = showFinance && data.eleves_impayes?.length > 0;
  const showIncidents = (isAdmin || isSurveillant) && data.incidents_recents?.length > 0;
  const showNonInscrits = (isAdmin || isSecretaire) && data.eleves_non_inscrits?.length > 0;

  return (
    <div className="page-shell space-y-6 animate-fadein">
      <SectionHeader
        title="Tableau de bord"
        subtitle={isAdmin
          ? (data.annee_scolaire ? `Pilotage de l'établissement · ${data.annee_scolaire.libelle}` : 'Configurez une année scolaire active pour commencer')
          : `Bonjour ${user?.prenom || ''}, voici votre activité du jour.`}
      />

      {isAdmin && !data.annee_scolaire && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-white text-amber-600 flex items-center justify-center shrink-0"><AlertTriangle size={18} /></div>
          <div className="min-w-0"><p className="font-semibold text-amber-900 text-sm">Aucune année scolaire active</p><p className="text-xs text-amber-800/80 mt-0.5">Les effectifs, classes et finances resteront vides tant qu&apos;une année n&apos;est pas activée.</p><Link to="/admin/annee-scolaire" className="inline-flex items-center gap-1 mt-2 text-xs font-bold text-amber-900 hover:underline">Configurer maintenant <ArrowRight size={13} /></Link></div>
        </div>
      )}

      {quick.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3"><div><p className="section-kicker">Productivité</p><h2 className="font-display font-extrabold text-slate-900">Actions rapides</h2></div></div>
          <div className={`grid grid-cols-2 gap-3 ${quick.length >= 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
            {quick.map(([to, label, Icon]) => <Link key={to} to={to} className="group rounded-2xl border border-slate-200 bg-white p-4 flex items-center gap-3 shadow-sm hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card-lg transition-all"><span className="h-10 w-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center group-hover:bg-brand-800 group-hover:text-white transition-colors"><Icon size={18} /></span><span className="min-w-0"><span className="block text-sm font-bold text-slate-800 truncate">{label}</span><span className="block text-[10px] text-slate-400 mt-0.5">Accès direct</span></span><ArrowRight size={15} className="ml-auto text-slate-300 group-hover:text-brand-600 shrink-0" /></Link>)}
          </div>
        </section>
      )}

      <div className={`grid grid-cols-2 gap-3 md:gap-4 ${isAdmin ? 'xl:grid-cols-5' : showFinance ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
        <StatCard label="Élèves inscrits" value={data.total_eleves} icon={<GraduationCap size={19} />} tone="brand" />
        <StatCard label="Classes" value={data.total_classes} icon={<BookOpen size={19} />} tone="accent" />
        <StatCard label="Enseignants" value={data.total_enseignants} icon={<Users size={19} />} tone="violet" />
        {isAdmin && <StatCard label="Personnel administratif" value={data.total_agents} icon={<Users size={19} />} tone="sky" />}
        {showFinance && <StatCard label="Recouvrement" value={`${tauxRecouvrement}%`} sub={`${money(data.finances.total_paye)} encaissés`} icon={<TrendingUp size={19} />} tone={tauxRecouvrement < 50 ? 'red' : 'green'} />}
      </div>

      {isAdmin && (
        <div className="grid xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2">
            <PresenceTrend data={data.presence_enseignants_7j} title="Absences des enseignants" subtitle="Suivi des 7 derniers jours" />
          </div>
          <Panel title="État du personnel enseignant" eyebrow="Aujourd'hui">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl p-3 border bg-emerald-50 border-emerald-100"><UserCheck size={16} className="text-emerald-600 mb-2" /><p className="text-xl font-extrabold text-emerald-700">{data.presence_enseignants_7j?.at(-1)?.present || 0}</p><p className="text-[10px] font-semibold text-slate-500">Présents</p></div>
              <div className="rounded-2xl p-3 border bg-red-50 border-red-100"><UserX size={16} className="text-red-600 mb-2" /><p className="text-xl font-extrabold text-red-700">{data.presence_enseignants_7j?.at(-1)?.absent || 0}</p><p className="text-[10px] font-semibold text-slate-500">Absents</p></div>
              <div className="rounded-2xl p-3 border bg-amber-50 border-amber-100"><Clock3 size={16} className="text-amber-600 mb-2" /><p className="text-xl font-extrabold text-amber-700">{data.presence_enseignants_7j?.at(-1)?.retard || 0}</p><p className="text-[10px] font-semibold text-slate-500">Retards</p></div>
            </div>
            <Link to="/admin/presences" className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 hover:underline">Gérer les présences <ArrowRight size={13} /></Link>
          </Panel>
        </div>
      )}

      {isSurveillant && (
        <div className="grid xl:grid-cols-2 gap-5">
          <PresenceTrend data={data.presence_eleves_7j} title="Absences des élèves" subtitle="Surveillance · 7 derniers jours" compact />
          <PresenceTrend data={data.presence_enseignants_7j} title="Absences des enseignants" subtitle="Surveillance · 7 derniers jours" accent="amber" compact />
        </div>
      )}

      {data.mes_activites && !isAdmin && (
        <Panel title="Votre activité" eyebrow="Aujourd'hui">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {isEconomie && <StatCard label="Paiements encaissés" value={money(data.mes_activites.paiements_encaisses_aujourdhui)} sub={`${data.mes_activites.nb_paiements_aujourdhui || 0} opération(s)`} icon={<Wallet size={18} />} tone="accent" />}
            {isSecretaire && <><StatCard label="Certificats émis · 7j" value={data.mes_activites.certificats_emis_semaine || 0} icon={<FileText size={18} />} /><StatCard label="Inscriptions · 7j" value={data.mes_activites.nouvelles_inscriptions_semaine || 0} icon={<UserPlus size={18} />} tone="accent" /></>}
            {isSurveillant && <StatCard label="Pointages à valider" value={data.pointages_a_valider || 0} icon={<ClipboardCheck size={18} />} tone={data.pointages_a_valider > 0 ? 'accent' : 'green'} />}
            {data.mes_activites.appels_faits_aujourdhui !== undefined && <StatCard label="Appels faits aujourd'hui" value={data.mes_activites.appels_faits_aujourdhui || 0} icon={<CheckCircle2 size={18} />} tone="green" />}
            {!isEconomie && !isSecretaire && !isSurveillant && <StatCard label="Incidents signalés · 7j" value={data.mes_activites.incidents_signales_semaine || 0} icon={<ShieldAlert size={18} />} tone="red" />}
          </div>
        </Panel>
      )}

      {isEconomie ? (
        <div className="grid xl:grid-cols-3 gap-5">
          <Panel title="Suivi de l'écolage" eyebrow="Finance" className="xl:col-span-2">
            {data.finances.total_attendu > 0 ? <div className="flex flex-col sm:flex-row items-center gap-8"><div className="w-full sm:w-1/2 h-[250px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: 'Perçu', value: Number(data.finances.total_paye) }, { name: 'Reste', value: Math.max(Number(data.finances.total_attendu) - Number(data.finances.total_paye), 0) }]} dataKey="value" innerRadius={68} outerRadius={94} paddingAngle={3}><Cell fill="#215c94" /><Cell fill="#e8e5dd" /></Pie><Tooltip formatter={(v) => money(v)} /></PieChart></ResponsiveContainer></div><div className="w-full sm:w-1/2 space-y-4"><div><p className="text-xs text-slate-400">Taux de recouvrement</p><p className="metric-number text-4xl mt-1">{tauxRecouvrement}%</p></div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-brand-700" style={{ width: `${Math.min(tauxRecouvrement, 100)}%` }} /></div><div className="space-y-2 text-sm"><div className="flex justify-between"><span className="text-slate-500">Perçu</span><strong>{money(data.finances.total_paye)}</strong></div><div className="flex justify-between"><span className="text-slate-500">Reste</span><strong>{money(Math.max(Number(data.finances.total_attendu) - Number(data.finances.total_paye), 0))}</strong></div><div className="flex justify-between border-t border-slate-100 pt-2"><span className="text-slate-500">Total attendu</span><strong>{money(data.finances.total_attendu)}</strong></div></div></div></div> : <Empty>Aucun frais scolaire enregistré sur l&apos;année active.</Empty>}
          </Panel>
          <Panel title="Actualités récentes" eyebrow="Communication" action={<Link to="/admin/actualites" className="text-xs font-bold text-brand-700">Tout voir</Link>}>
            <div className="space-y-3">{data.dernieres_actualites.length ? data.dernieres_actualites.map((a) => <div key={a.id} className="rounded-xl bg-slate-50 p-3"><p className="text-sm font-semibold text-slate-800 line-clamp-2">{a.titre}</p><p className="text-[10px] text-slate-400 mt-1">{new Date(a.created_at).toLocaleDateString('fr-FR')}</p></div>) : <Empty />}</div>
          </Panel>
        </div>
      ) : (
        <div className="grid xl:grid-cols-3 gap-5">
          <Panel title="Effectifs par classe" eyebrow="Scolarité" className="xl:col-span-2" action={<Link to="/admin/classes" className="text-xs font-bold text-brand-700">Voir les classes</Link>}>
            {data.effectif_par_classe?.length ? <div className="h-[300px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.effectif_par_classe} margin={{ top: 8, right: 10, left: -18, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e8e5dd" vertical={false} /><XAxis dataKey="nom" tick={{ fontSize: 10, fill: '#8a7f68' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#8a7f68' }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: '#f7f6f2' }} /><Bar dataKey="effectif" fill="#215c94" radius={[6, 6, 0, 0]} maxBarSize={42} /></BarChart></ResponsiveContainer></div> : <Empty />}
          </Panel>
          <Panel title="Présence aujourd'hui" eyebrow="Vie scolaire" action={tauxPresence !== null && <Badge tone={tauxPresence < 80 ? 'red' : 'green'}>{tauxPresence}% présents</Badge>}>
            <div className="space-y-2">{data.presence_aujourdhui.length ? data.presence_aujourdhui.map((p) => <div key={p.statut} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5"><span className="text-sm text-slate-600 capitalize">{p.statut}</span><span className="font-bold text-slate-900 data-mono">{p.count}</span></div>) : <Empty>Aucun appel enregistré aujourd&apos;hui.</Empty>}</div>
            <Link to="/admin/presences" className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 hover:underline">Voir les présences <ArrowRight size={13} /></Link>
          </Panel>
        </div>
      )}

      {(showNonInscrits || showImpayes || showIncidents) && <div className="grid xl:grid-cols-3 gap-5">
        {showNonInscrits && <Panel title="Dossiers à finaliser" eyebrow="Attention" action={<Badge tone="amber">À inscrire</Badge>}><div className="space-y-2">{data.eleves_non_inscrits.map((e) => <Link key={e.id} to={`/admin/eleves/${e.id}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50"><span className="min-w-0"><span className="block text-sm font-semibold text-slate-700 truncate">{e.prenom} {e.nom}</span><span className="text-[10px] text-slate-400">{e.matricule}</span></span><Badge tone="amber">Non inscrit</Badge></Link>)}</div></Panel>}
        {showImpayes && <Panel title="Impayés prioritaires" eyebrow="Finance" action={<Link to="/admin/finances" className="text-xs font-bold text-brand-700">Voir tout</Link>}><div className="space-y-2">{data.eleves_impayes.map((e) => <Link key={e.id} to={`/admin/eleves/${e.id}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-red-50/50"><span className="min-w-0"><span className="block text-sm font-semibold text-slate-700 truncate">{e.prenom} {e.nom}</span><span className="text-[10px] text-slate-400">{e.matricule}</span></span><span className="text-sm font-extrabold text-red-600 data-mono">{money(e.solde_du)}</span></Link>)}</div></Panel>}
        {showIncidents && <Panel title="Incidents récents" eyebrow="Discipline" action={<Link to="/admin/vie-scolaire" className="text-xs font-bold text-brand-700">Voir tout</Link>}><div className="space-y-2">{data.incidents_recents.map((i) => <div key={i.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5"><div className="min-w-0"><p className="text-sm font-semibold text-slate-700 truncate">{i.prenom} {i.nom}</p><p className="text-[10px] text-slate-400 capitalize">{i.type_incident.replace(/_/g, ' ')} · {new Date(i.date_incident).toLocaleDateString('fr-FR')}</p></div><Badge tone={GRAVITE_TONE[i.gravite] || 'slate'}>{i.gravite.replace('_', ' ')}</Badge></div>)}</div></Panel>}
      </div>}
    </div>
  );
}
