import { useMemo, useRef, useState } from 'react';
import {
  Pencil, Eye, Trash2, Send, Undo2, Plus, ImagePlus, X,
} from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatCard from '../../components/StatCard';
import { SectionHeader, Badge, SearchInput } from '../../components/Shared';
import { printTable } from '../../utils/exportUtils';

const ACTUS_EXPORT_COLUMNS = [
  { label: 'Titre', value: (a) => a.titre },
  { label: 'Statut', value: (a) => (a.publie ? 'Publiée' : 'Brouillon') },
  { label: 'Auteur', value: (a) => `${a.auteur_nom || ''} ${a.auteur_prenom || ''}`.trim() || '—' },
  { label: 'Créée le', value: (a) => new Date(a.created_at).toLocaleDateString('fr-FR') },
];

const FORM_VIDE = { titre: '', contenu: '', image_url: '', publie: false };

export default function ActualitesAdmin() {
  const [modalOpen, setModalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [statutFiltre, setStatutFiltre] = useState('toutes'); // 'toutes' | 'publiees' | 'brouillons'
  const toast = useToast();
  const confirm = useConfirm();

  const { data: actus, loading, error, reload } = useFetch(() => client.get('/communication/actualites/admin').then((r) => r.data), []);

  const actusAffiches = (actus || []).filter((a) => {
    if (statutFiltre === 'publiees' && !a.publie) return false;
    if (statutFiltre === 'brouillons' && a.publie) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return `${a.titre} ${a.contenu}`.toLowerCase().includes(q);
  });

  const stats = useMemo(() => {
    const liste = actus || [];
    const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0);
    return {
      total: liste.length,
      publiees: liste.filter((a) => a.publie).length,
      brouillons: liste.filter((a) => !a.publie).length,
      ceMois: liste.filter((a) => new Date(a.created_at) >= debutMois).length,
    };
  }, [actus]);

  const [form, setForm] = useState(FORM_VIDE);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openCreate = () => { setEditing(null); setForm(FORM_VIDE); setModalOpen(true); };
  const openEdit = (a) => { setEditing(a); setForm({ titre: a.titre, contenu: a.contenu, image_url: a.image_url || '', publie: a.publie }); setModalOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) await client.put(`/communication/actualites/${editing.id}`, form);
      else await client.post('/communication/actualites', form);
      toast.success(editing ? 'Actualité mise à jour.' : 'Actualité créée.');
      setModalOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const togglePublier = async (a) => {
    try {
      await client.put(`/communication/actualites/${a.id}`, { publie: !a.publie });
      toast.success(a.publie ? 'Actualité dépubliée.' : 'Actualité publiée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const remove = async (a) => {
    if (!(await confirm({ title: "Supprimer l'actualité", message: `Supprimer « ${a.titre} » ? Cette action est définitive.`, danger: true }))) return;
    try {
      await client.delete(`/communication/actualites/${a.id}`);
      toast.success('Actualité supprimée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const imprimer = () => {
    printTable({
      title: 'Actualités',
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')} — ${actusAffiches.length} publication(s)`,
      columns: ACTUS_EXPORT_COLUMNS,
      rows: actusAffiches,
    });
  };

  const exporter = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: ACTUS_EXPORT_COLUMNS, rows: actusAffiches, filename: 'actualites', sheetName: 'Actualités' }));
  };

  return (
    <div>
      <SectionHeader
        title="Actualités"
        subtitle="Publications visibles par les élèves et parents"
        action={<button className="btn-primary" onClick={openCreate}><Plus size={15} className="inline -mt-0.5 mr-1" />Nouvelle actualité</button>}
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Total" value={stats.total} icon="📰" />
        <StatCard label="Publiées" value={stats.publiees} icon="✅" tone="brand" />
        <StatCard label="Brouillons" value={stats.brouillons} icon="📝" tone={stats.brouillons ? 'accent' : 'slate'} />
        <StatCard label="Ce mois-ci" value={stats.ceMois} icon="🗓️" tone="slate" />
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="max-w-xs flex-1">
            <label className="label">Rechercher</label>
            <SearchInput value={search} onChange={setSearch} placeholder="Titre, contenu…" />
          </div>
          <div>
            <label className="label">Statut</label>
            <select className="input" value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)}>
              <option value="toutes">Toutes</option>
              <option value="publiees">Publiées</option>
              <option value="brouillons">Brouillons</option>
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            <button className="btn-secondary" onClick={imprimer}>🖨️ Imprimer</button>
            <button className="btn-secondary" onClick={exporter}>📊 Exporter Excel</button>
          </div>
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={actusAffiches}
          pageSize={15}
          emptyLabel="Aucune actualité pour le moment."
          columns={[
            {
              key: 'titre', label: 'Titre', sortable: true,
              render: (r) => (
                <div className="flex items-center gap-2.5">
                  {r.image_url ? (
                    <img src={r.image_url} alt="" className="h-9 w-9 rounded-md object-cover shrink-0" />
                  ) : (
                    <div className="h-9 w-9 rounded-md bg-slate-100 text-slate-400 flex items-center justify-center text-xs shrink-0">📰</div>
                  )}
                  <span>{r.titre}</span>
                </div>
              ),
            },
            {
              key: 'auteur', label: 'Auteur',
              render: (r) => (r.auteur_nom ? <span className="text-sm text-slate-600">{r.auteur_nom} {r.auteur_prenom || ''}</span> : <span className="text-slate-300">—</span>),
            },
            { key: 'created_at', label: 'Créée le', sortable: true, render: (r) => new Date(r.created_at).toLocaleDateString('fr-FR') },
            { key: 'publie', label: 'Statut', render: (r) => <Badge tone={r.publie ? 'green' : 'slate'}>{r.publie ? 'Publiée' : 'Brouillon'}</Badge> },
          ]}
          actions={(a) => (
            <div className="flex items-center justify-end gap-1">
              <button className="btn-ghost !p-1.5" title="Aperçu" onClick={() => setPreviewOpen(a)}>
                <Eye size={15} />
              </button>
              <button className="btn-ghost !p-1.5" title="Modifier" onClick={() => openEdit(a)}>
                <Pencil size={15} />
              </button>
              <button
                className="btn-ghost !p-1.5 text-brand-700" title={a.publie ? 'Dépublier' : 'Publier'}
                onClick={() => togglePublier(a)}
              >
                {a.publie ? <Undo2 size={15} /> : <Send size={15} />}
              </button>
              <button
                className="btn-ghost !p-1.5 text-red-600 border border-red-100 hover:bg-red-50" title="Supprimer"
                onClick={() => remove(a)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Modifier l'actualité" : 'Nouvelle actualité'} wide>
        <form onSubmit={submit} className="space-y-4">
          <div><label className="label">Titre</label><input className="input" required value={form.titre} onChange={set('titre')} /></div>
          <div><label className="label">Contenu</label><textarea className="input" rows={5} required value={form.contenu} onChange={set('contenu')} /></div>
          <ImageField value={form.image_url} onChange={(url) => setForm((f) => ({ ...f, image_url: url }))} />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.publie} onChange={(e) => setForm((f) => ({ ...f, publie: e.target.checked }))} />
            {editing ? 'Publiée' : 'Publier immédiatement'}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(previewOpen)} onClose={() => setPreviewOpen(null)} title="Aperçu" wide>
        {previewOpen && (
          <article className="rounded-xl border border-slate-200 overflow-hidden">
            {previewOpen.image_url && <img src={previewOpen.image_url} alt={previewOpen.titre} className="w-full h-48 object-cover" />}
            <div className="p-5">
              <p className="text-xs text-slate-400 mb-1">
                {new Date(previewOpen.date_publication || previewOpen.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                {previewOpen.auteur_nom && <> · {previewOpen.auteur_nom} {previewOpen.auteur_prenom || ''}</>}
              </p>
              <h2 className="font-semibold text-slate-900 mb-2">{previewOpen.titre}</h2>
              <p className="text-sm text-slate-600 whitespace-pre-line">{previewOpen.contenu}</p>
            </div>
          </article>
        )}
      </Modal>
    </div>
  );
}

// Champ image d'une actualité : upload direct de fichier (recommandé) ou URL manuelle en secours.
function ImageField({ value, onChange }) {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [urlManuelle, setUrlManuelle] = useState(false);

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = new FormData();
    data.append('image', file);
    setBusy(true);
    try {
      const { data: res } = await client.post('/communication/actualites/upload-image', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange(res.image_url);
      toast.success('Image téléversée.');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div>
      <label className="label">Image d&apos;illustration</label>
      {value ? (
        <div className="flex items-center gap-3">
          <img src={value} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200" />
          <button type="button" className="btn-ghost !p-1.5 text-red-600" title="Retirer l'image" onClick={() => onChange('')}>
            <X size={15} />
          </button>
        </div>
      ) : urlManuelle ? (
        <input className="input" placeholder="https://…" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" id="actu-image-input" onChange={onFileChange} disabled={busy} />
          <label
            htmlFor="actu-image-input"
            className={`btn-secondary inline-flex items-center gap-1.5 cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <ImagePlus size={15} /> {busy ? 'Téléversement…' : 'Choisir une image'}
          </label>
        </div>
      )}
      {!value && (
        <button type="button" className="block text-xs text-brand-700 hover:underline mt-1.5" onClick={() => setUrlManuelle((v) => !v)}>
          {urlManuelle ? 'Téléverser un fichier à la place' : 'Utiliser une URL à la place'}
        </button>
      )}
    </div>
  );
}
