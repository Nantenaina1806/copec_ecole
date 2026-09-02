import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Pencil, Trash2, AlertTriangle, UserPlus } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import ImportModal from '../../components/ImportModal';
import { SectionHeader, Badge, SearchInput, SelectInput, TextInput, Checkbox } from '../../components/Shared';
import { LoadingScreen, ErrorState, EmptyState } from '../../components/Feedback';
import EmploiDuTempsGrid from '../../components/EmploiDuTempsGrid';
import { printTable } from '../../utils/exportUtils';

const CLASSES_IMPORT_COLUMNS = [
  { key: 'nom', label: 'Nom', required: true, example: '6ème A' },
  { key: 'niveau', label: 'Niveau', required: true, example: '6ème' },
  { key: 'salle', label: 'Salle', required: true, example: 'Salle 3' },
  { key: 'filiere', label: 'Filiere', example: '' },
  { key: 'capacite', label: 'Capacite', example: '40' },
  { key: 'titulaire', label: 'Titulaire', example: 'email@ecole.mg (optionnel)' },
  { key: 'annee_scolaire', label: 'Année scolaire', example: '(optionnel — sinon année active)' },
];

const CLASSES_EXPORT_COLUMNS = [
  { label: 'Classe', value: (r) => r.nom },
  { label: 'Niveau', value: (r) => r.niveau_nom || '' },
  { label: 'Cycle', value: (r) => r.cycle_nom || '' },
  { label: 'Salle', value: (r) => r.salle || '' },
  { label: 'Effectif', value: (r) => `${r.effectif}${r.capacite ? ` / ${r.capacite}` : ''}` },
  { label: 'Titulaire', value: (r) => (r.titulaire_nom ? `${r.titulaire_prenom || ''} ${r.titulaire_nom}` : 'Non assigné') },
];

export default function Classes() {
  const navigate = useNavigate();
  const { id: detailId } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Le surveillant gère désormais les classes au quotidien (créer/modifier une classe, gérer les
  // matières) sans dépendre de l'admin (backend: authorize('admin','surveillant')). L'admin garde
  // une vue globale (lecture) sur cette page mais n'exécute plus ces actions lui-même.
  const isSurveillant = user?.role === 'surveillant';
  const canManage = isSurveillant;
  // La secrétaire ne gère pas les classes elles-mêmes (structure pédagogique = surveillant/admin),
  // mais elle inscrit les élèves au quotidien (POST /inscriptions déjà autorisé pour son rôle) :
  // lui donner ce geste directement depuis la fiche classe évite l'aller-retour par la liste Élèves.
  const peutInscrire = ['admin', 'secretaire'].includes(user?.role);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState('');
  const toast = useToast();

  const { data: anneeActive } = useFetch(
    () => client.get('/annees-scolaires/active').then((r) => r.data).catch(() => null),
    []
  );
  // Vue par défaut : uniquement les classes de l'année active (une classe est propre à une année,
  // afficher toutes les années mélangées prête à confusion lors de la création d'une inscription).
  const { data: classes, loading, error, reload } = useFetch(
    () => anneeActive
      ? client.get('/classes', { params: { annee_scolaire_id: anneeActive.id } }).then((r) => r.data)
      : client.get('/classes').then((r) => r.data),
    [anneeActive?.id]
  );
  const { data: niveaux } = useFetch(() => client.get('/niveaux').then((r) => r.data), []);
  const { data: enseignants } = useFetch(
    () => client.get('/utilisateurs').then((r) => r.data.filter((u) => u.role === 'enseignant' && u.actif)),
    []
  );

  const classesFiltrees = search
    ? classes?.filter((c) => `${c.nom} ${c.niveau_nom}`.toLowerCase().includes(search.toLowerCase()))
    : classes;
  // Filtre "places disponibles" : utile côté guichet pour savoir en un clin d'œil dans quelles
  // classes une inscription est encore possible avant de proposer une classe à une famille.
  const [placesLibresSeulement, setPlacesLibresSeulement] = useState(false);
  const classesAffichees = placesLibresSeulement
    ? classesFiltrees?.filter((c) => !c.capacite || Number(c.effectif) < Number(c.capacite))
    : classesFiltrees;

  const [form, setForm] = useState({ nom: '', niveau_id: '', filiere: '', salle: '', capacite: 40, titulaire_id: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const confirm = useConfirm();
  // Suppression : réservée aux classes n'ayant jamais eu d'inscription (RESTRICT en base — cf.
  // backend). Le surveillant peut ainsi corriger une classe créée par erreur sans dépendre de
  // l'admin ; une classe déjà utilisée reste protégée (message clair renvoyé par l'API).
  const supprimer = async (c) => {
    if (!(await confirm({ title: 'Supprimer la classe', message: `Supprimer la classe « ${c.nom} » ? Cette action est irréversible.`, danger: true }))) return;
    try {
      await client.delete(`/classes/${c.id}`);
      toast.success('Classe supprimée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!anneeActive) {
      toast.error("Impossible de créer une classe : aucune année scolaire active.");
      return;
    }
    const errs = {};
    if (!form.nom.trim()) errs.nom = 'Le nom de la classe est requis.';
    if (!form.niveau_id) errs.niveau_id = 'Choisissez un niveau.';
    if (canManage && !form.salle.trim()) errs.salle = 'La salle est requise.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    try {
      await client.post('/classes', { ...form, titulaire_id: form.titulaire_id || undefined, annee_scolaire_id: anneeActive.id });
      toast.success('Classe créée.');
      setModalOpen(false);
      setForm({ nom: '', niveau_id: '', filiere: '', salle: '', capacite: 40, titulaire_id: '' });
      setFieldErrors({});
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  if (detailId) return <ClasseDetail id={detailId} onBack={() => navigate('/admin/classes')} niveaux={niveaux} enseignants={enseignants} peutInscrire={peutInscrire} />;

  return (
    <div>
      <SectionHeader
        title="Classes"
        subtitle={`${classesAffichees?.length ?? 0} classe(s)${anneeActive ? ` — ${anneeActive.libelle}` : ''}`}
        action={
          <div className="flex items-center gap-2">
            <button className="btn-secondary" disabled={!classesAffichees?.length} onClick={() => printTable({ title: 'Liste des classes', subtitle: `${anneeActive ? anneeActive.libelle : 'Toutes années'} — Généré le ${new Date().toLocaleDateString('fr-FR')}`, columns: CLASSES_EXPORT_COLUMNS, rows: classesAffichees })}>
              🖨️ Imprimer
            </button>
            <button className="btn-secondary" disabled={!classesAffichees?.length} onClick={() => import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: CLASSES_EXPORT_COLUMNS, rows: classesAffichees, filename: 'liste_classes', sheetName: 'Classes' }))}>
              📊 Exporter Excel
            </button>
            {canManage && (
              <button className="btn-secondary" onClick={() => setImportOpen(true)}>📥 Importer Excel</button>
            )}
            {canManage && (
              <button className="btn-primary" onClick={() => setModalOpen(true)} disabled={!anneeActive} title={!anneeActive ? 'Activez une année scolaire pour créer une classe' : undefined}>
                + Nouvelle classe
              </button>
            )}
          </div>
        }
      />

      {isAdmin && (
        <p className="text-xs text-slate-400 mb-3">
          Vue globale (lecture seule) — la création, la modification et la suppression des classes sont gérées par le surveillant.
        </p>
      )}

      {!anneeActive && (
        <div className="card mb-5 border border-red-200 bg-red-50 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-red-700">
            Aucune année scolaire active : la liste ci-dessous affiche toutes les classes existantes, tous exercices confondus, et aucune nouvelle classe ne peut être créée.
            {' '}
            <Link to="/admin/annee-scolaire" className="font-semibold underline underline-offset-2">Configurer l&apos;année scolaire</Link>
          </div>
        </div>
      )}

      <div className="card">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <SearchInput value={search} onChange={setSearch} placeholder="Rechercher une classe ou un niveau…" label="Rechercher une classe" />
          </div>
          <Checkbox
            label="Places disponibles uniquement"
            checked={placesLibresSeulement}
            onChange={(e) => setPlacesLibresSeulement(e.target.checked)}
          />
        </div>
        <DataTable
          loading={loading}
          error={error}
          onRetry={reload}
          rows={classesAffichees}
          pageSize={10}
          emptyLabel="Aucune classe pour le moment."
          columns={[
            { key: 'nom', label: 'Classe', sortable: true },
            { key: 'niveau_nom', label: 'Niveau', sortable: true },
            { key: 'cycle_nom', label: 'Cycle', sortable: true },
            // Salle visible pour l'admin (vue globale) et le surveillant (besoin terrain pour la supervision).
            ...(isAdmin || isSurveillant ? [{ key: 'salle', label: 'Salle', sortable: true }] : []),
            {
              key: 'effectif', label: 'Effectif', sortable: true,
              render: (r) => (
                <Badge tone={r.capacite && Number(r.effectif) >= Number(r.capacite) ? 'red' : 'brand'}>
                  {r.effectif}{r.capacite ? ` / ${r.capacite}` : ''}
                </Badge>
              ),
            },
            {
              key: 'titulaire_nom', label: 'Titulaire', sortable: true,
              sortValue: (r) => `${r.titulaire_nom || ''} ${r.titulaire_prenom || ''}`,
              render: (r) => r.titulaire_nom ? `${r.titulaire_prenom || ''} ${r.titulaire_nom}` : <span className="text-slate-400">Non assigné</span>,
            },
          ]}
          actions={(r) => (
            <div className="flex justify-end gap-1">
              <button className="btn-ghost !px-2 !py-1 text-brand-700" onClick={() => navigate(`/admin/classes/${r.id}`)}>Voir →</button>
              {canManage && (
                <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(r)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          )}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle classe">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <TextInput label="Nom de la classe" required value={form.nom} onChange={set('nom')} placeholder="Ex : 6ème A" error={fieldErrors.nom} autoFocus />
          <SelectInput label="Niveau" required value={form.niveau_id} onChange={set('niveau_id')} error={fieldErrors.niveau_id}>
            <option value="">— Choisir —</option>
            {niveaux?.map((n) => <option key={n.id} value={n.id}>{n.nom}</option>)}
          </SelectInput>
          <div className={canManage ? 'grid grid-cols-2 gap-4' : ''}>
            {canManage && (
              <TextInput label="Salle" required value={form.salle} onChange={set('salle')} error={fieldErrors.salle} />
            )}
            <TextInput label="Capacité" type="number" min="1" value={form.capacite} onChange={set('capacite')} />
          </div>
          {canManage && (
            <SelectInput label="Titulaire (enseignant responsable)" value={form.titulaire_id} onChange={set('titulaire_id')}>
              <option value="">— Aucun pour l&apos;instant —</option>
              {enseignants?.map((ens) => <option key={ens.id} value={ens.id}>{ens.prenom} {ens.nom}</option>)}
            </SelectInput>
          )}
          <TextInput label="Filière" hint="Optionnel." value={form.filiere} onChange={set('filiere')} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Créer</button>
          </div>
        </form>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/classes/import"
        title="Importer des classes depuis Excel"
        columns={CLASSES_IMPORT_COLUMNS}
        filenamePrefix="classes"
        onImported={reload}
      />
    </div>
  );
}

function ClasseDetail({ id, onBack, niveaux, enseignants, peutInscrire }) {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Idem liste des classes : le surveillant gère (modifier la classe, matières), l'admin garde
  // une vue globale (lecture) sur la fiche classe.
  const isSurveillant = user?.role === 'surveillant';
  const canManage = isSurveillant;
  const { data, loading, error, reload } = useFetch(() => client.get(`/classes/${id}`).then((r) => r.data), [id]);
  const { data: edt } = useFetch(() => client.get('/emploi-du-temps', { params: { classe_id: id } }).then((r) => r.data), [id]);
  const { data: toutesMatieres } = useFetch(() => client.get('/matieres').then((r) => r.data), []);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editFieldErrors, setEditFieldErrors] = useState({});
  const [matiereModalOpen, setMatiereModalOpen] = useState(false);
  const [editingMatiere, setEditingMatiere] = useState(null);
  const [matiereForm, setMatiereForm] = useState({ matiere_id: '', coefficient: 1, heures_semaine: 2 });
  const [matiereFieldErrors, setMatiereFieldErrors] = useState({});
  const [addMatiereOpen, setAddMatiereOpen] = useState(false);

  // Inscrire directement un élève dans CETTE classe (POST /inscriptions, déjà autorisé pour la
  // secrétaire) — évite de repasser par la liste Élèves quand on est déjà sur la fiche classe,
  // par ex. pour compléter un effectif ou répartir de nouveaux inscrits.
  const [inscrireOpen, setInscrireOpen] = useState(false);
  const [rechercheEleve, setRechercheEleve] = useState('');
  const [eleveChoisi, setEleveChoisi] = useState(null);
  const [numeroClasse, setNumeroClasse] = useState('');
  const [inscrireSaving, setInscrireSaving] = useState(false);
  const { data: elevesTrouves } = useFetch(
    () => (rechercheEleve.length >= 2 ? client.get('/eleves', { params: { search: rechercheEleve } }).then((r) => r.data) : Promise.resolve([])),
    [rechercheEleve]
  );

  const ouvrirInscrire = () => {
    setRechercheEleve(''); setEleveChoisi(null); setNumeroClasse('');
    setInscrireOpen(true);
  };

  const submitInscrireEleve = async (e) => {
    e.preventDefault();
    if (!eleveChoisi) { toast.error('Choisissez un élève.'); return; }
    setInscrireSaving(true);
    try {
      await client.post('/inscriptions', {
        eleve_id: eleveChoisi.id, classe_id: id, annee_scolaire_id: data.annee_scolaire_id,
        numero_classe: numeroClasse || undefined,
      });
      toast.success(`${eleveChoisi.prenom || ''} ${eleveChoisi.nom} inscrit(e) dans ${data.nom}.`);
      setInscrireOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setInscrireSaving(false);
    }
  };

  const ELEVES_CLASSE_EXPORT_COLUMNS = [
    { label: 'N°', value: (r) => r.numero_classe ?? '' },
    { label: 'Matricule', value: (r) => r.matricule },
    { label: 'Nom', value: (r) => r.nom },
    { label: 'Prénom', value: (r) => r.prenom || '' },
  ];
  const imprimerListeEleves = () => data && printTable({
    title: `Liste des élèves — ${data.nom}`,
    subtitle: `${data.niveau_nom} · ${data.cycle_nom} — Généré le ${new Date().toLocaleDateString('fr-FR')}`,
    columns: ELEVES_CLASSE_EXPORT_COLUMNS,
    rows: data.eleves,
  });
  const exporterListeEleves = () => data && import('../../utils/excelExport').then((m) => m.exportToExcel({
    columns: ELEVES_CLASSE_EXPORT_COLUMNS, rows: data.eleves, filename: `eleves_${data.nom}`, sheetName: 'Élèves',
  }));

  const openEdit = () => {
    setEditForm({
      nom: data.nom, niveau_id: data.niveau_id, salle: data.salle || '',
      capacite: data.capacite || '', titulaire_id: data.titulaire_id || '', filiere: data.filiere || '',
    });
    setEditFieldErrors({});
    setEditOpen(true);
  };
  const setEditField = (k) => (e) => {
    setEditForm((f) => ({ ...f, [k]: e.target.value }));
    setEditFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!editForm.nom.trim()) errs.nom = 'Le nom de la classe est requis.';
    if (!editForm.salle.trim()) errs.salle = 'La salle est requise.';
    if (Object.keys(errs).length) { setEditFieldErrors(errs); return; }
    try {
      await client.put(`/classes/${id}`, { ...editForm, titulaire_id: editForm.titulaire_id || null });
      toast.success('Classe modifiée.');
      setEditOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const openEditMatiere = (m) => {
    setEditingMatiere(m);
    setMatiereForm({ matiere_id: m.matiere_id, coefficient: m.coefficient, heures_semaine: m.heures_semaine });
    setMatiereFieldErrors({});
    setMatiereModalOpen(true);
  };
  const openAddMatiere = () => {
    setEditingMatiere(null);
    setMatiereForm({ matiere_id: '', coefficient: 1, heures_semaine: 2 });
    setMatiereFieldErrors({});
    setAddMatiereOpen(true);
  };
  const setMatiereField = (k) => (e) => {
    setMatiereForm((f) => ({ ...f, [k]: e.target.value }));
    setMatiereFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const matieresDisponibles = toutesMatieres?.filter(
    (m) => !data?.matieres.some((dm) => dm.matiere_id === m.id)
  );

  const submitMatiere = async (e) => {
    e.preventDefault();
    if (!matiereForm.matiere_id) {
      setMatiereFieldErrors({ matiere_id: 'Choisissez une matière.' });
      return;
    }
    try {
      await client.post(`/classes/${id}/matieres`, {
        matiere_id: matiereForm.matiere_id,
        coefficient: matiereForm.coefficient,
        heures_semaine: matiereForm.heures_semaine,
      });
      toast.success(editingMatiere ? 'Matière modifiée.' : 'Matière ajoutée à la classe.');
      setMatiereModalOpen(false);
      setAddMatiereOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const removeMatiere = async (m) => {
    if (!(await confirm({ title: 'Retirer la matière', message: `Retirer « ${m.matiere_nom} » de cette classe ?`, danger: true }))) return;
    try {
      await client.delete(`/classes/${id}/matieres/${m.matiere_id}`);
      toast.success('Matière retirée de la classe.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  // Suppression de la classe : seulement possible si aucun élève n'y a jamais été inscrit
  // (RESTRICT en base). On le bloque déjà côté UI (disabled) pour éviter un aller-retour inutile,
  // le backend reste la source de vérité et renvoie un message clair si on tente quand même.
  const supprimerClasse = async () => {
    if (!(await confirm({ title: 'Supprimer la classe', message: `Supprimer la classe « ${data.nom} » ? Cette action est irréversible.`, danger: true }))) return;
    try {
      await client.delete(`/classes/${id}`);
      toast.success('Classe supprimée.');
      onBack();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div>
      <button className="btn-ghost !px-0 mb-4" onClick={onBack}>&larr; Retour aux classes</button>
      <SectionHeader
        title={data.nom}
        subtitle={isAdmin || isSurveillant ? `${data.niveau_nom} · ${data.cycle_nom} · Salle ${data.salle}` : `${data.niveau_nom} · ${data.cycle_nom}`}
        action={(canManage || peutInscrire) && (
          <div className="flex items-center gap-2 flex-wrap">
            {peutInscrire && (
              <button className="btn-primary flex items-center gap-2" onClick={ouvrirInscrire}>
                <UserPlus size={15} /> Inscrire un élève
              </button>
            )}
            {canManage && (
              <>
                <button className="btn-secondary" onClick={openEdit}>
                  <Pencil size={14} /> Modifier la classe
                </button>
                <button
                  className="btn-secondary text-red-600"
                  onClick={supprimerClasse}
                  disabled={data.eleves.length > 0}
                  title={data.eleves.length > 0 ? "Impossible de supprimer : des élèves sont ou ont été inscrits dans cette classe" : undefined}
                >
                  <Trash2 size={14} /> Supprimer
                </button>
              </>
            )}
          </div>
        )}
      />

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-slate-800">
              Élèves ({data.eleves.length}{data.capacite ? ` / ${data.capacite}` : ''})
              {data.capacite && (
                <span className={`ml-2 text-xs font-normal ${data.eleves.length >= data.capacite ? 'text-red-600' : 'text-slate-400'}`}>
                  {data.eleves.length >= data.capacite ? 'Complet' : `${data.capacite - data.eleves.length} place(s) disponible(s)`}
                </span>
              )}
            </h3>
            <div className="flex gap-1">
              <button className="btn-ghost !p-1.5" title="Imprimer la liste" disabled={!data.eleves.length} onClick={imprimerListeEleves}>🖨️</button>
              <button className="btn-ghost !p-1.5" title="Exporter Excel" disabled={!data.eleves.length} onClick={exporterListeEleves}>📊</button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {data.eleves.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                <span>{e.nom} {e.prenom}</span>
                <button className="text-brand-700 text-xs font-medium" onClick={() => navigate(`/admin/eleves/${e.id}`)}>Fiche →</button>
              </div>
            ))}
            {data.eleves.length === 0 && <p className="text-sm text-slate-400 py-4">Aucun élève inscrit.</p>}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800">Matières</h3>
            {canManage && data.cycle_nom !== 'Primaire' && (
              <button className="btn-ghost !px-2 !py-1 text-brand-700" onClick={openAddMatiere} disabled={!matieresDisponibles?.length}>
                + Ajouter
              </button>
            )}
          </div>
          {data.cycle_nom === 'Primaire' ? (
            <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p>
                Classe du Primaire : pas de matière à répartir — {data.titulaire_nom ? (
                  <><span className="font-medium">{data.titulaire_prenom} {data.titulaire_nom}</span> couvre seul{data.titulaire_prenom ? '(e)' : ''} toute la classe</>
                ) : 'le titulaire couvrira seul toute la classe une fois assigné'}.
              </p>
              <p className="mt-1 text-xs text-slate-500">Pour changer de titulaire, utilisez « Modifier la classe » ci-dessus.</p>
            </div>
          ) : (
            <>
              <table className="table-base">
                <thead><tr><th>Matière</th><th>Coef.</th><th>H/semaine</th>{canManage && <th></th>}</tr></thead>
                <tbody>
                  {data.matieres.map((m) => (
                    <tr key={m.id}>
                      <td>{m.matiere_nom}</td>
                      <td>{m.coefficient}</td>
                      <td>{m.heures_semaine}h</td>
                      {canManage && (
                        <td>
                          <div className="flex justify-end gap-1">
                            <button
                              className="btn-ghost !p-1.5"
                              title="Modifier"
                              onClick={() => openEditMatiere(m)}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              className="btn-ghost !p-1.5 text-red-600"
                              title="Supprimer"
                              onClick={() => removeMatiere(m)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.matieres.length === 0 && <EmptyState title="Aucune matière assignée." className="!py-4" />}
            </>
          )}
        </div>

        <div className="card lg:col-span-2">
          <h3 className="font-semibold text-slate-800 mb-3">Emploi du temps</h3>
          {edt?.length ? (
            <EmploiDuTempsGrid edt={edt} />
          ) : (
            <p className="text-sm text-slate-400">Aucun emploi du temps publié pour cette classe (voir la section « Emploi du temps »).</p>
          )}
        </div>
      </div>

      {editForm && (
        <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Modifier — ${data.nom}`}>
          <form onSubmit={submitEdit} className="space-y-4" noValidate>
            <TextInput label="Nom de la classe" required value={editForm.nom} onChange={setEditField('nom')} error={editFieldErrors.nom} autoFocus />
            <SelectInput label="Niveau" required value={editForm.niveau_id} onChange={setEditField('niveau_id')}>
              {niveaux?.map((n) => <option key={n.id} value={n.id}>{n.nom}</option>)}
            </SelectInput>
            <div className="grid grid-cols-2 gap-4">
              <TextInput label="Salle" required value={editForm.salle} onChange={setEditField('salle')} error={editFieldErrors.salle} />
              <TextInput label="Capacité" type="number" min="1" value={editForm.capacite} onChange={setEditField('capacite')} />
            </div>
            <SelectInput label="Titulaire (enseignant responsable)" value={editForm.titulaire_id} onChange={setEditField('titulaire_id')}>
              <option value="">— Aucun —</option>
              {enseignants?.map((ens) => <option key={ens.id} value={ens.id}>{ens.prenom} {ens.nom}</option>)}
            </SelectInput>
            <TextInput label="Filière" hint="Optionnel." value={editForm.filiere} onChange={setEditField('filiere')} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setEditOpen(false)}>Annuler</button>
              <button type="submit" className="btn-primary">Enregistrer</button>
            </div>
          </form>
        </Modal>
      )}

      <Modal open={matiereModalOpen} onClose={() => setMatiereModalOpen(false)} title={`Modifier — ${editingMatiere?.matiere_nom || ''}`}>
        <form onSubmit={submitMatiere} className="space-y-4" noValidate>
          <TextInput label="Coefficient" type="number" min="1" max="7" value={matiereForm.coefficient} onChange={setMatiereField('coefficient')} />
          <TextInput label="Heures / semaine" hint="Entre 2 et 8." type="number" min="2" max="8" required value={matiereForm.heures_semaine} onChange={setMatiereField('heures_semaine')} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setMatiereModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>

      <Modal open={addMatiereOpen} onClose={() => setAddMatiereOpen(false)} title="Ajouter une matière à la classe">
        <form onSubmit={submitMatiere} className="space-y-4" noValidate>
          <SelectInput label="Matière" required value={matiereForm.matiere_id} onChange={setMatiereField('matiere_id')} error={matiereFieldErrors.matiere_id}>
            <option value="">— Choisir —</option>
            {matieresDisponibles?.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </SelectInput>
          <TextInput label="Coefficient" type="number" min="1" max="7" value={matiereForm.coefficient} onChange={setMatiereField('coefficient')} />
          <TextInput label="Heures / semaine" hint="Entre 2 et 8." type="number" min="2" max="8" required value={matiereForm.heures_semaine} onChange={setMatiereField('heures_semaine')} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setAddMatiereOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Ajouter</button>
          </div>
        </form>
      </Modal>

      <Modal open={inscrireOpen} onClose={() => setInscrireOpen(false)} title={`Inscrire un élève — ${data.nom}`} wide>
        <form onSubmit={submitInscrireEleve} className="space-y-4">
          {!eleveChoisi ? (
            <div>
              <label className="label">Rechercher un élève</label>
              <SearchInput value={rechercheEleve} onChange={setRechercheEleve} placeholder="Nom, prénom ou matricule…" />
              {rechercheEleve.length >= 2 && (
                <div className="mt-2 max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {(elevesTrouves || []).length === 0 && <p className="text-sm text-slate-400 p-3">Aucun élève trouvé.</p>}
                  {(elevesTrouves || []).map((el) => (
                    <button
                      type="button" key={el.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between"
                      onClick={() => setEleveChoisi(el)}
                    >
                      <span>{el.prenom} {el.nom}</span>
                      <span className="text-xs text-slate-400">{el.matricule}{el.classe_nom ? ` · déjà en ${el.classe_nom}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between bg-brand-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <UserPlus size={16} className="text-brand-700" />
                <span className="font-medium">{eleveChoisi.prenom} {eleveChoisi.nom}</span>
                <span className="text-xs text-slate-500">{eleveChoisi.matricule}</span>
              </div>
              <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setEleveChoisi(null)}>Changer</button>
            </div>
          )}

          {eleveChoisi && (
            <TextInput label="N° dans la classe" hint="Optionnel." type="number" min="1" value={numeroClasse} onChange={(e) => setNumeroClasse(e.target.value)} />
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setInscrireOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={inscrireSaving || !eleveChoisi}>
              {inscrireSaving ? 'Inscription…' : 'Inscrire'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
