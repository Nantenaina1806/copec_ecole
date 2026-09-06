import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useFetch } from '../hooks/useFetch';
import { useEcole } from '../context/EcoleContext';
import { LoadingScreen, ErrorState } from '../components/Feedback';
import ParentAssistantChat from '../components/ParentAssistantChat';

import { toArray } from '../utils/array';

export default function Actualites() {
  const navigate = useNavigate();
  const ecole = useEcole();
  const { data: rawActus, loading, error, reload } = useFetch(
    () => client.get('/communication/actualites/public').then((r) => r.data),
    []
  );
  const actus = toArray(rawActus);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-brand-950 text-white">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-accent-500 flex items-center justify-center font-bold text-brand-950">{ecole.nom_ecole?.charAt(0) || 'C'}</div>
            <div>
              <p className="font-bold text-sm leading-tight">{ecole.nom_ecole}</p>
              <p className="text-[11px] text-brand-300">Actualités de l&apos;école</p>
            </div>
          </div>
          <button className="btn-primary bg-accent-500 hover:bg-accent-600" onClick={() => navigate('/login')}>
            Espace connecté
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-6">Actualités</h1>

        {loading && <LoadingScreen />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (!actus || actus.length === 0) && (
          <div className="text-center py-16 text-slate-400">Aucune actualité publiée pour le moment.</div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          {actus?.map((a) => (
            <article key={a.id} className="card overflow-hidden !p-0">
              {a.image_url && <img src={a.image_url} alt={a.titre} className="w-full h-40 object-cover" />}
              <div className="p-5">
                <p className="text-xs text-slate-400 mb-1">
                  {new Date(a.date_publication || a.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <h2 className="font-semibold text-slate-900 mb-2">{a.titre}</h2>
                <p className="text-sm text-slate-600 line-clamp-4 whitespace-pre-line">{a.contenu}</p>
              </div>
            </article>
          ))}
        </div>
      </main>

      <ParentAssistantChat />
    </div>
  );
}
