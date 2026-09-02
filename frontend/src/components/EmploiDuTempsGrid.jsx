import { couleurMatiere } from '../utils/matiereColors';

// ---------------------------------------------------------------------------
// Grille hebdomadaire en LECTURE SEULE (Horaire × Jours, blocs colorés par
// matière) — même rendu visuel que la grille "Par classe" du constructeur
// d'emploi du temps (EmploiDuTempsSection.jsx), mais sans les interactions
// d'édition (pas de clic pour modifier, pas de bouton supprimer).
//
// Utilisé partout où un emploi du temps déjà publié doit être affiché avec
// exactement la même forme : page Classe, Fiche élève (tab "Emploi du
// temps"), espace enseignant, etc. — un seul composant = un seul endroit à
// faire évoluer si le design change un jour.
// ---------------------------------------------------------------------------

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function formatHeure(t) {
  return t ? String(t).slice(0, 5) : t;
}

export default function EmploiDuTempsGrid({ edt, emptyMessage = 'Aucun emploi du temps publié.', showClasse = false }) {
  const safeEdt = Array.isArray(edt) ? edt : [];

  if (safeEdt.length === 0) {
    return <p className="text-sm text-slate-400 py-6 text-center">{emptyMessage}</p>;
  }

  // Construit la liste des créneaux horaires réellement utilisés par CES cours
  // (pas de créneaux vides par défaut ici, contrairement au constructeur —
  // cette grille est un affichage de consultation, pas un outil de saisie).
  const slots = [...new Set(safeEdt.map((c) => `${formatHeure(c.heure_debut)}|${formatHeure(c.heure_fin)}`))]
    .map((s) => s.split('|'))
    .sort((a, b) => a[0].localeCompare(b[0]));

  const trouverCours = (jour, debut, fin) => safeEdt.find(
    (c) => c.jour === jour && formatHeure(c.heure_debut) === debut && formatHeure(c.heure_fin) === fin
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide px-3 py-2 bg-slate-50 border-b border-slate-200 rounded-tl-lg">Horaire</th>
            {JOURS.map((j, i) => (
              <th key={j} className={`text-left text-xs font-bold text-slate-500 uppercase tracking-wide px-3 py-2 bg-slate-50 border-b border-slate-200 ${i === JOURS.length - 1 ? 'rounded-tr-lg' : ''}`}>
                {j}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map(([debut, fin]) => (
            <tr key={`${debut}-${fin}`}>
              <td className="px-3 py-2 border-b border-slate-100 align-top text-xs font-semibold text-slate-700 whitespace-nowrap">
                {debut}<br />–<br />{fin}
              </td>
              {JOURS.map((j) => {
                const c = trouverCours(j, debut, fin);
                if (!c) {
                  return (
                    <td key={j} className="px-2 py-2 border-b border-slate-100 text-center text-slate-300 align-top">
                      –
                    </td>
                  );
                }
                const col = couleurMatiere(c.matiere_nom, c.matiere_couleur);
                return (
                  <td key={j} className="px-2 py-2 border-b border-slate-100 align-top">
                    <div className={`rounded-lg ${col.bg} border ${col.border} p-2 text-xs`}>
                      <p className={`font-semibold ${col.title}`}>{c.matiere_nom}</p>
                      {showClasse && c.classe_nom && <p className={col.text}>{c.classe_nom}</p>}
                      <p className={col.text}>{c.enseignant_prenom} {c.enseignant_nom}</p>
                      {c.salle && <p className={col.text}>Salle {c.salle}</p>}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
