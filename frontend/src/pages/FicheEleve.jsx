import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trash2, Printer, Plus, UserCheck, AlertTriangle, Pencil, Award } from 'lucide-react';
import client, { apiErrorMessage } from '../api/client';
import { BRAND } from '../utils/chartColors';
import { getServerToday, getServerYear } from '../utils/serverClock';
import { useFetch } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { useEcole } from '../context/EcoleContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { LoadingScreen, ErrorState } from '../components/Feedback';
import { Badge } from '../components/Shared';
import Modal from '../components/Modal';
import BulletinCompletModal from '../components/BulletinCompletModal';
import EmploiDuTempsGrid from '../components/EmploiDuTempsGrid';
import { toArray } from '../utils/array';

const TABS = [
  { key: 'notes', label: 'Notes', roles: ['admin', 'enseignant', 'secretaire'] },
  { key: 'absences', label: 'Absences' },
  { key: 'edt', label: 'Emploi du temps' },
  { key: 'bulletins', label: 'Bulletins', roles: ['admin', 'secretaire'] },
  { key: 'parents', label: 'Parents' },
  { key: 'discipline', label: 'Discipline' },
  { key: 'documents', label: 'Documents' },
  { key: 'carte', label: 'Carte élève' },
];

const STATUT_INSCRIPTION = [
  { value: 'inscrit', label: 'Inscrit' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'termine', label: 'Terminé' },
  { value: 'abandonne', label: 'Abandonné' },
  { value: 'exclu', label: 'Exclu' },
];
const STATUT_TONE = { inscrit: 'green', en_cours: 'green', termine: 'slate', abandonne: 'amber', exclu: 'red' };

export default function FicheEleve() {
  const { eleveId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const ecole = useEcole();
  const toast = useToast();
  // Note, bulletin et moyennes sont un domaine pédagogique/administratif — comme pour le menu
  // Sidebar (sections 'notes'/'bulletins'), le surveillant et l'économie n'y ont pas accès :
  // leur rôle porte sur la discipline, les absences et le contact parents, pas les résultats scolaires.
  const tabsVisibles = TABS.filter((t) => !t.roles || t.roles.includes(user?.role));
  const [tab, setTab] = useState('notes');
  const tabActif = tabsVisibles.some((t) => t.key === tab) ? tab : tabsVisibles[0]?.key;
  const [showBulletinModal, setShowBulletinModal] = useState(false);
  const { data, loading, error, reload } = useFetch(() => client.get(`/eleves/${eleveId}/fiche`).then((r) => r.data), [eleveId]);
  const notes = toArray(data?.notes);
  const absences = toArray(data?.absences);
  const bulletins = toArray(data?.bulletins);
  const parents = toArray(data?.parents);

  // Inscrire cet élève pour l'année active — même geste que "Inscrire cette année" dans la liste
  // Élèves, mais accessible directement depuis la fiche — utile quand on y arrive depuis la carte
  // "Élèves à inscrire" du tableau de bord, sans repasser par la liste.
  const peutInscrire = ['admin', 'secretaire'].includes(user?.role);
  const [inscrireModalOpen, setInscrireModalOpen] = useState(false);
  const [inscrireForm, setInscrireForm] = useState({ classe_id: '', numero_classe: '' });
  const [inscrireSaving, setInscrireSaving] = useState(false);
  const { data: anneeActive } = useFetch(
    () => peutInscrire ? client.get('/annees-scolaires/active').then((r) => r.data).catch(() => null) : Promise.resolve(null),
    [peutInscrire]
  );
  const { data: classesActives } = useFetch(
    () => anneeActive ? client.get('/classes', { params: { annee_scolaire_id: anneeActive.id } }).then((r) => r.data) : Promise.resolve([]),
    [anneeActive?.id]
  );

  const submitInscrire = async (e) => {
    e.preventDefault();
    if (!inscrireForm.classe_id) { toast.error('Choisissez une classe.'); return; }
    setInscrireSaving(true);
    try {
      await client.post('/inscriptions', {
        eleve_id: eleveId, classe_id: inscrireForm.classe_id, annee_scolaire_id: anneeActive.id,
        numero_classe: inscrireForm.numero_classe || undefined,
      });
      toast.success('Élève inscrit pour cette année.');
      setInscrireModalOpen(false);
      setInscrireForm({ classe_id: '', numero_classe: '' });
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setInscrireSaving(false);
    }
  };

  // Modifier l'inscription active de l'élève (changer de classe en cours d'année, marquer un
  // abandon/une exclusion, ajouter une observation) — le backend l'autorisait déjà (PUT
  // /inscriptions/:id, admin + secrétaire) mais aucun écran ne permettait de le déclencher une
  // fois l'inscription créée.
  const [modifierInscriptionOpen, setModifierInscriptionOpen] = useState(false);
  const [modifierInscriptionForm, setModifierInscriptionForm] = useState({ classe_id: '', numero_classe: '', statut: 'inscrit', observation: '' });
  const [modifierInscriptionSaving, setModifierInscriptionSaving] = useState(false);
  const { data: classesAnneeInscription } = useFetch(
    () => (modifierInscriptionOpen && data?.inscription)
      ? client.get('/classes', { params: { annee_scolaire_id: data.inscription.annee_scolaire_id } }).then((r) => r.data)
      : Promise.resolve([]),
    [modifierInscriptionOpen, data?.inscription?.annee_scolaire_id]
  );

  const openModifierInscription = () => {
    setModifierInscriptionForm({
      classe_id: data.inscription.classe_id, numero_classe: data.inscription.numero_classe || '',
      statut: data.inscription.statut || 'inscrit', observation: data.inscription.observation || '',
    });
    setModifierInscriptionOpen(true);
  };

  const submitModifierInscription = async (e) => {
    e.preventDefault();
    setModifierInscriptionSaving(true);
    try {
      await client.put(`/inscriptions/${data.inscription.id}`, {
        classe_id: modifierInscriptionForm.classe_id,
        numero_classe: modifierInscriptionForm.numero_classe || null,
        statut: modifierInscriptionForm.statut,
        observation: modifierInscriptionForm.observation || null,
      });
      toast.success('Inscription mise à jour.');
      setModifierInscriptionOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setModifierInscriptionSaving(false);
    }
  };

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const { eleve, emploi_du_temps } = data;

  return (
    <div>
      <button className="btn-ghost !px-0 mb-4" onClick={() => navigate(-1)}>&larr; Retour</button>

      <div className="card mb-5 flex items-center gap-4 flex-wrap">
        <div className="h-16 w-16 rounded-full bg-brand-800 text-white flex items-center justify-center text-xl font-bold">
          {eleve.nom?.[0]}{eleve.prenom?.[0]}
        </div>
        <div className="flex-1 min-w-[160px]">
          <h2 className="text-lg font-display font-bold text-slate-900">{eleve.nom} {eleve.prenom}</h2>
          <p className="text-sm text-slate-500 flex items-center gap-2 flex-wrap">
            <span>
              Matricule : <span className="data-mono">{eleve.matricule}</span>
              {' · '}
              {data.inscription
                ? `${data.inscription.classe_nom} (${data.inscription.annee_libelle})`
                : 'Non inscrit cette année'}
            </span>
            {data.inscription && data.inscription.statut !== 'inscrit' && (
              <Badge tone={STATUT_TONE[data.inscription.statut] || 'slate'}>
                {STATUT_INSCRIPTION.find((s) => s.value === data.inscription.statut)?.label || data.inscription.statut}
              </Badge>
            )}
            {!eleve.actif && <Badge tone="red">Dossier inactif</Badge>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {peutInscrire && (
            <button className="btn-secondary flex items-center gap-2" onClick={() => navigate(`/admin/certificats?action=nouveau&eleve_id=${eleveId}`)}>
              <Award size={16} /> Nouveau certificat
            </button>
          )}
          {data.inscription && peutInscrire && (
            <button className="btn-secondary flex items-center gap-2" onClick={openModifierInscription}>
              <Pencil size={16} /> Modifier l&apos;inscription
            </button>
          )}
          {!data.inscription && peutInscrire && anneeActive && (
            <button className="btn-primary flex items-center gap-2" onClick={() => setInscrireModalOpen(true)}>
              <UserCheck size={16} /> Inscrire cette année
            </button>
          )}
        </div>
      </div>

      {!data.inscription && peutInscrire && (
        <div className="card mb-5 border border-amber-200 bg-amber-50 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Cet élève n&apos;a pas d&apos;inscription pour l&apos;année scolaire active{anneeActive ? ` (${anneeActive.libelle})` : ''}.
            {anneeActive ? ' Utilisez « Inscrire cette année » ci-dessus pour l\'affecter à une classe.' : ' Aucune année scolaire active pour le moment.'}
          </p>
        </div>
      )}

      <div className="flex gap-2 mb-5 flex-wrap">
        {tabsVisibles.map((t) => (
          <button key={t.key} className={tabActif === t.key ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tabActif === 'notes' && (
        <div className="card">
          <table className="table-base">
            <thead><tr><th>Matière</th><th>Bimestre</th><th>Type</th><th>Note</th></tr></thead>
            <tbody>
              {notes.map((n) => (
                <tr key={n.id}><td>{n.matiere_nom}</td><td>{n.bimestre_libelle}</td><td>{n.type_evaluation}</td><td>{n.note_valeur}/20</td></tr>
              ))}
            </tbody>
          </table>
          {notes.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Aucune note enregistrée.</p>}
        </div>
      )}

      {tabActif === 'absences' && (
        <div className="card">
          <table className="table-base">
            <thead><tr><th>Date</th><th>Matière</th><th>Statut</th></tr></thead>
            <tbody>
              {absences.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.date_absence).toLocaleDateString('fr-FR')}</td>
                  <td>{a.matiere_nom || '—'}</td>
                  <td><Badge tone={a.justifiee ? 'green' : 'red'}>{a.justifiee ? 'Justifiée' : 'Non justifiée'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {absences.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Aucune absence enregistrée.</p>}
        </div>
      )}

      {tabActif === 'edt' && (
        <div className="card">
          <EmploiDuTempsGrid edt={emploi_du_temps} />
        </div>
      )}

      {tabActif === 'bulletins' && (
        <div className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-brand-50/60 border border-brand-100 rounded-xl">
            <div>
              <h3 className="font-bold text-brand-900">Bulletin Officiel {ecole.nom_ecole}</h3>
              <p className="text-xs text-brand-700">Format officiel Recto-Verso (5 bimestres + matières dynamiques de la classe + QR Code scan)</p>
            </div>
            <button className="btn-primary flex items-center gap-2" onClick={() => setShowBulletinModal(true)}>
              <Printer size={16} /> Voir & Imprimer le Bulletin Officiel (Recto-Verso)
            </button>
          </div>

          <table className="table-base">
            <thead><tr><th>Bimestre</th><th>Moyenne</th><th>Rang</th></tr></thead>
            <tbody>
              {bulletins.map((b) => (
                <tr key={b.id}>
                  <td>{b.bimestre_libelle}</td>
                  <td>{Number(b.moyenne_generale).toFixed(2)}/20</td>
                  <td>{b.rang} / {b.effectif_classe}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {bulletins.length === 0 && (
            <div className="py-6 text-center">
              <p className="text-sm text-slate-500 mb-2">Les moyennes calculées n&apos;ont pas encore été enregistrées pour cette année.</p>
              <p className="text-xs text-slate-400">Le bulletin vierge avec les matières de la classe est déjà disponible en cliquant sur le bouton ci-dessus.</p>
            </div>
          )}
        </div>
      )}

      {tabActif === 'parents' && <OngletParents parents={parents} />}
      {tabActif === 'discipline' && <OngletDiscipline eleveId={eleveId} eleveNom={`${eleve.nom} ${eleve.prenom || ''}`.trim()} />}
      {tabActif === 'documents' && <OngletDocuments eleveId={eleveId} />}

      {tabActif === 'carte' && <CarteEleve eleve={eleve} parents={parents} classeNom={data.inscription?.classe_nom} />}

      <BulletinCompletModal eleveId={eleveId} open={showBulletinModal} onClose={() => setShowBulletinModal(false)} />

      <Modal open={inscrireModalOpen} onClose={() => setInscrireModalOpen(false)} title="Inscrire cette année">
        <form onSubmit={submitInscrire} className="space-y-4">
          <div>
            <label className="label">Classe {anneeActive ? `(${anneeActive.libelle})` : ''}</label>
            <select className="input" required value={inscrireForm.classe_id} onChange={(e) => setInscrireForm((f) => ({ ...f, classe_id: e.target.value }))}>
              <option value="">— Choisir —</option>
              {classesActives?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="label">N° dans la classe (optionnel)</label>
            <input className="input" type="number" min="1" value={inscrireForm.numero_classe} onChange={(e) => setInscrireForm((f) => ({ ...f, numero_classe: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setInscrireModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={inscrireSaving}>{inscrireSaving ? 'Inscription…' : 'Inscrire'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={modifierInscriptionOpen} onClose={() => setModifierInscriptionOpen(false)} title="Modifier l'inscription">
        <form onSubmit={submitModifierInscription} className="space-y-4">
          <div>
            <label className="label">Classe</label>
            <select className="input" required value={modifierInscriptionForm.classe_id} onChange={(e) => setModifierInscriptionForm((f) => ({ ...f, classe_id: e.target.value }))}>
              {classesAnneeInscription?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="label">N° dans la classe (optionnel)</label>
            <input className="input" type="number" min="1" value={modifierInscriptionForm.numero_classe} onChange={(e) => setModifierInscriptionForm((f) => ({ ...f, numero_classe: e.target.value }))} />
          </div>
          <div>
            <label className="label">Statut</label>
            <select className="input" value={modifierInscriptionForm.statut} onChange={(e) => setModifierInscriptionForm((f) => ({ ...f, statut: e.target.value }))}>
              {STATUT_INSCRIPTION.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {['abandonne', 'exclu'].includes(modifierInscriptionForm.statut) && (
              <p className="text-xs text-amber-600 mt-1">Ce statut n&apos;annule pas l&apos;inscription : il ne fait que la marquer. Pensez à préciser le motif ci-dessous.</p>
            )}
          </div>
          <div>
            <label className="label">Observation (optionnel)</label>
            <textarea className="input" rows={3} value={modifierInscriptionForm.observation} onChange={(e) => setModifierInscriptionForm((f) => ({ ...f, observation: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModifierInscriptionOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={modifierInscriptionSaving}>{modifierInscriptionSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function OngletParents({ parents }) {
  return (
    <div className="card">
      <table className="table-base">
        <thead><tr><th>Nom</th><th>Lien</th><th>Téléphone</th><th>Email</th><th>Responsable principal</th></tr></thead>
        <tbody>
          {parents.map((p) => (
            <tr key={p.id}>
              <td>{p.nom} {p.prenom || ''}</td>
              <td>{p.lien_parente}</td>
              <td>{p.telephone}</td>
              <td>{p.email || '—'}</td>
              <td>{p.responsable_principal ? <Badge tone="green">Oui</Badge> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {parents.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Aucun parent lié à cet élève. Gérez les liens depuis la section « Parents ».</p>}
    </div>
  );
}

const GRAVITE = [
  { value: 'faible', label: 'Faible' },
  { value: 'moyenne', label: 'Moyenne' },
  { value: 'grave', label: 'Grave' },
  { value: 'tres_grave', label: 'Très grave' },
];
const GRAVITE_TONE = { faible: 'slate', moyenne: 'amber', grave: 'red', tres_grave: 'red' };

const FORM_DISCIPLINE_VIDE = { type_incident: '', description: '', date_incident: getServerToday(), sanction: '', gravite: 'faible' };

function OngletDiscipline({ eleveId, eleveNom }) {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(FORM_DISCIPLINE_VIDE);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { data: rawIncidents, loading, error, reload } = useFetch(
    () => client.get('/vie-scolaire/discipline', { params: { eleve_id: eleveId } }).then((r) => r.data),
    [eleveId]
  );
  const incidents = toArray(rawIncidents);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await client.post('/vie-scolaire/discipline', { ...form, eleve_id: eleveId });
      toast.success('Incident enregistré.');
      setModalOpen(false);
      setForm(FORM_DISCIPLINE_VIDE);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  return (
    <div className="card">
      <div className="flex justify-end mb-3">
        {/* Signaler un incident directement depuis la fiche de l'élève, sans devoir ressaisir sa
            recherche dans Vie scolaire — le geste le plus fréquent d'un surveillant. */}
        <button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={15} className="inline -mt-0.5 mr-1" />Nouvel incident</button>
      </div>
      <table className="table-base">
        <thead><tr><th>Date</th><th>Type</th><th>Gravité</th><th>Sanction</th><th>Parent informé</th></tr></thead>
        <tbody>
          {incidents.map((i) => (
            <tr key={i.id}>
              <td>{new Date(i.date_incident).toLocaleDateString('fr-FR')}</td>
              <td>{i.type_incident}</td>
              <td><Badge tone={GRAVITE_TONE[i.gravite] || 'slate'}>{i.gravite}</Badge></td>
              <td>{i.sanction || '—'}</td>
              <td><Badge tone={i.parent_informe ? 'green' : 'amber'}>{i.parent_informe ? 'Oui' : 'Non'}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
      {incidents.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Aucun incident disciplinaire enregistré.</p>}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={`Nouvel incident — ${eleveNom}`} wide>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Type d&apos;incident</label>
            <input className="input" required value={form.type_incident} onChange={set('type_incident')} placeholder="Ex. Bagarre, retard répété…" />
          </div>
          <div>
            <label className="label">Gravité</label>
            <select className="input" value={form.gravite} onChange={set('gravite')}>
              {GRAVITE.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date de l&apos;incident</label>
            <input className="input" type="date" required value={form.date_incident} onChange={set('date_incident')} />
          </div>
          <div>
            <label className="label">Sanction</label>
            <input className="input" value={form.sanction} onChange={set('sanction')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description</label>
            <textarea className="input" rows={3} value={form.description} onChange={set('description')} />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const TYPES_DOCUMENT = ['acte_naissance', 'photo', 'bulletin_precedent', 'certificat_medical', 'autre'];
const EXTENSIONS_ACCEPTEES = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx';
const TAILLE_MAX_MO = 10;

function OngletDocuments({ eleveId }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data: rawDocuments, loading, error, reload } = useFetch(
    () => client.get('/documents', { params: { eleve_id: eleveId } }).then((r) => r.data),
    [eleveId]
  );
  const documents = toArray(rawDocuments);
  const [mode, setMode] = useState('fichier'); // 'fichier' (upload) ou 'lien' (URL externe)
  const [form, setForm] = useState({ type_document: 'autre', nom_fichier: '', fichier_url: '', description: '' });
  const [fichier, setFichier] = useState(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const choisirFichier = (e) => {
    const f = e.target.files?.[0] || null;
    if (f && f.size > TAILLE_MAX_MO * 1024 * 1024) {
      toast.error(`Fichier trop volumineux (max ${TAILLE_MAX_MO} Mo).`);
      e.target.value = '';
      setFichier(null);
      return;
    }
    setFichier(f);
  };

  const reinitialiserForm = () => {
    setForm({ type_document: 'autre', nom_fichier: '', fichier_url: '', description: '' });
    setFichier(null);
  };

  const ajouter = async (e) => {
    e.preventDefault();
    if (mode === 'lien' && (!form.nom_fichier || !form.fichier_url)) {
      toast.error('Nom du fichier et URL/lien sont requis.');
      return;
    }
    if (mode === 'fichier' && !fichier) {
      toast.error('Choisissez un fichier à envoyer.');
      return;
    }

    setEnvoiEnCours(true);
    try {
      if (mode === 'fichier') {
        const data = new FormData();
        data.append('eleve_id', eleveId);
        data.append('type_document', form.type_document);
        if (form.nom_fichier) data.append('nom_fichier', form.nom_fichier);
        if (form.description) data.append('description', form.description);
        data.append('fichier', fichier);
        await client.post('/documents', data);
      } else {
        await client.post('/documents', { ...form, eleve_id: eleveId });
      }
      toast.success('Document ajouté.');
      reinitialiserForm();
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setEnvoiEnCours(false);
    }
  };

  const supprimer = async (d) => {
    if (!(await confirm({ title: 'Supprimer le document', message: `Supprimer « ${d.nom_fichier} » ?`, danger: true }))) return;
    try {
      await client.delete(`/documents/${d.id}`);
      toast.success('Document supprimé.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <div className="card">
        <table className="table-base">
          <thead><tr><th>Type</th><th>Fichier</th><th>Description</th><th></th></tr></thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <td>{d.type_document}</td>
                <td><a href={d.fichier_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{d.nom_fichier}</a></td>
                <td>{d.description || '—'}</td>
                <td className="text-right">
                  <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(d)}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {documents.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Aucun document enregistré pour cet élève.</p>}
      </div>

      <form onSubmit={ajouter} className="card grid sm:grid-cols-2 gap-3">
        <h3 className="font-semibold text-slate-900 sm:col-span-2">Ajouter un document</h3>

        <div className="sm:col-span-2 flex gap-2">
          <button type="button" className={mode === 'fichier' ? 'btn-primary !py-1.5' : 'btn-secondary !py-1.5'} onClick={() => setMode('fichier')}>
            📎 Envoyer un fichier
          </button>
          <button type="button" className={mode === 'lien' ? 'btn-primary !py-1.5' : 'btn-secondary !py-1.5'} onClick={() => setMode('lien')}>
            🔗 Lien / URL externe
          </button>
        </div>

        <div>
          <label className="label">Type de document</label>
          <select className="input" value={form.type_document} onChange={set('type_document')}>
            {TYPES_DOCUMENT.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {mode === 'fichier' ? (
          <>
            <div>
              <label className="label">Fichier ({TAILLE_MAX_MO} Mo max)</label>
              <input className="input" type="file" accept={EXTENSIONS_ACCEPTEES} onChange={choisirFichier} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Nom affiché (optionnel)</label>
              <input className="input" value={form.nom_fichier} onChange={set('nom_fichier')} placeholder={fichier?.name || 'Ex. acte_naissance.pdf'} />
            </div>
          </>
        ) : (
          <>
            <div><label className="label">Nom du fichier</label><input className="input" value={form.nom_fichier} onChange={set('nom_fichier')} placeholder="Ex. acte_naissance.pdf" /></div>
            <div className="sm:col-span-2">
              <label className="label">Lien / URL du fichier</label>
              <input className="input" value={form.fichier_url} onChange={set('fichier_url')} placeholder="https://…" />
            </div>
          </>
        )}

        <div className="sm:col-span-2"><label className="label">Description</label><input className="input" value={form.description} onChange={set('description')} /></div>
        <div className="sm:col-span-2 flex justify-end">
          <button type="submit" className="btn-primary" disabled={envoiEnCours}>{envoiEnCours ? 'Envoi…' : 'Ajouter'}</button>
        </div>
      </form>
    </div>
  );
}

function CarteEleve({ eleve, parents, classeNom }) {
  const ecole = useEcole();
  const responsable = parents?.find((p) => p.responsable_principal) || parents?.[0];
  return (
    <div className="card max-w-sm print:shadow-none print-area">
      <div className="border-2 border-brand-800 rounded-xl p-5 bg-gradient-to-br from-brand-50 to-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-bold text-brand-900 text-sm">{ecole.nom_ecole}</p>
            <p className="text-[10px] text-brand-600">Carte d&apos;élève {getServerYear()}</p>
          </div>
          <div className="h-8 w-8 rounded bg-accent-500 flex items-center justify-center font-bold text-white text-xs">{ecole.nom_ecole?.charAt(0) || 'C'}</div>
        </div>
        <div className="flex gap-4 items-center">
          <div className="h-20 w-20 rounded-lg bg-brand-800 text-white flex items-center justify-center text-2xl font-bold">
            {eleve.nom?.[0]}{eleve.prenom?.[0]}
          </div>
          <div className="text-sm">
            <p className="font-semibold text-slate-900">{eleve.nom} {eleve.prenom}</p>
            <p className="text-slate-500">{classeNom || '—'}</p>
            <p className="text-slate-500">Matricule : <span className="data-mono">{eleve.matricule}</span></p>
            {responsable && <p className="text-slate-500">Contact : {responsable.telephone}</p>}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-center bg-white rounded-lg p-3 border border-slate-100">
          <QrPlaceholder value={eleve.qr_code_data || eleve.matricule} />
        </div>
      </div>
      <button className="btn-secondary w-full mt-4 print:hidden" onClick={() => window.print()}>🖨️ Imprimer la carte</button>
    </div>
  );
}

// Rendu QR minimal côté client (pattern visuel stable dérivé de la donnée) — à remplacer par une vraie lib QR (ex. qrcode.react) en production.
function QrPlaceholder({ value }) {
  const size = 8;
  const cells = [];
  let seed = 0;
  for (let i = 0; i < value.length; i += 1) seed += value.charCodeAt(i);
  for (let i = 0; i < size * size; i += 1) {
    seed = (seed * 9301 + 49297) % 233280;
    cells.push(seed / 233280 > 0.5);
  }
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${size}, 6px)` }}>
      {cells.map((on, i) => (
        <div key={i} style={{ width: 6, height: 6, background: on ? BRAND[600] : 'transparent' }} />
      ))}
    </div>
  );
}
