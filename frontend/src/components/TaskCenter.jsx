import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, ClipboardList, X, AlertTriangle, Wallet, UserPlus, CalendarClock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';

const TASKS = {
  admin: (d) => [
    !d?.annee_scolaire && { tone:'danger', icon:AlertTriangle, title:'Activer l’année scolaire', text:'Les données métier dépendent de l’année active.', to:'/admin/annee-scolaire' },
    d?.eleves_non_inscrits?.length > 0 && { tone:'warning', icon:UserPlus, title:`${d.eleves_non_inscrits.length} élève(s) à inscrire`, text:'Finaliser les inscriptions en attente.', to:'/admin/eleves' },
    d?.eleves_impayes?.length > 0 && { tone:'warning', icon:Wallet, title:`${d.eleves_impayes.length} impayé(s) à traiter`, text:'Ouvrir le suivi financier.', to:'/admin/finances' },
    { tone:'normal', icon:CalendarClock, title:'Vérifier l’emploi du temps', text:'Accéder directement au générateur et aux conflits.', to:'/admin/emploi-du-temps' },
  ].filter(Boolean),
  secretaire: (d) => [
    d?.eleves_non_inscrits?.length > 0 && { tone:'warning', icon:UserPlus, title:`${d.eleves_non_inscrits.length} inscription(s)`, text:'Finaliser les dossiers élèves.', to:'/admin/eleves' },
    { tone:'normal', icon:ClipboardList, title:'Contrôler les dossiers', text:'Ouvrir la gestion des élèves et documents.', to:'/admin/eleves' },
    { tone:'normal', icon:CalendarClock, title:'Vérifier les événements', text:'Consulter les examens et le planning.', to:'/admin/examens' },
  ].filter(Boolean),
  economie: (d) => [
    d?.eleves_impayes?.length > 0 && { tone:'warning', icon:Wallet, title:`${d.eleves_impayes.length} impayé(s)`, text:'Traiter les relances prioritaires.', to:'/admin/finances' },
    { tone:'normal', icon:Wallet, title:'Contrôler les encaissements', text:'Ouvrir le suivi financier.', to:'/admin/finances' },
    { tone:'normal', icon:ClipboardList, title:'Préparer la paie', text:'Vérifier les éléments de paie enseignants.', to:'/admin/paie' },
  ].filter(Boolean),
  surveillant: () => [
    { tone:'normal', icon:ClipboardList, title:'Valider les présences', text:'Traiter les pointages à vérifier.', to:'/admin/presences?tab=validation' },
    { tone:'normal', icon:AlertTriangle, title:'Contrôler la vie scolaire', text:'Consulter les incidents et suivis.', to:'/admin/vie-scolaire' },
  ],
  enseignant: () => [
    { tone:'normal', icon:ClipboardList, title:'Faire l’appel', text:'Accéder à votre classe du jour.', to:'/mon-espace?tab=appel' },
    { tone:'normal', icon:CheckCircle2, title:'Saisir les notes', text:'Ouvrir la saisie de notes.', to:'/mon-espace?tab=note' },
    { tone:'normal', icon:CalendarClock, title:'Voir mon emploi du temps', text:'Consulter les cours planifiés.', to:'/mon-espace?tab=edt' },
  ],
  accueil: () => [
    { tone:'normal', icon:UserPlus, title:'Enregistrer un visiteur', text:'Ouvrir le registre d’accueil.', to:'/admin/visiteurs' },
  ],
};

export default function TaskCenter() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('copec:focus-tasks', onOpen);
    return () => window.removeEventListener('copec:focus-tasks', onOpen);
  }, []);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    client.get('/dashboard').then((r) => { if (!cancelled) setData(r.data); }).catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [open, user]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    if (open) { document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }
    return undefined;
  }, [open]);

  if (!open) return null;
  const tasks = (TASKS[user?.role] || TASKS.admin)(data);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px] p-3 sm:p-5 flex items-end sm:items-center justify-center" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <section className="w-full max-w-2xl max-h-[88dvh] overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-2xl animate-risein" role="dialog" aria-modal="true" aria-labelledby="task-center-title">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-start gap-3">
          <div className="h-11 w-11 rounded-2xl bg-brand-50 text-brand-700 grid place-items-center shrink-0"><ClipboardList size={20} /></div>
          <div className="min-w-0 flex-1"><p className="section-kicker">Productivité</p><h2 id="task-center-title" className="font-display text-xl font-extrabold text-slate-900">Centre de tâches</h2><p className="text-xs text-slate-500 mt-1">Les actions les plus utiles sont regroupées ici selon votre rôle.</p></div>
          <button type="button" onClick={() => setOpen(false)} className="h-10 w-10 rounded-xl border border-slate-200 grid place-items-center text-slate-500 hover:bg-slate-50" aria-label="Fermer"><X size={18}/></button>
        </div>
        <div className="p-3 sm:p-5 overflow-y-auto max-h-[calc(88dvh-90px)] space-y-2.5">
          {tasks.map(({tone, icon:Icon, title, text, to}) => (
            <Link key={title} to={to} onClick={() => setOpen(false)} className="group flex items-center gap-3 rounded-2xl border border-slate-200 p-3.5 hover:border-brand-200 hover:bg-brand-50/40 transition-colors">
              <div className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 ${tone === 'danger' ? 'bg-red-50 text-red-600' : tone === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-brand-700'}`}><Icon size={18}/></div>
              <div className="min-w-0 flex-1"><p className="text-sm font-bold text-slate-800">{title}</p><p className="text-xs text-slate-500 mt-0.5">{text}</p></div>
              <ArrowRight size={17} className="text-slate-300 group-hover:text-brand-600 shrink-0" />
            </Link>
          ))}
          {!tasks.length && <div className="py-10 text-center"><CheckCircle2 size={32} className="mx-auto text-emerald-500"/><p className="mt-3 font-bold text-slate-800">Tout est à jour</p><p className="text-xs text-slate-500 mt-1">Aucune action prioritaire détectée.</p></div>}
        </div>
      </section>
    </div>
  );
}
