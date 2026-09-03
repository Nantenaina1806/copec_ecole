import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageCircle, X, Send, Sparkles, Mic, MicOff, Trash2, Check,
  BarChart3, WalletCards, CalendarDays, TriangleAlert, Users, ShieldCheck,
  Clock3, ArrowUpRight
} from 'lucide-react';
import client, { apiErrorMessage } from '../api/client';
import { Spinner } from './Feedback';

const QUICK_ACTIONS = [
  { label: 'Situation de l’école', prompt: 'Donne-moi la situation générale de l’école aujourd’hui.', icon: BarChart3 },
  { label: 'Finances', prompt: 'Analyse la situation financière actuelle de l’école et signale les points à vérifier.', icon: WalletCards },
  { label: 'Emploi du temps', prompt: 'Contrôle l’emploi du temps et dis-moi s’il existe des conflits ou des heures non cohérentes.', icon: CalendarDays },
  { label: 'Élèves', prompt: 'Donne-moi les indicateurs importants sur les élèves et les absences aujourd’hui.', icon: Users },
  { label: 'Enseignants', prompt: 'Donne-moi la situation des enseignants, leurs absences et les points importants à vérifier.', icon: Clock3 },
  { label: 'Anomalies', prompt: 'Fais une surveillance des anomalies des 30 derniers jours et présente uniquement les signaux factuels à vérifier.', icon: TriangleAlert },
];

const WELCOME = `Je suis le copilote de gestion de COPEC. Je peux analyser les élèves, enseignants, emploi du temps, présences, notes, finances, paie et audit à partir des données réelles de l’école.`;

function formatMessage(content) {
  return String(content || '').trim();
}

export default function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [messages, setMessages] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ecoute, setEcoute] = useState(false);
  const [error, setError] = useState(null);
  const [busyAction, setBusyAction] = useState(false);
  const [aiStatus, setAiStatus] = useState({ loading: false, configured: null, fallback: false });
  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, pendingAction, open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setAiStatus((s) => ({ ...s, loading: true }));
    client.get('/assistant/statut')
      .then(({ data }) => { if (active) setAiStatus({ loading: false, configured: !!data.configured, fallback: false, model: data.model }); })
      .catch(() => { if (active) setAiStatus({ loading: false, configured: null, fallback: true }); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open || historyLoaded) return;
    (async () => {
      try {
        const { data } = await client.get('/assistant/historique');
        setMessages(Array.isArray(data) ? data : []);
      } catch {
        setError('Historique indisponible. Une nouvelle conversation peut quand même être démarrée.');
      } finally {
        setHistoryLoaded(true);
      }
    })();
  }, [open, historyLoaded]);

  async function envoyer(texte) {
    const contenu = (texte ?? input).trim();
    if (!contenu || loading) return;
    setMessages((prev) => [...prev, { role: 'user', content: contenu }]);
    setInput('');
    setError(null);
    setPendingAction(null);
    setLoading(true);
    try {
      const { data } = await client.post('/assistant/chat', { message: contenu });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      if (data.pending_action) setPendingAction(data.pending_action);
      if (data.fallback) setAiStatus((s) => ({ ...s, fallback: true }));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function confirmerAction() {
    if (!pendingAction || loading || busyAction) return;
    setBusyAction(true);
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.post('/assistant/executer', {
        tool: pendingAction.tool,
        args: pendingAction.args,
        confirmation_token: pendingAction.confirmation_token,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${apiErrorMessage(err)}` }]);
    } finally {
      setPendingAction(null);
      setBusyAction(false);
      setLoading(false);
    }
  }

  function annulerAction() {
    setMessages((prev) => [...prev, { role: 'assistant', content: 'Action annulée. Aucune modification n’a été effectuée.' }]);
    setPendingAction(null);
  }

  async function effacerHistorique() {
    if (loading) return;
    try { await client.delete('/assistant/historique'); } catch { /* local reset anyway */ }
    setMessages([]);
    setPendingAction(null);
    setError(null);
  }

  const toggleMic = useCallback(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError("La saisie vocale n'est pas prise en charge par ce navigateur.");
      return;
    }
    if (ecoute) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'fr-FR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      const texte = e.results?.[0]?.[0]?.transcript || '';
      if (texte) setInput((prev) => (prev ? `${prev} ${texte}` : texte));
    };
    recognition.onerror = () => setEcoute(false);
    recognition.onend = () => setEcoute(false);
    recognitionRef.current = recognition;
    recognition.start();
    setEcoute(true);
  }, [ecoute]);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  return (
    <>
      {open && (
        <div className="fixed inset-0 md:inset-auto md:bottom-24 md:right-6 z-[70] flex items-end md:items-stretch justify-end pointer-events-none">
          <div className="pointer-events-auto w-full h-full md:w-[430px] md:h-[680px] md:max-h-[calc(100vh-7rem)] bg-white md:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-risein">
            <header className="relative overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 text-white shrink-0">
              <div className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-white/10" />
              <div className="absolute right-16 -bottom-20 h-36 w-36 rounded-full bg-white/5" />
              <div className="relative px-5 pt-5 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-xl bg-white/15 ring-1 ring-white/20 flex items-center justify-center shadow-inner">
                      <Sparkles size={21} />
                    </div>
                    <div>
                      <p className="font-bold text-base tracking-tight">Assistant COPEC</p>
                      <p className="text-xs text-brand-100 mt-0.5">Copilote de gestion scolaire · Admin</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={effacerHistorique} disabled={loading} className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-40" title="Nouvelle discussion" aria-label="Nouvelle discussion"><Trash2 size={16} /></button>
                    <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-white/10" title="Fermer" aria-label="Fermer"><X size={19} /></button>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                  <span className={`inline-flex h-2 w-2 rounded-full ${aiStatus.fallback ? 'bg-amber-300' : 'bg-emerald-300'} shadow-[0_0_0_3px_rgba(255,255,255,.10)]`} />
                  <span className="text-brand-50">{aiStatus.loading ? 'Vérification du service IA…' : aiStatus.fallback ? 'Mode secours · données réelles de l’école' : aiStatus.configured === false ? 'IA non configurée · mode secours disponible' : 'IA connectée · données de l’école uniquement'}</span>
                  <span className="text-brand-200">· Actions sensibles toujours confirmées</span>
                </div>
              </div>
            </header>

            <main ref={scrollRef} className="flex-1 overflow-y-auto bg-slate-50/90 px-4 py-4">
              {messages.length === 0 && (
                <div className="space-y-5">
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex gap-3">
                      <div className="h-9 w-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><ShieldCheck size={18} /></div>
                      <div>
                        <p className="font-semibold text-sm text-slate-800">Bonjour 👋</p>
                        <p className="text-xs leading-5 text-slate-500 mt-1">{WELCOME}</p>
                      </div>
                    </div>
                  </div>

                  <section>
                    <div className="flex items-center justify-between mb-2 px-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Accès rapide</p>
                      <span className="text-[10px] text-slate-400">Analyse en temps réel</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {QUICK_ACTIONS.map(({ label, prompt, icon: Icon }) => (
                        <button key={label} onClick={() => envoyer(prompt)} disabled={loading} className="group text-left bg-white border border-slate-200 rounded-xl p-3 hover:border-brand-300 hover:shadow-sm hover:-translate-y-0.5 transition disabled:opacity-50">
                          <div className="flex items-center justify-between">
                            <span className="h-8 w-8 rounded-lg bg-slate-50 text-slate-600 group-hover:bg-brand-50 group-hover:text-brand-700 flex items-center justify-center transition"><Icon size={16} /></span>
                            <ArrowUpRight size={13} className="text-slate-300 group-hover:text-brand-500" />
                          </div>
                          <p className="text-xs font-semibold text-slate-700 mt-2">{label}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              )}

              <div className="space-y-3">
                {messages.map((m, i) => (
                  <div key={`${m.role}-${i}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {m.role !== 'user' && <div className="h-7 w-7 mt-1 mr-2 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><Sparkles size={13} /></div>}
                    <div className={`max-w-[84%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line leading-5 shadow-sm ${m.role === 'user' ? 'bg-brand-700 text-white rounded-br-md' : 'bg-white text-slate-700 border border-slate-200 rounded-bl-md'}`}>
                      {formatMessage(m.content)}
                    </div>
                  </div>
                ))}
              </div>

              {loading && (
                <div className="flex items-center gap-2 mt-3">
                  <div className="h-7 w-7 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><Sparkles size={13} /></div>
                  <div className="bg-white border border-slate-200 rounded-2xl px-3.5 py-2.5 flex items-center gap-2 text-xs text-slate-400"><Spinner className="h-4 w-4" /> Analyse en cours…</div>
                </div>
              )}

              {pendingAction && !loading && (
                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-3.5 shadow-sm">
                  <div className="flex gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0"><TriangleAlert size={16} /></div>
                    <div>
                      <p className="text-xs font-bold text-amber-900">Action prête à être exécutée</p>
                      <p className="text-[11px] leading-4 text-amber-800/80 mt-0.5">Vérifiez la proposition ci-dessus. La confirmation est liée à cette action et expire après quelques minutes.</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={confirmerAction} disabled={busyAction} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-brand-700 text-white hover:bg-brand-800 transition"><Check size={14} /> Confirmer</button>
                    <button onClick={annulerAction} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 transition"><X size={14} /> Annuler</button>
                  </div>
                </div>
              )}

              {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
            </main>

            <form onSubmit={(e) => { e.preventDefault(); envoyer(); }} className="shrink-0 p-3 bg-white border-t border-slate-200">
              <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5 focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-100 transition">
                <button type="button" onClick={toggleMic} className={`p-2 rounded-lg shrink-0 transition ${ecoute ? 'bg-red-100 text-red-600' : 'text-slate-500 hover:bg-white hover:text-brand-700'}`} title={ecoute ? 'Arrêter la dictée' : 'Dicter'} aria-label={ecoute ? 'Arrêter la dictée' : 'Dicter'}>{ecoute ? <MicOff size={17} /> : <Mic size={17} />}</button>
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={ecoute ? 'Je vous écoute…' : 'Posez une question à COPEC…'} maxLength={1000} disabled={loading} className="min-w-0 flex-1 bg-transparent px-1.5 py-2 text-sm text-slate-700 placeholder:text-slate-400 outline-none" />
                <button type="submit" disabled={loading || !input.trim()} className="h-9 w-9 rounded-lg bg-brand-700 text-white flex items-center justify-center disabled:opacity-30 hover:bg-brand-800 transition" aria-label="Envoyer"><Send size={16} /></button>
              </div>
              <p className="text-[9px] text-center text-slate-400 mt-2">L’assistant analyse les données disponibles. Vérifiez les décisions importantes avant validation.</p>
            </form>
          </div>
        </div>
      )}

      {!open && (
        <button onClick={() => setOpen(true)} className="fixed bottom-[5.5rem] right-4 md:bottom-4 md:right-6 z-[70] h-12 w-12 rounded-2xl bg-brand-700 text-white shadow-xl flex items-center justify-center hover:bg-brand-800 hover:-translate-y-0.5 transition" aria-label="Ouvrir l’assistant" title="Assistant COPEC">
          <div className="relative"><MessageCircle size={21} /><Sparkles size={9} className="absolute -right-1 -top-1" /></div>
        </button>
      )}
    </>
  );
}
