import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useEcole } from '../context/EcoleContext';
import { useToast } from '../context/ToastContext';
import { Spinner } from '../components/Feedback';

const STAFF_ROLES = ['admin', 'enseignant', 'secretaire', 'economie', 'surveillant', 'accueil'];

export default function Login() {
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { loginStaff } = useAuth();
  const ecole = useEcole();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const redirectAfterLogin = (user) => {
    const from = location.state?.from;
    if (from) return navigate(from, { replace: true });
    if (STAFF_ROLES.includes(user.role)) return navigate('/admin', { replace: true });
    navigate('/actualites', { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await loginStaff(email, motDePasse);
      toast.success(`Bienvenue, ${user.prenom || user.nom} !`);
      redirectAfterLogin(user);
    } catch (err) {
      toast.error(err.message || 'Mot de passe ou email incorrect.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 flex items-center justify-center p-4 md:p-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(33,92,148,.12),transparent_28%),radial-gradient(circle_at_90%_90%,rgba(217,154,63,.14),transparent_26%)] pointer-events-none" />
      <div className="relative grid w-full max-w-6xl overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(18,45,82,.14)] lg:grid-cols-[1.05fr_.95fr]">
        <div className="hidden lg:flex relative overflow-hidden bg-brand-950 p-11 text-white flex-col justify-between">
          <div className="absolute inset-0 bg-terrace opacity-60 pointer-events-none" />
          <div className="relative">
            <div className="h-14 w-14 rounded-2xl bg-white p-1.5 shadow-lg overflow-hidden"><img src={ecole.logo_url || '/logo.jpg'} alt={ecole.nom_ecole} className="h-full w-full object-contain" /></div>
            <p className="mt-8 text-[11px] font-bold uppercase tracking-[0.2em] text-accent-400">Plateforme de gestion scolaire</p>
            <h1 className="mt-3 font-display text-[2.7rem] font-extrabold tracking-tight leading-tight">Pilotez votre établissement avec clarté.</h1>
            <p className="mt-5 max-w-md text-sm leading-6 text-brand-200">Scolarité, présence, finance, paie et documents réunis dans un seul espace de travail.</p>
          </div>
          <div className="relative grid grid-cols-3 gap-3 text-xs">
            {[['Scolarité','Élèves & notes'],['Finance','Paiements & paie'],['Pilotage','Rapports & audit']].map(([a,b]) => <div key={a} className="rounded-2xl border border-white/10 bg-white/5 p-3"><p className="font-bold text-white">{a}</p><p className="mt-1 text-brand-300">{b}</p></div>)}
          </div>
        </div>

        <div className="p-6 sm:p-10 lg:p-12">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="h-11 w-11 rounded-xl bg-white border border-slate-200 p-1 overflow-hidden"><img src={ecole.logo_url || '/logo.jpg'} alt={ecole.nom_ecole} className="h-full w-full object-contain" /></div>
            <div><p className="font-display font-extrabold text-slate-900">{ecole.nom_ecole}</p><p className="text-[10px] uppercase tracking-wider text-slate-400">Gestion scolaire</p></div>
          </div>
          <div className="mb-8">
            <p className="section-kicker">Espace sécurisé</p>
            <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-slate-900">Bienvenue</h2>
            <p className="mt-2 text-sm text-slate-500">Connectez-vous pour accéder à votre espace de gestion.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div><label className="label">Adresse e-mail</label><input className="input h-12" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@ecole.mg" /></div>
            <div><div className="flex items-center justify-between"><label className="label mb-1">Mot de passe</label><a href="/mot-de-passe-oublie" className="text-xs font-bold text-brand-700 hover:underline">Mot de passe oublié ?</a></div><div className="relative"><input className="input h-12 pr-11" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} placeholder="••••••••" /><button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-700" aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
            <button type="submit" disabled={loading} className="btn-primary w-full h-12 rounded-xl text-sm shadow-lg shadow-brand-800/15">{loading ? <Spinner className="text-white h-4 w-4" /> : 'Se connecter'}</button>
          </form>
          <div className="mt-8 border-t border-slate-100 pt-5 flex items-center justify-between gap-3"><p className="text-[11px] text-slate-400">Accès réservé au personnel autorisé.</p><a href="/actualites" className="text-xs font-bold text-brand-700 hover:underline">Actualités publiques</a></div>
        </div>
      </div>
    </div>
  );
}
