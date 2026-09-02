import { useMemo, useState } from 'react';
import {
  Send, CalendarDays, CheckCircle2, AlertTriangle, Eye, Download, ListFilter, X,
  Users, Layers, School, UserSearch, ListChecks, Mail, MessageCircle, MessagesSquare,
  NotebookPen, CalendarX, ClipboardList, CalendarClock, FileBadge,
} from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { getServerToday } from '../../utils/serverClock';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatCard from '../../components/StatCard';
import { SectionHeader, Badge } from '../../components/Shared';

const SCOPES = [
  { value: 'tous', label: 'Tous les élèves', icon: Users },
  { value: 'niveau', label: 'Par niveau', icon: Layers },
  { value: 'classe', label: 'Par classe', icon: School },
  { value: 'eleve', label: 'Un seul élève', icon: UserSearch },
  { value: 'selection', label: 'Sélection libre', icon: ListChecks },
];

const CANAUX = [
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { value: 'les_deux', label: 'Les deux', icon: MessagesSquare },
];

const INFOS = [
  { key: 'notes', label: 'Notes', icon: NotebookPen },
  { key: 'absences', label: 'Absences', icon: CalendarX },
  { key: 'devoirs', label: 'Devoirs', icon: ClipboardList },
  { key: 'emploi', label: 'Emploi du temps', icon: CalendarClock },
  { key: 'bulletin', label: 'Bulletin (PDF)', icon: FileBadge },
];

const SCOPE_LABEL = { tous: 'Tous les élèves', niveau: 'Niveau', classe: 'Classe', eleve: 'Élève', selection: 'Sélection' };
const CANAL_LABEL = { email: 'Email', whatsapp: 'WhatsApp', les_deux: 'Les deux' };
// Couleurs de badge par canal — vert (proche de la couleur de marque WhatsApp) pour whatsapp,
// neutre pour email, violet pour "les deux" (cohérent avec la convention déjà utilisée dans
// Messagerie.jsx pour un canal mixte).
const CANAL_TONE = { email: 'slate', whatsapp: 'green', les_deux: 'violet' };

// Statut global d'un envoi, dérivé des compteurs déjà renvoyés par l'API (pas d'appel supplémentaire).
function statutEnvoi(row) {
  if (!row.nb_destinataires) return { tone: 'slate', label: 'Aucun destinataire' };
  if (row.nb_echecs === 0) return { tone: 'green', label: 'Envoyé (complet)' };
  if (row.nb_echecs >= row.nb_destinataires) return { tone: 'red', label: 'Échec' };
  return { tone: 'amber', label: 'Partiel' };
}

function exportEnvoisCsv(rows) {
  const header = ['Date', 'Cible', 'Canal', 'Destinataires', 'Envoyé par', 'Emails envoyés', 'WhatsApp envoyés', 'Échecs', 'Statut'];
  const lines = rows.map((r) => [
    new Date(r.created_at).toLocaleDateString('fr-FR'),
    `${SCOPE_LABEL[r.scope_type] || r.scope_type}${r.scope_valeur ? ` (${r.scope_valeur})` : ''}`,
    CANAL_LABEL[r.canal] || r.canal,
    r.nb_destinataires,
    `${r.auteur_nom || ''} ${r.auteur_prenom || ''}`.trim(),
    r.nb_envoyes_email,
    r.nb_envoyes_whatsapp,
    r.nb_echecs,
    statutEnvoi(r).label,
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rapports_${getServerToday()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
      {options.map((opt) => {
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 min-w-[110px] inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2.5 text-sm font-medium transition-colors ${
              value === opt.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {Icon && <Icon size={14} className={value === opt.value ? 'text-brand-700' : 'text-slate-400'} aria-hidden="true" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function Rapports() {
  const toast = useToast();
  const confirm = useConfirm();
  const [sending, setSending] = useState(false);
  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);
  const { data: niveaux } = useFetch(() => client.get('/niveaux').then((r) => r.data), []);
  const { data: envois, loading, error, reload } = useFetch(() => client.get('/rapports').then((r) => r.data), []);

  const [scopeType, setScopeType] = useState('tous');
  const [scopeValeur, setScopeValeur] = useState('');
  const [canal, setCanal] = useState('les_deux');
  const [infos, setInfos] = useState({ notes: false, absences: false, devoirs: false, emploi: false, bulletin: false });
  const [messagePerso, setMessagePerso] = useState('');
  const [eleveSearch, setEleveSearch] = useState('');
  const { data: eleves } = useFetch(
    () => (scopeType === 'eleve' ? client.get('/eleves', { params: { search: eleveSearch || undefined } }).then((r) => r.data) : Promise.resolve([])),
    [scopeType, eleveSearch]
  );

  // Scope "Sélection libre" : plusieurs élèves choisis à la main, potentiellement dans des classes
  // différentes — utile pour un envoi ciblé (ex. élèves en retard de paiement) sans devoir viser
  // toute une classe ou tout un niveau. scope_valeur envoyé au backend = JSON.stringify des ids.
  const [selectionEleves, setSelectionEleves] = useState([]);
  const [selectionSearch, setSelectionSearch] = useState('');
  const { data: eleveResultats } = useFetch(
    () => (scopeType === 'selection' && selectionSearch.length >= 2 ? client.get('/eleves', { params: { search: selectionSearch } }).then((r) => r.data) : Promise.resolve([])),
    [scopeType, selectionSearch]
  );
  const idsDejaSelectionnes = useMemo(() => new Set(selectionEleves.map((e) => e.id)), [selectionEleves]);
  const ajouterALaSelection = (el) => {
    if (idsDejaSelectionnes.has(el.id)) return;
    setSelectionEleves((prev) => [...prev, el]);
    setSelectionSearch('');
  };
  const retirerDeLaSelection = (id) => setSelectionEleves((prev) => prev.filter((e) => e.id !== id));

  const toutSelectionne = INFOS.every((i) => infos[i.key]);
  const toggleInfo = (key) => setInfos((f) => ({ ...f, [key]: !f[key] }));
  const toggleTout = () => {
    const next = !toutSelectionne;
    setInfos(Object.fromEntries(INFOS.map((i) => [i.key, next])));
  };

  const changeScope = (val) => {
    setScopeType(val);
    setScopeValeur('');
    setSelectionEleves([]);
    setSelectionSearch('');
  };

  const CONTENU_MAX = 300;
  const contenu = useMemo(() => {
    const choisis = INFOS.filter((i) => infos[i.key]).map((i) => i.label);
    if (!choisis.length) return '';
    const base = `Rapport scolaire incluant : ${choisis.join(', ')}.`;
    const complet = messagePerso.trim() ? `${base} ${messagePerso.trim()}` : base;
    return complet.slice(0, CONTENU_MAX);
  }, [infos, messagePerso]);

  const cibleValide = scopeType === 'tous'
    || (scopeType === 'selection' ? selectionEleves.length > 0 : scopeValeur !== '');
  const peutEnvoyer = cibleValide && contenu !== '' && !sending;

  // Libellé lisible de la cible choisie, pour l'aperçu et la confirmation.
  const cibleLabel = useMemo(() => {
    if (scopeType === 'tous') return 'Tous les élèves actifs';
    if (scopeType === 'niveau') return niveaux?.find((n) => String(n.id) === String(scopeValeur))?.nom || '—';
    if (scopeType === 'classe') return classes?.find((c) => String(c.id) === String(scopeValeur))?.nom || '—';
    if (scopeType === 'eleve') {
      const el = eleves?.find((e) => String(e.id) === String(scopeValeur));
      return el ? `${el.nom} ${el.prenom}` : '—';
    }
    if (scopeType === 'selection') {
      return selectionEleves.length ? `${selectionEleves.length} élève(s) : ${selectionEleves.map((e) => e.nom).join(', ')}` : '—';
    }
    return '—';
  }, [scopeType, scopeValeur, niveaux, classes, eleves, selectionEleves]);

  const [apercuOuvert, setApercuOuvert] = useState(false);

  const envoyer = async () => {
    if (!cibleValide) { toast.error('Choisis une cible (niveau, classe, élève ou sélection).'); return; }
    if (contenu === '') { toast.error('Sélectionne au moins une information à inclure.'); return; }
    if (scopeType === 'tous') {
      const ok = await confirm({
        title: 'Confirmer l\'envoi à tous les élèves',
        message: `Ce rapport sera envoyé à TOUS les élèves actifs de l'école, par ${CANAL_LABEL[canal].toLowerCase()}. Cette action ne peut pas être annulée après envoi.`,
        confirmLabel: 'Envoyer à tous',
      });
      if (!ok) return;
    }
    setApercuOuvert(false);
    setSending(true);
    try {
      const { data } = await client.post('/rapports/envoyer', {
        scope_type: scopeType,
        scope_valeur: scopeType === 'selection' ? JSON.stringify(selectionEleves.map((e) => e.id)) : scopeValeur,
        contenu,
        canal,
      });
      toast.success(`Envoyé : ${data.nb_envoyes_email} email(s), ${data.nb_envoyes_whatsapp} WhatsApp. ${data.nb_echecs} sans contact.`);
      setInfos({ notes: false, absences: false, devoirs: false, emploi: false, bulletin: false });
      setMessagePerso('');
      setSelectionEleves([]);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  // --- Statistiques (calculées côté client à partir de l'historique déjà chargé) ---
  const stats = useMemo(() => {
    const rows = envois || [];
    const now = new Date();
    const ceMois = rows.filter((r) => {
      const d = new Date(r.created_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    const totalDestinataires = rows.reduce((s, r) => s + (r.nb_destinataires || 0), 0);
    const totalEchecs = rows.reduce((s, r) => s + (r.nb_echecs || 0), 0);
    const tauxReussite = totalDestinataires > 0 ? Math.round(((totalDestinataires - totalEchecs) / totalDestinataires) * 100) : 0;
    return { total: rows.length, ceMois, tauxReussite, totalEchecs };
  }, [envois]);

  // --- Filtres sur l'historique ---
  const [filtreCanal, setFiltreCanal] = useState('');
  const [filtreCible, setFiltreCible] = useState('');
  const [filtreDepuis, setFiltreDepuis] = useState('');
  const [filtreJusqua, setFiltreJusqua] = useState('');

  const envoisFiltres = useMemo(() => {
    let rows = envois || [];
    if (filtreCanal) rows = rows.filter((r) => r.canal === filtreCanal);
    if (filtreCible) rows = rows.filter((r) => r.scope_type === filtreCible);
    if (filtreDepuis) rows = rows.filter((r) => new Date(r.created_at) >= new Date(filtreDepuis));
    if (filtreJusqua) rows = rows.filter((r) => new Date(r.created_at) <= new Date(`${filtreJusqua}T23:59:59`));
    return rows;
  }, [envois, filtreCanal, filtreCible, filtreDepuis, filtreJusqua]);

  // --- Détail d'un envoi (modal, chargé à la demande) ---
  const [detailEnvoi, setDetailEnvoi] = useState(null);
  const { data: detailRows, loading: detailLoading, error: detailError } = useFetch(
    () => (detailEnvoi ? client.get(`/rapports/${detailEnvoi.id}/detail`).then((r) => r.data) : Promise.resolve(null)),
    [detailEnvoi]
  );

  return (
    <div>
      <SectionHeader title="Rapports" subtitle="Envoi groupé de rapports/messages aux parents" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Rapports envoyés" value={stats.total} icon={<Send size={18} />} tone="brand" />
        <StatCard label="Ce mois-ci" value={stats.ceMois} icon={<CalendarDays size={18} />} tone="slate" />
        <StatCard label="Taux de réussite" value={`${stats.tauxReussite}%`} icon={<CheckCircle2 size={18} />} tone={stats.tauxReussite >= 90 ? 'brand' : 'accent'} />
        <StatCard label="Échecs cumulés" value={stats.totalEchecs} icon={<AlertTriangle size={18} />} tone={stats.totalEchecs > 0 ? 'red' : 'slate'} />
      </div>

      <div className="card mb-6">
        <h3 className="text-base font-bold text-slate-900">📊 Composer et envoyer un rapport</h3>
        <p className="text-sm text-slate-500 mt-1 mb-5">
          Choisis qui reçoit le rapport, quelles informations inclure, et par quel canal — rien n&apos;est envoyé automatiquement, c&apos;est toi qui déclenches l&apos;envoi.
        </p>

        <div className="mb-5">
          <p className="text-sm font-semibold text-slate-700 mb-2">1. Qui reçoit le rapport ?</p>
          <SegmentedControl options={SCOPES} value={scopeType} onChange={changeScope} />

          {scopeType === 'niveau' && (
            <select className="input mt-3" value={scopeValeur} onChange={(e) => setScopeValeur(e.target.value)}>
              <option value="">— Choisir un niveau —</option>
              {niveaux?.map((n) => <option key={n.id} value={n.id}>{n.nom}</option>)}
            </select>
          )}
          {scopeType === 'classe' && (
            <select className="input mt-3" value={scopeValeur} onChange={(e) => setScopeValeur(e.target.value)}>
              <option value="">— Choisir une classe —</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          )}
          {scopeType === 'eleve' && (
            <div className="mt-3 space-y-2">
              <input
                className="input"
                placeholder="Rechercher un élève par nom, prénom ou matricule…"
                value={eleveSearch}
                onChange={(e) => setEleveSearch(e.target.value)}
              />
              <select className="input" value={scopeValeur} onChange={(e) => setScopeValeur(e.target.value)}>
                <option value="">— Choisir un élève —</option>
                {eleves?.map((el) => <option key={el.id} value={el.id}>{el.nom} {el.prenom} {el.matricule ? `(${el.matricule})` : ''}</option>)}
              </select>
            </div>
          )}
          {scopeType === 'selection' && (
            <div className="mt-3 space-y-2">
              <input
                className="input"
                placeholder="Rechercher un élève à ajouter (nom, prénom, matricule)…"
                value={selectionSearch}
                onChange={(e) => setSelectionSearch(e.target.value)}
              />
              {eleveResultats?.length > 0 && (
                <div className="border border-slate-100 rounded-lg max-h-40 overflow-y-auto">
                  {eleveResultats.map((el) => (
                    <button
                      type="button" key={el.id}
                      disabled={idsDejaSelectionnes.has(el.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between"
                      onClick={() => ajouterALaSelection(el)}
                    >
                      <span>{el.nom} {el.prenom} — {el.matricule}</span>
                      {idsDejaSelectionnes.has(el.id) && <span className="text-xs text-slate-400">déjà ajouté</span>}
                    </button>
                  ))}
                </div>
              )}
              {selectionEleves.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectionEleves.map((el) => (
                    <span key={el.id} className="inline-flex items-center gap-1 badge bg-brand-50 text-brand-800">
                      {el.nom} {el.prenom}
                      <button type="button" className="hover:text-red-600" onClick={() => retirerDeLaSelection(el.id)} aria-label="Retirer">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Aucun élève ajouté pour le moment.</p>
              )}
            </div>
          )}
        </div>

        <div className="mb-5">
          <p className="text-sm font-semibold text-slate-700 mb-2">2. Quelles informations inclure ?</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {INFOS.map((i) => (
              <label key={i.key} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-800 focus:ring-brand-600" checked={infos[i.key]} onChange={() => toggleInfo(i.key)} />
                <i.icon size={14} className="text-slate-400" aria-hidden="true" />
                {i.label}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-800 focus:ring-brand-600" checked={toutSelectionne} onChange={toggleTout} />
              Tout sélectionner
            </label>
          </div>
          <div className="mt-3">
            <label className="label">Message personnalisé (optionnel)</label>
            <input
              className="input"
              placeholder="Ex : Réunion parents-professeurs le 15 mars à 14h…"
              value={messagePerso}
              maxLength={CONTENU_MAX}
              onChange={(e) => setMessagePerso(e.target.value)}
            />
            <p className="text-[11px] text-slate-400 mt-1">{contenu.length}/{CONTENU_MAX} caractères — ajouté à la suite du résumé automatique.</p>
          </div>
        </div>

        <div className="mb-5">
          <p className="text-sm font-semibold text-slate-700 mb-2">3. Par quel canal ?</p>
          <SegmentedControl options={CANAUX} value={canal} onChange={setCanal} />
          {canal !== 'email' && (
            <p className="text-xs text-amber-600 mt-2">
              ⚠️ L&apos;envoi WhatsApp nécessite un fournisseur WhatsApp Business API configuré côté serveur (voir <code className="bg-amber-50 px-1 rounded">WHATSAPP_PHONE_NUMBER_ID</code> / <code className="bg-amber-50 px-1 rounded">WHATSAPP_ACCESS_TOKEN</code> dans le .env).
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            disabled={!cibleValide || contenu === ''}
            onClick={() => setApercuOuvert(true)}
          >
            <Eye size={16} /> Aperçu
          </button>
          <button className="btn-primary inline-flex items-center gap-2" disabled={!peutEnvoyer} onClick={envoyer}>
            <Send size={16} /> {sending ? 'Envoi en cours…' : 'Envoyer le rapport'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-900">Historique des envois</h3>
          <button
            type="button"
            className="btn-ghost inline-flex items-center gap-2"
            disabled={!envoisFiltres?.length}
            onClick={() => exportEnvoisCsv(envoisFiltres)}
          >
            <Download size={15} /> Exporter en CSV
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="min-w-[160px]">
            <label className="label inline-flex items-center gap-1"><ListFilter size={12} /> Cible</label>
            <select className="input" value={filtreCible} onChange={(e) => setFiltreCible(e.target.value)}>
              <option value="">Toutes les cibles</option>
              {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="label">Canal</label>
            <select className="input" value={filtreCanal} onChange={(e) => setFiltreCanal(e.target.value)}>
              <option value="">Tous les canaux</option>
              {CANAUX.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Depuis le</label>
            <input className="input" type="date" value={filtreDepuis} onChange={(e) => setFiltreDepuis(e.target.value)} />
          </div>
          <div>
            <label className="label">Jusqu&apos;au</label>
            <input className="input" type="date" value={filtreJusqua} onChange={(e) => setFiltreJusqua(e.target.value)} />
          </div>
          {(filtreCible || filtreCanal || filtreDepuis || filtreJusqua) && (
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => { setFiltreCible(''); setFiltreCanal(''); setFiltreDepuis(''); setFiltreJusqua(''); }}
            >
              Réinitialiser
            </button>
          )}
        </div>

        <DataTable
          loading={loading} error={error} onRetry={reload} rows={envoisFiltres}
          pageSize={10}
          emptyLabel="Aucun rapport envoyé pour ces filtres."
          columns={[
            {
              key: 'scope_type', label: 'Cible', sortable: true,
              render: (r) => `${SCOPE_LABEL[r.scope_type] || r.scope_type}${r.scope_valeur ? ` (${r.scope_valeur})` : ''}`,
            },
            {
              key: 'canal', label: 'Canal', sortable: true,
              render: (r) => <Badge tone={CANAL_TONE[r.canal] || 'slate'}>{CANAL_LABEL[r.canal] || r.canal}</Badge>,
            },
            { key: 'nb_destinataires', label: 'Destinataires', sortable: true },
            {
              key: 'auteur', label: 'Envoyé par',
              render: (r) => (r.auteur_nom ? <span className="text-sm text-slate-600">{r.auteur_nom} {r.auteur_prenom || ''}</span> : <span className="text-slate-300">—</span>),
            },
            { key: 'nb_envoyes_email', label: 'Emails', sortable: true },
            { key: 'nb_envoyes_whatsapp', label: 'WhatsApp', sortable: true },
            {
              key: 'statut', label: 'Statut', sortable: true, sortValue: (r) => statutEnvoi(r).label,
              render: (r) => { const s = statutEnvoi(r); return <Badge tone={s.tone}>{s.label}</Badge>; },
            },
            { key: 'created_at', label: 'Date', sortable: true, render: (r) => new Date(r.created_at).toLocaleDateString('fr-FR') },
          ]}
          actions={(r) => (
            <button className="btn-ghost !px-2 !py-1 text-brand-700 inline-flex items-center gap-1" onClick={() => setDetailEnvoi(r)}>
              <Eye size={14} /> Détail
            </button>
          )}
        />
      </div>

      {/* Aperçu avant envoi */}
      <Modal open={apercuOuvert} onClose={() => setApercuOuvert(false)} title="Aperçu du rapport">
        <div className="space-y-3 text-sm">
          <div><span className="font-semibold text-slate-700">Destinataires : </span>{cibleLabel}</div>
          <div><span className="font-semibold text-slate-700">Canal : </span>{CANAL_LABEL[canal]}</div>
          <div>
            <span className="font-semibold text-slate-700">Contenu : </span>
            <p className="mt-1 rounded-lg bg-slate-50 p-3 text-slate-600">{contenu || '—'}</p>
          </div>
          {canal !== 'email' && (
            <p className="text-xs text-amber-600">⚠️ Le WhatsApp nécessite un fournisseur configuré côté serveur.</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setApercuOuvert(false)}>Fermer</button>
            <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={!peutEnvoyer} onClick={envoyer}>
              <Send size={16} /> {sending ? 'Envoi en cours…' : 'Confirmer l\'envoi'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Détail d'un envoi */}
      <Modal open={!!detailEnvoi} onClose={() => setDetailEnvoi(null)} title="Détail de l'envoi" wide>
        {detailEnvoi && (
          <div>
            <div className="flex flex-wrap gap-2 mb-4 text-sm text-slate-500">
              <Badge tone="brand">{SCOPE_LABEL[detailEnvoi.scope_type] || detailEnvoi.scope_type}</Badge>
              <Badge tone={CANAL_TONE[detailEnvoi.canal] || 'slate'}>{CANAL_LABEL[detailEnvoi.canal] || detailEnvoi.canal}</Badge>
              <span>{new Date(detailEnvoi.created_at).toLocaleDateString('fr-FR')}</span>
            </div>
            <DataTable
              loading={detailLoading} error={detailError} rows={detailRows}
              emptyLabel="Aucun destinataire enregistré pour cet envoi."
              pageSize={8}
              columns={[
                { key: 'nom', label: 'Élève', render: (r) => `${r.prenom || ''} ${r.nom}` },
                {
                  key: 'email_statut', label: 'Email',
                  render: (r) => r.email_statut ? <Badge tone={r.email_statut === 'envoye' ? 'green' : r.email_statut === 'echec' ? 'red' : 'slate'}>{r.email_statut}</Badge> : '—',
                },
                {
                  key: 'whatsapp_statut', label: 'WhatsApp',
                  render: (r) => r.whatsapp_statut ? <Badge tone={r.whatsapp_statut === 'envoye' ? 'green' : r.whatsapp_statut === 'echec' ? 'red' : 'slate'}>{r.whatsapp_statut}</Badge> : '—',
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
