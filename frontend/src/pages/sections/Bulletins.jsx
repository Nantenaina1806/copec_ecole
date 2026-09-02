import { useMemo, useState } from 'react';
import { Eye, Printer, Lock, FileSpreadsheet, RefreshCw } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { SectionHeader, SearchInput, SelectInput, TextareaInput, Badge } from '../../components/Shared';
import { EmptyState } from '../../components/Feedback';
import StatCard from '../../components/StatCard';
import { printTable, mentionMoyenne } from '../../utils/exportUtils';
import BulletinCompletModal from '../../components/BulletinCompletModal';

// Décisions possibles du conseil de classe (générées automatiquement, mais modifiables
// manuellement depuis le détail d'un bulletin — voir enregistrerAppreciation).
const DECISIONS_POSSIBLES = ['Félicitations', 'Encouragements', "Tableau d'honneur", 'Passable', 'Avertissement travail', 'Blâme'];

function bulletinsExportColumns(inclureClasse) {
  return [
    { label: 'Élève', value: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}`.trim() },
    ...(inclureClasse ? [{ label: 'Classe', value: (r) => r.classe_nom || '' }] : []),
    { label: 'Moyenne / 20', value: (r) => Number(r.moyenne_generale).toFixed(2) },
    { label: 'Mention', value: (r) => mentionMoyenne(r.moyenne_generale).label },
    { label: 'Rang', value: (r) => `${r.rang} / ${r.effectif_classe}` },
    { label: 'Généré le', value: (r) => new Date(r.date_generation).toLocaleDateString('fr-FR') },
  ];
}

// Couleur de la moyenne : rouge < 10, ambre 10-11.99, vert >= 12 (mêmes seuils que Notes).
function toneMoyenne(valeur) {
  const v = Number(valeur);
  if (Number.isNaN(v)) return 'slate';
  if (v < 10) return 'red';
  if (v < 12) return 'amber';
  return 'green';
}

// Couleur de la décision auto-générée (voir genererDecisionBimestre côté backend).
function toneDecision(decision) {
  if (['Félicitations', 'Encouragements', "Tableau d'honneur"].includes(decision)) return 'green';
  if (decision === 'Passable') return 'amber';
  if (decision === 'Avertissement travail') return 'violet';
  if (decision === 'Blâme') return 'red';
  return 'slate';
}

function medaille(rang) {
  if (rang === 1) return '🥇';
  if (rang === 2) return '🥈';
  if (rang === 3) return '🥉';
  return null;
}

export default function Bulletins() {
  const { user } = useAuth();
  const isSecretaire = user?.role === 'secretaire';
  const peutCloturer = user?.role === 'admin' || isSecretaire;
  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);
  const { data: bimestres } = useFetch(() => client.get('/bimestres').then((r) => r.data), []);
  const [classeId, setClasseId] = useState('');
  const [bimestreId, setBimestreId] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editAppreciation, setEditAppreciation] = useState('');
  const [editDecision, setEditDecision] = useState('');
  const [savingAppreciation, setSavingAppreciation] = useState(false);
  const [completEleveId, setCompletEleveId] = useState(null);
  const [dernierRafraichi, setDernierRafraichi] = useState(new Date());
  const toast = useToast();
  const confirm = useConfirm();

  const { data: bulletinsBruts, loading, error, reload } = useFetch(
    () => (classeId && bimestreId)
      ? client.get('/bulletins', { params: { bimestre_id: bimestreId, ...(classeId !== 'tous' ? { classe_id: classeId } : {}) } }).then((r) => r.data)
      : Promise.resolve([]),
    [classeId, bimestreId]
  );

  const rafraichir = () => { reload(); setDernierRafraichi(new Date()); };

  const bulletins = useMemo(() => {
    let rows = bulletinsBruts || [];
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) => `${r.eleve_prenom || ''} ${r.eleve_nom}`.toLowerCase().includes(s));
    }
    return rows;
  }, [bulletinsBruts, search]);

  const classeNom = classeId === 'tous' ? 'Toutes les classes' : (classes?.find((c) => String(c.id) === String(classeId))?.nom || '');
  const bimestreSelectionne = bimestres?.find((t) => String(t.id) === String(bimestreId));
  const bimestreLibelle = bimestreSelectionne?.libelle || '';

  const statsBulletins = useMemo(() => {
    if (!bulletins?.length) return null;
    const valeurs = bulletins.map((b) => Number(b.moyenne_generale)).filter((v) => !Number.isNaN(v));
    if (!valeurs.length) return null;
    const somme = valeurs.reduce((acc, v) => acc + v, 0);
    return {
      nb: bulletins.length,
      moyenne: (somme / valeurs.length).toFixed(2),
      max: Math.max(...valeurs).toFixed(2),
      min: Math.min(...valeurs).toFixed(2),
      enDifficulte: valeurs.filter((v) => v < 10).length,
    };
  }, [bulletins]);

  const imprimer = () => {
    printTable({
      title: `Bulletins — ${classeNom}`,
      subtitle: `${bimestreLibelle} · Généré le ${new Date().toLocaleDateString('fr-FR')}${statsBulletins ? ` · Moyenne classe : ${statsBulletins.moyenne}/20` : ''}`,
      columns: bulletinsExportColumns(classeId === 'tous'),
      rows: bulletins,
    });
  };

  const exporter = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({
      columns: bulletinsExportColumns(classeId === 'tous'),
      rows: bulletins,
      filename: `bulletins_${classeNom || 'classe'}_${bimestreLibelle || ''}`.replace(/\s+/g, '_'),
      sheetName: 'Bulletins',
    }));
  };

  const generer = async () => {
    if (!classeId || !bimestreId) return;
    setBusy(true);
    try {
      const { data: annee } = await client.get('/annees-scolaires/active');
      const { data } = await client.post('/bulletins/generer-classe', { classe_id: classeId, bimestre_id: bimestreId, annee_scolaire_id: annee.id });
      toast.success(data.message);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const voirDetail = async (b) => {
    setDetailLoading(true);
    try {
      const { data } = await client.get(`/bulletins/${b.id}/detail`);
      setDetail(data);
      setEditAppreciation(data.appreciation_generale || '');
      setEditDecision(data.decision || '');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const enregistrerAppreciation = async () => {
    if (!detail) return;
    setSavingAppreciation(true);
    try {
      const { data } = await client.put(`/bulletins/${detail.id}`, {
        appreciation_generale: editAppreciation,
        decision: editDecision,
      });
      setDetail((prev) => ({ ...prev, ...data }));
      toast.success('Appréciation et décision mises à jour.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSavingAppreciation(false);
    }
  };

  const imprimerUn = (b) => {
    setCompletEleveId(b.eleve_id);
  };

  const cloturer = async () => {
    if (!bimestreId) return;
    if (!(await confirm({
      title: 'Clôturer le bimestre',
      message: `Clôturer « ${bimestreLibelle} » ? Les enseignants ne pourront plus modifier les notes de ce bimestre.`,
      danger: true,
      confirmLabel: 'Clôturer',
    }))) return;
    try {
      const { data } = await client.put(`/bulletins/bimestre/${bimestreId}/cloturer`);
      toast.success(data.message);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div>
      <SectionHeader
        title="Bulletins"
        subtitle={
          'Calcul automatique des moyennes et du rang à partir des notes saisies'
          + (statsBulletins ? ` — Moyenne classe : ${statsBulletins.moyenne}/20` : '')
        }
        action={(
          <div className="flex flex-wrap gap-2 items-center">
            <button className="btn-secondary inline-flex items-center gap-2" disabled={!classeId || !bimestreId || !bulletins?.length} onClick={imprimer}><Printer size={15} /> Imprimer la liste</button>
            <button className="btn-secondary inline-flex items-center gap-2" disabled={!classeId || !bimestreId || !bulletins?.length} onClick={exporter}><FileSpreadsheet size={15} /> Exporter Excel</button>
            {classeId && bimestreId && (
              <button type="button" className="btn-ghost inline-flex items-center gap-2 text-xs" onClick={rafraichir} title="Rafraîchir">
                <RefreshCw size={14} /> {dernierRafraichi.toLocaleTimeString('fr-FR')}
              </button>
            )}
          </div>
        )}
      />

      {classeId && bimestreId && statsBulletins && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
          <StatCard label="Bulletins générés" value={statsBulletins.nb} icon="📋" />
          <StatCard label="Moyenne classe" value={`${statsBulletins.moyenne}/20`} icon="📊" tone="brand" />
          <StatCard label="Meilleure moyenne" value={`${statsBulletins.max}/20`} icon="🥇" />
          <StatCard label="Moyenne la plus basse" value={`${statsBulletins.min}/20`} icon="📉" tone={Number(statsBulletins.min) < 10 ? 'red' : 'slate'} />
          <StatCard label="En difficulté (<10)" value={statsBulletins.enDifficulte} icon="⚠️" tone={statsBulletins.enDifficulte > 0 ? 'accent' : 'slate'} />
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-end gap-3 mb-5">
          <div className="max-w-xs flex-1">
            <SelectInput label="Classe" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
              <option value="">— Choisir —</option>
              <option value="tous">Toutes les classes</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </SelectInput>
          </div>
          <div className="max-w-xs flex-1">
            <label className="label">Bimestre</label>
            <div className="flex items-center gap-2">
              <SelectInput label="Bimestre" hideLabel className="flex-1" value={bimestreId} onChange={(e) => setBimestreId(e.target.value)}>
                <option value="">— Choisir —</option>
                {bimestres?.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}
              </SelectInput>
              {bimestreSelectionne && (
                <Badge tone={bimestreSelectionne.actif ? 'green' : 'slate'}>
                  {bimestreSelectionne.actif ? 'Actif' : 'Clôturé'}
                </Badge>
              )}
            </div>
          </div>
          <button className="btn-primary" disabled={!classeId || classeId === 'tous' || !bimestreId || busy} onClick={generer} title={classeId === 'tous' ? 'Choisissez une classe précise pour générer ses bulletins' : undefined}>
            {busy ? 'Génération…' : 'Générer les bulletins de la classe'}
          </button>
          {peutCloturer && bimestreSelectionne?.actif && (
            <button className="btn-secondary text-red-700" disabled={!bimestreId} onClick={cloturer} title="Verrouille la saisie des notes pour ce bimestre">
              <Lock size={14} className="inline -mt-0.5 mr-1" /> Clôturer le bimestre
            </button>
          )}
        </div>

        {(!classeId || !bimestreId) && <EmptyState title="Choisissez une classe et un bimestre." className="!py-8" />}

        {classeId && bimestreId && (
          <>
            <div className="mb-4">
              <SearchInput value={search} onChange={setSearch} placeholder="Rechercher un élève…" label="Rechercher un élève" />
            </div>
            <DataTable
              loading={loading} error={error} onRetry={reload} rows={bulletins}
              pageSize={15}
              columns={[
                { key: 'eleve_nom', label: 'Élève', sortable: true, render: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}` },
                ...(classeId === 'tous' ? [{ key: 'classe_nom', label: 'Classe', sortable: true }] : []),
                {
                  key: 'moyenne_generale', label: 'Moyenne', sortable: true,
                  sortValue: (r) => Number(r.moyenne_generale),
                  render: (r) => <Badge tone={toneMoyenne(r.moyenne_generale)}>{Number(r.moyenne_generale).toFixed(2)}/20</Badge>,
                },
                {
                  key: 'mention', label: 'Mention',
                  render: (r) => {
                    const m = mentionMoyenne(r.moyenne_generale);
                    return <Badge tone={m.tone}>{m.label}</Badge>;
                  },
                },
                {
                  key: 'rang', label: 'Rang', sortable: true,
                  render: (r) => <span>{medaille(r.rang) && <span className="mr-1">{medaille(r.rang)}</span>}{r.rang} / {r.effectif_classe}</span>,
                },
                {
                  key: 'decision', label: 'Décision',
                  render: (r) => (r.decision ? <Badge tone={toneDecision(r.decision)}>{r.decision}</Badge> : <span className="text-slate-400 text-xs">—</span>),
                },
                { key: 'date_generation', label: 'Généré le', sortable: true, render: (r) => new Date(r.date_generation).toLocaleDateString('fr-FR') },
              ]}
              actions={(b) => (
                <div className="flex justify-end gap-1">
                  <button className="btn-ghost !p-1.5" title="Voir le détail" onClick={() => voirDetail(b)}>
                    <Eye size={15} />
                  </button>
                  <button className="btn-ghost !p-1.5" title="Imprimer le bulletin officiel Recto-Verso" onClick={() => imprimerUn(b)}>
                    <Printer size={15} />
                  </button>
                </div>
              )}
            />
          </>
        )}
      </div>

      <Modal open={!!detail || detailLoading} onClose={() => setDetail(null)} title="Détail du bulletin" wide>
        {detailLoading && <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p>}
        {detail && !detailLoading && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-900">{detail.nom} {detail.prenom}</p>
                <p className="text-sm text-slate-500">{detail.classe_nom} · {detail.bimestre_libelle} · Matricule {detail.matricule || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={toneMoyenne(detail.moyenne_generale)}>{Number(detail.moyenne_generale).toFixed(2)}/20</Badge>
                <Badge tone={mentionMoyenne(detail.moyenne_generale).tone}>{mentionMoyenne(detail.moyenne_generale).label}</Badge>
              </div>
            </div>

            <DataTable
              rows={detail.matieres}
              rowKey="id"
              columns={[
                { key: 'matiere_nom', label: 'Matière' },
                { key: 'coefficient', label: 'Coef.' },
                { key: 'moyenne', label: 'Moyenne', render: (m) => <Badge tone={toneMoyenne(m.moyenne)}>{Number(m.moyenne).toFixed(2)}/20</Badge> },
                { key: 'total_points', label: 'Points', render: (m) => Number(m.total_points).toFixed(2) },
              ]}
            />

            <div className="grid grid-cols-2 gap-3 text-sm">
              <p><span className="text-slate-500">Rang :</span> {detail.rang} / {detail.effectif_classe}</p>
              <p><span className="text-slate-500">Absences / retards :</span> {detail.absent_total ?? 0} / {detail.retard_total ?? 0}</p>
            </div>

            <div className="border-t border-slate-200 pt-3 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Appréciation &amp; décision (générées automatiquement, modifiables)</p>
              <TextareaInput
                label="Appréciation générale"
                rows={2}
                value={editAppreciation}
                onChange={(e) => setEditAppreciation(e.target.value)}
              />
              <div className="max-w-xs">
                <SelectInput label="Décision du conseil de classe" value={editDecision} onChange={(e) => setEditDecision(e.target.value)}>
                  <option value="">— Aucune —</option>
                  {DECISIONS_POSSIBLES.map((d) => <option key={d} value={d}>{d}</option>)}
                </SelectInput>
              </div>
              <div className="flex justify-end">
                <button
                  className="btn-secondary text-xs"
                  disabled={savingAppreciation || (editAppreciation === (detail.appreciation_generale || '') && editDecision === (detail.decision || ''))}
                  onClick={enregistrerAppreciation}
                >
                  {savingAppreciation ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setDetail(null)}>Fermer</button>
              <button className="btn-primary inline-flex items-center gap-2" onClick={() => { setCompletEleveId(detail.eleve_id); setDetail(null); }}>
                <Printer size={15} /> Imprimer Bulletin Officiel (Recto-Verso)
              </button>
            </div>
          </div>
        )}
      </Modal>

      <BulletinCompletModal eleveId={completEleveId} open={!!completEleveId} onClose={() => setCompletEleveId(null)} />
    </div>
  );
}
