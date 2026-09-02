import * as XLSX from 'xlsx';

/**
 * Lit un fichier Excel (.xlsx/.xls) ou CSV choisi par l'utilisateur et le convertit en tableau
 * d'objets { EnTête: valeur, ... }, à partir de la première feuille du classeur.
 * defval: '' garantit que les cellules vides deviennent une chaîne vide plutôt que undefined,
 * pour que les vérifications de champs requis (côté ImportModal) fonctionnent de façon fiable.
 */
export function parseImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire le fichier.'));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
        resolve(rows);
      } catch {
        reject(new Error("Fichier illisible : vérifiez qu'il s'agit bien d'un fichier Excel ou CSV valide."));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Génère et télécharge un fichier Excel vide (en-têtes seulement + une ligne d'exemple) pour
 * que l'utilisateur sache exactement quelles colonnes remplir avant de réimporter son fichier.
 * columns: [{ key: 'nom', label: 'Nom', example: 'Rakoto' }, ...]
 */
export function downloadImportTemplate({ columns, filename = 'modele_import' }) {
  const exampleRow = {};
  columns.forEach((c) => { exampleRow[c.label] = c.example ?? ''; });
  const ws = XLSX.utils.json_to_sheet([exampleRow]);
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(c.label.length + 2, 16) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Import');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
