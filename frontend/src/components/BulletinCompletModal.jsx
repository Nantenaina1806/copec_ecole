import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Printer, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import client, { apiErrorMessage } from '../api/client';

export default function BulletinCompletModal({ eleveId, open, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [rotate90, setRotate90] = useState(false);

  const chargerDonnees = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.get(`/bulletins/eleve/${eleveId}/complet`);
      setData(res.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && eleveId) {
      // Chargement volontairement synchrone au montage/changement d'élève (affiche le
      // spinner immédiatement) — pattern standard de fetch-on-prop-change ; le linter
      // React Compiler le signale par prudence mais c'est le comportement voulu ici.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      chargerDonnees();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eleveId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 print:p-0 print:static print:bg-white">
      <div className="bg-white rounded-xl shadow-2xl max-w-[1350px] w-full max-h-[96vh] flex flex-col overflow-hidden print:max-h-none print:shadow-none print:w-full print:rounded-none">
        
        {/* Header Modal Controls (Hidden during print) */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 print:hidden">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-slate-900 text-base sm:text-lg">Imprimé Officiel — Bulletin {data?.school?.nom_ecole || 'COPEC ISAHA'}</h3>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2.5 py-0.5 rounded-full">Recto - Verso</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`btn-secondary text-xs flex items-center gap-1.5 ${rotate90 ? '!bg-amber-100 !border-amber-300 text-amber-900 font-bold' : ''}`}
              onClick={() => setRotate90(!rotate90)}
              title="Bascule l'orientation de 90° si votre imprimante alimente le papier en Portrait"
            >
              🔄 {rotate90 ? 'Rotation 90° Activée' : 'Rotation 90°'}
            </button>
            <button
              className="btn-primary flex items-center gap-1.5 font-bold"
              onClick={() => window.print()}
              disabled={!!data && !data.verification}
              title={!data?.verification ? 'Impossible de sécuriser ce bulletin : aucune inscription scolaire n’est associée à cet élève.' : 'Imprimer le bulletin recto-verso'}
            >
              <Printer size={16} /> Imprimer le Bulletin (Recto-Verso)
            </button>
            <button className="btn-ghost !p-2" onClick={onClose} title="Fermer">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-3 sm:p-6 overflow-y-auto flex-1 bg-slate-200 print:bg-white print:p-0 print:overflow-visible">
          {loading && (
            <div className="py-24 text-center text-slate-600 flex flex-col items-center gap-3">
              <RefreshCw className="animate-spin text-emerald-800" size={36} />
              <p className="font-medium text-sm">Chargement du bulletin en cours...</p>
            </div>
          )}

          {error && (
            <div className="py-12 text-center text-red-600">
              <p className="font-semibold">{error}</p>
              <button className="btn-secondary mt-3" onClick={chargerDonnees}>Réessayer</button>
            </div>
          )}

          {data && !loading && !data.verification && (
            <div className="mx-auto max-w-3xl mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3 items-start print:hidden">
              <AlertTriangle className="text-amber-700 shrink-0 mt-0.5" size={19} />
              <div className="text-sm text-amber-900">
                <p className="font-bold">Vérification QR indisponible</p>
                <p className="mt-0.5">Cet élève n&apos;a pas d&apos;inscription scolaire exploitable. Le bulletin ne peut pas être imprimé comme document officiel vérifiable.</p>
              </div>
            </div>
          )}

          {data && !loading && (
            <BulletinExactCOPECRender data={data} rotate90={rotate90} />
          )}
        </div>
      </div>
    </div>
  );
}

// Palette de thèmes couleur — un thème par NIVEAU (6ème, 5ème, ... Terminale, etc.)
// pour éviter que tous les bulletins affichent exactement la même teinte verte.
// Si deux classes appartiennent au même niveau (ex: 3ème A / 3ème B), elles
// partagent le même thème ; deux niveaux différents ont (presque) toujours
// des thèmes différents grâce au hash ci-dessous.
const BULLETIN_THEMES = [
  { nom: 'Émeraude',   primary: '#0b3318', bg: '#e2f0e7', bg2: '#d5ebd9', soft40: '#a9c2b0', soft30: '#bcd2c2', soft20: '#cfe0d4' },
  { nom: 'Bleu Ardoise', primary: '#0b2e4f', bg: '#e2ecf5', bg2: '#d3e2f0', soft40: '#a8bccf', soft30: '#bccde0', soft20: '#d0dcea' },
  { nom: 'Terracotta', primary: '#5a2a0e', bg: '#f5e6da', bg2: '#eed7c4', soft40: '#d1ac91', soft30: '#dcbda5', soft20: '#e7ceb9' },
  { nom: 'Prune',      primary: '#3d0b3a', bg: '#f0e2ee', bg2: '#e6d0e2', soft40: '#c19dbc', soft30: '#cfb2cb', soft20: '#dcc7da' },
  { nom: 'Bordeaux',   primary: '#4a0e14', bg: '#f3e0e2', bg2: '#ecd0d3', soft40: '#cd9fa4', soft30: '#d9b3b6', soft20: '#e5c7c9' },
  { nom: 'Indigo',     primary: '#1a1250', bg: '#e4e1f5', bg2: '#d5d0ec', soft40: '#a9a2cf', soft30: '#bcb6da', soft20: '#d0cbe6' },
  { nom: 'Teal',       primary: '#06342f', bg: '#dcf0ec', bg2: '#c9e6e0', soft40: '#9dc4bd', soft30: '#b4d4ce', soft20: '#cbe3df' },
  { nom: 'Ocre',       primary: '#4f3607', bg: '#f5edd9', bg2: '#ecdfb8', soft40: '#d0bd85', soft30: '#dccca0', soft20: '#e8dbbc' },
  { nom: 'Anthracite', primary: '#1c1f26', bg: '#e6e7ea', bg2: '#d7d9de', soft40: '#a9adb6', soft30: '#bdc0c8', soft20: '#d2d4da' },
  { nom: 'Corail',     primary: '#5c1c14', bg: '#f5e2dd', bg2: '#eccbc3', soft40: '#d0a29a', soft30: '#dcb7b0', soft20: '#e7ccc6' },
];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function getBulletinTheme(inscription, classeNom) {
  // Priorité : niveau (6ème, 5ème, 3ème…) — sinon la classe elle-même
  const key = (inscription?.niveau_nom || classeNom || 'default').trim().toLowerCase();
  const idx = hashString(key) % BULLETIN_THEMES.length;
  return BULLETIN_THEMES[idx];
}

function BulletinExactCOPECRender({ data, rotate90 }) {
  const { eleve, inscription, school, matieres, bimestres, notesMap, bulletinsMap, syntheseAnnuelle } = data;

  const theme = getBulletinTheme(inscription, inscription?.classe_nom);
  const themeVars = {
    '--b-primary': theme.primary,
    '--b-bg': theme.bg,
    '--b-bg2': theme.bg2,
    '--b-soft40': theme.soft40,
    '--b-soft30': theme.soft30,
    '--b-soft20': theme.soft20,
  };

  const nomEleve = eleve.nom?.toUpperCase() || '';
  const prenomEleve = eleve.prenom || '';
  const nomComplet = `${nomEleve} ${prenomEleve}`.trim();
  const classeNom = inscription?.classe_nom || '3è';
  const numeroClasse = inscription?.numero_classe ? `${inscription.numero_classe}` : (eleve.matricule || '508-A');
  const anneeLibelle = inscription?.annee_libelle || '2025 - 2026';
  const verificationUrl = data.verification?.url || '';
  const verificationReference = data.verification?.reference || '';
  const qrValue = verificationUrl;

  const bimestresList = (bimestres && bimestres.length === 5) ? bimestres : [
    { id: 1, numero: 1, libelle: '1ère BIMESTRE', dates: 'Septembre-Octobre' },
    { id: 2, numero: 2, libelle: '2ème BIMESTRE', dates: 'Novembre - Décembre' },
    { id: 3, numero: 3, libelle: '3ème BIMESTRE', dates: 'Janvier-Février' },
    { id: 4, numero: 4, libelle: '4ème BIMESTRE', dates: 'Mars-Avril' },
    { id: 5, numero: 5, libelle: '5ème BIMESTRE', dates: 'Mai-Juin' },
  ];

  // Matières de la classe (ou fallback modèle officiel)
  const listMatieres = (matieres && matieres.length > 0) ? matieres : [
    { id: 1, nom: 'Malagasy', classe_coef: 3 },
    { id: 2, nom: 'Français', classe_coef: 2 },
    { id: 3, nom: 'Histo-Géo', classe_coef: 3 },
    { id: 4, nom: 'Mathématique', classe_coef: 3 },
    { id: 5, nom: 'Physiques-Chimie', classe_coef: 3 },
    { id: 6, nom: 'Anglais', classe_coef: 2 },
    { id: 7, nom: 'SVT', classe_coef: 3 },
    { id: 8, nom: 'EPS', classe_coef: 1 },
    { id: 9, nom: 'INFO ou Philo', classe_coef: null },
    { id: 10, nom: 'EVA', classe_coef: null },
  ];

  // Calculs par bimestre
  const totauxParBimestre = {};
  bimestresList.forEach((b) => {
    let totalCoef = 0;
    let totalPoints = 0;
    let nbNotes = 0;

    listMatieres.forEach((m) => {
      const coef = Number(m.classe_coef || m.coefficient || 0);
      if (coef > 0) totalCoef += coef;
      
      const noteStr = notesMap[b.id]?.[m.id];
      if (noteStr !== undefined && noteStr !== null && noteStr !== '') {
        const noteVal = Number(noteStr);
        if (!isNaN(noteVal)) {
          totalPoints += noteVal * (coef > 0 ? coef : 1);
          nbNotes += 1;
        }
      }
    });

    const bulOfficiel = bulletinsMap[b.id];
    const moyenneG = bulOfficiel?.moyenne_generale 
      ? Number(bulOfficiel.moyenne_generale).toFixed(2)
      : (nbNotes > 0 && totalCoef > 0 ? (totalPoints / totalCoef).toFixed(2) : null);

    totauxParBimestre[b.id] = {
      totalCoef: totalCoef > 0 ? totalCoef : 20,
      totalPoints: nbNotes > 0 ? totalPoints.toFixed(1).replace('.', ',') : null,
      moyenneGenerale: moyenneG ? moyenneG.replace('.', ',') : null,
      rang: bulOfficiel?.rang || null,
      effectif: bulOfficiel?.effectif_classe || null,
      appreciation: bulOfficiel?.appreciation_generale || null,
    };
  });

  return (
    <div
      style={themeVars}
      className={`print-bulletin-container ${rotate90 ? 'rotate-90-print' : ''} space-y-10 font-serif text-[var(--b-primary)] print:space-y-0 print:text-black`}
    >
      
      {/* ==================================================================================== */}
      {/* PAGE 1 : RECTO (TABLEAU DES NOTES EXACT COPEC - MEDIA_1787232793317.JPG)            */}
      {/* ==================================================================================== */}
      <div className="page-recto bg-[var(--b-bg)] border-2 border-[var(--b-primary)] p-4 sm:p-6 rounded-lg shadow-md print:shadow-none print:border-2 print:border-[var(--b-primary)] print:bg-[var(--b-bg)]">
        
        {/* En-tête exact COPEC */}
        <div className="flex flex-wrap justify-between items-start mb-1.5 pb-1 border-b border-[var(--b-soft30)] text-xs sm:text-sm">
          <div className="space-y-0.5">
            <p className="font-extrabold text-[var(--b-primary)]">
              ,NOM et PRENOM : <span className="font-bold text-black uppercase tracking-wide">{nomComplet}</span>
            </p>
            <p className="font-extrabold text-[var(--b-primary)]">
              Classe : <span className="font-bold text-black">{classeNom}</span> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Numéro : <span className="font-mono font-bold text-black">{numeroClasse}</span>
            </p>
          </div>

          <div className="text-right">
            <h1 className="text-base sm:text-xl font-black text-[var(--b-primary)] tracking-wider uppercase">
              BULLETIN DE NOTES
            </h1>
            <p className="font-extrabold text-xs text-black">
              Année – Scolaire : <span className="font-mono">{anneeLibelle}......</span>
            </p>
          </div>
        </div>

        {/* Structure principale : Grille 11 Colonnes + Bloc havanana (RESULTAT DU FIN D'ANNEE) */}
        <div className="flex flex-col lg:flex-row print:flex-row gap-0 border-2 border-[var(--b-primary)] bg-[var(--b-bg)]">
          
          {/* TABLEAU PRINCIPAL (11 Colonnes) */}
          <div className="flex-1 overflow-x-auto border-r-0 lg:border-r-2 print:border-r-2 border-[var(--b-primary)]">
            <table className="w-full border-collapse text-[11px] sm:text-xs">
              <thead>
                {/* Ligne 1 : DISCIPLINES + Bimestres (1 à 5) */}
                <tr className="border-b-2 border-[var(--b-primary)] text-center font-black">
                  <th className="border-r-2 border-[var(--b-primary)] p-1.5 text-left w-36 uppercase text-[var(--b-primary)]" rowSpan={2}>
                    DISCIPLINES
                  </th>

                  {bimestresList.map((b) => (
                    <th key={b.id} className="border-r-2 border-[var(--b-primary)] p-1 uppercase text-[var(--b-primary)]" colSpan={2}>
                      <div>{b.numero}{b.numero === 1 ? 'ère' : 'ème'} BIMESTRE</div>
                      <div className="text-[9px] font-normal italic lowercase">{b.dates}</div>
                    </th>
                  ))}
                </tr>

                {/* Ligne 2 : Sub-colonnes Coefficient & Note * Coeff pour chaque Bimestre */}
                <tr className="border-b-2 border-[var(--b-primary)] text-center font-bold text-[10px]">
                  {bimestresList.map((b) => (
                    <React.Fragment key={`subhead-${b.id}`}>
                      <th className="border-r border-[var(--b-primary)] p-0.5 w-10 text-[var(--b-primary)]">Coefficient</th>
                      <th className="border-r-2 border-[var(--b-primary)] p-0.5 w-14 text-[var(--b-primary)]">Note * Coeff</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>

              <tbody>
                {/* Lignes des Matières */}
                {listMatieres.map((m) => (
                  <tr key={m.id} className="border-b border-[var(--b-primary)]">
                    <td className="border-r-2 border-[var(--b-primary)] px-2 py-1.5 sm:py-2 font-bold text-[var(--b-primary)]">
                      {m.nom}
                    </td>

                    {bimestresList.map((b) => {
                      const coefVal = m.classe_coef || m.coefficient;
                      const coefDisplay = coefVal ? String(coefVal).padStart(2, '0') : '-';
                      
                      const noteStr = notesMap[b.id]?.[m.id];
                      const hasNote = noteStr !== undefined && noteStr !== null && noteStr !== '';
                      const noteVal = hasNote ? Number(noteStr) : null;
                      
                      const pointsDisplay = (hasNote && noteVal !== null)
                        ? (coefVal ? (noteVal * Number(coefVal)).toFixed(0) : noteVal.toFixed(1))
                        : '';

                      return (
                        <React.Fragment key={`cell-${b.id}-${m.id}`}>
                          <td className="border-r border-[var(--b-primary)] text-center font-mono font-bold text-red-700 py-1.5 sm:py-2">
                            {coefDisplay}
                          </td>
                          <td className="border-r-2 border-[var(--b-primary)] text-center font-mono font-bold py-1.5 sm:py-2 text-slate-900 min-w-[36px]">
                            {/* RAHA TSISY NOTE -> BANGA / EMPTY STRING */}
                            {hasNote ? pointsDisplay : ''}
                          </td>
                        </React.Fragment>
                      );
                    })}
                  </tr>
                ))}

                {/* Ligne TOTAL */}
                <tr className="border-b-2 border-[var(--b-primary)] font-black text-xs">
                  <td className="border-r-2 border-[var(--b-primary)] px-2 py-1.5 uppercase text-[var(--b-primary)]">
                    TOTAL
                  </td>
                  {bimestresList.map((b) => {
                    const t = totauxParBimestre[b.id];
                    return (
                      <React.Fragment key={`tot-${b.id}`}>
                        <td className="border-r border-[var(--b-primary)] text-center font-mono text-red-700 text-sm font-black py-1.5">
                          {t.totalCoef}
                        </td>
                        <td className="border-r-2 border-[var(--b-primary)] text-center font-mono font-black text-sm text-blue-700 py-1.5">
                          {t.totalPoints || ''}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>

                {/* Ligne MOYENNE DE L'ELEVE */}
                <tr className="border-b-2 border-[var(--b-primary)] font-black text-xs">
                  <td className="border-r-2 border-[var(--b-primary)] px-2 py-1.5 uppercase text-[var(--b-primary)]">
                    MOYENNE DE L&apos;ELEVE
                  </td>
                  {bimestresList.map((b) => {
                    const t = totauxParBimestre[b.id];
                    return (
                      <td key={`moy-${b.id}`} className="border-r-2 border-[var(--b-primary)] text-center font-mono py-1.5 text-sm font-black text-red-700" colSpan={2}>
                        {t.moyenneGenerale ? `${t.moyenneGenerale} /20` : '.... /20'}
                      </td>
                    );
                  })}
                </tr>

                {/* Ligne RANG DE L'ELEVE */}
                <tr className="border-b-2 border-[var(--b-primary)] font-black text-xs">
                  <td className="border-r-2 border-[var(--b-primary)] px-2 py-1.5 uppercase text-[var(--b-primary)]">
                    RANG DE L&apos;ELEVE
                  </td>
                  {bimestresList.map((b) => {
                    const t = totauxParBimestre[b.id];
                    return (
                      <td key={`rang-${b.id}`} className="border-r-2 border-[var(--b-primary)] text-center font-mono py-1.5 text-xs text-purple-800 font-bold" colSpan={2}>
                        {t.rang ? `${t.rang}è /${t.effectif || 35}` : '.... /....'}
                      </td>
                    );
                  })}
                </tr>

                {/* Ligne OBSERVATION */}
                <tr className="border-b-2 border-[var(--b-primary)]">
                  <td className="border-r-2 border-[var(--b-primary)] px-2 py-2 uppercase font-black text-[var(--b-primary)] align-top text-xs">
                    OBSERVATION
                  </td>
                  {bimestresList.map((b) => {
                    const t = totauxParBimestre[b.id];
                    return (
                      <td key={`obs-${b.id}`} className="border-r-2 border-[var(--b-primary)] p-1 text-center text-[10px] align-top h-20 sm:h-24" colSpan={2}>
                        <div className="font-bold text-blue-900 italic text-xs py-0.5">
                          {t.appreciation || (t.moyenneGenerale ? (Number(t.moyenneGenerale.replace(',', '.')) >= 10 ? 'Passable' : 'Résultats insuffisants') : '')}
                        </div>
                      </td>
                    );
                  })}
                </tr>

                {/* Ligne Signatures */}
                <tr className="font-bold text-[10px] text-[var(--b-primary)]">
                  <td className="border-r-2 border-[var(--b-primary)] px-2 py-1 uppercase font-black text-xs">
                    Signatures
                  </td>
                  {bimestresList.map((b) => (
                    <td key={`sig-${b.id}`} className="border-r-2 border-[var(--b-primary)] p-1 text-center align-bottom h-16 sm:h-20" colSpan={2}>
                      <div className="flex justify-around border-t border-[var(--b-primary)] pt-0.5 text-[8px]">
                        <span>Titulaire</span>
                        <span>Parents</span>
                        {b.numero === 3 && <span className="font-bold">Proviseur</span>}
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* COLONNE HAVANANA : RESULTAT DU FIN D'ANNEE */}
          <div className="w-full lg:w-48 print:w-48 p-2 text-[10px] sm:text-xs flex flex-col justify-between bg-[var(--b-bg2)]">
            <div>
              <div className="font-black text-[var(--b-primary)] text-center border-b-2 border-[var(--b-primary)] pb-1 uppercase tracking-wider">
                RESULTAT DU FIN D&apos;ANNEE
              </div>

              <div className="space-y-3 pt-2 text-black">
                <div>
                  <p className="font-bold text-[var(--b-primary)]">Moyenne Annuelle</p>
                  <p className="font-mono text-center font-bold text-xs py-0.5">
                    {syntheseAnnuelle ? `${syntheseAnnuelle.moyenneAnnuelle} /20` : '.... /20'}
                  </p>
                  {syntheseAnnuelle && !syntheseAnnuelle.complet && (
                    <p className="text-center text-[8px] italic text-amber-700 -mt-1">
                      (provisoire — {syntheseAnnuelle.nbBimestres}/{bimestresList.length} bimestre{syntheseAnnuelle.nbBimestres > 1 ? 's' : ''})
                    </p>
                  )}
                </div>
                <div>
                  <p className="font-bold text-[var(--b-primary)]">Rang</p>
                  <p className="font-mono text-center font-bold text-slate-800">
                    {syntheseAnnuelle ? `${syntheseAnnuelle.rang}è / ${syntheseAnnuelle.effectif}` : '............'}
                  </p>
                </div>
                <div>
                  <p className="font-bold text-[var(--b-primary)]">ADMIS(E) EN :</p>
                  <p className="border-b border-dotted border-[var(--b-primary)] h-4 font-semibold text-center text-emerald-800">
                    {syntheseAnnuelle?.decision?.startsWith('Admis') ? 'CLASSE SUPÉRIEURE' : ''}
                  </p>
                </div>
                <div>
                  <p className="font-bold text-[var(--b-primary)]">Autorisé(e) à Redoubler en :</p>
                  <p className="border-b border-dotted border-[var(--b-primary)] h-4 font-semibold text-center text-amber-800">
                    {syntheseAnnuelle?.decision?.startsWith('Redoublement') ? 'MÊME CLASSE' : ''}
                  </p>
                </div>
                <div>
                  <p className="font-bold text-[var(--b-primary)]">REMIS(E) A SA FAMILLE</p>
                  <p className="border-b border-dotted border-[var(--b-primary)] h-4 font-semibold text-center text-red-800"></p>
                </div>
                <div className="pt-1 border-t border-[var(--b-soft30)]">
                  <p className="font-bold text-[var(--b-primary)]">Avertissement</p>
                  <div className="flex justify-between text-[8px] pt-1">
                    <span>1<sup>ère</sup> [ ]</span>
                    <span>2<sup>ème</sup> [ ]</span>
                    <span>3<sup>ème</sup> [ ]</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 text-center border-t-2 border-[var(--b-primary)] mt-4">
              <p className="font-black text-xs text-[var(--b-primary)] uppercase">LE PROVISEUR</p>
              <div className="h-16 flex items-center justify-center my-1">
                <div className="w-14 h-14 rounded-full border-2 border-dashed border-[var(--b-soft40)] flex items-center justify-center text-[7px] text-slate-400 font-sans uppercase">
                  [ Cachet / Tampon ]
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>


      {/* ==================================================================================== */}
      {/* PAGE 2 : VERSO (COUVERTURE & HYMNE NATIONAL - MEDIA_1787231419216.JPG)              */}
      {/* ==================================================================================== */}
      <div className="page-verso bg-[var(--b-bg)] border-2 border-[var(--b-primary)] p-4 sm:p-8 rounded-lg shadow-md print:shadow-none print:border-2 print:border-[var(--b-primary)] print:bg-[var(--b-bg)]">
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-10 h-full min-h-[560px]">
          
          {/* VOLET GAUCHE : HIRAM-PIRENERENA MALAGASY */}
          <div className="border-r-0 md:border-r-2 border-dashed border-[var(--b-soft40)] pr-0 md:pr-6 flex flex-col justify-between">
            <div>
              <div className="text-center mb-4">
                <h2 className="font-extrabold text-base sm:text-lg tracking-wider text-[var(--b-primary)] uppercase border-b-2 border-[var(--b-primary)] inline-block pb-1">
                  HIRAM-PIRENERENA MALAGASY
                </h2>
                <div className="text-[var(--b-primary)] text-base mt-1">♫ ♫ ♫ ♫ ♫</div>
              </div>

              <div className="space-y-4 text-xs sm:text-sm leading-relaxed text-[var(--b-primary)]">
                <div>
                  <p className="font-bold text-[var(--b-primary)]">1- Ry Tanindrazanay malala ô!</p>
                  <p className="pl-4">Ry Madagasikara soa</p>
                  <p className="pl-4">Ny Fitiavanay anao tsy miala</p>
                  <p className="pl-4">Fa ho anao doria tokoa</p>
                </div>

                <div>
                  <p className="font-bold text-[var(--b-primary)]">2- Ry Tanindrazanay malala ô!</p>
                  <p className="pl-4">Irinay mba hanompoana anao</p>
                  <p className="pl-4">Ny tena sy fo fanahy anananay,</p>
                  <p className="pl-4 font-semibold italic">&apos;zay sarobidy sy mendrika tokoa ♪</p>
                </div>

                <div>
                  <p className="font-bold text-[var(--b-primary)]">3- Ry Tanindrazanay malala ô!</p>
                  <p className="pl-4">Irinay mba hitahiana anao</p>
                  <p className="pl-4">Ka ilay Nahary izao tontolo izao</p>
                  <p className="pl-4 font-semibold italic">No fototra ijoroan&apos;ny Satanao. ♪</p>
                </div>

                <div className="pt-2 border-t border-[var(--b-soft20)]">
                  <p className="pl-4">Tahionao ry zanahary</p>
                  <p className="pl-4">ity Nosin-dRazanay ity</p>
                  <p className="pl-4">Hiadana sy ho finaritra</p>
                  <p className="pl-4 font-bold text-[var(--b-primary)]">He! Sambatra tokoay izahay.</p>
                </div>
              </div>
            </div>

            <div className="pt-6 mt-4 flex justify-between items-end border-t border-[var(--b-soft30)] text-[10px] sm:text-xs font-sans uppercase tracking-widest text-[var(--b-primary)] font-bold">
              <span>Sagesse</span>
              <span>•</span>
              <span>Savoir</span>
              <span>•</span>
              <span>Succès</span>
            </div>
          </div>

          {/* VOLET DROIT : COUVERTURE DU BULLETIN */}
          <div className="flex flex-col justify-between pl-0 md:pl-2">
            <div>
              {/* En-tête école + Photo & QR */}
              <div className="flex justify-between items-start mb-6">
                <div className="text-xs space-y-0.5">
                  <h3 className="font-black text-sm sm:text-base text-[var(--b-primary)] tracking-wide uppercase">
                    {school.nom_ecole || 'LYCEE PRIVE COPEC'}
                  </h3>
                  <p className="font-extrabold text-[var(--b-primary)]">ISAHA-FIANARANTSOA</p>
                  <p className="text-[11px] text-slate-800">TEL: {school.telephone || '033 14 274 39 - 034 81 545 96'}</p>
                  <p className="text-[11px] text-slate-800">E-mail: {school.email || 'copecfianar@gmail.com'}</p>
                </div>

                {/* Sary photo + QR Code scannable */}
                <div className="flex items-center gap-3">
                  <div className="w-20 h-24 sm:w-24 sm:h-28 border-2 border-[var(--b-primary)] bg-white rounded flex flex-col items-center justify-center p-1 text-center shadow-xs overflow-hidden">
                    {eleve.photo_url ? (
                      <img src={eleve.photo_url} alt="Élève" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-[10px] text-slate-400 font-sans uppercase font-bold">
                        [ SARY / PHOTO ]
                      </div>
                    )}
                  </div>
                  <div className="w-20 h-24 sm:w-24 sm:h-28 border-2 border-[var(--b-primary)] bg-white rounded flex flex-col items-center justify-center p-1 shadow-xs" title="QR officiel de vérification du bulletin">
                    {qrValue ? (
                      <QRCodeSVG value={qrValue} size={92} level="H" includeMargin />
                    ) : (
                      <div className="text-[8px] text-amber-700 text-center font-sans font-bold uppercase">QR indisponible</div>
                    )}
                    <span className="text-[8px] font-mono mt-1 font-bold text-[var(--b-primary)]">VÉRIFIER</span>
                  </div>
                </div>
              </div>

              <div className="mb-4 flex items-center justify-end gap-2 text-[9px] font-sans font-bold text-[var(--b-primary)] uppercase">
                <ShieldCheck size={12} /> QR officiel · {verificationReference || 'non vérifiable'}
              </div>

              {/* Logo Emblem central */}
              <div className="my-6 text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 border-[var(--b-primary)] bg-white text-[var(--b-primary)] font-black text-xl sm:text-2xl shadow-inner">
                  COPEC
                </div>
              </div>

              {/* Titre central */}
              <div className="text-center my-6 py-2 border-y-2 border-[var(--b-primary)]">
                <h1 className="text-lg sm:text-xl font-black uppercase tracking-widest text-[var(--b-primary)]">
                  BULLETIN DE NOTES
                </h1>
                <p className="font-bold text-xs sm:text-sm text-slate-900 mt-1">
                  ANNEE SCOLAIRE: <span className="font-mono text-base font-bold">{anneeLibelle}</span>
                </p>
              </div>

              {/* Infos élève */}
              <div className="bg-white/90 border-2 border-[var(--b-primary)] rounded-lg p-3 sm:p-4 space-y-2 text-xs sm:text-sm">
                <div className="flex border-b border-slate-300 pb-1">
                  <span className="w-24 font-bold text-[var(--b-primary)]">Nom :</span>
                  <span className="font-black text-slate-900 uppercase">{nomEleve}</span>
                </div>
                <div className="flex border-b border-slate-300 pb-1">
                  <span className="w-24 font-bold text-[var(--b-primary)]">Prénom :</span>
                  <span className="font-bold text-slate-900">{prenomEleve || '—'}</span>
                </div>
                <div className="flex border-b border-slate-300 pb-1">
                  <span className="w-24 font-bold text-[var(--b-primary)]">Classe :</span>
                  <span className="font-bold text-slate-900">{classeNom}</span>
                </div>
                <div className="flex">
                  <span className="w-24 font-bold text-[var(--b-primary)]">N° :</span>
                  <span className="font-mono font-bold text-slate-900">{numeroClasse}</span>
                </div>
              </div>
            </div>

            <div className="text-right text-[10px] text-[var(--b-primary)] font-bold italic pt-4">
              Imprimé officiel — {school.nom_ecole || 'COPEC ISAHA'}
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}
