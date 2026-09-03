import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ExternalLink, FileCheck2, GraduationCap, ShieldCheck } from 'lucide-react';
import client, { apiErrorMessage } from '../api/client';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatNote(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(2).replace('.', ',')} /20`;
}

export default function VerificationBulletin() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    client.get(`/verification-bulletins/${encodeURIComponent(token || '')}`)
      .then((res) => { if (active) setData(res.data); })
      .catch((err) => { if (active) setError(apiErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-5">
        <div className="surface max-w-md w-full p-8 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-brand-50 flex items-center justify-center">
            <ShieldCheck className="text-brand-800 animate-pulse" size={25} />
          </div>
          <h1 className="font-display font-bold text-xl text-slate-950">Vérification du bulletin</h1>
          <p className="text-sm text-slate-500 mt-2">Contrôle de l&apos;authenticité en cours…</p>
        </div>
      </div>
    );
  }

  if (error || !data?.authentique) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-5">
        <div className="surface max-w-lg w-full p-8 text-center">
          <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-red-50 flex items-center justify-center">
            <AlertTriangle className="text-red-600" size={28} />
          </div>
          <p className="section-kicker text-red-600">Vérification échouée</p>
          <h1 className="font-display font-bold text-2xl text-slate-950 mt-1">Bulletin non vérifié</h1>
          <p className="text-sm text-slate-600 mt-3">
            {error || 'Le QR code est invalide, altéré ou ne correspond à aucun bulletin officiel enregistré.'}
          </p>
          <p className="text-xs text-slate-400 mt-4">Ne considérez pas ce document comme authentique.</p>
          <Link to="/login" className="btn-secondary mt-6">Retour à la connexion</Link>
        </div>
      </div>
    );
  }

  const { ecole, eleve, inscription, bulletins, verification } = data;
  const publicBase = import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-brand-950 text-white border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {ecole.logo_url ? (
              <img src={ecole.logo_url} alt="Logo" className="h-10 w-10 rounded-lg object-contain bg-white" />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-accent-500 text-brand-950 flex items-center justify-center font-black">
                {ecole.nom_ecole?.charAt(0) || 'C'}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-bold truncate">{ecole.nom_ecole || 'COPEC ISAHA'}</p>
              <p className="text-xs text-brand-200">Service officiel de vérification des bulletins</p>
            </div>
          </div>
          <Link to="/login" className="text-xs font-semibold text-white/80 hover:text-white">Connexion</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 sm:py-10">
        <section className="surface overflow-hidden">
          <div className="p-5 sm:p-7 border-b border-slate-200 bg-white">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 text-emerald-800 px-3 py-1.5 text-xs font-bold">
                  <CheckCircle2 size={15} /> BULLETIN AUTHENTIQUE
                </div>
                <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-slate-950 mt-3">Vérification officielle</h1>
                <p className="text-sm text-slate-500 mt-1">Les informations ci-dessous proviennent directement du système de l&apos;établissement.</p>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 sm:min-w-[220px]">
                <p className="section-kicker">Référence</p>
                <p className="font-mono font-bold text-sm text-slate-900 mt-1 break-all">{verification.reference}</p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-7 grid lg:grid-cols-[260px_1fr] gap-6">
            <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="aspect-[4/5] rounded-xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center">
                {eleve.photoUrl ? (
                  <img src={eleve.photoUrl} alt="Photo de l'élève" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center text-slate-300">
                    <GraduationCap size={46} className="mx-auto" />
                    <p className="text-xs mt-2">Photo non enregistrée</p>
                  </div>
                )}
              </div>
              <div className="mt-4 text-center">
                <p className="font-display font-bold text-lg text-slate-950 uppercase">{eleve.nom} {eleve.prenom || ''}</p>
                <p className="font-mono text-xs text-slate-500 mt-1">{eleve.matricule}</p>
              </div>
            </aside>

            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-3">
                <Info label="Nom complet" value={`${eleve.nom} ${eleve.prenom || ''}`} />
                <Info label="Matricule" value={eleve.matricule} mono />
                <Info label="Classe" value={inscription.classe} />
                <Info label="Année scolaire" value={inscription.annee} />
                <Info label="Niveau" value={inscription.niveau || '—'} />
                <Info label="Bulletins enregistrés" value={`${verification.nbBulletins} bimestre(s)`}/>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex gap-3">
                <ShieldCheck className="text-emerald-700 shrink-0" size={22} />
                <div>
                  <p className="font-bold text-emerald-900 text-sm">Contrôle cryptographique + intégrité réussis</p>
                  <p className="text-xs text-emerald-800/80 mt-1">
                    Ce QR est signé par le système COPEC et lié à l'empreinte du contenu imprimé. Si les résultats, l'identité scolaire ou les données du bulletin ont changé après l'impression, l'ancien document est signalé comme obsolète.
                  </p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h2 className="font-display font-bold text-lg text-slate-950 flex items-center gap-2"><FileCheck2 size={19}/> Résultats officiels</h2>
                  <span className="text-xs text-slate-400">Vérifié le {formatDate(verification.verifiedAt)}</span>
                </div>

                <div className="space-y-4">
                  {bulletins.map((b) => (
                    <article key={b.id} className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-bold text-sm text-slate-950">{b.libelle || `${b.numero}e bimestre`}</p>
                          <p className="text-[11px] text-slate-400">Bulletin officiel #{b.id} · généré le {formatDate(b.dateGeneration)}</p>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="font-semibold text-slate-600">Moyenne</span>
                          <strong className="font-mono text-brand-900">{formatNote(b.moyenneGenerale)}</strong>
                          {b.rang && <span className="font-mono text-slate-500">{b.rang}/{b.effectif || '—'}</span>}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                              <th className="px-4 py-2.5">Matière</th>
                              <th className="px-4 py-2.5 text-center">Moyenne</th>
                              <th className="px-4 py-2.5 text-center">Coef.</th>
                              <th className="px-4 py-2.5 text-right">Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {b.matieres.map((m) => (
                              <tr key={`${b.id}-${m.matiereId}`} className="border-b border-slate-50 last:border-0">
                                <td className="px-4 py-2.5 font-medium text-slate-800">{m.matiere}</td>
                                <td className="px-4 py-2.5 text-center font-mono">{formatNote(m.moyenne)}</td>
                                <td className="px-4 py-2.5 text-center font-mono text-slate-500">{m.coefficient ?? '—'}</td>
                                <td className="px-4 py-2.5 text-right font-mono">{m.totalPoints ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 grid sm:grid-cols-3 gap-3 text-xs">
                        <Info label="Absences" value={String(b.absences)} />
                        <Info label="Retards" value={String(b.retards)} />
                        <Info label="Décision" value={b.decision || '—'} />
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <footer className="px-5 sm:px-7 py-4 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span>{ecole.telephone || ''} {ecole.email ? `· ${ecole.email}` : ''}</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={14}/> Données officielles COPEC</span>
          </footer>
        </section>

        <div className="mt-5 text-center text-xs text-slate-400">
          <a href={`${publicBase}/login`} className="inline-flex items-center gap-1 hover:text-slate-600"><ExternalLink size={13}/> Ouvrir la connexion</a>
        </div>
      </main>
    </div>
  );
}

function Info({ label, value, mono = false }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <p className="section-kicker">{label}</p>
      <p className={`mt-1 font-semibold text-slate-900 text-sm ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
    </div>
  );
}
