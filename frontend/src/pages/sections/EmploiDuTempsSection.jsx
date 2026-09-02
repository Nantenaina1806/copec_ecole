import { useMemo, useState } from 'react';
import { Printer, FileSpreadsheet, Trash2, Plus, Eraser, Copy, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { LoadingScreen, ErrorState, EmptyState } from '../../components/Feedback';
import { SectionHeader, Badge, SearchInput, SelectInput, TextInput } from '../../components/Shared';
import Modal from '../../components/Modal';
import { printGrid } from '../../utils/exportUtils';
import { couleurMatiere } from '../../utils/matiereColors';
import { getServerNow } from '../../utils/serverClock';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// Jour courant (parmi JOURS) pour mettre en évidence la colonne « aujourd'hui » dans la grille —
// getDay() renvoie 0 (dimanche) à 6 (samedi) ; dimanche n'a pas cours, donc aucune colonne n'est
// mise en évidence ce jour-là (JOUR_ACTUEL vaut undefined, ce qui ne matche aucun élément de JOURS).
const JOUR_ACTUEL = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Indian/Antananarivo', weekday: 'long' }).format(getServerNow()).replace(/^./, (c) => c.toUpperCase());

// Le backend renvoie les horaires au format Postgres TIME ("07:30:00") ; on les affiche
// toujours sans les secondes ("07:30"), y compris pour les valeurs par défaut ("07:00").
function formatHeure(t) {
  return t ? String(t).slice(0, 5) : t;
}

// Regroupe les jours consécutifs (dans l'ordre JOURS) qui ont exactement le même cours
// (matière + enseignant + salle), pour n'afficher le bloc qu'une seule fois (colSpan) au lieu
// de le répéter identique sur chaque jour — usage : emploi du temps du primaire uniquement.
function groupDays(joursCours) {
  const groupes = [];
  let i = 0;
  while (i < joursCours.length) {
    const cur = joursCours[i];
    if (!cur.course) { groupes.push({ jours: [cur.jour], course: null, ids: [] }); i += 1; continue; }
    let j = i + 1;
    while (
      j < joursCours.length && joursCours[j].course
      && joursCours[j].course.matiere_id === cur.course.matiere_id
      && joursCours[j].course.enseignant_id === cur.course.enseignant_id
      && joursCours[j].course.salle === cur.course.salle
    ) { j += 1; }
    const tranche = joursCours.slice(i, j);
    groupes.push({ jours: tranche.map((x) => x.jour), course: cur.course, ids: tranche.map((x) => x.course.id) });
    i = j;
  }
  return groupes;
}

export default function EmploiDuTempsSection() {
  const { user } = useAuth();
  // Le surveillant gère désormais l'emploi du temps au quotidien (ajouter/modifier/retirer un
  // cours, générer automatiquement, publier) sans dépendre de l'admin (backend
  // emploiDuTemps.js : toutes les routes d'écriture passées de admin uniquement à
  // admin+surveillant). L'admin garde une vue globale (lecture) sur cette page — même logique
  // que Classes et Matières — et l'onglet « Construire » (génération auto) n'a de sens que pour
  // qui peut gérer, il est donc masqué pour tous les autres rôles.
  const isAdmin = user?.role === 'admin';
  const isSurveillant = user?.role === 'surveillant';
  const canManage = isSurveillant;
  // Même bannière de contexte que Matières/Classes pour tous les rôles en lecture seule (pas
  // seulement l'admin) : sans elle, la secrétaire et l'enseignant arrivaient sur cette page sans
  // comprendre pourquoi aucun bouton d'ajout/modification n'apparaît.
  const messageLectureSeule = isAdmin
    ? "Vue globale (lecture seule) — l'ajout, la modification, la génération automatique et la publication de l'emploi du temps sont gérés par le surveillant."
    : (!canManage ? "Lecture seule — la construction de l'emploi du temps (cours, génération automatique, publication) est réservée au surveillant et à l'administrateur. Vous pouvez consulter, filtrer, imprimer et exporter l'emploi du temps de chaque classe." : null);
  const [tab, setTab] = useState('classe'); // 'classe' | 'enseignant' | 'construire'
  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);
  const tabActif = tab === 'construire' && !canManage ? 'classe' : tab;

  return (
    <div>
      <SectionHeader title="Emploi du temps" subtitle="Consultation par classe ou génération automatique" />
      {messageLectureSeule && (
        <p className="text-xs text-slate-400 mb-3">{messageLectureSeule}</p>
      )}
      <div className="flex gap-2 mb-5">
        <button className={tabActif === 'classe' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('classe')}>Par classe</button>
        {/* Vue lecture seule, ouverte à tous les rôles ayant accès à cette page : utile à la
            secrétaire pour vérifier la disponibilité d'un enseignant avant de fixer un rendez-vous
            avec un parent, sans dépendre du surveillant ou passer classe par classe. */}
        <button className={tabActif === 'enseignant' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('enseignant')}>Par enseignant</button>
        {canManage && (
          <button className={tabActif === 'construire' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('construire')}>Construire</button>
        )}
      </div>
      {tabActif === 'classe' && <VueParClasse classes={classes} canManage={canManage} />}
      {tabActif === 'enseignant' && <VueParEnseignant />}
      {tabActif === 'construire' && <Construire classes={classes} />}
    </div>
  );
}

const SLOTS_DEFAUT = [
  ['07:00', '08:00'], ['08:00', '09:00'], ['09:00', '10:00'], ['10:00', '11:00'],
  ['11:00', '12:00'], ['13:00', '14:00'], ['14:00', '15:00'], ['15:00', '16:00'], ['16:00', '17:00'],
];

function VueParClasse({ classes, canManage }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [classeId, setClasseId] = useState('');
  const { data: annee } = useFetch(() => client.get('/annees-scolaires/active').then((r) => r.data), []);
  const { data: classeDetail } = useFetch(
    () => classeId ? client.get(`/classes/${classeId}`).then((r) => r.data) : Promise.resolve(null),
    [classeId]
  );
  const { data: edt, loading, error, reload } = useFetch(
    () => classeId ? client.get('/emploi-du-temps', { params: { classe_id: classeId } }).then((r) => r.data) : Promise.resolve([]),
    [classeId]
  );

  const [modal, setModal] = useState(null); // { mode: 'nouveau'|'modifier', jour, heure_debut, heure_fin, entry? }
  const [dupliquerOuvert, setDupliquerOuvert] = useState(false);
  const [enseignantFiltre, setEnseignantFiltre] = useState('');

  const slots = useMemo(() => {
    const reels = (edt || []).map((c) => [formatHeure(c.heure_debut), formatHeure(c.heure_fin)]);
    const vus = new Map();
    reels.forEach(([d, f]) => vus.set(`${d}-${f}`, [d, f]));
    // Un créneau par défaut n'est ajouté que s'il ne chevauche aucun cours réel de cette classe :
    // sinon il ne ferait qu'ajouter une ligne vide redondante à côté du cours déjà affiché
    // (ex. primaire sur grille demi-heure 07:30/08:30 vs grille par défaut à l'heure pile 07:00/08:00).
    SLOTS_DEFAUT.forEach(([d, f]) => {
      const cle = `${d}-${f}`;
      if (vus.has(cle)) return;
      const chevauche = reels.some(([rd, rf]) => d < rf && rd < f);
      if (!chevauche) vus.set(cle, [d, f]);
    });
    return [...vus.values()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [edt]);

  const trouverCours = (jour, debut, fin) => (edt || []).find(
    (c) => c.jour === jour && formatHeure(c.heure_debut) === debut && formatHeure(c.heure_fin) === fin
  );

  const classeCourante = classes?.find((c) => String(c.id) === String(classeId));
  const estPrimaire = classeCourante?.cycle_nom === 'Primaire';

  const imprimer = () => {
    const rowsGrid = slots.map(([debut, fin]) => {
      const cells = {};
      JOURS.forEach((j) => {
        const c = trouverCours(j, debut, fin);
        cells[j] = c ? `${c.matiere_nom} — ${c.enseignant_nom} ${c.enseignant_prenom || ''} (Salle ${c.salle || '—'})` : '';
      });
      return { label: `${formatHeure(debut)}–${formatHeure(fin)}`, cells };
    });
    printGrid({
      title: `Emploi du temps — ${classeCourante?.nom || ''}`,
      subtitle: `${classeCourante?.niveau_nom || ''} · Année scolaire ${annee?.libelle || ''}`,
      jours: JOURS,
      rowsGrid,
    });
  };

  const exporter = () => {
    const lignes = [...(edt || [])].sort((a, b) => JOURS.indexOf(a.jour) - JOURS.indexOf(b.jour) || a.heure_debut.localeCompare(b.heure_debut));
    import('../../utils/excelExport').then((m) => m.exportToExcel({
      columns: [
        { label: 'Jour', value: (r) => r.jour },
        { label: 'Heure début', value: (r) => formatHeure(r.heure_debut) },
        { label: 'Heure fin', value: (r) => formatHeure(r.heure_fin) },
        { label: 'Matière', value: (r) => r.matiere_nom },
        { label: 'Enseignant', value: (r) => `${r.enseignant_nom} ${r.enseignant_prenom || ''}`.trim() },
        { label: 'Salle', value: (r) => r.salle || '' },
      ],
      rows: lignes,
      filename: `emploi_du_temps_${classeCourante?.nom || 'classe'}`,
      sheetName: 'Emploi du temps',
    }));
  };

  // Retire en une fois tous les jours regroupés dans un même bloc fusionné (primaire) —
  // évite de devoir répéter la suppression jour par jour pour un cours identique sur la semaine.
  const supprimerGroupe = async (ids) => {
    if (!ids?.length) return;
    if (!(await confirm({
      title: 'Retirer ce cours',
      message: ids.length > 1 ? `Retirer ce cours pour ces ${ids.length} jours ?` : 'Retirer ce cours de l\'emploi du temps ?',
      danger: true,
    }))) return;
    try {
      await Promise.all(ids.map((id) => client.delete(`/emploi-du-temps/${id}`)));
      toast.success('Cours retiré.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  // Vide entièrement l'emploi du temps de la classe (tous les créneaux, en un clic) — pratique
  // avant de relancer une génération automatique propre, sans retirer chaque cours un par un.
  const viderEmploiDuTemps = async () => {
    if (!(await confirm({
      title: "Vider l'emploi du temps",
      message: `Retirer tous les cours de l'emploi du temps de « ${classeCourante?.nom} » ? Cette action est irréversible.`,
      danger: true,
    }))) return;
    try {
      await client.delete(`/emploi-du-temps/classe/${classeId}`, { params: { annee_scolaire_id: annee?.id } });
      toast.success("Emploi du temps vidé.");
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Emploi du temps</h3>
          <p className="text-sm text-slate-500">Choisis une classe, puis ajoute ou retire des cours.</p>
        </div>
        {classeCourante && (
          <div className="flex items-start gap-4">
            <div className="text-sm text-right text-slate-600">
              <p>Année scolaire : <span className="font-semibold text-slate-900">{annee?.libelle}</span></p>
              <p>Classe : <span className="font-semibold text-slate-900">{classeCourante.nom}</span></p>
              <p>Niveau : <span className="font-semibold text-slate-900">{classeCourante.niveau_nom}</span></p>
            </div>
            <div className="flex flex-col gap-2">
              <button className="btn-secondary inline-flex items-center gap-2" disabled={!edt?.length} onClick={imprimer}><Printer size={15} /> Imprimer</button>
              <button className="btn-secondary inline-flex items-center gap-2" disabled={!edt?.length} onClick={exporter}><FileSpreadsheet size={15} /> Exporter Excel</button>
              {canManage && (
                <button className="btn-secondary inline-flex items-center gap-2" disabled={!edt?.length} onClick={() => setDupliquerOuvert(true)}>
                  <Copy size={15} /> Dupliquer vers une classe
                </button>
              )}
              {canManage && (
                <button className="btn-secondary text-red-600 inline-flex items-center gap-2" disabled={!edt?.length} onClick={viderEmploiDuTemps}>
                  <Eraser size={15} /> Vider
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-1 px-1">
        {classes?.map((c) => (
          <button
            key={c.id}
            onClick={() => setClasseId(String(c.id))}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              String(classeId) === String(c.id) ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {c.nom}
          </button>
        ))}
      </div>

      {!classeId && <EmptyState title="Sélectionnez une classe pour voir son emploi du temps." className="!py-8" />}
      {classeId && loading && <LoadingScreen />}
      {classeId && error && <ErrorState message={error} onRetry={reload} />}

      {classeId && edt && (
        <>
          {classeDetail?.matieres?.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-slate-600">
              {classeDetail.matieres.map((m) => {
                const col = couleurMatiere(m.matiere_nom, m.couleur);
                return (
                  <span key={m.matiere_id} className="inline-flex items-center gap-1.5">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${col.dot}`} />
                    {m.matiere_nom}
                  </span>
                );
              })}
            </div>
          )}
          {canManage && classeDetail?.matieres?.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 text-sm text-amber-800">
              Aucune matière n&apos;est encore assignée à cette classe : ajoutez-en d&apos;abord depuis le menu « Matières » ou « Classes » pour pouvoir créer des cours ici.
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <SearchInput
              value={enseignantFiltre} onChange={setEnseignantFiltre}
              placeholder="Filtrer par enseignant…" label="Filtrer par enseignant" className="!max-w-xs text-sm"
            />
            {canManage && (
              <button
                className="btn-secondary inline-flex items-center gap-2"
                disabled={!classeDetail?.matieres?.length}
                title={!classeDetail?.matieres?.length ? 'Assignez d\'abord une matière à cette classe' : undefined}
                onClick={() => setModal({ mode: 'nouveau', jour: 'Lundi', heure_debut: '07:00', heure_fin: '08:00' })}
              >
                <Plus size={15} /> Nouveau cours (manuel)
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide px-3 py-2 bg-slate-50 border-b border-slate-200 rounded-tl-lg">Horaire</th>
                  {JOURS.map((j, i) => (
                    <th
                      key={j}
                      className={`text-left text-xs font-bold uppercase tracking-wide px-3 py-2 border-b ${i === JOURS.length - 1 ? 'rounded-tr-lg' : ''} ${
                        j === JOUR_ACTUEL ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-slate-50 text-slate-500 border-slate-200'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {j}
                        {j === JOUR_ACTUEL && <span className="w-1.5 h-1.5 rounded-full bg-teal-500" title="Aujourd'hui" />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slots.map(([debut, fin]) => {
                  const joursCours = JOURS.map((j) => ({ jour: j, course: trouverCours(j, debut, fin) }));
                  const groupes = estPrimaire ? groupDays(joursCours) : joursCours.map((jc) => ({ jours: [jc.jour], course: jc.course, ids: jc.course ? [jc.course.id] : [] }));
                  return (
                    <tr key={`${debut}-${fin}`}>
                      <td className="px-3 py-2 border-b border-slate-100 align-top text-xs font-semibold text-slate-700 whitespace-nowrap">
                        {formatHeure(debut)}<br />–<br />{formatHeure(fin)}
                      </td>
                      {groupes.map((g, idx) => {
                        const estAujourdhui = g.jours.includes(JOUR_ACTUEL);
                        if (!g.course) {
                          return (
                            <td key={idx} className={`px-2 py-2 border-b border-slate-100 align-top ${estAujourdhui ? 'bg-teal-50/40' : ''}`}>
                              {canManage ? (
                                <button
                                  className="w-full h-full min-h-[52px] rounded-lg border border-dashed border-slate-200 text-slate-300 text-xs hover:border-teal-300 hover:text-teal-500 transition-colors"
                                  onClick={() => setModal({ mode: 'nouveau', jour: g.jours[0], heure_debut: debut, heure_fin: fin })}
                                >
                                  –
                                </button>
                              ) : (
                                <div className="w-full h-full min-h-[52px] rounded-lg border border-dashed border-slate-100 text-slate-200 text-xs flex items-center justify-center">–</div>
                              )}
                            </td>
                          );
                        }
                        const c = g.course;
                        const col = couleurMatiere(c.matiere_nom, c.matiere_couleur);
                        const enseignantMatch = enseignantFiltre && `${c.enseignant_nom} ${c.enseignant_prenom || ''}`.toLowerCase().includes(enseignantFiltre.toLowerCase());
                        const estAtenue = enseignantFiltre && !enseignantMatch;
                        return (
                          <td key={idx} colSpan={g.jours.length} className={`px-2 py-2 border-b border-slate-100 align-top ${estAujourdhui ? 'bg-teal-50/40' : ''}`}>
                            <div
                              className={`rounded-lg ${col.bg} border ${col.border} p-2 text-xs relative transition-opacity ${canManage ? 'cursor-pointer' : ''} ${estAtenue ? 'opacity-30' : ''} ${enseignantMatch ? 'ring-2 ring-teal-400' : ''}`}
                              onClick={canManage ? () => setModal({ mode: 'modifier', entry: c, jour: c.jour, heure_debut: c.heure_debut, heure_fin: c.heure_fin }) : undefined}
                            >
                              {canManage && (
                                <button
                                  className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-white/70 text-slate-500 hover:bg-white hover:text-red-600"
                                  onClick={(e) => { e.stopPropagation(); supprimerGroupe(g.ids); }}
                                  title="Retirer"
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                              <p className={`font-bold ${col.title}`}>{c.matiere_nom}</p>
                              <p className={col.text}>{c.enseignant_nom} {c.enseignant_prenom}</p>
                              <p className={col.text}>Salle {c.salle}</p>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modal && (
        <CoursModal
          modal={modal}
          onClose={() => setModal(null)}
          classe={classeCourante}
          matieresClasse={classeDetail?.matieres || []}
          anneeScolaireId={annee?.id}
          onSaved={() => { setModal(null); reload(); }}
        />
      )}

      {dupliquerOuvert && (
        <DupliquerModal
          classes={classes}
          classeSourceId={classeId}
          classeSourceNom={classeCourante?.nom}
          edtSource={edt || []}
          anneeScolaireId={annee?.id}
          onClose={() => setDupliquerOuvert(false)}
        />
      )}
    </div>
  );
}

function DupliquerModal({ classes, classeSourceId, classeSourceNom, edtSource, anneeScolaireId, onClose }) {
  const toast = useToast();
  const [classeCibleId, setClasseCibleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [resultat, setResultat] = useState(null);
  const [controle, setControle] = useState(null);
  const [controleBusy, setControleBusy] = useState(false); // { ok, echecs: [{ label, message }] }

  const classesCibles = (classes || []).filter((c) => String(c.id) !== String(classeSourceId));

  const dupliquer = async () => {
    if (!classeCibleId || !anneeScolaireId) return;
    setBusy(true);
    setResultat(null);
    const echecs = [];
    let ok = 0;
    for (const cours of edtSource) {
      try {
        await client.post('/emploi-du-temps', {
          classe_id: Number(classeCibleId),
          matiere_id: cours.matiere_id,
          enseignant_id: cours.enseignant_id,
          annee_scolaire_id: anneeScolaireId,
          jour: cours.jour,
          heure_debut: formatHeure(cours.heure_debut),
          heure_fin: formatHeure(cours.heure_fin),
          salle: cours.salle || null,
        });
        ok += 1;
      } catch (err) {
        echecs.push({ label: `${cours.jour} ${formatHeure(cours.heure_debut)}–${formatHeure(cours.heure_fin)} · ${cours.matiere_nom}`, message: apiErrorMessage(err) });
      }
    }
    setResultat({ ok, echecs });
    setBusy(false);
    if (ok > 0 && echecs.length === 0) toast.success(`${ok} cours dupliqué(s) avec succès.`);
    else if (ok > 0) toast.error(`${ok} cours copié(s), ${echecs.length} échec(s) — voir le détail ci-dessous.`);
    else toast.error("Aucun cours n'a pu être dupliqué — voir le détail ci-dessous.");
  };

  const classeCibleNom = classesCibles.find((c) => String(c.id) === String(classeCibleId))?.nom;

  return (
    <Modal open onClose={onClose} title="Dupliquer l'emploi du temps vers une autre classe">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Copie chaque cours de <span className="font-semibold text-slate-900">{classeSourceNom}</span> vers la classe choisie.
          Un cours n&apos;est copié que si l&apos;enseignant est bien autorisé pour cette matière sur la classe cible et si aucun conflit
          d&apos;horaire, de salle ou d&apos;enseignant n&apos;existe déjà — les échecs éventuels sont listés ci-dessous, un par un.
        </p>
        <SelectInput label="Classe de destination" value={classeCibleId} onChange={(e) => { setClasseCibleId(e.target.value); setResultat(null); }}>
          <option value="">— Choisir une classe —</option>
          {classesCibles.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </SelectInput>

        {!edtSource.length && (
          <p className="text-sm text-amber-600">Cette classe n&apos;a aucun cours à dupliquer pour l&apos;instant.</p>
        )}

        {resultat && (
          <div className="rounded-lg border border-slate-200 p-3 text-sm space-y-2 max-h-56 overflow-y-auto">
            <p className="font-medium text-slate-800">
              {resultat.ok} sur {resultat.ok + resultat.echecs.length} cours copié(s) vers {classeCibleNom}.
            </p>
            {resultat.echecs.length > 0 && (
              <ul className="space-y-1">
                {resultat.echecs.map((e, i) => (
                  <li key={i} className="text-xs text-red-600">
                    <span className="font-medium">{e.label}</span> — {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>{resultat ? 'Fermer' : 'Annuler'}</button>
          {!resultat?.ok && (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              disabled={!classeCibleId || !edtSource.length || busy}
              onClick={dupliquer}
            >
              <Copy size={15} /> {busy ? 'Duplication…' : 'Dupliquer'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CoursModal({ modal, onClose, classe, matieresClasse, anneeScolaireId, onSaved }) {
  const toast = useToast();
  const entry = modal.entry;
  const [form, setForm] = useState({
    jour: modal.jour,
    heure_debut: formatHeure(modal.heure_debut),
    heure_fin: formatHeure(modal.heure_fin),
    matiere_id: entry?.matiere_id ? String(entry.matiere_id) : '',
    enseignant_id: entry?.enseignant_id ? String(entry.enseignant_id) : '',
    salle: entry?.salle || classe?.salle || '',
  });
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const { data: enseignants } = useFetch(
    () => (form.matiere_id && classe?.id && anneeScolaireId)
      ? client.get('/affectations/disponibles', {
          params: { classe_id: classe.id, matiere_id: form.matiere_id, annee_scolaire_id: anneeScolaireId, jour: form.jour, heure_debut: form.heure_debut, heure_fin: form.heure_fin, exclude_id: entry?.id },
        }).then((r) => r.data)
      : Promise.resolve([]),
    [form.matiere_id, form.jour, form.heure_debut, form.heure_fin, classe?.id, anneeScolaireId, entry?.id]
  );

  const controlePret = Boolean(form.matiere_id && form.enseignant_id && classe?.id && anneeScolaireId && form.jour && form.heure_debut && form.heure_fin && form.heure_fin > form.heure_debut);
  const { data: controle, loading: controleLoading } = useFetch(
    () => controlePret
      ? client.get('/emploi-du-temps/conflits', { params: {
          classe_id: classe.id, matiere_id: form.matiere_id, enseignant_id: form.enseignant_id,
          annee_scolaire_id: anneeScolaireId, jour: form.jour, heure_debut: form.heure_debut,
          heure_fin: form.heure_fin, salle: form.salle || '', exclude_id: entry?.id,
        } }).then((r) => r.data)
      : Promise.resolve(null),
    [controlePret, form.matiere_id, form.enseignant_id, form.jour, form.heure_debut, form.heure_fin, form.salle, classe?.id, anneeScolaireId, entry?.id]
  );

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.matiere_id) errs.matiere_id = 'Choisissez une matière.';
    if (!form.enseignant_id) errs.enseignant_id = 'Choisissez un enseignant.';
    if (form.heure_fin <= form.heure_debut) errs.heure_fin = 'L’heure de fin doit être après l’heure de début.';
    if (controle && !controle.ok) errs.global = 'Ce créneau contient un conflit.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setBusy(true);
    try {
      const payload = {
        classe_id: classe.id,
        matiere_id: Number(form.matiere_id),
        enseignant_id: Number(form.enseignant_id),
        annee_scolaire_id: anneeScolaireId,
        jour: form.jour,
        heure_debut: form.heure_debut,
        heure_fin: form.heure_fin,
        salle: form.salle || null,
      };
      if (modal.mode === 'modifier') {
        await client.put(`/emploi-du-temps/${entry.id}`, payload);
        toast.success('Cours modifié.');
      } else {
        await client.post('/emploi-du-temps', payload);
        toast.success('Cours ajouté.');
      }
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={modal.mode === 'modifier' ? 'Modifier le cours' : 'Nouveau cours (manuel)'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <SelectInput label="Jour" value={form.jour} onChange={set('jour')}>
            {JOURS.map((j) => <option key={j} value={j}>{j}</option>)}
          </SelectInput>
          <TextInput label="Salle" value={form.salle} onChange={set('salle')} />
          <TextInput label="Heure début" type="time" value={form.heure_debut} onChange={set('heure_debut')} />
          <TextInput label="Heure fin" type="time" value={form.heure_fin} onChange={set('heure_fin')} error={fieldErrors.heure_fin} />
        </div>
        <SelectInput
          label="Matière" required value={form.matiere_id} error={fieldErrors.matiere_id}
          onChange={(e) => { setForm((f) => ({ ...f, matiere_id: e.target.value, enseignant_id: '' })); setFieldErrors((er) => ({ ...er, matiere_id: undefined })); }}
        >
          <option value="">— Choisir une matière —</option>
          {matieresClasse.map((m) => <option key={m.matiere_id} value={m.matiere_id}>{m.matiere_nom}</option>)}
        </SelectInput>
        <SelectInput
          label="Enseignant" required value={form.enseignant_id} onChange={set('enseignant_id')} disabled={!form.matiere_id}
          error={fieldErrors.enseignant_id}
        >
          <option value="">{form.matiere_id ? '— Choisir un enseignant disponible —' : 'Choisissez d\'abord une matière'}</option>
          {enseignants?.map((e) => <option key={e.enseignant_id} value={e.enseignant_id}>{e.nom} {e.prenom}</option>)}
        </SelectInput>
        {form.matiere_id && enseignants?.length === 0 && (
          <p className="text-xs text-amber-600 -mt-2">Aucun enseignant disponible sur ce créneau pour cette matière/classe.</p>
        )}
        {controleLoading && controlePret && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">Vérification des conflits…</div>
        )}
        {!controleLoading && controle?.ok && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-start gap-2">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <div><p className="font-semibold">Créneau libre</p><p className="text-xs mt-0.5">Classe, enseignant et salle ne présentent aucun conflit.</p></div>
          </div>
        )}
        {!controleLoading && controle && !controle.ok && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <div className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Créneau impossible</p><ul className="list-disc list-inside text-xs mt-1 space-y-0.5">{controle.erreurs?.map((e) => <li key={e}>{e.replace(/^CHECK \d+ : /, '')}</li>)}</ul></div></div>
          </div>
        )}
        {fieldErrors.global && <p className="text-xs text-red-600">{fieldErrors.global}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={busy || controleLoading || (controle && !controle.ok)}>{busy ? 'Enregistrement…' : (modal.mode === 'modifier' ? 'Enregistrer' : 'Ajouter')}</button>
        </div>
      </form>
    </Modal>
  );
}

// Vue de consultation transverse (toutes classes confondues) pour un enseignant donné — pas de
// grille fusionnée par créneau ici (un enseignant peut avoir des classes différentes sur un même
// horaire selon les jours), une liste chronologique par jour suffit et reste plus lisible.
function VueParEnseignant() {
  const [enseignantId, setEnseignantId] = useState('');
  const { data: enseignants } = useFetch(
    () => client.get('/utilisateurs').then((r) => r.data.filter((u) => u.role === 'enseignant' && u.actif)),
    []
  );
  const { data: edt, loading, error, reload } = useFetch(
    () => enseignantId ? client.get('/emploi-du-temps', { params: { enseignant_id: enseignantId } }).then((r) => r.data) : Promise.resolve([]),
    [enseignantId]
  );
  const enseignantCourant = enseignants?.find((e) => String(e.id) === String(enseignantId));

  const slots = useMemo(() => {
    const uniques = new Map();
    (edt || []).forEach((c) => {
      const cle = `${formatHeure(c.heure_debut)}-${formatHeure(c.heure_fin)}`;
      uniques.set(cle, [formatHeure(c.heure_debut), formatHeure(c.heure_fin)]);
    });
    return [...uniques.values()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [edt]);

  const imprimer = () => {
    const rowsGrid = slots.map(([debut, fin]) => {
      const cells = {};
      JOURS.forEach((j) => {
        const cours = (edt || []).filter((c) => c.jour === j && formatHeure(c.heure_debut) === debut && formatHeure(c.heure_fin) === fin);
        cells[j] = cours.map((c) => `${c.matiere_nom} — ${c.classe_nom} (Salle ${c.salle || '—'})`).join(' / ');
      });
      return { label: `${debut}–${fin}`, cells };
    });
    printGrid({
      title: `Emploi du temps — ${enseignantCourant?.prenom || ''} ${enseignantCourant?.nom || ''}`.trim(),
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`,
      jours: JOURS,
      rowsGrid,
    });
  };

  const exporter = () => {
    const lignes = [...(edt || [])].sort((a, b) => JOURS.indexOf(a.jour) - JOURS.indexOf(b.jour) || a.heure_debut.localeCompare(b.heure_debut));
    import('../../utils/excelExport').then((m) => m.exportToExcel({
      columns: [
        { label: 'Jour', value: (r) => r.jour },
        { label: 'Heure début', value: (r) => formatHeure(r.heure_debut) },
        { label: 'Heure fin', value: (r) => formatHeure(r.heure_fin) },
        { label: 'Classe', value: (r) => r.classe_nom },
        { label: 'Matière', value: (r) => r.matiere_nom },
        { label: 'Salle', value: (r) => r.salle || '' },
      ],
      rows: lignes,
      filename: `emploi_du_temps_${enseignantCourant?.nom || 'enseignant'}`,
      sheetName: 'Emploi du temps',
    }));
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Emploi du temps par enseignant</h3>
          <p className="text-sm text-slate-500">Utile pour vérifier la disponibilité d&apos;un enseignant avant de fixer un rendez-vous ou de transmettre un message.</p>
        </div>
        {enseignantCourant && (
          <div className="flex gap-2">
            <button className="btn-secondary inline-flex items-center gap-2" disabled={!edt?.length} onClick={imprimer}><Printer size={15} /> Imprimer</button>
            <button className="btn-secondary inline-flex items-center gap-2" disabled={!edt?.length} onClick={exporter}><FileSpreadsheet size={15} /> Exporter Excel</button>
          </div>
        )}
      </div>

      <div className="max-w-xs mb-5">
        <SelectInput label="Enseignant" hideLabel value={enseignantId} onChange={(e) => setEnseignantId(e.target.value)}>
          <option value="">— Choisir un enseignant —</option>
          {enseignants?.map((ens) => <option key={ens.id} value={ens.id}>{ens.prenom} {ens.nom}</option>)}
        </SelectInput>
      </div>

      {!enseignantId && <EmptyState title="Sélectionnez un enseignant pour voir son emploi du temps." className="!py-8" />}
      {enseignantId && loading && <LoadingScreen />}
      {enseignantId && error && <ErrorState message={error} onRetry={reload} />}
      {enseignantId && !loading && edt?.length === 0 && (
        <EmptyState title="Aucun cours programmé pour cet enseignant." className="!py-8" />
      )}

      {enseignantId && edt?.length > 0 && (
        <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-3">
          {JOURS.map((j) => {
            const coursJour = (edt || []).filter((c) => c.jour === j).sort((a, b) => a.heure_debut.localeCompare(b.heure_debut));
            return (
              <div key={j}>
                <p className={`text-xs font-semibold uppercase mb-2 ${j === JOUR_ACTUEL ? 'text-teal-700' : 'text-slate-500'}`}>{j}</p>
                <div className="space-y-2">
                  {coursJour.map((c) => {
                    const col = couleurMatiere(c.matiere_nom, c.matiere_couleur);
                    return (
                      <div key={c.id} className={`rounded-lg ${col.bg} border ${col.border} p-2 text-xs`}>
                        <p className={`font-semibold ${col.title}`}>{formatHeure(c.heure_debut)}–{formatHeure(c.heure_fin)}</p>
                        <p className={col.text}>{c.matiere_nom}</p>
                        <p className={col.text}>{c.classe_nom}{c.salle ? ` · Salle ${c.salle}` : ''}</p>
                      </div>
                    );
                  })}
                  {coursJour.length === 0 && <p className="text-xs text-slate-300">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Construire({ classes }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [classeId, setClasseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [resultat, setResultat] = useState(null);
  const [controle, setControle] = useState(null);
  const [controleBusy, setControleBusy] = useState(false);
  const classeCourante = classes?.find((c) => String(c.id) === String(classeId));
  const estPrimaire = classeCourante?.cycle_nom === 'Primaire';

  // Primaire : pas d'algorithme à lancer (un seul titulaire, pas de matière à répartir) — une
  // grille fixe (Lundi-Jeudi 07h-11h + 14h-17h, Vendredi 07h-11h uniquement) est appliquée
  // directement, sans étape brouillon/publication (contrairement à generer/confirmer/publier
  // ci-dessous, pensés pour le Collège/Secondaire où plusieurs placements sont possibles).
  const genererPrimaire = async () => {
    if (!classeId) return;
    if (!classeCourante?.titulaire_id) {
      toast.error("Cette classe n'a pas encore de titulaire — assignez-en un depuis la page Classes d'abord.");
      return;
    }
    if (!(await confirm({
      title: "Générer l'emploi du temps standard",
      message: `Remplacer l'emploi du temps actuel de « ${classeCourante.nom} » par la grille standard du Primaire (Lundi-Jeudi 7h-11h + 14h-17h, Vendredi 7h-11h) ?`,
    }))) return;
    setBusy(true);
    try {
      const { data: annee } = await client.get('/annees-scolaires/active');
      await client.post('/emploi-du-temps/generer-primaire', { classe_id: classeId, annee_scolaire_id: annee.id });
      toast.success('Emploi du temps standard généré et visible immédiatement (voir l\'onglet « Par classe »).');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const controlerGlobal = async () => {
    setControleBusy(true);
    try {
      const { data: annee } = await client.get('/annees-scolaires/active');
      const { data } = await client.get('/emploi-du-temps/controle-global', { params: { annee_scolaire_id: annee.id } });
      setControle(data);
      if (data.ok) toast.success('Contrôle global : EDT cohérent et volumes horaires couverts.');
      else toast.error('Contrôle global : des points nécessitent une correction.');
    } catch (err) { toast.error(apiErrorMessage(err)); }
    finally { setControleBusy(false); }
  };

  const generer = async () => {
    if (!classeId) return;
    setBusy(true);
    setResultat(null);
    try {
      const { data: annee } = await client.get('/annees-scolaires/active');
      const { data } = await client.post('/emploi-du-temps/generer', { classe_id: classeId, annee_scolaire_id: annee.id });
      setResultat({ ...data, annee_scolaire_id: annee.id });
      if (data.success) toast.success('Génération réussie. Vérifiez l\'aperçu avant de confirmer.');
      else toast.error('Génération incomplète — voir le détail ci-dessous.');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmer = async () => {
    if (!resultat) return;
    setBusy(true);
    try {
      await client.post('/emploi-du-temps/confirmer', {
        classe_id: classeId, annee_scolaire_id: resultat.annee_scolaire_id, placements: resultat.apercu,
      });
      toast.success('Emploi du temps enregistré en brouillon.');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const imprimerApercu = () => {
    if (!resultat) return;
    const rowsGrid = JOURS.flatMap((j) => resultat.apercu.filter((c) => c.jour === j)).reduce((acc, c) => {
      const cle = `${formatHeure(c.heure_debut)}–${formatHeure(c.heure_fin)}`;
      if (!acc[cle]) acc[cle] = { label: cle, cells: {} };
      acc[cle].cells[c.jour] = `${c.matiere_nom} — ${c.enseignant_nom}`;
      return acc;
    }, {});
    printGrid({
      title: `Aperçu emploi du temps — ${classeCourante?.nom || ''}`,
      subtitle: `Généré automatiquement le ${new Date().toLocaleDateString('fr-FR')} — brouillon non encore publié`,
      jours: JOURS,
      rowsGrid: Object.values(rowsGrid).sort((a, b) => a.label.localeCompare(b.label)),
    });
  };

  const exporterApercu = () => {
    if (!resultat) return;
    const lignes = [...resultat.apercu].sort((a, b) => JOURS.indexOf(a.jour) - JOURS.indexOf(b.jour) || a.heure_debut.localeCompare(b.heure_debut));
    import('../../utils/excelExport').then((m) => m.exportToExcel({
      columns: [
        { label: 'Jour', value: (r) => r.jour },
        { label: 'Heure début', value: (r) => formatHeure(r.heure_debut) },
        { label: 'Heure fin', value: (r) => formatHeure(r.heure_fin) },
        { label: 'Matière', value: (r) => r.matiere_nom },
        { label: 'Enseignant', value: (r) => r.enseignant_nom },
      ],
      rows: lignes,
      filename: `apercu_emploi_du_temps_${classeCourante?.nom || 'classe'}`,
      sheetName: 'Aperçu',
    }));
  };

  const publier = async () => {
    if (!resultat) return;
    if (!(await confirm({
      title: 'Publier l\'emploi du temps',
      message: 'Il sera visible immédiatement par les enseignants, élèves et parents de cette classe. Continuer ?',
    }))) return;
    setBusy(true);
    try {
      await client.put('/emploi-du-temps/publier', { classe_id: classeId, annee_scolaire_id: resultat.annee_scolaire_id });
      toast.success('Emploi du temps publié — visible par les enseignants et élèves.');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="card">
        {estPrimaire ? (
          <p className="text-sm text-slate-600 mb-4">
            Le Primaire n&apos;a pas de matière à répartir : le titulaire couvre seul sa classe sur une grille fixe et identique
            chaque semaine — Lundi à Jeudi 7h-11h + 14h-17h, Vendredi 7h-11h uniquement (pas d&apos;après-midi). La génération
            remplace directement l&apos;emploi du temps existant de la classe, sans étape de brouillon à publier.
          </p>
        ) : (
          <p className="text-sm text-slate-600 mb-4">
            L&apos;algorithme décompose automatiquement le volume horaire de chaque matière (règle 2=2h, 3=2h+1h, 4=2h+2h…),
            évite les conflits enseignant/classe/salle et n&apos;attribue jamais deux fois la même matière le même jour.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="max-w-xs flex-1">
            <SelectInput label="Classe" value={classeId} onChange={(e) => { setClasseId(e.target.value); setResultat(null); }}>
              <option value="">— Choisir une classe —</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </SelectInput>
          </div>
          <button className="btn-secondary" disabled={controleBusy} onClick={controlerGlobal}>
            {controleBusy ? 'Contrôle…' : 'Contrôler tout l’EDT'}
          </button>
          {estPrimaire ? (
            <button className="btn-primary" disabled={!classeId || busy} onClick={genererPrimaire}>
              {busy ? 'Génération…' : 'Générer les créneaux standards'}
            </button>
          ) : (
            <button className="btn-primary inline-flex items-center gap-2" disabled={!classeId || busy} onClick={generer}>
              <RefreshCw size={15} /> {busy ? 'Génération…' : 'Générer automatiquement'}
            </button>
          )}
        </div>
        {estPrimaire && !classeCourante?.titulaire_id && classeId && (
          <p className="text-xs text-amber-600 mt-2">Cette classe n&apos;a pas encore de titulaire — assignez-en un depuis la page Classes avant de générer.</p>
        )}
      </div>

      {controle && (
        <div className="card">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div><h3 className="font-semibold text-slate-800">Contrôle global</h3><p className="text-xs text-slate-500 mt-1">Vérification avant publication : volumes horaires, conflits et charge des enseignants.</p></div>
            <Badge tone={controle.ok ? 'green' : 'amber'}>{controle.ok ? 'OK' : 'À corriger'}</Badge>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Matières contrôlées</p><p className="text-xl font-bold">{controle.resume.matieres_controlees}</p></div>
            <div className={`rounded-lg border p-3 ${controle.resume.deficits ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}><p className="text-xs text-slate-500">Volumes insuffisants</p><p className="text-xl font-bold">{controle.resume.deficits}</p></div>
            <div className={`rounded-lg border p-3 ${controle.resume.surplus ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}><p className="text-xs text-slate-500">Volumes en surplus</p><p className="text-xl font-bold">{controle.resume.surplus}</p></div>
            <div className={`rounded-lg border p-3 ${controle.resume.conflits ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}><p className="text-xs text-slate-500">Conflits</p><p className="text-xl font-bold">{controle.resume.conflits}</p></div>
          </div>
          {(controle.resume.deficits || controle.resume.surplus) ? (
            <div className="mt-4 grid md:grid-cols-2 gap-3">
              {controle.matieres.filter(x => Math.abs(Number(x.ecart)) > 0.001).slice(0, 12).map(x => <div key={`${x.classe_id}-${x.matiere_id}`} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="font-medium">{x.classe_nom} · {x.matiere_nom}</div><div className="text-xs text-slate-500 mt-1">Requis {x.heures_requises}h · Planifié {x.heures_planifiees}h · Écart {x.ecart > 0 ? '+' : ''}{x.ecart}h</div></div>)}
            </div>
          ) : null}
        </div>
      )}

      {!estPrimaire && resultat && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">
              Aperçu {resultat.success ? <Badge tone="green">Complet</Badge> : <Badge tone="amber">Incomplet</Badge>}
            </h3>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary inline-flex items-center gap-2" onClick={imprimerApercu} disabled={busy}><Printer size={15} /> Imprimer</button>
              <button className="btn-secondary inline-flex items-center gap-2" onClick={exporterApercu} disabled={busy}><FileSpreadsheet size={15} /> Exporter Excel</button>
              <button className="btn-secondary" onClick={confirmer} disabled={busy || !resultat.success}>Enregistrer en brouillon</button>
              <button className="btn-primary" onClick={publier} disabled={busy || !resultat.success}>Publier</button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Créneaux générés</p><p className="text-xl font-bold text-slate-900">{resultat.apercu?.length || 0}</p></div>
            <div className={`rounded-lg border p-3 ${resultat.success ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><p className="text-xs text-slate-500">État</p><p className="text-sm font-bold mt-1">{resultat.success ? 'Aucun conflit détecté' : 'Planification à corriger'}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Tentatives</p><p className="text-xl font-bold text-slate-900">{resultat.tentatives ?? '—'}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Matières incomplètes</p><p className="text-xl font-bold text-slate-900">{resultat.incomplet?.length || 0}</p></div>
          </div>
          {!resultat.success && resultat.message && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4 text-sm text-amber-900 flex items-start gap-2"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span>{resultat.message}</span></div>
          )}

          {resultat.incomplet?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
              <p className="font-medium mb-1">Heures non placées :</p>
              <ul className="list-disc list-inside">
                {resultat.incomplet.map((m) => (
                  <li key={m.matiere_id}>{m.matiere_nom} : {m.placees}h / {m.demandees}h demandées</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-3">
            {JOURS.map((j) => (
              <div key={j}>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">{j}</p>
                <div className="space-y-2">
                  {resultat.apercu.filter((c) => c.jour === j).sort((a, b) => a.heure_debut.localeCompare(b.heure_debut)).map((c, i) => {
                    const col = couleurMatiere(c.matiere_nom, c.matiere_couleur);
                    return (
                      <div key={i} className={`rounded-lg ${col.bg} border ${col.border} p-2 text-xs`}>
                        <p className={`font-semibold ${col.title}`}>{formatHeure(c.heure_debut)}–{formatHeure(c.heure_fin)}</p>
                        <p className={col.text}>{c.matiere_nom}</p>
                        <p className={col.text}>{c.enseignant_nom}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
