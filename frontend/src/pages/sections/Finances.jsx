import { useMemo, useRef, useState } from 'react';
import {
  Receipt, Printer, Wallet, Sparkles, BellRing, LayoutGrid, List, Layers,
  Inbox, CheckCircle2, Clock, AlertTriangle, AlertOctagon, FileSpreadsheet, ShieldCheck, Search,
} from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { SectionHeader, Badge, SearchInput, MontantInput } from '../../components/Shared';
import StatCard from '../../components/StatCard';
import { PaiementHeader, ModePaiementChoix, RecapPaiement, BarrePaiement } from '../../components/PaiementUI';
import { printRecuPaiement, printRecuPaiementLot, printCarnetEcolage, printTable } from '../../utils/exportUtils';
import { getServerNow } from '../../utils/serverClock';

const STATUT_TONE = { paye: 'green', partiel: 'amber', impaye: 'red' };
// Bug corrigé (QA) : ce badge de couleur était utilisé dans le tableau des mouvements de
// caisse (onglet Historique) sans jamais avoir été défini, ce qui provoquait un plantage
// (ReferenceError) de la page pour tout rôle consultant cet onglet.
const MOUVEMENT_TONE = { entree: 'green', sortie: 'red' };
const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function moisDeRetard(dateEcheance, statut) {
  if (!dateEcheance || statut === 'paye') return 0;
  const echeance = new Date(dateEcheance);
  const aujourdhui = getServerNow();
  if (echeance > aujourdhui) return 0;
  let mois = (aujourdhui.getFullYear() - echeance.getFullYear()) * 12 + (aujourdhui.getMonth() - echeance.getMonth());
  if (aujourdhui.getDate() < echeance.getDate()) mois -= 1;
  return Math.max(mois, aujourdhui > echeance ? 1 : 0);
}

function libelleRetard(mois) {
  if (mois <= 0) return null;
  if (mois === 1) return 'Retard : 1 mois';
  return `Retard : ${mois} mois`;
}

const FRAIS_EXPORT_COLUMNS = [
  { label: 'Élève', value: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}`.trim() },
  { label: 'Libellé', value: (r) => r.libelle || r.type_frais },
  { label: 'Mois', value: (r) => (r.mois ? MOIS[r.mois - 1] : '') },
  { label: 'Montant total (Ar)', value: (r) => r.montant_total },
  { label: 'Payé (Ar)', value: (r) => r.total_paye },
  { label: 'Statut', value: (r) => r.statut },
  { label: 'Retard', value: (r) => libelleRetard(moisDeRetard(r.date_echeance, r.statut)) || '' },
];

export default function Finances() {
  const [tab, setTab] = useState('pilotage');
  return (
    <div>
      <SectionHeader title="Finances" subtitle="Écolage, paiements, caisse et dépenses" />
      <div className="flex gap-2 mb-5">
        <button className={tab === 'pilotage' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('pilotage')}>Pilotage financier</button>
        <button className={tab === 'frais' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('frais')}>Frais & Paiements</button>
        <button className={tab === 'tarifs' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('tarifs')}>Tarifs</button>
        <button className={tab === 'caisse' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('caisse')}>Caisse & Dépenses</button>
        <button className={tab === 'relances' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('relances')}>Relances impayés</button>
        <button className={tab === 'historique' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('historique')}>Historique</button>
        <button className={tab === 'controle' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('controle')}><ShieldCheck size={14} className="inline mr-1" />Contrôle</button>
      </div>
      {tab === 'pilotage' && <PilotageFinancier />}
      {tab === 'frais' && <FraisPaiements />}
      {tab === 'tarifs' && <TarifsFrais />}
      {tab === 'caisse' && <CaisseDepenses />}
      {tab === 'relances' && <RelancesImpayes />}
      {tab === 'historique' && <Historique />}
      {tab === 'controle' && <ControleFinance />}
    </div>
  );
}

function PilotageFinancier() {
  const now = getServerNow();
  const [debut, setDebut] = useState(`${now.getFullYear()}-01-01`);
  const [fin, setFin] = useState(`${now.getFullYear()}-12-31`);
  const { data, loading, error, reload } = useFetch(() => client.get('/finance/dashboard', { params: { date_debut: debut, date_fin: fin } }).then(r => r.data), [debut, fin]);
  if (loading) return <div className="card text-sm text-slate-500">Chargement du pilotage financier…</div>;
  if (error) return <div className="card text-sm text-red-600">Impossible de charger le tableau financier.</div>;
  const r=data?.resume || {};
  return <div className="space-y-4">
    <div className="card flex flex-wrap items-end gap-3">
      <div><label className="label">Du</label><input className="input" type="date" value={debut} onChange={e=>setDebut(e.target.value)} /></div>
      <div><label className="label">Au</label><input className="input" type="date" value={fin} onChange={e=>setFin(e.target.value)} /></div>
      <button className="btn-secondary" onClick={reload}>Actualiser</button>
    </div>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="Facturé" value={`${Number(r.total_facture||0).toLocaleString('fr-FR')} Ar`} icon={Receipt} />
      <StatCard label="Encaissé" value={`${Number(r.total_encaisse||0).toLocaleString('fr-FR')} Ar`} icon={CheckCircle2} />
      <StatCard label="Dépenses" value={`${Number(r.total_depenses||0).toLocaleString('fr-FR')} Ar`} icon={Wallet} />
      <StatCard label="Solde période" value={`${Number(r.solde_periode||0).toLocaleString('fr-FR')} Ar`} icon={LayoutGrid} />
    </div>
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="card"><p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Recouvrement</p><p className="metric-number text-2xl mt-1">{Number(r.taux_recouvrement||0).toLocaleString('fr-FR')}%</p><p className="text-xs text-slate-500 mt-1">Sur les frais enregistrés sur la période.</p></div>
      <div className="card"><p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Impayés échus</p><p className="metric-number text-2xl mt-1 text-red-700">{Number(r.impayes_echeance||0).toLocaleString('fr-FR')} Ar</p><p className="text-xs text-slate-500 mt-1">{r.nb_impayes || 0} frais à relancer.</p></div>
      <div className="card"><p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Caisses</p><div className="mt-2 space-y-2">{(data?.caisses||[]).map(c=><div key={c.id} className="flex justify-between text-sm"><span>{c.nom}</span><strong>{Number(c.solde_theorique).toLocaleString('fr-FR')} Ar</strong></div>)}</div></div>
    </div>
  </div>;
}

function ControleFinance() {
  const [search, setSearch] = useState('');
  const [classeId, setClasseId] = useState('');
  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);
  const { data: controle, loading, error, reload } = useFetch(() => client.get('/finance/controle').then((r) => r.data), []);
  const { data: situations, loading: loadingSituations } = useFetch(
    () => client.get('/finance/situations-eleves', { params: { search: search || undefined, classe_id: classeId || undefined } }).then((r) => r.data),
    [search, classeId]
  );
  const s = controle?.synthese || {};
  return <div className="space-y-4">
    <div className="card flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="font-semibold text-slate-800 flex items-center gap-2"><ShieldCheck size={18}/> Contrôle financier</h3><p className="text-sm text-slate-500 mt-1">Vérifications automatiques d'intégrité et situation des élèves.</p></div>
      <button className="btn-secondary" onClick={reload}>Actualiser</button>
    </div>
    {loading ? <div className="card text-sm text-slate-500">Contrôle en cours…</div> : error ? <div className="card text-sm text-red-600">Impossible de charger le contrôle financier.</div> : <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Frais ouverts" value={Number(s.frais_ouverts || 0).toLocaleString('fr-FR')} icon={Clock} />
        <StatCard label="Encaissé aujourd'hui" value={`${Number(s.encaisse_aujourd_hui || 0).toLocaleString('fr-FR')} Ar`} icon={CheckCircle2} />
        <StatCard label="Dépenses aujourd'hui" value={`${Number(s.depenses_aujourd_hui || 0).toLocaleString('fr-FR')} Ar`} icon={Wallet} />
        <StatCard label="Caisses clôturées" value={Number(s.caisses_cloturees_aujourdhui || 0).toLocaleString('fr-FR')} icon={ShieldCheck} />
      </div>
      <div className="card">
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">Anomalies détectées</h3><span className="badge">{controle?.anomalies?.length || 0}</span></div>
        {!controle?.anomalies?.length ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">Aucune anomalie détectée par les contrôles V12.</div> : <DataTable rows={controle.anomalies} pageSize={10} emptyLabel="Aucune anomalie." columns={[
          { key: 'type', label: 'Type' }, { key: 'id', label: 'ID', sortable: true }, { key: 'eleve', label: 'Élément' }, { key: 'montant', label: 'Montant', render: r => r.montant ? `${Number(r.montant).toLocaleString('fr-FR')} Ar` : '—' }, { key: 'message', label: 'Contrôle' }
        ]}/>}</div>
      <div className="card">
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex-1 min-w-56"><label className="label"><Search size={13} className="inline mr-1"/>Rechercher un élève</label><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nom, prénom ou matricule…" /></div>
          <div className="w-56"><label className="label">Classe</label><select className="input" value={classeId} onChange={e => setClasseId(e.target.value)}><option value="">Toutes les classes</option>{classes?.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}</select></div>
        </div>
        <DataTable loading={loadingSituations} rows={situations || []} pageSize={15} emptyLabel="Aucune situation financière trouvée." columns={[
          { key: 'matricule', label: 'Matricule', sortable: true },
          { key: 'nom', label: 'Élève', sortable: true, render: r => `${r.prenom || ''} ${r.nom || ''}`.trim() },
          { key: 'classe_nom', label: 'Classe', sortable: true },
          { key: 'total_facture', label: 'Facturé', sortable: true, render: r => `${Number(r.total_facture).toLocaleString('fr-FR')} Ar` },
          { key: 'total_paye', label: 'Payé', sortable: true, render: r => `${Number(r.total_paye).toLocaleString('fr-FR')} Ar` },
          { key: 'solde', label: 'Solde', sortable: true, render: r => <span className={Number(r.solde) > 0 ? 'font-semibold text-red-700' : 'font-semibold text-emerald-700'}>{Number(r.solde).toLocaleString('fr-FR')} Ar</span> },
          { key: 'nb_frais_en_retard', label: 'Retards', sortable: true, render: r => Number(r.nb_frais_en_retard) ? <Badge tone="red">{r.nb_frais_en_retard}</Badge> : <Badge tone="green">0</Badge> }
        ]}/>
      </div>
    </>}
  </div>;
}

function FraisPaiements() {
  const [modalFraisOpen, setModalFraisOpen] = useState(false);
  const [modalPaieOpen, setModalPaieOpen] = useState(false);
  const [modalRecusOpen, setModalRecusOpen] = useState(false);
  const [modalLotOpen, setModalLotOpen] = useState(false);
  const [fraisActif, setFraisActif] = useState(null);
  const [eleveLot, setEleveLot] = useState(null); // { eleve_id, nom, prenom, impayes: [...] } — élève ciblé par le paiement groupé
  const [recusFrais, setRecusFrais] = useState([]);
  const [recusLoading, setRecusLoading] = useState(false);
  // 'table' = liste plate (comme avant) ; 'eleves' = petites cartes par élève, pour voir
  // d'un coup d'œil qui a déjà tout payé sans dérouler toute la liste de frais.
  const [vue, setVue] = useState('table');
  const toast = useToast();

  const { data: eleves } = useFetch(() => client.get('/eleves').then((r) => r.data), []);
  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);
  // Coordonnées réelles de l'établissement (nom, tél, email — modifiables dans Paramètres),
  // utilisées sur l'en-tête du reçu de paiement imprimé (voir submitPaie plus bas).
  const { data: ecole } = useFetch(() => client.get('/parametres').then((r) => r.data), []);
  const { data: annee } = useFetch(() => client.get('/annees-scolaires/active').then((r) => r.data), []);
  // Grille tarifaire de l'année active : sert à pré-remplir automatiquement le montant du
  // formulaire "Nouveau frais scolaire" dès que l'élève et le type de frais sont choisis
  // (ex. élève en 6ème + Écolage -> 25 000 Ar), au lieu de le laisser ressaisir à la main.
  const { data: tarifs } = useFetch(
    () => (annee ? client.get('/finance/tarifs', { params: { annee_scolaire_id: annee.id } }).then((r) => r.data) : Promise.resolve([])),
    [annee?.id]
  );

  const [search, setSearch] = useState('');
  const [filtreStatut, setFiltreStatut] = useState('tous');
  const [filtreRetard, setFiltreRetard] = useState('tous');
  const [filtreClasseId, setFiltreClasseId] = useState('');
  const [filtreMois, setFiltreMois] = useState('');
  // Ancre pour le scroll automatique déclenché par un clic sur une StatCard (cf. filtrerEtScroller).
  const tableRef = useRef(null);
  // Clic sur une StatCard « Non payés » / « En retard » : applique le filtre correspondant,
  // repasse en vue liste (la seule qui expose ces filtres) et amène le tableau à l'écran —
  // évite d'avoir à dérouler manuellement jusqu'au tableau puis rouvrir les filtres soi-même.
  const filtrerEtScroller = (statut, retard) => {
    setFiltreStatut(statut);
    setFiltreRetard(retard);
    setVue('table');
    requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const { data: frais, loading, error, reload } = useFetch(
    () => client.get('/finance/frais', { params: filtreClasseId ? { classe_id: filtreClasseId } : {} }).then((r) => r.data),
    [filtreClasseId]
  );

  const fraisAffiches = (frais || []).filter((f) => {
    if (search) {
      const q = search.toLowerCase();
      if (!`${f.eleve_prenom || ''} ${f.eleve_nom}`.toLowerCase().includes(q)) return false;
    }
    if (filtreStatut === 'du' && f.statut === 'paye') return false;
    if (filtreStatut !== 'tous' && filtreStatut !== 'du' && f.statut !== filtreStatut) return false;
    if (filtreMois && Number(f.mois) !== Number(filtreMois)) return false;
    const retard = moisDeRetard(f.date_echeance, f.statut);
    if (filtreRetard === 'aucun' && retard > 0) return false;
    if (filtreRetard === '1' && retard < 1) return false;
    if (filtreRetard === '2' && retard < 2) return false;
    if (filtreRetard === '3' && retard < 3) return false;
    return true;
  });

  const totaux = (frais || []).reduce((acc, f) => ({
    attendu: acc.attendu + Number(f.montant_total),
    percu: acc.percu + Number(f.total_paye),
  }), { attendu: 0, percu: 0 });

  // Vue "par élève" : petites cartes montrant en un coup d'œil ce qui est déjà réglé et ce qui
  // reste dû, sans avoir à parcourir toute la liste de frais ligne par ligne. Respecte le
  // filtre classe (déjà appliqué côté API) et la recherche par nom, mais pas statut/retard —
  // une carte doit rester visible même si l'élève a un seul frais impayé filtré ailleurs.
  const elevesAffiches = useMemo(() => {
    const q = search.toLowerCase();
    const parId = new Map();
    for (const f of frais || []) {
      if (q && !`${f.eleve_prenom || ''} ${f.eleve_nom}`.toLowerCase().includes(q)) continue;
      if (!parId.has(f.eleve_id)) {
        parId.set(f.eleve_id, { eleve_id: f.eleve_id, nom: f.eleve_nom, prenom: f.eleve_prenom, fraisList: [] });
      }
      parId.get(f.eleve_id).fraisList.push(f);
    }
    return [...parId.values()].map((e) => {
      const impayes = e.fraisList
        .filter((f) => f.statut === 'impaye' || f.statut === 'partiel')
        // Le plus ancien d'abord : quand un montant global est réparti (paiement groupé),
        // on veut solder les dettes les plus anciennes en priorité.
        .sort((a, b) => new Date(a.date_echeance || '9999-12-31') - new Date(b.date_echeance || '9999-12-31'));
      // Vue "12 mois" : uniquement l'écolage (le frais mensuel récurrent), payé ou non,
      // trié chronologiquement — sert de grille cliquable dans le modal de paiement groupé.
      const moisEcolage = e.fraisList
        .filter((f) => f.type_frais === 'ecolage')
        .sort((a, b) => new Date(a.date_echeance || '9999-12-31') - new Date(b.date_echeance || '9999-12-31'));
      const total_du = e.fraisList.reduce((s, f) => s + Number(f.montant_total), 0);
      const total_paye = e.fraisList.reduce((s, f) => s + Number(f.total_paye), 0);
      return { ...e, impayes, moisEcolage, total_du, total_paye, solde: total_du - total_paye };
    }).sort((a, b) => b.impayes.length - a.impayes.length || `${a.nom}`.localeCompare(`${b.nom}`, 'fr'));
  }, [frais, search]);

  const [formFrais, setFormFrais] = useState({ eleve_id: '', type_frais: 'ecolage', libelle: '', montant_total: '', mois: '', date_echeance: '' });
  // Tant que l'agent n'a pas retouché le champ Montant à la main, il reste piloté par la
  // grille tarifaire (auto-rempli/rafraîchi à chaque changement d'élève ou de type). Dès qu'il
  // le modifie lui-même, on arrête de l'écraser — cas des frais hors grille (cantine, transport…)
  // ou d'un montant particulier pour un élève donné.
  const [montantManuel, setMontantManuel] = useState(false);

  // Cherche le tarif officiel (niveau de l'élève + type de frais) dans la grille tarifaire —
  // voir onglet Tarifs. eleves[].niveau_id est renvoyé par GET /eleves (inscription active).
  const tarifPourEleve = (eleveId, type) => {
    const eleve = (eleves || []).find((e) => String(e.id) === String(eleveId));
    if (!eleve?.niveau_id) return null;
    return (tarifs || []).find((t) => t.niveau_id === eleve.niveau_id && t.type_frais === type) || null;
  };

  const appliquerTarifAuto = (eleveId, type, base) => {
    if (montantManuel) return base;
    const tarif = tarifPourEleve(eleveId, type);
    if (!tarif) return base;
    return { ...base, montant_total: tarif.montant, libelle: base.libelle || tarif.libelle || '' };
  };

  const setF = (k) => (e) => setFormFrais((f) => ({ ...f, [k]: e.target.value }));
  const setMontant = (v) => { setMontantManuel(true); setFormFrais((f) => ({ ...f, montant_total: v })); };
  const setEleve = (e) => {
    const eleve_id = e.target.value;
    setFormFrais((f) => appliquerTarifAuto(eleve_id, f.type_frais, { ...f, eleve_id }));
  };
  // Le mois n'a de sens que pour un frais récurrent (écolage) — on l'efface si l'agent change
  // de type pour ne pas envoyer un mois orphelin sur un frais unique (inscription, cantine...).
  const setType = (e) => {
    const type_frais = e.target.value;
    setFormFrais((f) => appliquerTarifAuto(f.eleve_id, type_frais, { ...f, type_frais, mois: type_frais === 'ecolage' ? f.mois : '' }));
  };
  const resetFormFrais = () => {
    setMontantManuel(false);
    setFormFrais({ eleve_id: '', type_frais: 'ecolage', libelle: '', montant_total: '', mois: '', date_echeance: '' });
  };

  const submitFrais = async (e) => {
    e.preventDefault();
    try {
      await client.post('/finance/frais', { ...formFrais, annee_scolaire_id: annee.id });
      toast.success('Frais enregistré.');
      setModalFraisOpen(false);
      resetFormFrais();
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const [formPaie, setFormPaie] = useState({ montant: '', mode_paiement: 'especes', reference_paiement: '' });
  const setP = (k) => (e) => setFormPaie((f) => ({ ...f, [k]: e.target.value }));

  const submitPaie = async (e) => {
    e.preventDefault();
    try {
      const { data } = await client.post('/finance/paiements', { ...formPaie, frais_id: fraisActif.id });
      toast.success('Paiement enregistré.');
      setModalPaieOpen(false);
      setFormPaie({ montant: '', mode_paiement: 'especes', reference_paiement: '' });
      printRecuPaiement({
        paiement: { ...data, eleve_nom: fraisActif.eleve_nom, eleve_prenom: fraisActif.eleve_prenom, frais_libelle: fraisActif.libelle || fraisActif.type_frais },
        frais: { montant_total: fraisActif.montant_total, total_paye: data.reste != null ? Number(fraisActif.montant_total) - data.reste : undefined },
        ecole,
      });
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  // --- Paiement groupé (plusieurs mois d'écolage / plusieurs frais d'un même élève en une fois) ---
  // Sélection UNIQUEMENT par clic, et TOUJOURS séquentielle : impossible de choisir Mars sans
  // Janvier/Février s'ils sont encore impayés. On ne mémorise donc pas une liste de frais_id
  // cochés librement, mais un simple compteur "nbMoisSelectionnes" = nombre de mois consécutifs
  // pris depuis le plus ancien impayé (eleveLot.impayes est déjà trié par date_echeance croissante
  // — voir elevesAffiches) ; frais_ids en est directement dérivé, ce qui rend une sélection
  // "avec un trou" tout simplement impossible à représenter.
  const [nbMoisSelectionnes, setNbMoisSelectionnes] = useState(0);
  const [formLot, setFormLot] = useState({ montant: '', mode_paiement: 'especes', reference_paiement: '' });
  const [lotEnCours, setLotEnCours] = useState(false);
  const setL = (k) => (e) => setFormLot((f) => ({ ...f, [k]: e.target.value }));

  const fraisIdsLot = eleveLot ? eleveLot.impayes.slice(0, nbMoisSelectionnes).map((f) => f.id) : [];
  const totalSelectionneLot = eleveLot
    ? eleveLot.impayes.slice(0, nbMoisSelectionnes).reduce((s, f) => s + (Number(f.montant_total) - Number(f.total_paye)), 0)
    : 0;

  const ouvrirLot = (e) => {
    setEleveLot(e);
    const totalParDefaut = e.impayes.reduce((s, f) => s + (Number(f.montant_total) - Number(f.total_paye)), 0);
    // Par défaut, tous les mois en attente sont pré-sélectionnés (cas le plus courant : le
    // parent solde tout ce qui est dû) ; l'agent peut réduire en cliquant un mois plus tôt.
    setNbMoisSelectionnes(e.impayes.length);
    setFormLot({ montant: totalParDefaut ? String(totalParDefaut) : '', mode_paiement: 'especes', reference_paiement: '' });
    setModalLotOpen(true);
  };

  // Clic sur un mois = "je veux payer jusqu'à celui-ci inclus" (sélectionne automatiquement
  // tous les mois plus anciens non encore sélectionnés). Cliquer sur le dernier mois déjà
  // sélectionné le retire (permet de réduire la sélection d'un cran, toujours dans l'ordre).
  const cliquerMois = (index) => {
    setNbMoisSelectionnes((n) => (index + 1 === n ? index : index + 1));
  };

  const submitLot = async (e) => {
    e.preventDefault();
    if (!fraisIdsLot.length) { toast.error('Cliquez sur au moins un mois à payer.'); return; }
    setLotEnCours(true);
    try {
      const { data } = await client.post('/finance/paiements/lot', {
        frais_ids: fraisIdsLot,
        montant: formLot.montant,
        mode_paiement: formLot.mode_paiement,
        reference_paiement: formLot.reference_paiement || undefined,
      });
      toast.success(
        data.montant_non_affecte > 0
          ? `Paiement groupé enregistré. ${Number(data.montant_non_affecte).toLocaleString('fr-FR')} Ar n'ont pas pu être affectés (montant supérieur au dû sélectionné).`
          : `Paiement groupé enregistré — ${data.paiements.length} mois/frais soldé(s).`
      );
      printRecuPaiementLot({
        eleve: { eleve_nom: eleveLot.nom, eleve_prenom: eleveLot.prenom },
        lignes: data.paiements,
        montant_total: data.montant_affecte,
        mode_paiement: formLot.mode_paiement,
        reference_paiement: formLot.reference_paiement,
        ecole,
      });
      setModalLotOpen(false);
      setEleveLot(null);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setLotEnCours(false);
    }
  };

  const voirRecus = async (f) => {
    setFraisActif(f);
    setModalRecusOpen(true);
    setRecusLoading(true);
    try {
      const { data } = await client.get('/finance/paiements', { params: { frais_id: f.id } });
      setRecusFrais(data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setRecusLoading(false);
    }
  };

  const nbImpayes = (frais || []).filter((f) => f.statut !== 'paye').length;
  const nbRetard1 = (frais || []).filter((f) => moisDeRetard(f.date_echeance, f.statut) >= 1).length;
  const nbRetard2 = (frais || []).filter((f) => moisDeRetard(f.date_echeance, f.statut) >= 2).length;

  const imprimerFrais = () => {
    printTable({
      title: 'Frais scolaires & paiements',
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`,
      columns: FRAIS_EXPORT_COLUMNS,
      rows: fraisAffiches,
    });
  };

  const exporterFrais = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({
      columns: FRAIS_EXPORT_COLUMNS,
      rows: fraisAffiches,
      filename: 'frais_scolaires',
      sheetName: 'Frais',
    }));
  };

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <StatCard label="Total attendu" value={`${totaux.attendu.toLocaleString('fr-FR')} Ar`} icon={<Inbox size={18} />} />
        <StatCard label="Total perçu" value={`${totaux.percu.toLocaleString('fr-FR')} Ar`} icon={<CheckCircle2 size={18} />} tone="brand" />
        <StatCard
          label="Non payés (impayé/partiel)" value={nbImpayes} icon={<Clock size={18} />} tone={nbImpayes ? 'accent' : 'slate'}
          onClick={nbImpayes ? () => filtrerEtScroller('du', 'tous') : undefined}
        />
        <StatCard
          label="En retard ≥ 1 mois" value={nbRetard1} icon={<AlertTriangle size={18} />} tone={nbRetard1 ? 'red' : 'slate'}
          onClick={nbRetard1 ? () => filtrerEtScroller('tous', '1') : undefined}
        />
        <StatCard
          label="En retard ≥ 2 mois" value={nbRetard2} icon={<AlertOctagon size={18} />} tone={nbRetard2 ? 'red' : 'slate'}
          onClick={nbRetard2 ? () => filtrerEtScroller('tous', '2') : undefined}
        />
      </div>

      <div className="card" ref={tableRef}>
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <h3 className="font-semibold text-slate-800">Frais scolaires</h3>
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button
                type="button" title="Vue liste"
                className={`!rounded-none px-2.5 py-1.5 text-sm flex items-center gap-1.5 ${vue === 'table' ? 'bg-brand-50 text-brand-800' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                onClick={() => setVue('table')}
              >
                <List size={14} /> Liste
              </button>
              <button
                type="button" title="Vue par élève"
                className={`!rounded-none px-2.5 py-1.5 text-sm flex items-center gap-1.5 border-l border-slate-200 ${vue === 'eleves' ? 'bg-brand-50 text-brand-800' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                onClick={() => setVue('eleves')}
              >
                <LayoutGrid size={14} /> Par élève
              </button>
            </div>
            <button className="btn-secondary" disabled={!fraisAffiches.length} onClick={imprimerFrais}><Printer size={14} className="inline -mt-0.5 mr-1.5" />Imprimer</button>
            <button className="btn-secondary" disabled={!fraisAffiches.length} onClick={exporterFrais}><FileSpreadsheet size={14} className="inline -mt-0.5 mr-1.5" />Exporter Excel</button>
            <button className="btn-primary" onClick={() => setModalFraisOpen(true)}>+ Nouveau frais</button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="max-w-xs flex-1 min-w-[10rem]">
            <label className="label">Recherche</label>
            <SearchInput value={search} onChange={setSearch} placeholder="Nom de l'élève…" />
          </div>
          <div className="w-44">
            <label className="label">Classe</label>
            <select className="input" value={filtreClasseId} onChange={(e) => setFiltreClasseId(e.target.value)}>
              <option value="">Toutes les classes</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Mois (écolage)</label>
            <select className="input" value={filtreMois} onChange={(e) => setFiltreMois(e.target.value)}>
              <option value="">Tous les mois</option>
              {MOIS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Statut</label>
            <select className="input" value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)}>
              <option value="tous">Tous</option>
              <option value="du">Non payés (impayé + partiel)</option>
              <option value="impaye">Impayé</option>
              <option value="partiel">Partiel</option>
              <option value="paye">Payé</option>
            </select>
          </div>
          <div>
            <label className="label">Retard</label>
            <select className="input" value={filtreRetard} onChange={(e) => setFiltreRetard(e.target.value)}>
              <option value="tous">Tous</option>
              <option value="aucun">Sans retard</option>
              <option value="1">≥ 1 mois de retard</option>
              <option value="2">≥ 2 mois de retard</option>
              <option value="3">≥ 3 mois de retard</option>
            </select>
          </div>
          <p className="text-xs text-slate-400 self-end pb-2">{fraisAffiches.length} résultat(s) sur {frais?.length || 0}</p>
        </div>

        {vue === 'table' ? (
          <DataTable
            loading={loading} error={error} onRetry={reload} rows={fraisAffiches}
            pageSize={15}
            columns={[
              { key: 'eleve_nom', label: 'Élève', sortable: true, sortValue: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}`, render: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}` },
              { key: 'libelle', label: 'Libellé', render: (r) => r.libelle || r.type_frais },
              { key: 'mois', label: 'Mois', render: (r) => (r.mois ? MOIS[r.mois - 1] : <span className="text-slate-300 text-xs">—</span>) },
              { key: 'montant_total', label: 'Montant', sortable: true, render: (r) => `${Number(r.montant_total).toLocaleString('fr-FR')} Ar` },
              { key: 'total_paye', label: 'Payé', render: (r) => `${Number(r.total_paye).toLocaleString('fr-FR')} Ar` },
              { key: 'statut', label: 'Statut', render: (r) => <Badge tone={STATUT_TONE[r.statut]}>{r.statut}</Badge> },
              {
                key: 'retard', label: 'Retard', render: (r) => {
                  const m = moisDeRetard(r.date_echeance, r.statut);
                  return m > 0 ? <Badge tone="red">{libelleRetard(m)}</Badge> : <span className="text-slate-300 text-xs">—</span>;
                },
              },
            ]}
            actions={(f) => (
              <div className="flex items-center justify-end gap-1">
                {Number(f.total_paye) > 0 && (
                  <button className="btn-ghost !p-1.5 text-slate-500" title="Voir les reçus" onClick={() => voirRecus(f)}>
                    <Receipt size={15} />
                  </button>
                )}
                {f.statut !== 'paye' && (
                  <button className="btn-ghost !px-2 !py-1 text-brand-700" onClick={() => { setFraisActif(f); setModalPaieOpen(true); }}>
                    Encaisser
                  </button>
                )}
              </div>
            )}
          />
        ) : (
          loading ? (
            <p className="text-sm text-slate-400 text-center py-8">Chargement…</p>
          ) : elevesAffiches.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Aucun élève trouvé.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {elevesAffiches.map((e) => (
                <div key={e.eleve_id} className="rounded-xl border border-slate-200 p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-800 leading-tight">{e.prenom || ''} {e.nom}</p>
                    {e.impayes.length > 0
                      ? <Badge tone="red">{e.impayes.length} impayé{e.impayes.length > 1 ? 's' : ''}</Badge>
                      : <Badge tone="green">À jour</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                      <p className="text-slate-400">Payé</p>
                      <p className="font-semibold text-slate-700">{e.total_paye.toLocaleString('fr-FR')} Ar</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                      <p className="text-slate-400">Reste dû</p>
                      <p className={`font-semibold ${e.solde > 0 ? 'text-red-600' : 'text-slate-700'}`}>{e.solde.toLocaleString('fr-FR')} Ar</p>
                    </div>
                  </div>
                  {e.moisEcolage.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-[11px] text-slate-400">Écolage — 12 mois</p>
                        <span className="text-[10px] text-slate-400">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1" />Payé
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400 ml-2 mr-1" />Impayé
                        </span>
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {e.moisEcolage.map((f) => {
                          const estPaye = f.statut === 'paye';
                          const estPartiel = f.statut === 'partiel';
                          return (
                            <div
                              key={f.id}
                              title={`${f.mois ? MOIS[f.mois - 1] : ''} — ${estPaye ? 'Payé' : estPartiel ? 'Partiel' : 'Impayé'}`}
                              className={`h-5 rounded flex items-center justify-center text-[9px] font-bold ${
                                estPaye
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : estPartiel
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {f.mois ? MOIS[f.mois - 1].slice(0, 1) : '—'}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {e.impayes.length > 0 && (
                    <p className="text-[11px] text-slate-400 -mt-1">
                      {e.impayes.map((f) => f.mois ? MOIS[f.mois - 1].slice(0, 3) : (f.libelle || f.type_frais)).join(' · ')}
                    </p>
                  )}
                  <div className="flex gap-2 mt-1">
                    <button className="btn-ghost !px-2 !py-1 text-xs flex-1" onClick={() => { setSearch(`${e.prenom || ''} ${e.nom}`.trim()); setVue('table'); }}>
                      Détails
                    </button>
                    {e.moisEcolage.length > 0 && (
                      <button className="btn-primary !px-2 !py-1 text-xs flex-1 flex items-center justify-center gap-1" onClick={() => ouvrirLot(e)}>
                        <Layers size={13} /> Voir les 12 mois
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <Modal open={modalFraisOpen} onClose={() => { setModalFraisOpen(false); resetFormFrais(); }} title="Nouveau frais scolaire">
        <form onSubmit={submitFrais} className="space-y-4">
          <div>
            <label className="label">Élève</label>
            <select className="input" required value={formFrais.eleve_id} onChange={setEleve}>
              <option value="">— Choisir —</option>
              {eleves?.map((e) => <option key={e.id} value={e.id}>{e.nom} {e.prenom}{e.niveau_nom ? ` (${e.niveau_nom})` : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Type</label>
              <select className="input" value={formFrais.type_frais} onChange={setType}>
                <option value="droit">Droit</option>
                <option value="ecolage">Écolage</option>
                <option value="frais_examen_national">Frais examen national</option>
                <option value="inscription">Inscription</option>
                <option value="cantine">Cantine</option>
                <option value="transport">Transport</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div>
              <label className="label">Montant (Ar)</label>
              <MontantInput required value={formFrais.montant_total} onChange={setMontant} />
              {!montantManuel && tarifPourEleve(formFrais.eleve_id, formFrais.type_frais) && (
                <p className="text-xs text-slate-400 mt-1">Montant repris de la grille tarifaire (modifiable).</p>
              )}
            </div>
          </div>
          {formFrais.type_frais === 'ecolage' && (
            <div>
              <label className="label">Mois concerné</label>
              <select className="input" value={formFrais.mois} onChange={setF('mois')}>
                <option value="">— Non précisé —</option>
                {MOIS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <p className="text-xs text-slate-400 mt-1">Permet de suivre l&apos;écolage mois par mois (ex. « Écolage de Février »).</p>
            </div>
          )}
          <div>
            <label className="label">Libellé (optionnel)</label>
            <input className="input" value={formFrais.libelle} onChange={setF('libelle')} />
          </div>
          <div>
            <label className="label">Échéance</label>
            <input className="input" type="date" value={formFrais.date_echeance} onChange={setF('date_echeance')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalFraisOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>

      <Modal open={modalPaieOpen} onClose={() => setModalPaieOpen(false)} title="Encaisser un paiement" wide>
        {fraisActif && (() => {
          const du = Number(fraisActif.montant_total) - Number(fraisActif.total_paye);
          const recu = Number(String(formPaie.montant || '').replace(/\D/g, '')) || 0;
          const reste = Math.max(du - recu, 0);
          const rendu = Math.max(recu - du, 0);
          return (
            <form onSubmit={submitPaie} className="space-y-4">
              <PaiementHeader
                nom={`${fraisActif.eleve_prenom || ''} ${fraisActif.eleve_nom}`.trim()}
                sousTitre={`${fraisActif.libelle || fraisActif.type_frais}${fraisActif.mois ? ` · ${MOIS[fraisActif.mois - 1]}` : ''}`}
                badge={<Badge tone={STATUT_TONE[fraisActif.statut]}>{fraisActif.statut}</Badge>}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <RecapPaiement
                  titre="Détail du frais"
                  lignes={[
                    { label: 'Montant du frais', montant: Number(fraisActif.montant_total) },
                    { label: 'Déjà payé', montant: Number(fraisActif.total_paye), tone: 'green' },
                    { label: 'Reste à payer', montant: du, total: true },
                  ]}
                />
                <div className="space-y-3">
                  <div>
                    <label className="label">Montant reçu (Ar)</label>
                    <MontantInput required autoFocus value={formPaie.montant} onChange={(v) => setFormPaie((f) => ({ ...f, montant: v }))} />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-brand-200 hover:bg-brand-50"
                        onClick={() => setFormPaie((f) => ({ ...f, montant: String(du) }))}>
                        Tout solder ({du.toLocaleString('fr-FR')} Ar)
                      </button>
                      <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-brand-200 hover:bg-brand-50"
                        onClick={() => setFormPaie((f) => ({ ...f, montant: String(Math.round(du / 2)) }))}>
                        Moitié
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="label">Référence (optionnel)</label>
                    <input className="input" placeholder="N° transaction, chèque…" value={formPaie.reference_paiement} onChange={setP('reference_paiement')} />
                  </div>
                </div>
              </div>

              <ModePaiementChoix value={formPaie.mode_paiement} onChange={(v) => setFormPaie((f) => ({ ...f, mode_paiement: v }))} name="mode-paiement-simple" />

              <RecapPaiement
                titre="Après encaissement"
                lignes={[
                  { label: 'Montant reçu', montant: recu },
                  { label: 'Restera dû', montant: reste, tone: reste > 0 ? 'red' : 'green' },
                  rendu > 0 ? { label: 'Monnaie à rendre', montant: rendu, tone: 'green' } : null,
                ]}
              />

              <BarrePaiement resume={<>Le reçu s&apos;imprime automatiquement après l&apos;encaissement.</>}>
                <button type="button" className="btn-ghost" onClick={() => setModalPaieOpen(false)}>Annuler</button>
                <button type="submit" className="btn-primary !px-6">Encaisser {recu > 0 ? `${recu.toLocaleString('fr-FR')} Ar` : ''}</button>
              </BarrePaiement>
            </form>
          );
        })()}
      </Modal>

      <Modal
        open={modalLotOpen}
        onClose={() => { setModalLotOpen(false); setEleveLot(null); }}
        title="Paiement écolage"
        wide
      >
        {eleveLot && (() => {
          const recu = Number(String(formLot.montant || '').replace(/\D/g, '')) || 0;
          const reste = Math.max(totalSelectionneLot - recu, 0);
          const surplus = Math.max(recu - totalSelectionneLot, 0);
          const totalDuGlobal = eleveLot.impayes.reduce((s2, f) => s2 + (Number(f.montant_total) - Number(f.total_paye)), 0);
          return (
            <form onSubmit={submitLot} className="space-y-4">
              <PaiementHeader
                nom={`${eleveLot.prenom || ''} ${eleveLot.nom}`.trim()}
                sousTitre={`Année ${annee?.libelle || ''} · ${eleveLot.impayes.length} mois/frais en attente`}
                badge={
                  <button
                    type="button"
                    className="btn-secondary !px-2.5 !py-1 text-xs"
                    title="Imprimer le carnet de paiement écolage (12 mois)"
                    onClick={() => printCarnetEcolage({
                      eleve: { nom: eleveLot.nom, prenom: eleveLot.prenom, matricule: eleveLot.fraisList?.[0]?.matricule },
                      moisEcolage: eleveLot.moisEcolage,
                      anneeLibelle: annee?.libelle,
                      ecole,
                    })}
                  >
                    <Printer size={13} className="inline -mt-0.5 mr-1" /> Carnet
                  </button>
                }
              />

              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="label !mb-0">Les 12 mois — cliquez jusqu&apos;au mois à payer</span>
                  <span className="text-xs text-slate-500">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 mr-1" />Payé
                    <span className="inline-block h-2 w-2 rounded-full bg-red-400 ml-3 mr-1" />À payer
                    <span className="inline-block h-2 w-2 rounded-full bg-brand-800 ml-3 mr-1" />Sélectionné
                  </span>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {eleveLot.moisEcolage.map((f) => {
                    const indexImpaye = eleveLot.impayes.findIndex((im) => im.id === f.id);
                    const estPaye = f.statut === 'paye';
                    const estSelectionne = !estPaye && indexImpaye !== -1 && indexImpaye < nbMoisSelectionnes;
                    const label = f.mois ? MOIS[f.mois - 1].slice(0, 3) : '—';
                    const restant = Number(f.montant_total) - Number(f.total_paye);
                    return (
                      <button
                        type="button"
                        key={f.id}
                        disabled={estPaye}
                        onClick={() => cliquerMois(indexImpaye)}
                        className={`rounded-lg px-2 py-2.5 text-xs font-semibold border transition-colors text-center ${
                          estPaye
                            ? 'bg-emerald-50 border-emerald-100 text-emerald-700 cursor-default'
                            : estSelectionne
                            ? 'bg-brand-800 border-brand-800 text-white shadow-sm'
                            : 'bg-red-50 border-red-100 text-red-700 hover:bg-red-100'
                        }`}
                      >
                        {label}
                        <span className="block text-[10px] font-normal opacity-80 mt-0.5">
                          {estPaye ? 'Payé' : `${restant.toLocaleString('fr-FR')}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  La sélection part toujours du mois le plus ancien impayé — impossible de sauter un mois.
                </p>
              </div>

              {eleveLot.impayes.length === 0 ? (
                <p className="rounded-lg bg-emerald-50 text-emerald-700 text-sm px-3 py-2.5 text-center">
                  ✅ Écolage à jour — les 12 mois sont déjà réglés.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <RecapPaiement
                    titre="Tableau de paiement"
                    lignes={[
                      { label: `Mois sélectionnés (${nbMoisSelectionnes})`, montant: totalSelectionneLot },
                      { label: 'Total dû sur l\'année', montant: totalDuGlobal, tone: 'muted' },
                      { label: 'Montant reçu', montant: recu },
                      { label: surplus > 0 ? 'Surplus (non affecté)' : 'Restera dû', montant: surplus > 0 ? surplus : reste, tone: surplus > 0 || reste > 0 ? 'red' : 'green' },
                      { label: 'À encaisser', montant: recu, total: true },
                    ]}
                  />
                  <div className="space-y-3">
                    <div>
                      <label className="label">Montant reçu (Ar)</label>
                      <MontantInput required autoFocus value={formLot.montant} onChange={(v) => setFormLot((f) => ({ ...f, montant: v }))} />
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-brand-200 hover:bg-brand-50"
                          onClick={() => setFormLot((f) => ({ ...f, montant: String(totalSelectionneLot) }))}>
                          Montant sélectionné
                        </button>
                        <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-brand-200 hover:bg-brand-50"
                          onClick={() => { setNbMoisSelectionnes(eleveLot.impayes.length); setFormLot((f) => ({ ...f, montant: String(totalDuGlobal) })); }}>
                          Tout solder
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="label">Référence (optionnel)</label>
                      <input className="input" placeholder="N° transaction, chèque…" value={formLot.reference_paiement} onChange={setL('reference_paiement')} />
                    </div>
                  </div>
                </div>
              )}

              {eleveLot.impayes.length > 0 && (
                <ModePaiementChoix value={formLot.mode_paiement} onChange={(v) => setFormLot((f) => ({ ...f, mode_paiement: v }))} name="mode-paiement-lot" />
              )}

              <BarrePaiement
                resume={
                  eleveLot.impayes.length === 0
                    ? 'Rien à encaisser.'
                    : <>{nbMoisSelectionnes} mois · <strong className="text-slate-800">{totalSelectionneLot.toLocaleString('fr-FR')} Ar</strong> sélectionnés</>
                }
              >
                <button type="button" className="btn-ghost" onClick={() => { setModalLotOpen(false); setEleveLot(null); }}>
                  {eleveLot.impayes.length === 0 ? 'Fermer' : 'Annuler'}
                </button>
                {eleveLot.impayes.length > 0 && (
                  <button type="submit" className="btn-primary !px-6" disabled={lotEnCours || !fraisIdsLot.length}>
                    {lotEnCours ? 'Encaissement…' : `Encaisser ${recu ? `${recu.toLocaleString('fr-FR')} Ar` : ''}`}
                  </button>
                )}
              </BarrePaiement>
            </form>
          );
        })()}
      </Modal>

      <Modal open={modalRecusOpen} onClose={() => setModalRecusOpen(false)} title={fraisActif ? `Reçus — ${fraisActif.eleve_prenom || ''} ${fraisActif.eleve_nom}` : 'Reçus'}>
        {recusLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Chargement…</p>
        ) : recusFrais.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">Aucun paiement enregistré.</p>
        ) : (
          <div className="space-y-2">
            {recusFrais.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{Number(p.montant).toLocaleString('fr-FR')} Ar</p>
                  <p className="text-xs text-slate-400">
                    {new Date(p.date_paiement).toLocaleDateString('fr-FR')} · {p.recu_numero} · {p.mode_paiement}
                  </p>
                </div>
                <button
                  className="btn-ghost !p-1.5 text-brand-700" title="Imprimer le reçu"
                  onClick={() => printRecuPaiement({ paiement: p, frais: fraisActif })}
                >
                  <Printer size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

// Types de frais couverts par la grille tarifaire et l'automatisation. « recurrent »
// détermine si la génération demande un mois (écolage) ou crée le frais une seule fois
// par année scolaire (droit, examen national). D'autres types (cantine, transport...)
// restent saisis à la main élève par élève, comme avant, via l'onglet Frais & Paiements.
const TYPES_TARIF = [
  { key: 'droit', label: 'Droit', recurrent: false },
  { key: 'ecolage', label: 'Écolage (mensuel)', recurrent: true },
  { key: 'frais_examen_national', label: 'Frais examen national', recurrent: false },
];

function TarifsFrais() {
  const toast = useToast();
  const { data: annee } = useFetch(() => client.get('/annees-scolaires/active').then((r) => r.data), []);
  const { data: niveaux } = useFetch(() => client.get('/niveaux').then((r) => r.data), []);
  const { data: cycles } = useFetch(() => client.get('/cycles').then((r) => r.data), []);
  const { data: tarifs, loading, error, reload } = useFetch(
    () => (annee ? client.get('/finance/tarifs', { params: { annee_scolaire_id: annee.id } }).then((r) => r.data) : Promise.resolve([])),
    [annee?.id]
  );

  const [valeurs, setValeurs] = useState({}); // clé "niveauId-type" -> montant en cours de saisie
  const [enregistrement, setEnregistrement] = useState(''); // clé en cours de sauvegarde (pour l'indicateur visuel)
  const [modalGenererOpen, setModalGenererOpen] = useState(false);
  const [formGenerer, setFormGenerer] = useState({ mois: '', date_echeance: '' });
  const [resultatGeneration, setResultatGeneration] = useState(null);
  const [generationEnCours, setGenerationEnCours] = useState(false);

  const cycleOf = (niveau) => cycles?.find((c) => c.id === niveau.cycle_id);
  const niveauxTries = [...(niveaux || [])].sort((a, b) => {
    const ca = cycleOf(a)?.ordre ?? 0; const cb = cycleOf(b)?.ordre ?? 0;
    return ca - cb || a.ordre - b.ordre;
  });

  const tarifPour = (niveauId, type) => (tarifs || []).find((t) => t.niveau_id === niveauId && t.type_frais === type);
  const cle = (niveauId, type) => `${niveauId}-${type}`;
  const cleEcheance = (niveauId, type) => `${niveauId}-${type}-echeance`;
  const valeurAffichee = (niveauId, type) => {
    const k = cle(niveauId, type);
    if (valeurs[k] !== undefined) return valeurs[k];
    return tarifPour(niveauId, type)?.montant ?? '';
  };
  const jourEcheanceAffiche = (niveauId, type) => {
    const k = cleEcheance(niveauId, type);
    if (valeurs[k] !== undefined) return valeurs[k];
    return tarifPour(niveauId, type)?.jour_echeance ?? '';
  };

  const enregistrerTarif = async (niveau, typeDef) => {
    const k = cle(niveau.id, typeDef.key);
    const montant = valeurs[k] !== undefined ? valeurs[k] : tarifPour(niveau.id, typeDef.key)?.montant;
    if (montant === undefined || montant === '') return;
    const jourEcheance = valeurs[cleEcheance(niveau.id, typeDef.key)] ?? tarifPour(niveau.id, typeDef.key)?.jour_echeance;
    setEnregistrement(k);
    try {
      await client.put('/finance/tarifs', {
        niveau_id: niveau.id,
        annee_scolaire_id: annee.id,
        type_frais: typeDef.key,
        libelle: typeDef.label,
        montant: Number(montant),
        recurrent_mensuel: typeDef.recurrent,
        jour_echeance: jourEcheance ? Number(jourEcheance) : null,
      });
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setEnregistrement('');
    }
  };

  const submitGenerer = async (e) => {
    e.preventDefault();
    setGenerationEnCours(true);
    setResultatGeneration(null);
    try {
      const { data } = await client.post('/finance/tarifs/generer', {
        annee_scolaire_id: annee.id,
        mois: Number(formGenerer.mois),
        date_echeance: formGenerer.date_echeance || null,
      });
      setResultatGeneration(data);
      toast.success(`${data.crees} frais créé(s), ${data.ignores_deja_existants} déjà à jour.`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setGenerationEnCours(false);
    }
  };

  return (
    <div>
      <div className="card mb-5">
        <div className="flex justify-between items-center mb-1">
          <h3 className="font-semibold text-slate-800">Grille tarifaire {annee ? `— ${annee.libelle}` : ''}</h3>
          <button className="btn-primary" onClick={() => { setModalGenererOpen(true); setResultatGeneration(null); }}>
            <Sparkles size={15} className="inline -mt-0.5 mr-1" /> Générer les frais
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Modifiez le montant par niveau ci-dessous (une seule fois) : il s&apos;appliquera automatiquement à tous les élèves
          de ce niveau lors de la génération. Les autres frais (cantine, transport…) restent à saisir au cas par cas dans
          l&apos;onglet « Frais & Paiements ».
        </p>

        {loading && <p className="text-sm text-slate-400 py-4">Chargement…</p>}
        {error && <p className="text-sm text-red-500 py-4">{error}</p>}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3">Classe</th>
                  {TYPES_TARIF.map((t) => <th key={t.key} className="py-2 px-3">{t.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {niveauxTries.map((n) => (
                  <tr key={n.id} className="border-b border-slate-50">
                    <td className="py-2 pr-3 font-medium text-slate-700">{n.nom}</td>
                    {TYPES_TARIF.map((t) => {
                      const k = cle(n.id, t.key);
                      const kEch = cleEcheance(n.id, t.key);
                      return (
                        <td key={t.key} className="py-2 px-3">
                          <input
                            className="input !py-1 w-32"
                            type="number" min="0" placeholder="—"
                            value={valeurAffichee(n.id, t.key)}
                            onChange={(e) => setValeurs((v) => ({ ...v, [k]: e.target.value }))}
                            onBlur={() => enregistrerTarif(n, t)}
                          />
                          {t.recurrent && (
                            <input
                              className="input !py-1 w-32 mt-1"
                              type="number" min="1" max="28" placeholder="Jour d'échéance (déf. 10)"
                              title="Jour du mois où ce frais est dû (1-28). Laisser vide pour utiliser le jour par défaut de l'école (Paramètres)."
                              value={jourEcheanceAffiche(n.id, t.key)}
                              onChange={(e) => setValeurs((v) => ({ ...v, [kEch]: e.target.value }))}
                              onBlur={() => enregistrerTarif(n, t)}
                            />
                          )}
                          {enregistrement === k && <span className="text-xs text-slate-300 ml-1">…</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalGenererOpen} onClose={() => setModalGenererOpen(false)} title="Générer les frais">
        <form onSubmit={submitGenerer} className="space-y-4">
          <p className="text-sm text-slate-500">
            Crée automatiquement l&apos;écolage du mois choisi pour tous les élèves inscrits, selon la grille tarifaire
            ci-dessus. Le droit et les frais d&apos;examen sont créés en même temps pour les élèves qui ne les ont pas
            encore (nouveaux inscrits) — les élèves déjà traités ne sont jamais dupliqués. Aucun encaissement n&apos;est
            effectué : les frais sont créés au statut « impayé », à encaisser ensuite normalement au guichet.
          </p>
          <div>
            <label className="label">Mois d&apos;écolage concerné</label>
            <select className="input" required value={formGenerer.mois} onChange={(e) => setFormGenerer((f) => ({ ...f, mois: e.target.value }))}>
              <option value="">— Choisir —</option>
              {MOIS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Échéance (optionnel — remplace la règle automatique)</label>
            <input className="input" type="date" value={formGenerer.date_echeance} onChange={(e) => setFormGenerer((f) => ({ ...f, date_echeance: e.target.value }))} />
            <p className="text-xs text-slate-400 mt-1">
              Laissez vide : l&apos;échéance de l&apos;écolage est calculée automatiquement (jour d&apos;échéance défini
              par niveau ci-dessus, sinon le jour par défaut de l&apos;école dans Paramètres).
            </p>
          </div>
          {resultatGeneration && (
            <div className="rounded-lg bg-brand-50 text-brand-800 text-sm px-3 py-2">
              {resultatGeneration.crees} frais créé(s) · {resultatGeneration.ignores_deja_existants} déjà à jour (ignorés)
              · {resultatGeneration.eleves_traites} élève(s) inscrit(s) traité(s).
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalGenererOpen(false)}>Fermer</button>
            <button type="submit" className="btn-primary" disabled={generationEnCours}>
              {generationEnCours ? 'Génération…' : 'Générer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function RelancesImpayes() {
  const toast = useToast();
  const [sousTab, setSousTab] = useState('eligibles');
  const { data: eligibles, loading: loadingElig, error: errorElig, reload: reloadElig } = useFetch(
    () => client.get('/finance/relances/eligibles').then((r) => r.data), []
  );
  const { data: historique, loading: loadingHist, error: errorHist, reload: reloadHist } = useFetch(
    () => client.get('/finance/relances').then((r) => r.data), []
  );
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [relanceLigneId, setRelanceLigneId] = useState(null);

  const relancerTout = async () => {
    setEnvoiEnCours(true);
    try {
      const { data } = await client.post('/finance/relances/generer', {});
      toast.success(`${data.envoyees} relance(s) envoyée(s) sur ${data.candidats} frais en retard (${data.ignorees_deja_relancees} déjà relancé(s) récemment).`);
      reloadElig(); reloadHist();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setEnvoiEnCours(false);
    }
  };

  const relancerUnFrais = async (fraisId) => {
    setRelanceLigneId(fraisId);
    try {
      await client.post('/finance/relances/generer', { frais_id: fraisId });
      toast.success('Relance envoyée.');
      reloadElig(); reloadHist();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setRelanceLigneId(null);
    }
  };

  const eligiblesColumns = [
    { key: 'eleve_nom', label: 'Élève', sortable: true, render: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}`.trim() },
    { key: 'libelle', label: 'Frais', render: (r) => `${r.libelle || ''}${r.mois ? ` (${MOIS[r.mois - 1]})` : ''}` },
    { key: 'montant_du', label: 'Montant dû (Ar)', sortable: true, render: (r) => Number(r.montant_du).toLocaleString('fr-FR') },
    { key: 'jours_retard', label: 'Retard', sortable: true, render: (r) => <Badge tone="red">{r.jours_retard} j</Badge> },
    { key: 'derniere_relance', label: 'Dernière relance', render: (r) => (r.derniere_relance ? new Date(r.derniere_relance).toLocaleDateString('fr-FR') : '—') },
  ];

  const historiqueColumns = [
    { key: 'eleve_nom', label: 'Élève', render: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}`.trim() },
    { key: 'frais_libelle', label: 'Frais', render: (r) => `${r.frais_libelle || ''}${r.frais_mois ? ` (${MOIS[r.frais_mois - 1]})` : ''}` },
    { key: 'montant_du', label: 'Montant (Ar)', render: (r) => Number(r.montant_du).toLocaleString('fr-FR') },
    { key: 'jours_retard', label: 'Retard', render: (r) => `${r.jours_retard} j` },
    { key: 'canal', label: 'Canal', render: (r) => <Badge>{r.canal === 'les_deux' ? 'Email + WhatsApp' : r.canal}</Badge> },
    { key: 'manuel', label: 'Origine', render: (r) => <Badge tone={r.manuel ? 'violet' : 'slate'}>{r.manuel ? 'Manuelle' : 'Automatique'}</Badge> },
    { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleString('fr-FR') },
  ];

  return (
    <div>
      <div className="card mb-5">
        <div className="flex justify-between items-center mb-1">
          <h3 className="font-semibold text-slate-800">Frais en retard éligibles à une relance</h3>
          <button className="btn-primary" onClick={relancerTout} disabled={envoiEnCours || !eligibles?.length}>
            <BellRing size={15} className="inline -mt-0.5 mr-1" /> {envoiEnCours ? 'Envoi…' : 'Relancer tout maintenant'}
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Un frais impayé/partiel devient éligible dès que son échéance est dépassée du seuil configuré (Paramètres).
          Une relance automatique est aussi envoyée chaque jour à 7h ; ce bouton en déclenche une immédiatement.
        </p>
        <div className="flex gap-2 mb-4">
          <button className={sousTab === 'eligibles' ? 'btn-primary !py-1' : 'btn-secondary !py-1'} onClick={() => setSousTab('eligibles')}>À relancer ({eligibles?.length ?? 0})</button>
          <button className={sousTab === 'historique' ? 'btn-primary !py-1' : 'btn-secondary !py-1'} onClick={() => setSousTab('historique')}>Historique des envois</button>
        </div>

        {sousTab === 'eligibles' && (
          <DataTable
            columns={eligiblesColumns}
            rows={eligibles}
            rowKey="frais_id"
            loading={loadingElig}
            error={errorElig}
            onRetry={reloadElig}
            emptyLabel="Aucun frais en retard pour l'instant."
            actions={(r) => (
              <button className="btn-ghost !py-1 !px-2 text-xs" disabled={relanceLigneId === r.frais_id} onClick={() => relancerUnFrais(r.frais_id)}>
                {relanceLigneId === r.frais_id ? '…' : 'Relancer'}
              </button>
            )}
          />
        )}
        {sousTab === 'historique' && (
          <DataTable
            columns={historiqueColumns}
            rows={historique}
            loading={loadingHist}
            error={errorHist}
            onRetry={reloadHist}
            emptyLabel="Aucune relance envoyée pour l'instant."
          />
        )}
      </div>
    </div>
  );
}

function CaisseDepenses() {
  const [modalOpen, setModalOpen] = useState(false);
  const toast = useToast();
  const { data: caisses, reload: reloadCaisses } = useFetch(() => client.get('/finance/caisses').then((r) => r.data), []);
  const { data: depenses, loading, error, reload } = useFetch(() => client.get('/finance/depenses').then((r) => r.data), []);
  const { data: categories } = useFetch(() => client.get('/categories-depense').then((r) => r.data), []);

  const [form, setForm] = useState({ categorie_id: '', libelle: '', montant: '', mode_paiement: 'especes', caisse_id: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // --- Clôture de caisse (arrêté) ---
  const [caisseClotureId, setCaisseClotureId] = useState('');
  const [modalClotureOpen, setModalClotureOpen] = useState(false);
  const [formCloture, setFormCloture] = useState({ solde_reel: '', commentaire: '' });
  const [clotureEnCours, setClotureEnCours] = useState(false);
  const { data: clotures, reload: reloadClotures } = useFetch(
    () => (caisseClotureId ? client.get(`/finance/caisses/${caisseClotureId}/clotures`).then((r) => r.data) : Promise.resolve([])),
    [caisseClotureId]
  );

  const ouvrirCloture = (caisseId) => {
    setCaisseClotureId(String(caisseId));
    setFormCloture({ solde_reel: '', commentaire: '' });
    setModalClotureOpen(true);
  };

  const submitCloture = async (e) => {
    e.preventDefault();
    setClotureEnCours(true);
    try {
      await client.post(`/finance/caisses/${caisseClotureId}/clore`, formCloture);
      toast.success('Caisse clôturée.');
      setModalClotureOpen(false);
      reloadCaisses(); reloadClotures();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setClotureEnCours(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      await client.post('/finance/depenses', form);
      toast.success('Dépense enregistrée.');
      setModalOpen(false);
      reload(); reloadCaisses();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const imprimerDepenses = () => {
    printTable({
      title: 'Dépenses',
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`,
      columns: DEPENSES_EXPORT_COLUMNS,
      rows: depenses,
    });
  };

  const exporterDepenses = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({
      columns: DEPENSES_EXPORT_COLUMNS,
      rows: depenses,
      filename: 'depenses',
      sheetName: 'Dépenses',
    }));
  };

  return (
    <div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        {caisses?.map((c) => (
          <div key={c.id} className="card !py-4">
            <p className="text-xs text-slate-400 mb-1">{c.nom}</p>
            <p className="text-xl font-semibold text-slate-800 mb-2">{Number(c.solde_actuel).toLocaleString('fr-FR')} Ar</p>
            <button className="btn-secondary !text-xs !py-1" onClick={() => ouvrirCloture(c.id)}>🔒 Clôturer la caisse</button>
          </div>
        ))}
      </div>

      {caisseClotureId && clotures?.length > 0 && (
        <div className="card mb-5">
          <h3 className="font-semibold text-slate-800 mb-3">
            Historique des arrêtés — {caisses?.find((c) => c.id === Number(caisseClotureId))?.nom}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 px-3">Théorique</th>
                  <th className="py-2 px-3">Réel (compté)</th>
                  <th className="py-2 px-3">Écart</th>
                  <th className="py-2 px-3">Commentaire</th>
                </tr>
              </thead>
              <tbody>
                {clotures.map((cl) => (
                  <tr key={cl.id} className="border-b border-slate-50">
                    <td className="py-2 pr-3">{new Date(cl.date_cloture).toLocaleDateString('fr-FR')}</td>
                    <td className="py-2 px-3">{Number(cl.solde_theorique).toLocaleString('fr-FR')} Ar</td>
                    <td className="py-2 px-3">{Number(cl.solde_reel).toLocaleString('fr-FR')} Ar</td>
                    <td className="py-2 px-3">
                      <Badge tone={Number(cl.ecart) === 0 ? 'green' : 'red'}>
                        {Number(cl.ecart) > 0 ? '+' : ''}{Number(cl.ecart).toLocaleString('fr-FR')} Ar
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-slate-500">{cl.commentaire || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-slate-800">Dépenses</h3>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={!depenses?.length} onClick={imprimerDepenses}><Printer size={14} className="inline -mt-0.5 mr-1.5" />Imprimer</button>
            <button className="btn-secondary" disabled={!depenses?.length} onClick={exporterDepenses}><FileSpreadsheet size={14} className="inline -mt-0.5 mr-1.5" />Exporter Excel</button>
            <button className="btn-primary" onClick={() => setModalOpen(true)}>+ Nouvelle dépense</button>
          </div>
        </div>
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={depenses}
          pageSize={15}
          columns={[
            { key: 'libelle', label: 'Libellé' },
            { key: 'piece_numero', label: 'N° pièce', render: (r) => r.piece_numero || <span className="text-slate-300 text-xs">—</span> },
            { key: 'categorie_nom', label: 'Catégorie' },
            { key: 'montant', label: 'Montant', sortable: true, render: (r) => `${Number(r.montant).toLocaleString('fr-FR')} Ar` },
            { key: 'date_depense', label: 'Date', sortable: true, render: (r) => new Date(r.date_depense).toLocaleDateString('fr-FR') },
          ]}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle dépense">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Catégorie</label>
            <select className="input" required value={form.categorie_id} onChange={set('categorie_id')}>
              <option value="">— Choisir —</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Libellé</label>
            <input className="input" required value={form.libelle} onChange={set('libelle')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Montant (Ar)</label>
              <input className="input" type="number" min="1" required value={form.montant} onChange={set('montant')} />
            </div>
            <div>
              <label className="label">Mode de paiement</label>
              <select className="input" value={form.mode_paiement} onChange={set('mode_paiement')}>
                <option value="especes">Espèces</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="virement">Virement</option>
                <option value="cheque">Chèque</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Caisse (optionnel)</label>
            <select className="input" value={form.caisse_id} onChange={set('caisse_id')}>
              <option value="">— Aucune —</option>
              {caisses?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>

      <Modal open={modalClotureOpen} onClose={() => setModalClotureOpen(false)} title="Clôturer la caisse">
        <form onSubmit={submitCloture} className="space-y-4">
          <p className="text-sm text-slate-500">
            Comptez l&apos;argent physiquement présent dans la caisse et saisissez le montant ci-dessous. Le système
            compare avec le solde théorique (calculé à partir de toutes les entrées/sorties enregistrées) et affiche
            l&apos;écart éventuel — celui-ci est conservé tel quel dans l&apos;historique, il n&apos;est jamais utilisé
            pour corriger le solde automatiquement.
          </p>
          <div>
            <label className="label">Montant compté (Ar)</label>
            <input className="input" type="number" min="0" required value={formCloture.solde_reel} onChange={(e) => setFormCloture((f) => ({ ...f, solde_reel: e.target.value }))} />
          </div>
          <div>
            <label className="label">Commentaire (optionnel)</label>
            <input className="input" value={formCloture.commentaire} onChange={(e) => setFormCloture((f) => ({ ...f, commentaire: e.target.value }))} placeholder="Ex : billets vérifiés à deux" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalClotureOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={clotureEnCours}>
              {clotureEnCours ? 'Clôture…' : 'Clôturer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const DEPENSES_EXPORT_COLUMNS = [
  { label: 'Libellé', value: (r) => r.libelle },
  { label: 'Catégorie', value: (r) => r.categorie_nom },
  { label: 'Montant (Ar)', value: (r) => r.montant },
  { label: 'Date', value: (r) => new Date(r.date_depense).toLocaleDateString('fr-FR') },
];

const PAIEMENTS_EXPORT_COLUMNS = [
  { label: 'Élève', value: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}`.trim() },
  { label: 'Motif', value: (r) => r.frais_libelle || '' },
  { label: 'Montant (Ar)', value: (r) => r.montant },
  { label: 'Mode', value: (r) => r.mode_paiement },
  { label: 'N° reçu', value: (r) => r.recu_numero },
  { label: 'Date', value: (r) => new Date(r.date_paiement).toLocaleDateString('fr-FR') },
];

const MOUVEMENTS_EXPORT_COLUMNS = [
  { label: 'Type', value: (r) => (r.type_mouvement === 'entree' ? 'Entrée' : 'Sortie') },
  { label: 'Montant (Ar)', value: (r) => r.montant },
  { label: 'Référence', value: (r) => r.reference || '' },
  { label: 'Date', value: (r) => new Date(r.date_mouvement).toLocaleString('fr-FR') },
];

function Historique() {
  const [subTab, setSubTab] = useState('paiements');
  const [caisseId, setCaisseId] = useState('');

  const { data: caisses } = useFetch(() => client.get('/finance/caisses').then((r) => r.data), []);
  const { data: paiements, loading: l1, error: e1, reload: r1 } = useFetch(() => client.get('/finance/paiements').then((r) => r.data), []);
  const { data: mouvements, loading: l2, error: e2, reload: r2 } = useFetch(
    () => client.get('/finance/mouvements', { params: caisseId ? { caisse_id: caisseId } : {} }).then((r) => r.data),
    [caisseId]
  );
  const { data: ecole } = useFetch(() => client.get('/parametres').then((r) => r.data), []);

  const imprimerRecu = (p) => printRecuPaiement({ paiement: p, ecole });

  const imprimerPaiements = () => {
    printTable({
      title: 'Historique des paiements',
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`,
      columns: PAIEMENTS_EXPORT_COLUMNS,
      rows: paiements,
    });
  };
  const exporterPaiements = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: PAIEMENTS_EXPORT_COLUMNS, rows: paiements, filename: 'historique_paiements', sheetName: 'Paiements' }));
  };

  const imprimerMouvements = () => {
    printTable({
      title: 'Mouvements de caisse',
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`,
      columns: MOUVEMENTS_EXPORT_COLUMNS,
      rows: mouvements,
    });
  };
  const exporterMouvements = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: MOUVEMENTS_EXPORT_COLUMNS, rows: mouvements, filename: 'mouvements_caisse', sheetName: 'Mouvements' }));
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button className={subTab === 'paiements' ? 'btn-secondary !bg-brand-50 !text-brand-800' : 'btn-ghost'} onClick={() => setSubTab('paiements')}>
          <Receipt size={14} className="inline mr-1.5 -mt-0.5" /> Paiements
        </button>
        <button className={subTab === 'mouvements' ? 'btn-secondary !bg-brand-50 !text-brand-800' : 'btn-ghost'} onClick={() => setSubTab('mouvements')}>
          <Wallet size={14} className="inline mr-1.5 -mt-0.5" /> Mouvements de caisse
        </button>
      </div>

      {subTab === 'paiements' ? (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-slate-800">Tous les paiements</h3>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={!paiements?.length} onClick={imprimerPaiements}><Printer size={14} className="inline -mt-0.5 mr-1.5" />Imprimer</button>
              <button className="btn-secondary" disabled={!paiements?.length} onClick={exporterPaiements}><FileSpreadsheet size={14} className="inline -mt-0.5 mr-1.5" />Exporter Excel</button>
            </div>
          </div>
          <DataTable
            loading={l1} error={e1} onRetry={r1} rows={paiements}
            pageSize={15}
            emptyLabel="Aucun paiement enregistré."
            columns={[
              { key: 'eleve_nom', label: 'Élève', sortable: true, sortValue: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}`, render: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}` },
              { key: 'frais_libelle', label: 'Motif', render: (r) => r.frais_libelle || '—' },
              { key: 'montant', label: 'Montant', sortable: true, render: (r) => `${Number(r.montant).toLocaleString('fr-FR')} Ar` },
              { key: 'mode_paiement', label: 'Mode' },
              { key: 'recu_numero', label: 'N° reçu' },
              { key: 'date_paiement', label: 'Date', sortable: true, render: (r) => new Date(r.date_paiement).toLocaleDateString('fr-FR') },
            ]}
            actions={(p) => (
              <button className="btn-ghost !p-1.5 text-brand-700" title="Imprimer le reçu" onClick={() => imprimerRecu(p)}>
                <Printer size={15} />
              </button>
            )}
          />
        </div>
      ) : (
        <div className="card">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <h3 className="font-semibold text-slate-800">Mouvements de caisse</h3>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-52">
                <label className="label">Caisse</label>
                <select className="input" value={caisseId} onChange={(e) => setCaisseId(e.target.value)}>
                  <option value="">Toutes les caisses</option>
                  {caisses?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </div>
              <button className="btn-secondary" disabled={!mouvements?.length} onClick={imprimerMouvements}><Printer size={14} className="inline -mt-0.5 mr-1.5" />Imprimer</button>
              <button className="btn-secondary" disabled={!mouvements?.length} onClick={exporterMouvements}><FileSpreadsheet size={14} className="inline -mt-0.5 mr-1.5" />Exporter Excel</button>
            </div>
          </div>
          <DataTable
            loading={l2} error={e2} onRetry={r2} rows={mouvements}
            pageSize={15}
            emptyLabel="Aucun mouvement enregistré."
            columns={[
              { key: 'type_mouvement', label: 'Type', render: (r) => <Badge tone={MOUVEMENT_TONE[r.type_mouvement]}>{r.type_mouvement === 'entree' ? 'Entrée' : 'Sortie'}</Badge> },
              { key: 'montant', label: 'Montant', sortable: true, render: (r) => `${Number(r.montant).toLocaleString('fr-FR')} Ar` },
              { key: 'reference', label: 'Référence', render: (r) => r.reference || '—' },
              { key: 'date_mouvement', label: 'Date', sortable: true, render: (r) => new Date(r.date_mouvement).toLocaleString('fr-FR') },
            ]}
          />
        </div>
      )}
    </div>
  );
}
