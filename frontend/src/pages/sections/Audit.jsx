import { useMemo, useState } from 'react';
import { History, CalendarClock, Trash2, Users, ListFilter, Eye, Download, RefreshCw } from 'lucide-react';
import client from '../../api/client';
import { getServerToday } from '../../utils/serverClock';
import { useFetch } from '../../hooks/useFetch';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatCard from '../../components/StatCard';
import { SectionHeader, Badge, SearchInput } from '../../components/Shared';

const ACTION_TONE = { creation: 'green', modification: 'amber', suppression: 'red', connexion: 'brand', autre: 'violet' };
const ACTION_LABEL = { creation: 'Création', modification: 'Modification', suppression: 'Suppression', connexion: 'Connexion', autre: 'Autre' };

function exportLogsCsv(rows) {
  const header = ['Date', 'Action', 'Table', 'ID', 'Auteur', 'Adresse IP'];
  const lines = rows.map((r) => [
    new Date(r.date_action).toLocaleString('fr-FR'),
    ACTION_LABEL[r.action] || r.action,
    r.table_nom,
    r.record_id ?? '',
    r.utilisateur_nom || r.agent_nom || '',
    r.ip_address || '',
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `journal_audit_${getServerToday()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Diff simple entre l'ancienne et la nouvelle valeur (objets JSON), pour affichage lisible dans le détail.
function diffValeurs(ancienne, nouvelle) {
  const anc = ancienne || {};
  const nouv = nouvelle || {};
  const cles = Array.from(new Set([...Object.keys(anc), ...Object.keys(nouv)]));
  return cles
    .map((cle) => ({ cle, avant: anc[cle], apres: nouv[cle] }))
    .filter((c) => JSON.stringify(c.avant) !== JSON.stringify(c.apres));
}

function formatValeur(v) {
  if (v === undefined) return <span className="text-slate-300">—</span>;
  if (v === null) return <span className="text-slate-400 italic">null</span>;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function Audit() {
  const { data: logs, loading, error, reload } = useFetch(() => client.get('/audit', { params: { limit: 200 } }).then((r) => r.data), []);
  const [dernierRafraichi, setDernierRafraichi] = useState(new Date());
  const rafraichir = () => { reload(); setDernierRafraichi(new Date()); };

  const [filtreAction, setFiltreAction] = useState('');
  const [filtreTable, setFiltreTable] = useState('');
  const [search, setSearch] = useState('');
  const [filtreDepuis, setFiltreDepuis] = useState('');
  const [filtreJusqua, setFiltreJusqua] = useState('');

  const tablesDisponibles = useMemo(() => {
    const s = new Set((logs || []).map((l) => l.table_nom).filter(Boolean));
    return Array.from(s).sort();
  }, [logs]);

  const logsFiltres = useMemo(() => {
    let rows = logs || [];
    if (filtreAction) rows = rows.filter((r) => r.action === filtreAction);
    if (filtreTable) rows = rows.filter((r) => r.table_nom === filtreTable);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) => `${r.utilisateur_nom || ''} ${r.agent_nom || ''} ${r.table_nom || ''}`.toLowerCase().includes(s));
    }
    if (filtreDepuis) rows = rows.filter((r) => new Date(r.date_action) >= new Date(filtreDepuis));
    if (filtreJusqua) rows = rows.filter((r) => new Date(r.date_action) <= new Date(`${filtreJusqua}T23:59:59`));
    return rows;
  }, [logs, filtreAction, filtreTable, search, filtreDepuis, filtreJusqua]);

  const stats = useMemo(() => {
    const rows = logs || [];
    const today = new Date().toDateString();
    const aujourdhui = rows.filter((r) => new Date(r.date_action).toDateString() === today).length;
    const suppressions = rows.filter((r) => r.action === 'suppression').length;
    const auteurs = new Set(rows.map((r) => r.utilisateur_nom || r.agent_nom).filter(Boolean)).size;
    return { total: rows.length, aujourdhui, suppressions, auteurs };
  }, [logs]);

  const [detailLog, setDetailLog] = useState(null);
  const diff = useMemo(() => (detailLog ? diffValeurs(detailLog.ancienne_valeur, detailLog.nouvelle_valeur) : []), [detailLog]);

  const filtresActifs = filtreAction || filtreTable || search || filtreDepuis || filtreJusqua;
  const resetFiltres = () => { setFiltreAction(''); setFiltreTable(''); setSearch(''); setFiltreDepuis(''); setFiltreJusqua(''); };

  return (
    <div>
      <SectionHeader
        title="Journal d'Audit"
        subtitle="Traçabilité des actions sensibles (200 dernières entrées)"
        action={
          <button type="button" className="btn-ghost inline-flex items-center gap-2 text-xs" onClick={rafraichir}>
            <RefreshCw size={14} /> Rafraîchi à {dernierRafraichi.toLocaleTimeString('fr-FR')}
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Entrées (200 max)" value={stats.total} icon={<History size={18} />} tone="brand" />
        <StatCard label="Aujourd'hui" value={stats.aujourdhui} icon={<CalendarClock size={18} />} tone="slate" />
        <StatCard label="Suppressions" value={stats.suppressions} icon={<Trash2 size={18} />} tone={stats.suppressions > 0 ? 'red' : 'slate'} />
        <StatCard label="Auteurs distincts" value={stats.auteurs} icon={<Users size={18} />} tone="accent" />
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-900">Historique des actions</h3>
          <button
            type="button"
            className="btn-ghost inline-flex items-center gap-2"
            disabled={!logsFiltres?.length}
            onClick={() => exportLogsCsv(logsFiltres)}
          >
            <Download size={15} /> Exporter en CSV
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="min-w-[160px]">
            <label className="label inline-flex items-center gap-1"><ListFilter size={12} /> Action</label>
            <select className="input" value={filtreAction} onChange={(e) => setFiltreAction(e.target.value)}>
              <option value="">Toutes les actions</option>
              {Object.entries(ACTION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="label">Table</label>
            <select className="input" value={filtreTable} onChange={(e) => setFiltreTable(e.target.value)}>
              <option value="">Toutes les tables</option>
              {tablesDisponibles.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="label">Auteur / table</label>
            <SearchInput value={search} onChange={setSearch} placeholder="Rechercher un auteur ou une table…" />
          </div>
          <div>
            <label className="label">Depuis le</label>
            <input className="input" type="date" value={filtreDepuis} onChange={(e) => setFiltreDepuis(e.target.value)} />
          </div>
          <div>
            <label className="label">Jusqu&apos;au</label>
            <input className="input" type="date" value={filtreJusqua} onChange={(e) => setFiltreJusqua(e.target.value)} />
          </div>
          {filtresActifs && (
            <button type="button" className="btn-ghost text-sm" onClick={resetFiltres}>Réinitialiser</button>
          )}
        </div>

        <DataTable
          loading={loading} error={error} onRetry={reload} rows={logsFiltres}
          pageSize={20}
          emptyLabel="Aucune entrée pour ces filtres."
          columns={[
            { key: 'date_action', label: 'Date', sortable: true, render: (r) => new Date(r.date_action).toLocaleString('fr-FR') },
            { key: 'action', label: 'Action', sortable: true, render: (r) => <Badge tone={ACTION_TONE[r.action] || 'slate'}>{ACTION_LABEL[r.action] || r.action}</Badge> },
            { key: 'table_nom', label: 'Table', sortable: true },
            { key: 'record_id', label: 'ID' },
            { key: 'utilisateur_nom', label: 'Auteur', sortable: true, sortValue: (r) => r.utilisateur_nom || r.agent_nom || '', render: (r) => r.utilisateur_nom || r.agent_nom || '—' },
            { key: 'ip_address', label: 'Adresse IP', render: (r) => r.ip_address || '—' },
          ]}
          actions={(r) => (
            <button className="btn-ghost !px-2 !py-1 text-brand-700 inline-flex items-center gap-1" onClick={() => setDetailLog(r)}>
              <Eye size={14} /> Détail
            </button>
          )}
        />
      </div>

      {/* Détail d'une entrée du journal */}
      <Modal open={!!detailLog} onClose={() => setDetailLog(null)} title="Détail de l'action" wide>
        {detailLog && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={ACTION_TONE[detailLog.action] || 'slate'}>{ACTION_LABEL[detailLog.action] || detailLog.action}</Badge>
              <Badge tone="slate">{detailLog.table_nom}{detailLog.record_id ? ` #${detailLog.record_id}` : ''}</Badge>
              <span className="text-slate-500">{new Date(detailLog.date_action).toLocaleString('fr-FR')}</span>
            </div>
            <div className="text-slate-600">
              <span className="font-semibold text-slate-700">Auteur : </span>
              {detailLog.utilisateur_nom || detailLog.agent_nom || '—'}
              {detailLog.ip_address && <span className="text-slate-400"> · IP {detailLog.ip_address}</span>}
            </div>

            {diff.length > 0 ? (
              <div>
                <p className="font-semibold text-slate-700 mb-2">Changements</p>
                <div className="overflow-x-auto rounded-lg border border-slate-100">
                  <table className="table-base">
                    <thead>
                      <tr><th>Champ</th><th>Avant</th><th>Après</th></tr>
                    </thead>
                    <tbody>
                      {diff.map((d) => (
                        <tr key={d.cle}>
                          <td className="font-medium text-slate-700">{d.cle}</td>
                          <td className="text-red-600">{formatValeur(d.avant)}</td>
                          <td className="text-emerald-700">{formatValeur(d.apres)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-center py-6">Aucune valeur avant/après enregistrée pour cette entrée.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
