import { useEffect, useRef, useState } from 'react';
import { Building2, Upload, Facebook, RotateCcw } from 'lucide-react';
import client, { apiErrorMessage } from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { SectionHeader } from '../../components/Shared';
import { SkeletonCard, ErrorState } from '../../components/Feedback';
import Modal from '../../components/Modal';

const VIDE = {
  nom_ecole: '', slogan: '', adresse: '', telephone: '', email: '',
  couleur_principale: '#1b3c62', couleur_accent: '#d99a3f', devise: 'Ar',
  jour_echeance_defaut: 10, relance_seuil_jours: 7, relance_frequence_jours: 7,
};

const HEX_RE = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const FACEBOOK_URL = 'https://www.facebook.com/copecisaha.fianarantsoa';

function normaliserCouleur(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export default function Parametres() {
  const toast = useToast();
  const { data: parametres, loading, error, reload } = useFetch(() => client.get('/parametres').then((r) => r.data), []);
  const [form, setForm] = useState(VIDE);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const fileInputRef = useRef(null);

  const [parametresSynced, setParametresSynced] = useState(null);
  if (parametres && parametres !== parametresSynced) {
    setParametresSynced(parametres);
    setForm({
      nom_ecole: parametres.nom_ecole || '',
      slogan: parametres.slogan || '',
      adresse: parametres.adresse || '',
      telephone: parametres.telephone || '',
      email: parametres.email || '',
      couleur_principale: parametres.couleur_principale || '#1b3c62',
      couleur_accent: parametres.couleur_accent || '#d99a3f',
      devise: parametres.devise || 'Ar',
      jour_echeance_defaut: parametres.jour_echeance_defaut ?? 10,
      relance_seuil_jours: parametres.relance_seuil_jours ?? 7,
      relance_frequence_jours: parametres.relance_frequence_jours ?? 7,
    });
  }

  const initialForm = parametres ? {
    nom_ecole: parametres.nom_ecole || '',
    slogan: parametres.slogan || '',
    adresse: parametres.adresse || '',
    telephone: parametres.telephone || '',
    email: parametres.email || '',
    couleur_principale: parametres.couleur_principale || '#1b3c62',
    couleur_accent: parametres.couleur_accent || '#d99a3f',
    devise: parametres.devise || 'Ar',
    jour_echeance_defaut: parametres.jour_echeance_defaut ?? 10,
    relance_seuil_jours: parametres.relance_seuil_jours ?? 7,
    relance_frequence_jours: parametres.relance_frequence_jours ?? 7,
  } : VIDE;

  const dirty = parametres && JSON.stringify(form) !== JSON.stringify(initialForm);
  const couleursValides = HEX_RE.test(normaliserCouleur(form.couleur_principale))
    && HEX_RE.test(normaliserCouleur(form.couleur_accent));

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const resetForm = () => {
    if (!dirty) return;
    setConfirmState({
      title: 'Annuler les modifications ?',
      message: 'Les modifications non enregistrées seront perdues.',
      confirmLabel: 'Réinitialiser',
      action: () => {
        setForm(initialForm);
        setConfirmState(null);
        toast.success('Modifications annulées.');
      },
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!couleursValides) {
      toast.error('Les couleurs doivent être au format HEX valide, par exemple #1b3c62.');
      return;
    }

    const echeanceOuRelanceModifiee =
      Number(form.jour_echeance_defaut) !== Number(initialForm.jour_echeance_defaut)
      || Number(form.relance_seuil_jours) !== Number(initialForm.relance_seuil_jours)
      || Number(form.relance_frequence_jours) !== Number(initialForm.relance_frequence_jours);

    if (echeanceOuRelanceModifiee) {
      setConfirmState({
        title: 'Confirmer les échéances et relances',
        message: 'Les nouvelles valeurs modifieront la génération des frais et les relances automatiques des parents. Voulez-vous continuer ?',
        confirmLabel: 'Confirmer et enregistrer',
        action: () => save(),
      });
      return;
    }
    await save();
  };

  const save = async () => {
    setConfirmState(null);
    setBusy(true);
    try {
      await client.put('/parametres', {
        ...form,
        couleur_principale: normaliserCouleur(form.couleur_principale),
        couleur_accent: normaliserCouleur(form.couleur_accent),
        jour_echeance_defaut: Number(form.jour_echeance_defaut),
        relance_seuil_jours: Number(form.relance_seuil_jours),
        relance_frequence_jours: Number(form.relance_frequence_jours),
      });
      toast.success('Paramètres enregistrés.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = new FormData();
    data.append('logo', file);
    setLogoBusy(true);
    try {
      await client.post('/parametres/logo', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Logo mis à jour.');
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setLogoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div>
        <SectionHeader title="Paramètres de l'école" subtitle="Identité, coordonnées et couleurs utilisées dans l'appli et les documents générés" />
        <div className="max-w-2xl"><SkeletonCard /></div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <SectionHeader title="Paramètres de l'école" subtitle="Identité, coordonnées et couleurs utilisées dans l'appli et les documents générés" />
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Paramètres de l'école" subtitle="Identité, coordonnées et couleurs utilisées dans l'appli et les documents générés" />

      <div className="card max-w-2xl">
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-100">
          <div className="h-16 w-16 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
            {parametres?.logo_url
              ? <img src={parametres.logo_url} alt="Logo" className="h-full w-full object-contain" />
              : <Building2 className="h-7 w-7 text-slate-300" />}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800 mb-1">Logo de l&apos;école</p>
            <button type="button" className="btn-secondary !py-1.5 inline-flex items-center gap-2" onClick={() => fileInputRef.current?.click()} disabled={logoBusy}>
              <Upload size={14} /> {logoBusy ? 'Envoi…' : 'Changer le logo'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onLogoChange} />
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Nom de l&apos;école</label>
            <input className="input" required value={form.nom_ecole} onChange={set('nom_ecole')} />
          </div>
          <div>
            <label className="label">Slogan (optionnel)</label>
            <input className="input" value={form.slogan} onChange={set('slogan')} />
          </div>
          <div>
            <label className="label">Adresse</label>
            <input className="input" value={form.adresse} onChange={set('adresse')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Téléphone</label>
              <input className="input" value={form.telephone} onChange={set('telephone')} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={set('email')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Couleur principale</label>
              <div className="flex items-center gap-2">
                <input type="color" className="h-10 w-12 rounded-lg border border-slate-200 cursor-pointer" value={HEX_RE.test(normaliserCouleur(form.couleur_principale)) ? form.couleur_principale : '#000000'} onChange={set('couleur_principale')} aria-label="Choisir la couleur principale" />
                <input
                  className={`input ${!HEX_RE.test(normaliserCouleur(form.couleur_principale)) ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : ''}`}
                  value={form.couleur_principale}
                  onChange={set('couleur_principale')}
                  aria-invalid={!HEX_RE.test(normaliserCouleur(form.couleur_principale))}
                  placeholder="#1b3c62"
                />
              </div>
              {!HEX_RE.test(normaliserCouleur(form.couleur_principale)) && <p className="text-xs text-red-600 mt-1">Format HEX invalide (ex. #1b3c62).</p>}
            </div>
            <div>
              <label className="label">Couleur d&apos;accent</label>
              <div className="flex items-center gap-2">
                <input type="color" className="h-10 w-12 rounded-lg border border-slate-200 cursor-pointer" value={HEX_RE.test(normaliserCouleur(form.couleur_accent)) ? form.couleur_accent : '#000000'} onChange={set('couleur_accent')} aria-label="Choisir la couleur d'accent" />
                <input
                  className={`input ${!HEX_RE.test(normaliserCouleur(form.couleur_accent)) ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : ''}`}
                  value={form.couleur_accent}
                  onChange={set('couleur_accent')}
                  aria-invalid={!HEX_RE.test(normaliserCouleur(form.couleur_accent))}
                  placeholder="#d99a3f"
                />
              </div>
              {!HEX_RE.test(normaliserCouleur(form.couleur_accent)) && <p className="text-xs text-red-600 mt-1">Format HEX invalide (ex. #d99a3f).</p>}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/70">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Aperçu en direct</p>
                <p className="text-xs text-slate-500">Les changements de couleur sont visibles avant l&apos;enregistrement.</p>
              </div>
              <div className="flex gap-2">
                <span className="h-8 w-8 rounded-lg border border-white shadow-sm" style={{ backgroundColor: couleursValides ? form.couleur_principale : '#cbd5e1' }} />
                <span className="h-8 w-8 rounded-lg border border-white shadow-sm" style={{ backgroundColor: couleursValides ? form.couleur_accent : '#cbd5e1' }} />
              </div>
            </div>
            <div className="rounded-lg overflow-hidden border border-slate-200 bg-white">
              <div className="px-4 py-3 flex items-center justify-between text-white" style={{ backgroundColor: couleursValides ? form.couleur_principale : '#64748b' }}>
                <span className="font-semibold text-sm">{form.nom_ecole || 'Nom de l’école'}</span>
                <span className="text-xs px-2 py-1 rounded-full" style={{ backgroundColor: couleursValides ? form.couleur_accent : '#94a3b8' }}>Accent</span>
              </div>
              <div className="p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg" style={{ backgroundColor: couleursValides ? form.couleur_accent : '#cbd5e1' }} />
                <div>
                  <p className="text-sm font-medium text-slate-800">Exemple de contenu</p>
                  <p className="text-xs text-slate-500">Aperçu des couleurs de votre école</p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="label">Devise</label>
            <select className="input" value={form.devise} onChange={set('devise')}>
              <option value="Ar">Ar — Ariary</option>
              <option value="USD">USD — Dollar américain</option>
              <option value="EUR">EUR — Euro</option>
            </select>
          </div>
          <p className="text-xs text-slate-400">
            Ces couleurs sont utilisées dans les documents générés (bulletins, reçus, rapports PDF). Le thème visuel de l&apos;application lui-même reste fixe pour l&apos;instant.
          </p>

          <div className="pt-4 border-t border-slate-100">
            <p className="text-sm font-medium text-slate-800 mb-1">Écolage et relances</p>
            <p className="text-xs text-slate-400 mb-3">
              Utilisé par la génération automatique des frais (onglet Finances → Tarifs) et par la relance
              quotidienne des parents en retard de paiement (onglet Finances → Relances impayés).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="label">Jour d&apos;échéance par défaut</label>
                <input className="input" type="number" min="1" max="28" value={form.jour_echeance_defaut} onChange={set('jour_echeance_defaut')} />
              </div>
              <div>
                <label className="label">Relance après (jours de retard)</label>
                <input className="input" type="number" min="0" value={form.relance_seuil_jours} onChange={set('relance_seuil_jours')} />
              </div>
              <div>
                <label className="label">Fréquence entre 2 relances (jours)</label>
                <input className="input" type="number" min="1" value={form.relance_frequence_jours} onChange={set('relance_frequence_jours')} />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <a
              href={FACEBOOK_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline"
            >
              <Facebook size={16} /> Facebook officiel de l&apos;école
            </a>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={resetForm} disabled={!dirty || busy}>
                <RotateCcw size={15} /> Annuler
              </button>
              <button type="submit" className="btn-primary" disabled={busy || !dirty || !couleursValides}>
                {busy ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
          {!dirty && <p className="text-xs text-slate-400 text-right">Aucune modification en attente.</p>}
        </form>
      </div>

      <Modal
        open={Boolean(confirmState)}
        onClose={() => setConfirmState(null)}
        title={confirmState?.title}
      >
        <p className="text-sm text-slate-600 mb-6">{confirmState?.message}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setConfirmState(null)}>Annuler</button>
          <button type="button" className="btn-primary" onClick={() => confirmState?.action?.()}>
            {confirmState?.confirmLabel || 'Confirmer'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// Facebook officiel : https://www.facebook.com/copecisaha.fianarantsoa
