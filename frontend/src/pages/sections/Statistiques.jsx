import { useState } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import {
  CheckCircle2, Wallet, AlertCircle, AlertTriangle, TrendingDown, RefreshCw,
  Printer, FileSpreadsheet, Eye, Info, LayoutGrid, BookOpen, CalendarClock,
  GraduationCap, UserX, CalendarX,
} from 'lucide-react';
import client from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useAuth } from '../../context/AuthContext';
import { ErrorState } from '../../components/Feedback';
import StatCard from '../../components/StatCard';
import Modal from '../../components/Modal';
import { SectionHeader } from '../../components/Shared';
import { printMultiSectionTable, printTable } from '../../utils/exportUtils';
import { BRAND, SLATE, STATUS, SERIES } from '../../utils/chartColors';

// Palette alignée sur la charte "brand" (bleu) — plus aucune trace du vert d'origine. Les
// valeurs viennent de chartColors.js (miroir de tailwind.config.js), pas de littéraux locaux.
const COULEUR_PRESENCE = BRAND[500];
const COULEUR_MOYENNE = BRAND[700];
const STATUT_COLORS = { present: BRAND[700], absent: STATUS.danger, retard: STATUS.warning, excuse: SLATE[500] };
const STATUT_LABEL = { present: 'Présent', absent: 'Absent', retard: 'Retard', excuse: 'Excusé' };
const GRAVITE_COLORS = { faible: SLATE[400], moyenne: STATUS.warning, grave: STATUS.danger, tres_grave: STATUS.dangerDark };
const GRAVITE_LABEL = { faible: 'Faible', moyenne: 'Moyenne', grave: 'Grave', tres_grave: 'Très grave' };

function statsExportSections(data, financesGlobales) {
  const sections = [
    { title: 'Taux de présence par classe', columns: [{ label: 'Classe', value: (r) => r.classe }, { label: 'Taux (%)', value: (r) => r.taux_presence }], rows: data.presence_par_classe },
    { title: 'Moyenne des notes par classe', columns: [{ label: 'Classe', value: (r) => r.classe }, { label: 'Moyenne /20', value: (r) => r.moyenne }], rows: data.moyenne_par_classe },
    { title: 'Incidents de discipline', columns: [{ label: 'Type', value: (r) => r.type_incident }, { label: 'Gravité', value: (r) => GRAVITE_LABEL[r.gravite] || r.gravite }, { label: 'Nombre', value: (r) => r.count }], rows: data.discipline_par_type },
  ];
  if (financesGlobales) {
    sections.push({
      title: 'Résumé financier de l’établissement',
      columns: [{ label: 'Indicateur', value: (r) => r.label }, { label: 'Valeur', value: (r) => r.valeur }],
      rows: [
        { label: 'Total attendu (écolage)', valeur: `${Number(data.finances.total_attendu).toLocaleString('fr-FR')} Ar` },
        { label: 'Total perçu', valeur: `${Number(data.finances.total_paye).toLocaleString('fr-FR')} Ar` },
        { label: 'Élèves avec frais impayés', valeur: data.finances.nb_impaye },
        { label: 'Total des dépenses', valeur: `${Number(data.finances.total_depenses).toLocaleString('fr-FR')} Ar` },
        { label: 'Nombre de dépenses', valeur: data.finances.nb_depenses },
      ],
    });
  }
  if (data.role === 'secretaire') {
    sections.push({
      title: 'Résumé secrétariat',
      columns: [{ label: 'Indicateur', value: (r) => r.label }, { label: 'Valeur', value: (r) => r.valeur }],
      rows: [
        { label: 'Notes saisies', valeur: data.notes.total_notes },
        { label: 'Moyenne générale', valeur: data.notes.moyenne_generale != null ? `${data.notes.moyenne_generale}/20` : '—' },
        { label: 'Notes en difficulté (< 10)', valeur: data.notes.en_difficulte },
        { label: 'Absences élèves justifiées', valeur: `${data.absences.eleves.justifiees}/${data.absences.eleves.total}` },
        { label: 'Absences enseignants justifiées', valeur: `${data.absences.enseignants.justifiees}/${data.absences.enseignants.total}` },
      ],
    });
  }
  return sections;
}

// Squelette de chargement propre à cette page — remplace le spinner générique plein écran
// par une silhouette de la mise en page réelle (StatCards + graphiques), plus "pro".
function StatistiquesSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="h-5 w-40 bg-slate-200 rounded mb-2" />
          <div className="h-3 w-64 bg-slate-100 rounded" />
        </div>
        <div className="h-7 w-32 bg-slate-100 rounded" />
      </div>
      <div className="card mb-4 h-16" />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card h-20" />
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card h-64" />
        <div className="card h-64" />
      </div>
    </div>
  );
}

export default function Statistiques() {
  const { user } = useAuth();
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [dernierRafraichi, setDernierRafraichi] = useState(new Date());
  const [detailModal, setDetailModal] = useState(null); // { title, columns, rows, filename }

  const { data, loading, error, reload } = useFetch(
    () => client.get('/statistiques', { params: { date_debut: dateDebut || undefined, date_fin: dateFin || undefined } }).then((r) => r.data),
    [dateDebut, dateFin]
  );

  const rafraichir = () => { reload(); setDernierRafraichi(new Date()); };
  const resetFiltres = () => { setDateDebut(''); setDateFin(''); };
  const appliquerPeriode = (jours) => {
    if (!jours) return resetFiltres();
    const fin = new Date();
    const debut = new Date();
    debut.setDate(fin.getDate() - (jours - 1));
    const iso = (d) => { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const j = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${j}`; };
    setDateDebut(iso(debut));
    setDateFin(iso(fin));
  };

  if (loading) return <StatistiquesSkeleton />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const isAdmin = data.scope === 'admin';
  const isSurveillant = data.role === 'surveillant';
  const isSecretaire = data.role === 'secretaire';
  const financesGlobales = data.finances_globales;
  const notesGlobales = data.notes_globales;
  const presenceApplicable = isAdmin || data.presence_par_classe.length > 0 || data.presence_par_statut.length > 0;
  const notesApplicable = isAdmin || notesGlobales || data.moyenne_par_classe.length > 0 || Number(data.notes?.total_notes || 0) > 0;
  const gestionApplicable = isAdmin || isSurveillant;
  // Vision globale des absences (élèves + enseignants) : utile à l'admin et aux 2 rôles qui
  // gèrent désormais ce module de bout en bout (secretaire, surveillant) — cf. Présences.jsx.
  const absencesApplicable = isAdmin || isSecretaire || isSurveillant;
  const joinFr = (arr) => (arr.length <= 1 ? (arr[0] || '') : `${arr.slice(0, -1).join(', ')} et ${arr[arr.length - 1]}`);
  const globalLabels = [
    financesGlobales && 'les finances',
    notesGlobales && 'les notes',
    !isAdmin && absencesApplicable && 'les absences',
  ].filter(Boolean);

  const tauxRecouvrement = financesGlobales && data.finances.total_attendu > 0
    ? Math.round((data.finances.total_paye / data.finances.total_attendu) * 100)
    : 0;
  const resteAPercevoir = financesGlobales ? Math.max(0, Number(data.finances.total_attendu) - Number(data.finances.total_paye)) : 0;
  const tauxPresenceGlobal = (() => {
    const total = data.presence_par_statut.reduce((s, r) => s + Number(r.count), 0);
    const present = data.presence_par_statut.find((r) => r.statut === 'present')?.count || 0;
    return total > 0 ? Math.round((present / total) * 100) : 0;
  })();
  const nbIncidents = data.discipline_par_type.reduce((s, r) => s + Number(r.count), 0);
  const gravitesPresentes = Array.from(new Set(data.discipline_par_type.map((r) => r.gravite)));
  const exportSections = statsExportSections(data, financesGlobales);

  const trendPresence = data.evolution?.presence
    ? { delta: data.evolution.presence.delta, suffix: 'pt' }
    : undefined;
  const trendIncidents = data.evolution
    ? { delta: data.evolution.incidents.delta, invert: true }
    : undefined;

  const aucuneDonnee = data.presence_par_classe.length === 0
    && data.moyenne_par_classe.length === 0
    && data.discipline_par_type.length === 0
    && Number(data.finances.total_paye || 0) === 0
    && Number(data.finances.total_depenses || 0) === 0
    && (!notesApplicable || Number(data.notes?.total_notes || 0) === 0)
    && (!absencesApplicable || (Number(data.absences?.eleves?.total || 0) === 0 && Number(data.absences?.enseignants?.total || 0) === 0));

  const ouvrirDetail = (title, columns, rows, filename) => setDetailModal({ title, columns, rows, filename });

  return (
    <div>
      <SectionHeader
        title="Statistiques"
        subtitle={
          isAdmin
            ? (data.annee_scolaire ? `Année scolaire active : ${data.annee_scolaire.libelle}` : 'Aucune année scolaire active')
            : `Vos propres chiffres${globalLabels.length ? `, et ${joinFr(globalLabels)} de toute l’école` : ''}, ${user?.prenom || ''} ${user?.nom || ''}`.trim()
        }
        action={
          <button type="button" className="btn-ghost inline-flex items-center gap-2 text-xs" onClick={rafraichir}>
            <RefreshCw size={14} /> Rafraîchi à {dernierRafraichi.toLocaleTimeString('fr-FR')}
          </button>
        }
      />

      {!isAdmin && (
        <div className="card mb-4 !py-3 bg-brand-50 border border-brand-100 text-sm text-brand-800">
          {globalLabels.length > 0 ? (
            <>Les indicateurs {joinFr(globalLabels)} ci-dessous portent sur <strong>toute l&apos;école</strong> ; le nombre d&apos;incidents reste celui que <strong>vous</strong> avez personnellement signalé.</>
          ) : (
            <>Ces statistiques ne portent que sur ce que <strong>vous</strong> avez vous-même enregistré (paiements encaissés, incidents signalés{data.moyenne_par_classe.length || data.presence_par_classe.length ? ', appels, notes' : ''}).</>
          )}
        </div>
      )}

      {isAdmin && !data.annee_scolaire && (
        <div className="card mb-4 !py-3 bg-amber-50 border border-amber-100 text-sm text-amber-800">
          ⚠️ Aucune année scolaire active : les statistiques des notes peuvent être incomplètes. Vérifiez la configuration dans « Année scolaire ».
        </div>
      )}

      <div className="pro-toolbar mb-4">
        <div className="flex flex-wrap items-center gap-1.5 mr-auto">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2">Période</span>
          {[['Aujourd’hui', 1], ['7 jours', 7], ['30 jours', 30], ['90 jours', 90], ['Tout', 0]].map(([label, days]) => {
            const activePreset = days === 0 ? !dateDebut && !dateFin : !!dateDebut && !!dateFin && Math.round((new Date(dateFin) - new Date(dateDebut)) / 86400000) + 1 === days;
            return <button key={label} type="button" onClick={() => appliquerPeriode(days)} className={`btn !min-h-9 !px-3 !text-xs border ${activePreset ? 'pro-filter-active' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-200 hover:bg-brand-50'}`}>{label}</button>;
          })}
        </div>
        <div className="flex flex-wrap items-end gap-2 w-full lg:w-auto">
          <div className="min-w-[150px] flex-1 lg:flex-none">
            <label className="label">Du</label>
            <input type="date" className="input" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          </div>
          <div className="min-w-[150px] flex-1 lg:flex-none">
            <label className="label">Au</label>
            <input type="date" className="input" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
          </div>
          {(dateDebut || dateFin) && <button type="button" className="btn-ghost text-xs" onClick={resetFiltres}>Réinitialiser</button>}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={rafraichir}><RefreshCw size={15} /> Actualiser</button>
            <button type="button" className="btn-secondary hidden sm:inline-flex items-center gap-2" onClick={() => printMultiSectionTable({ title: 'Statistiques', subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`, sections: exportSections })}><Printer size={15} /> Imprimer</button>
            <button type="button" className="btn-secondary hidden md:inline-flex items-center gap-2" onClick={() => import('../../utils/excelExport').then((m) => m.exportMultiSectionToExcel({ sections: exportSections, filename: 'statistiques' }))}><FileSpreadsheet size={15} /> Excel</button>
          </div>
        </div>
      </div>

      <div className="mb-5 flex items-center justify-between gap-3 px-1">
        <div>
          <p className="text-sm font-semibold text-slate-700">Vue de pilotage</p>
          <p className="text-xs text-slate-400">{dateDebut || dateFin ? `Du ${dateDebut || '—'} au ${dateFin || '—'}` : 'Toutes les données disponibles'}</p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-2 text-[10px] font-semibold text-slate-400"><span className="status-dot bg-emerald-500" /> Données synchronisées</span>
      </div>

      <div className="sr-only" aria-live="polite">Dernière actualisation : {dernierRafraichi.toLocaleTimeString('fr-FR')}</div>

      {aucuneDonnee && (
        <div className="card mb-4 !py-3 bg-slate-50 border border-slate-200 text-sm text-slate-600 flex items-start gap-2">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>
            Aucune donnée {(dateDebut || dateFin) ? 'sur la période sélectionnée' : 'à afficher pour le moment'}.
            {(dateDebut || dateFin) && <> Essayez d&apos;élargir la période ou <button type="button" className="underline font-medium" onClick={resetFiltres}>réinitialisez le filtre</button>.</>}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {presenceApplicable && (
          <StatCard label="Taux de présence" value={`${tauxPresenceGlobal}%`} icon={<CheckCircle2 size={18} />} tone={tauxPresenceGlobal < 80 ? 'red' : 'brand'} trend={trendPresence} />
        )}
        {financesGlobales ? (
          <StatCard label="Recouvrement écolage" value={`${tauxRecouvrement}%`} sub={`${Number(data.finances.total_paye).toLocaleString('fr-FR')} Ar perçus`} icon={<Wallet size={18} />} tone={tauxRecouvrement < 50 ? 'red' : 'accent'} />
        ) : (
          <StatCard label="Vos encaissements" value={`${Number(data.finances.total_paye || 0).toLocaleString('fr-FR')} Ar`} sub={`${data.finances.nb_paiements || 0} paiement(s)`} icon={<Wallet size={18} />} tone="accent" />
        )}
        {financesGlobales && (
          <StatCard
            label="Frais impayés"
            value={data.finances.nb_impaye}
            sub={resteAPercevoir > 0 ? `≈ ${resteAPercevoir.toLocaleString('fr-FR')} Ar restants` : undefined}
            icon={<AlertCircle size={18} />}
            tone={data.finances.nb_impaye > 0 ? 'red' : 'slate'}
          />
        )}
        {financesGlobales && (
          <StatCard
            label="Dépenses de l'école"
            value={`${Number(data.finances.total_depenses || 0).toLocaleString('fr-FR')} Ar`}
            sub={`${data.finances.nb_depenses || 0} dépense(s)`}
            icon={<TrendingDown size={18} />}
            tone="slate"
          />
        )}
        <StatCard label={isAdmin ? 'Incidents discipline' : 'Vos incidents signalés'} value={nbIncidents} icon={<AlertTriangle size={18} />} tone={nbIncidents > 0 ? 'red' : 'slate'} trend={trendIncidents} />
      </div>

      {gestionApplicable && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
            {isSurveillant ? 'Ce que vous gérez actuellement' : 'Aperçu pédagogique'}
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Classes" value={data.gestion.nb_classes} icon={<LayoutGrid size={18} />} tone="brand" />
            <StatCard label="Matières actives" value={data.gestion.nb_matieres} icon={<BookOpen size={18} />} tone="accent" />
            <StatCard label="Cours à l'emploi du temps" value={data.gestion.nb_cours} icon={<CalendarClock size={18} />} tone="slate" />
          </div>
        </div>
      )}

      {isSecretaire && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
            Votre travail de secrétariat
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Notes saisies" value={data.notes.total_notes} icon={<GraduationCap size={18} />} tone="brand" />
            <StatCard
              label="Moyenne générale"
              value={data.notes.moyenne_generale != null ? `${data.notes.moyenne_generale}/20` : '—'}
              icon={<BookOpen size={18} />}
              tone={data.notes.moyenne_generale != null && data.notes.moyenne_generale < 10 ? 'red' : 'accent'}
            />
            <StatCard label="Notes en difficulté (< 10)" value={data.notes.en_difficulte} icon={<AlertTriangle size={18} />} tone={data.notes.en_difficulte > 0 ? 'red' : 'slate'} />
            <StatCard
              label="Absences élèves justifiées"
              value={`${data.absences.eleves.justifiees}/${data.absences.eleves.total}`}
              sub={data.absences.eleves.total > 0 ? `${Math.round((data.absences.eleves.justifiees / data.absences.eleves.total) * 100)}% justifiées` : undefined}
              icon={<UserX size={18} />}
              tone="accent"
            />
            <StatCard
              label="Absences enseignants justifiées"
              value={`${data.absences.enseignants.justifiees}/${data.absences.enseignants.total}`}
              sub={data.absences.enseignants.total > 0 ? `${Math.round((data.absences.enseignants.justifiees / data.absences.enseignants.total) * 100)}% justifiées` : undefined}
              icon={<CalendarX size={18} />}
              tone="accent"
            />
          </div>
        </div>
      )}

      {(presenceApplicable || notesApplicable) && (
        <div className="grid lg:grid-cols-2 gap-5 mb-5">
          {presenceApplicable && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Taux de présence par classe</h3>
              {data.presence_par_classe.length > 0 && (
                <button type="button" className="btn-ghost !p-1.5" title="Voir le détail"
                  onClick={() => ouvrirDetail('Taux de présence par classe', [{ label: 'Classe', value: (r) => r.classe }, { label: 'Taux (%)', value: (r) => r.taux_presence }], data.presence_par_classe, 'taux_presence_par_classe')}>
                  <Eye size={16} />
                </button>
              )}
            </div>
            {data.presence_par_classe.length === 0 ? (
              <p className="text-sm text-slate-400">Aucune donnée sur la période.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.presence_par_classe}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f4" />
                  <XAxis dataKey="classe" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={70} />
                  <YAxis unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="taux_presence" fill={COULEUR_PRESENCE} radius={[5, 5, 0, 0]}>{data.presence_par_classe.map((r, i) => <Cell key={r.classe} fill={SERIES[i % SERIES.length]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          )}

          {notesApplicable && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Moyenne des notes par classe</h3>
              {data.moyenne_par_classe.length > 0 && (
                <button type="button" className="btn-ghost !p-1.5" title="Voir le détail"
                  onClick={() => ouvrirDetail('Moyenne des notes par classe', [{ label: 'Classe', value: (r) => r.classe }, { label: 'Moyenne /20', value: (r) => r.moyenne }], data.moyenne_par_classe, 'moyenne_par_classe')}>
                  <Eye size={16} />
                </button>
              )}
            </div>
            {data.moyenne_par_classe.length === 0 ? (
              <p className="text-sm text-slate-400">Aucune donnée sur la période.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.moyenne_par_classe}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f4" />
                  <XAxis dataKey="classe" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={70} />
                  <YAxis domain={[0, 20]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="moyenne" fill={COULEUR_MOYENNE} radius={[5, 5, 0, 0]}>{data.moyenne_par_classe.map((r, i) => <Cell key={r.classe} fill={SERIES[(i + 1) % SERIES.length]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          )}
        </div>
      )}

      {presenceApplicable && (
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="card">
            <h3 className="font-semibold text-slate-800 mb-4">Tendance de présence (30 derniers jours)</h3>
            {data.presence_tendance_30j.length === 0 ? (
              <p className="text-sm text-slate-400">Aucune donnée sur les 30 derniers jours.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.presence_tendance_30j}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f4" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} />
                  <YAxis unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString('fr-FR')} />
                  <Line type="monotone" dataKey="taux_presence" stroke={COULEUR_PRESENCE} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card">
            <h3 className="font-semibold text-slate-800 mb-4">Répartition des statuts de présence</h3>
            {data.presence_par_statut.length === 0 ? (
              <p className="text-sm text-slate-400">Aucune donnée sur la période.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={data.presence_par_statut} dataKey="count" nameKey="statut" cx="50%" cy="50%" outerRadius={80} label={(r) => STATUT_LABEL[r.statut] || r.statut}>
                    {data.presence_par_statut.map((r) => (
                      <Cell key={r.statut} fill={STATUT_COLORS[r.statut] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, _name, entry) => [value, STATUT_LABEL[entry?.payload?.statut] || entry?.payload?.statut]} />
                  <Legend formatter={(value) => STATUT_LABEL[value] || value} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {data.discipline_par_type.length > 0 && (
        <div className="card mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-800">{isAdmin ? 'Incidents de discipline par type' : 'Vos incidents signalés, par type'}</h3>
              <button type="button" className="btn-ghost !p-1.5" title="Voir le détail"
                onClick={() => ouvrirDetail('Incidents de discipline par type', [{ label: 'Type', value: (r) => r.type_incident }, { label: 'Gravité', value: (r) => GRAVITE_LABEL[r.gravite] || r.gravite }, { label: 'Nombre', value: (r) => r.count }], data.discipline_par_type, 'discipline_par_type')}>
                <Eye size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-slate-500">
              {gravitesPresentes.map((g) => (
                <span key={g} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: GRAVITE_COLORS[g] || '#94a3b8' }} />
                  {GRAVITE_LABEL[g] || g}
                </span>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.discipline_par_type}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f4" />
              <XAxis dataKey="type_incident" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {data.discipline_par_type.map((r, i) => (
                  <Cell key={i} fill={GRAVITE_COLORS[r.gravite] || '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <Modal open={!!detailModal} onClose={() => setDetailModal(null)} title={detailModal?.title} wide>
        {detailModal && (
          <>
            <div className="flex justify-end gap-2 mb-3">
              <button type="button" className="btn-ghost inline-flex items-center gap-2 text-xs" onClick={() => printTable({ title: detailModal.title, columns: detailModal.columns, rows: detailModal.rows })}>
                <Printer size={13} /> Imprimer
              </button>
              <button type="button" className="btn-ghost inline-flex items-center gap-2 text-xs" onClick={() => import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: detailModal.columns, rows: detailModal.rows, filename: detailModal.filename }))}>
                <FileSpreadsheet size={13} /> Exporter Excel
              </button>
            </div>
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400 border-b border-slate-100">
                    {detailModal.columns.map((c) => <th key={c.label} className="py-2 pr-4">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {detailModal.rows.map((r, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      {detailModal.columns.map((c) => <td key={c.label} className="py-2 pr-4">{c.value(r)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
