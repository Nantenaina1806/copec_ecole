import { useState } from 'react';
import { Link } from 'react-router-dom';
import client, { apiErrorMessage } from '../api/client';

export default function ForgotPassword() {
  const [email,setEmail]=useState(''); const [loading,setLoading]=useState(false); const [done,setDone]=useState(false); const [error,setError]=useState('');
  const submit=async(e)=>{e.preventDefault();setLoading(true);setError('');try{await client.post('/auth/reset-password/request',{email});setDone(true);}catch(err){setError(apiErrorMessage(err));}finally{setLoading(false);}};
  return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-5"><div className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-xl p-8"><p className="section-kicker">Sécurité COPEC</p><h1 className="font-display text-3xl font-extrabold mt-2">Mot de passe oublié</h1>{done?<div className="mt-6 rounded-2xl bg-emerald-50 text-emerald-800 p-4 text-sm">Si cette adresse correspond à un compte actif, un lien de réinitialisation a été envoyé. Vérifiez aussi les courriers indésirables.</div>:<form onSubmit={submit} className="mt-7 space-y-5"><div><label className="label">Adresse e-mail</label><input className="input h-12" type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></div>{error&&<p className="text-sm text-red-600">{error}</p>}<button className="btn-primary w-full h-12" disabled={loading}>{loading?'Envoi…':'Envoyer le lien de récupération'}</button></form>}<Link className="block mt-6 text-sm font-bold text-brand-700" to="/login">← Retour à la connexion</Link></div></div>;
}
