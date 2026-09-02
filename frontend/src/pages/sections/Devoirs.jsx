import { useState } from 'react';
import { Pencil, Trash2, Send, Eye, Paperclip } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { getServerToday } from '../../utils/serverClock';
import { useAuth } from '../../context/AuthContext';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { SectionHeader, Badge, SearchInput } from '../../components/Shared';

const FORM_VIDE = { classe_id: '', matiere_id: '', titre: '', consignes: '', date_assignation: getServerToday(), date_limite: '', fichier_url: '' };

// Statut visuel d'un devoir : envoyé / en retard (échéance dépassée, encore brouillon) / brouillon.
function statutDevoir(d) {
  if (d.envoye) return { tone: 'green', label: 'Envoyé' };
  if (d.date_limite && new Date(d.date_limite) < new Date(new Date().toDateString())) return { tone: 'red', label: 'En retard' };
  return { tone: 'amber', label: 'Brouillon' };
}

export default function Devoirs() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // devoir en cours de modification, ou null = création
  const [viewing, setViewing] = useState(null); // devoir affiché en lecture (consignes)
  const [classeId, setClasseId] = useState('');
  const [matiereId, setMatiereId] = useState('');
  const [search, setSearch] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);
  const { data: matieres } = useFetch(() => client.get('/matieres').then((r) => r.data), []);
  const { data: devoirs, loading, error, reload } = useFetch(
    () => client.get('/devoirs', { params: { classe_id: classeId || undefined } }).then((r) => r.data),
    [classeId]
  );

  const devoirsFiltres = devoirs
    ?.filter((d) => !matiereId || String(d.matiere_id) === String(matiereId))
    .filter((d) => !search || d.titre.toLowerCase().includes(search.toLowerCase()));

  const [form, setForm] = useState(FORM_VIDE);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const ouvrirCreation = () => { setEditing(null); setForm(FORM_VIDE); setModalOpen(true); };
  const ouvrirEdition = (d) => {
    setEditing(d);
    setForm({
      classe_id: d.classe_id, matiere_id: d.matiere_id, titre: d.titre,
      consignes: d.consignes || '', date_assignation: d.date_assignation?.slice(0, 10),
      date_limite: d.date_limite ? d.date_limite.slice(0, 10) : '', fichier_url: d.fichier_url || '',
    });
    setModalOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await client.put(`/devoirs/${editing.id}`, form);
        toast.success('Devoir modifié.');
      } else {
        await client.post('/devoirs', form);
        toast.success('Devoir créé.');
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const envoyer = async (d) => {
    const ok = await confirm({
      title: 'Envoyer le devoir',
      message: `Envoyer « ${d.titre} » aux élèves de ${d.classe_nom} ? Cette action est définitive : le devoir ne pourra plus être modifié ni supprimé ensuite.`,
      confirmLabel: 'Envoyer',
    });
    if (!ok) return;
    try {
      await client.put(`/devoirs/${d.id}/envoyer`);
      toast.success('Devoir envoyé aux élèves.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const supprimer = async (d) => {
    const ok = await confirm({
      title: 'Supprimer le devoir',
      message: `Supprimer définitivement « ${d.titre} » ? Cette action est irréversible.`,
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    try {
      await client.delete(`/devoirs/${d.id}`);
      toast.success('Devoir supprimé.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div>
      <SectionHeader title="Devoirs" subtitle={`${devoirsFiltres?.length ?? 0} devoir(s)`} action={<button className="btn-primary" onClick={ouvrirCreation}>+ Nouveau devoir</button>} />

      <div className="card">
        <div className="flex flex-wrap gap-4 mb-4">
          <div className="max-w-xs">
            <label className="label">Filtrer par classe</label>
            <select className="input" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
              <option value="">Toutes les classes</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div className="max-w-xs">
            <label className="label">Filtrer par matière</label>
            <select className="input" value={matiereId} onChange={(e) => setMatiereId(e.target.value)}>
              <option value="">Toutes les matières</option>
              {matieres?.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </div>
          <div className="max-w-xs flex-1">
            <label className="label">Rechercher</label>
            <SearchInput value={search} onChange={setSearch} placeholder="Titre du devoir…" />
          </div>
        </div>
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={devoirsFiltres}
          pageSize={10}
          emptyLabel="Aucun devoir pour le moment."
          columns={[
            { key: 'titre', label: 'Titre', sortable: true },
            { key: 'classe_nom', label: 'Classe', sortable: true },
            { key: 'matiere_nom', label: 'Matière', sortable: true },
            {
              key: 'date_limite', label: 'Date limite', sortable: true,
              render: (r) => r.date_limite ? new Date(r.date_limite).toLocaleDateString('fr-FR') : '—',
            },
            {
              key: 'envoye', label: 'Statut', sortable: true,
              sortValue: (r) => statutDevoir(r).label,
              render: (r) => <Badge tone={statutDevoir(r).tone}>{statutDevoir(r).label}</Badge>,
            },
          ]}
          actions={(d) => (
            <div className="flex justify-end gap-1">
              <button className="btn-ghost !p-1.5" title="Voir les consignes" onClick={() => setViewing(d)}>
                <Eye size={15} />
              </button>
              {!d.envoye && (
                <>
                  <button className="btn-ghost !p-1.5" title="Modifier" onClick={() => ouvrirEdition(d)}>
                    <Pencil size={15} />
                  </button>
                  <button className="btn-ghost !p-1.5 text-brand-700" title="Envoyer aux élèves" onClick={() => envoyer(d)}>
                    <Send size={15} />
                  </button>
                  {isAdmin && (
                    <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(d)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Modifier — ${editing.titre}` : 'Nouveau devoir'} wide>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Classe</label>
            <select className="input" required value={form.classe_id} onChange={set('classe_id')}>
              <option value="">— Choisir —</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Matière</label>
            <select className="input" required value={form.matiere_id} onChange={set('matiere_id')}>
              <option value="">— Choisir —</option>
              {matieres?.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Titre</label>
            <input className="input" required value={form.titre} onChange={set('titre')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Consignes</label>
            <textarea className="input" rows={3} value={form.consignes} onChange={set('consignes')} />
          </div>
          <div>
            <label className="label">Date d&apos;assignation</label>
            <input className="input" type="date" required value={form.date_assignation} onChange={set('date_assignation')} />
          </div>
          <div>
            <label className="label">Date limite</label>
            <input className="input" type="date" value={form.date_limite} onChange={set('date_limite')} min={form.date_assignation} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Fichier joint (lien, optionnel)</label>
            <input className="input" type="url" placeholder="https://…" value={form.fichier_url} onChange={set('fichier_url')} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">{editing ? 'Enregistrer' : 'Créer'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.titre}>
        {viewing && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={statutDevoir(viewing).tone}>{statutDevoir(viewing).label}</Badge>
              <Badge tone="slate">{viewing.classe_nom}</Badge>
              <Badge tone="brand">{viewing.matiere_nom}</Badge>
            </div>
            <p className="text-slate-500">
              Assigné le {new Date(viewing.date_assignation).toLocaleDateString('fr-FR')}
              {viewing.date_limite && <> — à rendre pour le {new Date(viewing.date_limite).toLocaleDateString('fr-FR')}</>}
            </p>
            <p className="whitespace-pre-wrap text-slate-700">{viewing.consignes || <span className="text-slate-400">Aucune consigne détaillée.</span>}</p>
            {viewing.fichier_url && (
              <a href={viewing.fichier_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-brand-700 font-medium hover:underline">
                <Paperclip size={14} /> Voir le fichier joint
              </a>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
