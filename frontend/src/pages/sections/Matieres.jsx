import { useState } from 'react';
import { Pencil, Trash2, Power, BookOpen, CheckCircle2, XCircle, Layers } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import ImportModal from '../../components/ImportModal';
import { SectionHeader, SearchInput, SelectInput, TextInput, Checkbox, FormField, Badge } from '../../components/Shared';
import StatCard from '../../components/StatCard';
import { PALETTE, couleurMatiere } from '../../utils/matiereColors';
import { printTable } from '../../utils/exportUtils';

const FORM_VIDE = { nom: '', code: '', coefficient: 1, actif: true, couleur: '' };

const MATIERES_IMPORT_COLUMNS = [
  { key: 'nom', label: 'Nom', required: true, example: 'Mathématiques' },
  { key: 'code', label: 'Code', example: 'MATH' },
  { key: 'coefficient', label: 'Coefficient', example: '1' },
  { key: 'couleur', label: 'Couleur', example: '' },
  { key: 'actif', label: 'Actif', example: 'oui' },
];

const MATIERES_EXPORT_COLUMNS = [
  { label: 'Nom', value: (m) => m.nom },
  { label: 'Code', value: (m) => m.code || '' },
  { label: 'Coefficient', value: (m) => m.coefficient },
  { label: 'Classes', value: (m) => m.nb_classes ?? 0 },
  { label: 'Statut', value: (m) => (m.actif ? 'Actif' : 'Inactif') },
];

export default function Matieres() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Le surveillant gère désormais les matières au quotidien (créer/modifier/activer/supprimer)
  // sans dépendre de l'admin (backend: authorize('admin','surveillant')). L'admin garde une vue
  // globale (lecture) sur cette page mais n'exécute plus ces actions lui-même — même logique que
  // la page Classes. Les autres rôles ayant accès à cette page (enseignant, secrétaire) restaient
  // déjà en lecture seule côté backend (POST/PUT/DELETE admin uniquement avant) : les boutons
  // d'action qui leur étaient montrés à tort (et déclenchaient une erreur 403) sont retirés.
  const isSurveillant = user?.role === 'surveillant';
  const canManage = isSurveillant;
  // Bannière explicative pour tous les rôles en lecture seule (pas seulement l'admin) : la
  // secrétaire et l'enseignant ont accès à cette page mais aucune action n'y est autorisée côté
  // backend pour eux (POST/PUT/DELETE réservés à admin + surveillant, car les matières sont une
  // structure pédagogique — coefficients, volume horaire — hors du périmètre du secrétariat).
  // Sans ce message ils pouvaient se demander pourquoi aucun bouton n'apparaît.
  const messageLectureSeule = isAdmin
    ? "Vue globale (lecture seule) — la création, la modification, l'activation et la suppression des matières sont gérées par le surveillant."
    : (!canManage ? "Lecture seule — la gestion des matières (création, coefficients, activation) est réservée au surveillant et à l'administrateur." : null);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [cycleId, setCycleId] = useState('');
  const [classeId, setClasseId] = useState('');
  const [search, setSearch] = useState('');
  const [actifFiltre, setActifFiltre] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  const { data: matieres, loading, error, reload } = useFetch(
    () => client.get('/matieres', {
      params: {
        cycle_id: cycleId || undefined,
        classe_id: classeId || undefined,
        search: search || undefined,
        actif: actifFiltre || undefined,
      },
    }).then((r) => r.data),
    [cycleId, classeId, search, actifFiltre]
  );
  const { data: cycles } = useFetch(() => client.get('/cycles').then((r) => r.data), []);
  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);

  const classesFiltrees = cycleId
    ? classes?.filter((c) => String(c.cycle_id) === String(cycleId))
    : classes;

  const onCycleChange = (val) => {
    setCycleId(val);
    if (val && classeId) {
      const c = classes?.find((cc) => String(cc.id) === String(classeId));
      if (c && String(c.cycle_id) !== String(val)) setClasseId('');
    }
  };

  const filtresActifs = cycleId || classeId || search || actifFiltre;
  const resetFiltres = () => { setCycleId(''); setClasseId(''); setSearch(''); setActifFiltre(''); };

  // Récap rapide (sur l'ensemble chargé, déjà filtré côté API par cycle/classe/statut) : donne au
  // surveillant une vue d'ensemble immédiate sans avoir à faire défiler le tableau, comme sur les
  // autres menus qu'il gère seul (Classes, etc.).
  const nbTotal = matieres?.length ?? 0;
  const nbActives = matieres?.filter((m) => m.actif).length ?? 0;
  const nbInactives = nbTotal - nbActives;
  const coefMoyen = nbTotal ? (matieres.reduce((s, m) => s + Number(m.coefficient || 0), 0) / nbTotal).toFixed(1) : '—';

  const [form, setForm] = useState(FORM_VIDE);
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const openCreate = () => { setEditing(null); setForm(FORM_VIDE); setFieldErrors({}); setModalOpen(true); };
  const openEdit = (m) => {
    setEditing(m);
    setForm({ nom: m.nom, code: m.code || '', coefficient: m.coefficient, actif: m.actif, couleur: m.couleur || '' });
    setFieldErrors({});
    setModalOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.nom.trim()) errs.nom = 'Le nom de la matière est requis.';
    const coef = Number(form.coefficient);
    if (!coef || coef < 1 || coef > 7) errs.coefficient = 'Le coefficient doit être compris entre 1 et 7.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    try {
      const payload = { ...form, nom: form.nom.trim(), code: form.code.trim() || null };
      if (editing) await client.put(`/matieres/${editing.id}`, payload);
      else await client.post('/matieres', payload);
      toast.success(editing ? 'Matière modifiée.' : 'Matière créée.');
      setModalOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  // Désactiver une matière la retire de son usage courant (elle reste visible dans l'historique) :
  // une confirmation légère évite un clic accidentel, sans être aussi bloquante qu'une suppression.
  // Activer une matière n'a pas besoin de confirmation (action sans risque).
  const toggleActif = async (m) => {
    if (m.actif && !(await confirm({
      title: 'Désactiver la matière',
      message: `Désactiver « ${m.nom} » ? Elle ne sera plus proposée pour les emplois du temps, notes et bulletins tant qu'elle n'est pas réactivée.${m.nb_classes ? ` Elle est actuellement assignée à ${m.nb_classes} classe(s).` : ''}`,
    }))) return;
    try {
      await client.put(`/matieres/${m.id}`, { actif: !m.actif });
      toast.success(m.actif ? 'Matière désactivée.' : 'Matière activée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const remove = async (m) => {
    const usage = m.nb_classes
      ? ` Elle est actuellement assignée à ${m.nb_classes} classe(s) : elle en sera retirée, ainsi que des emplois du temps correspondants.`
      : '';
    if (!(await confirm({
      title: 'Supprimer la matière',
      message: `Supprimer « ${m.nom} » ?${usage} Cette action est irréversible.`,
      danger: true,
    }))) return;
    try {
      await client.delete(`/matieres/${m.id}`);
      toast.success('Matière supprimée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div>
      <SectionHeader
        title="Matières"
        subtitle={`${nbTotal} matière(s)`}
        action={
          <div className="flex items-center gap-2">
            <button className="btn-secondary" disabled={!matieres?.length} onClick={() => printTable({ title: 'Liste des matières', subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`, columns: MATIERES_EXPORT_COLUMNS, rows: matieres })}>
              🖨️ Imprimer
            </button>
            <button className="btn-secondary" disabled={!matieres?.length} onClick={() => import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: MATIERES_EXPORT_COLUMNS, rows: matieres, filename: 'liste_matieres', sheetName: 'Matières' }))}>
              📊 Exporter Excel
            </button>
            {canManage && <button className="btn-secondary" onClick={() => setImportOpen(true)}>📥 Importer Excel</button>}
            {canManage && <button className="btn-primary" onClick={openCreate}>+ Nouvelle matière</button>}
          </div>
        }
      />

      {messageLectureSeule && (
        <p className="text-xs text-slate-400 mb-3">{messageLectureSeule}</p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard label="Matières" value={nbTotal} icon={<BookOpen size={18} />} tone="brand" />
        <StatCard label="Actives" value={nbActives} icon={<CheckCircle2 size={18} />} tone="brand" />
        <StatCard label="Inactives" value={nbInactives} icon={<XCircle size={18} />} tone={nbInactives ? 'amber' : 'slate'} />
        <StatCard label="Coefficient moyen" value={coefMoyen} icon={<Layers size={18} />} tone="slate" />
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-3 mb-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Rechercher par nom, code…" label="Rechercher une matière" />
          <SelectInput label="Niveau" hideLabel className="w-full sm:w-52" value={cycleId} onChange={(e) => onCycleChange(e.target.value)}>
            <option value="">— Tous les niveaux —</option>
            {cycles?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </SelectInput>
          <SelectInput label="Classe" hideLabel className="w-full sm:w-52" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
            <option value="">— Toutes les classes —</option>
            {classesFiltrees?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </SelectInput>
          <SelectInput label="Statut" hideLabel className="w-full sm:w-44" value={actifFiltre} onChange={(e) => setActifFiltre(e.target.value)}>
            <option value="">— Tout statut —</option>
            <option value="true">Actif</option>
            <option value="false">Inactif</option>
          </SelectInput>
          {filtresActifs && (
            <button className="btn-ghost" onClick={resetFiltres}>Réinitialiser</button>
          )}
        </div>
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={matieres}
          pageSize={15}
          emptyLabel={filtresActifs ? 'Aucune matière ne correspond à ces filtres.' : 'Aucune matière pour le moment.'}
          columns={[
            {
              key: 'nom', label: 'Nom', sortable: true,
              render: (m) => {
                const col = couleurMatiere(m.nom, m.couleur);
                return (
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${col.dot}`} title="Couleur" />
                    <span>{m.nom}</span>
                  </div>
                );
              },
            },
            { key: 'code', label: 'Code', render: (m) => m.code || <span className="text-slate-400">—</span> },
            { key: 'coefficient', label: 'Coefficient', sortable: true },
            {
              key: 'nb_classes', label: 'Classes', sortable: true,
              sortValue: (m) => Number(m.nb_classes || 0),
              render: (m) => (
                <Badge tone={m.nb_classes ? 'brand' : 'slate'}>
                  {m.nb_classes ?? 0} classe{(m.nb_classes ?? 0) > 1 ? 's' : ''}
                </Badge>
              ),
            },
            {
              key: 'actif', label: 'Statut', sortable: true,
              sortValue: (m) => (m.actif ? 1 : 0),
              render: (m) => <Badge tone={m.actif ? 'green' : 'red'}>{m.actif ? 'Actif' : 'Inactif'}</Badge>,
            },
          ]}
          actions={canManage ? (m) => (
            <div className="flex justify-end gap-1">
              <button
                className="btn-ghost !p-1.5"
                title={m.actif ? 'Désactiver' : 'Activer'}
                onClick={() => toggleActif(m)}
              >
                <Power size={15} className={m.actif ? 'text-emerald-600' : 'text-slate-400'} />
              </button>
              <button className="btn-ghost !p-1.5" title="Modifier" onClick={() => openEdit(m)}>
                <Pencil size={15} />
              </button>
              <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => remove(m)}>
                <Trash2 size={15} />
              </button>
            </div>
          ) : undefined}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Modifier la matière' : 'Nouvelle matière'}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <TextInput
            label="Nom" required value={form.nom} onChange={set('nom')}
            placeholder="Ex. Mathématiques" error={fieldErrors.nom} autoFocus
          />
          <TextInput
            label="Code" value={form.code} onChange={set('code')}
            placeholder="Ex. MATH" hint="Optionnel. Le nom et le code doivent être uniques."
          />
          <TextInput
            label="Coefficient" type="number" min="1" max="7" value={form.coefficient}
            onChange={set('coefficient')} error={fieldErrors.coefficient} hint={fieldErrors.coefficient ? undefined : 'Entre 1 et 7.'}
          />

          <FormField label="Couleur">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, couleur: '' }))}
                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] text-slate-400 bg-slate-100 ${!form.couleur ? 'border-slate-500' : 'border-transparent'}`}
                title="Automatique"
              >
                Auto
              </button>
              {PALETTE.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, couleur: p.key }))}
                  className={`w-7 h-7 rounded-full ${p.dot} border-2 ${form.couleur === p.key ? 'border-slate-700' : 'border-transparent'}`}
                  title={p.label}
                />
              ))}
            </div>
          </FormField>

          <Checkbox
            label="Matière active"
            checked={!!form.actif}
            onChange={(e) => setForm((f) => ({ ...f, actif: e.target.checked }))}
          />

          {editing && editing.nb_classes > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Cette matière est assignée à {editing.nb_classes} classe(s). La désactiver la retirera de l&apos;usage courant sans supprimer l&apos;historique.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/matieres/import"
        title="Importer des matières depuis Excel"
        columns={MATIERES_IMPORT_COLUMNS}
        filenamePrefix="matieres"
        onImported={reload}
      />
    </div>
  );
}
