import { useRef, useState } from 'react';
import { UploadCloud, Download, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import client, { apiErrorMessage } from '../api/client';
import Modal from './Modal';
import { parseImportFile, downloadImportTemplate } from '../utils/importUtils';

/**
 * Modal d'import générique (Excel/CSV -> POST /endpoint/import), réutilisée par toutes les
 * sections qui proposent déjà un export. Le fichier est entièrement lu et prévisualisé côté
 * navigateur avant tout envoi ; l'import réel se fait ligne par ligne côté serveur (voir
 * backend/src/utils/importHelper.js) de sorte qu'une ligne invalide n'empêche jamais les
 * autres d'être importées, ni ne laisse la base de données dans un état incohérent.
 *
 * columns: [{ key: 'nom', label: 'Nom', required: true, example: 'Rakoto' }, ...]
 *   -> sert à générer le modèle Excel téléchargeable et l'aperçu des colonnes attendues.
 */
export default function ImportModal({ open, onClose, endpoint, title, columns, filenamePrefix = 'import', onImported }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState(null);
  const [parseError, setParseError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const reset = () => {
    setFileName(''); setRows(null); setParseError(''); setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setParseError('');
    try {
      const parsed = await parseImportFile(file);
      if (!parsed.length) {
        setParseError('Le fichier ne contient aucune ligne de données (seulement des en-têtes ?).');
        setRows(null);
        return;
      }
      setRows(parsed);
    } catch (err) {
      setParseError(err.message);
      setRows(null);
    }
  };

  const submit = async () => {
    if (!rows?.length) return;
    setSubmitting(true);
    setResult(null);
    try {
      const { data } = await client.post(endpoint, { rows });
      setResult(data);
      if (data.importes > 0) onImported?.();
    } catch (err) {
      setResult({ total: rows.length, importes: 0, echoues: rows.length, erreurs: [{ ligne: '—', message: apiErrorMessage(err) }] });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={title || 'Importer depuis Excel'} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2.5">
          <p className="text-sm text-slate-600">
            Colonnes attendues : {columns.map((c) => c.label).join(', ')}.
          </p>
          <button
            type="button"
            className="btn-secondary !py-1.5 shrink-0"
            onClick={() => downloadImportTemplate({ columns, filename: `${filenamePrefix}_modele` })}
          >
            <Download size={14} className="inline -mt-0.5 mr-1" /> Télécharger le modèle
          </button>
        </div>

        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-lg py-8 cursor-pointer hover:border-brand-300 hover:bg-brand-50/40 transition-colors">
          <UploadCloud className="text-slate-400" size={28} />
          <span className="text-sm text-slate-600">
            {fileName || 'Cliquez pour choisir un fichier Excel (.xlsx) ou CSV'}
          </span>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
        </label>

        {parseError && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {parseError}
          </div>
        )}

        {rows && !result && (
          <div>
            <p className="text-sm text-slate-600 mb-2">{rows.length} ligne(s) détectée(s) — aperçu des 5 premières :</p>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>{Object.keys(rows[0]).map((k) => <th key={k} className="text-left px-2 py-1.5 font-medium text-slate-500">{k}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {Object.keys(rows[0]).map((k) => <td key={k} className="px-2 py-1.5 text-slate-700">{String(r[k] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-2">
            <div className="flex gap-3">
              <div className="flex items-center gap-1.5 text-emerald-700 text-sm font-medium">
                <CheckCircle2 size={16} /> {result.importes} importée(s)
              </div>
              {result.echoues > 0 && (
                <div className="flex items-center gap-1.5 text-red-700 text-sm font-medium">
                  <XCircle size={16} /> {result.echoues} en erreur
                </div>
              )}
            </div>
            {result.erreurs?.length > 0 && (
              <div className="max-h-48 overflow-y-auto border border-red-200 bg-red-50 rounded-lg divide-y divide-red-100">
                {result.erreurs.map((e, i) => (
                  <div key={i} className="px-3 py-2 text-xs text-red-700">
                    <span className="font-semibold">Ligne {e.ligne} :</span> {e.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={handleClose}>
            {result ? 'Fermer' : 'Annuler'}
          </button>
          {!result && (
            <button type="button" className="btn-primary" disabled={!rows?.length || submitting} onClick={submit}>
              {submitting ? 'Import en cours…' : `Importer ${rows?.length ? `(${rows.length} ligne(s))` : ''}`}
            </button>
          )}
          {result && rows && (
            <button type="button" className="btn-secondary" onClick={reset}>Importer un autre fichier</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
