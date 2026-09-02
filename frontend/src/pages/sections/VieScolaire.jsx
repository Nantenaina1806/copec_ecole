import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, AlertTriangle, ShieldAlert, BellOff, CalendarClock,
  ArrowLeftRight, Building2, ExternalLink, DoorOpen, Ban, UserX, GraduationCap,
} from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { getServerToday } from '../../utils/serverClock';
import { useAuth } from '../../context/AuthContext';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { SectionHeader, Badge, SearchInput, SelectInput, TextInput, TextareaInput } from '../../components/Shared';
import StatCard from '../../components/StatCard';
import { printTable } from '../../utils/exportUtils';

// tres_grave ajouté : la contrainte de la base (chk gravite) accepte 4 valeurs, le formulaire n'en proposait que 3.
const GRAVITE = [
  { value: 'faible', label: 'Faible', tone: 'slate' },
  { value: 'moyenne', label: 'Moyenne', tone: 'amber' },
  { value: 'grave', label: 'Grave', tone: 'red' },
  { value: 'tres_grave', label: 'Très grave', tone: 'red' },
];
const GRAVITE_TONE = Object.fromEntries(GRAVITE.map((g) => [g.value, g.tone]));
const GRAVITE_LABEL = Object.fromEntries(GRAVITE.map((g) => [g.value, g.label]));

const TABS = [
  { key: 'discipline', label: 'Discipline' },
  { key: 'transferts', label: 'Transferts' },
  { key: 'sorties', label: 'Sorties définitives' },
];

function useElevesRecherche() {
  const [q, setQ] = useState('');
  const { data: eleves } = useFetch(
    () => (q.length >= 2 ? client.get('/eleves', { params: { search: q } }).then((r) => r.data) : Promise.resolve([])),
    [q]
  );
  return { q, setQ, eleves: eleves || [] };
}

// Sélecteur d'élève réutilisé dans les 3 formulaires : recherche puis choix dans une liste déroulante.
function SelecteurEleve({ eleveId, onChange, q, setQ, eleves, error }) {
  const eleveChoisi = eleves.find((e) => String(e.id) === String(eleveId));
  return (
    <div className="sm:col-span-2">
      <label className="label">Élève<span className="text-red-500 ml-0.5" aria-hidden="true">*</span></label>
      {eleveId ? (
        <div className="flex items-center justify-between input !py-2">
          <span>{eleveChoisi?.nom ? `${eleveChoisi.nom} ${eleveChoisi.prenom || ''}` : 'Élève sélectionné'}</span>
          <button type="button" className="text-xs text-brand-700" onClick={() => onChange('')}>Changer</button>
        </div>
      ) : (
        <>
          <SearchInput value={q} onChange={setQ} placeholder="Rechercher un élève (nom, matricule)…" />
          {eleves.length > 0 && (
            <div className="mt-1 border border-slate-100 rounded-lg max-h-40 overflow-y-auto">
              {eleves.map((el) => (
                <button
                  type="button" key={el.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                  onClick={() => { onChange(el.id); setQ(''); }}
                >
                  {el.nom} {el.prenom} — {el.matricule}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-red-600 mt-1" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}

const TAB_ICONS = { discipline: AlertTriangle, transferts: ArrowLeftRight, sorties: DoorOpen };

// Nom d'élève cliquable, réutilisé dans les 3 tableaux : ouvre directement la fiche élève
// (historique complet, contacts parents…) sans devoir repasser par le module Élèves.
function LienEleve({ eleveId, children }) {
  const navigate = useNavigate();
  if (!eleveId) return <span>{children}</span>;
  return (
    <button
      type="button"
      className="text-brand-700 hover:underline text-left font-medium"
      onClick={() => navigate(`/admin/eleves/${eleveId}`)}
    >
      {children}
    </button>
  );
}

export default function VieScolaire() {
  const [tab, setTab] = useState('discipline');
  return (
    <div>
      <SectionHeader title="Vie scolaire" subtitle="Discipline, transferts et sorties définitives des élèves" />
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 gap-1 mb-5">
        {TABS.map((t) => {
          const Icon = TAB_ICONS[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === t.key ? 'bg-white shadow-sm text-brand-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'discipline' && <Discipline />}
      {tab === 'transferts' && <Transferts />}
      {tab === 'sorties' && <Sorties />}
    </div>
  );
}

const FORM_DISCIPLINE_VIDE = { eleve_id: '', type_incident: '', description: '', date_incident: getServerToday(), sanction: '', gravite: 'faible' };

const DISCIPLINE_EXPORT_COLUMNS = [
  { label: 'Élève', value: (i) => `${i.nom} ${i.prenom || ''}`.trim() },
  { label: 'Type', value: (i) => i.type_incident },
  { label: 'Date', value: (i) => new Date(i.date_incident).toLocaleDateString('fr-FR') },
  { label: 'Gravité', value: (i) => GRAVITE_LABEL[i.gravite] || i.gravite },
  { label: 'Sanction', value: (i) => i.sanction || '' },
  { label: 'Parent informé', value: (i) => (i.parent_informe ? 'Oui' : 'Non') },
];

function Discipline() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Le surveillant ET le secrétariat assurent le suivi disciplinaire au quotidien
  // (créer/modifier/supprimer) sans dépendre de l'admin — le POST/PUT étaient déjà ouverts à tout
  // le staff, le DELETE est désormais élargi lui aussi (backend: authorize('admin','surveillant','secretaire')).
  const isSurveillant = user?.role === 'surveillant';
  const isSecretaire = user?.role === 'secretaire';
  const peutSupprimer = isAdmin || isSurveillant || isSecretaire;
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [graviteFiltre, setGraviteFiltre] = useState('');
  const [search, setSearch] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const { q, setQ, eleves } = useElevesRecherche();

  const { data: incidentsBruts, loading, error, reload } = useFetch(() => client.get('/vie-scolaire/discipline').then((r) => r.data), []);

  const incidents = useMemo(() => {
    let rows = incidentsBruts || [];
    if (graviteFiltre) rows = rows.filter((i) => i.gravite === graviteFiltre);
    if (search) rows = rows.filter((i) => `${i.nom} ${i.prenom || ''}`.toLowerCase().includes(search.toLowerCase()));
    return rows;
  }, [incidentsBruts, graviteFiltre, search]);

  // Récap rapide sur l'ensemble chargé (avant filtrage local) : donne au surveillant une vue
  // d'ensemble immédiate sans avoir à faire défiler le tableau.
  const nbTotal = incidentsBruts?.length ?? 0;
  const nbGraves = incidentsBruts?.filter((i) => i.gravite === 'grave' || i.gravite === 'tres_grave').length ?? 0;
  const nbNonInformes = incidentsBruts?.filter((i) => !i.parent_informe).length ?? 0;
  const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0);
  const nbCeMois = incidentsBruts?.filter((i) => new Date(i.date_incident) >= debutMois).length ?? 0;

  const [form, setForm] = useState(FORM_DISCIPLINE_VIDE);
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const openCreate = () => { setEditing(null); setForm(FORM_DISCIPLINE_VIDE); setFieldErrors({}); setQ(''); setModalOpen(true); };
  const openEdit = (i) => {
    setEditing(i);
    setForm({
      eleve_id: i.eleve_id, type_incident: i.type_incident, description: i.description || '',
      date_incident: i.date_incident?.slice(0, 10), sanction: i.sanction || '', gravite: i.gravite,
    });
    setFieldErrors({});
    setModalOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!editing && !form.eleve_id) errs.eleve_id = 'Choisissez un élève.';
    if (!form.type_incident.trim()) errs.type_incident = "Le type d'incident est requis.";
    if (!form.date_incident) errs.date_incident = "La date de l'incident est requise.";
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    try {
      if (editing) {
        await client.put(`/vie-scolaire/discipline/${editing.id}`, form);
        toast.success('Incident modifié.');
      } else {
        await client.post('/vie-scolaire/discipline', form);
        toast.success('Incident enregistré.');
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const informerParent = async (incident) => {
    try {
      await client.put(`/vie-scolaire/discipline/${incident.id}/informer-parent`);
      toast.success('Marqué comme communiqué au parent.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const supprimer = async (incident) => {
    const ok = await confirm({
      title: 'Supprimer l\'incident',
      message: `Supprimer définitivement cet incident concernant ${incident.nom} ${incident.prenom || ''} ? Cette action est irréversible.`,
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    try {
      await client.delete(`/vie-scolaire/discipline/${incident.id}`);
      toast.success('Incident supprimé.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard label="Incidents" value={nbTotal} icon={<AlertTriangle size={18} />} tone="brand" />
        <StatCard label="Cas graves" value={nbGraves} icon={<ShieldAlert size={18} />} tone={nbGraves ? 'red' : 'slate'} />
        <StatCard label="Parents non informés" value={nbNonInformes} icon={<BellOff size={18} />} tone={nbNonInformes ? 'amber' : 'slate'} />
        <StatCard label="Ce mois-ci" value={nbCeMois} icon={<CalendarClock size={18} />} tone="slate" />
      </div>
      <div className="card">
      <div className="flex flex-wrap gap-4 mb-4 items-end justify-between">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="max-w-xs">
            <SelectInput label="Filtrer par gravité" value={graviteFiltre} onChange={(e) => setGraviteFiltre(e.target.value)}>
              <option value="">Toutes</option>
              {GRAVITE.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </SelectInput>
          </div>
          <div className="max-w-xs flex-1">
            <SearchInput value={search} onChange={setSearch} placeholder="Nom de l'élève…" label="Rechercher un élève" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" disabled={!incidents?.length} onClick={() => printTable({ title: 'Discipline — incidents', subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`, columns: DISCIPLINE_EXPORT_COLUMNS, rows: incidents })}>
            🖨️ Imprimer
          </button>
          <button className="btn-secondary" disabled={!incidents?.length} onClick={() => import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: DISCIPLINE_EXPORT_COLUMNS, rows: incidents, filename: 'discipline_incidents', sheetName: 'Discipline' }))}>
            📊 Exporter Excel
          </button>
          {/* Créer un incident : ouvert à tout le staff de ce module (admin, secrétaire, surveillant) côté backend. */}
          <button className="btn-primary" onClick={openCreate}><Plus size={15} className="inline -mt-0.5 mr-1" />Nouvel incident</button>
        </div>
      </div>
      <DataTable
        loading={loading} error={error} onRetry={reload} rows={incidents}
        emptyLabel="Aucun incident enregistré."
        pageSize={15}
        columns={[
          { key: 'nom', label: 'Élève', sortable: true, render: (r) => <LienEleve eleveId={r.eleve_id}>{r.nom} {r.prenom || ''}</LienEleve> },
          { key: 'type_incident', label: 'Type', sortable: true },
          { key: 'date_incident', label: 'Date', sortable: true, render: (r) => new Date(r.date_incident).toLocaleDateString('fr-FR') },
          {
            key: 'gravite', label: 'Gravité', sortable: true,
            sortValue: (r) => GRAVITE_LABEL[r.gravite] || r.gravite,
            render: (r) => <Badge tone={GRAVITE_TONE[r.gravite] || 'slate'}>{GRAVITE_LABEL[r.gravite] || r.gravite}</Badge>,
          },
          { key: 'sanction', label: 'Sanction', render: (r) => r.sanction || '—' },
          {
            key: 'parent_informe', label: 'Parent informé', sortable: true,
            sortValue: (r) => (r.parent_informe ? 1 : 0),
            render: (r) => <Badge tone={r.parent_informe ? 'green' : 'amber'}>{r.parent_informe ? 'Oui' : 'Non'}</Badge>,
          },
        ]}
        actions={(r) => (
          <div className="flex justify-end gap-1">
            {!r.parent_informe && (
              <button className="btn-ghost !px-2 !py-1 text-brand-700 text-xs" onClick={() => informerParent(r)}>Marquer informé</button>
            )}
            <button className="btn-ghost !p-1.5" title="Modifier" onClick={() => openEdit(r)}>
              <Pencil size={15} />
            </button>
            {peutSupprimer && (
              <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(r)}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Modifier l\'incident' : 'Nouvel incident disciplinaire'} wide>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4" noValidate>
          {!editing && <SelecteurEleve eleveId={form.eleve_id} onChange={(v) => { setForm((f) => ({ ...f, eleve_id: v })); setFieldErrors((er) => ({ ...er, eleve_id: undefined })); }} q={q} setQ={setQ} eleves={eleves} error={fieldErrors.eleve_id} />}
          <TextInput label="Type d'incident" required value={form.type_incident} onChange={set('type_incident')} placeholder="Ex. Bagarre, retard répété…" error={fieldErrors.type_incident} />
          <SelectInput label="Gravité" value={form.gravite} onChange={set('gravite')}>
            {GRAVITE.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </SelectInput>
          <TextInput label="Date de l'incident" type="date" required value={form.date_incident} onChange={set('date_incident')} error={fieldErrors.date_incident} />
          <TextInput label="Sanction" value={form.sanction} onChange={set('sanction')} />
          <TextareaInput label="Description" className="sm:col-span-2" rows={3} value={form.description} onChange={set('description')} />
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const TRANSFERTS_EXPORT_COLUMNS = [
  { label: 'Élève', value: (t) => `${t.nom} ${t.prenom || ''}`.trim() },
  { label: 'Date', value: (t) => new Date(t.date_transfert).toLocaleDateString('fr-FR') },
  { label: 'Ancienne école', value: (t) => t.ancienne_ecole || (t.ancienne_classe_id ? 'Interne' : '') },
  { label: 'Nouvelle école', value: (t) => t.nouvelle_ecole || (t.nouvelle_classe_id ? 'Interne' : '') },
  { label: 'Motif', value: (t) => t.motif || '' },
];

const FORM_TRANSFERT_VIDE = { eleve_id: '', ancienne_classe_id: '', nouvelle_classe_id: '', ancienne_ecole: '', nouvelle_ecole: '', date_transfert: getServerToday(), motif: '' };

function Transferts() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Admin, secrétaire ET surveillant peuvent créer/modifier/supprimer un transfert côté backend
  // (POST/DELETE /vie-scolaire/transferts) : le secrétariat gère désormais le dossier complet de
  // la vie scolaire sans dépendre de l'admin, comme pour la discipline et les sorties.
  const isSurveillant = user?.role === 'surveillant';
  const isSecretaire = user?.role === 'secretaire';
  const peutCreer = isAdmin || isSurveillant || isSecretaire;
  const peutSupprimer = isAdmin || isSurveillant || isSecretaire;
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const { q, setQ, eleves } = useElevesRecherche();

  const { data: transfertsBruts, loading, error, reload } = useFetch(() => client.get('/vie-scolaire/transferts').then((r) => r.data), []);
  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);

  const transferts = useMemo(() => {
    if (!search) return transfertsBruts;
    return (transfertsBruts || []).filter((t) => `${t.nom} ${t.prenom || ''}`.toLowerCase().includes(search.toLowerCase()));
  }, [transfertsBruts, search]);

  // Récap rapide sur l'ensemble chargé (avant filtrage local recherche).
  const nbTotal = transfertsBruts?.length ?? 0;
  const nbInternes = transfertsBruts?.filter((t) => t.nouvelle_classe_id).length ?? 0;
  const nbExternes = nbTotal - nbInternes;

  const [form, setForm] = useState(FORM_TRANSFERT_VIDE);
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const openCreate = () => { setForm(FORM_TRANSFERT_VIDE); setFieldErrors({}); setQ(''); setModalOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.eleve_id) errs.eleve_id = 'Choisissez un élève.';
    if (!form.date_transfert) errs.date_transfert = 'La date du transfert est requise.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    try {
      await client.post('/vie-scolaire/transferts', form);
      toast.success('Transfert enregistré.');
      setModalOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const supprimer = async (t) => {
    const ok = await confirm({
      title: 'Supprimer le transfert',
      message: `Supprimer cet enregistrement de transfert pour ${t.nom} ${t.prenom || ''} ? Cette action n'annule pas le changement de classe déjà effectué.`,
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    try {
      await client.delete(`/vie-scolaire/transferts/${t.id}`);
      toast.success('Transfert supprimé.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        <StatCard label="Transferts" value={nbTotal} icon={<ArrowLeftRight size={18} />} tone="brand" />
        <StatCard label="Internes (même école)" value={nbInternes} icon={<Building2 size={18} />} tone="slate" />
        <StatCard label="Externes (autre école)" value={nbExternes} icon={<ExternalLink size={18} />} tone="slate" />
      </div>
      <div className="card">
      <div className="flex flex-wrap gap-4 mb-4 items-end justify-between">
        <div className="max-w-xs flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="Nom de l'élève…" label="Rechercher un élève" />
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" disabled={!transferts?.length} onClick={() => printTable({ title: 'Transferts d\'élèves', subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`, columns: TRANSFERTS_EXPORT_COLUMNS, rows: transferts })}>
            🖨️ Imprimer
          </button>
          <button className="btn-secondary" disabled={!transferts?.length} onClick={() => import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: TRANSFERTS_EXPORT_COLUMNS, rows: transferts, filename: 'transferts_eleves', sheetName: 'Transferts' }))}>
            📊 Exporter Excel
          </button>
          {peutCreer && (
            <button className="btn-primary" onClick={openCreate}><Plus size={15} className="inline -mt-0.5 mr-1" />Nouveau transfert</button>
          )}
        </div>
      </div>
      <DataTable
        loading={loading} error={error} onRetry={reload} rows={transferts}
        emptyLabel="Aucun transfert enregistré."
        pageSize={15}
        columns={[
          { key: 'nom', label: 'Élève', sortable: true, render: (r) => <LienEleve eleveId={r.eleve_id}>{r.nom} {r.prenom || ''}</LienEleve> },
          { key: 'date_transfert', label: 'Date', sortable: true, render: (r) => new Date(r.date_transfert).toLocaleDateString('fr-FR') },
          { key: 'ancienne_ecole', label: 'Ancienne école', render: (r) => r.ancienne_ecole || (r.ancienne_classe_id ? '— (interne)' : '—') },
          { key: 'nouvelle_ecole', label: 'Nouvelle école', render: (r) => r.nouvelle_ecole || (r.nouvelle_classe_id ? '— (interne)' : '—') },
          { key: 'motif', label: 'Motif', render: (r) => r.motif || '—' },
        ]}
        actions={(r) => peutSupprimer && (
          <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(r)}>
            <Trash2 size={15} />
          </button>
        )}
      />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau transfert" wide>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4" noValidate>
          <SelecteurEleve eleveId={form.eleve_id} onChange={(v) => { setForm((f) => ({ ...f, eleve_id: v })); setFieldErrors((er) => ({ ...er, eleve_id: undefined })); }} q={q} setQ={setQ} eleves={eleves} error={fieldErrors.eleve_id} />
          <SelectInput label="Ancienne classe" hint="Dans l'école, si transfert interne." value={form.ancienne_classe_id} onChange={set('ancienne_classe_id')}>
            <option value="">— Aucune / externe —</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </SelectInput>
          <SelectInput label="Nouvelle classe" hint="Dans l'école." value={form.nouvelle_classe_id} onChange={set('nouvelle_classe_id')}>
            <option value="">— Aucune (transfert externe) —</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </SelectInput>
          <TextInput label="Date du transfert" type="date" required value={form.date_transfert} onChange={set('date_transfert')} error={fieldErrors.date_transfert} />
          <TextInput label="Ancienne école" value={form.ancienne_ecole} onChange={set('ancienne_ecole')} placeholder="Si l'élève vient d'ailleurs" />
          <TextInput label="Nouvelle école" value={form.nouvelle_ecole} onChange={set('nouvelle_ecole')} placeholder="Si l'élève part vers une autre école" />
          <TextInput label="Motif" className="sm:col-span-2" value={form.motif} onChange={set('motif')} />
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const SORTIES_EXPORT_COLUMNS = [
  { label: 'Élève', value: (s) => `${s.nom} ${s.prenom || ''}`.trim() },
  { label: 'Date', value: (s) => new Date(s.date_sortie).toLocaleDateString('fr-FR') },
  { label: 'Motif', value: (s) => MOTIF_SORTIE_LABEL[s.motif] || s.motif },
  { label: 'Destination', value: (s) => s.destination || '' },
  { label: 'Observation', value: (s) => s.observation || '' },
];

// Valeurs alignées sur la contrainte chk de la table sortie_eleve (le formulaire proposait avant
// "fin_scolarite" / "demenagement", qui n'existent pas côté base et faisaient échouer l'enregistrement).
const MOTIF_SORTIE = [
  { value: 'fin_cycle', label: 'Fin de cycle', tone: 'green' },
  { value: 'transfert', label: 'Transfert vers une autre école', tone: 'brand' },
  { value: 'exclusion', label: 'Exclusion', tone: 'red' },
  { value: 'abandon', label: 'Abandon', tone: 'amber' },
  { value: 'deces', label: 'Décès', tone: 'slate' },
  { value: 'autre', label: 'Autre', tone: 'slate' },
];
const MOTIF_SORTIE_LABEL = Object.fromEntries(MOTIF_SORTIE.map((m) => [m.value, m.label]));
const MOTIF_SORTIE_TONE = Object.fromEntries(MOTIF_SORTIE.map((m) => [m.value, m.tone]));

function Sorties() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Admin, secrétaire ET surveillant peuvent créer/supprimer une sortie définitive côté backend
  // (POST/DELETE /vie-scolaire/sorties) : le secrétariat, comme le surveillant, clôture désormais
  // lui-même les dossiers (exclusion, abandon, fin de cycle…) sans attendre l'admin.
  const isSurveillant = user?.role === 'surveillant';
  const isSecretaire = user?.role === 'secretaire';
  const peutCreer = isAdmin || isSurveillant || isSecretaire;
  const peutSupprimer = isAdmin || isSurveillant || isSecretaire;
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const { q, setQ, eleves } = useElevesRecherche();

  const { data: sortiesBrutes, loading, error, reload } = useFetch(() => client.get('/vie-scolaire/sorties').then((r) => r.data), []);
  const { data: annees } = useFetch(() => client.get('/annees-scolaires').then((r) => r.data), []);
  const anneeActive = annees?.find((a) => a.actif);

  const sorties = useMemo(() => {
    if (!search) return sortiesBrutes;
    return (sortiesBrutes || []).filter((s) => `${s.nom} ${s.prenom || ''}`.toLowerCase().includes(search.toLowerCase()));
  }, [sortiesBrutes, search]);

  // Récap rapide sur l'ensemble chargé (avant filtrage local recherche).
  const nbTotal = sortiesBrutes?.length ?? 0;
  const nbExclusions = sortiesBrutes?.filter((s) => s.motif === 'exclusion').length ?? 0;
  const nbAbandons = sortiesBrutes?.filter((s) => s.motif === 'abandon').length ?? 0;
  const nbFinCycle = sortiesBrutes?.filter((s) => s.motif === 'fin_cycle').length ?? 0;

  const [form, setForm] = useState({ eleve_id: '', annee_scolaire_id: '', date_sortie: getServerToday(), motif: 'fin_cycle', destination: '', observation: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const openCreate = () => {
    setForm({ eleve_id: '', annee_scolaire_id: anneeActive?.id || '', date_sortie: getServerToday(), motif: 'fin_cycle', destination: '', observation: '' });
    setFieldErrors({});
    setQ('');
    setModalOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.eleve_id) errs.eleve_id = 'Choisissez un élève.';
    if (!form.annee_scolaire_id) errs.annee_scolaire_id = 'Choisissez une année scolaire.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    const eleveChoisi = eleves.find((el) => String(el.id) === String(form.eleve_id));
    const ok = await confirm({
      title: 'Confirmer la sortie définitive',
      message: `Enregistrer la sortie de ${eleveChoisi?.nom || 'cet élève'} (${MOTIF_SORTIE_LABEL[form.motif]}) ? Le statut d'inscription de l'élève sera automatiquement mis à jour.`,
      confirmLabel: 'Confirmer',
    });
    if (!ok) return;
    try {
      await client.post('/vie-scolaire/sorties', form);
      toast.success('Sortie enregistrée.');
      setModalOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const supprimer = async (s) => {
    const ok = await confirm({
      title: 'Supprimer la sortie',
      message: `Supprimer cet enregistrement de sortie pour ${s.nom} ${s.prenom || ''} ? Le statut d'inscription ne sera PAS restauré automatiquement — pensez à le corriger dans « Élèves » si besoin.`,
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    try {
      await client.delete(`/vie-scolaire/sorties/${s.id}`);
      toast.success('Sortie supprimée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard label="Sorties" value={nbTotal} icon={<DoorOpen size={18} />} tone="brand" />
        <StatCard label="Exclusions" value={nbExclusions} icon={<Ban size={18} />} tone={nbExclusions ? 'red' : 'slate'} />
        <StatCard label="Abandons" value={nbAbandons} icon={<UserX size={18} />} tone={nbAbandons ? 'amber' : 'slate'} />
        <StatCard label="Fin de cycle" value={nbFinCycle} icon={<GraduationCap size={18} />} tone="slate" />
      </div>
      <div className="card">
      <p className="text-xs text-slate-400 mb-3">Enregistrer une sortie met automatiquement à jour le statut de l&apos;inscription de l&apos;élève pour l&apos;année concernée.</p>
      <div className="flex flex-wrap gap-4 mb-4 items-end justify-between">
        <div className="max-w-xs flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="Nom de l'élève…" label="Rechercher un élève" />
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" disabled={!sorties?.length} onClick={() => printTable({ title: 'Sorties définitives', subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`, columns: SORTIES_EXPORT_COLUMNS, rows: sorties })}>
            🖨️ Imprimer
          </button>
          <button className="btn-secondary" disabled={!sorties?.length} onClick={() => import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: SORTIES_EXPORT_COLUMNS, rows: sorties, filename: 'sorties_definitives', sheetName: 'Sorties' }))}>
            📊 Exporter Excel
          </button>
          {peutCreer && (
            <button className="btn-primary" onClick={openCreate}><Plus size={15} className="inline -mt-0.5 mr-1" />Nouvelle sortie</button>
          )}
        </div>
      </div>
      <DataTable
        loading={loading} error={error} onRetry={reload} rows={sorties}
        emptyLabel="Aucune sortie enregistrée."
        pageSize={15}
        columns={[
          { key: 'nom', label: 'Élève', sortable: true, render: (r) => <LienEleve eleveId={r.eleve_id}>{r.nom} {r.prenom || ''}</LienEleve> },
          { key: 'date_sortie', label: 'Date', sortable: true, render: (r) => new Date(r.date_sortie).toLocaleDateString('fr-FR') },
          {
            key: 'motif', label: 'Motif', sortable: true,
            sortValue: (r) => MOTIF_SORTIE_LABEL[r.motif] || r.motif,
            render: (r) => <Badge tone={MOTIF_SORTIE_TONE[r.motif] || 'slate'}>{MOTIF_SORTIE_LABEL[r.motif] || r.motif}</Badge>,
          },
          { key: 'destination', label: 'Destination', render: (r) => r.destination || '—' },
        ]}
        actions={(r) => peutSupprimer && (
          <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(r)}>
            <Trash2 size={15} />
          </button>
        )}
      />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle sortie définitive" wide>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4" noValidate>
          <SelecteurEleve eleveId={form.eleve_id} onChange={(v) => { setForm((f) => ({ ...f, eleve_id: v })); setFieldErrors((er) => ({ ...er, eleve_id: undefined })); }} q={q} setQ={setQ} eleves={eleves} error={fieldErrors.eleve_id} />
          <SelectInput label="Année scolaire" required value={form.annee_scolaire_id} onChange={set('annee_scolaire_id')} error={fieldErrors.annee_scolaire_id}>
            <option value="">— Choisir —</option>
            {annees?.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
          </SelectInput>
          <SelectInput label="Motif" value={form.motif} onChange={set('motif')}>
            {MOTIF_SORTIE.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </SelectInput>
          <TextInput label="Date de sortie" type="date" required value={form.date_sortie} onChange={set('date_sortie')} />
          <TextInput label="Destination" value={form.destination} onChange={set('destination')} />
          <TextareaInput label="Observation" className="sm:col-span-2" rows={2} value={form.observation} onChange={set('observation')} />
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
