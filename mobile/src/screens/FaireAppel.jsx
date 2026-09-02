// Ohatra écran "Faire un appel" ho an'ny mobile — mitovy fomba fiasa amin'ny
// FaireAppel ao amin'ny frontend/src/pages/EspaceEnseignant.jsx (PC), fa mamaky/
// manoratra SQLite lokaly fa tsy axios mivantana. Tsotra fa tanteraka: azo alaina
// hatrany ny fampiharana visuel (CSS/classNames) avy amin'ny bika PC.

import { useEffect, useState } from 'react';
import { useDb } from '../db/useDb';
import { enregistrerAppelClasse } from '../sync/writeHelpers';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function FaireAppel({ enseignantId }) {
  const { db, syncState, syncNow } = useDb();
  const [classes, setClasses] = useState([]);
  const [classeId, setClasseId] = useState('');
  const [coursActuel, setCoursActuel] = useState(null);
  const [eleves, setEleves] = useState([]);
  const [presences, setPresences] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // Ny classes azon'ity mpampianatra ity dia efa voatahiry teo an-toerana
  // (pull nataony teo aloha, avy amin'ny enseignant_matiere_classe + classe).
  useEffect(() => {
    if (!db) return;
    db.query(
      `SELECT DISTINCT c.id, c.nom FROM classe c
       JOIN enseignant_matiere_classe emc ON emc.classe_id = c.id
       WHERE emc.enseignant_id = ?`,
      [enseignantId],
    ).then((r) => setClasses(r.values || []));
  }, [db, enseignantId]);

  // "Cours actuel" tsotra: emploi_du_temps an'ity mpampianatra ity, ho an'ity
  // classe voafantina ity, androany. (Ny fitsinjarana araka ny ora marina dia azo
  // ampiana taty aoriana raha ilaina — eto dia efa ampy ho an'ny fanaovana appel
  // indray mandeha isan'andro isaky ny classe.)
  useEffect(() => {
    if (!db || !classeId) { setCoursActuel(null); setEleves([]); return; }
    db.query(
      `SELECT * FROM emploi_du_temps WHERE enseignant_id = ? AND classe_id = ? AND actif = 1 LIMIT 1`,
      [enseignantId, classeId],
    ).then((r) => setCoursActuel(r.values?.[0] || null));
    db.query(
      `SELECT e.id, e.nom, e.prenom FROM eleve e
       JOIN inscription i ON i.eleve_id = e.id
       WHERE i.classe_id = ? AND i.statut = 'inscrit' AND e.actif = 1
       ORDER BY e.nom`,
      [classeId],
    ).then((r) => setEleves(r.values || []));
    setPresences({});
  }, [db, classeId, enseignantId]);

  const setStatut = (eleveId, statut) => setPresences((p) => ({ ...p, [eleveId]: statut }));

  const submit = async () => {
    if (!db || !coursActuel) return;
    setBusy(true);
    setMessage('');
    try {
      const payload = eleves.map((e) => ({ eleve_id: e.id, statut: presences[e.id] || 'present' }));
      await enregistrerAppelClasse(db, {
        emploi_du_temps_id: coursActuel.id,
        classe_id: classeId,
        annee_scolaire_id: coursActuel.annee_scolaire_id,
        enseignant_id: enseignantId,
        date_pointage: today(),
        presences: payload,
      });
      setMessage('Appel voatahiry eto an-toerana. Halefa ho azy rehefa misy connection.');
      setPresences({});
      syncNow(); // andramana alefa avy hatrany raha misy connection sahady
    } catch (err) {
      setMessage(`Hadisoana: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>Faire un appel</h3>
      <p className="text-sm text-slate-500">
        {syncState.status === 'offline' ? 'Tsy misy connection — voatahiry eto an-toerana ihany aloha.' : 'Connection OK.'}
      </p>

      <div className="flex flex-wrap gap-2 my-3">
        {classes.map((c) => (
          <button key={c.id} onClick={() => setClasseId(String(c.id))}
            className={String(classeId) === String(c.id) ? 'bg-brand-800 text-white' : 'bg-slate-50 border'}>
            {c.nom}
          </button>
        ))}
      </div>

      {!coursActuel && classeId && <p className="text-sm text-slate-400">Tsy misy fandaharam-potoana voatahiry ho an'ity classe ity.</p>}

      {coursActuel && (
        <>
          <ul>
            {eleves.map((e) => (
              <li key={e.id} className="flex justify-between items-center py-1">
                <span>{e.nom} {e.prenom}</span>
                <button onClick={() => setStatut(e.id, presences[e.id] === 'absent' ? 'present' : 'absent')}
                  className={presences[e.id] === 'absent' ? 'bg-red-100 text-red-700' : 'bg-slate-50'}>
                  {presences[e.id] === 'absent' ? 'Tsy tonga' : 'Tonga'}
                </button>
              </li>
            ))}
          </ul>
          <button disabled={busy} onClick={submit} className="mt-3 bg-brand-800 text-white rounded px-4 py-2">
            {busy ? 'Mandefa...' : 'Tahirizo ny appel'}
          </button>
        </>
      )}
      {message && <p className="text-sm mt-2">{message}</p>}
    </div>
  );
}
