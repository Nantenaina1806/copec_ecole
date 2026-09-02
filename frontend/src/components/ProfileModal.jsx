import { useRef, useState } from 'react';
import { Eye, EyeOff, ShieldCheck, CheckCircle2 } from 'lucide-react';
import Modal from './Modal';
import client, { apiErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const TAILLE_MAX_FICHIER = 5 * 1024 * 1024; // 5 Mo en entrée (le fichier est ensuite redimensionné)
const CIBLE_PX = 256; // photo de profil redimensionnée en carré, reste légère en base64

// Redimensionne/recadre l'image choisie en carré CIBLE_PX x CIBLE_PX et la renvoie en base64 (JPEG),
// pour éviter d'envoyer des photos volumineuses telles quelles au serveur.
function redimensionnerImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire l'image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Fichier image invalide.'));
      img.onload = () => {
        const taille = Math.min(img.width, img.height);
        const sx = (img.width - taille) / 2;
        const sy = (img.height - taille) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = CIBLE_PX;
        canvas.height = CIBLE_PX;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, taille, taille, 0, 0, CIBLE_PX, CIBLE_PX);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function initialesDe(nom, prenom) {
  return `${prenom?.[0] || ''}${nom?.[0] || ''}`.toUpperCase() || 'U';
}

export default function ProfileModal({ open, onClose }) {
  const { user, updateUser, logout } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);

  const [photoApercu, setPhotoApercu] = useState(null); // nouvelle photo choisie (base64), pas encore enregistrée
  const [motDePasseActuel, setMotDePasseActuel] = useState('');
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const photoAffichee = photoApercu || user?.photo_url;

  function reset() {
    setPhotoApercu(null);
    setMotDePasseActuel('');
    setNouveauMotDePasse('');
    setConfirmation('');
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFichier(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez choisir un fichier image.');
      return;
    }
    if (file.size > TAILLE_MAX_FICHIER) {
      toast.error('Image trop lourde (5 Mo maximum).');
      return;
    }
    try {
      const dataUrl = await redimensionnerImage(file);
      setPhotoApercu(dataUrl);
    } catch (err) {
      toast.error(err.message || "Impossible de traiter l'image.");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const changePhoto = Boolean(photoApercu);
    const changePassword = Boolean(nouveauMotDePasse || confirmation || motDePasseActuel);

    if (!changePhoto && !changePassword) {
      toast.info('Aucune modification à enregistrer.');
      return;
    }
    if (changePassword) {
      if (!motDePasseActuel) { toast.error('Indiquez votre mot de passe actuel.'); return; }
      if (!nouveauMotDePasse || nouveauMotDePasse.length < 10) { toast.error('Le nouveau mot de passe doit contenir au moins 10 caractères.'); return; }
      if (!/[A-Z]/.test(nouveauMotDePasse) || !/[a-z]/.test(nouveauMotDePasse) || !/[0-9]/.test(nouveauMotDePasse)) { toast.error('Utilisez au moins une majuscule, une minuscule et un chiffre.'); return; }
      if (nouveauMotDePasse !== confirmation) { toast.error('La confirmation ne correspond pas au nouveau mot de passe.'); return; }
    }

    const payload = {};
    if (changePhoto) payload.photo_url = photoApercu;
    if (changePassword) {
      payload.mot_de_passe_actuel = motDePasseActuel;
      payload.nouveau_mot_de_passe = nouveauMotDePasse;
    }

    setSaving(true);
    try {
      const { data } = await client.put('/auth/me', payload);
      updateUser({ photo_url: data.photo_url });
      handleClose();
      if (changePassword) {
        toast.success('Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.');
        await logout();
      } else {
        toast.success('Photo de profil mise à jour.');
      }
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Modifier le profil">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-center gap-4">
          {photoAffichee ? (
            <img src={photoAffichee} alt="Photo de profil" className="h-16 w-16 rounded-full object-cover shrink-0" />
          ) : (
            <div className="h-16 w-16 shrink-0 rounded-full bg-brand-800 text-white flex items-center justify-center text-lg font-semibold">
              {initialesDe(user?.nom, user?.prenom)}
            </div>
          )}
          <div>
            <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
              Changer la photo
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFichier} />
            <p className="text-xs text-slate-400 mt-1">JPG ou PNG, recadrée automatiquement.</p>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-brand-700" />
            <div>
              <p className="label mb-0">Changer le mot de passe</p>
              <p className="text-[11px] text-slate-400">10 caractères minimum · majuscule · minuscule · chiffre</p>
            </div>
          </div>
          {[
            ['Mot de passe actuel', motDePasseActuel, setMotDePasseActuel, showCurrent, setShowCurrent, 'current-password'],
            ['Nouveau mot de passe', nouveauMotDePasse, setNouveauMotDePasse, showNew, setShowNew, 'new-password'],
            ['Confirmer le nouveau mot de passe', confirmation, setConfirmation, showConfirm, setShowConfirm, 'new-password'],
          ].map(([label, value, setter, show, setShow, autoComplete]) => (
            <div key={label}>
              <label className="label">{label}</label>
              <div className="relative">
                <input type={show ? 'text' : 'password'} className="input pr-11" value={value} onChange={(e) => setter(e.target.value)} autoComplete={autoComplete} minLength={label === 'Mot de passe actuel' ? undefined : 10} />
                <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700" aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
          ))}
          {nouveauMotDePasse && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1.5">
              <p className="font-semibold text-slate-700">Contrôle de robustesse</p>
              <p className={nouveauMotDePasse.length >= 10 ? 'text-emerald-700' : 'text-slate-400'}><CheckCircle2 size={13} className="inline mr-1" />10 caractères minimum</p>
              <p className={/[A-Z]/.test(nouveauMotDePasse) ? 'text-emerald-700' : 'text-slate-400'}><CheckCircle2 size={13} className="inline mr-1" />Une majuscule</p>
              <p className={/[a-z]/.test(nouveauMotDePasse) ? 'text-emerald-700' : 'text-slate-400'}><CheckCircle2 size={13} className="inline mr-1" />Une minuscule</p>
              <p className={/[0-9]/.test(nouveauMotDePasse) ? 'text-emerald-700' : 'text-slate-400'}><CheckCircle2 size={13} className="inline mr-1" />Un chiffre</p>
              <p className={confirmation && confirmation === nouveauMotDePasse ? 'text-emerald-700' : 'text-slate-400'}><CheckCircle2 size={13} className="inline mr-1" />Confirmation identique</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={handleClose} disabled={saving}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
