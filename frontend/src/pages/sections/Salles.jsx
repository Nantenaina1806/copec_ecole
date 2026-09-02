import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Pencil, Trash2, RefreshCw, Printer, MapPin, CheckCircle2, XCircle } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { SectionHeader, Badge } from '../../components/Shared';

const RAISON_LABEL = {
  gps_indisponible: 'GPS indisponible au moment du scan',
  salle_sans_geofence: "Salle sans coordonnées GPS configurées",
  sortie_manquante: 'Scan de sortie manquant en fin de créneau',
  horloge_suspecte: "Horloge du téléphone incohérente avec l'heure serveur (à vérifier avant validation paie)",
};

export default function Salles() {
  const [tab, setTab] = useState('salles'); // 'salles' | 'a-valider'
  const { data: enAttente } = useFetch(
    () => client.get('/pointage/enseignant/a-valider').then((r) => r.data),
    []
  );
  const nbEnAttente = enAttente?.length ?? 0;

  return (
    <div>
      <SectionHeader
        title="Salles & Présence enseignant"
        subtitle="QR code par salle, géofence GPS et validation des présences ambiguës"
      />

      <div className="flex gap-2 mb-4">
        <button className={tab === 'salles' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('salles')}>
          Salles
        </button>
        <button className={tab === 'a-valider' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('a-valider')}>
          À valider {nbEnAttente > 0 && <Badge tone="amber">{nbEnAttente}</Badge>}
        </button>
      </div>

      {tab === 'salles' && <SallesListe />}
      {tab === 'a-valider' && <FileValidation rows={enAttente} />}
    </div>
  );
}

function SallesListe() {
  const { data: salles, loading, error, reload } = useFetch(() => client.get('/salles').then((r) => r.data), []);
  const toast = useToast();
  const confirm = useConfirm();

  const [modalOpen, setModalOpen] = useState(false);
  const [qrModalSalle, setQrModalSalle] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ nom: '', latitude: '', longitude: '', rayon_metres: 100 });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openCreate = () => {
    setEditing(null);
    setForm({ nom: '', latitude: '', longitude: '', rayon_metres: 100 });
    setModalOpen(true);
  };

  const openEdit = (s) => {
    setEditing(s);
    setForm({
      nom: s.nom,
      latitude: s.latitude ?? '',
      longitude: s.longitude ?? '',
      rayon_metres: s.rayon_metres,
    });
    setModalOpen(true);
  };

  const useMaPosition = () => {
    if (!navigator.geolocation) {
      toast.error('Géolocalisation non disponible sur cet appareil.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(7), longitude: pos.coords.longitude.toFixed(7) }));
        toast.success('Position actuelle récupérée.');
      },
      () => toast.error("Impossible d'obtenir la position (permission refusée ?)."),
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    const payload = {
      nom: form.nom,
      latitude: form.latitude === '' ? null : Number(form.latitude),
      longitude: form.longitude === '' ? null : Number(form.longitude),
      rayon_metres: Number(form.rayon_metres) || 100,
    };
    try {
      if (editing) {
        await client.put(`/salles/${editing.id}`, payload);
        toast.success('Salle mise à jour.');
      } else {
        await client.post('/salles', payload);
        toast.success('Salle créée. Imprimez son QR code depuis la liste.');
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const supprimer = async (s) => {
    if (!(await confirm({ title: 'Supprimer la salle', message: `Supprimer « ${s.nom} » ? Le QR affiché à sa porte ne fonctionnera plus.`, danger: true }))) return;
    try {
      await client.delete(`/salles/${s.id}`);
      toast.success('Salle supprimée.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const regenererQr = async (s) => {
    if (!(await confirm({
      title: 'Régénérer le QR code',
      message: `L'ancien QR affiché à la porte de « ${s.nom} » cessera immédiatement de fonctionner (utile s'il a été photographié/diffusé). Continuer ?`,
      danger: true,
    }))) return;
    try {
      const { data } = await client.post(`/salles/${s.id}/regenerer-qr`);
      toast.success('Nouveau QR généré — réimprimez-le et remplacez celui affiché à la porte.');
      setQrModalSalle(data);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div className="card">
      <div className="flex justify-end mb-4">
        <button className="btn-primary" onClick={openCreate}>+ Nouvelle salle</button>
      </div>

      <DataTable
        loading={loading} error={error} onRetry={reload} rows={salles}
        columns={[
          { key: 'nom', label: 'Salle', sortable: true },
          {
            key: 'geofence', label: 'Géofence GPS',
            render: (r) => r.latitude != null
              ? <span className="text-sm text-slate-600">{Number(r.latitude).toFixed(5)}, {Number(r.longitude).toFixed(5)} · {r.rayon_metres} m</span>
              : <Badge tone="amber">Non configurée</Badge>,
          },
          { key: 'actif', label: 'Statut', render: (r) => <Badge tone={r.actif ? 'green' : 'slate'}>{r.actif ? 'Active' : 'Inactive'}</Badge> },
        ]}
        actions={(s) => (
          <div className="flex justify-end gap-1">
            <button className="btn-ghost !p-1.5" title="Voir / imprimer le QR" onClick={() => setQrModalSalle(s)}>
              <Printer size={15} />
            </button>
            <button className="btn-ghost !p-1.5" title="Modifier" onClick={() => openEdit(s)}>
              <Pencil size={15} />
            </button>
            <button className="btn-ghost !p-1.5 text-amber-600" title="Régénérer le QR" onClick={() => regenererQr(s)}>
              <RefreshCw size={15} />
            </button>
            <button className="btn-ghost !p-1.5 text-red-600" title="Supprimer" onClick={() => supprimer(s)}>
              <Trash2 size={15} />
            </button>
          </div>
        )}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Modifier — ${editing.nom}` : 'Nouvelle salle'}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Nom de la salle</label>
            <input className="input" required value={form.nom} onChange={set('nom')} placeholder="Ex : Salle CM2" />
          </div>

          <div className="rounded-lg border border-slate-200 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Géofence GPS</span>
              <button type="button" className="btn-ghost !px-2 !py-1 text-xs inline-flex items-center gap-1" onClick={useMaPosition}>
                <MapPin size={13} /> Utiliser ma position actuelle
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Latitude</label>
                <input className="input" type="number" step="any" value={form.latitude} onChange={set('latitude')} placeholder="-21.4536" />
              </div>
              <div>
                <label className="label">Longitude</label>
                <input className="input" type="number" step="any" value={form.longitude} onChange={set('longitude')} placeholder="47.0854" />
              </div>
            </div>
            <div>
              <label className="label">Rayon accepté (mètres)</label>
              <input className="input" type="number" min="10" value={form.rayon_metres} onChange={set('rayon_metres')} />
              <p className="text-xs text-slate-400 mt-1">100 m par défaut — laisse une marge pour l&apos;imprécision GPS en intérieur.</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Annuler</button>
            <button type="submit" className="btn-primary">{editing ? 'Enregistrer' : 'Créer'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!qrModalSalle} onClose={() => setQrModalSalle(null)} title={`QR — ${qrModalSalle?.nom || ''}`}>
        {qrModalSalle && (
          <div className="text-center print:block print-area">
            <div className="inline-block bg-white p-4 rounded-lg border border-slate-200">
              <QRCodeSVG value={qrModalSalle.qr_code_data} size={220} />
            </div>
            <p className="mt-3 font-semibold text-slate-800">{qrModalSalle.nom}</p>
            <p className="text-xs text-slate-400">À imprimer et afficher à la porte de la salle.</p>
            <button className="btn-secondary mt-4 print:hidden" onClick={() => window.print()}>🖨️ Imprimer</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function FileValidation({ rows }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [reload, setReload] = useState(0);
  const { data, loading, error, reload: refetch } = useFetch(
    () => client.get('/pointage/enseignant/a-valider').then((r) => r.data),
    [reload]
  );

  const decider = async (r, decision) => {
    if (decision === 'rejeter') {
      const ok = await confirm({
        title: 'Rejeter ce pointage',
        message: `Le pointage de ${r.prenom} ${r.nom} (${r.date_pointage?.slice(0, 10)}) sera marqué comme non payé.`,
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await client.put(`/pointage/enseignant/${r.id}/valider`, { decision });
      toast.success(decision === 'accepter' ? 'Pointage validé.' : 'Pointage rejeté.');
      setReload((x) => x + 1);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const source = rows ?? data;

  return (
    <div className="card">
      <p className="text-sm text-slate-500 mb-4">
        Pointages où le GPS était indisponible ou où le scan de sortie n&apos;a pas été effectué.
        Vérifiez et confirmez la durée à payer avant de générer la paie du mois.
      </p>
      <DataTable
        loading={loading} error={error} onRetry={refetch} rows={source}
        emptyLabel="Aucun pointage en attente de validation."
        columns={[
          { key: 'enseignant', label: 'Enseignant', render: (r) => `${r.prenom} ${r.nom}` },
          { key: 'date_pointage', label: 'Date', render: (r) => new Date(r.date_pointage).toLocaleDateString('fr-FR') },
          { key: 'classe_nom', label: 'Cours', render: (r) => `${r.classe_nom || '—'} · ${r.matiere_nom || '—'}` },
          { key: 'salle_nom', label: 'Salle' },
          { key: 'raison_refus', label: 'Motif', render: (r) => <Badge tone="amber">{RAISON_LABEL[r.raison_refus] || r.raison_refus}</Badge> },
          {
            key: 'duree', label: 'Durée proposée',
            render: (r) => r.duree_payee_minutes != null ? `${Math.floor(r.duree_payee_minutes / 60)}h${String(r.duree_payee_minutes % 60).padStart(2, '0')}` : '—',
          },
        ]}
        actions={(r) => (
          <div className="flex justify-end gap-1">
            <button className="btn-ghost !p-1.5 text-emerald-600" title="Valider" onClick={() => decider(r, 'accepter')}>
              <CheckCircle2 size={16} />
            </button>
            <button className="btn-ghost !p-1.5 text-red-600" title="Rejeter" onClick={() => decider(r, 'rejeter')}>
              <XCircle size={16} />
            </button>
          </div>
        )}
      />
    </div>
  );
}
