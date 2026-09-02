import { useMemo, useState } from 'react';
import { Plus, ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { SectionHeader, Badge, SearchInput } from '../../components/Shared';
import { couleurMatiere } from '../../utils/matiereColors';
import { printTable } from '../../utils/exportUtils';

const TYPES_EXAMEN = [
  { value: 'devoir', label: 'Devoir' },
  { value: 'controle', label: 'Contrôle' },
  { value: 'examen', label: 'Examen' },
  { value: 'composition', label: 'Composition' },
  { value: 'examen_final', label: 'Examen final' },
];

const STATUT_LABELS = { planifie: 'Planifié', en_cours: 'En cours', termine: 'Terminé', annule: 'Annulé' };
const STATUT_TONE = { planifie: 'slate', en_cours: 'amber', termine: 'green', annule: 'red' };

// Couleur de la note : rouge < 10, ambre 10-11.99, vert >= 12 (même convention que "Notes").
function toneNote(valeur) {
  const v = Number(valeur);
  if (Number.isNaN(v)) return 'slate';
  if (v < 10) return 'red';
  if (v < 12) return 'amber';
  return 'green';
}

// Élargissement du rôle secrétaire (planning des examens) : le secrétariat peut désormais
// planifier/modifier un examen et ses épreuves directement, sans attendre l'admin — même
// logique que le module Certificats. Seules deux actions restent réservées :
// - la SAISIE DES NOTES (RG-040 : admin ou enseignant responsable de l'épreuve uniquement) ;
// - la SUPPRESSION d'un examen/épreuve (admin uniquement : efface en cascade des résultats
//   déjà saisis, action irréversible).
function usePermissionsExamens() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isSecretaire = user?.role === 'secretaire';
  return {
    isAdmin,
    // Planifier / modifier un examen ou une épreuve, changer le statut.
    peutGerer: isAdmin || isSecretaire,
    // Saisir des notes (inchangé).
    peutSaisir: isAdmin || user?.role === 'enseignant',
  };
}

export default function Examens() {
  const [examenOuvert, setExamenOuvert] = useState(null); // examen sélectionné (drill-down épreuves)
  return examenOuvert
    ? <DetailExamen examen={examenOuvert} onRetour={() => setExamenOuvert(null)} onMisAJour={setExamenOuvert} />
    : <ListeExamens onOuvrir={setExamenOuvert} />;
}

const FORM_EXAMEN_VIDE = { nom: '', type_examen: 'devoir', annee_scolaire_id: '', classe_id: '', bimestre_id: '', date_debut: '', date_fin: '' };

const LISTE_EXPORT_COLUMNS = [
  { label: 'Nom', value: (r) => r.nom },
  { label: 'Type', value: (r) => TYPES_EXAMEN.find((t) => t.value === r.type_examen)?.label || r.type_examen },
  { label: 'Début', value: (r) => new Date(r.date_debut).toLocaleDateString('fr-FR') },
  { label: 'Fin', value: (r) => new Date(r.date_fin).toLocaleDateString('fr-FR') },
  { label: 'Statut', value: (r) => STATUT_LABELS[r.statut] || r.statut },
  { label: 'Épreuves', value: (r) => r.nb_epreuves ?? 0 },
];

function ListeExamens({ onOuvrir }) {
  const { peutGerer, isAdmin } = usePermissionsExamens();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLotOpen, setModalLotOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [classeId, setClasseId] = useState('');
  const [bimestreId, setBimestreId] = useState('');
  const [typeFiltre, setTypeFiltre] = useState('');
  const [search, setSearch] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  const { data: classes } = useFetch(() => client.get('/classes').then((r) => r.data), []);
  const { data: matieres } = useFetch(() => client.get('/matieres').then((r) => r.data), []);
  const { data: annees } = useFetch(() => client.get('/annees-scolaires').then((r) => r.data), []);
  const { data: bimestres } = useFetch(() => client.get('/bimestres').then((r) => r.data), []);
  const { data: examensBruts, loading, error, reload } = useFetch(
    () => client.get('/examens', { params: { classe_id: classeId || undefined, bimestre_id: bimestreId || undefined } }).then((r) => r.data),
    [classeId, bimestreId]
  );

  const examens = useMemo(() => {
    let rows = examensBruts || [];
    if (typeFiltre) rows = rows.filter((e) => e.type_examen === typeFiltre);
    if (search) rows = rows.filter((e) => e.nom.toLowerCase().includes(search.toLowerCase()));
    return rows;
  }, [examensBruts, typeFiltre, search]);

  // Vue d'ensemble rapide par statut — utile au secrétariat pour suivre l'avancement du
  // calendrier d'examens sans devoir ouvrir chaque ligne.
  const stats = useMemo(() => {
    const rows = examensBruts || [];
    return {
      total: rows.length,
      planifie: rows.filter((r) => r.statut === 'planifie').length,
      en_cours: rows.filter((r) => r.statut === 'en_cours').length,
      termine: rows.filter((r) => r.statut === 'termine').length,
      annule: rows.filter((r) => r.statut === 'annule').length,
    };
  }, [examensBruts]);

  const anneeActive = annees?.find((a) => a.actif);
  const cycles = useMemo(() => {
    const parId = new Map();
    (classes || []).forEach((c) => { if (c.cycle_id && !parId.has(c.cycle_id)) parId.set(c.cycle_id, c.cycle_nom); });
    return [...parId.entries()].map(([id, nom]) => ({ id, nom }));
  }, [classes]);
  const [form, setForm] = useState(FORM_EXAMEN_VIDE);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openCreate = () => {
    setEditing(null);
    setForm({ ...FORM_EXAMEN_VIDE, annee_scolaire_id: anneeActive?.id || '' });
    setModalOpen(true);
  };
  const openEdit = (ex) => {
    setEditing(ex);
    setForm({
      nom: ex.nom, type_examen: ex.type_examen, annee_scolaire_id: ex.annee_scolaire_id, classe_id: ex.classe_id,
      bimestre_id: ex.bimestre_id, date_debut: ex.date_debut?.slice(0, 10), date_fin: ex.date_fin?.slice(0, 10),
    });
    setModalOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await client.put(`/examens/${editing.id}`, form);
        toast.success('Examen modifié.');
      } else {
        await client.post('/examens', form);
        toast.success('Examen créé.');
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const changerStatut = async (examen, statut) => {
    if (statut === 'annule' && !(await confirm({
      title: 'Annuler l\'examen',
      message: `Marquer « ${examen.nom} » comme annulé ?`,
      danger: true,
      confirmLabel: 'Annuler l\'examen',
    }))) return;
    try {
      await client.put(`/examens/${examen.id}/statut`, { statut });
      toast.success('Statut mis à jour.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const supprimer = async (examen) => {
    const ok = await confirm({
      title: 'Supprimer l\'examen',
      message: `Supprimer définitivement « ${examen.nom} » ? Toutes ses épreuves et tous les résultats déjà saisis seront supprimés. Cette action est irréversible.`,
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    try {
      await client.delete(`/examens/${examen.id}`);
      toast.success('Examen supprimé.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const imprimer = () => {
    printTable({
      title: 'Planning des examens',
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')} — ${examens.length} examen(s)`,
      columns: LISTE_EXPORT_COLUMNS,
      rows: examens,
    });
  };

  const exporter = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: LISTE_EXPORT_COLUMNS, rows: examens, filename: 'planning_examens', sheetName: 'Examens' }));
  };

  return (
    <div>
      <SectionHeader
        title="Examens"
        subtitle={`${examens?.length ?? 0} examen(s) — épreuves et résultats`}
        action={(
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={!examens?.length} onClick={imprimer}>🖨️ Imprimer</button>
            <button className="btn-secondary" disabled={!examens?.length} onClick={exporter}>📊 Exporter Excel</button>
            {peutGerer && (
              <button className="btn-secondary" onClick={() => setModalLotOpen(true)}>📚 Créer en masse (par cycle)</button>
            )}
            {peutGerer && (
              <button className="btn-primary" onClick={openCreate}><Plus size={15} className="inline -mt-0.5 mr-1" />Nouvel examen</button>
            )}
          </div>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <div className="card !py-3 text-center">
          <p className="text-xs text-slate-500">Total</p>
          <p className="text-lg font-display font-bold text-slate-900">{stats.total}</p>
        </div>
        <div className="card !py-3 text-center">
          <p className="text-xs text-slate-500">Planifiés</p>
          <p className="text-lg font-display font-bold text-slate-600">{stats.planifie}</p>
        </div>
        <div className="card !py-3 text-center">
          <p className="text-xs text-slate-500">En cours</p>
          <p className="text-lg font-display font-bold text-amber-600">{stats.en_cours}</p>
        </div>
        <div className="card !py-3 text-center">
          <p className="text-xs text-slate-500">Terminés</p>
          <p className="text-lg font-display font-bold text-emerald-600">{stats.termine}</p>
        </div>
        <div className="card !py-3 text-center">
          <p className="text-xs text-slate-500">Annulés</p>
          <p className="text-lg font-display font-bold text-red-600">{stats.annule}</p>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-4 mb-4">
          <div className="max-w-xs">
            <label className="label">Filtrer par classe</label>
            <select className="input" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
              <option value="">Toutes les classes</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div className="max-w-xs">
            <label className="label">Filtrer par bimestre</label>
            <select className="input" value={bimestreId} onChange={(e) => setBimestreId(e.target.value)}>
              <option value="">Tous les bimestres</option>
              {bimestres?.map((b) => <option key={b.id} value={b.id}>{b.libelle}</option>)}
            </select>
          </div>
          <div className="max-w-xs">
            <label className="label">Filtrer par type</label>
            <select className="input" value={typeFiltre} onChange={(e) => setTypeFiltre(e.target.value)}>
              <option value="">Tous les types</option>
              {TYPES_EXAMEN.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="max-w-xs flex-1">
            <label className="label">Rechercher</label>
            <SearchInput value={search} onChange={setSearch} placeholder="Nom de l'examen…" />
          </div>
        </div>
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={examens}
          pageSize={10}
          emptyLabel="Aucun examen pour le moment."
          columns={[
            { key: 'nom', label: 'Nom', sortable: true },
            {
              key: 'type_examen', label: 'Type', sortable: true,
              render: (r) => TYPES_EXAMEN.find((t) => t.value === r.type_examen)?.label || r.type_examen,
            },
            {
              key: 'date_debut', label: 'Période', sortable: true,
              render: (r) => `${new Date(r.date_debut).toLocaleDateString('fr-FR')} → ${new Date(r.date_fin).toLocaleDateString('fr-FR')}`,
            },
            {
              key: 'nb_epreuves', label: 'Épreuves', sortable: true,
              render: (r) => (
                <Badge tone={r.nb_epreuves > 0 ? 'slate' : 'amber'}>
                  {r.nb_epreuves > 0 ? `${r.nb_epreuves} épreuve(s)` : 'Aucune épreuve'}
                </Badge>
              ),
            },
            {
              key: 'statut', label: 'Statut', sortable: true,
              sortValue: (r) => STATUT_LABELS[r.statut] || r.statut,
              render: (r) => (
                peutGerer ? (
                  <select
                    className="input !py-1 !text-xs w-32"
                    value={r.statut}
                    onChange={(e) => changerStatut(r, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {Object.entries(STATUT_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                ) : <Badge tone={STATUT_TONE[r.statut] || 'slate'}>{STATUT_LABELS[r.statut] || r.statut}</Badge>
              ),
            },
          ]}
          actions={(r) => (
            <div className="flex justify-end gap-1">
              <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => onOuvrir(r)}>Épreuves & résultats</button>
              {peutGerer && (
                <button className="btn-ghost !p-1.5" title="Modifier" onClick={() => openEdit(r)}>
                  <Pencil size={15} />
                </button>
              )}
              {isAdmin && (
                <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(r)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          )}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Modifier — ${editing.nom}` : 'Nouvel examen'} wide>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label">Nom</label>
            <input className="input" required value={form.nom} onChange={set('nom')} placeholder="Ex. Composition du 1er trimestre" />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={form.type_examen} onChange={set('type_examen')}>
              {TYPES_EXAMEN.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Classe</label>
            <select className="input" required disabled={!!editing} value={form.classe_id} onChange={set('classe_id')}>
              <option value="">— Choisir —</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Année scolaire</label>
            <select className="input" required disabled={!!editing} value={form.annee_scolaire_id} onChange={set('annee_scolaire_id')}>
              <option value="">— Choisir —</option>
              {annees?.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Bimestre</label>
            <select className="input" required value={form.bimestre_id} onChange={set('bimestre_id')}>
              <option value="">— Choisir —</option>
              {bimestres?.filter((b) => !form.annee_scolaire_id || String(b.annee_scolaire_id) === String(form.annee_scolaire_id))
                .map((b) => <option key={b.id} value={b.id}>{b.libelle}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date de début</label>
            <input className="input" type="date" required value={form.date_debut} onChange={set('date_debut')} />
          </div>
          <div>
            <label className="label">Date de fin</label>
            <input className="input" type="date" required value={form.date_fin} onChange={set('date_fin')} min={form.date_debut} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">{editing ? 'Enregistrer' : 'Créer'}</button>
          </div>
        </form>
      </Modal>

      <ModalExamenLot
        open={modalLotOpen}
        onClose={() => setModalLotOpen(false)}
        cycles={cycles}
        matieres={matieres}
        annees={annees}
        anneeActive={anneeActive}
        bimestres={bimestres}
        onCreated={reload}
      />
    </div>
  );
}

const FORM_LOT_VIDE = { cycle_id: '', annee_scolaire_id: '', nom: '', type_examen: 'devoir', bimestre_id: '', date_debut: '', date_fin: '' };
const EPREUVE_LOT_VIDE = { matiere_id: '', date_examen: '', heure_debut: '', heure_fin: '', coefficient: 1 };

// Création en masse : un examen par classe d'un cycle (Primaire/Collège/Secondaire), avec les
// mêmes épreuves "modèles" (même matière, même date/heure) pour toutes les classes du cycle.
// Une matière absente du programme d'une classe, ou sans enseignant affecté, est automatiquement
// ignorée pour cette classe (voir POST /examens/lot côté backend) et listée dans le résumé.
function ModalExamenLot({ open, onClose, cycles, matieres, annees, anneeActive, bimestres, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(FORM_LOT_VIDE);
  const [epreuves, setEpreuves] = useState([{ ...EPREUVE_LOT_VIDE }]);
  const [busy, setBusy] = useState(false);
  const [resume, setResume] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const reinitialiser = () => {
    setForm({ ...FORM_LOT_VIDE, annee_scolaire_id: anneeActive?.id || '' });
    setEpreuves([{ ...EPREUVE_LOT_VIDE }]);
    setResume(null);
  };

  const fermer = () => { onClose(); reinitialiser(); };

  const addEpreuve = () => setEpreuves((l) => [...l, { ...EPREUVE_LOT_VIDE }]);
  const removeEpreuve = (i) => setEpreuves((l) => l.filter((_, idx) => idx !== i));
  const updateEpreuve = (i, key, val) => setEpreuves((l) => l.map((row, idx) => idx === i ? { ...row, [key]: val } : row));

  const submit = async (e) => {
    e.preventDefault();
    const epreuvesValides = epreuves.filter((ep) => ep.matiere_id && ep.date_examen);
    if (epreuvesValides.length === 0) {
      toast.error('Ajoutez au moins une épreuve (matière + date).');
      return;
    }
    setBusy(true);
    try {
      const { data } = await client.post('/examens/lot', { ...form, epreuves: epreuvesValides });
      toast.success(data.message);
      setResume(data);
      onCreated();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={fermer} title="Créer des examens en masse (par cycle)" wide>
      {resume ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">{resume.message}</p>
          <div>
            <p className="font-medium text-sm mb-1">Examens créés ({resume.examens_crees.length})</p>
            <ul className="text-sm text-slate-600 list-disc list-inside">
              {resume.examens_crees.map((e) => <li key={e.id}>{e.classe_nom}</li>)}
            </ul>
          </div>
          {resume.epreuves_ignorees.length > 0 && (
            <div>
              <p className="font-medium text-sm mb-1 text-amber-700">Épreuves ignorées ({resume.epreuves_ignorees.length})</p>
              <ul className="text-sm text-amber-700 list-disc list-inside">
                {resume.epreuves_ignorees.map((ig, i) => <li key={i}>{ig.classe_nom} — {ig.matiere_nom} : {ig.raison}</li>)}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={reinitialiser}>Créer un autre lot</button>
            <button type="button" className="btn-primary" onClick={fermer}>Fermer</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-slate-500">
            Crée automatiquement un examen pour chaque classe du cycle choisi, avec les mêmes épreuves (matière, date, heure).
            Une matière non enseignée dans une classe (ou sans enseignant affecté) est ignorée pour cette classe.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Cycle</label>
              <select className="input" required value={form.cycle_id} onChange={set('cycle_id')}>
                <option value="">— Choisir —</option>
                {cycles.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Année scolaire</label>
              <select className="input" required value={form.annee_scolaire_id} onChange={set('annee_scolaire_id')}>
                <option value="">— Choisir —</option>
                {annees?.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Nom (appliqué à chaque classe)</label>
              <input className="input" required value={form.nom} onChange={set('nom')} placeholder="Ex. Composition du 2e trimestre" />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type_examen} onChange={set('type_examen')}>
                {TYPES_EXAMEN.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Bimestre</label>
              <select className="input" required value={form.bimestre_id} onChange={set('bimestre_id')}>
                <option value="">— Choisir —</option>
                {bimestres?.filter((b) => !form.annee_scolaire_id || String(b.annee_scolaire_id) === String(form.annee_scolaire_id))
                  .map((b) => <option key={b.id} value={b.id}>{b.libelle}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date de début</label>
              <input className="input" type="date" required value={form.date_debut} onChange={set('date_debut')} />
            </div>
            <div>
              <label className="label">Date de fin</label>
              <input className="input" type="date" required value={form.date_fin} onChange={set('date_fin')} min={form.date_debut} />
            </div>
          </div>

          <div>
            <label className="label">Épreuves (mêmes matière/date/heure pour toutes les classes du cycle)</label>
            <div className="space-y-2">
              {epreuves.map((ep, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select className="input !w-40" value={ep.matiere_id} onChange={(e) => updateEpreuve(i, 'matiere_id', e.target.value)}>
                    <option value="">Matière…</option>
                    {matieres?.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                  </select>
                  <input className="input !w-36" type="date" value={ep.date_examen} onChange={(e) => updateEpreuve(i, 'date_examen', e.target.value)} />
                  <input className="input !w-24" type="time" value={ep.heure_debut} onChange={(e) => updateEpreuve(i, 'heure_debut', e.target.value)} placeholder="Début" />
                  <input className="input !w-24" type="time" value={ep.heure_fin} onChange={(e) => updateEpreuve(i, 'heure_fin', e.target.value)} placeholder="Fin" />
                  <input className="input !w-16" type="number" min="1" value={ep.coefficient} onChange={(e) => updateEpreuve(i, 'coefficient', e.target.value)} title="Coefficient" />
                  {epreuves.length > 1 && (
                    <button type="button" className="btn-ghost !px-2 !py-1 text-red-600" onClick={() => removeEpreuve(i)} aria-label="Retirer">✕</button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="btn-secondary mt-2" onClick={addEpreuve}>+ Ajouter une épreuve</button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={fermer}>Annuler</button>
            <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Création…' : 'Créer les examens'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

const FORM_EPREUVE_VIDE = { matiere_id: '', enseignant_id: '', date_examen: '', heure_debut: '', heure_fin: '', coefficient: 1 };

const EPREUVES_EXPORT_COLUMNS = [
  { label: 'Matière', value: (r) => r.matiere_nom },
  { label: 'Enseignant', value: (r) => `${r.enseignant_prenom || ''} ${r.enseignant_nom}`.trim() },
  { label: 'Date', value: (r) => new Date(r.date_examen).toLocaleDateString('fr-FR') },
  { label: 'Heure', value: (r) => (r.heure_debut ? `${r.heure_debut}${r.heure_fin ? ` - ${r.heure_fin}` : ''}` : '—') },
  { label: 'Coefficient', value: (r) => r.coefficient },
  { label: 'Résultats saisis', value: (r) => `${r.nb_resultats_saisis ?? 0}/${r.effectif_classe ?? 0}` },
];

function DetailExamen({ examen, onRetour }) {
  const { peutGerer, isAdmin, peutSaisir } = usePermissionsExamens();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEpreuve, setEditingEpreuve] = useState(null);
  const [epreuveOuverte, setEpreuveOuverte] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();

  const { data: matieres } = useFetch(() => client.get('/matieres').then((r) => r.data), []);
  const { data: affectations } = useFetch(
    () => client.get('/affectations/enseignant-matiere-classe', { params: { classe_id: examen.classe_id } }).then((r) => r.data),
    [examen.classe_id]
  );
  const { data: epreuves, loading, error, reload } = useFetch(
    () => client.get(`/examens/${examen.id}/matieres`).then((r) => r.data),
    [examen.id]
  );

  const [form, setForm] = useState(FORM_EPREUVE_VIDE);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Enseignants affectés à cette classe pour la matière choisie (RG-011/012 déjà appliquées côté backend)
  const enseignantsPourMatiere = (affectations || []).filter((a) => String(a.matiere_id) === String(form.matiere_id));

  const openCreate = () => {
    setEditingEpreuve(null);
    setForm({ ...FORM_EPREUVE_VIDE, date_examen: examen.date_debut?.slice(0, 10) || '' });
    setModalOpen(true);
  };
  const openEdit = (ep) => {
    setEditingEpreuve(ep);
    setForm({
      matiere_id: ep.matiere_id, enseignant_id: ep.enseignant_id, date_examen: ep.date_examen?.slice(0, 10),
      heure_debut: ep.heure_debut || '', heure_fin: ep.heure_fin || '', coefficient: ep.coefficient,
    });
    setModalOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingEpreuve) {
        await client.put(`/examens/${examen.id}/matieres/${editingEpreuve.id}`, form);
        toast.success('Épreuve modifiée.');
      } else {
        await client.post(`/examens/${examen.id}/matieres`, form);
        toast.success('Épreuve ajoutée.');
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const supprimer = async (ep) => {
    const ok = await confirm({
      title: 'Supprimer l\'épreuve',
      message: `Supprimer l'épreuve de ${ep.matiere_nom} ? Les résultats déjà saisis pour cette épreuve seront supprimés.`,
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    try {
      await client.delete(`/examens/${examen.id}/matieres/${ep.id}`);
      toast.success('Épreuve supprimée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const imprimer = () => {
    printTable({
      title: `Programme des épreuves — ${examen.nom}`,
      subtitle: `${examen.classe_nom || ''} — Généré le ${new Date().toLocaleDateString('fr-FR')}`,
      columns: EPREUVES_EXPORT_COLUMNS,
      rows: epreuves,
    });
  };

  const exporter = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: EPREUVES_EXPORT_COLUMNS, rows: epreuves, filename: `epreuves_${examen.nom}`, sheetName: 'Épreuves' }));
  };

  if (epreuveOuverte) {
    return <SaisieResultats examen={examen} epreuve={epreuveOuverte} onRetour={() => setEpreuveOuverte(null)} peutSaisir={peutSaisir} />;
  }

  return (
    <div>
      <button className="btn-ghost !px-0 mb-4" onClick={onRetour}><ArrowLeft size={15} className="inline -mt-0.5 mr-1" />Retour aux examens</button>
      <SectionHeader
        title={examen.nom}
        subtitle={<span className="inline-flex items-center gap-2">Épreuves par matière <Badge tone={STATUT_TONE[examen.statut] || 'slate'}>{STATUT_LABELS[examen.statut] || examen.statut}</Badge></span>}
        action={(
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={!epreuves?.length} onClick={imprimer}>🖨️ Imprimer</button>
            <button className="btn-secondary" disabled={!epreuves?.length} onClick={exporter}>📊 Exporter Excel</button>
            {peutGerer && (
              <button className="btn-primary" onClick={openCreate}><Plus size={15} className="inline -mt-0.5 mr-1" />Ajouter une épreuve</button>
            )}
          </div>
        )}
      />

      {!peutSaisir && (
        <p className="text-xs text-slate-500 mb-4">
          Consultation seule des résultats — la saisie des notes reste réservée à l&apos;admin et à l&apos;enseignant responsable de chaque épreuve.
        </p>
      )}

      <div className="card">
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={epreuves}
          emptyLabel="Aucune épreuve ajoutée pour cet examen."
          columns={[
            {
              key: 'matiere_nom', label: 'Matière',
              render: (r) => {
                const col = couleurMatiere(r.matiere_nom, r.matiere_couleur);
                return (
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${col.dot}`} />
                    <span>{r.matiere_nom}</span>
                  </div>
                );
              },
            },
            { key: 'enseignant_nom', label: 'Enseignant responsable', render: (r) => `${r.enseignant_prenom || ''} ${r.enseignant_nom}` },
            { key: 'date_examen', label: 'Date', render: (r) => new Date(r.date_examen).toLocaleDateString('fr-FR') },
            { key: 'coefficient', label: 'Coefficient' },
            {
              key: 'nb_resultats_saisis', label: 'Résultats',
              render: (r) => {
                const total = r.effectif_classe ?? 0;
                const saisis = r.nb_resultats_saisis ?? 0;
                const tone = total === 0 ? 'slate' : saisis === 0 ? 'red' : saisis < total ? 'amber' : 'green';
                return <Badge tone={tone}>{saisis}/{total}</Badge>;
              },
            },
          ]}
          actions={(r) => (
            <div className="flex justify-end gap-1">
              <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => setEpreuveOuverte(r)}>
                {peutSaisir ? 'Saisir les résultats' : 'Voir les résultats'}
              </button>
              {peutGerer && (
                <button className="btn-ghost !p-1.5" title="Modifier" onClick={() => openEdit(r)}>
                  <Pencil size={15} />
                </button>
              )}
              {isAdmin && (
                <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(r)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          )}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingEpreuve ? `Modifier — ${editingEpreuve.matiere_nom}` : 'Nouvelle épreuve'} wide>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Matière</label>
            <select className="input" required disabled={!!editingEpreuve} value={form.matiere_id} onChange={set('matiere_id')}>
              <option value="">— Choisir —</option>
              {matieres?.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Enseignant responsable</label>
            <select className="input" required value={form.enseignant_id} onChange={set('enseignant_id')} disabled={!form.matiere_id}>
              <option value="">{form.matiere_id ? '— Choisir —' : 'Choisissez une matière d’abord'}</option>
              {enseignantsPourMatiere.map((a) => (
                <option key={a.enseignant_id} value={a.enseignant_id}>{a.enseignant_prenom} {a.enseignant_nom}</option>
              ))}
            </select>
            {form.matiere_id && enseignantsPourMatiere.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Aucun enseignant affecté à cette matière pour cette classe (voir « Affectations »).</p>
            )}
          </div>
          <div>
            <label className="label">Date de l&apos;épreuve</label>
            <input className="input" type="date" required value={form.date_examen} onChange={set('date_examen')} />
          </div>
          <div>
            <label className="label">Coefficient</label>
            <input className="input" type="number" min="1" max="7" value={form.coefficient} onChange={set('coefficient')} />
          </div>
          <div>
            <label className="label">Heure de début</label>
            <input className="input" type="time" value={form.heure_debut} onChange={set('heure_debut')} />
          </div>
          <div>
            <label className="label">Heure de fin</label>
            <input className="input" type="time" value={form.heure_fin} onChange={set('heure_fin')} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">{editingEpreuve ? 'Enregistrer' : 'Ajouter'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const RESULTATS_EXPORT_COLUMNS = [
  { label: 'Élève', value: (r) => `${r.prenom || ''} ${r.nom}`.trim() },
  { label: 'Note / 20', value: (r) => (r.absence ? 'Absent' : (r.note ?? '')) },
  { label: 'Observation', value: (r) => r.observation || '' },
];

function SaisieResultats({ examen, epreuve, onRetour, peutSaisir = true }) {
  const toast = useToast();
  const { data: eleves } = useFetch(
    () => client.get('/eleves', { params: { classe_id: epreuve.classe_id || examen.classe_id } }).then((r) => r.data).catch(() => []),
    [epreuve.classe_id, examen.classe_id]
  );
  const { data: resultats, reload } = useFetch(
    () => client.get(`/examens/resultats/${epreuve.id}`).then((r) => r.data),
    [epreuve.id]
  );

  const resultatParEleve = new Map((resultats || []).map((r) => [r.eleve_id, r]));
  const [brouillon, setBrouillon] = useState({});
  const [enregistrementEnCours, setEnregistrementEnCours] = useState(false);

  const valeur = (eleveId, champ) => {
    if (brouillon[eleveId]?.[champ] !== undefined) return brouillon[eleveId][champ];
    const existant = resultatParEleve.get(eleveId);
    if (champ === 'note') return existant?.note ?? '';
    if (champ === 'absence') return existant?.absence ?? false;
    if (champ === 'observation') return existant?.observation ?? '';
    return '';
  };

  const majBrouillon = (eleveId, champ, val) => {
    setBrouillon((b) => ({ ...b, [eleveId]: { ...b[eleveId], [champ]: val } }));
  };

  // Statistiques de classe calculées sur les notes déjà enregistrées (pas le brouillon en cours de saisie).
  const stats = useMemo(() => {
    const notes = (resultats || []).filter((r) => !r.absence && r.note !== null && r.note !== undefined).map((r) => Number(r.note));
    const absents = (resultats || []).filter((r) => r.absence).length;
    if (!notes.length) return { moyenne: null, max: null, min: null, absents };
    const moyenne = (notes.reduce((a, b) => a + b, 0) / notes.length).toFixed(2);
    return { moyenne, max: Math.max(...notes), min: Math.min(...notes), absents };
  }, [resultats]);

  const enregistrerUn = async (eleveId, { silencieux } = {}) => {
    await client.post('/examens/resultats', {
      examen_matiere_id: epreuve.id,
      eleve_id: eleveId,
      note: valeur(eleveId, 'note') === '' ? null : Number(valeur(eleveId, 'note')),
      absence: Boolean(valeur(eleveId, 'absence')),
      observation: valeur(eleveId, 'observation') || null,
    });
    if (!silencieux) toast.success('Résultat enregistré.');
  };

  const enregistrer = async (eleveId) => {
    try {
      await enregistrerUn(eleveId);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const enregistrerTout = async () => {
    const idsModifies = Object.keys(brouillon).map(Number).filter((id) => (eleves || []).some((e) => e.id === id));
    if (!idsModifies.length) { toast.error('Aucune modification à enregistrer.'); return; }
    setEnregistrementEnCours(true);
    try {
      for (const eleveId of idsModifies) {
        await enregistrerUn(eleveId, { silencieux: true });
      }
      toast.success(`${idsModifies.length} résultat(s) enregistré(s).`);
      setBrouillon({});
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setEnregistrementEnCours(false);
    }
  };

  const classeNom = examen.classe_nom || epreuve.classe_nom || '';

  const imprimer = () => {
    printTable({
      title: `Résultats — ${epreuve.matiere_nom} (${examen.nom})`,
      subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}${stats.moyenne ? ` — Moyenne : ${stats.moyenne}/20` : ''}`,
      columns: RESULTATS_EXPORT_COLUMNS,
      rows: resultats,
    });
  };

  const exporter = () => {
    import('../../utils/excelExport').then((m) => m.exportToExcel({
      columns: RESULTATS_EXPORT_COLUMNS,
      rows: resultats,
      filename: `resultats_${epreuve.matiere_nom}_${classeNom || 'classe'}`,
      sheetName: 'Résultats',
    }));
  };

  return (
    <div>
      <button className="btn-ghost !px-0 mb-4" onClick={onRetour}><ArrowLeft size={15} className="inline -mt-0.5 mr-1" />Retour aux épreuves</button>
      <SectionHeader
        title={`Résultats — ${epreuve.matiere_nom}`}
        subtitle={`${epreuve.enseignant_prenom || ''} ${epreuve.enseignant_nom} · coefficient ${epreuve.coefficient}`}
        action={(
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={!resultats?.length} onClick={imprimer}>🖨️ Imprimer</button>
            <button className="btn-secondary" disabled={!resultats?.length} onClick={exporter}>📊 Exporter Excel</button>
            {peutSaisir && (
              <button className="btn-primary" disabled={enregistrementEnCours} onClick={enregistrerTout}>
                {enregistrementEnCours ? 'Enregistrement…' : 'Enregistrer tout'}
              </button>
            )}
          </div>
        )}
      />

      {stats.moyenne !== null && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="card !py-3 text-center">
            <p className="text-xs text-slate-500">Moyenne</p>
            <p className="text-lg font-display font-bold text-slate-900">{stats.moyenne}/20</p>
          </div>
          <div className="card !py-3 text-center">
            <p className="text-xs text-slate-500">Note max</p>
            <p className="text-lg font-display font-bold text-emerald-600">{stats.max}/20</p>
          </div>
          <div className="card !py-3 text-center">
            <p className="text-xs text-slate-500">Note min</p>
            <p className="text-lg font-display font-bold text-red-600">{stats.min}/20</p>
          </div>
          <div className="card !py-3 text-center">
            <p className="text-xs text-slate-500">Absents</p>
            <p className="text-lg font-display font-bold text-slate-900">{stats.absents}</p>
          </div>
        </div>
      )}

      <div className="card">
        <table className="table-base">
          <thead><tr><th>Élève</th><th>Note / 20</th><th>Absent</th><th>Observation</th><th></th></tr></thead>
          <tbody>
            {(eleves || []).map((el) => {
              const note = valeur(el.id, 'note');
              const modifie = brouillon[el.id] !== undefined;
              return (
                <tr key={el.id} className={modifie ? 'bg-amber-50/60' : undefined}>
                  <td>{el.nom} {el.prenom}</td>
                  {peutSaisir ? (
                    <>
                      <td>
                        <input
                          className={`input !py-1 w-20 ${note !== '' && !valeur(el.id, 'absence') ? `border-2 ${{ red: 'border-red-300', amber: 'border-amber-300', green: 'border-emerald-300', slate: '' }[toneNote(note)]}` : ''}`}
                          type="number" min="0" max="20" step="0.25"
                          disabled={valeur(el.id, 'absence')}
                          value={note}
                          onChange={(e) => majBrouillon(el.id, 'note', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(valeur(el.id, 'absence'))}
                          onChange={(e) => majBrouillon(el.id, 'absence', e.target.checked)}
                        />
                      </td>
                      <td>
                        <input
                          className="input !py-1"
                          placeholder="Optionnel"
                          value={valeur(el.id, 'observation')}
                          onChange={(e) => majBrouillon(el.id, 'observation', e.target.value)}
                        />
                      </td>
                      <td>
                        <button className="btn-ghost !px-2 !py-1 text-brand-700" onClick={() => enregistrer(el.id)}>Enregistrer</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{note !== '' ? `${note}/20` : '—'}</td>
                      <td>{valeur(el.id, 'absence') ? 'Oui' : 'Non'}</td>
                      <td>{valeur(el.id, 'observation') || '—'}</td>
                      <td></td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {(!eleves || eleves.length === 0) && <p className="text-sm text-slate-400 py-6 text-center">Aucun élève dans cette classe.</p>}
      </div>
    </div>
  );
}
