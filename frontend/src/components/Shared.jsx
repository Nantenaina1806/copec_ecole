import { forwardRef, useEffect, useId, useRef } from 'react';
import { Search, X } from 'lucide-react';

export function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="section-header-pro flex flex-wrap items-center justify-between gap-4 mb-5">
      <div className="relative z-10 min-w-0">
        <p className="section-kicker mb-1">COPEC3 · Gestion scolaire</p>
        <h2 className="text-xl md:text-2xl font-display font-extrabold tracking-tight text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {action && <div className="relative z-10 shrink-0">{action}</div>}
    </div>
  );
}

/**
 * `label` est optionnel : quand il est omis (comportement historique), le champ reste identifié
 * pour les lecteurs d'écran via un `aria-label` dérivé du placeholder. Un bouton "effacer" apparaît
 * dès qu'il y a du texte, pour vider la recherche sans repasser par le clavier.
 */
export function SearchInput({ value, onChange, placeholder = 'Rechercher…', label, className = '' }) {
  const inputId = useId();
  return (
    <div className={`relative max-w-xs w-full ${className}`}>
      {label && <label htmlFor={inputId} className="sr-only">{label}</label>}
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        id={inputId}
        type="text"
        className="input pl-9 pr-8"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ? undefined : placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          aria-label="Effacer la recherche"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// Input pour un montant en Ariary : affiche les milliers séparés (14 000) pendant la saisie
// au lieu d'un nombre brut (14000), tout en gardant `value`/`onChange` en chaîne numérique pure
// (compatible avec les payloads envoyés à l'API). onChange reçoit directement la valeur (string),
// pas un événement — plus simple à brancher qu'un <input> classique dans les formulaires de paie.
export function MontantInput({ value, onChange, placeholder, className = '', disabled, required, autoFocus }) {
  const affichage = value === '' || value === null || value === undefined
    ? ''
    : Number(String(value).replace(/\D/g, '') || 0).toLocaleString('fr-FR');
  const inputRef = useRef(null);
  // Empêche la soumission avec 0 Ar (le backend refuse déjà les montants <= 0 — règle RG-100 —
  // mais autant le signaler tout de suite dans le formulaire plutôt que d'attendre l'aller-retour
  // API). Recalculé à chaque frappe puisque `required` seul (HTML) ne bloque qu'un champ vide,
  // pas un « 0 » explicitement saisi.
  useEffect(() => {
    if (!inputRef.current) return;
    const numerique = Number(String(value ?? '').replace(/\D/g, '') || 0);
    inputRef.current.setCustomValidity(required && value !== '' && numerique <= 0 ? 'Le montant doit être supérieur à 0.' : '');
  }, [value, required]);
  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={`input pr-9 ${className}`}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={affichage}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">Ar</span>
    </div>
  );
}

export function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    brand: 'bg-brand-50 text-brand-800',
    violet: 'bg-violet-50 text-violet-700',
  };
  return <span className={`badge ${tones[tone]}`}>{children}</span>;
}

/**
 * <FormField label="Nom" htmlFor={id} error={errors.nom} hint="…" required>
 *   <input id={id} className="input" ... />
 * </FormField>
 *
 * Enveloppe générique pour associer un label, une aide contextuelle et un message d'erreur à
 * n'importe quel champ (y compris un champ personnalisé, ex. MontantInput). Les composants
 * TextInput / SelectInput / TextareaInput ci-dessous s'en servent déjà ; à utiliser directement
 * pour tout champ qui n'a pas encore de wrapper dédié.
 */
export function FormField({ label, htmlFor, error, hint, required, children, className = '', hideLabel }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className={hideLabel ? 'sr-only' : 'label'}>
          {label}{required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p id={`${htmlFor}-hint`} className="text-xs text-slate-400 mt-1">{hint}</p>}
      {error && <p id={`${htmlFor}-error`} className="text-xs text-red-600 mt-1" role="alert">{error}</p>}
    </div>
  );
}

/**
 * Champ texte labellisé de base, pour remplacer un `<input className="input" />` + `<label>`
 * écrits à la main. `id` est généré automatiquement si omis. Transmet toute prop native
 * supplémentaire (`type`, `maxLength`, `autoComplete`…) directement à l'`<input>`.
 */
export const TextInput = forwardRef(function TextInput(
  { label, error, hint, required, className = '', id, hideLabel, ...inputProps }, ref
) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <FormField label={label} htmlFor={fieldId} error={error} hint={hint} required={required} className={className} hideLabel={hideLabel}>
      <input
        ref={ref}
        id={fieldId}
        className="input"
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...inputProps}
      />
    </FormField>
  );
});

/** Équivalent de TextInput pour un `<select>` — passer les `<option>` en enfants comme d'habitude. */
export const SelectInput = forwardRef(function SelectInput(
  { label, error, hint, required, className = '', id, children, hideLabel, ...selectProps }, ref
) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <FormField label={label} htmlFor={fieldId} error={error} hint={hint} required={required} className={className} hideLabel={hideLabel}>
      <select
        ref={ref}
        id={fieldId}
        className="input"
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...selectProps}
      >
        {children}
      </select>
    </FormField>
  );
});

/** Équivalent de TextInput pour un `<textarea>`. */
export const TextareaInput = forwardRef(function TextareaInput(
  { label, error, hint, required, className = '', id, rows = 3, ...textareaProps }, ref
) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <FormField label={label} htmlFor={fieldId} error={error} hint={hint} required={required} className={className}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        className="input resize-y"
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...textareaProps}
      />
    </FormField>
  );
});

/** Case à cocher labellisée, avec la même zone cliquable pour la case et son texte. */
export const Checkbox = forwardRef(function Checkbox({ label, id, className = '', ...inputProps }, ref) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <label htmlFor={fieldId} className={`flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none ${className}`}>
      <input
        ref={ref}
        id={fieldId}
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-2 focus:ring-brand-400 focus:ring-offset-0"
        {...inputProps}
      />
      {label}
    </label>
  );
});
