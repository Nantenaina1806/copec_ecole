import { Inbox } from 'lucide-react';

/**
 * Feedback.jsx — états de chargement, d'erreur et de contenu vide, communs à toute l'appli.
 *
 * Exports :
 * - Spinner, LoadingScreen, ErrorState        (existants, inchangés dans leur usage)
 * - Skeleton, SkeletonText, SkeletonCard,
 *   SkeletonStatCards, SkeletonTable          (nouveaux — silhouettes de chargement génériques)
 * - EmptyState                                (nouveau — remplace les "Aucune donnée…" ad hoc)
 *
 * Tous les nouveaux composants sont additifs : rien n'a été retiré ni renommé, donc aucun usage
 * existant de Spinner/LoadingScreen/ErrorState n'est impacté.
 */

export function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin h-5 w-5 text-brand-700 ${className}`} viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function LoadingScreen({ label = 'Chargement…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3" role="status" aria-live="polite">
      <Spinner className="h-8 w-8" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3" role="alert">
      <p className="text-sm text-red-600 max-w-md whitespace-pre-line">{message}</p>
      {onRetry && <button className="btn-secondary" onClick={onRetry}>Réessayer</button>}
    </div>
  );
}

/**
 * <Skeleton className="h-4 w-32" /> — un simple bloc gris pulsé. Brique de base des silhouettes
 * ci-dessous ; utilisable directement pour composer une silhouette sur mesure ailleurs.
 */
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded bg-slate-200/80 ${className}`} aria-hidden="true" />;
}

/** Quelques lignes de texte simulées (ex. remplaçant un paragraphe le temps du chargement). */
export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

/** Silhouette d'une `.card` générique (titre + quelques lignes) — pour une section en attente de données. */
export function SkeletonCard({ className = '' }) {
  return (
    <div className={`card ${className}`} aria-hidden="true">
      <Skeleton className="h-4 w-1/3 mb-4" />
      <SkeletonText lines={3} />
    </div>
  );
}

/** Rangée de `count` StatCard en silhouette (mêmes proportions que StatCard). */
export function SkeletonStatCards({ count = 4, className = '' }) {
  const colsClass = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' }[Math.min(count, 5)] || 'lg:grid-cols-4';
  return (
    <div className={`grid grid-cols-2 ${colsClass} gap-4 ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card flex items-center gap-4">
          <Skeleton className="h-11 w-11 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Silhouette de table, alignée sur `table-base` : mêmes proportions que la vraie table, pour
 * éviter le "saut" de mise en page quand les données arrivent. Utilisée par défaut par
 * <DataTable loading /> — voir DataTable.jsx.
 */
export function SkeletonTable({ columns = 4, rows = 5, className = '' }) {
  return (
    <div className={`overflow-hidden ${className}`} aria-hidden="true">
      <table className="table-base">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i}><Skeleton className="h-3 w-16" /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c}><Skeleton className={`h-3 ${c === 0 ? 'w-28' : 'w-16'}`} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * <EmptyState
 *   icon={SomeIcon}                   // optionnel — composant lucide-react, Inbox par défaut
 *   title="Aucune donnée"
 *   description="…"                   // optionnel, une ligne d'explication
 *   action={<button ...>…</button>}   // optionnel — ex. "Créer le premier élément"
 * />
 *
 * Remplace les "Aucune donnée pour le moment." disséminés en texte brut dans les pages : mêmes
 * espacements que LoadingScreen/ErrorState, pour que loading / error / vide se succèdent sans
 * à-coup visuel dans un même conteneur.
 */
export function EmptyState({ icon: Icon = Inbox, title = 'Aucune donnée pour le moment.', description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 text-center gap-2 ${className}`}>
      <div className="h-11 w-11 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-1">
        <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {description && <p className="text-xs text-slate-400 max-w-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
