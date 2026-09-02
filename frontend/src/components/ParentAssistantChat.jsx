import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Sparkles } from 'lucide-react';
import client, { apiErrorMessage } from '../api/client';
import { Spinner } from './Feedback';

const SUGGESTIONS = [
  "Tsara ve ny sekoly COPEC ?",
  "Inona no mampiavaka ny COPEC amin'ny sekoly hafa ?",
  "Inona ny sokajy ambaratonga ampianarina eto ?",
  "Ahoana ny fomba fisoratana anarana ho an'ny mpianatra vaovao ?",
];

// Widget de chat flottant public — visible par tous (visiteurs, ray aman-dreny), sans connexion.
// Aucune donnée d'élève, de finance ou de personnel n'est accessible ici (voir assistantPublicService.js
// côté backend). L'historique reste uniquement dans le navigateur : rien n'est persisté côté serveur.
export default function ParentAssistantChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // [{ role: 'user'|'assistant', content }]
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, open]);

  async function envoyer(texte) {
    const contenu = (texte ?? input).trim();
    if (!contenu || loading) return;

    const historiquePourEnvoi = messages.slice(-12);
    setMessages((prev) => [...prev, { role: 'user', content: contenu }]);
    setInput('');
    setError(null);
    setLoading(true);

    try {
      const { data } = await client.post('/assistant-public/chat', {
        message: contenu,
        history: historiquePourEnvoi,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    envoyer();
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 md:right-6 z-40 w-[calc(100vw-2rem)] max-w-sm h-[30rem] max-h-[70vh] flex flex-col card p-0 overflow-hidden animate-risein shadow-card-lg">
          <div className="flex items-center justify-between px-4 py-3 bg-brand-700 text-white shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles size={18} />
              <div>
                <p className="text-sm font-semibold leading-tight">Assistant COPEC</p>
                <p className="text-xs text-brand-100 leading-tight">Ho an&apos;ny ray aman-dreny</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded hover:bg-white/10 transition" aria-label="Fermer l'assistant">
              <X size={18} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50">
            {messages.length === 0 && (
              <div className="text-sm text-slate-500 space-y-3">
                <p>Manontania momba ny sekoly COPEC — tantara, sokajy ambaratonga, fisoratana anarana...</p>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => envoyer(s)}
                      className="text-left text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50 transition"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line animate-fadein ${
                    m.role === 'user'
                      ? 'bg-brand-700 text-white rounded-br-sm'
                      : 'bg-white text-slate-700 border border-slate-200 rounded-bl-sm'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-3 py-2">
                  <Spinner className="h-4 w-4" />
                </div>
              </div>
            )}

            {error && <p className="text-xs text-red-600 px-1">{error}</p>}
          </div>

          <form onSubmit={onSubmit} className="flex items-center gap-2 p-2 border-t border-slate-200 bg-white shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Manoratra eto…"
              maxLength={500}
              className="flex-1 text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-300"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="p-2 rounded-lg bg-brand-700 text-white disabled:opacity-40 hover:bg-brand-800 transition shrink-0"
              aria-label="Envoyer"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 md:right-6 z-40 w-12 h-12 rounded-full bg-brand-700 text-white shadow-card-lg flex items-center justify-center hover:bg-brand-800 transition"
        aria-label={open ? "Fermer l'assistant" : "Ouvrir l'assistant"}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>
    </>
  );
}
