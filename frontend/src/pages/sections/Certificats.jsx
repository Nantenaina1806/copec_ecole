import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Printer, Eye, Award, FileSpreadsheet, FileDown, RotateCcw, Info } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useEcole } from '../../context/EcoleContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatCard from '../../components/StatCard';
import { SectionHeader, SearchInput, SelectInput, TextInput, Badge } from '../../components/Shared';
import { printAttestationScolarite } from '../../utils/exportUtils';
import { getServerNow } from '../../utils/serverClock';

const TYPES_CERTIFICAT = [
  { value: 'scolarite', label: 'Certificat de scolarité', aide: "Preuve d'inscription en cours d'année — le cas le plus courant (bourse, transport, allocations…)." },
  { value: 'frequentation', label: 'Attestation de fréquentation', aide: "Confirme que l'élève suit assidûment les cours, sans détailler son statut d'inscription." },
  { value: 'radiation', label: 'Certificat de radiation', aide: "Officialise la sortie définitive des effectifs (transfert, abandon…). Le motif est obligatoire." },
];
const TYPE_TONE = { scolarite: 'brand', frequentation: 'green', radiation: 'red' };
const STATUT_INSCRIPTION_TONE = { inscrit: 'green', en_cours: 'green', termine: 'slate', abandonne: 'amber', exclu: 'red' };
const STATUT_INSCRIPTION_LABEL = { inscrit: 'Inscrit', en_cours: 'En cours', termine: 'Terminé', abandonne: 'Abandonné', exclu: 'Exclu' };

function libelleType(type) {
  return TYPES_CERTIFICAT.find((t) => t.value === type)?.label || type;
}

function estDuMois(dateStr, ref) {
  const d = new Date(dateStr);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

const CERTIFICATS_EXPORT_COLUMNS = [
  { label: 'N°', value: (r) => r.numero },
  { label: 'Élève', value: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}`.trim() },
  { label: 'Matricule', value: (r) => r.matricule || '' },
  { label: 'Classe', value: (r) => r.classe_nom },
  { label: 'Année scolaire', value: (r) => r.annee_libelle },
  { label: 'Type', value: (r) => libelleType(r.type_certificat) },
  { label: 'Motif', value: (r) => r.motif || '' },
  { label: 'Date', value: (r) => new Date(r.date_emission).toLocaleDateString('fr-FR') },
  { label: 'Émis par', value: (r) => (r.emis_par_nom ? `${r.emis_par_prenom || ''} ${r.emis_par_nom}` : r.emis_par_agent_nom ? `${r.emis_par_agent_prenom || ''} ${r.emis_par_agent_nom}` : '—') },
];

export default function Certificats() {
  const toast = useToast();
  const ecole = useEcole();
  // Permet d'arriver directement sur le formulaire depuis l'action rapide du tableau de bord
  // (/admin/certificats?action=nouveau), même logique que Eleves.jsx et Presences.jsx. Le
  // paramètre eleve_id (venant du bouton "Nouveau certificat" de la fiche élève) présélectionne
  // directement l'élève pour éviter de le rechercher une seconde fois.
  const [searchParams, setSearchParams] = useSearchParams();
  const eleveIdParam = searchParams.get('eleve_id');
  const [search, setSearch] = useState('');
  const [typeFiltre, setTypeFiltre] = useState('');
  const [classeFiltre, setClasseFiltre] = useState('');
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [modalOpen, setModalOpen] = useState(() => searchParams.get('action') === 'nouveau');

  const { data: elevePreselectionne } = useFetch(
    () => eleveIdParam ? client.get(`/eleves/${eleveIdParam}/fiche`).then((r) => r.data.eleve).catch(() => null) : Promise.resolve(null),
    [eleveIdParam]
  );

  const fermerEtNettoyerUrl = () => {
    setModalOpen(false);
    if (searchParams.get('action') || searchParams.get('eleve_id')) setSearchParams({}, { replace: true });
  };

  const { data: certificats, loading, error, reload } = useFetch(
    () => client.get('/certificats').then((r) => r.data), []
  );

  const classesDisponibles = useMemo(() => {
    const parId = new Map();
    (certificats || []).forEach((c) => { if (!parId.has(c.classe_id)) parId.set(c.classe_id, c.classe_nom); });
    return [...parId.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  }, [certificats]);

  const filtresActifs = search || typeFiltre || classeFiltre || dateDebut || dateFin;
  const reinitialiserFiltres = () => { setSearch(''); setTypeFiltre(''); setClasseFiltre(''); setDateDebut(''); setDateFin(''); };

  const filtres = (certificats || []).filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      if (!`${c.eleve_nom} ${c.eleve_prenom || ''} ${c.matricule || ''} ${c.numero}`.toLowerCase().includes(q)) return false;
    }
    if (typeFiltre && c.type_certificat !== typeFiltre) return false;
    if (classeFiltre && String(c.classe_id) !== classeFiltre) return false;
    if (dateDebut && c.date_emission < dateDebut) return false;
    if (dateFin && c.date_emission > dateFin) return false;
    return true;
  });

  const stats = useMemo(() => {
    const maintenant = getServerNow();
    const liste = certificats || [];
    return {
      total: liste.length,
      ceMois: liste.filter((c) => estDuMois(c.date_emission, maintenant)).length,
      scolarite: liste.filter((c) => c.type_certificat === 'scolarite').length,
      radiation: liste.filter((c) => c.type_certificat === 'radiation').length,
    };
  }, [certificats]);

  const voir = (c) => {
    if (!printAttestationScolarite({ certificat: c, autoPrint: false, ecole })) {
      toast.error("Fenêtre bloquée par le navigateur : autorisez les pop-ups pour ce site.");
    }
  };
  const imprimer = (c) => {
    if (!printAttestationScolarite({ certificat: c, ecole })) {
      toast.error("Fenêtre bloquée par le navigateur : autorisez les pop-ups pour ce site.");
    }
  };

  return (
    <div>
      <SectionHeader
        title="Certificats & Attestations"
        subtitle="Certificats de scolarité, attestations de fréquentation et de radiation — délivrés à la famille."
        action={<button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={15} className="inline -mt-0.5 mr-1" />Nouveau certificat</button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard label="Certificats émis" value={stats.total} icon={<Award size={18} />} tone="brand" />
        <StatCard label="Émis ce mois-ci" value={stats.ceMois} icon="📅" tone="slate" />
        <StatCard label="Certificats de scolarité" value={stats.scolarite} icon="🎓" tone="accent" />
        <StatCard label="Certificats de radiation" value={stats.radiation} icon="📤" tone="red" />
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="max-w-xs flex-1 min-w-[200px]">
            <label className="label">Rechercher</label>
            <SearchInput value={search} onChange={setSearch} placeholder="Élève, matricule, numéro…" />
          </div>
          <SelectInput label="Type de document" className="max-w-xs flex-1 min-w-[180px]" value={typeFiltre} onChange={(e) => setTypeFiltre(e.target.value)}>
            <option value="">Tous les types</option>
            {TYPES_CERTIFICAT.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </SelectInput>
          <SelectInput label="Classe" className="max-w-xs flex-1 min-w-[160px]" value={classeFiltre} onChange={(e) => setClasseFiltre(e.target.value)}>
            <option value="">Toutes les classes</option>
            {classesDisponibles.map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
          </SelectInput>
          <TextInput label="Du" type="date" className="max-w-xs flex-1 min-w-[140px]" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          <TextInput label="Au" type="date" className="max-w-xs flex-1 min-w-[140px]" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
          {filtresActifs && (
            <button type="button" className="btn-ghost text-sm inline-flex items-center gap-1" onClick={reinitialiserFiltres}>
              <RotateCcw size={13} /> Réinitialiser
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-900">
            Registre des documents {filtresActifs && <span className="text-sm font-normal text-slate-400">({filtres.length} résultat{filtres.length > 1 ? 's' : ''})</span>}
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button" className="btn-secondary inline-flex items-center gap-1.5" disabled={!filtres.length}
              onClick={() => import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: CERTIFICATS_EXPORT_COLUMNS, rows: filtres, filename: 'certificats', sheetName: 'Certificats' }))}
            >
              <FileSpreadsheet size={15} /> Exporter Excel
            </button>
            <button
              type="button" className="btn-secondary inline-flex items-center gap-1.5" disabled={!filtres.length}
              onClick={() => import('../../utils/excelExport').then((m) => m.exportToPdf({
                title: 'Registre des certificats & attestations',
                subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')} — ${filtres.length} document(s)`,
                columns: CERTIFICATS_EXPORT_COLUMNS, rows: filtres, filename: 'certificats', ecole,
              }))}
            >
              <FileDown size={15} /> Exporter PDF
            </button>
          </div>
        </div>

        <DataTable
          loading={loading} error={error} onRetry={reload} rows={filtres} pageSize={10}
          emptyLabel={filtresActifs ? 'Aucun certificat ne correspond à ces filtres.' : 'Aucun certificat émis pour le moment.'}
          renderExpanded={(r) => (
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-slate-600 px-2">
              <p><span className="text-slate-400">Année scolaire :</span> {r.annee_libelle}</p>
              <p><span className="text-slate-400">Motif :</span> {r.motif || '—'}</p>
              <p><span className="text-slate-400">Émis le :</span> {new Date(r.date_emission).toLocaleDateString('fr-FR')}</p>
            </div>
          )}
          columns={[
            { key: 'numero', label: 'N°', sortable: true },
            { key: 'eleve_nom', label: 'Élève', sortable: true, render: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom}`.trim(), sortValue: (r) => `${r.eleve_nom} ${r.eleve_prenom || ''}` },
            { key: 'classe_nom', label: 'Classe', sortable: true },
            {
              key: 'type_certificat', label: 'Type', sortable: true, sortValue: (r) => libelleType(r.type_certificat),
              render: (r) => <Badge tone={TYPE_TONE[r.type_certificat] || 'slate'}>{libelleType(r.type_certificat)}</Badge>,
            },
            { key: 'date_emission', label: 'Date', sortable: true, render: (r) => new Date(r.date_emission).toLocaleDateString('fr-FR') },
            {
              key: 'emis_par', label: 'Émis par',
              render: (r) => (r.emis_par_nom ? `${r.emis_par_prenom || ''} ${r.emis_par_nom}` : r.emis_par_agent_nom ? `${r.emis_par_agent_prenom || ''} ${r.emis_par_agent_nom}` : '—'),
            },
          ]}
          actions={(r) => (
            <div className="inline-flex gap-1">
              <button className="btn-ghost !p-1.5" title="Aperçu" onClick={() => voir(r)}>
                <Eye size={15} />
              </button>
              <button className="btn-ghost !p-1.5" title="Imprimer" onClick={() => imprimer(r)}>
                <Printer size={15} />
              </button>
            </div>
          )}
        />
      </div>

      <NouveauCertificatModal
        open={modalOpen}
        onClose={fermerEtNettoyerUrl}
        eleveInitial={elevePreselectionne}
        onCree={(c) => { fermerEtNettoyerUrl(); reload(); imprimer(c); }}
      />
    </div>
  );
}

function NouveauCertificatModal({ open, onClose, onCree, eleveInitial }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [recherche, setRecherche] = useState('');
  const [eleveChoisi, setEleveChoisi] = useState(null);
  const [inscriptionId, setInscriptionId] = useState('');
  const [typeCertificat, setTypeCertificat] = useState('scolarite');
  const [motif, setMotif] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  // Présélectionne l'élève quand on arrive depuis sa fiche (bouton "Nouveau certificat" ->
  // /admin/certificats?action=nouveau&eleve_id=…), pour éviter de le rechercher une seconde fois.
  // Ajustement fait pendant le rendu (pattern recommandé par React) plutôt que via un effet.
  const [etaitOuvert, setEtaitOuvert] = useState(false);
  if (open && !etaitOuvert) {
    setEtaitOuvert(true);
    if (eleveInitial) setEleveChoisi(eleveInitial);
  } else if (!open && etaitOuvert) {
    setEtaitOuvert(false);
  }

  const { data: eleves } = useFetch(
    () => (recherche.length >= 2 ? client.get('/eleves', { params: { search: recherche } }).then((r) => r.data) : Promise.resolve([])),
    [recherche]
  );

  const { data: inscriptions } = useFetch(
    () => (eleveChoisi ? client.get('/inscriptions', { params: { eleve_id: eleveChoisi.id } }).then((r) => r.data) : Promise.resolve([])),
    [eleveChoisi]
  );

  // Les plus récentes d'abord (le cas le plus fréquent : délivrer un document pour l'année en
  // cours). La query renvoie déjà les inscriptions triées par date de début d'année décroissante.
  const inscriptionsTriees = useMemo(() => inscriptions || [], [inscriptions]);

  // Présélectionne automatiquement l'inscription de l'année scolaire active pour éviter un clic
  // inutile dans le cas courant (un seul élève n'a qu'une inscription active à la fois).
  // Ajustement fait pendant le rendu (pattern recommandé par React) plutôt que via un effet.
  const [inscriptionsSyncees, setInscriptionsSyncees] = useState(null);
  if (inscriptionsTriees !== inscriptionsSyncees) {
    setInscriptionsSyncees(inscriptionsTriees);
    if (!inscriptionId && inscriptionsTriees.length) {
      const active = inscriptionsTriees.find((i) => i.annee_actif);
      setInscriptionId(String((active || inscriptionsTriees[0]).id));
    }
  }

  const inscriptionChoisie = inscriptionsTriees.find((i) => String(i.id) === String(inscriptionId));
  const statutInattendu = inscriptionChoisie
    && ['scolarite', 'frequentation'].includes(typeCertificat)
    && !['inscrit', 'en_cours'].includes(inscriptionChoisie.statut);

  const reinitialiser = () => {
    setRecherche(''); setEleveChoisi(null); setInscriptionId(''); setTypeCertificat('scolarite'); setMotif(''); setFieldErrors({});
  };

  const fermer = () => { reinitialiser(); onClose(); };

  const submit = async (e) => {
    e.preventDefault();
    if (!eleveChoisi) { toast.error('Choisissez un élève.'); return; }
    const errs = {};
    if (!inscriptionId) errs.inscriptionId = 'Choisissez une inscription (classe / année scolaire).';
    if (typeCertificat === 'radiation' && !motif.trim()) errs.motif = 'Le motif est obligatoire pour un certificat de radiation.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }

    const ok = await confirm({
      title: 'Confirmer l\'émission',
      message: `Un numéro officiel sera attribué à ce ${libelleType(typeCertificat).toLowerCase()} pour ${eleveChoisi.prenom} ${eleveChoisi.nom}. Une fois émis, ce document ne peut plus être modifié ni annulé. Continuer ?`,
      confirmLabel: 'Émettre le document',
    });
    if (!ok) return;

    setSaving(true);
    try {
      const { data } = await client.post('/certificats', {
        eleve_id: eleveChoisi.id,
        inscription_id: inscriptionId,
        type_certificat: typeCertificat,
        motif: motif || undefined,
      });
      toast.success('Certificat émis.');
      reinitialiser();
      onCree(data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={fermer} title="Nouveau certificat" wide>
      <form onSubmit={submit} className="space-y-4">
        {!eleveChoisi ? (
          <div>
            <label className="label">Rechercher un élève</label>
            <SearchInput value={recherche} onChange={setRecherche} placeholder="Nom, prénom ou matricule…" />
            {recherche.length >= 2 && (
              <div className="mt-2 max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {(eleves || []).length === 0 && <p className="text-sm text-slate-400 p-3">Aucun élève trouvé.</p>}
                {(eleves || []).map((el) => (
                  <button
                    type="button" key={el.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between"
                    onClick={() => setEleveChoisi(el)}
                  >
                    <span>{el.prenom} {el.nom}</span>
                    <span className="text-xs text-slate-400">{el.matricule}{el.classe_nom ? ` · ${el.classe_nom}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between bg-brand-50 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Award size={16} className="text-brand-700" />
              <span className="font-medium">{eleveChoisi.prenom} {eleveChoisi.nom}</span>
              <span className="text-xs text-slate-500">{eleveChoisi.matricule}</span>
            </div>
            <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => { setEleveChoisi(null); setInscriptionId(''); }}>Changer</button>
          </div>
        )}

        {eleveChoisi && (
          <>
            <div>
              <SelectInput
                label="Classe / année scolaire" required value={inscriptionId}
                error={fieldErrors.inscriptionId}
                onChange={(e) => { setInscriptionId(e.target.value); setFieldErrors((er) => ({ ...er, inscriptionId: undefined })); }}
              >
                <option value="">— Choisir —</option>
                {inscriptionsTriees.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.classe_nom} — {i.annee_libelle || `année n°${i.annee_scolaire_id}`}{i.annee_actif ? ' (en cours)' : ''} · {STATUT_INSCRIPTION_LABEL[i.statut] || i.statut}
                  </option>
                ))}
              </SelectInput>
              {inscriptions && inscriptions.length === 0 && (
                <p className="text-xs text-red-500 mt-1">Cet élève n&apos;a aucune inscription enregistrée.</p>
              )}
              {inscriptionChoisie && inscriptionChoisie.statut !== 'inscrit' && (
                <p className="mt-1">
                  <Badge tone={STATUT_INSCRIPTION_TONE[inscriptionChoisie.statut] || 'slate'}>
                    Statut : {STATUT_INSCRIPTION_LABEL[inscriptionChoisie.statut] || inscriptionChoisie.statut}
                  </Badge>
                </p>
              )}
              {statutInattendu && (
                <p className="text-xs text-amber-600 mt-1 flex items-start gap-1">
                  <Info size={13} className="mt-0.5 shrink-0" />
                  Cette inscription n&apos;est pas active ({STATUT_INSCRIPTION_LABEL[inscriptionChoisie.statut]}) : vérifiez que c&apos;est bien l&apos;année à mentionner sur ce document.
                </p>
              )}
            </div>

            <SelectInput
              label="Type de document" value={typeCertificat} onChange={(e) => setTypeCertificat(e.target.value)}
              hint={TYPES_CERTIFICAT.find((t) => t.value === typeCertificat)?.aide}
            >
              {TYPES_CERTIFICAT.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </SelectInput>

            <TextInput
              label={`Motif ${typeCertificat === 'radiation' ? '(obligatoire)' : '(optionnel)'}`}
              value={motif}
              onChange={(e) => { setMotif(e.target.value); setFieldErrors((er) => ({ ...er, motif: undefined })); }}
              required={typeCertificat === 'radiation'}
              error={fieldErrors.motif}
              placeholder={typeCertificat === 'radiation' ? 'Ex : transfert vers un autre établissement…' : 'Ex : demande de bourse, transfert…'}
            />
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={fermer}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={saving || !eleveChoisi}>
            {saving ? 'Émission…' : 'Émettre et imprimer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
