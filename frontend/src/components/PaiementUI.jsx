import { Banknote, Smartphone, Landmark, FileText, User } from 'lucide-react';

/**
 * Briques d'interface partagées par les écrans d'encaissement (écolage) et de paie
 * (salaires). Objectif : un formulaire de paiement lisible d'un coup d'œil —
 * en-tête « qui », grille récapitulative « combien », choix du mode, gros bouton payer.
 * Aucune logique métier ici : uniquement de la présentation, aux couleurs de l'appli
 * (palette brand / slate / accent déjà définie dans tailwind.config.js).
 */

export const MODES_PAIEMENT = [
  { key: 'especes', label: 'Espèces', icon: Banknote },
  { key: 'mobile_money', label: 'Mobile Money', icon: Smartphone },
  { key: 'virement', label: 'Virement', icon: Landmark },
  { key: 'cheque', label: 'Chèque', icon: FileText },
];

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

/** Bandeau d'identité en haut du formulaire (élève ou employé). */
export function PaiementHeader({ nom, sousTitre, badge, initiales }) {
  const init = initiales || (nom || '?').trim().charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
      <div className="h-11 w-11 shrink-0 rounded-full bg-brand-800 text-white flex items-center justify-center font-semibold">
        {init || <User size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-brand-900 truncate">{nom}</p>
        {sousTitre && <p className="text-xs text-brand-700/80 truncate">{sousTitre}</p>}
      </div>
      {badge}
    </div>
  );
}

/** Sélecteur de mode de paiement sous forme de pastilles cliquables (plus rapide qu'un select). */
export function ModePaiementChoix({ value, onChange, name = 'mode_paiement' }) {
  return (
    <div>
      <span className="label">Mode de paiement</span>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {MODES_PAIEMENT.map((m) => {
          const Icon = m.icon;
          const actif = value === m.key;
          return (
            <label
              key={m.key}
              className={`cursor-pointer rounded-lg border px-2 py-2.5 text-center text-xs font-semibold transition-colors ${
                actif
                  ? 'border-brand-800 bg-brand-800 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:bg-brand-50'
              }`}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={m.key}
                checked={actif}
                onChange={() => onChange(m.key)}
              />
              <Icon size={16} className="mx-auto mb-1" />
              {m.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Tableau récapitulatif « à payer » : une ligne par poste, la dernière mise en avant.
 * lignes = [{ label, montant, tone?: 'default' | 'muted' | 'red' | 'green', total?: bool }]
 */
export function RecapPaiement({ titre = 'Récapitulatif', lignes }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {titre}
      </div>
      <div className="divide-y divide-slate-100">
        {lignes.filter(Boolean).map((l) => (
          <div
            key={l.label}
            className={`flex items-center justify-between gap-3 px-4 ${l.total ? 'py-3 bg-brand-50/60' : 'py-2'}`}
          >
            <span className={`text-sm ${l.total ? 'font-semibold text-brand-900' : 'text-slate-600'}`}>{l.label}</span>
            <span
              className={`tabular-nums ${
                l.total
                  ? 'text-lg font-bold text-brand-900'
                  : l.tone === 'red'
                  ? 'text-sm font-semibold text-red-600'
                  : l.tone === 'green'
                  ? 'text-sm font-semibold text-emerald-600'
                  : l.tone === 'muted'
                  ? 'text-sm text-slate-400'
                  : 'text-sm font-medium text-slate-800'
              }`}
            >
              {typeof l.montant === 'number' ? `${fmt(l.montant)} Ar` : l.montant}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Barre d'action collante en bas du formulaire : montant à encaisser + bouton principal. */
export function BarrePaiement({ resume, children }) {
  return (
    <div className="sticky bottom-0 -mx-5 -mb-5 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white/95 px-5 py-3 backdrop-blur">
      <div className="text-sm text-slate-500">{resume}</div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export { fmt as formatMontant };
