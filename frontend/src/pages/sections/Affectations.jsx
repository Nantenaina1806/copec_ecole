import { useMemo, useState } from 'react';
import {
  X, Plus, Crown, Users, LayoutGrid, CheckCircle2, AlertTriangle, UserCog, GraduationCap,
} from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, Badge, SearchInput, SelectInput, Checkbox } from '../../components/Shared';
import { LoadingScreen, ErrorState, EmptyState } from '../../components/Feedback';
import StatCard from '../../components/StatCard';
import DataTable from '../../components/DataTable';
import { printTable } from '../../utils/exportUtils';

function initialesDe(nom, prenom) {
  return `${prenom?.[0] || ''}${nom?.[0] || ''}`.toUpperCase() || '?';
}

function Avatar({ nom, prenom }) {
  return (
    <div className="h-8 w-8 shrink-0 rounded-full bg-brand-800 text-white flex items-center justify-center text-xs font-semibold">
      {initialesDe(nom, prenom)}
    </div>
  );
}

const MATRICE_EXPORT_COLUMNS = [
  { label: 'Classe', value: (r) => r.classe_nom },
  { label: 'Matière', value: (r) => r.matiere_nom },
  { label: 'Enseignant', value: (r) => `${r.enseignant_prenom || ''} ${r.enseignant_nom}`.trim() },
];

const ENSEIGNANTS_EXPORT_COLUMNS = [
  { label: 'Enseignant', value: (r) => `${r.prenom || ''} ${r.nom}`.trim() },
  { label: 'Matières connues', value: (r) => r.matieresConnues.map((m) => m.matiere_nom).join(', ') || '—' },
  { label: 'Classes affectées', value: (r) => r.nbClasses },
  { label: 'Postes occupés', value: (r) => r.affectations.length },
];

// Matrice Classe × Matière : montre, pour chaque case, l'enseignant affecté (s'il y en a un) ou un bouton "+".
// Étape 1 (RG-011) : l'enseignant doit d'abord connaître la matière (enseignant_matiere).
// Étape 2 (RG-012) : on l'affecte ensuite à une classe précise pour cette matière (enseignant_matiere_classe).
//
// Élargissement du rôle secrétaire (même logique que Examens/Certificats) : le secrétariat gère
// désormais directement les affectations enseignant/matière/classe (RG-011/RG-012/RG-020), sans
// attendre l'admin. Seule l'admin reste toutefois affichée distinctement si un jour une action
// plus sensible devait lui être réservée ici.
export default function Affectations() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isSecretaire = user?.role === 'secretaire';
  const peutGerer = isAdmin || isSecretaire;

  const toast = useToast();
  const confirm = useConfirm();
  const [vue, setVue] = useState('matrice'); // 'matrice' | 'enseignant'
  const [anneeId, setAnneeId] = useState('');
  const [cellule, setCellule] = useState(null); // { classeId, classeNom, matiereId, matiereNom } — vide (libre) pour "Nouvelle affectation"
  const [search, setSearch] = useState('');
  const [seulementIncomplet, setSeulementIncomplet] = useState(false);
  const [searchEns, setSearchEns] = useState('');
  const [seulementSansPoste, setSeulementSansPoste] = useState(false);

  const { data: annees } = useFetch(() => client.get('/annees-scolaires').then((r) => r.data), []);
  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);
  const { data: matieres } = useFetch(() => client.get('/matieres').then((r) => r.data), []);
  // /utilisateurs ne filtre pas par rôle côté API -> on filtre les enseignants ici.
  const { data: utilisateurs } = useFetch(() => client.get('/utilisateurs').then((r) => r.data), []);
  const enseignants = useMemo(() => (utilisateurs || []).filter((u) => u.role === 'enseignant' && u.actif), [utilisateurs]);

  const anneeEffective = anneeId || annees?.find((a) => a.actif)?.id || '';

  // Primaire : un seul titulaire par classe, affecté automatiquement (page Classes) sur la
  // matière vata-jo "Enseignement Primaire" (code PRIMGEN) — pas de matrice matière × classe à
  // remplir manuellement ici, contrairement au Collège/Secondaire. On les sépare donc de la vue
  // matrice/modale, et on les présente à part (lecture seule).
  const classesMatrice = useMemo(() => (classes || []).filter((c) => c.cycle_nom !== 'Primaire'), [classes]);
  const classesPrimaire = useMemo(() => (classes || []).filter((c) => c.cycle_nom === 'Primaire'), [classes]);
  const classesPrimaireIds = useMemo(() => new Set(classesPrimaire.map((c) => c.id)), [classesPrimaire]);
  const matieresMatrice = useMemo(() => (matieres || []).filter((m) => m.code !== 'PRIMGEN'), [matieres]);

  const {
    data: emc, loading, error, reload,
  } = useFetch(
    () => client.get('/affectations/enseignant-matiere-classe', { params: { annee_scolaire_id: anneeEffective || undefined } }).then((r) => r.data),
    [anneeEffective]
  );
  const { data: em, reload: reloadEm } = useFetch(
    () => client.get('/affectations/enseignant-matiere', { params: { annee_scolaire_id: anneeEffective || undefined } }).then((r) => r.data),
    [anneeEffective]
  );
  // Quelles matières sont réellement étudiées par chaque classe (classe_matiere) : sert à ne pas
  // afficher de case "à affecter" pour une matière que la classe n'étudie pas du tout.
  const { data: classeMatiere } = useFetch(() => client.get('/affectations/classe-matiere').then((r) => r.data), []);

  // classe_id::matiere_id -> ligne(s) enseignant_matiere_classe
  const cellules = useMemo(() => {
    const map = new Map();
    (emc || []).forEach((row) => {
      const key = `${row.classe_id}::${row.matiere_id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
    return map;
  }, [emc]);

  // classe_id::matiere_id -> vrai si la classe étudie effectivement cette matière (classe_matiere)
  const matieresEtudiees = useMemo(() => {
    const set = new Set();
    (classeMatiere || []).forEach((row) => set.add(`${row.classe_id}::${row.matiere_id}`));
    return set;
  }, [classeMatiere]);

  // Enseignants qui connaissent déjà chaque matière (enseignant_matiere), pour peupler le sélecteur
  const enseignantsParMatiere = useMemo(() => {
    const map = new Map();
    (em || []).forEach((row) => {
      if (!map.has(row.matiere_id)) map.set(row.matiere_id, []);
      map.get(row.matiere_id).push(row);
    });
    return map;
  }, [em]);

  // Couverture : sur toutes les cases classe×matière réellement étudiées, combien ont un
  // enseignant — le Primaire est exclu (affecté automatiquement, ce n'est pas un "poste à
  // pourvoir" au sens de cette page).
  const couverture = useMemo(() => {
    const pertinentes = (classeMatiere || []).filter((cm) => !classesPrimaireIds.has(cm.classe_id));
    const total = pertinentes.length;
    if (!total) return { couvertes: 0, total: 0 };
    const couvertes = pertinentes.filter((cm) => (cellules.get(`${cm.classe_id}::${cm.matiere_id}`) || []).length > 0).length;
    return { couvertes, total };
  }, [classeMatiere, cellules, classesPrimaireIds]);

  const enseignantsMobilises = useMemo(() => new Set((emc || []).map((r) => r.enseignant_id)).size, [emc]);

  const classesFiltrees = useMemo(() => {
    let rows = classesMatrice;
    if (search) rows = rows.filter((c) => c.nom.toLowerCase().includes(search.toLowerCase()));
    if (seulementIncomplet) {
      rows = rows.filter((c) => matieresMatrice?.some((m) => {
        const key = `${c.id}::${m.id}`;
        return matieresEtudiees.has(key) && (cellules.get(key) || []).length === 0;
      }));
    }
    return rows;
  }, [classesMatrice, search, seulementIncomplet, matieresMatrice, matieresEtudiees, cellules]);

  // Vue "par enseignant" : regroupe les affectations et matières connues par enseignant, pour
  // suivre la charge de chacun et repérer d'un coup d'œil qui n'a encore aucun poste.
  const enseignantsAvecCharge = useMemo(() => enseignants.map((ens) => {
    const affectations = (emc || []).filter((r) => r.enseignant_id === ens.id);
    const matieresConnues = (em || []).filter((r) => r.enseignant_id === ens.id);
    const nbClasses = new Set(affectations.map((a) => a.classe_id)).size;
    return { ...ens, affectations, matieresConnues, nbClasses };
  }), [enseignants, emc, em]);

  const enseignantsFiltres = useMemo(() => {
    let rows = enseignantsAvecCharge;
    if (searchEns) rows = rows.filter((r) => `${r.prenom} ${r.nom}`.toLowerCase().includes(searchEns.toLowerCase()));
    if (seulementSansPoste) rows = rows.filter((r) => r.affectations.length === 0);
    return rows;
  }, [enseignantsAvecCharge, searchEns, seulementSansPoste]);

  const retirer = async (row) => {
    if (!(await confirm({ title: 'Retirer l\'affectation', message: `Retirer ${row.enseignant_prenom} ${row.enseignant_nom} de cette classe pour cette matière ?`, danger: true }))) return;
    try {
      await client.delete(`/affectations/enseignant-matiere-classe/${row.id}`);
      toast.success('Affectation retirée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const imprimer = () => {
    if (vue === 'matrice') {
      printTable({
        title: 'Affectations enseignants — Matrice Classe × Matière',
        subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')} — ${couverture.couvertes}/${couverture.total} postes couverts`,
        columns: MATRICE_EXPORT_COLUMNS,
        rows: emc || [],
      });
    } else {
      printTable({
        title: 'Affectations enseignants — Par enseignant',
        subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')} — ${enseignantsMobilises} enseignant(s) mobilisé(s)`,
        columns: ENSEIGNANTS_EXPORT_COLUMNS,
        rows: enseignantsFiltres,
      });
    }
  };

  const exporter = () => {
    if (vue === 'matrice') {
      import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: MATRICE_EXPORT_COLUMNS, rows: emc || [], filename: 'affectations_matrice', sheetName: 'Affectations' }));
    } else {
      import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: ENSEIGNANTS_EXPORT_COLUMNS, rows: enseignantsFiltres, filename: 'affectations_par_enseignant', sheetName: 'Enseignants' }));
    }
  };

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const aPourvoir = couverture.total - couverture.couvertes;

  return (
    <div>
      <SectionHeader
        title="Affectations enseignants"
        subtitle="Qui enseigne quoi, dans quelle classe — matrice et vue par enseignant"
        action={(
          <SelectInput label="Année scolaire" hideLabel className="w-56" value={anneeEffective} onChange={(e) => setAnneeId(e.target.value)}>
            {annees?.map((a) => <option key={a.id} value={a.id}>{a.libelle}{a.actif ? ' (active)' : ''}</option>)}
          </SelectInput>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        <StatCard label="Postes à couvrir" value={couverture.total} icon={<LayoutGrid size={18} />} tone="slate" sub="classe × matière étudiées" />
        <StatCard label="Postes couverts" value={couverture.couvertes} icon={<CheckCircle2 size={18} />} tone="brand" />
        <StatCard
          label="Postes à pourvoir"
          value={aPourvoir}
          icon={<AlertTriangle size={18} />}
          tone={aPourvoir > 0 ? 'accent' : 'slate'}
        />
        <StatCard label="Enseignants mobilisés" value={enseignantsMobilises} icon={<Users size={18} />} tone="slate" sub={`sur ${enseignants.length} actif(s)`} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 gap-1">
          <button
            type="button"
            onClick={() => setVue('matrice')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${vue === 'matrice' ? 'bg-white shadow-sm text-brand-800' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <LayoutGrid size={14} /> Matrice
          </button>
          <button
            type="button"
            onClick={() => setVue('enseignant')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${vue === 'enseignant' ? 'bg-white shadow-sm text-brand-800' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <UserCog size={14} /> Par enseignant
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={imprimer}>🖨️ Imprimer</button>
          <button className="btn-secondary" onClick={exporter}>📊 Exporter Excel</button>
          {peutGerer && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setCellule({ classeId: '', classeNom: '', matiereId: '', matiereNom: '' })}
            >
              <Plus size={15} className="inline -mt-0.5 mr-1" />Nouvelle affectation
            </button>
          )}
        </div>
      </div>

      {vue === 'matrice' ? (
        <div className="card overflow-x-auto">
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <div className="max-w-xs flex-1">
              <SearchInput value={search} onChange={setSearch} placeholder="Ex : 6ème A…" label="Rechercher une classe" />
            </div>
            <Checkbox
              label="Classes avec postes non couverts uniquement"
              className="pb-2"
              checked={seulementIncomplet}
              onChange={(e) => setSeulementIncomplet(e.target.checked)}
            />
          </div>

          <table className="table-base">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white">Classe \ Matière</th>
                {matieresMatrice?.map((m) => <th key={m.id}>{m.nom}</th>)}
              </tr>
            </thead>
            <tbody>
              {classesFiltrees?.map((c) => (
                <tr key={c.id}>
                  <td className="sticky left-0 bg-white font-medium">{c.nom}</td>
                  {matieresMatrice?.map((m) => {
                    const key = `${c.id}::${m.id}`;
                    const rows = cellules.get(key) || [];
                    const etudiee = matieresEtudiees.has(key);

                    if (!etudiee) {
                      return <td key={m.id} className="align-top min-w-[9rem] bg-slate-50/60 text-center text-slate-300">—</td>;
                    }

                    const couvre = rows.length > 0;
                    return (
                      <td key={m.id} className={`align-top min-w-[9rem] ${couvre ? 'bg-emerald-50/40' : 'bg-red-50/40'}`}>
                        <div className="flex flex-col gap-1">
                          {rows.map((r) => {
                            const estTitulaire = c.titulaire_id === r.enseignant_id;
                            return (
                              <span key={r.id} className="inline-flex items-center gap-1 badge bg-brand-50 text-brand-800">
                                {estTitulaire && <Crown size={11} className="text-amber-500" />}
                                {r.enseignant_prenom} {r.enseignant_nom}
                                {peutGerer && (
                                  <button onClick={() => retirer(r)} className="hover:text-red-600" aria-label="Retirer">
                                    <X size={11} />
                                  </button>
                                )}
                              </span>
                            );
                          })}
                          {peutGerer && (
                            <button
                              className="text-xs text-brand-700 hover:underline text-left inline-flex items-center gap-0.5"
                              onClick={() => setCellule({ classeId: c.id, classeNom: c.nom, matiereId: m.id, matiereNom: m.nom })}
                            >
                              <Plus size={11} /> Affecter
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {classesFiltrees?.length === 0 && <EmptyState title="Aucune classe ne correspond à ce filtre." className="!py-8" />}
          <div className="flex flex-wrap items-center gap-4 pt-4 mt-2 border-t border-slate-100 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-200" /> Poste couvert</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-50 border border-red-200" /> Poste à pourvoir</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-50 border border-slate-200" /> Matière non étudiée par la classe</span>
            <span className="inline-flex items-center gap-1.5"><Crown size={12} className="text-amber-500" /> Titulaire de la classe</span>
          </div>
        </div>
      ) : null}

      {vue === 'matrice' && (
        <div className="card mt-4">
          <h3 className="font-semibold text-slate-800 mb-1 inline-flex items-center gap-1.5">
            <GraduationCap size={16} className="text-brand-700" /> Titulaires — Primaire
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Un seul titulaire par classe, affecté automatiquement dès qu&apos;il est choisi dans la page « Classes » — géré ici en lecture seule.
          </p>
          {classesPrimaire.length === 0 ? (
            <EmptyState title="Aucune classe primaire pour le moment." className="!py-6" />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {classesPrimaire.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <span className="font-medium text-slate-800 text-sm">{c.nom}</span>
                  {c.titulaire_nom ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                      <Crown size={12} className="text-amber-500" /> {c.titulaire_prenom} {c.titulaire_nom}
                    </span>
                  ) : (
                    <Badge tone="red">Sans titulaire</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {vue === 'enseignant' && (
        <div className="card">
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <div className="max-w-xs flex-1">
              <SearchInput value={searchEns} onChange={setSearchEns} placeholder="Nom, prénom…" label="Rechercher un enseignant" />
            </div>
            <Checkbox
              label="Sans affectation uniquement"
              className="pb-2"
              checked={seulementSansPoste}
              onChange={(e) => setSeulementSansPoste(e.target.checked)}
            />
          </div>
          <DataTable
            rows={enseignantsFiltres}
            pageSize={10}
            emptyLabel="Aucun enseignant ne correspond à ce filtre."
            renderExpanded={(row) => (
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Classes affectées</p>
                  {row.affectations.length === 0 ? (
                    <p className="text-sm text-slate-400">Aucune classe affectée pour le moment.</p>
                  ) : (
                    <ul className="space-y-1">
                      {row.affectations.map((a) => (
                        <li key={a.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-md px-2.5 py-1.5">
                          <span>{a.classe_nom} — {a.matiere_nom}</span>
                          {peutGerer && (
                            <button onClick={() => retirer(a)} className="text-slate-400 hover:text-red-600" aria-label="Retirer">
                              <X size={13} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Matières connues</p>
                  {row.matieresConnues.length === 0 ? (
                    <p className="text-sm text-slate-400">Aucune matière associée.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {row.matieresConnues.map((mc) => <Badge key={mc.id} tone="brand">{mc.matiere_nom}</Badge>)}
                    </div>
                  )}
                </div>
              </div>
            )}
            columns={[
              {
                key: 'enseignant',
                label: 'Enseignant',
                sortable: true,
                sortValue: (r) => `${r.nom} ${r.prenom}`,
                render: (r) => (
                  <div className="flex items-center gap-2.5">
                    <Avatar nom={r.nom} prenom={r.prenom} />
                    <span className="font-medium text-slate-800">{r.prenom} {r.nom}</span>
                  </div>
                ),
              },
              {
                key: 'matieresConnues',
                label: 'Matières connues',
                render: (r) => (r.matieresConnues.length
                  ? <div className="flex flex-wrap gap-1">{r.matieresConnues.slice(0, 3).map((mc) => <Badge key={mc.id} tone="slate">{mc.matiere_nom}</Badge>)}{r.matieresConnues.length > 3 && <Badge tone="slate">+{r.matieresConnues.length - 3}</Badge>}</div>
                  : <span className="text-slate-300">—</span>),
              },
              {
                key: 'nbClasses',
                label: 'Classes affectées',
                sortable: true,
                render: (r) => <Badge tone={r.nbClasses > 0 ? 'green' : 'red'}>{r.nbClasses}</Badge>,
              },
              {
                key: 'postes',
                label: 'Postes occupés',
                sortable: true,
                sortValue: (r) => r.affectations.length,
                render: (r) => r.affectations.length,
              },
            ]}
            actions={(r) => (
              peutGerer && (
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 text-xs"
                  onClick={() => setCellule({ classeId: '', classeNom: '', matiereId: '', matiereNom: '', enseignantId: r.id })}
                >
                  <Plus size={13} className="inline -mt-0.5 mr-0.5" /> Affecter
                </button>
              )
            )}
          />
        </div>
      )}

      {cellule && peutGerer && (
        <CelluleModal
          cellule={cellule}
          anneeId={anneeEffective}
          classes={classesMatrice}
          matieres={matieresMatrice}
          matieresEtudiees={matieresEtudiees}
          enseignants={enseignants}
          enseignantsParMatiere={enseignantsParMatiere}
          onClose={() => setCellule(null)}
          onSaved={() => { setCellule(null); reload(); reloadEm(); }}
        />
      )}
    </div>
  );
}

function CelluleModal({
  cellule, anneeId, classes, matieres, matieresEtudiees, enseignants, enseignantsParMatiere, onClose, onSaved,
}) {
  const toast = useToast();
  // Mode "libre" : ouvert depuis le bouton "Nouvelle affectation" (classe/matière pas encore choisies).
  // Mode "case" : ouvert depuis une case de la matrice, classe/matière déjà fixées.
  const libre = !cellule.classeId;
  const [classeId, setClasseId] = useState(cellule.classeId || '');
  const [matiereId, setMatiereId] = useState(cellule.matiereId || '');
  const [enseignantId, setEnseignantId] = useState(cellule.enseignantId ? String(cellule.enseignantId) : '');
  const [autorisationSpeciale, setAutorisationSpeciale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const classeNom = classes?.find((c) => String(c.id) === String(classeId))?.nom || cellule.classeNom;
  const matiereNom = matieres?.find((m) => String(m.id) === String(matiereId))?.nom || cellule.matiereNom;

  // En mode libre, on ne propose que les matières réellement étudiées par la classe choisie.
  const matieresDisponibles = (matieres || []).filter((m) => !classeId || matieresEtudiees.has(`${classeId}::${m.id}`));

  const enseignantsConnaissantMatiere = matiereId ? (enseignantsParMatiere.get(Number(matiereId)) || []) : [];
  const dejaConnue = new Set(enseignantsConnaissantMatiere.map((e) => e.enseignant_id));

  const affecter = async () => {
    const errs = {};
    if (!classeId) errs.classeId = 'Choisissez une classe.';
    if (!matiereId) errs.matiereId = 'Choisissez une matière.';
    if (!enseignantId) errs.enseignantId = 'Choisissez un enseignant.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setSaving(true);
    try {
      // Étape 1 (RG-011) : s'assurer que l'enseignant connaît la matière, sinon l'associer d'abord.
      if (!dejaConnue.has(Number(enseignantId))) {
        await client.post('/affectations/enseignant-matiere', { enseignant_id: enseignantId, matiere_id: matiereId, annee_scolaire_id: anneeId });
      }
      // Étape 2 (RG-012) : affecter à la classe.
      await client.post('/affectations/enseignant-matiere-classe', {
        enseignant_id: enseignantId, matiere_id: matiereId, classe_id: classeId, annee_scolaire_id: anneeId,
        autorisation_speciale: autorisationSpeciale || undefined,
      });
      toast.success('Affectation enregistrée.');
      onSaved();
    } catch (err) {
      // RG-020 : la classe primaire a déjà un titulaire -> on propose l'autorisation spéciale plutôt que d'échouer silencieusement.
      if (err?.response?.status === 409 && !autorisationSpeciale) {
        setAutorisationSpeciale(true);
        toast.error("Cette classe a déjà un titulaire. Cochez « autorisation spéciale » puis réessayez si c'est voulu.");
      } else {
        toast.error(apiErrorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
        <h3 className="font-semibold text-slate-900 mb-1">
          {libre ? 'Nouvelle affectation' : `Affecter — ${matiereNom}`}
        </h3>
        {!libre && <p className="text-sm text-slate-500 mb-4">Classe : {classeNom}</p>}

        {libre && (
          <>
            <SelectInput
              label="Classe" value={classeId}
              error={fieldErrors.classeId}
              onChange={(e) => { setClasseId(e.target.value); setMatiereId(''); setFieldErrors((er) => ({ ...er, classeId: undefined })); }}
            >
              <option value="">— Choisir —</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </SelectInput>

            <SelectInput
              label="Matière" value={matiereId} disabled={!classeId} error={fieldErrors.matiereId}
              onChange={(e) => { setMatiereId(e.target.value); setFieldErrors((er) => ({ ...er, matiereId: undefined })); }}
            >
              <option value="">{classeId ? '— Choisir —' : 'Choisissez d\'abord une classe'}</option>
              {matieresDisponibles.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </SelectInput>
            {classeId && matieresDisponibles.length === 0 && (
              <p className="text-xs text-amber-600 mb-2">Cette classe n&apos;étudie aucune matière configurée pour le moment.</p>
            )}
          </>
        )}

        <SelectInput
          label="Enseignant" value={enseignantId} disabled={!matiereId} error={fieldErrors.enseignantId}
          onChange={(e) => { setEnseignantId(e.target.value); setFieldErrors((er) => ({ ...er, enseignantId: undefined })); }}
        >
          <option value="">{matiereId ? '— Choisir —' : 'Choisissez d\'abord une matière'}</option>
          {enseignants?.map((ens) => (
            <option key={ens.id} value={ens.id}>
              {ens.prenom} {ens.nom}{!dejaConnue.has(ens.id) ? ' (nouvelle matière pour lui)' : ''}
            </option>
          ))}
        </SelectInput>

        {autorisationSpeciale && (
          <Checkbox
            label="Autoriser un intervenant supplémentaire sur cette classe primaire (déjà un titulaire)"
            className="text-amber-700 mb-3"
            checked={autorisationSpeciale}
            onChange={(e) => setAutorisationSpeciale(e.target.checked)}
          />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Annuler</button>
          <button type="button" className="btn-primary" onClick={affecter} disabled={saving}>Affecter</button>
        </div>
      </div>
    </div>
  );
}
