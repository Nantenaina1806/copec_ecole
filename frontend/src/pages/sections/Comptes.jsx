import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, ScanFace } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { SectionHeader, Badge, SearchInput } from '../../components/Shared';

const ROLES_AGENT = ['secretaire', 'economie', 'surveillant'];
const ROLE_LABELS = {
  admin: 'Admin',
  enseignant: 'Enseignant',
  secretaire: 'Secrétaire',
  economie: 'Économe',
  surveillant: 'Surveillant',
};

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

export default function Comptes() {
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  const { data: utilisateurs, loading: l1, error: e1, reload: r1 } = useFetch(() => client.get('/utilisateurs').then((r) => r.data), []);
  const { data: agents, loading: l2, error: e2, reload: r2 } = useFetch(() => client.get('/agents').then((r) => r.data), []);

  const comptes = [
    ...(utilisateurs || []).map((u) => ({ ...u, categorie: u.role })),
    ...(agents || []).map((a) => ({ ...a, categorie: a.role_agent, role: a.role_agent })),
  ];

  const comptesAffiches = comptes.filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      const cible = `${c.nom} ${c.prenom || ''} ${c.email}`.toLowerCase();
      if (!cible.includes(q)) return false;
    }
    if (roleFilter && c.categorie !== roleFilter) return false;
    return true;
  });

  const [form, setForm] = useState({ nom: '', prenom: '', email: '', mot_de_passe: '', role: 'enseignant', telephone: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isAgentRole = ROLES_AGENT.includes(form.role);

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (isAgentRole) {
        await client.post('/agents', { ...form, role_agent: form.role });
      } else {
        await client.post('/utilisateurs', form);
      }
      toast.success('Compte créé.');
      setModalOpen(false);
      setForm({ nom: '', prenom: '', email: '', mot_de_passe: '', role: 'enseignant', telephone: '' });
      r1(); r2();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const resetSelfie = async (c) => {
    if (!(await confirm({
      title: 'Réinitialiser la photo de référence',
      message: `${c.prenom || ''} ${c.nom} devra refaire son selfie de référence à la prochaine connexion, et ne pourra plus scanner son pointage avant de l'avoir fait. Continuer ?`,
      danger: true,
    }))) return;
    try {
      await client.put(`/utilisateurs/${c.id}/reset-selfie`);
      toast.success('Photo de référence réinitialisée.');
      r1();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const remove = async (c) => {
    if (!(await confirm({ title: 'Désactiver le compte', message: `Désactiver le compte de ${c.nom} ?`, danger: true }))) return;
    try {
      if (ROLES_AGENT.includes(c.categorie)) await client.delete(`/agents/${c.id}`);
      else await client.delete(`/utilisateurs/${c.id}`);
      toast.success('Compte désactivé.');
      r1(); r2();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div>
      <SectionHeader title="Comptes" subtitle={`${comptesAffiches.length} compte(s)`} action={<button className="btn-primary" onClick={() => setModalOpen(true)}>+ Nouveau compte</button>} />

      <div className="card mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="max-w-xs flex-1 min-w-[10rem]">
            <label className="label">Recherche</label>
            <SearchInput value={search} onChange={setSearch} placeholder="Nom, prénom, email…" />
          </div>
          <div className="w-48">
            <label className="label">Filtrer par rôle</label>
            <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">Tous les rôles</option>
              {Object.entries(ROLE_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>
          {roleFilter && (
            <button className="btn-ghost" onClick={() => setRoleFilter('')}>Réinitialiser</button>
          )}
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={l1 || l2} error={e1 || e2} onRetry={() => { r1(); r2(); }} rows={comptesAffiches}
          pageSize={15}
          columns={[
            {
              key: 'nom', label: 'Nom', sortable: true, sortValue: (r) => `${r.nom} ${r.prenom || ''}`,
              render: (r) => (
                <div className="flex items-center gap-2.5">
                  <Avatar nom={r.nom} prenom={r.prenom} />
                  <span>{r.prenom || ''} {r.nom}</span>
                </div>
              ),
            },
            { key: 'email', label: 'Email' },
            { key: 'role', label: 'Rôle', render: (r) => <Badge tone="brand">{r.role}</Badge> },
            { key: 'telephone', label: 'Téléphone' },
            {
              key: 'created_at', label: 'Créé le', sortable: true,
              render: (r) => (r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'),
            },
            { key: 'actif', label: 'Statut', render: (r) => <Badge tone={r.actif ? 'green' : 'red'}>{r.actif ? 'Actif' : 'Inactif'}</Badge> },
            {
              key: 'selfie', label: 'Selfie (2FA)',
              render: (r) => (r.categorie === 'enseignant' ? (
                <Badge tone={r.compte_confirme ? 'green' : 'amber'}>
                  {r.compte_confirme ? 'Confirmé' : 'En attente'}
                </Badge>
              ) : <span className="text-slate-300 text-xs">—</span>),
            },
          ]}
          actions={(c) => (
            <div className="flex items-center justify-end gap-2">
              {c.categorie === 'enseignant' && (
                <Link to={`/admin/enseignants/${c.id}/espace`} className="btn-secondary !px-3 !py-1.5 text-xs">Profil</Link>
              )}
              {ROLES_AGENT.includes(c.categorie) && (
                <Link to={`/admin/agents/${c.id}/espace`} className="btn-secondary !px-3 !py-1.5 text-xs">Profil</Link>
              )}
              {c.categorie === 'enseignant' && c.compte_confirme && (
                <button
                  className="btn-ghost !px-2 !py-1.5 text-amber-600 border border-amber-100 hover:bg-amber-50"
                  onClick={() => resetSelfie(c)}
                  aria-label={`Réinitialiser la photo de référence de ${c.nom}`}
                  title="Réinitialiser la photo de référence (selfie)"
                >
                  <ScanFace size={15} />
                </button>
              )}
              <button
                className="btn-ghost !px-2 !py-1.5 text-red-600 border border-red-100 hover:bg-red-50"
                onClick={() => remove(c)}
                aria-label={`Désactiver ${c.nom}`}
                title="Désactiver"
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau compte" wide>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
          <div><label className="label">Nom</label><input className="input" required value={form.nom} onChange={set('nom')} /></div>
          <div><label className="label">Prénom</label><input className="input" value={form.prenom} onChange={set('prenom')} /></div>
          <div><label className="label">Email</label><input className="input" type="email" required value={form.email} onChange={set('email')} /></div>
          <div><label className="label">Mot de passe</label><input className="input" type="password" required value={form.mot_de_passe} onChange={set('mot_de_passe')} /></div>
          <div>
            <label className="label">Rôle</label>
            <select className="input" value={form.role} onChange={set('role')}>
              <optgroup label="Personnel principal">
                <option value="admin">Admin</option>
                <option value="enseignant">Enseignant</option>
              </optgroup>
              <optgroup label="Agents">
                <option value="secretaire">Secrétaire</option>
                <option value="economie">Économe</option>
                <option value="surveillant">Surveillant</option>
              </optgroup>
            </select>
          </div>
          <div><label className="label">Téléphone</label><input className="input" value={form.telephone} onChange={set('telephone')} /></div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Créer</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
