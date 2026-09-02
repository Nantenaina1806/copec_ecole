import { Fragment, useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { ErrorState, EmptyState, SkeletonTable } from './Feedback';

/**
 * <DataTable
 *   columns={[{ key, label, render?, sortable?, sortValue?(row) }]}
 *   rows={[]} loading error onRetry emptyLabel
 *   actions={(row) => node} rowKey="id"
 *   pageSize={10}   // optionnel : active la pagination côté client (omis = tout afficher, comme avant)
 *   renderExpanded={(row) => node}   // optionnel : ajoute une colonne chevron, cliquable pour
 *                                    // déplier une ligne de détail sous la rangée (utile pour voir
 *                                    // l'info complète sans dépendre du défilement horizontal sur mobile)
 * />
 *
 * Tri : ajouter `sortable: true` sur une colonne rend son en-tête cliquable (asc → desc → aucun tri).
 * Par défaut, le tri compare row[column.key] ; fournir `sortValue(row)` pour trier sur une valeur
 * dérivée (utile quand la colonne utilise `render`, ex. une Badge ou une date formatée).
 *
 * Pagination : purement côté client, appliquée aux `rows` déjà filtrés/recherchés par l'appelant.
 * La page revient à 1 à chaque fois que la liste `rows` change (nouvelle recherche/filtre/rechargement).
 *
 * emptyLabel : accepte soit une chaîne (titre affiché via <EmptyState>, comportement historique),
 * soit un objet { title, description, icon, action } pour un état vide plus riche.
 * caption : texte optionnel, visible uniquement des lecteurs d'écran, décrivant la table
 * (ex. "Liste des élèves inscrits") — utile quand plusieurs tables coexistent sur une page.
 */
const EMPTY_ARRAY = [];

export default function DataTable({
  columns, rows, loading, error, onRetry, emptyLabel = 'Aucune donnée pour le moment.',
  actions, rowKey = 'id', pageSize, renderExpanded, caption,
}) {
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState(null);

  const safeColumns = Array.isArray(columns) ? columns : EMPTY_ARRAY;
  const safeRows = Array.isArray(rows) ? rows : EMPTY_ARRAY;

  // Revient à la page 1 et referme la ligne dépliée dès que la liste `rows` change (nouvelle
  // recherche/filtre/rechargement). Ajustement fait pendant le rendu (pattern recommandé par
  // React pour dériver un state depuis une prop qui change) plutôt que via un useEffect, pour
  // éviter un aller-retour de rendu supplémentaire.
  const [rowsVues, setRowsVues] = useState(safeRows);
  if (safeRows !== rowsVues) {
    setRowsVues(safeRows);
    setPage(1);
    setExpandedRow(null);
  }

  const sortedRows = useMemo(() => {
    if (!safeRows.length || !sort.key) return safeRows;
    const col = safeColumns.find((c) => c.key === sort.key);
    if (!col) return safeRows;
    const getValue = col.sortValue || ((row) => row[col.key]);
    const copy = [...safeRows];
    copy.sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'fr', { numeric: true, sensitivity: 'base' });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeRows, safeColumns, sort]);

  const totalPages = pageSize ? Math.max(1, Math.ceil((sortedRows?.length || 0) / pageSize)) : 1;
  const clampedPage = Math.min(page, totalPages);
  const pagedRows = pageSize
    ? sortedRows?.slice((clampedPage - 1) * pageSize, clampedPage * pageSize)
    : sortedRows;

  if (loading) return <SkeletonTable columns={safeColumns.length + (actions ? 1 : 0) + (renderExpanded ? 1 : 0)} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (safeRows.length === 0) {
    const empty = typeof emptyLabel === 'string' ? { title: emptyLabel } : emptyLabel;
    return <EmptyState {...empty} />;
  }

  const toggleSort = (col) => {
    if (!col.sortable) return;
    setSort((prev) => {
      if (prev.key !== col.key) return { key: col.key, dir: 'asc' };
      if (prev.dir === 'asc') return { key: col.key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  };

  return (
    <div>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="table-base">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {renderExpanded && <th className="w-8" scope="col" />}
              {safeColumns.map((c) => {
                const isSorted = sort.key === c.key;
                const ariaSort = c.sortable ? (isSorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;
                return (
                  <th key={c.key} scope="col" aria-sort={ariaSort}>
                    {c.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c)}
                        className="inline-flex items-center gap-1 hover:text-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded"
                      >
                        {c.label}
                        {isSorted
                          ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
                          : <ArrowUpDown size={12} className="opacity-40" />}
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
              {actions && <th className="text-right" scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {(pagedRows || []).map((row) => {
              const isExpanded = renderExpanded && expandedRow === row[rowKey];
              return (
                <Fragment key={row[rowKey]}>
                  <tr
                    className={`hover:bg-slate-50/70 ${renderExpanded ? 'cursor-pointer' : ''}`}
                    onClick={renderExpanded ? () => setExpandedRow(isExpanded ? null : row[rowKey]) : undefined}
                  >
                    {renderExpanded && (
                      <td className="text-slate-400">
                        {isExpanded ? <ChevronDown size={15} /> : <ChevronRightIcon size={15} />}
                      </td>
                    )}
                    {safeColumns.map((c) => (
                      <td key={c.key}>{c.render ? c.render(row) : (row[c.key] ?? '—')}</td>
                    ))}
                    {actions && (
                      <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {actions(row)}
                      </td>
                    )}
                  </tr>
                  {isExpanded && (
                    <tr key={`${row[rowKey]}-expanded`} className="bg-slate-50/70">
                      <td colSpan={safeColumns.length + (renderExpanded ? 1 : 0) + (actions ? 1 : 0)} className="!py-3">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageSize && sortedRows.length > pageSize && (
        <div className="flex items-center justify-between pt-4 mt-1 border-t border-slate-100 text-sm text-slate-500">
          <p>
            {(clampedPage - 1) * pageSize + 1}–{Math.min(clampedPage * pageSize, sortedRows.length)} sur {sortedRows.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-ghost !px-2 !py-1"
              disabled={clampedPage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Page précédente"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-2 tabular-nums">{clampedPage} / {totalPages}</span>
            <button
              type="button"
              className="btn-ghost !px-2 !py-1"
              disabled={clampedPage === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Page suivante"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
