/**
 * Générateur automatique d'emploi du temps.
 * Implémente les règles du document "Règle gestion, logique, algorithme" :
 *  - RG-060/061 : matière doit appartenir à classe_matiere, heures_semaine ∈ [2,8]
 *  - Décomposition des heures (X.) : 2=2 | 3=2+1 | 4=2+2 | 5=2+2+1 | 6=2+2+2 | 7=2+2+2+1 | 8=2+2+2+2
 *  - RG matière pas 2x le même jour (XI.)
 *  - RG bloc horaire continu pour 2h (XII.)
 *  - Conflit enseignant / classe / salle (XVIII-XX), formule overlap (XXI.)
 *  - Ordre de priorité : volume horaire décroissant, puis nb enseignants croissant (XXIV.)
 *  - Score des slots (XXV.) + règle matin/après-midi (XXVI.)
 *  - Backtracking (XXIII., XLVII.)
 */

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// Garde-fou anti-explosion combinatoire (règle XXIII/XLVII : backtracking).
// Sur une grille très contrainte (peu de créneaux, beaucoup de matières/enseignants), le nombre
// d'essais de backtracking peut croître de façon exponentielle. Sans limite, un cas pathologique
// bloquerait la requête HTTP (et le processus Node, mono-thread) pendant un temps arbitrairement
// long. On borne donc le nombre total de tentatives de placement ; au-delà, on abandonne proprement
// et on renvoie le meilleur résultat partiel avec success=false plutôt que de rester bloqué.
const MAX_TENTATIVES_BACKTRACK = 20000;

// Créneaux disponibles par défaut (grille horaire de l'école). Personnalisable via options.
const CRENEAUX_DEFAUT = [
  { debut: '07:30', fin: '09:30' }, // bloc 2h
  { debut: '09:30', fin: '10:00' }, // pause (non utilisé pour placement)
  { debut: '10:00', fin: '12:00' }, // bloc 2h
  { debut: '14:00', fin: '16:00' }, // bloc 2h (après-midi)
  { debut: '16:00', fin: '17:00' }, // bloc 1h
];

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function fromMinutes(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}
function estMatin(heureDebut) {
  return toMinutes(heureDebut) < toMinutes('12:00');
}
function overlap(aDebut, aFin, bDebut, bFin) {
  return toMinutes(aDebut) < toMinutes(bFin) && toMinutes(aFin) > toMinutes(bDebut);
}

/**
 * Décompose un volume horaire hebdomadaire en blocs, selon la règle "sacrée" (X.) :
 * 2=2 | 3=2+1 | 4=2+2 | 5=2+2+1 | 6=2+2+2 | 7=2+2+2+1 | 8=2+2+2+2
 */
function decomposerHeures(heuresSemaine) {
  const table = {
    2: [2],
    3: [2, 1],
    4: [2, 2],
    5: [2, 2, 1],
    6: [2, 2, 2],
    7: [2, 2, 2, 1],
    8: [2, 2, 2, 2],
  };
  if (!table[heuresSemaine]) {
    throw new Error(`Volume horaire non supporté : ${heuresSemaine}h (doit être entre 2 et 8).`);
  }
  return table[heuresSemaine];
}

/**
 * Génère la liste des slots candidats (jour + heure_debut + heure_fin) pour une durée donnée (1 ou 2h),
 * à partir de la grille de créneaux fournie.
 */
function genererSlotsCandidats(dureeHeures, joursDisponibles, creneaux) {
  const slots = [];
  const dureeMinutes = dureeHeures * 60;
  for (const jour of joursDisponibles) {
    for (const c of creneaux) {
      const blocMinutes = toMinutes(c.fin) - toMinutes(c.debut);
      if (blocMinutes < dureeMinutes) continue; // le bloc ne contient pas la pause
      if (blocMinutes === dureeMinutes) {
        slots.push({ jour, heure_debut: c.debut, heure_fin: c.fin });
      } else {
        // Bloc plus grand que la durée demandée : on découpe en sous-slots alignés
        let cur = toMinutes(c.debut);
        const end = toMinutes(c.fin);
        while (cur + dureeMinutes <= end) {
          slots.push({ jour, heure_debut: fromMinutes(cur), heure_fin: fromMinutes(cur + dureeMinutes) });
          cur += dureeMinutes;
        }
      }
    }
  }
  return slots;
}

/**
 * @param {Object} params
 * @param {Array} params.matieres - [{ matiere_id, nom, heures_semaine, enseignants: [{enseignant_id, nom}] }]
 * @param {string} params.classeId
 * @param {string} params.salle - salle par défaut de la classe
 * @param {Array} params.absencesEnseignant - [{enseignant_id, jour}] jours où l'enseignant est indisponible
 * @param {Array} params.existingPlacements - créneaux déjà publiés des AUTRES classes à respecter
 * @param {number|null} params.salleId - identifiant physique de la salle de la classe
 * @param {Array} params.creneaux - grille horaire (optionnel)
 * @param {Array} params.joursDisponibles - jours utilisables (optionnel, défaut Lundi-Vendredi)
 * @param {number} [params.maxTentatives] - garde-fou anti-explosion combinatoire (défaut
 *   MAX_TENTATIVES_BACKTRACK) ; surtout utile pour les tests (valeur basse -> déterministe/rapide).
 * @returns {{ placements: Array, incomplet: Array, success: boolean, limiteAtteinte: boolean, tentatives: number }}
 */
function genererEmploiDuTemps({
  matieres,
  classeId,
  salle,
  absencesEnseignant = [],
  existingPlacements = [],
  salleId = null,
  creneaux = CRENEAUX_DEFAUT.filter((c) => c.debut !== '09:30'), // retire la pause
  joursDisponibles = JOURS.slice(0, 5),
  maxTentatives = MAX_TENTATIVES_BACKTRACK,
}) {
  // 1. Construire la liste des "leçons" (blocs à placer) à partir de la décomposition des heures.
  //    Priorité 1: volume horaire décroissant. Priorité 2: nombre d'enseignants disponibles croissant.
  const matieresTriees = [...matieres].sort((a, b) => {
    if (b.heures_semaine !== a.heures_semaine) return b.heures_semaine - a.heures_semaine;
    return (a.enseignants?.length || 0) - (b.enseignants?.length || 0);
  });

  const lecons = [];
  for (const mat of matieresTriees) {
    if (!mat.enseignants || mat.enseignants.length === 0) {
      // Pas d'enseignant affecté : impossible de planifier, on le signale mais on continue les autres.
      continue;
    }
    const blocs = decomposerHeures(mat.heures_semaine);
    blocs.forEach((duree, idx) => {
      lecons.push({
        matiere_id: mat.matiere_id,
        matiere_nom: mat.nom,
        matiere_couleur: mat.couleur || null,
        duree,
        blocIndex: idx,
        enseignants: mat.enseignants,
      });
    });
  }

  const placements = []; // résultat final {matiere_id, enseignant_id, jour, heure_debut, heure_fin}
  // Les créneaux déjà publiés des autres classes sont des contraintes dures :
  // l'ancien moteur ne les regardait pas, ce qui pouvait affecter un enseignant ou une salle
  // déjà occupé ailleurs dans l'école. On garde ces données séparées des placements du brouillon.
  const occupationsExternes = Array.isArray(existingPlacements) ? existingPlacements.filter((p) => String(p.classe_id) !== String(classeId)) : [];
  const joursMatiereUtilises = {}; // matiere_id -> Set(jour) : RG matière pas 2x le même jour
  const echec = [];
  let tentatives = 0;
  let limiteAtteinte = false;

  // Optimisation algorithme : genererSlotsCandidats(duree, joursDisponibles, creneaux) ne dépend
  // que de la durée du bloc (1h ou 2h, cf. decomposerHeures) — ni de la leçon, ni de l'état courant
  // du placement. Avant cette optimisation, candidatsPourLecon() la rappelait à CHAQUE nœud du
  // backtracking (jusqu'à MAX_TENTATIVES_BACKTRACK fois), regénérant inutilement la même liste
  // brute de créneaux (parsing d'heures via toMinutes/fromMinutes compris) à chaque essai. On la
  // précalcule une seule fois par durée utilisée, avant le backtracking : candidatsPourLecon() ne
  // fait plus ensuite que le filtrage (disponibilité classe/salle/enseignant/jour), qui lui dépend
  // bien de l'état courant et doit rester recalculé à chaque nœud.
  const dureesUtilisees = new Set(lecons.map((l) => l.duree));
  const slotsParDuree = {};
  for (const duree of dureesUtilisees) {
    slotsParDuree[duree] = genererSlotsCandidats(duree, joursDisponibles, creneaux);
  }

  function enseignantLibre(enseignantId, jour, debut, fin) {
    if (absencesEnseignant.some((a) => a.enseignant_id === enseignantId && a.jour === jour)) return false;
    const occ = [...occupationsExternes, ...placements];
    return !occ.some(
      (p) => p.enseignant_id === enseignantId && p.jour === jour && overlap(p.heure_debut, p.heure_fin, debut, fin)
    );
  }
  function classeLibre(jour, debut, fin) {
    return !placements.some((p) => p.jour === jour && overlap(p.heure_debut, p.heure_fin, debut, fin));
  }
  function salleLibre(sallePlacement, jour, debut, fin) {
    const occ = [...occupationsExternes, ...placements];
    return !occ.some(
      (p) => {
        const sameRoom = salleId != null && p.salle_id != null
          ? Number(p.salle_id) === Number(salleId)
          : String(p.salle || '').trim().toLowerCase() === String(sallePlacement || '').trim().toLowerCase();
        return sameRoom && p.jour === jour && overlap(p.heure_debut, p.heure_fin, debut, fin);
      }
    );
  }
  function matiereDejaCeJour(matiereId, jour) {
    return joursMatiereUtilises[matiereId]?.has(jour) || false;
  }

  // Score souple : les contraintes dures sont filtrées avant ce point.
  // Objectif : répartir les matières, limiter les trous et éviter de surcharger un enseignant.
  function scoreSlot(candidate, lecon) {
    let score = 100;
    const classeOcc = placements.filter((p) => p.jour === candidate.jour);
    const enseignantOcc = [...occupationsExternes, ...placements].filter(
      (p) => p.enseignant_id === candidate.enseignant_id && p.jour === candidate.jour
    );
    const debut = toMinutes(candidate.heure_debut);
    const fin = toMinutes(candidate.heure_fin);

    // Préférence légère pour le matin et pour les blocs de 2h.
    score += estMatin(candidate.heure_debut) ? 5 : 0;
    score += candidate.duree === 2 ? 8 : 0;

    // Évite de créer un "trou" dans la journée de la classe.
    const voisinAvant = classeOcc.some((p) => toMinutes(p.heure_fin) === debut);
    const voisinApres = classeOcc.some((p) => toMinutes(p.heure_debut) === fin);
    if (voisinAvant || voisinApres) score += 6;

    // Évite qu'un enseignant ait trop de blocs concentrés le même jour.
    score -= enseignantOcc.length * 3;

    // Préfère une matière sur un jour encore peu chargé pour cette matière.
    const joursMatiere = new Set(placements.filter((p) => p.matiere_id === lecon.matiere_id).map((p) => p.jour));
    if (!joursMatiere.has(candidate.jour)) score += 12;

    return score;
  }

  function candidatsPourLecon(lecon) {
    const slots = slotsParDuree[lecon.duree];
    const candidats = [];
    for (const slot of slots) {
      if (matiereDejaCeJour(lecon.matiere_id, slot.jour)) continue; // règle XI
      if (!classeLibre(slot.jour, slot.heure_debut, slot.heure_fin)) continue;
      if (!salleLibre(salle, slot.jour, slot.heure_debut, slot.heure_fin)) continue;
      for (const ens of lecon.enseignants) {
        if (!enseignantLibre(ens.enseignant_id, slot.jour, slot.heure_debut, slot.heure_fin)) continue;
        candidats.push({ ...slot, duree: lecon.duree, enseignant_id: ens.enseignant_id, enseignant_nom: ens.nom });
      }
    }
    // Trie par score décroissant (meilleur slot en premier) -> backtracking essaie le meilleur d'abord
    candidats.sort((a, b) => scoreSlot(b, lecon) - scoreSlot(a, lecon));
    return candidats;
  }

  // Backtracking récursif (règle XXIII / XLVII), borné par MAX_TENTATIVES_BACKTRACK.
  function backtrack(index) {
    if (limiteAtteinte) return false;
    if (index >= lecons.length) return true;
    const lecon = lecons[index];
    const candidats = candidatsPourLecon(lecon);

    for (const c of candidats) {
      tentatives += 1;
      if (tentatives > maxTentatives) {
        limiteAtteinte = true;
        return false;
      }
      // Placer
      const placement = {
        matiere_id: lecon.matiere_id,
        matiere_nom: lecon.matiere_nom,
        matiere_couleur: lecon.matiere_couleur,
        enseignant_id: c.enseignant_id,
        enseignant_nom: c.enseignant_nom,
        jour: c.jour,
        heure_debut: c.heure_debut,
        heure_fin: c.heure_fin,
        salle,
        classe_id: classeId,
      };
      placements.push(placement);
      joursMatiereUtilises[lecon.matiere_id] = joursMatiereUtilises[lecon.matiere_id] || new Set();
      joursMatiereUtilises[lecon.matiere_id].add(c.jour);

      if (backtrack(index + 1)) return true;

      // Échec plus loin -> annuler ce placement et essayer le candidat suivant
      placements.pop();
      joursMatiereUtilises[lecon.matiere_id].delete(c.jour);
    }
    return false; // aucun candidat n'a fonctionné pour cette leçon
  }

  const success = backtrack(0);

  // Vérification finale : heures_planifiees == heures_demandees, par matière (règle XLVIII)
  const bilan = matieresTriees.map((mat) => {
    const placees = placements.filter((p) => p.matiere_id === mat.matiere_id).reduce((sum, p) => {
      const d = (toMinutes(p.heure_fin) - toMinutes(p.heure_debut)) / 60;
      return sum + d;
    }, 0);
    if (placees < mat.heures_semaine) {
      echec.push({ matiere_id: mat.matiere_id, matiere_nom: mat.nom, demandees: mat.heures_semaine, placees });
    }
    return { matiere_id: mat.matiere_id, matiere_nom: mat.nom, demandees: mat.heures_semaine, placees };
  });

  return {
    success: success && echec.length === 0 && !limiteAtteinte,
    placements,
    bilan,
    incomplet: echec,
    limiteAtteinte, // true si l'algorithme a été interrompu par le garde-fou anti-explosion combinatoire
    tentatives,
  };
}

module.exports = {
  genererEmploiDuTemps,
  decomposerHeures,
  JOURS,
  CRENEAUX_DEFAUT,
  overlap,
  MAX_TENTATIVES_BACKTRACK,
};
