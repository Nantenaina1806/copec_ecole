import { useMemo, useState } from 'react';
import { ShieldCheck, Save, RefreshCw } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { SectionHeader } from '../../components/Shared';
import { Spinner } from '../../components/Feedback';

const ROLES = ['enseignant','secretaire','economie','surveillant','accueil'];

export default function Permissions() {
  const toast = useToast();
  const { data, loading, reload } = useFetch(() => client.get('/permissions').then((r) => r.data), []);
  const permissions = data || [];
  const [role, setRole] = useState('secretaire');
  const [selected, setSelected] = useState([]);
  const [savedRole, setSavedRole] = useState('');
  const [busy, setBusy] = useState(false);
  const byModule = useMemo(() => permissions.reduce((acc, p) => { (acc[p.module] ||= []).push(p); return acc; }, {}), [permissions]);
  const rolePerms = permissions.filter((p) => (p.roles || []).includes(role)).map((p) => p.code);
  const effective = savedRole === role ? selected : rolePerms;
  function toggle(code) { setSavedRole(role); setSelected((prev) => { const base = savedRole === role ? prev : rolePerms; return base.includes(code) ? base.filter((x) => x !== code) : [...base, code]; }); }
  async function save() { setBusy(true); try { await client.put(`/permissions/role/${role}`, { permissions: effective }); toast.success('Permissions enregistrées.'); setSavedRole(role); setSelected(effective); reload(); } catch (err) { toast.error(apiErrorMessage(err)); } finally { setBusy(false); } }

  return <div className="page-shell"><SectionHeader title="Permissions" subtitle="Contrôlez finement les capacités de chaque rôle. L'administrateur conserve tous les droits." />
    <div className="card">
      <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between mb-6"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-xl bg-brand-50 text-brand-800 flex items-center justify-center"><ShieldCheck size={19} /></div><div><p className="font-bold">Droits par rôle</p><p className="text-xs text-slate-400">Les changements sont appliqués côté serveur après enregistrement.</p></div></div><div className="flex gap-2"><select className="input md:w-52" value={role} onChange={(e) => { setRole(e.target.value); setSavedRole(''); }}><option value="enseignant">Enseignant</option><option value="secretaire">Secrétaire</option><option value="economie">Économe</option><option value="surveillant">Surveillant</option><option value="accueil">Accueil</option></select><button className="btn-secondary" onClick={reload}><RefreshCw size={15} /></button><button className="btn-primary" disabled={loading || busy} onClick={save}>{busy ? <Spinner className="h-4 w-4" /> : <Save size={15} />} Enregistrer</button></div></div>
      {loading ? <div className="py-10 text-center text-sm text-slate-400">Chargement…</div> : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{Object.entries(byModule).map(([module, list]) => <div key={module} className="rounded-2xl border border-slate-200 p-4"><p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-3">{module.replace('_',' ')}</p><div className="space-y-2">{list.map((p) => <label key={p.code} className="flex items-start gap-3 rounded-xl p-2 hover:bg-slate-50 cursor-pointer"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={effective.includes(p.code)} onChange={() => toggle(p.code)} /><span><span className="block text-sm font-medium text-slate-800">{p.libelle}</span><span className="block text-[10px] text-slate-400 font-mono">{p.code}</span></span></label>)}</div></div>)}</div>}
    </div>
  </div>;
}
