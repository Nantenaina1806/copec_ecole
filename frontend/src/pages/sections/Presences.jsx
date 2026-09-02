import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Check, X, Plus, Pencil, Trash2, RotateCcw, ClipboardList, Printer, FileSpreadsheet, RefreshCw } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { getServerToday } from '../../utils/serverClock';
import { useFetch } from '../../hooks/useFetch';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { SectionHeader, Badge, SearchInput, SelectInput, TextInput } from '../../components/Shared';
import { EmptyState } from '../../components/Feedback';
import { printTable } from '../../utils/exportUtils';

// NB : 'excuse' n'existe pas dans la contrainte CHECK de pointage_eleve (présent/absent/retard
// uniquement, cf. database/schema.sql) — le proposer dans le correcteur de l'appel provoquait une
// erreur 500 silencieuse. On garde le libellé/couleur pour l'affichage (au cas où une donnée
// historique l'aurait), mais on ne l'offre plus comme choix de correction (STATUTS_CORRIGIBLES).
const STATUT_TONE = { present: 'green', absent: 'red', retard: 'amber', excuse: 'slate' };
const STATUT_LABEL = { present: 'Présent', absent: 'Absent', retard: 'Retard', excuse: 'Excusé' };
const STATUTS_CORRIGIBLES = ['present', 'absent', 'retard'];
const VALIDATION_TONE = { auto: 'green', en_attente_validation: 'amber', valide_admin: 'green', rejete: 'red' };
const VALIDATION_LABEL = { auto: 'Auto-validé', en_attente_validation: 'En attente', valide_admin: 'Validé', rejete: 'Rejeté' };
const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const TABS = [
  { key: 'appel', label: 'Appel élèves' },
  { key: 'absences', label: 'Absences élèves' },
  { key: 'absences_ens', label: 'Absences enseignants' },
  { key: 'validation', label: 'Pointages à valider' },
];

export default function Presences() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isSurveillant = user?.role === 'surveillant';
  const isSecretaire = user?.role === 'secretaire';
  // Le surveillant gère l'appel et la supervision terrain au quotidien ; le secrétariat est en
  // pratique le premier point de contact pour les justificatifs et les déclarations d'absence
  // (famille ou enseignant qui prévient), donc il gère lui aussi désormais tout le cycle de vie
  // des absences (créer/justifier/corriger/supprimer, élèves comme enseignants) sans dépendre de
  // l'admin. L'admin garde une vue globale (lecture) sur les 4 onglets — même logique que
  // Classes/Matières/Emploi du temps (canManage = isSurveillant || isSecretaire).
  const canManage = isSurveillant || isSecretaire;
  // Actions déjà ouvertes à d'autres rôles avant cette évolution (enseignant, secrétaire) : on ne
  // leur retire rien, on retire seulement l'admin (qui passe en vue globale pure).
  const peutAgir = !isAdmin;
  // Faire/corriger l'appel : réservé côté backend à enseignant/admin/surveillant (POST
  // /pointage/appel). Le secrétaire n'y a jamais eu accès ; l'admin n'agit plus non plus.
  const peutFaireAppel = isSurveillant || user?.role === 'enseignant';
  // Le surveillant a une autorité partielle de type admin sur ce point précis : il valide/rejette
  // les pointages enseignants litigieux (backend: authorize('admin', 'surveillant')).
  const peutValider = isAdmin || isSurveillant;
  // Le scan QR (/scan/entree-sortie) est réservé aux enseignants côté backend : le bouton
  // n'a aucun sens pour les autres rôles (surveillant, secrétaire...) et déclenchait une erreur.
  const peutScanner = user?.role === 'enseignant';
  // "Pointages à valider" (validation des heures enseignants) : admin et surveillant seulement,
  // les autres rôles ne voyaient qu'une erreur 403 en l'ouvrant.
  const tabsVisibles = TABS.filter((t) => t.key !== 'validation' || peutValider);
  // Permet d'arriver directement sur un onglet précis depuis un lien externe (ex. l'action
  // rapide "Pointages à valider" du tableau de bord : /admin/presences?tab=validation).
  const [searchParams] = useSearchParams();
  const tabInitial = searchParams.get('tab');
  const [tab, setTab] = useState(tabInitial && tabsVisibles.some((t) => t.key === tabInitial) ? tabInitial : 'appel');
  const tabActif = tabsVisibles.some((t) => t.key === tab) ? tab : tabsVisibles[0]?.key;

  return (
    <div>
      <SectionHeader
        title="Présences & Absences"
        subtitle="Suivi des appels, absences et validation des pointages"
        action={peutScanner && (
          <button className="btn-primary inline-flex items-center gap-2" onClick={() => navigate('/scan')}><Camera size={16} /> Scanner un appel (QR)</button>
        )}
      />

      {isAdmin && (
        <p className="text-xs text-slate-400 mb-3">
          Vue globale (lecture seule) — l&apos;appel est géré par le surveillant, les absences (élèves et enseignants) par le secrétariat et le surveillant.
        </p>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        {tabsVisibles.map((t) => (
          <button key={t.key} className={tabActif === t.key ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tabActif === 'appel' && <OngletAppel peutFaireAppel={peutFaireAppel} />}
      {tabActif === 'absences' && <OngletAbsencesEleves peutAgir={peutAgir} canManage={canManage} />}
      {tabActif === 'absences_ens' && <OngletAbsencesEnseignants canManage={canManage} />}
      {tabActif === 'validation' && peutValider && <OngletValidationPointages canManage={canManage} />}
    </div>
  );
}

// ============================================================
// Onglet 1 : Appel élèves — historique par classe/date, éditable, avec résumé
// ============================================================


function OngletAppel({ peutFaireAppel }) {
  const toast = useToast();
  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);
  const [classeId, setClasseId] = useState('');
  const [date, setDate] = useState(getServerToday());
  const [sessionId, setSessionId] = useState('');
  const [search, setSearch] = useState('');
  const [appelModalOpen, setAppelModalOpen] = useState(false);

  const { data: sessions, loading: loadingSessions, error: errorSessions, reload: reloadSessions } = useFetch(
    () => classeId ? client.get(`/pointage/classe/${classeId}/sessions`, { params: { date } }).then((r) => r.data) : Promise.resolve([]),
    [classeId, date]
  );

  useEffect(() => {
    if (!sessions?.length) {
      setSessionId('');
      return;
    }
    if (!sessions.some((s) => String(s.id) === String(sessionId))) setSessionId(String(sessions[0].id));
  }, [sessions, sessionId]);

  const { data: detail, loading, error, reload } = useFetch(
    () => (classeId && sessionId)
      ? client.get(`/pointage/classe/${classeId}/session/${sessionId}`, { params: { date } }).then((r) => r.data)
      : Promise.resolve(null),
    [classeId, sessionId, date]
  );

  const classeActive = classes?.find((c) => String(c.id) === String(classeId));
  const sessionActive = sessions?.find((s) => String(s.id) === String(sessionId));

  const filtres = useMemo(() => {
    let rows = detail?.eleves || [];
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((p) => `${p.eleve_prenom || ''} ${p.eleve_nom || ''} ${p.matricule || ''}`.toLowerCase().includes(s));
    }
    return rows;
  }, [detail, search]);

  const resume = detail?.resume || { effectif: 0, present: 0, absent: 0, retard: 0, non_renseigne: 0 };

  const imprimerAppel = () => {
    printTable({
      title: `Liste de présence — ${classeActive?.nom || ''}`,
      subtitle: `${sessionActive?.matiere_nom || detail?.cours?.matiere_nom || ''} · ${date}`,
      columns: [
        { label: 'N°', value: (r) => r.numero },
        { label: 'N° élève', value: (r) => r.matricule },
        { label: 'Élève', value: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom || ''}`.trim() },
        { label: 'Présence', value: (r) => r.statut === 'present' ? 'Présent' : r.statut === 'absent' ? 'Absent' : r.statut === 'retard' ? 'Retard' : 'Non renseigné' },
        { label: 'Matière', value: () => sessionActive?.matiere_nom || detail?.cours?.matiere_nom || '—' },
        { label: 'Date', value: () => date },
        { label: 'Heure', value: () => `${(sessionActive?.heure_debut || detail?.cours?.heure_debut || '').slice(0,5)}–${(sessionActive?.heure_fin || detail?.cours?.heure_fin || '').slice(0,5)}` },
      ],
      rows: filtres,
    });
  };

  const exporterAppel = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({
      columns: [
        { label: 'N°', value: (r) => r.numero },
        { label: 'N° élève', value: (r) => r.matricule },
        { label: 'Élève', value: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom || ''}`.trim() },
        { label: 'Présence', value: (r) => r.statut === 'present' ? 'Présent' : r.statut === 'absent' ? 'Absent' : r.statut === 'retard' ? 'Retard' : 'Non renseigné' },
        { label: 'Matière', value: () => sessionActive?.matiere_nom || detail?.cours?.matiere_nom || '—' },
        { label: 'Date', value: () => date },
        { label: 'Heure', value: () => `${(sessionActive?.heure_debut || detail?.cours?.heure_debut || '').slice(0,5)}–${(sessionActive?.heure_fin || detail?.cours?.heure_fin || '').slice(0,5)}` },
      ],
      rows: filtres,
      filename: `presence_${classeActive?.nom || 'classe'}_${date}`,
      sheetName: 'Présences',
    }));
  };

  const corriger = async (p, statut) => {
    try {
      await client.post('/pointage/appel', {
        emploi_du_temps_id: p.emploi_du_temps_id || sessionId,
        date_pointage: date,
        presences: [{ eleve_id: p.eleve_id, statut, commentaire: p.commentaire }],
      });
      toast.success('Statut corrigé.');
      reload();
      reloadSessions();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="max-w-xs flex-1 min-w-[190px]">
          <SelectInput label="Classe / salle" value={classeId} onChange={(e) => { setClasseId(e.target.value); setSessionId(''); }}>
            <option value="">— Choisir —</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}{c.salle ? ` · ${c.salle}` : ''}</option>)}
          </SelectInput>
        </div>
        <div className="w-44">
          <TextInput label="Date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setSessionId(''); }} />
        </div>
        {classeId && (
          <div className="min-w-[260px] flex-1">
            <SelectInput label="Cours / matière" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              <option value="">— Choisir un cours —</option>
              {sessions?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.heure_debut?.slice(0,5)}–{s.heure_fin?.slice(0,5)} · {s.matiere_nom} · {s.nb_pointages}/{s.effectif} saisi(s)
                </option>
              ))}
            </SelectInput>
          </div>
        )}
        {classeId && sessionId && (
          <div className="flex flex-wrap gap-2 self-end">
            {peutFaireAppel && <button className="btn-primary inline-flex items-center gap-2" onClick={() => setAppelModalOpen(true)}><ClipboardList size={15} /> Faire l&apos;appel</button>}
            <button className="btn-secondary inline-flex items-center gap-2" disabled={!filtres.length} onClick={imprimerAppel}><Printer size={15} /> Imprimer</button>
            <button className="btn-secondary inline-flex items-center gap-2" disabled={!filtres.length} onClick={exporterAppel}><FileSpreadsheet size={15} /> Excel</button>
            <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => { reload(); reloadSessions(); }}><RefreshCw size={14} /> Actualiser</button>
          </div>
        )}
      </div>

      {classeId && sessionId && detail && (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{detail.cours.matiere_nom} · {detail.cours.classe_nom}</p>
                <p className="text-xs text-slate-500 mt-1">{date} · {detail.cours.heure_debut?.slice(0,5)}–{detail.cours.heure_fin?.slice(0,5)} · {detail.cours.salle_nom || detail.cours.salle || 'Salle non définie'}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tone="green">Présents : {resume.present}</Badge>
                <Badge tone="red">Absents : {resume.absent}</Badge>
                <Badge tone="amber">Retards : {resume.retard}</Badge>
                {resume.non_renseigne > 0 && <Badge tone="slate">Non saisis : {resume.non_renseigne}</Badge>}
              </div>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Rechercher nom, prénom ou matricule…" label="Rechercher un élève" />
            <p className="text-xs text-slate-400">Liste complète : {resume.effectif} élève(s) · affichage jusqu&apos;à 50 lignes par page</p>
          </div>
        </>
      )}

      {!classeId && <EmptyState title="Choisissez une classe / salle." className="!py-8" />}
      {classeId && !sessionId && !loadingSessions && <EmptyState title="Choisissez un cours pour voir la liste de la salle." description={sessions?.length ? `${sessions.length} cours programmé(s) le ${date}.` : `Aucun cours programmé pour cette classe le ${date}.`} className="!py-8" />}
      {classeId && sessionId && (
        <DataTable
          loading={loading || loadingSessions} error={error || errorSessions} onRetry={reload} rows={filtres} pageSize={50}
          emptyLabel="Aucun élève inscrit dans cette classe."
          caption="Historique des présences et absences par classe et cours"
          columns={[
            { key: 'numero', label: 'N°', sortable: true },
            { key: 'matricule', label: 'N° élève', sortable: true },
            { key: 'eleve_nom', label: 'Nom & prénom', sortable: true, sortValue: (r) => `${r.eleve_nom || ''} ${r.eleve_prenom || ''}`, render: (r) => <span className="font-medium">{r.eleve_nom} {r.eleve_prenom || ''}</span> },
            { key: 'statut', label: 'Présence', sortable: true, render: (r) => {
              if (!r.statut) return <Badge tone="slate">Non saisi</Badge>;
              return <Badge tone={STATUT_TONE[r.statut] || 'slate'}>{STATUT_LABEL[r.statut] || r.statut}</Badge>;
            } },
            { key: 'matiere', label: 'Matière', render: () => detail?.cours?.matiere_nom || '—' },
            { key: 'date', label: 'Date', render: () => new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR') },
            { key: 'heure', label: 'Heure', render: () => `${detail?.cours?.heure_debut?.slice(0,5)}–${detail?.cours?.heure_fin?.slice(0,5)}` },
          ]}
          actions={peutFaireAppel ? (r) => (
            <div className="flex justify-end gap-1">
              <button type="button" className="btn-ghost !px-2 !py-1 text-emerald-700" title="Marquer présent" onClick={() => corriger(r, 'present')}>Présent</button>
              <button type="button" className="btn-ghost !px-2 !py-1 text-red-600" title="Marquer absent" onClick={() => corriger(r, 'absent')}>Absent</button>
            </div>
          ) : undefined}
        />
      )}

      <ModalFaireAppel
        open={appelModalOpen}
        onClose={() => setAppelModalOpen(false)}
        classes={classes}
        classeIdInitial={classeId}
        dateInitiale={date}
        onSuccess={(classeUtilisee, dateUtilisee) => {
          setClasseId(classeUtilisee);
          setDate(dateUtilisee);
          setAppelModalOpen(false);
          reload();
          reloadSessions();
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Modale "Faire l'appel" : le surveillant (ou l'enseignant) choisit une classe, une date, puis
// un créneau de l'emploi du temps de ce jour-là, et saisit la présence de tous les élèves d'un
// coup — sans devoir attendre qu'un appel existe déjà (contrairement à la correction ligne par
// ligne ci-dessus, qui ne fonctionne que sur un appel déjà réalisé).
// ------------------------------------------------------------------------------------------
function ModalFaireAppel({ open, onClose, classes, classeIdInitial, dateInitiale, onSuccess }) {
  const toast = useToast();
  const [classeId, setClasseId] = useState(classeIdInitial || '');
  const [date, setDate] = useState(dateInitiale || getServerToday());
  const [edtId, setEdtId] = useState('');
  const [statuts, setStatuts] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const jour = useMemo(() => JOURS[new Date(date).getDay()], [date]);

  const { data: creneaux, loading: loadingCreneaux } = useFetch(
    () => classeId ? client.get('/emploi-du-temps', { params: { classe_id: classeId } }).then((r) => r.data) : Promise.resolve([]),
    [classeId]
  );
  const creneauxDuJour = useMemo(() => (creneaux || []).filter((c) => c.jour === jour), [creneaux, jour]);

  const { data: eleves, loading: loadingEleves } = useFetch(
    () => classeId ? client.get('/eleves', { params: { classe_id: classeId } }).then((r) => r.data) : Promise.resolve([]),
    [classeId]
  );

  const reinitialiser = () => {
    setClasseId(classeIdInitial || '');
    setDate(dateInitiale || getServerToday());
    setEdtId('');
    setStatuts({});
  };

  const fermer = () => { reinitialiser(); onClose(); };

  const statutDe = (eleveId) => statuts[eleveId] || 'present';
  const setStatutDe = (eleveId, statut) => setStatuts((s) => ({ ...s, [eleveId]: statut }));
  const toutMarquer = (statut) => setStatuts(Object.fromEntries((eleves || []).map((e) => [e.id, statut])));

  const submit = async () => {
    if (!edtId) { toast.error('Choisissez un créneau.'); return; }
    if (!eleves?.length) { toast.error('Aucun élève inscrit dans cette classe.'); return; }
    setSubmitting(true);
    try {
      await client.post('/pointage/appel', {
        emploi_du_temps_id: edtId,
        date_pointage: date,
        presences: eleves.map((e) => ({ eleve_id: e.id, statut: statutDe(e.id) })),
      });
      toast.success(`Appel enregistré pour ${eleves.length} élève(s).`);
      onSuccess(classeId, date);
      reinitialiser();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={fermer} title="Faire l'appel" wide>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="max-w-xs flex-1">
            <SelectInput label="Classe" value={classeId} onChange={(e) => { setClasseId(e.target.value); setEdtId(''); }}>
              <option value="">— Choisir —</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </SelectInput>
          </div>
          <div className="max-w-xs">
            <TextInput label="Date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setEdtId(''); }} />
          </div>
        </div>

        {classeId && (
          <div>
            <label className="label">Créneau ({jour})</label>
            {loadingCreneaux ? (
              <p className="text-sm text-slate-400">Chargement…</p>
            ) : creneauxDuJour.length ? (
              <SelectInput label="Créneau" hideLabel value={edtId} onChange={(e) => setEdtId(e.target.value)}>
                <option value="">— Choisir un créneau —</option>
                {creneauxDuJour.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.heure_debut?.slice(0, 5)}–{c.heure_fin?.slice(0, 5)} · {c.matiere_nom} ({c.enseignant_nom} {c.enseignant_prenom})
                  </option>
                ))}
              </SelectInput>
            ) : (
              <p className="text-sm text-slate-400 py-2">Aucun créneau programmé un {jour} pour cette classe.</p>
            )}
          </div>
        )}

        {edtId && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Présence des élèves</label>
              <div className="flex gap-1">
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => toutMarquer('present')}>Tous présents</button>
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => toutMarquer('absent')}>Tous absents</button>
              </div>
            </div>
            {loadingEleves ? (
              <p className="text-sm text-slate-400">Chargement…</p>
            ) : (
              <div className="max-h-72 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-100">
                {eleves?.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm">{e.prenom} {e.nom}</span>
                    <SelectInput
                      label={`Statut de ${e.prenom} ${e.nom}`} hideLabel
                      className="!w-auto"
                      value={statutDe(e.id)}
                      onChange={(ev) => setStatutDe(e.id, ev.target.value)}
                    >
                      {STATUTS_CORRIGIBLES.map((k) => <option key={k} value={k}>{STATUT_LABEL[k]}</option>)}
                    </SelectInput>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={fermer}>Annuler</button>
          <button type="button" className="btn-primary" disabled={!edtId || submitting} onClick={submit}>
            {submitting ? 'Enregistrement…' : "Enregistrer l'appel"}
          </button>
        </div>
      </div>
    </Modal>
  );
}


// ============================================================
// Onglet 2 : Absences élèves — déclaration, justification, correction
// ============================================================
function OngletAbsencesEleves({ peutAgir, canManage }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);
  const [classeId, setClasseId] = useState('');
  const [search, setSearch] = useState('');
  const [statutFiltre, setStatutFiltre] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [absenceEnEdition, setAbsenceEnEdition] = useState(null);
  const [dernierRafraichi, setDernierRafraichi] = useState(new Date());

  const { data: absences, loading, error, reload } = useFetch(
    () => classeId ? client.get('/absences/eleves', { params: { classe_id: classeId } }).then((r) => r.data) : Promise.resolve([]),
    [classeId]
  );

  const rafraichir = () => { reload(); setDernierRafraichi(new Date()); };

  const classeActive = classes?.find((c) => String(c.id) === String(classeId));

  const { data: eleves } = useFetch(
    () => classeId ? client.get('/eleves', { params: { classe_id: classeId } }).then((r) => r.data) : Promise.resolve([]),
    [classeId]
  );

  const filtres = useMemo(() => {
    let rows = absences || [];
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((a) => `${a.eleve_prenom || ''} ${a.eleve_nom}`.toLowerCase().includes(s));
    }
    if (statutFiltre) rows = rows.filter((a) => (statutFiltre === 'justifiee' ? a.justifiee : !a.justifiee));
    return rows;
  }, [absences, search, statutFiltre]);

  const imprimer = () => {
    printTable({
      title: `Absences élèves — ${classeActive?.nom || ''}`,
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`,
      columns: ABSENCES_ELEVES_EXPORT_COLUMNS,
      rows: filtres,
    });
  };
  const exporter = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: ABSENCES_ELEVES_EXPORT_COLUMNS, rows: filtres, filename: `absences_eleves_${classeActive?.nom || ''}`, sheetName: 'Absences' }));
  };

  const justifier = async (a) => {
    try {
      await client.put(`/absences/eleves/${a.id}/justifier`, {});
      toast.success('Absence justifiée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const annulerJustification = async (a) => {
    try {
      await client.put(`/absences/eleves/${a.id}/annuler-justification`, {});
      toast.success('Justification annulée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const supprimer = async (a) => {
    if (!(await confirm({
      title: 'Supprimer cette absence',
      message: `Supprimer l'absence de ${a.eleve_prenom || ''} ${a.eleve_nom} du ${new Date(a.date_absence).toLocaleDateString('fr-FR')} ?`,
      danger: true,
    }))) return;
    try {
      await client.delete(`/absences/eleves/${a.id}`);
      toast.success('Absence supprimée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const openCreate = () => { setAbsenceEnEdition(null); setModalOpen(true); };
  const openEdit = (a) => { setAbsenceEnEdition(a); setModalOpen(true); };

  return (
    <div className="card">
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="max-w-xs flex-1">
          <SelectInput label="Classe" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
            <option value="">— Choisir —</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </SelectInput>
        </div>
        {classeId && (
          <>
            <div className="flex-1 min-w-[200px]">
              <SearchInput value={search} onChange={setSearch} placeholder="Rechercher un élève…" label="Rechercher un élève" />
            </div>
            <div className="w-full sm:w-52">
              <SelectInput label="Statut" hideLabel value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)}>
                <option value="">— Tout statut —</option>
                <option value="justifiee">Justifiée</option>
                <option value="non_justifiee">Non justifiée</option>
              </SelectInput>
            </div>
            <div className="self-end flex gap-2 flex-wrap">
              {peutAgir && (
                <button className="btn-primary inline-flex items-center gap-2" onClick={openCreate}><Plus size={15} /> Déclarer une absence</button>
              )}
              <button className="btn-secondary inline-flex items-center gap-2" disabled={!filtres?.length} onClick={imprimer}><Printer size={15} /> Imprimer</button>
              <button className="btn-secondary inline-flex items-center gap-2" disabled={!filtres?.length} onClick={exporter}><FileSpreadsheet size={15} /> Exporter Excel</button>
              <button type="button" className="btn-ghost inline-flex items-center gap-2 text-xs" onClick={rafraichir} title="Rafraîchir">
                <RefreshCw size={14} /> {dernierRafraichi.toLocaleTimeString('fr-FR')}
              </button>
            </div>
          </>
        )}
      </div>

      {!classeId && <EmptyState title="Choisissez une classe." className="!py-8" />}

      {classeId && (
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={filtres} pageSize={10}
          emptyLabel="Aucune absence enregistrée pour cette classe."
          columns={[
            { key: 'eleve_nom', label: 'Élève', sortable: true, sortValue: (r) => `${r.eleve_nom} ${r.eleve_prenom || ''}`, render: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}` },
            { key: 'date_absence', label: 'Date', sortable: true, render: (r) => new Date(r.date_absence).toLocaleDateString('fr-FR') },
            { key: 'matiere_nom', label: 'Matière', render: (r) => r.matiere_nom || '—' },
            { key: 'motif', label: 'Motif', render: (r) => r.motif || '—' },
            { key: 'justifiee', label: 'Statut', sortable: true, sortValue: (r) => (r.justifiee ? 1 : 0), render: (r) => <Badge tone={r.justifiee ? 'green' : 'red'}>{r.justifiee ? 'Justifiée' : 'Non justifiée'}</Badge> },
          ]}
          actions={(a) => (
            <div className="flex justify-end gap-1">
              {peutAgir && !a.justifiee && <button className="btn-ghost !px-2 !py-1 text-brand-700" onClick={() => justifier(a)}>Justifier</button>}
              {canManage && a.justifiee && (
                <button className="btn-ghost !p-1.5 text-amber-600" title="Annuler la justification" onClick={() => annulerJustification(a)}><RotateCcw size={15} /></button>
              )}
              {canManage && (
                <>
                  <button className="btn-ghost !p-1.5 text-slate-600" title="Modifier" onClick={() => openEdit(a)}><Pencil size={15} /></button>
                  <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(a)}><Trash2 size={15} /></button>
                </>
              )}
            </div>
          )}
        />
      )}

      <ModalAbsenceEleve
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        eleves={eleves}
        absence={absenceEnEdition}
        onSuccess={() => { setModalOpen(false); reload(); }}
      />
    </div>
  );
}

function ModalAbsenceEleve({ open, onClose, eleves, absence, onSuccess }) {
  const toast = useToast();
  const edition = !!absence;
  const [form, setForm] = useState({
    eleve_id: absence?.eleve_id || '',
    date_absence: absence?.date_absence?.slice(0, 10) || getServerToday(),
    motif: absence?.motif || '',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  // Recharge le formulaire à chaque ouverture (création ou édition d'une absence différente).
  useMemoResetForm(open, absence, setForm);

  const submit = async (e) => {
    e.preventDefault();
    if (!edition && !form.eleve_id) { setFieldErrors({ eleve_id: 'Choisissez un élève.' }); return; }
    try {
      if (edition) {
        await client.put(`/absences/eleves/${absence.id}`, { date_absence: form.date_absence, motif: form.motif });
        toast.success('Absence modifiée.');
      } else {
        await client.post('/absences/eleves', form);
        toast.success('Absence déclarée.');
      }
      onSuccess();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={edition ? 'Modifier une absence' : 'Déclarer une absence élève'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {!edition && (
          <SelectInput label="Élève" required value={form.eleve_id} onChange={set('eleve_id')} error={fieldErrors.eleve_id}>
            <option value="">— Choisir —</option>
            {eleves?.map((e) => <option key={e.id} value={e.id}>{e.prenom} {e.nom}</option>)}
          </SelectInput>
        )}
        <TextInput label="Date" type="date" required value={form.date_absence} onChange={set('date_absence')} />
        <TextInput label="Motif" value={form.motif} onChange={set('motif')} placeholder="Maladie, rendez-vous, non justifiée…" />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

const ABSENCES_ENS_EXPORT_COLUMNS = [
  { label: 'Enseignant', value: (r) => `${r.prenom || ''} ${r.nom}`.trim() },
  { label: 'Date', value: (r) => new Date(r.date_absence).toLocaleDateString('fr-FR') },
  { label: 'Motif', value: (r) => r.motif || '—' },
  { label: 'Statut', value: (r) => (r.justifiee ? 'Justifiée' : 'Non justifiée') },
];

// ============================================================
// Onglet 3 : Absences enseignants — déclaration, justification, correction (géré par le
// secrétariat au quotidien — premier point de contact quand un enseignant prévient de son
// absence — et par le surveillant, sans dépendre de l'admin)
// ============================================================
function OngletAbsencesEnseignants({ canManage }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [absenceEnEdition, setAbsenceEnEdition] = useState(null);
  const [search, setSearch] = useState('');
  const [dernierRafraichi, setDernierRafraichi] = useState(new Date());

  const { data: absences, loading, error, reload } = useFetch(
    () => client.get('/absences/enseignants').then((r) => r.data), []
  );
  const { data: utilisateurs } = useFetch(() => client.get('/utilisateurs').then((r) => r.data), []);
  const enseignants = useMemo(() => (utilisateurs || []).filter((u) => u.role === 'enseignant' && u.actif), [utilisateurs]);

  const rafraichir = () => { reload(); setDernierRafraichi(new Date()); };

  const filtres = useMemo(() => {
    if (!search) return absences;
    const s = search.toLowerCase();
    return (absences || []).filter((a) => `${a.prenom || ''} ${a.nom}`.toLowerCase().includes(s));
  }, [absences, search]);

  const justifier = async (a) => {
    try {
      await client.put(`/absences/enseignants/${a.id}/justifier`, {});
      toast.success('Absence justifiée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const annulerJustification = async (a) => {
    try {
      await client.put(`/absences/enseignants/${a.id}/annuler-justification`, {});
      toast.success('Justification annulée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const supprimer = async (a) => {
    if (!(await confirm({
      title: 'Supprimer cette absence',
      message: `Supprimer l'absence de ${a.prenom || ''} ${a.nom} du ${new Date(a.date_absence).toLocaleDateString('fr-FR')} ?`,
      danger: true,
    }))) return;
    try {
      await client.delete(`/absences/enseignants/${a.id}`);
      toast.success('Absence supprimée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const openCreate = () => { setAbsenceEnEdition(null); setModalOpen(true); };
  const openEdit = (a) => { setAbsenceEnEdition(a); setModalOpen(true); };

  const imprimer = () => {
    printTable({
      title: 'Absences enseignants',
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`,
      columns: ABSENCES_ENS_EXPORT_COLUMNS,
      rows: filtres,
    });
  };
  const exporter = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: ABSENCES_ENS_EXPORT_COLUMNS, rows: filtres, filename: 'absences_enseignants', sheetName: 'Absences' }));
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex-1 min-w-[200px]">
          <SearchInput value={search} onChange={setSearch} placeholder="Rechercher un enseignant…" label="Rechercher un enseignant" />
        </div>
        {canManage && (
          <button className="btn-primary inline-flex items-center gap-2" onClick={openCreate}><Plus size={15} /> Déclarer une absence</button>
        )}
        <button className="btn-secondary inline-flex items-center gap-2" disabled={!filtres?.length} onClick={imprimer}><Printer size={15} /> Imprimer</button>
        <button className="btn-secondary inline-flex items-center gap-2" disabled={!filtres?.length} onClick={exporter}><FileSpreadsheet size={15} /> Exporter Excel</button>
        <button type="button" className="btn-ghost inline-flex items-center gap-2 text-xs" onClick={rafraichir} title="Rafraîchir">
          <RefreshCw size={14} /> {dernierRafraichi.toLocaleTimeString('fr-FR')}
        </button>
      </div>

      <DataTable
        loading={loading} error={error} onRetry={reload} rows={filtres} pageSize={10}
        emptyLabel="Aucune absence enseignant déclarée."
        columns={[
          { key: 'nom', label: 'Enseignant', sortable: true, sortValue: (r) => `${r.nom} ${r.prenom || ''}`, render: (r) => `${r.prenom || ''} ${r.nom}` },
          { key: 'date_absence', label: 'Date', sortable: true, render: (r) => new Date(r.date_absence).toLocaleDateString('fr-FR') },
          { key: 'motif', label: 'Motif', render: (r) => r.motif || '—' },
          { key: 'justifiee', label: 'Statut', sortable: true, sortValue: (r) => (r.justifiee ? 1 : 0), render: (r) => <Badge tone={r.justifiee ? 'green' : 'red'}>{r.justifiee ? 'Justifiée' : 'Non justifiée'}</Badge> },
        ]}
        actions={canManage ? (a) => (
          <div className="flex justify-end gap-1">
            {!a.justifiee && <button className="btn-ghost !px-2 !py-1 text-brand-700" onClick={() => justifier(a)}>Justifier</button>}
            {a.justifiee && (
              <button className="btn-ghost !p-1.5 text-amber-600" title="Annuler la justification" onClick={() => annulerJustification(a)}><RotateCcw size={15} /></button>
            )}
            <button className="btn-ghost !p-1.5 text-slate-600" title="Modifier" onClick={() => openEdit(a)}><Pencil size={15} /></button>
            <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(a)}><Trash2 size={15} /></button>
          </div>
        ) : undefined}
      />

      <ModalAbsenceEnseignant
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        enseignants={enseignants}
        absence={absenceEnEdition}
        onSuccess={() => { setModalOpen(false); reload(); }}
      />
    </div>
  );
}

function ModalAbsenceEnseignant({ open, onClose, enseignants, absence, onSuccess }) {
  const toast = useToast();
  const edition = !!absence;
  const [form, setForm] = useState({
    enseignant_id: absence?.enseignant_id || '',
    date_absence: absence?.date_absence?.slice(0, 10) || getServerToday(),
    motif: absence?.motif || '',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  useMemoResetForm(open, absence, setForm, true);

  const submit = async (e) => {
    e.preventDefault();
    if (!edition && !form.enseignant_id) { setFieldErrors({ enseignant_id: 'Choisissez un enseignant.' }); return; }
    try {
      if (edition) {
        await client.put(`/absences/enseignants/${absence.id}`, { date_absence: form.date_absence, motif: form.motif });
        toast.success('Absence modifiée.');
      } else {
        await client.post('/absences/enseignants', form);
        toast.success('Absence enregistrée.');
      }
      onSuccess();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={edition ? 'Modifier une absence enseignant' : 'Déclarer une absence enseignant'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {!edition && (
          <SelectInput label="Enseignant" required value={form.enseignant_id} onChange={set('enseignant_id')} error={fieldErrors.enseignant_id}>
            <option value="">— Choisir —</option>
            {enseignants.map((e) => <option key={e.id} value={e.id}>{e.nom} {e.prenom}</option>)}
          </SelectInput>
        )}
        <TextInput label="Date" type="date" required value={form.date_absence} onChange={set('date_absence')} />
        <TextInput label="Motif" value={form.motif} onChange={set('motif')} placeholder="Maladie, congé, mission…" />
        {!edition && <p className="text-xs text-slate-400">Rappel (RG-028) : un enseignant absent ne doit pas avoir cours ce jour — pensez à ajuster l&apos;emploi du temps si besoin.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

// Petit utilitaire partagé : réinitialise le formulaire d'une modale à chaque ouverture, pour ne
// pas conserver les valeurs de la précédente édition/création une fois la modale refermée puis
// rouverte sur un autre enregistrement.
function useMemoResetForm(open, record, setForm, isEnseignant = false) {
  const key = `${open}-${record?.id || 'new'}`;
  useMemo(() => {
    if (!open) return;
    if (record) {
      setForm({
        [isEnseignant ? 'enseignant_id' : 'eleve_id']: isEnseignant ? record.enseignant_id : record.eleve_id,
        date_absence: record.date_absence?.slice(0, 10) || getServerToday(),
        motif: record.motif || '',
      });
    } else {
      setForm({
        [isEnseignant ? 'enseignant_id' : 'eleve_id']: '',
        date_absence: getServerToday(),
        motif: '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// ============================================================
// Onglet 4 : Validation des pointages enseignants (entrée sans sortie, cas ambigus…)
// ============================================================
function OngletValidationPointages({ canManage }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState('');

  const { data: aValider, loading, error, reload } = useFetch(
    () => client.get('/pointage/enseignant/a-valider').then((r) => r.data), []
  );

  const filtres = useMemo(() => {
    if (!search) return aValider;
    const s = search.toLowerCase();
    return (aValider || []).filter((p) => `${p.prenom || ''} ${p.nom}`.toLowerCase().includes(s));
  }, [aValider, search]);

  const decider = async (p, decision) => {
    if (decision === 'rejeter') {
      if (!(await confirm({ title: 'Rejeter ce pointage', message: `Rejeter le pointage de ${p.prenom || ''} ${p.nom} du ${new Date(p.date_pointage).toLocaleDateString('fr-FR')} ? Il ne sera pas payé.`, danger: true }))) return;
    }
    setBusyId(p.id);
    try {
      await client.put(`/pointage/enseignant/${p.id}/valider`, { decision });
      toast.success(decision === 'accepter' ? 'Pointage validé.' : 'Pointage rejeté.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card">
      <p className="text-sm text-slate-500 mb-4">
        Pointages nécessitant un arbitrage manuel (entrée sans sortie, ou tout autre cas ambigu détecté par le scan QR) avant d&apos;être pris en compte pour la paie.
      </p>
      <div className="mb-4 max-w-xs">
        <SearchInput value={search} onChange={setSearch} placeholder="Rechercher un enseignant…" />
      </div>
      <DataTable
        loading={loading} error={error} onRetry={reload} rows={filtres}
        emptyLabel="Aucun pointage en attente de validation."
        columns={[
          { key: 'nom', label: 'Enseignant', render: (r) => `${r.prenom || ''} ${r.nom}` },
          { key: 'date_pointage', label: 'Date', render: (r) => new Date(r.date_pointage).toLocaleDateString('fr-FR') },
          { key: 'classe_nom', label: 'Classe', render: (r) => r.classe_nom || '—' },
          { key: 'matiere_nom', label: 'Matière', render: (r) => r.matiere_nom || '—' },
          { key: 'heure_scan_entree', label: 'Entrée', render: (r) => r.heure_scan_entree ? new Date(r.heure_scan_entree).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—' },
          { key: 'heure_scan_sortie', label: 'Sortie', render: (r) => r.heure_scan_sortie ? new Date(r.heure_scan_sortie).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—' },
          { key: 'statut_validation', label: 'Statut', render: (r) => <Badge tone={VALIDATION_TONE[r.statut_validation] || 'slate'}>{VALIDATION_LABEL[r.statut_validation] || r.statut_validation}</Badge> },
        ]}
        actions={canManage ? (p) => (
          <div className="flex justify-end gap-1">
            <button
              className="btn-ghost !p-1.5 text-emerald-600"
              title="Valider"
              disabled={busyId === p.id}
              onClick={() => decider(p, 'accepter')}
            >
              <Check size={15} />
            </button>
            <button
              className="btn-ghost !p-1.5 text-red-600"
              title="Rejeter"
              disabled={busyId === p.id}
              onClick={() => decider(p, 'rejeter')}
            >
              <X size={15} />
            </button>
          </div>
        ) : undefined}
      />
    </div>
  );
}
