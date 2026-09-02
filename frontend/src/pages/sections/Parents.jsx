import { useMemo, useState } from 'react';
import {
  Pencil, MessageSquare, Trash2, Users, RotateCcw, Link2, Unlink, Plus, ShieldCheck, ShieldOff, Bell, BellOff,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import ImportModal from '../../components/ImportModal';
import StatCard from '../../components/StatCard';
import { SectionHeader, SearchInput, Badge } from '../../components/Shared';
import { printTable } from '../../utils/exportUtils';

const LIBELLE_LIEN = { pere: 'Père', mere: 'Mère', tuteur: 'Tuteur', autre: 'Autre' };
const FORM_LIEN_VIDE = { lien_parente: 'autre', responsable_principal: false, autorise_retrait: true, recoit_notifications: true };

const PARENTS_IMPORT_COLUMNS = [
  { key: 'nom', label: 'Nom', required: true, example: 'Rasoa' },
  { key: 'telephone', label: 'Telephone', required: true, example: '034 00 000 00' },
  { key: 'prenom', label: 'Prenom', example: 'Marie' },
  { key: 'telephone_2', label: 'Telephone 2', example: '' },
  { key: 'email', label: 'Email', example: '' },
  { key: 'profession', label: 'Profession', example: '' },
  { key: 'adresse', label: 'Adresse', example: '' },
  { key: 'eleve_matricule', label: 'Matricule élève', example: '(optionnel — pour lier un enfant)' },
  { key: 'lien_parente', label: 'Lien de parenté', example: 'pere / mere / tuteur / autre' },
];

const PARENTS_EXPORT_COLUMNS = [
  { label: 'Nom', value: (p) => `${p.nom} ${p.prenom || ''}`.trim() },
  { label: 'Téléphone', value: (p) => p.telephone },
  { label: 'Téléphone 2', value: (p) => p.telephone_2 || '' },
  { label: 'Email', value: (p) => p.email || '' },
  { label: 'Profession', value: (p) => p.profession || '' },
  { label: 'Enfants', value: (p) => (p.enfants || []).map((e) => `${e.nom} ${e.prenom || ''}`.trim()).join(', ') },
  { label: 'Statut', value: (p) => (p.actif === false ? 'Inactif' : 'Actif') },
];

function initialesDe(nom, prenom) {
  return `${prenom?.[0] || ''}${nom?.[0] || ''}`.toUpperCase() || '?';
}

function Avatar({ nom, prenom }) {
  return (
    <div className="h-8 w-8 shrink-0 rounded-full bg-brand-800 text-white flex items-center justify-center text-xs font-semibold">
      {initialesDe(nom, prenom)}
    </div>
  );
}

// Recherche d'élève réutilisée pour lier un enfant à un parent (même logique que Vie scolaire).
function useElevesRecherche() {
  const [q, setQ] = useState('');
  const { data: eleves } = useFetch(
    () => (q.length >= 2 ? client.get('/eleves', { params: { search: q } }).then((r) => r.data) : Promise.resolve([])),
    [q]
  );
  return { q, setQ, eleves: eleves || [] };
}

export default function Parents() {
  // Permet d'arriver directement sur le formulaire depuis l'action rapide du tableau de bord
  // (/admin/parents?action=nouveau), même logique que Eleves.jsx et Certificats.jsx.
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isSecretaire = user?.role === 'secretaire';
  // Élargissement du rôle secrétaire (même logique que Examens/Affectations/Vie scolaire) : le
  // secrétariat gère désormais le dossier parent de bout en bout (créer, modifier, désactiver/
  // réactiver, lier/délier un enfant) sans attendre l'admin.
  const peutGerer = isAdmin || isSecretaire;

  const [modalOpen, setModalOpen] = useState(() => searchParams.get('action') === 'nouveau');
  const [importOpen, setImportOpen] = useState(false);
  const [enfantsModalId, setEnfantsModalId] = useState(null);
  const [sousForme, setSousForme] = useState(null); // null | 'nouveau' | objet lien à modifier
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [statutFiltre, setStatutFiltre] = useState('actifs'); // 'actifs' | 'tous' | 'inactifs'
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const fermerModal = () => {
    setModalOpen(false);
    if (searchParams.get('action')) setSearchParams({}, { replace: true });
  };

  const { data: parents, loading, error, reload } = useFetch(() => client.get('/parents').then((r) => r.data), []);
  const enfantsModalParent = (parents || []).find((p) => p.id === enfantsModalId) || null;

  const parentsAffiches = (parents || []).filter((p) => {
    if (statutFiltre === 'actifs' && p.actif === false) return false;
    if (statutFiltre === 'inactifs' && p.actif !== false) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return `${p.nom} ${p.prenom || ''} ${p.telephone} ${p.telephone_2 || ''} ${p.email || ''}`.toLowerCase().includes(q);
  });

  const stats = useMemo(() => {
    const liste = parents || [];
    return {
      total: liste.length,
      actifs: liste.filter((p) => p.actif !== false).length,
      sansEmail: liste.filter((p) => !p.email).length,
      sansEnfant: liste.filter((p) => !(p.enfants || []).length).length,
    };
  }, [parents]);

  const [form, setForm] = useState({ nom: '', prenom: '', telephone: '', telephone_2: '', email: '', profession: '', adresse: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openCreate = () => { setEditing(null); setForm({ nom: '', prenom: '', telephone: '', telephone_2: '', email: '', profession: '', adresse: '' }); setModalOpen(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ nom: p.nom, prenom: p.prenom || '', telephone: p.telephone, telephone_2: p.telephone_2 || '', email: p.email || '', profession: p.profession || '', adresse: p.adresse || '' });
    setModalOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) await client.put(`/parents/${editing.id}`, form);
      else await client.post('/parents', form);
      toast.success(editing ? 'Parent mis à jour.' : 'Parent créé.');
      fermerModal();
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const desactiver = async (p) => {
    if (!(await confirm({ title: 'Désactiver le parent', message: `Désactiver le compte de ${p.nom} ${p.prenom || ''} ? Il ne pourra plus se connecter à l'espace parent tant qu'il n'est pas réactivé.`, danger: true }))) return;
    try {
      await client.delete(`/parents/${p.id}`);
      toast.success('Parent désactivé.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const reactiver = async (p) => {
    try {
      await client.put(`/parents/${p.id}/reactiver`);
      toast.success('Parent réactivé.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const delier = async (eleve) => {
    if (!enfantsModalParent) return;
    if (!(await confirm({ title: "Délier l'élève", message: `Retirer le lien entre ${enfantsModalParent.nom} et ${eleve.nom} ${eleve.prenom || ''} ?`, danger: true }))) return;
    try {
      await client.delete(`/parents/lier/${eleve.eleve_id}/${enfantsModalParent.id}`);
      toast.success('Lien retiré.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const imprimer = () => {
    printTable({
      title: 'Parents / responsables',
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')} — ${parentsAffiches.length} parent(s)`,
      columns: PARENTS_EXPORT_COLUMNS,
      rows: parentsAffiches,
    });
  };

  const exporter = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: PARENTS_EXPORT_COLUMNS, rows: parentsAffiches, filename: 'parents', sheetName: 'Parents' }));
  };

  return (
    <div>
      <SectionHeader
        title="Parents"
        subtitle={`${parentsAffiches.length} parent(s) / responsable(s)`}
        action={peutGerer && <button className="btn-primary" onClick={openCreate}><Plus size={15} className="inline -mt-0.5 mr-1" />Nouveau parent</button>}
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Total parents" value={stats.total} icon="👪" />
        <StatCard label="Actifs" value={stats.actifs} icon="✅" tone="brand" />
        <StatCard label="Sans email" value={stats.sansEmail} icon="✉️" tone={stats.sansEmail ? 'accent' : 'slate'} />
        <StatCard label="Sans enfant lié" value={stats.sansEnfant} icon="⚠️" tone={stats.sansEnfant ? 'red' : 'slate'} />
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="max-w-xs flex-1">
            <label className="label">Rechercher</label>
            <SearchInput value={search} onChange={setSearch} placeholder="Nom, téléphone, email…" />
          </div>
          <div>
            <label className="label">Statut</label>
            <select className="input" value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)}>
              <option value="actifs">Actifs uniquement</option>
              <option value="tous">Tous</option>
              <option value="inactifs">Inactifs uniquement</option>
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            <button className="btn-secondary" onClick={imprimer}>🖨️ Imprimer</button>
            <button className="btn-secondary" onClick={exporter}>📊 Exporter Excel</button>
            {peutGerer && <button className="btn-secondary" onClick={() => setImportOpen(true)}>📥 Importer Excel</button>}
          </div>
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={parentsAffiches}
          pageSize={15}
          emptyLabel="Aucun parent enregistré. Les parents sont aussi créés automatiquement lors de l'inscription d'un élève."
          columns={[
            {
              key: 'nom', label: 'Nom', sortable: true, sortValue: (p) => `${p.nom} ${p.prenom || ''}`,
              render: (p) => (
                <div className="flex items-center gap-2.5">
                  <Avatar nom={p.nom} prenom={p.prenom} />
                  <span>{p.nom} {p.prenom || ''}</span>
                </div>
              ),
            },
            { key: 'telephone', label: 'Téléphone', render: (p) => (
              <div>
                <div>{p.telephone}</div>
                {p.telephone_2 && <div className="text-xs text-slate-400">{p.telephone_2}</div>}
              </div>
            ) },
            { key: 'email', label: 'Email', render: (p) => p.email || '—' },
            { key: 'profession', label: 'Profession', render: (p) => p.profession || '—' },
            {
              key: 'enfants', label: 'Enfants',
              render: (p) => {
                const enfants = p.enfants || [];
                return (
                  <button className="btn-ghost !px-2 !py-1 text-xs text-brand-700" onClick={() => setEnfantsModalId(p.id)}>
                    {enfants.length ? `${enfants.length} élève${enfants.length > 1 ? 's' : ''}` : 'Aucun — lier'}
                  </button>
                );
              },
            },
            { key: 'actif', label: 'Statut', render: (p) => <Badge tone={p.actif === false ? 'red' : 'green'}>{p.actif === false ? 'Inactif' : 'Actif'}</Badge> },
          ]}
          actions={(p) => (
            <div className="flex justify-end gap-1">
              {peutGerer && (
                <button className="btn-ghost !p-1.5" title="Modifier" onClick={() => openEdit(p)}>
                  <Pencil size={15} />
                </button>
              )}
              <button
                className="btn-ghost !p-1.5 text-brand-700" title="Envoyer un message"
                onClick={() => navigate(`/admin/messagerie?parent_id=${p.id}`)}
              >
                <MessageSquare size={15} />
              </button>
              {peutGerer && (p.actif === false ? (
                <button
                  className="btn-ghost !p-1.5 text-emerald-700 border border-emerald-100 hover:bg-emerald-50" title="Réactiver"
                  onClick={() => reactiver(p)}
                >
                  <RotateCcw size={15} />
                </button>
              ) : (
                <button
                  className="btn-ghost !p-1.5 text-red-600 border border-red-100 hover:bg-red-50" title="Désactiver"
                  onClick={() => desactiver(p)}
                >
                  <Trash2 size={15} />
                </button>
              ))}
            </div>
          )}
        />
      </div>

      <Modal
        open={Boolean(enfantsModalParent)}
        onClose={() => { setEnfantsModalId(null); setSousForme(null); }}
        title={enfantsModalParent ? `Enfants de ${enfantsModalParent.nom} ${enfantsModalParent.prenom || ''}` : ''}
        wide
      >
        {enfantsModalParent && (
          sousForme ? (
            <LierEnfantForm
              parent={enfantsModalParent}
              lienExistant={sousForme === 'nouveau' ? null : sousForme}
              enfantsDejaLies={enfantsModalParent.enfants || []}
              onAnnuler={() => setSousForme(null)}
              onSauvegarde={() => { setSousForme(null); reload(); }}
            />
          ) : (
            <div className="space-y-3">
              {peutGerer && (
                <button className="btn-primary w-full justify-center" onClick={() => setSousForme('nouveau')}>
                  <Link2 size={15} className="inline -mt-0.5 mr-1" /> Lier un enfant
                </button>
              )}
              <div className="space-y-2">
                {(enfantsModalParent.enfants || []).length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-4">Aucun enfant lié à ce parent pour le moment.</p>
                )}
                {(enfantsModalParent.enfants || []).map((e) => (
                  <div key={e.eleve_id} className="rounded-lg border border-slate-200 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        className="flex items-center gap-2.5 text-left hover:underline"
                        onClick={() => { setEnfantsModalId(null); navigate(`/admin/eleves/${e.eleve_id}`); }}
                      >
                        <div className="h-7 w-7 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                          <Users size={13} />
                        </div>
                        <span>{e.nom} {e.prenom || ''}</span>
                      </button>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {e.responsable_principal && <Badge tone="green">Principal</Badge>}
                        <Badge tone="brand">{LIBELLE_LIEN[e.lien_parente] || e.lien_parente}</Badge>
                        {peutGerer && (
                          <>
                            <button className="btn-ghost !p-1.5" title="Modifier le lien" onClick={() => setSousForme(e)}>
                              <Pencil size={13} />
                            </button>
                            <button className="btn-ghost !p-1.5 text-red-600" title="Délier" onClick={() => delier(e)}>
                              <Unlink size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2 pl-9">
                      {e.autorise_retrait === false ? (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600"><ShieldOff size={12} /> Retrait non autorisé</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500"><ShieldCheck size={12} /> Autorisé à récupérer l&apos;élève</span>
                      )}
                      {e.recoit_notifications === false ? (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600"><BellOff size={12} /> Ne reçoit pas les notifications</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Bell size={12} /> Reçoit les notifications</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </Modal>

      <Modal open={modalOpen} onClose={fermerModal} title={editing ? 'Modifier le parent' : 'Nouveau parent'} wide>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
          <div><label className="label">Nom</label><input className="input" required value={form.nom} onChange={set('nom')} /></div>
          <div><label className="label">Prénom</label><input className="input" value={form.prenom} onChange={set('prenom')} /></div>
          <div><label className="label">Téléphone</label><input className="input" required value={form.telephone} onChange={set('telephone')} /></div>
          <div><label className="label">Téléphone (2)</label><input className="input" value={form.telephone_2} onChange={set('telephone_2')} /></div>
          <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={set('email')} /></div>
          <div><label className="label">Profession</label><input className="input" value={form.profession} onChange={set('profession')} /></div>
          <div className="sm:col-span-2"><label className="label">Adresse</label><input className="input" value={form.adresse} onChange={set('adresse')} /></div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={fermerModal}>Annuler</button>
            <button type="submit" className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/parents/import"
        title="Importer des parents depuis Excel"
        columns={PARENTS_IMPORT_COLUMNS}
        filenamePrefix="parents"
        onImported={reload}
      />
    </div>
  );
}

// Formulaire de liaison élève ↔ parent : sert à la fois pour créer un nouveau lien et pour
// modifier un lien existant (POST /parents/lier fait un upsert des deux côtés).
function LierEnfantForm({ parent, lienExistant, enfantsDejaLies, onAnnuler, onSauvegarde }) {
  const toast = useToast();
  const { q, setQ, eleves } = useElevesRecherche();
  const idsDejaLies = new Set(enfantsDejaLies.map((e) => e.eleve_id));
  const [eleveId, setEleveId] = useState(lienExistant?.eleve_id || '');
  const [form, setForm] = useState(lienExistant
    ? {
      lien_parente: lienExistant.lien_parente,
      responsable_principal: Boolean(lienExistant.responsable_principal),
      autorise_retrait: lienExistant.autorise_retrait !== false,
      recoit_notifications: lienExistant.recoit_notifications !== false,
    }
    : FORM_LIEN_VIDE);
  const [saving, setSaving] = useState(false);

  const eleveChoisi = lienExistant
    ? { nom: lienExistant.nom, prenom: lienExistant.prenom }
    : eleves.find((e) => String(e.id) === String(eleveId));

  const submit = async (e) => {
    e.preventDefault();
    if (!eleveId) { toast.error('Choisissez un élève.'); return; }
    setSaving(true);
    try {
      await client.post('/parents/lier', {
        eleve_id: eleveId,
        parent_id: parent.id,
        lien_parente: form.lien_parente,
        responsable_principal: form.responsable_principal,
        autorise_retrait: form.autorise_retrait,
        recoit_notifications: form.recoit_notifications,
      });
      toast.success(lienExistant ? 'Lien mis à jour.' : 'Élève lié au parent.');
      onSauvegarde();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Élève</label>
        {lienExistant ? (
          <div className="input !py-2 bg-slate-50">{eleveChoisi?.nom} {eleveChoisi?.prenom || ''}</div>
        ) : eleveId ? (
          <div className="flex items-center justify-between input !py-2">
            <span>{eleveChoisi ? `${eleveChoisi.nom} ${eleveChoisi.prenom || ''}` : 'Élève sélectionné'}</span>
            <button type="button" className="text-xs text-brand-700" onClick={() => setEleveId('')}>Changer</button>
          </div>
        ) : (
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Rechercher un élève (nom, matricule)…" />
            {eleves.length > 0 && (
              <div className="mt-1 border border-slate-100 rounded-lg max-h-40 overflow-y-auto">
                {eleves.map((el) => (
                  <button
                    type="button" key={el.id}
                    disabled={idsDejaLies.has(el.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between"
                    onClick={() => { setEleveId(el.id); setQ(''); }}
                  >
                    <span>{el.nom} {el.prenom} — {el.matricule}</span>
                    {idsDejaLies.has(el.id) && <span className="text-xs text-slate-400">déjà lié</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <label className="label">Lien de parenté</label>
        <select className="input" value={form.lien_parente} onChange={(e) => setForm((f) => ({ ...f, lien_parente: e.target.value }))}>
          {Object.entries(LIBELLE_LIEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.responsable_principal} onChange={(e) => setForm((f) => ({ ...f, responsable_principal: e.target.checked }))} />
          Responsable principal (contact prioritaire)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.autorise_retrait} onChange={(e) => setForm((f) => ({ ...f, autorise_retrait: e.target.checked }))} />
          Autorisé à récupérer l&apos;élève (sorties, fin de journée…)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.recoit_notifications} onChange={(e) => setForm((f) => ({ ...f, recoit_notifications: e.target.checked }))} />
          Reçoit les notifications (SMS/messagerie de l&apos;école)
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-ghost" onClick={onAnnuler}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={saving}>{lienExistant ? 'Mettre à jour' : 'Lier'}</button>
      </div>
    </form>
  );
}
