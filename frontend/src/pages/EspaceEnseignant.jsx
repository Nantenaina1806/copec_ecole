import { useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  LayoutDashboard, BookOpen, CalendarRange,
  Mail, Phone, ArrowLeft, Users2, Clock3, History, BarChart3, Wallet,
} from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import client, { apiErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useEcole } from '../context/EcoleContext';
import { useFetch } from '../hooks/useFetch';
import { useToast } from '../context/ToastContext';
import { LoadingScreen, ErrorState } from '../components/Feedback';
import DataTable from '../components/DataTable';
import { Badge } from '../components/Shared';
import StatCard from '../components/StatCard';
import Topbar from '../components/Topbar';
import Sidebar from '../components/Sidebar';
import EmploiDuTempsGrid from '../components/EmploiDuTempsGrid';
import { BRAND, SLATE, STATUS } from '../utils/chartColors';
import { getServerNow, getServerToday } from '../utils/serverClock';
import { toArray } from '../utils/array';

const JOURS_JS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function initialesDe(nom, prenom) {
  return `${prenom?.[0] || ''}${nom?.[0] || ''}`.toUpperCase() || '?';
}

// Onglets visibles quand l'enseignant consulte son propre espace : les outils de saisie
// (Poser une note / Faire un appel / Emploi du temps / Donner un exercice) sont désormais
// accessibles depuis le sous-menu "Académique" de la barre latérale plutôt que dupliqués ici.
const TABS_ENSEIGNANT = [
  { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { key: 'paie', label: 'Ma paie', icon: Wallet },
  { key: 'historique', label: 'Historique', icon: History },
  { key: 'statistiques', label: 'Statistiques', icon: BarChart3 },
];

// Onglets visibles quand un admin consulte la fiche d'un enseignant : lecture seule
// (pas de saisie de notes ni d'appel à la place de l'enseignant).
const TABS_ADMIN_VIEW = [
  { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { key: 'edt', label: 'Emploi du temps', icon: CalendarRange },
  { key: 'historique', label: 'Historique', icon: History },
  { key: 'statistiques', label: 'Statistiques', icon: BarChart3 },
];

// Fait correspondre l'onglet courant (quand l'enseignant est sur son propre espace) à la
// section du menu latéral à mettre en surbrillance.
const SIDEBAR_ACTIVE_BY_TAB = { note: 'notes', appel: 'presences', edt: 'emploi-du-temps', exercice: 'devoirs' };

export default function EspaceEnseignant({ adminView }) {
  const { user } = useAuth();
  const ecole = useEcole();
  const { id } = useParams();
  const enseignantId = adminView ? id : user.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const TABS = adminView ? TABS_ADMIN_VIEW : TABS_ENSEIGNANT;
  const allowedTabKeys = adminView
    ? TABS_ADMIN_VIEW.map((t) => t.key)
    : [...TABS_ENSEIGNANT.map((t) => t.key), 'note', 'appel', 'edt', 'exercice'];
  const requestedTab = searchParams.get('tab');
  const tab = allowedTabKeys.includes(requestedTab) ? requestedTab : 'dashboard';
  const setTab = (key) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('tab', key);
    return next;
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: enseignant, loading: loadingEns, error: errorEns } = useFetch(
    () => (adminView ? client.get(`/utilisateurs/${enseignantId}`).then((r) => r.data) : Promise.resolve(user)),
    [enseignantId, adminView]
  );

  const { data: rawEdt } = useFetch(
    () => client.get('/emploi-du-temps', { params: { enseignant_id: enseignantId } }).then((r) => r.data),
    [enseignantId]
  );

  const { data: rawAffectations } = useFetch(
    () => client.get('/affectations/enseignant-matiere-classe', { params: { enseignant_id: enseignantId } }).then((r) => r.data),
    [enseignantId]
  );

  const { data: rawClassesAll } = useFetch(() => client.get('/classes').then((r) => r.data), []);

  const { data: salaireResume } = useFetch(
    () => (adminView ? Promise.resolve(null) : client.get('/paie/mon-salaire').then((r) => r.data)),
    [adminView]
  );

  const edt = toArray(rawEdt);
  const affectations = toArray(rawAffectations);
  const classesAll = toArray(rawClassesAll);

  const mesClasses = useMemo(() => {
    if (!classesAll || !affectations) return [];
    const ids = new Set(affectations.map((a) => String(a.classe_id)));
    return classesAll.filter((c) => ids.has(String(c.id)));
  }, [classesAll, affectations]);

  const prenom = enseignant?.prenom || '';

  if (adminView && loadingEns) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><LoadingScreen /></div>;
  if (adminView && errorEns) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><ErrorState message={errorEns} /></div>;

  const body = (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          Bonjour, {prenom} <span>👋</span>
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">Voici un aperçu de ton activité et de tes outils du jour.</p>
      </div>

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

      {tab === 'dashboard' && <TableauDeBord edt={edt} affectations={affectations} salaireResume={salaireResume} adminView={adminView} />}
      {!adminView && tab === 'paie' && <MaPaie />}
      {!adminView && tab === 'appel' && <FaireAppel enseignantId={enseignantId} mesClasses={mesClasses} />}
      {!adminView && tab === 'note' && <PoserNote enseignantId={enseignantId} adminView={adminView} mesClasses={mesClasses} affectations={affectations} />}
      {tab === 'exercice' && <DonnerExercice enseignantId={enseignantId} adminView={adminView} mesClasses={mesClasses} affectations={affectations} />}
      {tab === 'edt' && <EmploiDuTemps edt={edt} />}
      {tab === 'historique' && <HistoriqueEnseignant enseignantId={enseignantId} adminView={adminView} mesClasses={mesClasses} />}
      {tab === 'statistiques' && <StatistiquesEnseignant enseignantId={enseignantId} adminView={adminView} />}
    </div>
  );

  if (adminView) {
    const initials = initialesDe(enseignant?.nom, enseignant?.prenom);
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
                <p className="text-xs text-brand-300">Espace Enseignant — vue Admin</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-sm font-semibold">
                {initials}
              </div>
              <div className="text-right">
                <p className="font-semibold text-sm leading-tight">{enseignant?.nom?.toUpperCase()} {enseignant?.prenom}</p>
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
            {enseignant?.email && <span className="flex items-center gap-1.5"><Mail size={14} /> {enseignant.email}</span>}
            {enseignant?.telephone && <span className="flex items-center gap-1.5"><Phone size={14} /> {enseignant.telephone}</span>}
          </div>
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar active={SIDEBAR_ACTIVE_BY_TAB[tab] || 'mon-espace'} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar active="dashboard" onToggleMobile={() => setMobileOpen((o) => !o)} />
        <main className="flex-1 overflow-y-auto">{body}</main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------
function prochainCours(edt) {
  if (!edt || !edt.length) return null;
  const now = new Date();
  const todayIdx = now.getDay();
  const heureNow = now.toTimeString().slice(0, 5);
  const withOffset = edt.map((c) => {
    let offset = (JOURS_JS.indexOf(c.jour) - todayIdx + 7) % 7;
    if (offset === 0 && c.heure_debut <= heureNow) offset = 7;
    return { ...c, offset };
  });
  withOffset.sort((a, b) => a.offset - b.offset || a.heure_debut.localeCompare(b.heure_debut));
  return withOffset[0];
}

function StatMini({ label, value, icon: Icon, tone }) {
  const tones = {
    sky: 'bg-sky-50 text-sky-600',
    violet: 'bg-violet-50 text-violet-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="rounded-xl border border-slate-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${tones[tone]}`}>
          <Icon size={16} strokeWidth={2} />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ma paie — visibilité en temps réel du salaire pour l'enseignant lui-même :
// taux horaire, heures déjà comptabilisées ce mois-ci (dès qu'un pointage est validé,
// avant même que l'admin ne génère le bulletin officiel de fin de mois), estimation du
// montant du mois en cours, et l'historique des bulletins déjà émis. Consultable à
// n'importe quel moment depuis son propre espace (GET /paie/mon-salaire, /paie).
// ---------------------------------------------------------------------------
const MOIS_LIBELLE = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const STATUT_PAIE_TONE = { prepare: 'slate', valide: 'amber', paye: 'green', annule: 'red' };

function MaPaie() {
  const { data: resume, loading, error, reload } = useFetch(() => client.get('/paie/mon-salaire').then((r) => r.data), []);
  const { data: bulletins, loading: loadingBulletins } = useFetch(() => client.get('/paie').then((r) => r.data), []);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  if (!resume.grille) {
    return (
      <div className="card">
        <p className="text-sm text-slate-500">
          Aucune grille salariale active ne t’a encore été attribuée. Contacte l’administration pour la mise en place de ta rémunération.
        </p>
      </div>
    );
  }

  const { grille, mois_en_cours, total_deja_paye, total_a_venir } = resume;
  const estHoraire = grille.type_salaire === 'horaire';

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMini
          label={estHoraire ? 'Taux horaire' : 'Salaire mensuel'}
          value={`${Number(grille.montant).toLocaleString('fr-FR')} Ar${estHoraire ? ' / h' : ''}`}
          icon={Wallet} tone="violet"
        />
        <StatMini label={`Heures — ${MOIS_LIBELLE[mois_en_cours.mois - 1]}`} value={`${mois_en_cours.heures} h`} icon={Clock3} tone="sky" />
        <StatMini label="Estimation du mois en cours" value={`${Number(mois_en_cours.estimation).toLocaleString('fr-FR')} Ar`} icon={BarChart3} tone="emerald" />
        <StatMini label="Déjà versé (cumul)" value={`${Number(total_deja_paye).toLocaleString('fr-FR')} Ar`} icon={LayoutDashboard} tone="amber" />
      </div>

      {mois_en_cours.nb_en_attente > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          ⚠️ {mois_en_cours.nb_en_attente} pointage(s) de ce mois sont encore en attente de validation par l’administration —
          l’estimation ci-dessus ne les inclut pas encore et pourra donc encore augmenter.
        </div>
      )}
      {total_a_venir > 0 && (
        <div className="rounded-xl bg-brand-50 border border-brand-100 px-4 py-3 text-sm text-brand-800">
          {Number(total_a_venir).toLocaleString('fr-FR')} Ar de bulletin(s) déjà préparé(s)/validé(s) restent à te verser.
        </div>
      )}

      <div className="card">
        <h3 className="font-semibold text-slate-800 mb-4">Historique de mes bulletins</h3>
        {loadingBulletins ? (
          <p className="text-sm text-slate-400 text-center py-6">Chargement…</p>
        ) : !bulletins?.length ? (
          <p className="text-sm text-slate-400 text-center py-6">Aucun bulletin émis pour le moment.</p>
        ) : (
          <DataTable
            rows={bulletins} pageSize={12}
            columns={[
              { key: 'periode', label: 'Période', sortable: true, sortValue: (r) => r.annee * 100 + r.mois, render: (r) => `${MOIS_LIBELLE[r.mois - 1]} ${r.annee}` },
              { key: 'heures_normales', label: 'Heures', render: (r) => `${Number(r.heures_normales)} h` },
              { key: 'salaire_net', label: 'Net à payer', sortable: true, render: (r) => `${Number(r.salaire_net).toLocaleString('fr-FR')} Ar` },
              { key: 'statut', label: 'Statut', render: (r) => <Badge tone={STATUT_PAIE_TONE[r.statut]}>{r.statut}</Badge> },
              { key: 'date_paiement', label: 'Payé le', render: (r) => (r.date_paiement ? new Date(r.date_paiement).toLocaleDateString('fr-FR') : <span className="text-slate-300 text-xs">—</span>) },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function TableauDeBord({ edt, affectations, salaireResume, adminView }) {
  if (!edt) return <LoadingScreen />;
  const coursSemaine = edt.length;
  const classesSuivies = new Set(edt.map((c) => c.classe_id)).size;
  const matieresEnseignees = new Set((affectations || edt).map((c) => c.matiere_id)).size;
  const jourAujourdhui = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Indian/Antananarivo', weekday: 'long' }).format(getServerNow()).replace(/^./, (c) => c.toUpperCase());
  const coursDuJourListe = edt
    .filter((c) => c.jour === jourAujourdhui)
    .sort((a, b) => a.heure_debut.localeCompare(b.heure_debut));
  const coursDuJour = coursDuJourListe.length;
  const heuresDuJour = coursDuJourListe.reduce((total, c) => {
    const [dh, dm] = String(c.heure_debut || '00:00').split(':').map(Number);
    const [fh, fm] = String(c.heure_fin || c.heure_debut || '00:00').split(':').map(Number);
    return total + Math.max(0, (fh * 60 + fm - dh * 60 - dm) / 60);
  }, 0);
  const prochain = prochainCours(edt);
  const salaireMois = salaireResume?.mois_en_cours;
  const grille = salaireResume?.grille;
  const salaireEstime = grille && salaireMois
    ? `${Number(salaireMois.estimation || 0).toLocaleString('fr-FR')} Ar`
    : '—';

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-brand-100 bg-gradient-to-r from-white to-brand-50/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-700">Votre journée</p>
            <h3 className="text-lg font-bold text-slate-900 mt-1">{jourAujourdhui} · {coursDuJour} cours programmé{coursDuJour > 1 ? 's' : ''}</h3>
            <p className="text-sm text-slate-500 mt-1">{heuresDuJour.toFixed(1)} h d'enseignement prévues aujourd'hui.</p>
          </div>
          {prochain && (
            <div className="rounded-xl bg-white border border-slate-100 px-4 py-3 min-w-[230px]">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Prochain cours</p>
              <p className="font-bold text-slate-900 mt-1">{prochain.heure_debut} — {prochain.heure_fin}</p>
              <p className="text-sm text-slate-600 truncate">{prochain.matiere_nom || prochain.matiere || 'Matière'} · {prochain.classe_nom || prochain.classe || 'Classe'}</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatMini label="Cours aujourd'hui" value={coursDuJour} icon={Clock3} tone="amber" />
        <StatMini label="Cours cette semaine" value={coursSemaine} icon={CalendarRange} tone="sky" />
        <StatMini label="Classes suivies" value={classesSuivies} icon={Users2} tone="violet" />
        <StatMini label="Matières enseignées" value={matieresEnseignees} icon={BookOpen} tone="emerald" />
        {!adminView && <StatMini label="Salaire estimé ce mois" value={salaireEstime} icon={Wallet} tone="violet" />}
      </div>

      {coursDuJourListe.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-semibold text-slate-800">Mes cours aujourd'hui</h3>
              <p className="text-xs text-slate-400 mt-0.5">{heuresDuJour.toFixed(1)} heures prévues</p>
            </div>
            <CalendarRange size={18} className="text-brand-700" />
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {coursDuJourListe.map((cours, index) => (
              <div key={cours.id || `${cours.heure_debut}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-brand-800">{cours.heure_debut} — {cours.heure_fin}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cours {index + 1}</span>
                </div>
                <p className="font-semibold text-slate-800 mt-2 truncate">{cours.matiere_nom || cours.matiere || 'Matière'}</p>
                <p className="text-xs text-slate-500 mt-1 truncate">{cours.classe_nom || cours.classe || 'Classe'}{cours.salle_nom ? ` · ${cours.salle_nom}` : ''}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="font-semibold text-slate-800 mb-2">Prochain cours</p>
      {prochain ? (
        <div className="rounded-xl bg-brand-50 border border-brand-100 p-4">
          <p className="font-semibold text-brand-900">{prochain.matiere_nom} — {prochain.classe_nom}</p>
          <p className="text-sm text-brand-700 mt-0.5">{prochain.jour} · {prochain.heure_debut}–{prochain.heure_fin} · Salle {prochain.salle || '—'}</p>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Aucun cours à venir.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Faire un appel
// ---------------------------------------------------------------------------
function FaireAppel({ enseignantId, mesClasses }) {
  const toast = useToast();
  const [selectedClasseId, setSelectedClasseId] = useState('');
  const [presences, setPresences] = useState({});
  const [busy, setBusy] = useState(false);

  const { data: coursActuel, reload: reloadCoursActuel } = useFetch(
    () => client.get('/pointage/cours-actuel', { params: { enseignant_id: enseignantId } })
      .then((r) => r.data)
      .catch((err) => ({ __error: apiErrorMessage(err) })),
    [enseignantId]
  );

  const elevesCoursActuel = toArray(coursActuel?.eleves);
  const matchCoursActuel = Boolean(coursActuel?.cours?.classe_id) && !coursActuel.__error && String(coursActuel.cours.classe_id) === String(selectedClasseId);

  const setStatut = (eleveId, statut) => setPresences((p) => ({ ...p, [eleveId]: statut }));

  const submit = async () => {
    if (!matchCoursActuel) return;
    setBusy(true);
    try {
      const payload = elevesCoursActuel.map((e) => ({ eleve_id: e.id, statut: presences[e.id] || 'present' }));
      await client.post('/pointage/appel', {
        emploi_du_temps_id: coursActuel.cours.id,
        date_pointage: getServerToday(),
        presences: payload,
      });
      toast.success('Appel enregistré.');
      setPresences({});
      reloadCoursActuel();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const absentCount = matchCoursActuel ? Object.values(presences).filter((s) => s === 'absent').length : 0;
  const presentCount = matchCoursActuel ? elevesCoursActuel.length - absentCount : 0;

  return (
    <div className="card">
      <h3 className="font-semibold text-slate-800 mb-1">Faire un appel</h3>
      <p className="text-sm text-slate-500 mb-4">Choisis ta classe, puis touche le numéro de chaque élève absent.</p>

      <div className="flex flex-wrap gap-2 mb-5">
        {mesClasses?.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedClasseId(String(c.id))}
            className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
              String(selectedClasseId) === String(c.id) ? 'bg-brand-800 text-white' : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {c.nom}
          </button>
        ))}
        {mesClasses?.length === 0 && <p className="text-sm text-slate-400">Aucune classe affectée.</p>}
      </div>

      {!selectedClasseId && <p className="text-sm text-slate-400 py-6 text-center">Sélectionne une classe ci-dessus pour commencer.</p>}

      {selectedClasseId && !matchCoursActuel && (
        <>
          <p className="text-sm text-slate-600 mb-4">
            Aucun cours en cours pour cette classe maintenant — l’appel ne peut se faire que pendant l’horaire du cours.
          </p>
          <div className="flex flex-wrap gap-4 mb-4 opacity-50 pointer-events-none select-none">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="h-12 w-12 rounded-full border-2 border-slate-200 flex items-center justify-center text-slate-400 font-medium">
                {n}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 mb-4">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-200" /> Présent</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Absent</span>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm"><span className="text-emerald-600 font-semibold">5</span> présent(s) · <span className="text-red-600 font-semibold">0</span> absent(s)</p>
            <button className="btn-primary" disabled>Valider l’appel</button>
          </div>
        </>
      )}

      {matchCoursActuel && (
        <>
          <div className="mb-4 text-sm text-slate-500">
            {coursActuel.cours.matiere_nom} — {coursActuel.cours.classe_nom} · {coursActuel.cours.jour} {coursActuel.cours.heure_debut}–{coursActuel.cours.heure_fin}
          </div>
          <div className="flex flex-wrap gap-4 mb-4">
            {elevesCoursActuel.map((e, i) => {
              const statut = presences[e.id] || 'present';
              return (
                <button
                  key={e.id}
                  title={`${e.nom} ${e.prenom || ''}`}
                  onClick={() => setStatut(e.id, statut === 'absent' ? 'present' : 'absent')}
                  className={`h-12 w-12 rounded-full border-2 flex items-center justify-center font-medium transition-colors ${
                    statut === 'absent' ? 'border-red-500 bg-red-50 text-red-600' : 'border-slate-200 text-slate-500 hover:border-brand-300'
                  }`}
                >
                  {e.numero_classe || i + 1}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 mb-4">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-200" /> Présent</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Absent</span>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm"><span className="text-emerald-600 font-semibold">{presentCount}</span> présent(s) · <span className="text-red-600 font-semibold">{absentCount}</span> absent(s)</p>
            <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Enregistrement…' : "Valider l'appel"}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Poser une note
// ---------------------------------------------------------------------------
function PoserNote({ enseignantId, adminView, mesClasses, affectations }) {
  const toast = useToast();
  const [classeId, setClasseId] = useState('');
  const [matiereId, setMatiereId] = useState('');
  const [bimestreId, setBimestreIdRaw] = useState('');
  const [typeEvaluation, setTypeEvaluation] = useState('Contrôle');
  const [notes, setNotes] = useState({});

  const { data: rawBimestres } = useFetch(() => client.get('/bimestres').then((r) => r.data), []);
  const bimestres = toArray(rawBimestres);
  const defaultBimestreId = bimestres?.length ? String((bimestres.find((b) => b.actif) || bimestres[0]).id) : '';
  const bimestreIdEffectif = bimestreId || defaultBimestreId;
  const setBimestreId = (v) => setBimestreIdRaw(v);

  const matieresClasse = useMemo(
    () => (affectations || []).filter((a) => String(a.classe_id) === String(classeId)),
    [affectations, classeId]
  );

  const { data: rawEleves } = useFetch(
    () => (classeId ? client.get('/eleves', { params: { classe_id: classeId } }).then((r) => r.data) : Promise.resolve([])),
    [classeId]
  );
  const eleves = toArray(rawEleves);

  const submitAll = async () => {
    try {
      const entries = Object.entries(notes).filter(([, v]) => v !== '' && v !== undefined);
      if (!entries.length) { toast.error('Saisis au moins une note.'); return; }
      for (const [eleveId, valeur] of entries) {
        await client.post('/notes', {
          eleve_id: eleveId, matiere_id: matiereId, bimestre_id: bimestreIdEffectif,
          note_valeur: Number(valeur), type_evaluation: typeEvaluation || 'autre',
          enseignant_id: adminView ? enseignantId : undefined,
        });
      }
      toast.success(`${entries.length} note(s) enregistrée(s).`);
      setNotes({});
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div className="card">
      <h3 className="font-semibold text-slate-800 mb-1">Poser une note</h3>
      <p className="text-sm text-slate-500 mb-4">Choisis la classe et la matière, puis saisis la note de chaque élève.</p>

      <div className="flex flex-wrap gap-4 mb-5">
        <div className="w-44">
          <label className="label">Classe *</label>
          <select className="input" value={classeId} onChange={(e) => { setClasseId(e.target.value); setMatiereId(''); }}>
            <option value="">Classe</option>
            {mesClasses?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
        <div className="w-44">
          <label className="label">Matière *</label>
          <select className="input" value={matiereId} onChange={(e) => setMatiereId(e.target.value)} disabled={!classeId}>
            <option value="">Matière</option>
            {matieresClasse.map((m) => <option key={m.matiere_id} value={m.matiere_id}>{m.matiere_nom}</option>)}
          </select>
        </div>
        <div className="w-40">
          <label className="label">Bimestre</label>
          <select className="input" value={bimestreIdEffectif} onChange={(e) => setBimestreId(e.target.value)}>
            {bimestres?.map((b) => <option key={b.id} value={b.id}>{b.libelle}</option>)}
          </select>
        </div>
        <div className="w-44">
          <label className="label">Type d’évaluation</label>
          <input className="input" value={typeEvaluation} onChange={(e) => setTypeEvaluation(e.target.value)} />
        </div>
      </div>

      {!classeId && <p className="text-sm text-slate-400 py-8 text-center">Choisissez une classe pour commencer.</p>}
      {classeId && !matiereId && <p className="text-sm text-slate-400 py-8 text-center">Choisissez une matière.</p>}

      {classeId && matiereId && (
        <>
          <div className="divide-y divide-slate-100">
            {eleves?.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2">
                <span className="text-sm">{e.nom} {e.prenom}</span>
                <input
                  className="input w-24 text-center"
                  type="number" min="0" max="20" step="0.25"
                  value={notes[e.id] ?? ''}
                  onChange={(ev) => setNotes((n) => ({ ...n, [e.id]: ev.target.value }))}
                />
              </div>
            ))}
            {eleves?.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Aucun élève inscrit dans cette classe.</p>}
          </div>
          {eleves?.length > 0 && <button className="btn-primary w-full mt-4" onClick={submitAll}>Enregistrer toutes les notes</button>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donner un exercice
// ---------------------------------------------------------------------------
function DonnerExercice({ enseignantId, adminView, mesClasses, affectations }) {
  const toast = useToast();
  const today = getServerToday();
  const [classeId, setClasseId] = useState('');
  const [matiereId, setMatiereId] = useState('');
  const [titre, setTitre] = useState('');
  const [dateRemise, setDateRemise] = useState(today);
  const [dateLimite, setDateLimite] = useState('');
  const [consignes, setConsignes] = useState('');
  const [busy, setBusy] = useState(false);

  const matieresClasse = useMemo(
    () => (affectations || []).filter((a) => String(a.classe_id) === String(classeId)),
    [affectations, classeId]
  );

  const submit = async (e) => {
    e.preventDefault();
    if (!classeId || !matiereId || !titre) { toast.error('Classe, matière et titre sont requis.'); return; }
    setBusy(true);
    try {
      await client.post('/devoirs', {
        classe_id: classeId, matiere_id: matiereId, titre,
        consignes: consignes || null,
        date_assignation: dateRemise, date_limite: dateLimite || null,
        enseignant_id: adminView ? enseignantId : undefined,
      });
      toast.success('Exercice donné.');
      setTitre(''); setConsignes(''); setDateLimite('');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="font-semibold text-slate-800 mb-1">Donner un exercice</h3>
      <p className="text-sm text-slate-500 mb-5">Crée un exercice / devoir pour une classe et une matière que tu enseignes.</p>

      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap gap-4">
          <div className="w-44">
            <label className="label">Classe *</label>
            <select className="input" required value={classeId} onChange={(e) => { setClasseId(e.target.value); setMatiereId(''); }}>
              <option value="">Classe</option>
              {mesClasses?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div className="w-44">
            <label className="label">Matière *</label>
            <select className="input" required value={matiereId} onChange={(e) => setMatiereId(e.target.value)} disabled={!classeId}>
              <option value="">Matière</option>
              {matieresClasse.map((m) => <option key={m.matiere_id} value={m.matiere_id}>{m.matiere_nom}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label className="label">Titre *</label>
            <input className="input" required value={titre} onChange={(e) => setTitre(e.target.value)} />
          </div>
          <div className="w-44">
            <label className="label">Date de remise</label>
            <input type="date" className="input" value={dateRemise} onChange={(e) => setDateRemise(e.target.value)} />
          </div>
          <div className="w-44">
            <label className="label">Date limite</label>
            <input type="date" className="input" value={dateLimite} onChange={(e) => setDateLimite(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Consignes</label>
          <textarea className="input min-h-[8rem]" value={consignes} onChange={(e) => setConsignes(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Envoi…' : "Donner l'exercice"}</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Emploi du temps
// ---------------------------------------------------------------------------
function EmploiDuTemps({ edt }) {
  if (!edt) return <LoadingScreen />;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-slate-800">Emploi du temps</h3>
          <p className="text-sm text-slate-500">Cours de cet enseignant, organisés par jour, par matière et par classe.</p>
        </div>
        <button className="btn-secondary" disabled title="Bientôt disponible">Envoyer par email</button>
      </div>

      <EmploiDuTempsGrid edt={edt} showClasse />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historique — uniquement les présences/notes que CET enseignant a lui-même
// enregistrées (auteur = lui, déterminé côté backend depuis son login).
// ---------------------------------------------------------------------------
const TYPE_TONE = { presence: 'green', note: 'brand', finance: 'amber', discipline: 'red' };
const TYPE_LABEL = { presence: 'Présence', note: 'Note', finance: 'Finance', discipline: 'Discipline' };

function HistoriqueEnseignant({ enseignantId, adminView, mesClasses }) {
  const [classeId, setClasseId] = useState('');
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');

  const { data: reponse, loading, error, reload } = useFetch(
    () => client.get('/historique', {
      params: {
        type: ['presence', 'note'],
        enseignant_id: adminView ? enseignantId : undefined,
        classe_id: classeId || undefined,
        date_debut: dateDebut || undefined,
        date_fin: dateFin || undefined,
      },
    }).then((r) => r.data),
    [enseignantId, adminView, classeId, dateDebut, dateFin]
  );
  const rows = reponse?.rows || [];

  return (
    <div>
      <div className="card mb-4">
        <h3 className="font-semibold text-slate-800 mb-1">Historique</h3>
        <p className="text-sm text-slate-500 mb-4">
          {adminView ? "Présences et notes enregistrées par cet enseignant." : 'Tes propres appels et notes enregistrés.'}
        </p>
        <div className="flex flex-wrap gap-3">
          <div className="max-w-xs flex-1">
            <label className="label">Classe</label>
            <select className="input" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
              <option value="">Toutes tes classes</option>
              {mesClasses?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
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
// Statistiques — uniquement les classes/élèves que CET enseignant suit lui-même.
// ---------------------------------------------------------------------------
function StatistiquesEnseignant({ enseignantId, adminView }) {
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');

  const { data, loading, error, reload } = useFetch(
    () => client.get('/statistiques', {
      params: {
        enseignant_id: adminView ? enseignantId : undefined,
        date_debut: dateDebut || undefined,
        date_fin: dateFin || undefined,
      },
    }).then((r) => r.data),
    [enseignantId, adminView, dateDebut, dateFin]
  );

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const tauxPresenceGlobal = (() => {
    const total = data.presence_par_statut.reduce((s, r) => s + Number(r.count), 0);
    const present = data.presence_par_statut.find((r) => r.statut === 'present')?.count || 0;
    return total > 0 ? Math.round((present / total) * 100) : 0;
  })();

  return (
    <div>
      <div className="card mb-4">
        <h3 className="font-semibold text-slate-800 mb-1">Statistiques</h3>
        <p className="text-sm text-slate-500 mb-4">
          {adminView ? "Chiffres propres à cet enseignant, sur les classes qu'il suit." : 'Tes propres chiffres, sur les classes que tu suis.'}
        </p>
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
        <StatCard label="Taux de présence" value={`${tauxPresenceGlobal}%`} icon="✅" tone={tauxPresenceGlobal < 80 ? 'red' : 'brand'} />
        <StatCard label="Classes suivies" value={data.presence_par_classe.length || data.moyenne_par_classe.length} icon="🏫" tone="accent" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card">
          <h3 className="font-semibold text-slate-800 mb-4">Taux de présence par classe</h3>
          {data.presence_par_classe.length === 0 ? (
            <p className="text-sm text-slate-400">Aucune donnée sur la période.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.presence_par_classe}>
                <CartesianGrid strokeDasharray="3 3" stroke={SLATE[400]} strokeOpacity={0.25} />
                <XAxis dataKey="classe" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={70} />
                <YAxis unit="%" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="taux_presence" fill={STATUS.success} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h3 className="font-semibold text-slate-800 mb-4">Moyenne des notes par classe</h3>
          {data.moyenne_par_classe.length === 0 ? (
            <p className="text-sm text-slate-400">Aucune donnée sur la période.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.moyenne_par_classe}>
                <CartesianGrid strokeDasharray="3 3" stroke={SLATE[400]} strokeOpacity={0.25} />
                <XAxis dataKey="classe" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={70} />
                <YAxis domain={[0, 20]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="moyenne" fill={BRAND[500]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card mt-5">
        <h3 className="font-semibold text-slate-800 mb-4">Tendance de présence (30 derniers jours)</h3>
        {data.presence_tendance_30j.length === 0 ? (
          <p className="text-sm text-slate-400">Aucune donnée sur les 30 derniers jours.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.presence_tendance_30j}>
              <CartesianGrid strokeDasharray="3 3" stroke={SLATE[400]} strokeOpacity={0.25} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} />
              <YAxis unit="%" tick={{ fontSize: 11 }} />
              <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString('fr-FR')} />
              <Line type="monotone" dataKey="taux_presence" stroke={STATUS.success} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
