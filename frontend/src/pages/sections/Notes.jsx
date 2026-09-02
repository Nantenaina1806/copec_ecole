import { useMemo, useState } from 'react';
import { Pencil, Trash2, Printer, FileSpreadsheet, RefreshCw } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import ImportModal from '../../components/ImportModal';
import { SectionHeader, Badge, SearchInput, SelectInput, TextInput, TextareaInput } from '../../components/Shared';
import { EmptyState } from '../../components/Feedback';
import StatCard from '../../components/StatCard';
import { couleurMatiere } from '../../utils/matiereColors';
import { printTable } from '../../utils/exportUtils';

const NOTES_IMPORT_COLUMNS = [
  { key: 'eleve_matricule', label: 'Matricule élève', required: true, example: '2026-0001' },
  { key: 'matiere', label: 'Matière', required: true, example: 'Mathématiques' },
  { key: 'bimestre', label: 'Bimestre', required: true, example: '1' },
  { key: 'note_valeur', label: 'Note', required: true, example: '14.5' },
  { key: 'enseignant', label: 'Enseignant (email)', required: true, example: 'ens@ecole.mg' },
  { key: 'type_evaluation', label: "Type d'évaluation", example: 'devoir / composition / interrogation / autre' },
  { key: 'coefficient_evaluation', label: 'Coefficient', example: '1' },
  { key: 'commentaire', label: 'Commentaire', example: '' },
];

const NOTES_EXPORT_COLUMNS = [
  { label: 'Élève', value: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}`.trim() },
  { label: 'Matière', value: (r) => r.matiere_nom },
  { label: 'Enseignant', value: (r) => (r.enseignant_nom ? `${r.enseignant_prenom || ''} ${r.enseignant_nom}`.trim() : '—') },
  { label: 'Type', value: (r) => TYPE_LABELS[r.type_evaluation] || r.type_evaluation },
  { label: 'Note / 20', value: (r) => r.note_valeur },
  { label: 'Coefficient', value: (r) => r.coefficient_evaluation },
  { label: 'Bimestre', value: (r) => r.bimestre_libelle || '—' },
  { label: 'Date', value: (r) => new Date(r.created_at).toLocaleDateString('fr-FR') },
];

const TYPE_LABELS = { devoir: 'Devoir', composition: 'Composition', interrogation: 'Interrogation', autre: 'Autre' };
const TYPE_TONES = { devoir: 'brand', composition: 'amber', interrogation: 'slate', autre: 'slate' };

// Couleur de la note elle-même : rouge < 10, ambre 10-11.99, vert >= 12.
function toneNote(valeur) {
  const v = Number(valeur);
  if (Number.isNaN(v)) return 'slate';
  if (v < 10) return 'red';
  if (v < 12) return 'amber';
  return 'green';
}

const FORM_VIDE = { eleve_id: '', matiere_id: '', bimestre_id: '', note_valeur: '', type_evaluation: 'devoir', coefficient_evaluation: 1, commentaire: '', enseignant_id: '' };

export default function Notes() {
  const { user } = useAuth();
  const isSecretaire = user?.role === 'secretaire';
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [classeId, setClasseId] = useState('');
  const [matiereFiltre, setMatiereFiltre] = useState('');
  const [typeFiltre, setTypeFiltre] = useState('');
  const [bimestreFiltre, setBimestreFiltre] = useState('');
  const [enseignantFiltre, setEnseignantFiltre] = useState('');
  const [search, setSearch] = useState('');
  const [dernierRafraichi, setDernierRafraichi] = useState(new Date());
  const toast = useToast();
  const confirm = useConfirm();

  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);
  const { data: matieres } = useFetch(() => client.get('/matieres').then((r) => r.data), []);
  const { data: bimestres } = useFetch(() => client.get('/bimestres').then((r) => r.data), []);
  // Le secretaire n'a pas de classes propres : il choisit à quel enseignant rattacher la note
  // qu'il saisit en son nom (centralisation des copies reçues).
  const { data: utilisateurs } = useFetch(
    () => (isSecretaire ? client.get('/utilisateurs').then((r) => r.data) : Promise.resolve([])),
    [isSecretaire]
  );
  const enseignants = useMemo(() => (utilisateurs || []).filter((u) => u.role === 'enseignant'), [utilisateurs]);
  const { data: notesBrutes, loading, error, reload } = useFetch(
    () => classeId ? client.get('/notes', { params: { classe_id: classeId } }).then((r) => r.data) : Promise.resolve([]),
    [classeId]
  );
  const { data: eleves } = useFetch(
    () => classeId ? client.get('/eleves', { params: { classe_id: classeId } }).then((r) => r.data) : Promise.resolve([]),
    [classeId]
  );

  const notes = useMemo(() => {
    let rows = notesBrutes || [];
    if (matiereFiltre) rows = rows.filter((n) => String(n.matiere_id) === String(matiereFiltre));
    if (typeFiltre) rows = rows.filter((n) => n.type_evaluation === typeFiltre);
    if (bimestreFiltre) rows = rows.filter((n) => String(n.bimestre_id) === String(bimestreFiltre));
    if (enseignantFiltre) rows = rows.filter((n) => String(n.enseignant_id) === String(enseignantFiltre));
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((n) => `${n.eleve_prenom || ''} ${n.eleve_nom}`.toLowerCase().includes(s));
    }
    const bimestreLabel = (id) => bimestres?.find((b) => String(b.id) === String(id))?.libelle || '—';
    return rows.map((n) => ({ ...n, bimestre_libelle: bimestreLabel(n.bimestre_id) }));
  }, [notesBrutes, matiereFiltre, typeFiltre, bimestreFiltre, enseignantFiltre, search, bimestres]);

  const statsNotes = useMemo(() => {
    if (!notes?.length) return null;
    const valeurs = notes.map((n) => Number(n.note_valeur)).filter((v) => !Number.isNaN(v));
    if (!valeurs.length) return null;
    const somme = valeurs.reduce((acc, v) => acc + v, 0);
    return {
      nb: notes.length,
      moyenne: (somme / valeurs.length).toFixed(2),
      max: Math.max(...valeurs).toFixed(2),
      min: Math.min(...valeurs).toFixed(2),
      enDifficulte: valeurs.filter((v) => v < 10).length,
    };
  }, [notes]);

  const [form, setForm] = useState(FORM_VIDE);
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const classeNom = classes?.find((c) => String(c.id) === String(classeId))?.nom || '';
  const filtresActifs = matiereFiltre || typeFiltre || bimestreFiltre || enseignantFiltre || search;
  const resetFiltres = () => { setMatiereFiltre(''); setTypeFiltre(''); setBimestreFiltre(''); setEnseignantFiltre(''); setSearch(''); };
  const rafraichir = () => { reload(); setDernierRafraichi(new Date()); };

  const peutModifier = (n) => user?.role === 'admin' || isSecretaire || n.enseignant_id === user?.id;

  const openCreate = () => { setEditing(null); setForm(FORM_VIDE); setFieldErrors({}); setModalOpen(true); };
  const openEdit = (n) => {
    setEditing(n);
    setForm({
      eleve_id: n.eleve_id, matiere_id: n.matiere_id, bimestre_id: n.bimestre_id,
      note_valeur: n.note_valeur, type_evaluation: n.type_evaluation,
      coefficient_evaluation: n.coefficient_evaluation || 1, commentaire: n.commentaire || '',
    });
    setFieldErrors({});
    setModalOpen(true);
  };

  const imprimer = () => {
    printTable({
      title: `Notes — ${classeNom}`,
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}${statsNotes ? ` — Moyenne : ${statsNotes.moyenne}/20` : ''}`,
      columns: NOTES_EXPORT_COLUMNS,
      rows: notes,
    });
  };

  const exporter = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({
      columns: NOTES_EXPORT_COLUMNS,
      rows: notes,
      filename: `notes_${classeNom || 'classe'}`,
      sheetName: 'Notes',
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!editing) {
      if (isSecretaire && !form.enseignant_id) errs.enseignant_id = "Choisissez l'enseignant concerné.";
      if (!form.eleve_id) errs.eleve_id = 'Choisissez un élève.';
      if (!form.matiere_id) errs.matiere_id = 'Choisissez une matière.';
      if (!form.bimestre_id) errs.bimestre_id = 'Choisissez un bimestre.';
    }
    if (form.note_valeur === '' || Number(form.note_valeur) < 0 || Number(form.note_valeur) > 20) errs.note_valeur = 'La note doit être comprise entre 0 et 20.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    try {
      if (editing) {
        // Le backend n'autorise la modification que de : note_valeur, type_evaluation, commentaire.
        await client.put(`/notes/${editing.id}`, {
          note_valeur: form.note_valeur,
          type_evaluation: form.type_evaluation,
          commentaire: form.commentaire,
        });
        toast.success('Note modifiée.');
      } else {
        await client.post('/notes', form);
        toast.success('Note enregistrée.');
      }
      setModalOpen(false);
      setForm(FORM_VIDE);
      setEditing(null);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const remove = async (n) => {
    if (!(await confirm({
      title: 'Supprimer la note',
      message: `Supprimer la note de ${n.eleve_prenom || ''} ${n.eleve_nom} en ${n.matiere_nom} ?`,
      danger: true,
    }))) return;
    try {
      await client.delete(`/notes/${n.id}`);
      toast.success('Note supprimée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div>
      <SectionHeader
        title="Notes"
        subtitle={
          (user?.role === 'enseignant' ? 'Saisie limitée à vos classes/matières assignées (RG-040)'
            : isSecretaire ? 'Saisie au nom d\'un enseignant (copies reçues)' : 'Toutes classes')
          + (statsNotes ? ` — Moyenne classe : ${statsNotes.moyenne}/20` : '')
        }
        action={(
          <div className="flex flex-wrap gap-2 items-center">
            <button className="btn-secondary inline-flex items-center gap-2" disabled={!classeId || !notes?.length} onClick={imprimer}><Printer size={15} /> Imprimer</button>
            <button className="btn-secondary inline-flex items-center gap-2" disabled={!classeId || !notes?.length} onClick={exporter}><FileSpreadsheet size={15} /> Exporter Excel</button>
            {(user?.role === 'admin' || isSecretaire) && (
              <button className="btn-secondary inline-flex items-center gap-2" onClick={() => setImportOpen(true)}><FileSpreadsheet size={15} /> Importer Excel</button>
            )}
            <button className="btn-primary" disabled={!classeId} onClick={openCreate}>+ Ajouter une note</button>
            {classeId && (
              <button type="button" className="btn-ghost inline-flex items-center gap-2 text-xs" onClick={rafraichir} title="Rafraîchir">
                <RefreshCw size={14} /> {dernierRafraichi.toLocaleTimeString('fr-FR')}
              </button>
            )}
          </div>
        )}
      />

      {classeId && statsNotes && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
          <StatCard label="Notes saisies" value={statsNotes.nb} icon="📝" />
          <StatCard label="Moyenne classe" value={`${statsNotes.moyenne}/20`} icon="📊" tone="brand" />
          <StatCard label="Meilleure note" value={`${statsNotes.max}/20`} icon="🏆" />
          <StatCard label="Note la plus basse" value={`${statsNotes.min}/20`} icon="📉" tone={Number(statsNotes.min) < 10 ? 'red' : 'slate'} />
          <StatCard label="En difficulté (<10)" value={statsNotes.enDifficulte} icon="⚠️" tone={statsNotes.enDifficulte > 0 ? 'accent' : 'slate'} />
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap gap-3 mb-4">
          <SelectInput label="Classe" hideLabel className="w-full sm:w-56" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
            <option value="">— Choisir une classe —</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </SelectInput>
          {classeId && (
            <div className="flex-1 min-w-[200px]">
              <SearchInput value={search} onChange={setSearch} placeholder="Rechercher un élève…" label="Rechercher un élève" />
            </div>
          )}
          <SelectInput label="Matière" hideLabel className="w-full sm:w-48" value={matiereFiltre} onChange={(e) => setMatiereFiltre(e.target.value)} disabled={!classeId}>
            <option value="">— Toutes —</option>
            {matieres?.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </SelectInput>
          <SelectInput label="Type" hideLabel className="w-full sm:w-44" value={typeFiltre} onChange={(e) => setTypeFiltre(e.target.value)} disabled={!classeId}>
            <option value="">— Tous —</option>
            {Object.entries(TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </SelectInput>
          <SelectInput label="Bimestre" hideLabel className="w-full sm:w-44" value={bimestreFiltre} onChange={(e) => setBimestreFiltre(e.target.value)} disabled={!classeId}>
            <option value="">— Tous —</option>
            {bimestres?.map((b) => <option key={b.id} value={b.id}>{b.libelle}</option>)}
          </SelectInput>
          {isSecretaire && (
            <SelectInput label="Enseignant" hideLabel className="w-full sm:w-48" value={enseignantFiltre} onChange={(e) => setEnseignantFiltre(e.target.value)} disabled={!classeId}>
              <option value="">— Tous —</option>
              {enseignants?.map((e) => <option key={e.id} value={e.id}>{e.nom} {e.prenom}</option>)}
            </SelectInput>
          )}
          {filtresActifs && (
            <div className="flex items-center">
              <button className="btn-ghost" onClick={resetFiltres}>Réinitialiser</button>
            </div>
          )}
        </div>

        {!classeId && <EmptyState title="Choisissez une classe pour voir/saisir les notes." className="!py-8" />}

        {classeId && (
          <DataTable
            loading={loading} error={error} onRetry={reload} rows={notes}
            pageSize={15}
            emptyLabel="Aucune note pour cette sélection."
            columns={[
              { key: 'eleve_nom', label: 'Élève', sortable: true, render: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}` },
              {
                key: 'matiere_nom', label: 'Matière', sortable: true,
                render: (r) => {
                  const col = couleurMatiere(r.matiere_nom, r.matiere_couleur);
                  return (
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${col.dot}`} />
                      <span>{r.matiere_nom}</span>
                    </div>
                  );
                },
              },
              ...(isSecretaire ? [{
                key: 'enseignant_nom', label: 'Enseignant', sortable: true,
                render: (r) => r.enseignant_nom ? `${r.enseignant_prenom || ''} ${r.enseignant_nom}` : '—',
              }] : []),
              {
                key: 'type_evaluation', label: 'Type', sortable: true,
                render: (r) => <Badge tone={TYPE_TONES[r.type_evaluation] || 'slate'}>{TYPE_LABELS[r.type_evaluation] || r.type_evaluation}</Badge>,
              },
              {
                key: 'note_valeur', label: 'Note', sortable: true,
                sortValue: (r) => Number(r.note_valeur),
                render: (r) => <Badge tone={toneNote(r.note_valeur)}>{r.note_valeur}/20</Badge>,
              },
              { key: 'coefficient_evaluation', label: 'Coef.', render: (r) => r.coefficient_evaluation || 1 },
              { key: 'bimestre_libelle', label: 'Bimestre', sortable: true },
              { key: 'created_at', label: 'Date', sortable: true, render: (r) => new Date(r.created_at).toLocaleDateString('fr-FR') },
            ]}
            actions={(n) => peutModifier(n) && (
              <div className="flex justify-end gap-1">
                <button className="btn-ghost !p-1.5" title="Modifier" onClick={() => openEdit(n)}>
                  <Pencil size={15} />
                </button>
                <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => remove(n)}>
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          />
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Modifier la note' : 'Nouvelle note'}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {isSecretaire && !editing && (
            <SelectInput label="Enseignant" required value={form.enseignant_id} onChange={set('enseignant_id')} error={fieldErrors.enseignant_id}>
              <option value="">— Choisir —</option>
              {enseignants?.map((e) => <option key={e.id} value={e.id}>{e.nom} {e.prenom}</option>)}
            </SelectInput>
          )}
          <SelectInput label="Élève" required disabled={!!editing} value={form.eleve_id} onChange={set('eleve_id')} error={fieldErrors.eleve_id}>
            <option value="">— Choisir —</option>
            {eleves?.map((e) => <option key={e.id} value={e.id}>{e.nom} {e.prenom}</option>)}
          </SelectInput>
          <SelectInput label="Matière" required disabled={!!editing} value={form.matiere_id} onChange={set('matiere_id')} error={fieldErrors.matiere_id}>
            <option value="">— Choisir —</option>
            {matieres?.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </SelectInput>
          <SelectInput label="Bimestre" required disabled={!!editing} value={form.bimestre_id} onChange={set('bimestre_id')} error={fieldErrors.bimestre_id}>
            <option value="">— Choisir —</option>
            {bimestres?.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}
          </SelectInput>
          <div className="grid grid-cols-2 gap-4">
            <TextInput label="Note / 20" type="number" min="0" max="20" step="0.25" required value={form.note_valeur} onChange={set('note_valeur')} error={fieldErrors.note_valeur} />
            <SelectInput label="Type" value={form.type_evaluation} onChange={set('type_evaluation')}>
              <option value="devoir">Devoir</option>
              <option value="composition">Composition</option>
              <option value="interrogation">Interrogation</option>
              <option value="autre">Autre</option>
            </SelectInput>
          </div>
          <TextInput label="Coefficient" type="number" min="1" max="7" disabled={!!editing} value={form.coefficient_evaluation} onChange={set('coefficient_evaluation')} />
          <TextareaInput label="Commentaire" hint="Optionnel." rows={2} value={form.commentaire} onChange={set('commentaire')} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/notes/import"
        title="Importer des notes depuis Excel"
        columns={NOTES_IMPORT_COLUMNS}
        filenamePrefix="notes"
        onImported={reload}
      />
    </div>
  );
}
