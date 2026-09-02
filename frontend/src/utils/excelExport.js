import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
// jspdf-autotable s'installe comme plugin sur le prototype de jsPDF (effet de bord à l'import) :
// on appelle ensuite doc.autoTable(...) plutôt que le défaut nommé du module, qui n'est pas fiable
// selon la façon dont chaque bundler interprète l'interop CommonJS/ESM de ce paquet.
import 'jspdf-autotable';

// Fonctions d'export "lourdes" (xlsx + jspdf + jspdf-autotable ~280 Ko gzip), isolées de
// exportUtils.js et chargées uniquement via import() dynamique au clic sur un bouton
// Exporter/Export PDF — pour ne plus alourdir le chargement de chaque page qui affiche
// simplement un bouton d'export (voir appels `await import('.../excelExport')` dans les
// pages sections/*).

/**
 * Exporte un tableau de lignes vers un fichier Excel (.xlsx).
 * columns: [{ label: 'Élève', value: (row) => `${row.prenom} ${row.nom}` }, ...]
 */
export function exportToExcel({ columns, rows, filename = 'export', sheetName = 'Feuille1' }) {
  const data = (rows || []).map((row) => {
    const obj = {};
    columns.forEach((col) => { obj[col.label] = col.value(row); });
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const colWidths = columns.map((col) => ({ wch: Math.max(col.label.length + 2, 14) }));
  ws['!cols'] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * Exporte un tableau de lignes vers un fichier PDF téléchargeable (en-tête établissement +
 * titre/sous-titre + tableau), avec le même jeu de colonnes que exportToExcel/printTable.
 * columns: [{ label: 'Élève', value: (row) => '...' }, ...]
 */
export function exportToPdf({ title, subtitle, columns, rows, filename = 'export', ecole }) {
  const doc = new jsPDF({ orientation: columns.length > 5 ? 'landscape' : 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(13);
  doc.setTextColor(30, 58, 138);
  doc.text(ecole?.nom_ecole || 'COPEC ISAHA', 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Édité le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, pageWidth - 14, 16, { align: 'right' });

  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, 26);
  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(subtitle, 14, 32);
  }

  doc.autoTable({
    startY: subtitle ? 38 : 32,
    head: [columns.map((c) => c.label)],
    body: (rows || []).map((row) => columns.map((c) => String(c.value(row) ?? '—'))),
    styles: { fontSize: 9, cellPadding: 4, textColor: [15, 23, 42] },
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} / ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
  }

  doc.save(`${filename}.pdf`);
}

/**
 * Variante multi-sections de exportToExcel : un onglet Excel par section (utile pour un
 * tableau de bord de statistiques qui combine plusieurs petits tableaux hétérogènes).
 * sections: [{ title, columns, rows }, ...]
 */
export function exportMultiSectionToExcel({ sections, filename = 'export' }) {
  const wb = XLSX.utils.book_new();
  (sections || []).forEach((section) => {
    if (!section.rows || section.rows.length === 0) return;
    const data = section.rows.map((row) => {
      const obj = {};
      section.columns.forEach((col) => { obj[col.label] = col.value(row); });
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = section.columns.map((col) => ({ wch: Math.max(col.label.length + 2, 14) }));
    // Nom d'onglet Excel : 31 caractères max, sans certains caractères spéciaux interdits.
    const sheetName = section.title.replace(/[\\/*?:[\]]/g, '').slice(0, 31) || 'Feuille';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });
  if (wb.SheetNames.length === 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'Feuille1');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

