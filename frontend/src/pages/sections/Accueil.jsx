import { useMemo, useState } from 'react';
import { UserPlus, LogOut, Search, Clock3, Users, RefreshCw } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Spinner } from '../../components/Feedback';

const empty = { nom: '', prenom: '', telephone: '', motif: '', personne_visitee: '', badge: '', observation: '' };

export default function Accueil() {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const { data, reload, loading } = useFetch(() => client.get('/visiteurs').then((r) => r.data), []);
  const visitors = data || [];
  const visibles = useMemo(() => visitors.filter((v) => `${v.nom} ${v.prenom || ''} ${v.telephone || ''} ${v.personne_visitee || ''} ${v.motif}`.toLowerCase().includes(query.toLowerCase())), [visitors, query]);
  const presents = visitors.filter((v) => v.statut === 'present').length;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); setSaving(true);
    try { await client.post('/visiteurs', form); setForm(empty); toast.success('Visiteur enregistré.'); reload(); }
    catch (err) { toast.error(apiErrorMessage(err)); }
    finally { setSaving(false); }
  }
  async function sortie(id) {
    try { await client.put(`/visiteurs/${id}/sortie`, {}); toast.success('Sortie enregistrée.'); reload(); }
    catch (err) { toast.error(apiErrorMessage(err)); }
  }

  return <div className="page-shell space-y-6">
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div><p className="section-kicker">Accueil</p><h2 className="heading text-2xl md:text-3xl mt-1">Registre des visiteurs</h2><p className="text-sm text-slate-500 mt-1">Enregistrez les entrées, suivez les personnes présentes et clôturez leur visite.</p></div>
      <div className="flex items-center gap-2"><span className="badge bg-emerald-50 text-emerald-700"><Users size={13} className="mr-1" /> {presents} présent{presents > 1 ? 's' : ''}</span><button className="btn-secondary" onClick={reload}><RefreshCw size={15} /> Actualiser</button></div>
    </div>

    <div className="grid xl:grid-cols-[420px_1fr] gap-5">
      <form onSubmit={submit} className="card space-y-4">
        <div className="flex items-center gap-2"><div className="h-9 w-9 rounded-xl bg-brand-50 text-brand-800 flex items-center justify-center"><UserPlus size={17} /></div><div><h3 className="font-bold text-slate-900">Nouvelle visite</h3><p className="text-xs text-slate-400">Agent : {user?.prenom} {user?.nom}</p></div></div>
        <div className="grid grid-cols-2 gap-3"><div><label className="label">Nom *</label><input className="input" required value={form.nom} onChange={set('nom')} /></div><div><label className="label">Prénom</label><input className="input" value={form.prenom} onChange={set('prenom')} /></div></div>
        <div><label className="label">Téléphone</label><input className="input" value={form.telephone} onChange={set('telephone')} /></div>
        <div><label className="label">Motif *</label><input className="input" required value={form.motif} onChange={set('motif')} placeholder="Rendez-vous, parent, fournisseur…" /></div>
        <div><label className="label">Personne visitée</label><input className="input" value={form.personne_visitee} onChange={set('personne_visitee')} placeholder="Nom de l'enseignant / service" /></div>
        <div><label className="label">Badge / référence</label><input className="input" value={form.badge} onChange={set('badge')} /></div>
        <div><label className="label">Observation</label><textarea className="input min-h-20" value={form.observation} onChange={set('observation')} /></div>
        <button className="btn-primary w-full" disabled={saving}>{saving ? <Spinner className="h-4 w-4" /> : <UserPlus size={16} />} Enregistrer l'entrée</button>
      </form>

      <section className="card min-w-0">
        <div className="flex flex-col sm:flex-row gap-3 justify-between mb-4"><div><h3 className="font-bold text-slate-900">Journal des visites</h3><p className="text-xs text-slate-400">Historique récent et visiteurs actuellement présents.</p></div><div className="relative w-full sm:w-72"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher…" /></div></div>
        {loading ? <div className="py-12 flex justify-center"><Spinner /></div> : visibles.length === 0 ? <div className="py-12 text-center text-sm text-slate-400">Aucune visite enregistrée.</div> : <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Visiteur</th><th>Motif</th><th>Entrée</th><th>Statut</th><th className="text-right">Action</th></tr></thead><tbody>{visibles.map((v) => <tr key={v.id}><td><p className="font-semibold">{v.prenom} {v.nom}</p><p className="text-xs text-slate-400">{v.telephone || '—'} · {v.personne_visitee || '—'}</p></td><td>{v.motif}</td><td><span className="inline-flex items-center gap-1 text-xs"><Clock3 size={13} />{new Date(v.heure_entree).toLocaleString('fr-FR')}</span></td><td><span className={`badge ${v.statut === 'present' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{v.statut === 'present' ? 'Présent' : 'Sorti'}</span></td><td className="text-right">{v.statut === 'present' && <button className="btn-ghost text-xs" onClick={() => sortie(v.id)}><LogOut size={14} /> Enregistrer la sortie</button>}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  </div>;
}
