import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Send, Trash2, MessagesSquare, CalendarClock, Users, Smartphone, Eye, Megaphone, CheckSquare, Square,
} from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import { SectionHeader, Badge, SearchInput } from '../../components/Shared';
import StatCard from '../../components/StatCard';
import { printTable } from '../../utils/exportUtils';

const CANAL_TONE = { interne: 'brand', sms: 'amber', email: 'slate', les_deux: 'violet' };
const CANAL_LABEL = { interne: 'Interne', sms: 'SMS', email: 'Email', les_deux: 'Email + SMS' };
const CANAL_OPTIONS = [
  { value: 'interne', label: 'Interne (application)' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'les_deux', label: 'Email + SMS' },
];

const MESSAGES_EXPORT_COLUMNS = [
  { label: 'Parent', value: (m) => m.parent_nom || '' },
  { label: 'Élève concerné', value: (m) => m.eleve_nom || '' },
  { label: 'Date', value: (m) => new Date(m.date_envoi).toLocaleString('fr-FR') },
  { label: 'Sujet', value: (m) => m.sujet || '' },
  { label: 'Message', value: (m) => m.message },
  { label: 'Canal', value: (m) => CANAL_LABEL[m.canal] || m.canal },
];

export default function Messagerie() {
  const [searchParams] = useSearchParams();
  const parentIdInitial = searchParams.get('parent_id') || '';
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('individuel'); // 'individuel' | 'groupe'
  const [parentId, setParentId] = useState(parentIdInitial);
  const [recherche, setRecherche] = useState('');
  const [canalFiltre, setCanalFiltre] = useState('');
  const [selectionGroupe, setSelectionGroupe] = useState(() => new Set());
  const [formGroupe, setFormGroupe] = useState({ sujet: '', message: '', canal: 'interne' });
  const [envoiGroupeEnCours, setEnvoiGroupeEnCours] = useState(false);

  const { data: parents } = useFetch(() => client.get('/parents').then((r) => r.data), []);

  // Vue d'ensemble : tous les messages envoyés (tous parents confondus), utilisée pour les
  // statistiques et pour la table « Toutes les conversations » quand aucun parent n'est sélectionné.
  // Le surveillant a ainsi une vue complète sans devoir cliquer parent par parent.
  const { data: messagesGlobal, loading: loadingGlobal, error: errorGlobal, reload: reloadGlobal } = useFetch(
    () => client.get('/communication/messages').then((r) => r.data), []
  );

  const { data: messagesThread, loading, error, reload } = useFetch(
    () => (parentId ? client.get('/communication/messages', { params: { parent_id: parentId } }).then((r) => r.data) : Promise.resolve([])),
    [parentId]
  );

  const parentsFiltres = (parents || []).filter((p) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return `${p.nom} ${p.prenom || ''} ${p.telephone}`.toLowerCase().includes(s);
  });

  const parentActif = parents?.find((p) => String(p.id) === String(parentId));
  const parentNomParId = useMemo(() => {
    const map = {};
    (parents || []).forEach((p) => { map[p.id] = `${p.nom} ${p.prenom || ''}`.trim(); });
    return map;
  }, [parents]);

  // Enrichit les messages globaux avec le nom du parent et de l'élève (pour le tableau et l'export) —
  // les données brutes de l'API ne contiennent que les identifiants.
  const messagesGlobalEnrichis = useMemo(() => (messagesGlobal || []).map((m) => {
    const p = (parents || []).find((pp) => pp.id === m.parent_id);
    const enfant = p?.enfants?.find((e) => e.eleve_id === m.eleve_id);
    return { ...m, parent_nom: parentNomParId[m.parent_id] || `#${m.parent_id}`, eleve_nom: enfant ? `${enfant.nom} ${enfant.prenom || ''}`.trim() : '' };
  }), [messagesGlobal, parents, parentNomParId]);

  const messagesGlobalFiltres = useMemo(() => {
    let rows = messagesGlobalEnrichis;
    if (canalFiltre) rows = rows.filter((m) => m.canal === canalFiltre);
    if (recherche) {
      const s = recherche.toLowerCase();
      rows = rows.filter((m) => `${m.parent_nom} ${m.sujet || ''} ${m.message}`.toLowerCase().includes(s));
    }
    return rows;
  }, [messagesGlobalEnrichis, canalFiltre, recherche]);

  // Récap rapide sur l'ensemble des messages envoyés (tout parent confondu).
  const nbTotal = messagesGlobal?.length ?? 0;
  const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0);
  const nbCeMois = messagesGlobal?.filter((m) => new Date(m.date_envoi) >= debutMois).length ?? 0;
  const nbParentsContactes = new Set((messagesGlobal || []).map((m) => m.parent_id)).size;
  const nbSms = messagesGlobal?.filter((m) => m.canal === 'sms' || m.canal === 'les_deux').length ?? 0;

  const FORM_VIDE = { sujet: '', message: '', canal: 'interne', eleve_id: '' };
  const [form, setForm] = useState(FORM_VIDE);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const envoyer = async (e) => {
    e.preventDefault();
    if (!parentId) { toast.error('Choisissez un parent destinataire.'); return; }
    try {
      await client.post('/communication/messages', { ...form, eleve_id: form.eleve_id || null, parent_id: parentId });
      toast.success('Message envoyé.');
      setForm(FORM_VIDE);
      reload();
      reloadGlobal();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const supprimer = async (m) => {
    const ok = await confirm({
      title: 'Supprimer le message',
      message: `Supprimer ce message ${m.sujet ? `« ${m.sujet} » ` : ''}envoyé à ${parentNomParId[m.parent_id] || 'ce parent'} ? Cette action est irréversible.`,
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    try {
      await client.delete(`/communication/messages/${m.id}`);
      toast.success('Message supprimé.');
      reload();
      reloadGlobal();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const changerMode = (m) => {
    setMode(m);
    setParentId('');
    setSelectionGroupe(new Set());
  };

  const toggleSelection = (id) => {
    setSelectionGroupe((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toutSelectionner = () => {
    setSelectionGroupe((prev) => {
      const idsAffiches = parentsFiltres.map((p) => p.id);
      const tousDejaSelectionnes = idsAffiches.length > 0 && idsAffiches.every((id) => prev.has(id));
      if (tousDejaSelectionnes) {
        const next = new Set(prev);
        idsAffiches.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...idsAffiches]);
    });
  };

  // Envoi groupé : réutilise le même endpoint POST /communication/messages qu'un message individuel,
  // une fois par destinataire sélectionné — pas besoin de route bulk côté backend, et chaque envoi
  // reste tracé comme un message normal dans l'historique du parent concerné.
  const envoyerGroupe = async (e) => {
    e.preventDefault();
    if (selectionGroupe.size === 0) { toast.error('Sélectionnez au moins un parent destinataire.'); return; }
    setEnvoiGroupeEnCours(true);
    const destinataires = Array.from(selectionGroupe);
    const resultats = await Promise.allSettled(
      destinataires.map((id) => client.post('/communication/messages', { ...formGroupe, eleve_id: null, parent_id: id }))
    );
    const succes = resultats.filter((r) => r.status === 'fulfilled').length;
    const echecs = resultats.length - succes;
    setEnvoiGroupeEnCours(false);
    if (echecs === 0) {
      toast.success(`Message envoyé à ${succes} parent(s).`);
      setFormGroupe({ sujet: '', message: '', canal: 'interne' });
      setSelectionGroupe(new Set());
    } else if (succes === 0) {
      toast.error("Échec de l'envoi du message groupé.");
    } else {
      toast.error(`${succes} message(s) envoyé(s), ${echecs} échec(s).`);
    }
    reloadGlobal();
  };

  return (
    <div>
      <SectionHeader title="Messagerie parents" subtitle="Communication directe avec les parents/responsables" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard label="Messages envoyés" value={nbTotal} icon={<MessagesSquare size={18} />} tone="brand" />
        <StatCard label="Ce mois-ci" value={nbCeMois} icon={<CalendarClock size={18} />} tone="slate" />
        <StatCard label="Parents contactés" value={nbParentsContactes} icon={<Users size={18} />} tone="slate" />
        <StatCard label="Via SMS" value={nbSms} icon={<Smartphone size={18} />} tone="slate" />
      </div>

      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 gap-1 mb-4">
        <button
          type="button"
          onClick={() => changerMode('individuel')}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'individuel' ? 'bg-white shadow-sm text-brand-800' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <MessagesSquare size={14} /> Conversations
        </button>
        <button
          type="button"
          onClick={() => changerMode('groupe')}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'groupe' ? 'bg-white shadow-sm text-brand-800' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <Megaphone size={14} /> Message groupé
        </button>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        <div className="card !p-3">
          <div className="mb-2"><SearchInput value={q} onChange={setQ} placeholder="Rechercher un parent…" /></div>
          {mode === 'groupe' && parentsFiltres.length > 0 && (
            <button
              type="button"
              onClick={toutSelectionner}
              className="w-full flex items-center gap-1.5 text-left px-3 py-1.5 rounded-lg text-xs text-brand-700 hover:bg-slate-50 mb-1"
            >
              {parentsFiltres.every((p) => selectionGroupe.has(p.id)) ? <CheckSquare size={13} /> : <Square size={13} />}
              Tout sélectionner ({parentsFiltres.length})
            </button>
          )}
          <div className="max-h-[28rem] overflow-y-auto space-y-0.5">
            {mode === 'individuel' && parentId && (
              <button
                onClick={() => setParentId('')}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-brand-700 hover:bg-slate-50 mb-1"
              >
                ← Toutes les conversations
              </button>
            )}
            {parentsFiltres.map((p) => (
              mode === 'groupe' ? (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleSelection(p.id)}
                  className={`w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectionGroupe.has(p.id) ? 'bg-brand-50 text-brand-900 font-medium' : 'hover:bg-slate-50 text-slate-600'}`}
                >
                  {selectionGroupe.has(p.id) ? <CheckSquare size={15} className="shrink-0 text-brand-700" /> : <Square size={15} className="shrink-0 text-slate-300" />}
                  <span>
                    {p.nom} {p.prenom || ''}
                    <span className="block text-xs text-slate-400">{p.telephone}</span>
                  </span>
                </button>
              ) : (
                <button
                  key={p.id}
                  onClick={() => setParentId(String(p.id))}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${String(parentId) === String(p.id) ? 'bg-brand-50 text-brand-900 font-medium' : 'hover:bg-slate-50 text-slate-600'}`}
                >
                  {p.nom} {p.prenom || ''}
                  <span className="block text-xs text-slate-400">{p.telephone}</span>
                </button>
              )
            ))}
            {parentsFiltres.length === 0 && <p className="text-xs text-slate-400 px-3 py-4">Aucun parent trouvé.</p>}
          </div>
        </div>

        <div className="space-y-4">
          {mode === 'groupe' ? (
            <form onSubmit={envoyerGroupe} className="card space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-900">Message groupé</h3>
                <Badge tone={selectionGroupe.size ? 'brand' : 'slate'}>{selectionGroupe.size} destinataire{selectionGroupe.size > 1 ? 's' : ''}</Badge>
              </div>
              <p className="text-xs text-slate-500">
                Cochez les parents à gauche (ou « Tout sélectionner »), puis rédigez un seul message à envoyer à tous en même temps —
                il sera enregistré individuellement dans chaque conversation.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className="label">Sujet</label><input className="input" value={formGroupe.sujet} onChange={(e) => setFormGroupe((f) => ({ ...f, sujet: e.target.value }))} /></div>
                <div>
                  <label className="label">Canal</label>
                  <select className="input" value={formGroupe.canal} onChange={(e) => setFormGroupe((f) => ({ ...f, canal: e.target.value }))}>
                    {CANAL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Message</label>
                <textarea className="input" rows={4} required value={formGroupe.message} onChange={(e) => setFormGroupe((f) => ({ ...f, message: e.target.value }))} />
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={envoiGroupeEnCours || selectionGroupe.size === 0}>
                  <Send size={15} className="inline -mt-0.5 mr-1" />
                  {envoiGroupeEnCours ? 'Envoi en cours…' : `Envoyer à ${selectionGroupe.size} parent(s)`}
                </button>
              </div>
            </form>
          ) : parentId ? (
            <>
              <div className="card">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="font-semibold text-slate-900">
                    Conversation avec {parentActif?.nom} {parentActif?.prenom || ''}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button className="btn-secondary" disabled={!messagesThread?.length} onClick={() => printTable({ title: `Messages — ${parentActif?.nom} ${parentActif?.prenom || ''}`, subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`, columns: MESSAGES_EXPORT_COLUMNS, rows: (messagesThread || []).map((m) => ({ ...m, parent_nom: `${parentActif?.nom} ${parentActif?.prenom || ''}` })) })}>
                      🖨️ Imprimer
                    </button>
                    <button className="btn-secondary" disabled={!messagesThread?.length} onClick={() => import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: MESSAGES_EXPORT_COLUMNS, rows: (messagesThread || []).map((m) => ({ ...m, parent_nom: `${parentActif?.nom} ${parentActif?.prenom || ''}` })), filename: 'messages_parent', sheetName: 'Messages' }))}>
                      📊 Exporter Excel
                    </button>
                  </div>
                </div>
                <DataTable
                  loading={loading} error={error} onRetry={reload} rows={messagesThread}
                  emptyLabel="Aucun message échangé avec ce parent."
                  columns={[
                    { key: 'date_envoi', label: 'Date', render: (m) => new Date(m.date_envoi).toLocaleString('fr-FR') },
                    { key: 'sujet', label: 'Sujet', render: (m) => m.sujet || '—' },
                    { key: 'message', label: 'Message' },
                    { key: 'canal', label: 'Canal', render: (m) => <Badge tone={CANAL_TONE[m.canal] || 'slate'}>{CANAL_LABEL[m.canal] || m.canal}</Badge> },
                  ]}
                  actions={(m) => (
                    <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(m)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                />
              </div>

              <form onSubmit={envoyer} className="card space-y-3">
                <h3 className="font-semibold text-slate-900">Nouveau message</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><label className="label">Sujet</label><input className="input" value={form.sujet} onChange={set('sujet')} /></div>
                  <div>
                    <label className="label">Canal</label>
                    <select className="input" value={form.canal} onChange={set('canal')}>
                      {CANAL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  {parentActif?.enfants?.length > 0 && (
                    <div className="sm:col-span-2">
                      <label className="label">Concernant (optionnel)</label>
                      <select className="input" value={form.eleve_id} onChange={set('eleve_id')}>
                        <option value="">— Non spécifique —</option>
                        {parentActif.enfants.map((en) => (
                          <option key={en.eleve_id} value={en.eleve_id}>{en.nom} {en.prenom || ''} {en.lien_parente ? `(${en.lien_parente})` : ''}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div>
                  <label className="label">Message</label>
                  <textarea className="input" rows={3} required value={form.message} onChange={set('message')} />
                </div>
                <div className="flex justify-end">
                  <button type="submit" className="btn-primary"><Send size={15} className="inline -mt-0.5 mr-1" />Envoyer</button>
                </div>
              </form>
            </>
          ) : (
            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="font-semibold text-slate-900">Toutes les conversations</h3>
                <div className="flex items-center gap-2">
                  <button className="btn-secondary" disabled={!messagesGlobalFiltres?.length} onClick={() => printTable({ title: 'Messagerie parents — toutes les conversations', subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`, columns: MESSAGES_EXPORT_COLUMNS, rows: messagesGlobalFiltres })}>
                    🖨️ Imprimer
                  </button>
                  <button className="btn-secondary" disabled={!messagesGlobalFiltres?.length} onClick={() => import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: MESSAGES_EXPORT_COLUMNS, rows: messagesGlobalFiltres, filename: 'messages_parents_tous', sheetName: 'Messages' }))}>
                    📊 Exporter Excel
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 mb-4">
                <SearchInput value={recherche} onChange={setRecherche} placeholder="Rechercher (parent, sujet, message)…" />
                <div className="w-full sm:w-52">
                  <select className="input" value={canalFiltre} onChange={(e) => setCanalFiltre(e.target.value)}>
                    <option value="">— Tous les canaux —</option>
                    {CANAL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <DataTable
                loading={loadingGlobal} error={errorGlobal} onRetry={reloadGlobal} rows={messagesGlobalFiltres}
                emptyLabel="Aucun message envoyé pour le moment."
                pageSize={15}
                columns={[
                  { key: 'parent_nom', label: 'Parent', sortable: true },
                  { key: 'eleve_nom', label: 'Élève concerné', render: (m) => m.eleve_nom || '—' },
                  { key: 'date_envoi', label: 'Date', sortable: true, render: (m) => new Date(m.date_envoi).toLocaleString('fr-FR') },
                  { key: 'sujet', label: 'Sujet', render: (m) => m.sujet || '—' },
                  { key: 'canal', label: 'Canal', sortable: true, sortValue: (m) => CANAL_LABEL[m.canal] || m.canal, render: (m) => <Badge tone={CANAL_TONE[m.canal] || 'slate'}>{CANAL_LABEL[m.canal] || m.canal}</Badge> },
                ]}
                actions={(m) => (
                  <div className="flex justify-end gap-1">
                    <button className="btn-ghost !p-1.5" title="Voir la conversation" onClick={() => setParentId(String(m.parent_id))}>
                      <Eye size={15} />
                    </button>
                    <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(m)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
