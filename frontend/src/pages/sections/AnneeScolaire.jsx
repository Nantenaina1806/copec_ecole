import { useState } from 'react';
import { CalendarCheck2, Pencil } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { SectionHeader, Badge } from '../../components/Shared';

export default function AnneeScolaire() {
  const [modalOpen, setModalOpen] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [editAnnee, setEditAnnee] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();

  const { data: annees, loading, error, reload } = useFetch(() => client.get('/annees-scolaires').then((r) => r.data), []);
  const anneeActive = annees?.find((a) => a.actif);
  const autresAnnees = annees?.filter((a) => !a.actif) || [];
  const promotionPossible = !!anneeActive && autresAnnees.length > 0;

  const [form, setForm] = useState({ libelle: '', date_debut: '', date_fin: '' });
  const [dupliquerDepuis, setDupliquerDepuis] = useState('');
  const [creationBusy, setCreationBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.date_fin && form.date_debut && new Date(form.date_fin) <= new Date(form.date_debut)) {
      toast.error('La date de fin doit être postérieure à la date de début.');
      return;
    }
    setCreationBusy(true);
    try {
      const { data: nouvelleAnnee } = await client.post('/annees-scolaires', form);
      if (dupliquerDepuis) {
        try {
          await client.post(`/annees-scolaires/${nouvelleAnnee.id}/dupliquer-structure`, { annee_source_id: Number(dupliquerDepuis) });
          toast.success('Année créée et structure des classes dupliquée. Les effectifs démarrent à 0 : utilisez l\'Outil de promotion pour inscrire les élèves.');
        } catch (dupErr) {
          toast.error(`Année créée, mais la duplication de structure a échoué : ${apiErrorMessage(dupErr)}`);
        }
      } else {
        toast.success('Année scolaire créée.');
      }
      setModalOpen(false);
      setForm({ libelle: '', date_debut: '', date_fin: '' });
      setDupliquerDepuis('');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setCreationBusy(false);
    }
  };

  const activer = async (a) => {
    if (!(await confirm({ message: `Activer « ${a.libelle} » comme année scolaire courante ? L'année active actuelle sera désactivée.` }))) return;
    try {
      await client.put(`/annees-scolaires/${a.id}/activer`);
      toast.success('Année scolaire activée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div>
      <SectionHeader
        title="Année scolaire"
        subtitle="Gestion des années scolaires et promotion en masse"
        action={
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              onClick={() => setPromoOpen(true)}
              disabled={!promotionPossible}
              title={!promotionPossible ? "Nécessite une année active et au moins une autre année pour recevoir la promotion" : undefined}
            >
              Outil de promotion
            </button>
            <button className="btn-primary" onClick={() => setModalOpen(true)}>+ Nouvelle année</button>
          </div>
        }
      />

      <div className="card mb-5 flex items-center gap-4 bg-brand-50 border-brand-100">
        <div className="h-11 w-11 rounded-lg bg-brand-800 text-white flex items-center justify-center shrink-0">
          <CalendarCheck2 className="h-5 w-5" />
        </div>
        {anneeActive ? (
          <div>
            <p className="text-sm text-slate-500">Année scolaire active</p>
            <p className="font-display font-bold text-slate-900">
              {anneeActive.libelle}
              <span className="font-normal text-slate-500 text-sm ml-2">
                ({new Date(anneeActive.date_debut).toLocaleDateString('fr-FR')} – {new Date(anneeActive.date_fin).toLocaleDateString('fr-FR')})
              </span>
            </p>
          </div>
        ) : (
          <div>
            <p className="font-display font-bold text-slate-900">Aucune année scolaire active</p>
            <p className="text-sm text-slate-500">Activez une année ci-dessous pour pouvoir inscrire des élèves, saisir des notes et des paiements.</p>
          </div>
        )}
      </div>

      <div className="card">
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={annees}
          emptyLabel="Aucune année scolaire créée pour le moment. Commencez par en créer une."
          columns={[
            { key: 'libelle', label: 'Année' },
            { key: 'date_debut', label: 'Début', render: (r) => new Date(r.date_debut).toLocaleDateString('fr-FR') },
            { key: 'date_fin', label: 'Fin', render: (r) => new Date(r.date_fin).toLocaleDateString('fr-FR') },
            { key: 'effectif', label: 'Élèves inscrits', render: (r) => Number(r.effectif) },
            { key: 'actif', label: 'Statut', render: (r) => <Badge tone={r.actif ? 'green' : 'slate'}>{r.actif ? 'Active' : 'Inactive'}</Badge> },
          ]}
          actions={(a) => (
            <div className="flex items-center justify-end gap-1">
              <button className="btn-ghost !px-2 !py-1 text-slate-500" title="Modifier les dates" aria-label="Modifier les dates" onClick={() => setEditAnnee(a)}>
                <Pencil size={16} />
              </button>
              {!a.actif && <button className="btn-ghost !px-2 !py-1 text-brand-700" onClick={() => activer(a)}>Activer</button>}
            </div>
          )}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle année scolaire">
        <form onSubmit={submit} className="space-y-4">
          <div><label className="label">Libellé</label><input className="input" required placeholder="2026-2027" value={form.libelle} onChange={set('libelle')} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Date de début</label><input className="input" type="date" required value={form.date_debut} onChange={set('date_debut')} /></div>
            <div><label className="label">Date de fin</label><input className="input" type="date" required min={form.date_debut || undefined} value={form.date_fin} onChange={set('date_fin')} /></div>
          </div>
          {annees?.length > 0 && (
            <div>
              <label className="label">Dupliquer la structure des classes depuis (optionnel)</label>
              <select className="input" value={dupliquerDepuis} onChange={(e) => setDupliquerDepuis(e.target.value)}>
                <option value="">— Ne pas dupliquer, partir de zéro —</option>
                {annees.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Copie les classes, les matières par classe, les affectations enseignants et l&apos;emploi du temps depuis l&apos;année choisie.
                Les effectifs (inscriptions) démarrent toujours à 0 : utilisez ensuite l&apos;Outil de promotion pour inscrire les élèves.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" disabled={creationBusy} className="btn-primary">{creationBusy ? 'Création…' : 'Créer'}</button>
          </div>
        </form>
      </Modal>

      <PromotionModal open={promoOpen} onClose={() => setPromoOpen(false)} anneeActive={anneeActive} autresAnnees={autresAnnees} />
      <EditDatesModal annee={editAnnee} onClose={() => setEditAnnee(null)} onSaved={reload} />
    </div>
  );
}

function EditDatesModal({ annee, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ date_debut: '', date_fin: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Resynchronise le formulaire dès que l'année cible change (nouvelle ouverture du modal).
  // Ajustement fait pendant le rendu plutôt que via un useEffect (pattern recommandé par
  // React pour dériver un state depuis une prop qui change).
  const [anneeSyncee, setAnneeSyncee] = useState(null);
  if (annee && annee !== anneeSyncee) {
    setAnneeSyncee(annee);
    setForm({
      date_debut: annee.date_debut ? new Date(annee.date_debut).toISOString().slice(0, 10) : '',
      date_fin: annee.date_fin ? new Date(annee.date_fin).toISOString().slice(0, 10) : '',
    });
  }

  const submit = async (e) => {
    e.preventDefault();
    if (form.date_fin && form.date_debut && new Date(form.date_fin) <= new Date(form.date_debut)) {
      toast.error('La date de fin doit être postérieure à la date de début.');
      return;
    }
    setBusy(true);
    try {
      await client.put(`/annees-scolaires/${annee.id}`, form);
      toast.success('Dates mises à jour.');
      onClose();
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!annee} onClose={onClose} title={`Modifier les dates — ${annee?.libelle || ''}`}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">Date de début</label><input className="input" type="date" required value={form.date_debut} onChange={set('date_debut')} /></div>
          <div><label className="label">Date de fin</label><input className="input" type="date" required min={form.date_debut || undefined} value={form.date_fin} onChange={set('date_fin')} /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
}

function PromotionModal({ open, onClose, anneeActive, autresAnnees }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [anneeCible, setAnneeCible] = useState('');
  const [mappings, setMappings] = useState([{ classe_source_id: '', classe_cible_id: '', eleve_ids_exclus: [] }]);
  const [busy, setBusy] = useState(false);
  const [ligneOuverte, setLigneOuverte] = useState(null);

  const { data: classesSource } = useFetch(
    () => anneeActive ? client.get('/classes', { params: { annee_scolaire_id: anneeActive.id } }).then((r) => r.data) : Promise.resolve([]),
    [anneeActive?.id]
  );
  const { data: classesCible } = useFetch(
    () => anneeCible ? client.get('/classes', { params: { annee_scolaire_id: anneeCible } }).then((r) => r.data) : Promise.resolve([]),
    [anneeCible]
  );

  // Réinitialise la sélection à chaque ouverture, pour éviter de renvoyer une correspondance
  // basée sur une année cible ou des classes qui ne correspondent plus au contexte courant.
  // Ajustement fait pendant le rendu (pattern recommandé par React) plutôt que via un effet.
  const [etaitOuvert, setEtaitOuvert] = useState(false);
  if (open && !etaitOuvert) {
    setEtaitOuvert(true);
    setAnneeCible('');
    setMappings([{ classe_source_id: '', classe_cible_id: '', eleve_ids_exclus: [] }]);
    setLigneOuverte(null);
  } else if (!open && etaitOuvert) {
    setEtaitOuvert(false);
  }

  const addRow = () => setMappings((m) => [...m, { classe_source_id: '', classe_cible_id: '', eleve_ids_exclus: [] }]);
  const removeRow = (i) => setMappings((m) => m.filter((_, idx) => idx !== i));
  const updateRow = (i, key, val) => setMappings((m) => m.map((row, idx) => {
    if (idx !== i) return row;
    // Changer la classe source invalide les exclusions précédentes (élèves d'une autre classe).
    return key === 'classe_source_id' ? { ...row, [key]: val, eleve_ids_exclus: [] } : { ...row, [key]: val };
  }));
  const toggleExclusion = (i, eleveId) => setMappings((m) => m.map((row, idx) => {
    if (idx !== i) return row;
    const deja = row.eleve_ids_exclus.includes(eleveId);
    return { ...row, eleve_ids_exclus: deja ? row.eleve_ids_exclus.filter((id) => id !== eleveId) : [...row.eleve_ids_exclus, eleveId] };
  }));

  const mappingsValides = mappings.filter((m) => m.classe_source_id && m.classe_cible_id);
  const totalExclus = mappings.reduce((sum, m) => sum + m.eleve_ids_exclus.length, 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!anneeActive) return;
    if (mappingsValides.length === 0) {
      toast.error('Ajoutez au moins une correspondance classe source → classe destination.');
      return;
    }
    const cibleLibelle = autresAnnees.find((a) => String(a.id) === String(anneeCible))?.libelle || anneeCible;
    const messageExclus = totalExclus > 0 ? ` ${totalExclus} élève(s) sélectionné(s) comme non-promus resteront non inscrits sur l'année cible.` : '';
    if (!(await confirm({ message: `Confirmer la promotion de ${mappingsValides.length} classe(s) de « ${anneeActive.libelle} » vers « ${cibleLibelle} » ? Cette action inscrit les élèves concernés dans leur nouvelle classe.${messageExclus}` }))) return;

    setBusy(true);
    try {
      const res = await client.post(`/annees-scolaires/${anneeActive.id}/promotion`, {
        mappings: mappingsValides.map((m) => ({
          classe_source_id: m.classe_source_id,
          classe_cible_id: m.classe_cible_id,
          eleve_ids_exclus: m.eleve_ids_exclus,
        })),
        annee_cible_id: anneeCible,
      });
      toast.success(res.data?.message || 'Promotion effectuée.');
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Outil de promotion (passage de classe)" wide>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-500">
          Fait passer les élèves inscrits d&apos;une classe de <strong>{anneeActive?.libelle || '—'}</strong> (année active) vers une classe de l&apos;année cible choisie ci-dessous.
        </p>
        <div>
          <label className="label">Année scolaire cible</label>
          <select className="input" required value={anneeCible} onChange={(e) => { setAnneeCible(e.target.value); setMappings([{ classe_source_id: '', classe_cible_id: '', eleve_ids_exclus: [] }]); setLigneOuverte(null); }}>
            <option value="">— Choisir —</option>
            {autresAnnees.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          {mappings.map((row, i) => (
            <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-3">
                <select className="input" value={row.classe_source_id} onChange={(e) => updateRow(i, 'classe_source_id', e.target.value)}>
                  <option value="">Classe source ({anneeActive?.libelle || '—'})…</option>
                  {classesSource?.map((c) => <option key={c.id} value={c.id}>{c.nom} ({c.effectif} élève{c.effectif > 1 ? 's' : ''})</option>)}
                </select>
                <select className="input" disabled={!anneeCible} value={row.classe_cible_id} onChange={(e) => updateRow(i, 'classe_cible_id', e.target.value)}>
                  <option value="">Classe destination…</option>
                  {classesCible?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
                {row.classe_source_id && (
                  <button
                    type="button"
                    className="btn-ghost !px-2 !py-1 text-xs whitespace-nowrap"
                    onClick={() => setLigneOuverte((cur) => cur === i ? null : i)}
                  >
                    {ligneOuverte === i ? 'Masquer' : 'Voir'} les élèves{row.eleve_ids_exclus.length > 0 ? ` (${row.eleve_ids_exclus.length} exclu${row.eleve_ids_exclus.length > 1 ? 's' : ''})` : ''}
                  </button>
                )}
                {mappings.length > 1 && (
                  <button type="button" className="btn-ghost !px-2 !py-1 text-red-600" onClick={() => removeRow(i)} aria-label="Retirer cette ligne">✕</button>
                )}
              </div>
              {ligneOuverte === i && row.classe_source_id && (
                <ElevesSourceChecklist
                  classeId={row.classe_source_id}
                  elevesExclus={row.eleve_ids_exclus}
                  onToggle={(eleveId) => toggleExclusion(i, eleveId)}
                />
              )}
            </div>
          ))}
        </div>
        <button type="button" className="btn-secondary" onClick={addRow} disabled={!anneeCible}>+ Ajouter une correspondance</button>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={busy || !anneeCible} className="btn-primary">{busy ? 'Traitement…' : 'Lancer la promotion'}</button>
        </div>
      </form>
    </Modal>
  );
}

// Liste les élèves de la classe source choisie, avec une case à cocher par élève pour
// l'exclure de la promotion (redoublant, dossier en attente, etc.). Coché = exclu.
// Tous les élèves sont inclus (non exclus) par défaut, comme avant l'introduction de ce filtre.
function ElevesSourceChecklist({ classeId, elevesExclus, onToggle }) {
  const { data: classe, loading } = useFetch(
    () => classeId ? client.get(`/classes/${classeId}`).then((r) => r.data) : Promise.resolve(null),
    [classeId]
  );

  if (loading) return <p className="text-xs text-slate-400 px-1">Chargement des élèves…</p>;
  if (!classe?.eleves?.length) return <p className="text-xs text-slate-400 px-1">Aucun élève inscrit dans cette classe.</p>;

  return (
    <div className="max-h-48 overflow-y-auto border-t border-slate-100 pt-2 grid grid-cols-2 gap-x-4 gap-y-1">
      {classe.eleves.map((el) => {
        const exclu = elevesExclus.includes(el.id);
        return (
          <label key={el.id} className={`flex items-center gap-2 text-sm px-1 py-0.5 rounded cursor-pointer ${exclu ? 'text-red-600 line-through' : 'text-slate-700'}`}>
            <input type="checkbox" checked={exclu} onChange={() => onToggle(el.id)} />
            {el.nom} {el.prenom}
          </label>
        );
      })}
    </div>
  );
}
