import { useMemo, useState, useEffect, useCallback } from 'react';
import { Printer, XCircle, Pencil, Sparkles, Wallet, FileClock, CheckCircle2, Banknote, Landmark, FileSpreadsheet, AlertTriangle, User, History, HandCoins } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useEcole } from '../../context/EcoleContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatCard from '../../components/StatCard';
import { SectionHeader, Badge, MontantInput } from '../../components/Shared';
import { PaiementHeader, ModePaiementChoix, RecapPaiement, BarrePaiement } from '../../components/PaiementUI';
import { printBulletinPaie, printTable } from '../../utils/exportUtils';
import { getServerToday, getServerMonth, getServerYear } from '../../utils/serverClock';

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const STATUT_TONE = { prepare: 'slate', valide: 'amber', paye: 'green', annule: 'red' };
const FORM_VIDE = { enseignant_id: '', salaire_id: '', mois: getServerMonth(), annee: getServerYear(), heures_normales: 0, heures_supplementaires: 0, prime: 0, retenue: 0 };

const BULLETINS_EXPORT_COLUMNS = [
  { label: 'Enseignant', value: (r) => `${r.prenom || ''} ${r.nom}`.trim() },
  { label: 'Période', value: (r) => `${MOIS[r.mois - 1]} ${r.annee}` },
  { label: 'Heures normales', value: (r) => Number(r.heures_normales) },
  { label: 'Heures supp.', value: (r) => Number(r.heures_supplementaires) },
  { label: 'Salaire de base', value: (r) => Number(r.salaire_base) },
  { label: 'Prime', value: (r) => Number(r.prime) },
  { label: 'Retenue', value: (r) => Number(r.retenue) },
  { label: 'Brut', value: (r) => Number(r.salaire_brut) },
  { label: 'Net à payer', value: (r) => Number(r.salaire_net) },
  { label: 'Statut', value: (r) => r.statut },
  { label: 'Mode paiement', value: (r) => r.mode_paiement || '—' },
  { label: 'Référence paiement', value: (r) => r.reference_paiement || '—' },
];

const GRILLES_EXPORT_COLUMNS = [
  { label: 'Enseignant', value: (r) => `${r.prenom || ''} ${r.nom}`.trim() },
  { label: 'Type', value: (r) => r.type_salaire },
  { label: 'Montant', value: (r) => Number(r.montant) },
  { label: 'Depuis le', value: (r) => new Date(r.date_debut).toLocaleDateString('fr-FR') },
  { label: 'Statut', value: (r) => (r.actif ? 'Active' : 'Inactive') },
];

export default function Paie() {
  const [tab, setTab] = useState('controle');
  return (
    <div>
      <SectionHeader title="Paie enseignants" subtitle="Bulletins de paie et grilles salariales" />
      <div className="flex gap-2 mb-5">
        <button className={tab === 'controle' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('controle')}>Contrôle mensuel</button>
        <button className={tab === 'bulletins' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('bulletins')}>Bulletins</button>
        <button className={tab === 'grilles' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('grilles')}>Grilles salariales</button>
      </div>
      {tab === 'controle' ? <ControleMensuel /> : tab === 'bulletins' ? <Bulletins /> : <GrillesSalariales />}
    </div>
  );
}

function ControleMensuel() {
  const [mois, setMois] = useState(getServerMonth());
  const [annee, setAnnee] = useState(getServerYear());
  const { data, loading, error, reload } = useFetch(() => client.get('/paie/controle-mensuel', { params:{mois,annee} }).then(r=>r.data), [mois,annee]);
  const MOIS_C = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  if (loading) return <div className="card text-sm text-slate-500">Calcul du contrôle mensuel…</div>;
  if (error) return <div className="card text-sm text-red-600">Impossible de calculer le contrôle mensuel.</div>;
  const r=data?.resume||{};
  return <div className="space-y-4">
    <div className="card flex flex-wrap items-end gap-3"><div><label className="label">Mois</label><select className="input" value={mois} onChange={e=>setMois(Number(e.target.value))}>{MOIS_C.map((m,i)=><option key={m} value={i+1}>{m}</option>)}</select></div><div><label className="label">Année</label><input className="input w-28" type="number" value={annee} onChange={e=>setAnnee(Number(e.target.value))}/></div><button className="btn-secondary" onClick={reload}>Actualiser</button></div>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4"><StatCard label="Enseignants" value={r.enseignants||0} icon={User}/><StatCard label="À vérifier" value={r.a_verifier||0} icon={AlertTriangle}/><StatCard label="Non configurés" value={r.incomplets||0} icon={AlertOctagon}/><StatCard label="Masse estimée" value={`${Number(r.total_estime||0).toLocaleString('fr-FR')} Ar`} icon={Banknote}/></div>
    <div className="card overflow-x-auto"><div className="flex items-center justify-between mb-3"><div><h3 className="font-semibold">Rapprochement EDT → présence → paie</h3><p className="text-xs text-slate-500">Une paie horaire est estimée uniquement à partir des heures réellement payables.</p></div><Badge tone={r.a_verifier || r.incomplets ? 'amber':'green'}>{r.a_verifier || r.incomplets ? 'Contrôle requis':'Prêt'}</Badge></div><table className="min-w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-400 border-b"><th className="py-2 pr-4">Enseignant</th><th className="py-2 pr-4">Planifié</th><th className="py-2 pr-4">Effectué</th><th className="py-2 pr-4">Absence</th><th className="py-2 pr-4">En attente</th><th className="py-2 pr-4">Écart</th><th className="py-2 pr-4">Estimation</th><th className="py-2">État</th></tr></thead><tbody>{(data?.enseignants||[]).map(e=><tr key={e.enseignant_id} className="border-b last:border-0"><td className="py-2 pr-4 font-medium">{e.prenom||''} {e.nom}</td><td className="py-2 pr-4">{e.heures_planifiees}h</td><td className="py-2 pr-4">{e.heures_effectuees}h</td><td className="py-2 pr-4">{e.heures_absence}h</td><td className="py-2 pr-4">{e.heures_en_attente}h</td><td className={`py-2 pr-4 ${Number(e.ecart_heures)<0?'text-red-600':''}`}>{Number(e.ecart_heures)>0?'+':''}{e.ecart_heures}h</td><td className="py-2 pr-4 font-semibold">{Number(e.montant_estime).toLocaleString('fr-FR')} Ar</td><td className="py-2"><Badge tone={e.statut==='ok'?'green':e.statut==='incomplet'?'red':'amber'}>{e.statut}</Badge></td></tr>)}</tbody></table></div>
  </div>;
}

// Fintina/relevé an'ny mpampianatra iray voafidy amin'ny filtre : firy no efa voaloa
// (cumul, tsy miankina amin'ny filtre mois/année eo ambony), firy no mbola tsy voaloa,
// ary lisitry ny volana rehetra (statut isaky ny volana) — mitovy amin'ny « Ma paie »
// hita ao amin'ny espace enseignant, fa eto amin'ny vue admin/Finance.
function RecapEnseignant({ recap }) {
  return (
    <div className="rounded-xl ring-1 ring-brand-100 bg-brand-50/40 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-9 w-9 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
          <User size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Relevé de l&apos;enseignant</p>
          <p className="font-semibold text-slate-800 truncate">{recap.nom}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div className="bg-white rounded-lg ring-1 ring-slate-100 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1"><Landmark size={12} />Total déjà payé</p>
          <p className="metric-number text-xl mt-0.5 text-emerald-700">{recap.totalDejaPaye.toLocaleString('fr-FR')} Ar</p>
        </div>
        <div className="bg-white rounded-lg ring-1 ring-slate-100 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1"><HandCoins size={12} />Reste à venir</p>
          <p className="metric-number text-xl mt-0.5 text-amber-700">{recap.totalAVenir.toLocaleString('fr-FR')} Ar</p>
        </div>
        <div className="bg-white rounded-lg ring-1 ring-slate-100 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1"><History size={12} />Mois déjà payés</p>
          <p className="metric-number text-xl mt-0.5">{recap.nbMoisPayes}</p>
        </div>
      </div>

      {recap.historique.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recap.historique.map((b) => (
            <span key={b.id} className="inline-flex items-center gap-1.5 rounded-full bg-white ring-1 ring-slate-200 pl-2.5 pr-1 py-1 text-xs">
              {MOIS[b.mois - 1].slice(0, 3)} {b.annee}
              <Badge tone={STATUT_TONE[b.statut]}>{b.statut}</Badge>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Bulletins() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = génération d'un nouveau bulletin, sinon id en cours de modification
  const toast = useToast();
  const confirm = useConfirm();
  const ecole = useEcole();

  // --- Génération automatique de tous les bulletins d'un mois (POST /paie/generer) ---
  const [modalGenererMoisOpen, setModalGenererMoisOpen] = useState(false);
  const [formGenererMois, setFormGenererMois] = useState({ mois: getServerMonth(), annee: getServerYear() });
  const [resultatGenerationMois, setResultatGenerationMois] = useState(null);
  const [generationMoisEnCours, setGenerationMoisEnCours] = useState(false);

  const { data: enseignants } = useFetch(() => client.get('/utilisateurs').then((r) => r.data.filter((u) => u.role === 'enseignant')), []);
  const { data: salaires } = useFetch(() => client.get('/paie/salaires').then((r) => r.data), []);

  const [filtreEnseignant, setFiltreEnseignant] = useState('');
  const [filtreMois, setFiltreMois] = useState('');
  const [filtreAnnee, setFiltreAnnee] = useState('');

  const { data: bulletins, loading, error, reload } = useFetch(
    () => client.get('/paie', { params: { enseignant_id: filtreEnseignant || undefined, mois: filtreMois || undefined, annee: filtreAnnee || undefined } }).then((r) => r.data),
    [filtreEnseignant, filtreMois, filtreAnnee]
  );

  const stats = useMemo(() => {
    const liste = bulletins || [];
    // Les bulletins annulés ne doivent compter dans aucun total financier, et un bulletin
    // déjà « payé » n'est plus « à payer » — seuls prepare + valide restent réellement dus.
    const dus = liste.filter((b) => b.statut === 'prepare' || b.statut === 'valide');
    const payes = liste.filter((b) => b.statut === 'paye');
    return {
      resteAPayer: dus.reduce((s, b) => s + Number(b.salaire_net), 0),
      totalPaye: payes.reduce((s, b) => s + Number(b.salaire_net), 0),
      prepare: liste.filter((b) => b.statut === 'prepare').length,
      valide: liste.filter((b) => b.statut === 'valide').length,
      paye: payes.length,
    };
  }, [bulletins]);

  // --- Relevé (historique complet) de l'enseignant sélectionné dans le filtre ---
  // Volontairement indépendant des filtres mois/année de la liste ci-dessous : l'objectif
  // est de voir en un coup d'œil TOUT l'historique de paiement de cet enseignant (tous les
  // mois confondus), même si la liste en dessous est elle-même filtrée sur un seul mois.
  const { data: bulletinsEnseignant } = useFetch(
    () => (filtreEnseignant ? client.get('/paie', { params: { enseignant_id: filtreEnseignant } }).then((r) => r.data) : Promise.resolve(null)),
    [filtreEnseignant]
  );

  const recapEnseignant = useMemo(() => {
    if (!filtreEnseignant || !bulletinsEnseignant) return null;
    const liste = bulletinsEnseignant.filter((b) => b.statut !== 'annule');
    const payes = liste.filter((b) => b.statut === 'paye');
    const enAttente = liste.filter((b) => b.statut === 'prepare' || b.statut === 'valide');
    const enseignant = enseignants?.find((e) => e.id === Number(filtreEnseignant));
    return {
      nom: enseignant ? `${enseignant.prenom} ${enseignant.nom}` : '',
      totalDejaPaye: payes.reduce((s, b) => s + Number(b.salaire_net), 0),
      totalAVenir: enAttente.reduce((s, b) => s + Number(b.salaire_net), 0),
      nbMoisPayes: payes.length,
      // Du plus récent au plus ancien, comme un relevé / historique de paiement.
      historique: [...liste].sort((a, b) => (b.annee * 100 + b.mois) - (a.annee * 100 + a.mois)),
    };
  }, [filtreEnseignant, bulletinsEnseignant, enseignants]);

  // --- Paiement d'un salaire (passage du bulletin au statut « payé ») ---
  const [bulletinAPayer, setBulletinAPayer] = useState(null);
  const [formPaiement, setFormPaiement] = useState({ date_paiement: getServerToday(), mode_paiement: 'especes' });
  const [paiementEnCours, setPaiementEnCours] = useState(false);

  const ouvrirPaiement = (b) => {
    setBulletinAPayer(b);
    setFormPaiement({ date_paiement: getServerToday(), mode_paiement: 'especes', reference_paiement: '' });
  };

  const confirmerPaiement = async (e) => {
    e.preventDefault();
    setPaiementEnCours(true);
    try {
      await client.put(`/paie/${bulletinAPayer.id}/statut`, { statut: 'paye', date_paiement: formPaiement.date_paiement, mode_paiement: formPaiement.mode_paiement, reference_paiement: formPaiement.reference_paiement || null });
      toast.success('Salaire marqué comme payé.');
      printBulletinPaie({ bulletin: { ...bulletinAPayer, statut: 'paye', date_paiement: formPaiement.date_paiement }, moisLibelle: MOIS[bulletinAPayer.mois - 1], ecole });
      setBulletinAPayer(null);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setPaiementEnCours(false);
    }
  };

  const [form, setForm] = useState(FORM_VIDE);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const [calcul, setCalcul] = useState(null); // résultat de GET /paie/calcul-heures
  const [calculEnCours, setCalculEnCours] = useState(false);
  // Variante de `set` utilisée pour les champs qui influent sur le calcul des heures :
  // on efface l'ancien résultat tout de suite pour ne pas afficher un chiffre périmé
  // pendant que le nouveau calcul se charge.
  const setEtEffacerCalcul = (k) => (e) => { setCalcul(null); set(k)(e); };

  const grilleSelectionnee = salaires?.find((s) => s.id === Number(form.salaire_id));
  const estHoraire = grilleSelectionnee?.type_salaire === 'horaire';

  // Aperçu client du bulletin (le serveur reste la source de vérité au moment de
  // l'enregistrement) : évite de générer « à l'aveugle » sans voir le net à payer.
  const apercu = useMemo(() => {
    const montantGrille = Number(grilleSelectionnee?.montant || 0);
    const heures = Number(form.heures_normales || 0) + Number(form.heures_supplementaires || 0);
    const base = estHoraire ? montantGrille * heures : montantGrille;
    const prime = Number(String(form.prime || 0).toString().replace(/\D/g, '')) || 0;
    const retenue = Number(String(form.retenue || 0).toString().replace(/\D/g, '')) || 0;
    return { base, prime, retenue, net: base + prime - retenue };
  }, [grilleSelectionnee, estHoraire, form.heures_normales, form.heures_supplementaires, form.prime, form.retenue]);

  // Recalcule automatiquement les heures dues (issues des pointages validés) dès que
  // l'enseignant, le mois, l'année ou la grille horaire sont connus — cf. GET /paie/calcul-heures.
  // Évite de saisir les heures « à la main » et garde la paie synchronisée avec les scans réels.
  // Ne s'applique qu'à la génération d'un nouveau bulletin : en modification, l'enseignant/
  // mois/année ne changent pas et on ne veut pas écraser une valeur déjà régularisée à la main.
  const chargerCalculHeures = useCallback(async (enseignant_id, mois, annee, onAnnule) => {
    setCalculEnCours(true);
    try {
      const r = await client.get('/paie/calcul-heures', { params: { enseignant_id, mois, annee } });
      if (onAnnule()) return;
      setCalcul(r.data);
      setForm((f) => ({ ...f, heures_normales: r.data.heures_normales }));
    } catch (err) {
      if (!onAnnule()) toast.error(apiErrorMessage(err));
    } finally {
      if (!onAnnule()) setCalculEnCours(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editingId || !form.enseignant_id || !form.mois || !form.annee || !estHoraire) return undefined;
    let annule = false;
    // Ce pattern (fetch annulable au démontage) est la façon recommandée par React de
    // synchroniser un state avec un fetch externe ; la règle 'set-state-in-effect' ne
    // sait pas distinguer ce cas légitime d'un vrai anti-pattern de calcul dérivé.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    chargerCalculHeures(form.enseignant_id, form.mois, form.annee, () => annule);
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, form.enseignant_id, form.mois, form.annee, estHoraire]);

  const fermerModal = () => { setModalOpen(false); setEditingId(null); setCalcul(null); setForm(FORM_VIDE); };

  const ouvrirGeneration = () => { setEditingId(null); setForm(FORM_VIDE); setCalcul(null); setModalOpen(true); };

  const ouvrirModification = (b) => {
    setEditingId(b.id);
    setCalcul(null);
    setForm({
      enseignant_id: b.enseignant_id, salaire_id: b.salaire_id || '', mois: b.mois, annee: b.annee,
      heures_normales: b.heures_normales, heures_supplementaires: b.heures_supplementaires, prime: b.prime, retenue: b.retenue,
    });
    setModalOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await client.put(`/paie/${editingId}`, form);
        toast.success('Bulletin de paie modifié.');
      } else {
        await client.post('/paie', form);
        toast.success('Bulletin de paie généré.');
      }
      fermerModal();
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const changerStatut = async (b, statut) => {
    if (statut === 'annule' && !(await confirm({ title: 'Annuler le bulletin', message: `Annuler le bulletin de ${b.nom} pour ${MOIS[b.mois - 1]} ${b.annee} ? Vous pourrez ensuite en générer un nouveau pour cette même période.`, danger: true }))) return;
    try {
      await client.put(`/paie/${b.id}/statut`, { statut, date_paiement: statut === 'paye' ? getServerToday() : undefined });
      toast.success('Statut mis à jour.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const imprimerListe = () => {
    printTable({
      title: 'Bulletins de paie — enseignants',
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`,
      columns: BULLETINS_EXPORT_COLUMNS,
      rows: bulletins,
    });
  };

  const exporterListe = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: BULLETINS_EXPORT_COLUMNS, rows: bulletins, filename: 'bulletins_paie', sheetName: 'Bulletins' }));
  };

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <StatCard label="Reste à payer" value={`${stats.resteAPayer.toLocaleString('fr-FR')} Ar`} icon={<Wallet size={18} />} tone="brand" />
        <StatCard label="Préparés" value={stats.prepare} icon={<FileClock size={18} />} />
        <StatCard label="Validés" value={stats.valide} icon={<CheckCircle2 size={18} />} tone="accent" />
        <StatCard label="Payés" value={stats.paye} icon={<Banknote size={18} />} tone="brand" />
        <StatCard label="Total déjà payé" value={`${stats.totalPaye.toLocaleString('fr-FR')} Ar`} icon={<Landmark size={18} />} />
      </div>

      <div className="card">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <h3 className="font-semibold text-slate-800">Bulletins de paie</h3>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={!bulletins?.length} onClick={imprimerListe}><Printer size={14} className="inline -mt-0.5 mr-1.5" />Imprimer</button>
            <button className="btn-secondary" disabled={!bulletins?.length} onClick={exporterListe}><FileSpreadsheet size={14} className="inline -mt-0.5 mr-1.5" />Exporter Excel</button>
            <button className="btn-secondary" onClick={() => { setModalGenererMoisOpen(true); setResultatGenerationMois(null); }}>
              <Sparkles size={15} className="inline -mt-0.5 mr-1" /> Générer tous (mois)
            </button>
            <button className="btn-primary" onClick={ouvrirGeneration}>+ Générer un bulletin</button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="w-56">
            <label className="label">Enseignant</label>
            <select className="input" value={filtreEnseignant} onChange={(e) => setFiltreEnseignant(e.target.value)}>
              <option value="">Tous les enseignants</option>
              {enseignants?.map((e) => <option key={e.id} value={e.id}>{e.prenom} {e.nom}</option>)}
            </select>
          </div>
          <div className="w-40">
            <label className="label">Mois</label>
            <select className="input" value={filtreMois} onChange={(e) => setFiltreMois(e.target.value)}>
              <option value="">Tous</option>
              {MOIS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="w-32">
            <label className="label">Année</label>
            <input className="input" type="number" value={filtreAnnee} onChange={(e) => setFiltreAnnee(e.target.value)} placeholder="Toutes" />
          </div>
          {(filtreEnseignant || filtreMois || filtreAnnee) && (
            <button className="btn-ghost" onClick={() => { setFiltreEnseignant(''); setFiltreMois(''); setFiltreAnnee(''); }}>Réinitialiser</button>
          )}
        </div>

        {recapEnseignant && <RecapEnseignant recap={recapEnseignant} />}

        <DataTable
          loading={loading} error={error} onRetry={reload} rows={bulletins}
          pageSize={15}
          columns={[
            { key: 'nom', label: 'Enseignant', sortable: true, sortValue: (r) => `${r.prenom || ''} ${r.nom}`, render: (r) => `${r.prenom || ''} ${r.nom}` },
            { key: 'periode', label: 'Période', sortable: true, sortValue: (r) => r.annee * 100 + r.mois, render: (r) => `${MOIS[r.mois - 1]} ${r.annee}` },
            { key: 'salaire_net', label: 'Net à payer', sortable: true, render: (r) => `${Number(r.salaire_net).toLocaleString('fr-FR')} Ar` },
            { key: 'statut', label: 'Statut', render: (r) => <Badge tone={STATUT_TONE[r.statut]}>{r.statut}</Badge> },
            { key: 'mode_paiement', label: 'Mode', render: (r) => r.mode_paiement || '—' },
          ]}
          actions={(b) => (
            <div className="flex items-center justify-end gap-1">
              <button className="btn-ghost !p-1.5 text-slate-500" title="Imprimer le bulletin" onClick={() => printBulletinPaie({ bulletin: b, moisLibelle: MOIS[b.mois - 1], ecole })}>
                <Printer size={15} />
              </button>
              {b.statut === 'prepare' && (
                <button className="btn-ghost !p-1.5 text-slate-500" title="Modifier le bulletin" onClick={() => ouvrirModification(b)}>
                  <Pencil size={15} />
                </button>
              )}
              {b.statut === 'prepare' && <button className="btn-ghost !px-2 !py-1 text-brand-700" onClick={() => changerStatut(b, 'valide')}>Valider</button>}
              {b.statut === 'valide' && <button className="btn-primary !px-3 !py-1 text-xs" onClick={() => ouvrirPaiement(b)}>Payer</button>}
              {(b.statut === 'prepare' || b.statut === 'valide') && (
                <button className="btn-ghost !p-1.5 text-red-600 border border-red-100 hover:bg-red-50" title="Annuler" onClick={() => changerStatut(b, 'annule')}>
                  <XCircle size={15} />
                </button>
              )}
            </div>
          )}
        />
      </div>

      <Modal open={modalOpen} onClose={fermerModal} title={editingId ? 'Modifier le bulletin de paie' : 'Générer un bulletin de paie'} wide>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Enseignant</label>
            <select className="input" required disabled={!!editingId} value={form.enseignant_id} onChange={setEtEffacerCalcul('enseignant_id')}>
              <option value="">— Choisir —</option>
              {enseignants?.map((e) => <option key={e.id} value={e.id}>{e.prenom} {e.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Grille salariale</label>
            <select className="input" value={form.salaire_id} onChange={setEtEffacerCalcul('salaire_id')}>
              <option value="">— Aucune (0 Ar de base) —</option>
              {salaires?.filter((s) => s.enseignant_id === Number(form.enseignant_id) && s.actif).map((s) => (
                <option key={s.id} value={s.id}>{s.type_salaire} — {Number(s.montant).toLocaleString('fr-FR')} Ar</option>
              ))}
            </select>
            {form.enseignant_id && !salaires?.some((s) => s.enseignant_id === Number(form.enseignant_id) && s.actif) && (
              <p className="text-xs text-amber-600 mt-1 flex items-start gap-1"><AlertTriangle size={13} className="shrink-0 mt-0.5" />Aucune grille salariale active pour cet enseignant. Créez-en une dans l&apos;onglet « Grilles salariales ».</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Mois</label>
              <select className="input" disabled={!!editingId} value={form.mois} onChange={setEtEffacerCalcul('mois')}>
                {MOIS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Année</label>
              <input className="input" type="number" disabled={!!editingId} value={form.annee} onChange={setEtEffacerCalcul('annee')} />
            </div>
          </div>
          {editingId && <p className="text-xs text-slate-400 -mt-2">L&apos;enseignant et la période ne sont pas modifiables : annulez ce bulletin puis générez-en un nouveau si l&apos;un des deux est erroné.</p>}

          {estHoraire && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Heures normales dues (calculées depuis les pointages)</label>
                <input className="input" type="number" step="0.01" min="0" value={form.heures_normales} onChange={set('heures_normales')} />
                {calculEnCours && <p className="text-xs text-slate-400 mt-1">Calcul en cours…</p>}
                {!calculEnCours && calcul && (
                  <p className="text-xs text-slate-500 mt-1">
                    {calcul.nb_cours_valides} cours validé(s) · {calcul.nb_absences} absence(s)
                    {calcul.total_retard_minutes > 0 && ` · ${calcul.total_retard_minutes} min de retard cumulé`}
                  </p>
                )}
                {!calculEnCours && calcul?.avertissement && (
                  <p className="text-xs text-amber-600 mt-1 flex items-start gap-1"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{calcul.avertissement}</p>
                )}
                <p className="text-xs text-slate-400 mt-1">{editingId ? 'Valeur enregistrée, modifiable si besoin de régularisation.' : 'Valeur préremplie automatiquement, modifiable si besoin de régularisation.'}</p>
              </div>
              <div>
                <label className="label">Heures supplémentaires</label>
                <input className="input" type="number" step="0.01" min="0" value={form.heures_supplementaires} onChange={set('heures_supplementaires')} />
                <p className="text-xs text-slate-400 mt-1">Valorisées au même taux horaire que les heures normales.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Prime (Ar)</label>
              <MontantInput value={form.prime} onChange={(v) => setForm((f) => ({ ...f, prime: v }))} />
            </div>
            <div>
              <label className="label">Retenue (Ar)</label>
              <MontantInput value={form.retenue} onChange={(v) => setForm((f) => ({ ...f, retenue: v }))} />
            </div>
          </div>
          <RecapPaiement
            titre="Estimation du bulletin"
            lignes={[
              { label: estHoraire ? `Salaire de base (${Number(form.heures_normales || 0) + Number(form.heures_supplementaires || 0)} h)` : 'Salaire de base', montant: apercu.base },
              { label: 'Prime', montant: apercu.prime, tone: 'green' },
              { label: 'Retenue', montant: -apercu.retenue, tone: 'red' },
              { label: 'Net à payer', montant: apercu.net, total: true },
            ]}
          />
          <BarrePaiement resume="Le montant définitif est recalculé par le serveur à l'enregistrement.">
            <button type="button" className="btn-ghost" onClick={fermerModal}>Annuler</button>
            <button type="submit" className="btn-primary !px-6">{editingId ? 'Enregistrer' : 'Générer'}</button>
          </BarrePaiement>
        </form>
      </Modal>

      <Modal open={!!bulletinAPayer} onClose={() => setBulletinAPayer(null)} title="Payer le salaire" wide>
        {bulletinAPayer && (
          <form onSubmit={confirmerPaiement} className="space-y-4">
            <PaiementHeader
              nom={`${bulletinAPayer.prenom || ''} ${bulletinAPayer.nom}`.trim()}
              sousTitre={`Bulletin ${MOIS[bulletinAPayer.mois - 1]} ${bulletinAPayer.annee}`}
              badge={<Badge tone={STATUT_TONE[bulletinAPayer.statut]}>{bulletinAPayer.statut}</Badge>}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <RecapPaiement
                titre="Détail du salaire"
                lignes={[
                  { label: 'Salaire de base', montant: Number(bulletinAPayer.salaire_base) },
                  { label: 'Heures', montant: `${Number(bulletinAPayer.heures_normales)} h + ${Number(bulletinAPayer.heures_supplementaires)} h supp.`, tone: 'muted' },
                  { label: 'Prime', montant: Number(bulletinAPayer.prime), tone: 'green' },
                  { label: 'Retenue', montant: -Number(bulletinAPayer.retenue), tone: 'red' },
                  { label: 'Net à payer', montant: Number(bulletinAPayer.salaire_net), total: true },
                ]}
              />
              <div className="space-y-3">
                <div>
                  <label className="label">Date de paiement</label>
                  <input
                    className="input" type="date" required
                    value={formPaiement.date_paiement}
                    onChange={(e) => setFormPaiement((f) => ({ ...f, date_paiement: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Référence du paiement (optionnel)</label>
                  <input className="input" value={formPaiement.reference_paiement || ''} onChange={(e) => setFormPaiement((f) => ({ ...f, reference_paiement: e.target.value }))} placeholder="N° virement, chèque, pièce…" maxLength={100} />
                </div>
                <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-slate-500">
                  Le bulletin passe au statut « payé », le mode et la référence sont conservés dans l&apos;historique financier, puis le reçu est imprimé pour signature.
                </p>
              </div>
            </div>
            <ModePaiementChoix
              value={formPaiement.mode_paiement}
              onChange={(v) => setFormPaiement((f) => ({ ...f, mode_paiement: v }))}
              name="mode-paiement-salaire"
            />
            <BarrePaiement resume={<>Net à payer : <strong className="text-slate-800">{Number(bulletinAPayer.salaire_net).toLocaleString('fr-FR')} Ar</strong></>}>
              <button type="button" className="btn-ghost" onClick={() => setBulletinAPayer(null)}>Annuler</button>
              <button type="submit" className="btn-primary !px-6" disabled={paiementEnCours}>
                {paiementEnCours ? 'Paiement…' : 'Confirmer le paiement'}
              </button>
            </BarrePaiement>
          </form>
        )}
      </Modal>

      <Modal open={modalGenererMoisOpen} onClose={() => setModalGenererMoisOpen(false)} title="Générer les bulletins du mois">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setGenerationMoisEnCours(true);
            setResultatGenerationMois(null);
            try {
              const { data } = await client.post('/paie/generer', {
                mois: Number(formGenererMois.mois),
                annee: Number(formGenererMois.annee),
              });
              setResultatGenerationMois(data);
              toast.success(`${data.crees} bulletin(s) créé(s).`);
              reload();
            } catch (err) {
              toast.error(apiErrorMessage(err));
            } finally {
              setGenerationMoisEnCours(false);
            }
          }}
          className="space-y-4"
        >
          <p className="text-sm text-slate-500">
            Crée un bulletin « préparé » pour chaque enseignant actif ayant une grille salariale active, avec les heures
            déjà calculées à partir des pointages du mois (comme pour un bulletin individuel). Les enseignants ayant déjà
            un bulletin ce mois-ci sont ignorés (pas de doublon) — aucun bulletin n&apos;est validé ni payé automatiquement,
            vous gardez la main pour vérifier avant de valider.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Mois</label>
              <select className="input" required value={formGenererMois.mois} onChange={(e) => setFormGenererMois((f) => ({ ...f, mois: e.target.value }))}>
                {MOIS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Année</label>
              <input className="input" type="number" required value={formGenererMois.annee} onChange={(e) => setFormGenererMois((f) => ({ ...f, annee: e.target.value }))} />
            </div>
          </div>
          {resultatGenerationMois && (
            <div className="rounded-lg bg-brand-50 text-brand-800 text-sm px-3 py-2 space-y-1">
              <p>{resultatGenerationMois.crees} bulletin(s) créé(s) · {resultatGenerationMois.ignores_deja_existants_ou_sans_heures} ignoré(s) (déjà existant ou sans heures).</p>
              {resultatGenerationMois.avertissements?.length > 0 && (
                <ul className="list-disc list-inside text-amber-700">
                  {resultatGenerationMois.avertissements.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalGenererMoisOpen(false)}>Fermer</button>
            <button type="submit" className="btn-primary" disabled={generationMoisEnCours}>
              {generationMoisEnCours ? 'Génération…' : 'Générer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function GrillesSalariales() {
  const [modalOpen, setModalOpen] = useState(false);
  const [voirToutSansGrille, setVoirToutSansGrille] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const { data: enseignants } = useFetch(() => client.get('/utilisateurs').then((r) => r.data.filter((u) => u.role === 'enseignant')), []);
  const { data: salaires, loading, error, reload } = useFetch(() => client.get('/paie/salaires').then((r) => r.data), []);

  const [form, setForm] = useState({ enseignant_id: '', type_salaire: 'mensuel', montant: '', date_debut: getServerToday() });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Ouvre le modal de création avec l'enseignant déjà présélectionné — évite de le
  // rechercher une seconde fois dans le menu déroulant quand on clique depuis la liste
  // "sans grille active".
  const ouvrirPourEnseignant = (enseignantId) => {
    setForm((f) => ({ ...f, enseignant_id: enseignantId }));
    setModalOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      await client.post('/paie/salaires', form);
      toast.success('Grille salariale créée.');
      setModalOpen(false);
      setForm({ enseignant_id: '', type_salaire: 'mensuel', montant: '', date_debut: getServerToday() });
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const desactiver = async (s) => {
    if (!(await confirm({ title: 'Désactiver la grille', message: `Désactiver cette grille salariale de ${s.nom} ?`, danger: true }))) return;
    try {
      await client.delete(`/paie/salaires/${s.id}`);
      toast.success('Grille désactivée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const sansGrille = (enseignants || []).filter((e) => !(salaires || []).some((s) => s.enseignant_id === e.id && s.actif));

  const imprimerListe = () => {
    printTable({
      title: 'Grilles salariales — enseignants',
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`,
      columns: GRILLES_EXPORT_COLUMNS,
      rows: salaires,
    });
  };

  const exporterListe = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: GRILLES_EXPORT_COLUMNS, rows: salaires, filename: 'grilles_salariales', sheetName: 'Grilles' }));
  };

  return (
    <div>
      {sansGrille.length > 0 && (
        <div className="card mb-4 border border-amber-200 bg-amber-50">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
              <AlertTriangle size={15} />{sansGrille.length} enseignant(s) sans grille salariale active
            </p>
            {sansGrille.length > 8 && (
              <button type="button" className="text-xs font-semibold text-amber-800 underline underline-offset-2" onClick={() => setVoirToutSansGrille((v) => !v)}>
                {voirToutSansGrille ? 'Afficher moins' : `Afficher les ${sansGrille.length}`}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(voirToutSansGrille ? sansGrille : sansGrille.slice(0, 8)).map((e) => (
              <button
                key={e.id}
                type="button"
                title="Créer une grille salariale pour cet enseignant"
                className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-200 pl-2.5 pr-1.5 py-1 text-xs text-amber-900 hover:bg-amber-100 transition-colors"
                onClick={() => ouvrirPourEnseignant(e.id)}
              >
                {e.prenom} {e.nom}
                <span className="text-amber-500 font-bold">+</span>
              </button>
            ))}
            {!voirToutSansGrille && sansGrille.length > 8 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700 font-semibold">
                +{sansGrille.length - 8} autre(s)
              </span>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <h3 className="font-semibold text-slate-800">Grilles salariales</h3>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={!salaires?.length} onClick={imprimerListe}><Printer size={14} className="inline -mt-0.5 mr-1.5" />Imprimer</button>
            <button className="btn-secondary" disabled={!salaires?.length} onClick={exporterListe}><FileSpreadsheet size={14} className="inline -mt-0.5 mr-1.5" />Exporter Excel</button>
            <button className="btn-primary" onClick={() => setModalOpen(true)}>+ Nouvelle grille</button>
          </div>
        </div>
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={salaires}
          pageSize={15}
          emptyLabel="Aucune grille salariale enregistrée."
          columns={[
            { key: 'nom', label: 'Enseignant', sortable: true, sortValue: (r) => `${r.prenom || ''} ${r.nom}`, render: (r) => `${r.prenom || ''} ${r.nom}` },
            { key: 'type_salaire', label: 'Type', render: (r) => <Badge tone="brand">{r.type_salaire}</Badge> },
            { key: 'montant', label: 'Montant', sortable: true, render: (r) => `${Number(r.montant).toLocaleString('fr-FR')} Ar${r.type_salaire === 'horaire' ? ' / h' : ' / mois'}` },
            { key: 'date_debut', label: 'Depuis le', sortable: true, render: (r) => new Date(r.date_debut).toLocaleDateString('fr-FR') },
            { key: 'actif', label: 'Statut', render: (r) => <Badge tone={r.actif ? 'green' : 'slate'}>{r.actif ? 'Active' : 'Inactive'}</Badge> },
          ]}
          actions={(s) => s.actif && (
            <button className="btn-ghost !p-1.5 text-red-600 border border-red-100 hover:bg-red-50" title="Désactiver" onClick={() => desactiver(s)}>
              <XCircle size={15} />
            </button>
          )}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle grille salariale">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Enseignant</label>
            <select className="input" required value={form.enseignant_id} onChange={set('enseignant_id')}>
              <option value="">— Choisir —</option>
              {enseignants?.map((e) => <option key={e.id} value={e.id}>{e.prenom} {e.nom}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type_salaire} onChange={set('type_salaire')}>
                <option value="mensuel">Mensuel</option>
                <option value="horaire">Horaire</option>
              </select>
            </div>
            <div>
              <label className="label">Montant (Ar)</label>
              <MontantInput required value={form.montant} onChange={(v) => setForm((f) => ({ ...f, montant: v }))} />
            </div>
          </div>
          <div>
            <label className="label">Date de début</label>
            <input className="input" type="date" required value={form.date_debut} onChange={set('date_debut')} />
          </div>
          <p className="text-xs text-slate-400">Si une grille est déjà active pour cet enseignant, elle sera automatiquement désactivée.</p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Créer</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
