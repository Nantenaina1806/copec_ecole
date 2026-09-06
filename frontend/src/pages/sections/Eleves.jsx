import { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Pencil, UserCheck } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { getServerToday } from '../../utils/serverClock';
import { useFetch } from '../../hooks/useFetch';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import ImportModal from '../../components/ImportModal';
import { SectionHeader, SearchInput, SelectInput, TextInput, Checkbox, Badge } from '../../components/Shared';
import { printTable } from '../../utils/exportUtils';

const ELEVES_IMPORT_COLUMNS = [
  { key: 'matricule', label: 'Matricule', required: true, example: '2026-0001' },
  { key: 'nom', label: 'Nom', required: true, example: 'Rakoto' },
  { key: 'prenom', label: 'Prenom', example: 'Jean' },
  { key: 'sexe', label: 'Sexe', example: 'M' },
  { key: 'date_naissance', label: 'Date de naissance', example: '2012-03-15' },
  { key: 'lieu_naissance', label: 'Lieu de naissance', example: 'Fianarantsoa' },
  { key: 'telephone', label: 'Telephone', example: '034 00 000 00' },
  { key: 'email', label: 'Email', example: 'parent@exemple.com' },
  { key: 'adresse', label: 'Adresse', example: '' },
  { key: 'classe', label: 'Classe', example: '6ème A (optionnel — année active uniquement)' },
];

const ELEVES_EXPORT_COLUMNS = [
  { label: 'Matricule', value: (r) => r.matricule },
  { label: 'Nom', value: (r) => r.nom },
  { label: 'Prénom', value: (r) => r.prenom || '' },
  { label: 'Sexe', value: (r) => r.sexe || '' },
  { label: 'Niveau', value: (r) => r.cycle_nom || '—' },
  { label: 'Classe', value: (r) => r.classe_nom || '—' },
  { label: 'Téléphone', value: (r) => r.telephone || '' },
  { label: 'Statut', value: (r) => (r.actif ? 'Actif' : 'Inactif') },
];

const SEXE_LABEL = { M: 'Masculin', F: 'Féminin' };

export default function Eleves() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Seuls admin et secrétaire peuvent créer une fiche élève côté backend (POST /eleves) :
  // le bouton doit rester caché pour les autres rôles (economie, surveillant), sinon la
  // création échoue avec une erreur 403.
  const peutInscrire = ['admin', 'secretaire'].includes(user?.role);
  // Permet d'arriver directement sur le formulaire d'inscription depuis un lien externe (ex.
  // l'action rapide "Nouvelle inscription" du tableau de bord : /admin/eleves?action=nouveau),
  // au lieu de forcer un clic supplémentaire sur le bouton une fois la page chargée.
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [cycleId, setCycleId] = useState('');
  const [niveauId, setNiveauId] = useState('');
  // Filtre statut (Actif/Inactif) : purement local, la liste complète est déjà chargée — évite
  // un aller-retour serveur pour un simple tri, et permet à la secrétaire de retrouver rapidement
  // les dossiers désactivés (ex. pour une réactivation) sans les mélanger aux actifs par défaut.
  const [statutFiltre, setStatutFiltre] = useState('actif');
  const [modalOpen, setModalOpen] = useState(() => peutInscrire && searchParams.get('action') === 'nouveau');
  const [importOpen, setImportOpen] = useState(false);
  const toast = useToast();

  const { data: eleves, loading, error, reload } = useFetch(
    () => client.get('/eleves', {
      params: {
        search: search || undefined,
        cycle_id: cycleId || undefined,
        niveau_id: niveauId || undefined,
      },
    }).then((r) => r.data),
    [search, cycleId, niveauId]
  );
  const { data: niveaux } = useFetch(() => client.get('/niveaux').then((r) => r.data), []);
  const { data: cycles } = useFetch(() => client.get('/cycles').then((r) => r.data), []);
  // Année active + classes de CETTE année uniquement : une inscription doit toujours viser
  // une classe de l'année en cours, jamais une classe d'une année passée ou future.
  const { data: anneeActive } = useFetch(
    () => client.get('/annees-scolaires/active').then((r) => r.data).catch(() => null),
    []
  );
  const { data: classes } = useFetch(
    () => anneeActive ? client.get('/classes', { params: { annee_scolaire_id: anneeActive.id } }).then((r) => r.data) : Promise.resolve([]),
    [anneeActive?.id]
  );

  // La classe choisie doit rester cohérente avec le niveau (cycle) choisi (filtres en cascade).
  const niveauxFiltres = cycleId
    ? niveaux?.filter((n) => String(n.cycle_id) === String(cycleId))
    : niveaux;

  const onCycleChange = (val) => {
    setCycleId(val);
    if (val && niveauId) {
      const n = niveaux?.find((nn) => String(nn.id) === String(niveauId));
      if (n && String(n.cycle_id) !== String(val)) setNiveauId('');
    }
  };

  const cycleNom = cycles?.find((c) => String(c.id) === String(cycleId))?.nom;
  const niveauNom = niveaux?.find((n) => String(n.id) === String(niveauId))?.nom;
  const filtreLabel = [cycleNom && `Niveau : ${cycleNom}`, niveauNom && `Classe : ${niveauNom}`]
    .filter(Boolean).join(' — ') || 'Tous les élèves';

  const elevesAffiches = (eleves || []).filter((e) => {
    if (statutFiltre === 'actif') return e.actif;
    if (statutFiltre === 'inactif') return !e.actif;
    return true;
  });

  const imprimer = () => {
    printTable({
      title: 'Liste des élèves',
      subtitle: `${filtreLabel} — Généré le ${new Date().toLocaleDateString('fr-FR')}`,
      columns: ELEVES_EXPORT_COLUMNS,
      rows: elevesAffiches,
    });
  };

  const exporter = () => {
    const suffixe = (niveauNom || cycleNom || 'tous').replace(/\s+/g, '_');
    import('../../utils/excelExport').then((m) => m.exportToExcel({
      columns: ELEVES_EXPORT_COLUMNS,
      rows: elevesAffiches,
      filename: `liste_eleves_${suffixe}`,
      sheetName: 'Élèves',
    }));
  };

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    matricule: '', nom: '', prenom: '', date_naissance: '', lieu_naissance: '', sexe: 'M', telephone: '',
    classe_id: '', numero_classe: '', photo: null,
  });
  const [parentMode, setParentMode] = useState('nouveau'); // 'nouveau' | 'existant' | 'aucun'
  const [parentIdExistant, setParentIdExistant] = useState('');
  const [parentForm, setParentForm] = useState({
    nom: '', prenom: '', telephone: '', email: '', profession: '', adresse: '',
    lien_parente: 'tuteur', responsable_principal: true,
  });
  const { data: parents } = useFetch(
    () => modalOpen ? client.get('/parents').then((r) => r.data) : Promise.resolve([]),
    [modalOpen]
  );
  const [fieldErrors, setFieldErrors] = useState({});
  const [parentFieldErrors, setParentFieldErrors] = useState({});
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };
  const onClasseChange = async (e) => {
    const classe_id = e.target.value;
    setForm((f) => ({ ...f, classe_id, numero_classe: '' }));
    if (!classe_id || !anneeActive) return;
    try {
      const { data } = await client.get('/inscriptions/prochain-numero', {
        params: { classe_id, annee_scolaire_id: anneeActive.id },
      });
      setForm((f) => (f.classe_id === classe_id ? { ...f, numero_classe: String(data.numero_classe) } : f));
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };
  useEffect(() => {
    if (!modalOpen || !anneeActive || form.matricule) return;
    client.get('/eleves/prochain-matricule').then(({ data }) => {
      setForm((f) => (f.matricule ? f : { ...f, matricule: data.matricule }));
    }).catch(() => {});
  }, [modalOpen, anneeActive, form.matricule]);
  const setParent = (k) => (e) => {
    setParentForm((f) => ({ ...f, [k]: e.target.value }));
    setParentFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const resetForm = () => {
    setStep(1);
    setForm({ matricule: '', nom: '', prenom: '', date_naissance: '', lieu_naissance: '', sexe: 'M', telephone: '', classe_id: '', numero_classe: '', photo: null });
    setFieldErrors({});
    setParentFieldErrors({});
    setParentMode('nouveau');
    setParentIdExistant('');
    setParentForm({ nom: '', prenom: '', telephone: '', email: '', profession: '', adresse: '', lien_parente: 'tuteur', responsable_principal: true });
  };

  const goToParentStep = (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.nom.trim()) errs.nom = 'Le nom est requis.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setStep(2);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (parentMode === 'existant' && !parentIdExistant) {
      setParentFieldErrors({ parentIdExistant: 'Sélectionnez un parent existant, ou changez de mode.' });
      return;
    }
    if (parentMode === 'nouveau') {
      const errs = {};
      if (!parentForm.nom.trim()) errs.nom = 'Le nom du parent est requis.';
      if (!parentForm.telephone.trim()) errs.telephone = 'Le téléphone est requis.';
      if (Object.keys(errs).length) { setParentFieldErrors(errs); return; }
    }
    try {
      const { photo, ...eleveForm } = form;
      const { data: eleve } = await client.post('/eleves', eleveForm);
      if (photo) {
        const photoData = new FormData();
        photoData.append('photo', photo);
        await client.post(`/eleves/${eleve.id}/photo`, photoData, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      if (form.classe_id && anneeActive) {
        await client.post('/inscriptions', {
          eleve_id: eleve.id, classe_id: form.classe_id, annee_scolaire_id: anneeActive.id,
          numero_classe: form.numero_classe || undefined,
        });
      }
      if (parentMode === 'existant') {
        await client.post('/parents/lier', {
          eleve_id: eleve.id, parent_id: parentIdExistant,
          lien_parente: parentForm.lien_parente, responsable_principal: parentForm.responsable_principal,
        });
      } else if (parentMode === 'nouveau' && parentForm.nom && parentForm.telephone) {
        const { data: parent } = await client.post('/parents', parentForm);
        await client.post('/parents/lier', {
          eleve_id: eleve.id, parent_id: parent.id,
          lien_parente: parentForm.lien_parente, responsable_principal: parentForm.responsable_principal,
        });
      }
      toast.success('Élève inscrit avec succès.');
      setModalOpen(false);
      resetForm();
      if (searchParams.get('action')) setSearchParams({}, { replace: true });
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  // --- Modifier la fiche élève (PUT /eleves/:id — admin + secrétaire) : la fiche pouvait être
  // créée mais jamais corrigée depuis l'appli (faute de frappe, changement de téléphone, réactivation
  // d'un dossier désactivé…) alors que le backend l'autorisait déjà.
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editFieldErrors, setEditFieldErrors] = useState({});
  const setEdit = (k) => (e) => {
    setEditForm((f) => ({ ...f, [k]: e.target.value }));
    setEditFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const openEdit = (el) => {
    setEditForm({
      id: el.id, nom: el.nom, prenom: el.prenom || '', sexe: el.sexe || 'M',
      date_naissance: el.date_naissance ? el.date_naissance.slice(0, 10) : '',
      lieu_naissance: el.lieu_naissance || '', telephone: el.telephone || '', email: el.email || '',
      adresse: el.adresse || '', actif: el.actif,
    });
    setEditFieldErrors({});
    setEditModalOpen(true);
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    if (!editForm.nom.trim()) { setEditFieldErrors({ nom: 'Le nom est requis.' }); return; }
    try {
      const { id, ...rest } = editForm;
      const payload = { ...rest, date_naissance: rest.date_naissance || null };
      await client.put(`/eleves/${id}`, payload);
      toast.success('Fiche élève mise à jour.');
      setEditModalOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  // --- Inscrire un élève déjà existant (fiche créée mais "Non inscrit", ou réinscription d'un
  // ancien élève pour la nouvelle année active) : POST /inscriptions avec l'eleve_id existant,
  // sans jamais recréer la fiche (évite un doublon de matricule/dossier).
  const [inscrireModalOpen, setInscrireModalOpen] = useState(false);
  const [inscrireEleve, setInscrireEleve] = useState(null);
  const [inscrireForm, setInscrireForm] = useState({ classe_id: '', numero_classe: '' });
  const [inscrireSaving, setInscrireSaving] = useState(false);

  const openInscrire = (el) => {
    setInscrireEleve(el);
    setInscrireForm({ classe_id: '', numero_classe: '' });
    setInscrireModalOpen(true);
  };

  const [inscrireFieldErrors, setInscrireFieldErrors] = useState({});
  const onInscrireClasseChange = async (e) => {
    const classe_id = e.target.value;
    setInscrireForm((f) => ({ ...f, classe_id, numero_classe: '' }));
    setInscrireFieldErrors((er) => ({ ...er, classe_id: undefined }));
    if (!classe_id || !anneeActive) return;
    try {
      const { data } = await client.get('/inscriptions/prochain-numero', {
        params: { classe_id, annee_scolaire_id: anneeActive.id },
      });
      setInscrireForm((f) => (f.classe_id === classe_id ? { ...f, numero_classe: String(data.numero_classe) } : f));
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };
  const submitInscrire = async (e) => {
    e.preventDefault();
    if (!inscrireForm.classe_id) { setInscrireFieldErrors({ classe_id: 'Choisissez une classe.' }); return; }
    setInscrireSaving(true);
    try {
      await client.post('/inscriptions', {
        eleve_id: inscrireEleve.id, classe_id: inscrireForm.classe_id, annee_scolaire_id: anneeActive.id,
        numero_classe: inscrireForm.numero_classe || undefined,
      });
      toast.success(`${inscrireEleve.prenom || ''} ${inscrireEleve.nom} inscrit(e) en ${classes?.find((c) => String(c.id) === String(inscrireForm.classe_id))?.nom || 'classe'}.`);
      setInscrireModalOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setInscrireSaving(false);
    }
  };

  return (
    <div>
      <SectionHeader
        title="Élèves & Inscriptions"
        subtitle={`${elevesAffiches.length} élève(s) — ${filtreLabel}`}
        action={(
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={!elevesAffiches.length} onClick={imprimer}>🖨️ Imprimer</button>
            <button className="btn-secondary" disabled={!elevesAffiches.length} onClick={exporter}>📊 Exporter Excel</button>
            {peutInscrire && (
              <button className="btn-secondary" onClick={() => setImportOpen(true)}>📥 Importer Excel</button>
            )}
            {peutInscrire && (
              <button className="btn-primary" onClick={() => setModalOpen(true)}>+ Nouvelle inscription</button>
            )}
          </div>
        )}
      />

      {!anneeActive && (
        <div className="card mb-5 border border-red-200 bg-red-50 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-red-700">
            Aucune année scolaire active : vous pouvez créer une fiche élève, mais elle ne pourra pas être inscrite dans une classe tant qu&apos;aucune année n&apos;est activée.
            {' '}
            <Link to="/admin/annee-scolaire" className="font-semibold underline underline-offset-2">Configurer l&apos;année scolaire</Link>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap gap-3 mb-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Rechercher par nom, prénom, matricule…" label="Rechercher un élève" />
          <SelectInput label="Niveau" hideLabel className="w-full sm:w-52" value={cycleId} onChange={(e) => onCycleChange(e.target.value)}>
            <option value="">— Tous les niveaux —</option>
            {cycles?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </SelectInput>
          <SelectInput label="Classe" hideLabel className="w-full sm:w-52" value={niveauId} onChange={(e) => setNiveauId(e.target.value)}>
            <option value="">— Toutes les classes —</option>
            {niveauxFiltres?.map((n) => <option key={n.id} value={n.id}>{n.nom}</option>)}
          </SelectInput>
          <SelectInput label="Statut" hideLabel className="w-full sm:w-40" value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)}>
            <option value="actif">Actifs</option>
            <option value="inactif">Inactifs</option>
            <option value="tous">Tous les statuts</option>
          </SelectInput>
          {(cycleId || niveauId || search) && (
            <button
              className="btn-ghost"
              onClick={() => { setSearch(''); setCycleId(''); setNiveauId(''); }}
            >
              Réinitialiser
            </button>
          )}
        </div>
        <DataTable
          loading={loading}
          error={error}
          onRetry={reload}
          rows={elevesAffiches}
          pageSize={10}
          emptyLabel="Aucun élève ne correspond à ces critères."
          columns={[
            { key: 'matricule', label: 'Matricule', sortable: true, render: (r) => <span className="data-mono text-slate-700">{r.matricule}</span> },
            { key: 'nom', label: 'Nom', sortable: true },
            { key: 'prenom', label: 'Prénom', sortable: true },
            { key: 'sexe', label: 'Sexe', render: (r) => SEXE_LABEL[r.sexe] || '—' },
            { key: 'cycle_nom', label: 'Niveau', sortable: true, render: (r) => r.cycle_nom || '—' },
            { key: 'classe_nom', label: 'Classe', sortable: true, render: (r) => r.classe_nom || <span className="text-amber-600 font-medium">Non inscrit</span> },
            { key: 'telephone', label: 'Téléphone' },
            {
              key: 'actif', label: 'Statut', sortable: true,
              sortValue: (r) => (r.actif ? 1 : 0),
              render: (r) => <Badge tone={r.actif ? 'green' : 'red'}>{r.actif ? 'Actif' : 'Inactif'}</Badge>,
            },
          ]}
          actions={(r) => (
            <div className="flex justify-end items-center gap-1">
              {peutInscrire && !r.classe_nom && anneeActive && (
                <button
                  className="btn-ghost !p-1.5 text-amber-600" title="Inscrire cette année"
                  onClick={() => openInscrire(r)}
                >
                  <UserCheck size={15} />
                </button>
              )}
              {peutInscrire && (
                <button className="btn-ghost !p-1.5" title="Modifier la fiche" onClick={() => openEdit(r)}>
                  <Pencil size={15} />
                </button>
              )}
              <button className="btn-ghost !px-2 !py-1 text-brand-700" onClick={() => navigate(`/admin/eleves/${r.id}`)}>
                Fiche élève →
              </button>
            </div>
          )}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); resetForm(); if (searchParams.get('action')) setSearchParams({}, { replace: true }); }}
        title={step === 1 ? 'Nouvelle inscription — Élève' : 'Nouvelle inscription — Parent / Tuteur'}
        wide
      >
        {step === 1 ? (
          <form onSubmit={goToParentStep} className="grid sm:grid-cols-2 gap-4" noValidate>
            <TextInput label="Matricule" value={form.matricule} placeholder="Généré automatiquement" readOnly autoFocus />
            <SelectInput label="Sexe" value={form.sexe} onChange={set('sexe')}>
              <option value="M">Masculin</option>
              <option value="F">Féminin</option>
            </SelectInput>
            <TextInput label="Nom" required value={form.nom} onChange={set('nom')} error={fieldErrors.nom} />
            <TextInput label="Prénom" value={form.prenom} onChange={set('prenom')} />
            <TextInput label="Date de naissance" type="date" max={getServerToday()} value={form.date_naissance} onChange={set('date_naissance')} />
            <TextInput label="Lieu de naissance" value={form.lieu_naissance} onChange={set('lieu_naissance')} />
            <TextInput label="Téléphone" value={form.telephone} onChange={set('telephone')} />
            <label className="block text-sm font-medium text-slate-700">
              Photo de l&apos;élève
              <input className="mt-1.5 block w-full text-sm text-slate-600" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setForm((f) => ({ ...f, photo: e.target.files?.[0] || null }))} />
            </label>
            <SelectInput
              label={`Classe ${anneeActive ? `(${anneeActive.libelle})` : ''}`} value={form.classe_id}
              onChange={onClasseChange} disabled={!anneeActive}
              hint={!anneeActive ? "Aucune année active — l'élève sera créé sans inscription." : undefined}
            >
              <option value="">— Aucune —</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </SelectInput>
            <TextInput
              label="N° dans la classe" type="number" min="1" value={form.numero_classe}
              placeholder="Généré automatiquement" readOnly disabled={!anneeActive || !form.classe_id}
            />
            <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => { setModalOpen(false); resetForm(); }}>Annuler</button>
              <button type="submit" className="btn-primary">Suivant →</button>
            </div>
          </form>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="flex gap-2">
              {[
                { key: 'nouveau', label: 'Nouveau parent' },
                { key: 'existant', label: 'Parent déjà enregistré' },
                { key: 'aucun', label: 'Passer cette étape' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setParentMode(opt.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    parentMode === opt.key
                      ? 'bg-brand-800 text-white border-brand-800'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-brand-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {parentMode === 'existant' && (
              <SelectInput
                label="Rechercher un parent / tuteur existant" required value={parentIdExistant}
                error={parentFieldErrors.parentIdExistant}
                onChange={(e) => { setParentIdExistant(e.target.value); setParentFieldErrors((er) => ({ ...er, parentIdExistant: undefined })); }}
                hint={parentFieldErrors.parentIdExistant ? undefined : "Utile pour un frère/une sœur déjà inscrit(e), afin d'éviter un doublon de parent."}
              >
                <option value="">— Choisir —</option>
                {parents?.map((p) => (
                  <option key={p.id} value={p.id}>{p.prenom ? `${p.prenom} ` : ''}{p.nom} — {p.telephone}</option>
                ))}
              </SelectInput>
            )}

            {(parentMode === 'existant') && (
              <div className="grid sm:grid-cols-2 gap-4">
                <SelectInput label="Lien de parenté" value={parentForm.lien_parente} onChange={setParent('lien_parente')}>
                  <option value="pere">Père</option>
                  <option value="mere">Mère</option>
                  <option value="tuteur">Tuteur</option>
                  <option value="autre">Autre</option>
                </SelectInput>
                <div className="flex items-center pt-6">
                  <Checkbox
                    label="Responsable principal"
                    checked={parentForm.responsable_principal}
                    onChange={(e) => setParentForm((f) => ({ ...f, responsable_principal: e.target.checked }))}
                  />
                </div>
              </div>
            )}

            {parentMode === 'nouveau' && (
              <div className="grid sm:grid-cols-2 gap-4">
                <TextInput label="Nom du parent / tuteur" required value={parentForm.nom} onChange={setParent('nom')} error={parentFieldErrors.nom} />
                <TextInput label="Prénom" value={parentForm.prenom} onChange={setParent('prenom')} />
                <TextInput label="Téléphone" required value={parentForm.telephone} onChange={setParent('telephone')} error={parentFieldErrors.telephone} />
                <TextInput label="Email" type="email" value={parentForm.email} onChange={setParent('email')} />
                <TextInput label="Profession" value={parentForm.profession} onChange={setParent('profession')} />
                <SelectInput label="Lien de parenté" value={parentForm.lien_parente} onChange={setParent('lien_parente')}>
                  <option value="pere">Père</option>
                  <option value="mere">Mère</option>
                  <option value="tuteur">Tuteur</option>
                  <option value="autre">Autre</option>
                </SelectInput>
                <TextInput label="Adresse" className="sm:col-span-2" value={parentForm.adresse} onChange={setParent('adresse')} />
                <div className="sm:col-span-2 flex items-center gap-2">
                  <Checkbox
                    label="Responsable principal"
                    checked={parentForm.responsable_principal}
                    onChange={(e) => setParentForm((f) => ({ ...f, responsable_principal: e.target.checked }))}
                  />
                </div>
              </div>
            )}

            {parentMode === 'aucun' && (
              <p className="text-sm text-slate-500">Aucun parent ne sera lié pour l&apos;instant. Vous pourrez en ajouter un plus tard depuis la fiche élève.</p>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setStep(1)}>← Retour</button>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={() => { setModalOpen(false); resetForm(); }}>Annuler</button>
                <button type="submit" className="btn-primary">Enregistrer</button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Modifier la fiche élève" wide>
        {editForm && (
          <form onSubmit={submitEdit} className="grid sm:grid-cols-2 gap-4" noValidate>
            <TextInput label="Nom" required value={editForm.nom} onChange={setEdit('nom')} error={editFieldErrors.nom} autoFocus />
            <TextInput label="Prénom" value={editForm.prenom} onChange={setEdit('prenom')} />
            <SelectInput label="Sexe" value={editForm.sexe} onChange={setEdit('sexe')}>
              <option value="M">Masculin</option>
              <option value="F">Féminin</option>
            </SelectInput>
            <TextInput label="Date de naissance" type="date" max={getServerToday()} value={editForm.date_naissance} onChange={setEdit('date_naissance')} />
            <TextInput label="Lieu de naissance" value={editForm.lieu_naissance} onChange={setEdit('lieu_naissance')} />
            <TextInput label="Téléphone" value={editForm.telephone} onChange={setEdit('telephone')} />
            <TextInput label="Email" type="email" className="sm:col-span-2" value={editForm.email} onChange={setEdit('email')} />
            <TextInput label="Adresse" className="sm:col-span-2" value={editForm.adresse} onChange={setEdit('adresse')} />
            <div className="sm:col-span-2 flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2.5">
              <Checkbox
                label="Dossier actif"
                checked={editForm.actif}
                onChange={(e) => setEditForm((f) => ({ ...f, actif: e.target.checked }))}
              />
              <span className="text-xs text-slate-400">— décocher désactive l&apos;élève (équivalent à une suppression douce)</span>
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setEditModalOpen(false)}>Annuler</button>
              <button type="submit" className="btn-primary">Enregistrer</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={inscrireModalOpen} onClose={() => setInscrireModalOpen(false)} title="Inscrire cette année">
        {inscrireEleve && (
          <form onSubmit={submitInscrire} className="space-y-4" noValidate>
            <div className="flex items-center gap-2 bg-brand-50 rounded-lg px-3 py-2">
              <UserCheck size={16} className="text-brand-700" />
              <span className="font-medium text-sm">{inscrireEleve.prenom} {inscrireEleve.nom}</span>
              <span className="text-xs text-slate-500">{inscrireEleve.matricule}</span>
            </div>
            <SelectInput
              label={`Classe ${anneeActive ? `(${anneeActive.libelle})` : ''}`} required
              error={inscrireFieldErrors.classe_id}
              value={inscrireForm.classe_id}
              onChange={onInscrireClasseChange}
            >
              <option value="">— Choisir —</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </SelectInput>
            <TextInput
              label="N° dans la classe" hint="Généré automatiquement." type="number" min="1" readOnly
              value={inscrireForm.numero_classe}
            />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setInscrireModalOpen(false)}>Annuler</button>
              <button type="submit" className="btn-primary" disabled={inscrireSaving}>{inscrireSaving ? 'Inscription…' : 'Inscrire'}</button>
            </div>
          </form>
        )}
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/eleves/import"
        title="Importer des élèves depuis Excel"
        columns={ELEVES_IMPORT_COLUMNS}
        filenamePrefix="eleves"
        onImported={reload}
      />
    </div>
  );
}
