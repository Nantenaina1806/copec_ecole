import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * <Modal open onClose title wide>{children}</Modal>
 *
 * - Échap ferme la modale (sauf si `closeOnEscape={false}`).
 * - Le focus est piégé à l'intérieur pendant l'ouverture (Tab / Shift+Tab bouclent sur la modale)
 *   et rendu à l'élément qui avait le focus juste avant l'ouverture, à la fermeture.
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` pointant sur le titre, pour les lecteurs
 *   d'écran. Le défilement du corps de page est bloqué tant que la modale est ouverte.
 * - Le contenu (`children`) défile indépendamment de l'en-tête si la modale est plus haute que
 *   l'écran (utile pour les longs formulaires sur mobile).
 *
 * Tous ces ajouts sont additifs — signature et rendu visuel inchangés pour les appels existants.
 */
export default function Modal({ open, onClose, title, children, wide, closeOnEscape = true }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  // onClose est très souvent une fonction fléchée recréée à chaque rendu du parent (ex.
  // `onClose={() => setOpen(false)}`). En la lisant depuis une ref plutôt que comme dépendance
  // directe de l'effet ci-dessous, on évite que l'effet (et donc la mise au point initiale du
  // focus) ne se relance à chaque frappe dans un champ du formulaire — ce qui volerait le focus
  // de l'utilisateur en train de taper dès que le parent re-rend pour une raison quelconque.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus initial : premier élément focusable de la modale, sinon la modale elle-même.
    const focusables = dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR);
    (focusables?.[0] || dialogRef.current)?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      // Rend le focus à ce qui l'avait avant l'ouverture (ex. le bouton "Modifier" qui a ouvert la modale)
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus();
    };
     
  }, [open, closeOnEscape]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-start md:items-center justify-center bg-slate-900/40 p-4 overflow-y-auto">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} my-8 max-h-[calc(100vh-4rem)] flex flex-col animate-[fadein_0.15s] focus:outline-none`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 id={titleId} className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" aria-label="Fermer">&times;</button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
