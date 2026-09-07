/**
 * Ouvre une fenêtre d'impression avec un tableau HTML simple mis en forme.
 * columns: [{ label: 'Élève', value: (row) => '...' }, ...]
 */
export function printTable({ title, subtitle, columns, rows }) {
  const win = window.open('', '_blank', 'width=1000,height=700');
  if (!win) return;
  const rowsHtml = (rows || [])
    .map((row) => `<tr>${columns.map((col) => `<td>${escapeHtml(String(col.value(row) ?? ''))}</td>`).join('')}</tr>`)
    .join('');
  const headHtml = columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join('');

  win.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #0f172a; }
          h1 { font-size: 18px; margin-bottom: 2px; }
          p.subtitle { font-size: 12px; color: #64748b; margin-top: 0; margin-bottom: 18px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
          th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; color: #475569; }
          tr:nth-child(even) td { background: #f8fafc; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
        <table>
          <thead><tr>${headHtml}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

/**
 * Impression d'un bulletin individuel (mise en page "officielle" avec en-tête
 * établissement, tableau des matières, moyenne générale, rang et appréciation).
 * bulletin: résultat de GET /bulletins/:id/detail (avec bulletin.matieres[]).
 */
export function printBulletinIndividuel({ bulletin, classeNom, bimestreLibelle, ecole }) {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return;
  const nomEcole = ecole?.nom_ecole || 'COPEC ISAHA';

  const matieresHtml = (bulletin.matieres || [])
    .map((m) => `
      <tr>
        <td>${escapeHtml(m.matiere_nom)}</td>
        <td class="center">${m.coefficient}</td>
        <td class="center">${Number(m.moyenne).toFixed(2)}</td>
        <td class="center">${Number(m.total_points).toFixed(2)}</td>
        <td>${escapeHtml(m.appreciation || '')}</td>
      </tr>`)
    .join('');

  const moyenne = Number(bulletin.moyenne_generale);
  const mention = mentionMoyenne(moyenne);

  win.document.write(`
    <html>
      <head>
        <title>Bulletin — ${escapeHtml(bulletin.nom)} ${escapeHtml(bulletin.prenom)}</title>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, Helvetica, sans-serif; padding: 28px; color: #0f172a; }
          .entete { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 18px; }
          .entete h1 { font-size: 16px; margin: 0; color: #1e3a8a; }
          .entete p { margin: 2px 0 0; font-size: 11px; color: #64748b; }
          .titre-bulletin { text-align: center; margin-bottom: 18px; }
          .titre-bulletin h2 { font-size: 15px; margin: 0; text-transform: uppercase; letter-spacing: 0.06em; }
          .titre-bulletin p { font-size: 12px; color: #475569; margin: 2px 0 0; }
          .infos-eleve { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 16px; background: #f8fafc; padding: 10px 14px; border-radius: 6px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 18px; }
          th, td { border: 1px solid #cbd5e1; padding: 7px 9px; text-align: left; }
          th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; color: #475569; }
          td.center, th.center { text-align: center; }
          .synthese { display: flex; gap: 14px; margin-bottom: 18px; }
          .synthese .bloc { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 14px; text-align: center; }
          .synthese .bloc .valeur { font-size: 20px; font-weight: bold; }
          .synthese .bloc .label { font-size: 10px; text-transform: uppercase; color: #64748b; letter-spacing: 0.04em; }
          .mention { font-weight: bold; }
          .signatures { display: flex; justify-content: space-between; margin-top: 50px; font-size: 11px; text-align: center; }
          .signatures div { width: 40%; border-top: 1px solid #94a3b8; padding-top: 6px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="entete">
          <div>
            <h1>${escapeHtml(nomEcole)}</h1>
            <p>Établissement scolaire</p>
          </div>
          <p>Édité le ${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</p>
        </div>

        <div class="titre-bulletin">
          <h2>Bulletin de notes</h2>
          <p>${escapeHtml(bimestreLibelle || bulletin.bimestre_libelle || '')} — ${escapeHtml(classeNom || bulletin.classe_nom || '')}</p>
        </div>

        <div class="infos-eleve">
          <span><strong>Élève :</strong> ${escapeHtml(bulletin.nom)} ${escapeHtml(bulletin.prenom)}</span>
          <span><strong>Matricule :</strong> ${escapeHtml(bulletin.matricule || '—')}</span>
          <span><strong>Classe :</strong> ${escapeHtml(classeNom || bulletin.classe_nom || '—')}</span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Matière</th>
              <th class="center">Coef.</th>
              <th class="center">Moyenne / 20</th>
              <th class="center">Points</th>
              <th>Appréciation</th>
            </tr>
          </thead>
          <tbody>${matieresHtml}</tbody>
        </table>

        <div class="synthese">
          <div class="bloc"><div class="valeur">${Number.isNaN(moyenne) ? '—' : moyenne.toFixed(2)}/20</div><div class="label">Moyenne générale</div></div>
          <div class="bloc"><div class="valeur">${bulletin.rang || '—'}${bulletin.effectif_classe ? ` / ${bulletin.effectif_classe}` : ''}</div><div class="label">Rang</div></div>
          <div class="bloc"><div class="valeur mention">${escapeHtml(mention.label)}</div><div class="label">Mention</div></div>
          <div class="bloc"><div class="valeur">${(bulletin.absent_total ?? 0)} / ${(bulletin.retard_total ?? 0)}</div><div class="label">Absences / retards</div></div>
        </div>

        ${bulletin.appreciation_generale ? `<p><strong>Appréciation générale :</strong> ${escapeHtml(bulletin.appreciation_generale)}</p>` : ''}
        ${bulletin.decision ? `<p><strong>Décision :</strong> ${escapeHtml(bulletin.decision)}</p>` : ''}

        <div class="signatures">
          <div>Signature du responsable</div>
          <div>Signature de la direction</div>
        </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

/**
 * Impression d'un reçu de paiement (frais scolaire).
 * paiement: { recu_numero, date_paiement, montant, mode_paiement, reference_paiement, eleve_nom, eleve_prenom, frais_libelle }
 * frais: { montant_total, type_frais } (optionnel, pour afficher le reste à payer)
 */
/**
 * ecole: objet { nom_ecole, telephone, email, adresse } renvoyé par GET /parametres — passé
 * par l'appelant (Finances.jsx) pour que le reçu affiche le vrai nom/coordonnées de
 * l'établissement (modifiable dans Paramètres) plutôt qu'un nom d'établissement figé en dur.
 * Si absent (appel existant non mis à jour), on retombe sur "COPEC ISAHA" comme avant.
 */
// ---------------------------------------------------------------------------
// Nombre -> lettres (français), pour la mention « en toutes lettres » des reçus
// et fiches de paie, comme sur les carnets/fiches papier de référence.
// ---------------------------------------------------------------------------
const UNITES = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingt', 'quatre-vingt-dix'];

function centainesEnLettres(n) {
  if (n === 0) return '';
  if (n < 20) return UNITES[n];
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    if (d === 7 || d === 9) return `${DIZAINES[d - 1]}-${UNITES[10 + u]}`;
    return `${DIZAINES[d]}${u === 0 ? '' : u === 1 && d !== 8 ? '-et-un' : `-${UNITES[u]}`}`;
  }
  const c = Math.floor(n / 100);
  const reste = n % 100;
  const prefixe = c === 1 ? 'cent' : `${UNITES[c]}-cent`;
  if (reste === 0) return c === 1 ? 'cent' : `${prefixe}s`;
  return `${prefixe}-${centainesEnLettres(reste)}`;
}

/** Convertit un entier positif en toutes lettres, français, adapté aux montants en Ariary. */
export function montantEnLettres(nombre) {
  let n = Math.round(Number(nombre) || 0);
  if (n === 0) return 'zéro';
  const groupes = [
    { valeur: 1000000000, mot: 'milliard' },
    { valeur: 1000000, mot: 'million' },
    { valeur: 1000, mot: 'mille' },
  ];
  const parties = [];
  for (const g of groupes) {
    const q = Math.floor(n / g.valeur);
    if (q > 0) {
      if (g.valeur === 1000 && q === 1) {
        parties.push('mille');
      } else {
        parties.push(`${centainesEnLettres(q)} ${q > 1 ? `${g.mot}s` : g.mot}`);
      }
      n -= q * g.valeur;
    }
  }
  if (n > 0) parties.push(centainesEnLettres(n));
  return parties.join(' ').replace(/\s+/g, ' ').trim();
}

/** En-tête commun (bandeau étoilé + logo + nom d'établissement), façon carnet/fiche COPEC. */
function enteteCopec({ nomEcole, coordonnees, accent = '#1b3c62', etoiles = true, icone = '🎓' }) {
  return `
    ${etoiles ? '<div class="etoiles">★ ★ ★</div>' : ''}
    <div class="entete">
      <img class="logo" src="/logo.jpg" alt="Logo" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'logo logo-repli',textContent:'${icone}'}))" />
      <div class="entete-texte">
        <h1 style="color:${accent}">${escapeHtml(nomEcole)}</h1>
        <p>${escapeHtml(coordonnees || 'Établissement scolaire')}</p>
      </div>
    </div>
  `;
}

/** Ligne à cocher (mode de paiement, etc.) façon formulaire papier — ☑ si actif, ☐ sinon. */
function caseACocher(label, actif) {
  return `<span class="case-cocher">${actif ? '☑' : '☐'} ${escapeHtml(label)}</span>`;
}

const STYLE_PIECE_COPEC = (accent) => `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; padding: 22px; color: #0f172a; }
  .feuille { border: 2px solid ${accent}; border-radius: 14px; padding: 22px 26px 18px; position: relative; }
  .etoiles { text-align: center; color: ${accent}; letter-spacing: 10px; font-size: 12px; margin-bottom: 6px; }
  .entete { display: flex; align-items: center; gap: 14px; justify-content: center; border-bottom: 3px solid ${accent}; padding-bottom: 14px; margin-bottom: 16px; }
  .entete .logo { width: 58px; height: 58px; object-fit: contain; border-radius: 10px; }
  .entete .logo-repli { display: flex; align-items: center; justify-content: center; font-size: 28px; background: ${accent}14; }
  .entete-texte { text-align: center; }
  .entete-texte h1 { font-size: 18px; margin: 0; letter-spacing: 0.03em; }
  .entete-texte p { margin: 2px 0 0; font-size: 11px; color: #64748b; }
  .bandeau { background: ${accent}; color: #fff; text-align: center; padding: 9px; border-radius: 7px; margin-bottom: 4px; }
  .bandeau h2 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; }
  .numero { text-align: center; font-size: 11px; color: #64748b; margin: 8px 0 18px; }
  table.infos { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; background: #f8fafc; border-radius: 8px; overflow: hidden; }
  table.infos td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
  table.infos td.label { color: #64748b; width: 42%; }
  table.infos td.valeur { font-weight: 700; text-align: right; }
  table.detail { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 18px; }
  table.detail th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #fff; background: ${accent}; padding: 7px 8px; }
  table.detail td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; }
  table.detail td.valeur, table.detail th.valeur { text-align: right; }
  .case-cocher { display: inline-block; margin-right: 14px; font-size: 12.5px; }
  .ligne-cases { background: #f8fafc; border-radius: 8px; padding: 8px 12px; margin-bottom: 16px; font-size: 12.5px; }
  .montant-bloc { text-align: center; border: 1.5px solid ${accent}55; background: ${accent}0d; border-radius: 10px; padding: 16px; margin-bottom: 18px; }
  .montant-bloc .valeur { font-size: 28px; font-weight: 800; color: ${accent}; }
  .montant-bloc .label { font-size: 10px; text-transform: uppercase; color: #64748b; letter-spacing: 0.06em; margin-top: 2px; }
  .recu-bloc { border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 16px; margin-bottom: 18px; font-size: 12.5px; line-height: 1.9; }
  .recu-bloc .pointille { display: inline-block; border-bottom: 1px dotted #94a3b8; min-width: 60%; }
  .fait-le { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 22px; }
  .signatures { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; text-align: center; }
  .signatures div { width: 42%; }
  .signatures .case { border: 1px dashed #cbd5e1; border-radius: 8px; height: 56px; margin-bottom: 6px; position: relative; }
  .signatures .cachet-rond { width: 50px; height: 50px; border: 2px dotted ${accent}88; border-radius: 50%; margin: 3px auto; }
  .pied { margin-top: 20px; font-size: 10px; color: #94a3b8; text-align: center; border-top: 1px dashed #e2e8f0; padding-top: 10px; }
  .pied em { color: ${accent}; }
  @media print { body { padding: 0; } .feuille { border-color: ${accent}; } }
`;

export function printRecuPaiement({ paiement, frais, ecole }) {
  const win = window.open('', '_blank', 'width=650,height=820');
  if (!win) return;

  const reste = frais ? Number(frais.montant_total) - Number(frais.total_paye ?? paiement.montant) : null;
  const nomEcole = ecole?.nom_ecole || 'COPEC ISAHA';
  const coordonnees = [ecole?.adresse, ecole?.telephone, ecole?.email].filter(Boolean).join(' · ');
  const montant = Number(paiement.montant);
  const isAvoir = !!paiement.is_avoir;
  const montantAffiche = isAvoir ? `-${montant.toLocaleString('fr-FR')} Ar` : `${montant.toLocaleString('fr-FR')} Ar`;
  const accent = '#1b3c62';

  win.document.write(`
    <html>
      <head>
        <title>Reçu ${escapeHtml(paiement.recu_numero || '')}</title>
        <meta charset="utf-8" />
        <style>${STYLE_PIECE_COPEC(accent)}</style>
      </head>
      <body>
      <div class="feuille">
        ${enteteCopec({ nomEcole, coordonnees, accent })}
        <div class="bandeau"><h2>🎓 ${isAvoir ? 'Avoir / Annulation' : 'Reçu de paiement — Écolage'}</h2></div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <p class="numero">N° ${escapeHtml(paiement.recu_numero || '—')} · ${escapeHtml(new Date(paiement.date_paiement || Date.now()).toLocaleDateString('fr-FR'))}</p>
          ${paiement.recu_numero ? `<img alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(window.location.origin + '/api/finance/recu/verify/' + paiement.recu_numero)}" style="width:80px;height:80px;border-radius:6px;"/>` : ''}
        </div>

        <table class="infos">
          <tr><td class="label">👤 Élève</td><td class="valeur">${escapeHtml(`${paiement.eleve_prenom || ''} ${paiement.eleve_nom || ''}`.trim())}</td></tr>
          <tr><td class="label">📌 Motif</td><td class="valeur">${escapeHtml(paiement.frais_libelle || paiement.type_frais || '—')}</td></tr>
          ${paiement.reference_paiement ? `<tr><td class="label">🔖 Référence</td><td class="valeur">${escapeHtml(paiement.reference_paiement)}</td></tr>` : ''}
          ${reste != null ? `<tr><td class="label">⏳ Reste à payer</td><td class="valeur">${reste.toLocaleString('fr-FR')} Ar</td></tr>` : ''}
        </table>

        <div class="ligne-cases">
          <strong style="color:#64748b; font-size:11px; text-transform:uppercase;">Mode de paiement :</strong><br />
          ${caseACocher('Espèces', paiement.mode_paiement === 'especes')}
          ${caseACocher('Mobile Money', paiement.mode_paiement === 'mobile_money')}
          ${caseACocher('Virement', paiement.mode_paiement === 'virement')}
          ${caseACocher('Chèque', paiement.mode_paiement === 'cheque')}
        </div>

        <div class="montant-bloc">
          <div class="valeur">${isAvoir ? `-${montant.toLocaleString('fr-FR')}` : montant.toLocaleString('fr-FR')} Ar</div>
          <div class="label">${isAvoir ? 'Montant annulé (avoir)' : 'Montant encaissé'}</div>
        </div>

        <div class="recu-bloc">
          Je soussigné(e), caissier(ère) de ${escapeHtml(nomEcole)}, reconnais avoir reçu de
          <strong>${escapeHtml(`${paiement.eleve_prenom || ''} ${paiement.eleve_nom || ''}`.trim())}</strong> (ou son représentant)
          la somme de <strong>${isAvoir ? `-${montant.toLocaleString('fr-FR')} Ar` : `${montant.toLocaleString('fr-FR')} Ar`}</strong>,
          en toutes lettres : <em>${escapeHtml(montantEnLettres(montant))} ariary</em>,
          pour solde relatif au motif ci-dessus.
        </div>

        <div class="fait-le">
          <span>Fait à <span class="pointille">${escapeHtml(ecole?.adresse || '.......................')}</span></span>
          <span>Le <span class="pointille">${escapeHtml(new Date(paiement.date_paiement || Date.now()).toLocaleDateString('fr-FR'))}</span></span>
        </div>

        <div class="signatures">
          <div><div class="case"></div>Signature du payeur</div>
          <div><div class="case"><div class="cachet-rond"></div></div>Cachet &amp; signature — Caisse</div>
        </div>
        <p class="pied">Ce reçu fait foi de paiement — à conserver. <br /><em>Investir dans l'éducation, c'est construire l'avenir.</em></p>
      </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

/**
 * Impression d'un reçu GROUPÉ couvrant plusieurs frais réglés en une seule opération
 * (ex. un parent qui paie 3 mois d'écolage d'un coup — voir POST /finance/paiements/lot).
 * lignes: [{ recu_numero, montant, libelle, mois, reste }] — une par frais couvert.
 * eleve: { eleve_nom, eleve_prenom }, montant_total: somme réellement encaissée.
 */
const MOIS_LIBELLE = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export function printRecuPaiementLot({ eleve, lignes, montant_total, mode_paiement, reference_paiement, ecole }) {
  const win = window.open('', '_blank', 'width=650,height=820');
  if (!win) return;

  const nomEcole = ecole?.nom_ecole || 'COPEC ISAHA';
  const coordonnees = [ecole?.adresse, ecole?.telephone, ecole?.email].filter(Boolean).join(' · ');
  const premierRecu = lignes[0]?.recu_numero || '—';
  const dernierRecu = lignes[lignes.length - 1]?.recu_numero || '—';
  const montant = Number(montant_total);
  const accent = '#1b3c62';

  win.document.write(`
    <html>
      <head>
        <title>Reçu groupé ${escapeHtml(premierRecu)}</title>
        <meta charset="utf-8" />
        <style>${STYLE_PIECE_COPEC(accent)}</style>
      </head>
      <body>
      <div class="feuille">
        ${enteteCopec({ nomEcole, coordonnees, accent })}
        <div class="bandeau"><h2>🎓 Reçu de paiement groupé — Écolage</h2></div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <p class="numero">N° ${escapeHtml(premierRecu)}${dernierRecu !== premierRecu ? ` à ${escapeHtml(dernierRecu)}` : ''} · ${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</p>
          ${premierRecu ? `<img alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(window.location.origin + '/api/finance/recu/verify/' + premierRecu)}" style="width:80px;height:80px;border-radius:6px;"/>` : ''}
        </div>

        <table class="infos">
          <tr><td class="label">👤 Élève</td><td class="valeur">${escapeHtml(`${eleve?.eleve_prenom || ''} ${eleve?.eleve_nom || ''}`.trim())}</td></tr>
          ${reference_paiement ? `<tr><td class="label">🔖 Référence</td><td class="valeur">${escapeHtml(reference_paiement)}</td></tr>` : ''}
        </table>

        <div class="ligne-cases">
          <strong style="color:#64748b; font-size:11px; text-transform:uppercase;">Mode de paiement :</strong><br />
          ${caseACocher('Espèces', mode_paiement === 'especes')}
          ${caseACocher('Mobile Money', mode_paiement === 'mobile_money')}
          ${caseACocher('Virement', mode_paiement === 'virement')}
          ${caseACocher('Chèque', mode_paiement === 'cheque')}
        </div>

        <table class="detail">
          <thead><tr><th>Mois / libellé</th><th>N° reçu</th><th class="valeur">Montant</th></tr></thead>
          <tbody>
            ${lignes.map((l) => `
              <tr>
                <td>${escapeHtml(l.mois ? `Écolage — ${MOIS_LIBELLE[l.mois - 1]}` : (l.libelle || '—'))}</td>
                <td>${escapeHtml(l.recu_numero || '—')}</td>
                <td class="valeur">${Number(l.montant).toLocaleString('fr-FR')} Ar</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="montant-bloc">
          <div class="valeur">${montant.toLocaleString('fr-FR')} Ar</div>
          <div class="label">Montant total encaissé — ${lignes.length} mois/frais couvert(s)</div>
        </div>

        <div class="recu-bloc">
          Je soussigné(e), caissier(ère) de ${escapeHtml(nomEcole)}, reconnais avoir reçu de
          <strong>${escapeHtml(`${eleve?.eleve_prenom || ''} ${eleve?.eleve_nom || ''}`.trim())}</strong> (ou son représentant)
          la somme de <strong>${montant.toLocaleString('fr-FR')} Ar</strong>,
          en toutes lettres : <em>${escapeHtml(montantEnLettres(montant))} ariary</em>,
          couvrant les mois/frais listés ci-dessus.
        </div>

        <div class="fait-le">
          <span>Fait à <span class="pointille">${escapeHtml(ecole?.adresse || '.......................')}</span></span>
          <span>Le <span class="pointille">${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</span></span>
        </div>

        <div class="signatures">
          <div><div class="case"></div>Signature du payeur</div>
          <div><div class="case"><div class="cachet-rond"></div></div>Cachet &amp; signature — Caisse</div>
        </div>
        <p class="pied">Ce reçu fait foi de paiement — à conserver. <br /><em>Investir dans l'éducation, c'est construire l'avenir.</em></p>
      </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

// Petite icône par mois, comme sur le carnet de paiement papier de référence.
const MOIS_ICONE = ['❄️', '💙', '🌿', '🌸', '☀️', '☀️', '⛱️', '🌴', '📘', '🍂', '🌧️', '🎄'];

/**
 * Imprime le « carnet de paiement écolage » annuel d'un élève : les 12 mois d'un coup,
 * payés ou non, comme le carnet papier de référence — utile à remettre/archiver en début
 * d'année, en complément des reçus mois par mois (printRecuPaiement) émis à chaque paiement.
 * moisEcolage: lignes frais_scolaire de type 'ecolage' (une par mois), triées par mois.
 * eleve: { nom, prenom, matricule, classe_nom }.
 */
export function printCarnetEcolage({ eleve, moisEcolage, anneeLibelle, ecole }) {
  const win = window.open('', '_blank', 'width=750,height=900');
  if (!win) return;

  const nomEcole = ecole?.nom_ecole || 'COPEC ISAHA';
  const coordonnees = [ecole?.adresse, ecole?.telephone, ecole?.email].filter(Boolean).join(' · ');
  const accent = '#1b3c62';
  const totalAnnuel = (moisEcolage || []).reduce((s, f) => s + Number(f.total_paye || 0), 0);

  const lignesMois = Array.from({ length: 12 }, (_, i) => {
    const mois = i + 1;
    const f = (moisEcolage || []).find((x) => Number(x.mois) === mois);
    const estPaye = f?.statut === 'paye';
    const estPartiel = f?.statut === 'partiel';
    return `
      <tr>
        <td>${MOIS_ICONE[i]} ${MOIS_LIBELLE[i]}</td>
        <td class="valeur">${f ? Number(f.montant_total).toLocaleString('fr-FR') : '—'}</td>
        <td class="valeur">${f?.date_echeance ? new Date(f.date_echeance).toLocaleDateString('fr-FR') : '—'}</td>
        <td class="valeur">${f ? Number(f.total_paye || 0).toLocaleString('fr-FR') : '—'}</td>
        <td style="text-align:center">${estPaye ? '✅ Payé' : estPartiel ? '🟡 Partiel' : f ? '🔴 Impayé' : '—'}</td>
      </tr>
    `;
  }).join('');

  win.document.write(`
    <html>
      <head>
        <title>Carnet écolage — ${escapeHtml(eleve?.prenom || '')} ${escapeHtml(eleve?.nom || '')}</title>
        <meta charset="utf-8" />
        <style>${STYLE_PIECE_COPEC(accent)}</style>
      </head>
      <body>
      <div class="feuille">
        ${enteteCopec({ nomEcole, coordonnees, accent })}
        <div class="bandeau"><h2>🎓 Carnet de paiement — Écolage</h2></div>
        <p class="numero">Paiement par mois · Année scolaire ${escapeHtml(anneeLibelle || '')}</p>

        <table class="infos">
          <tr><td class="label">👤 Nom de l'élève</td><td class="valeur">${escapeHtml(`${eleve?.prenom || ''} ${eleve?.nom || ''}`.trim())}</td></tr>
          <tr><td class="label">🏫 Établissement</td><td class="valeur">${escapeHtml(nomEcole)}</td></tr>
          ${eleve?.classe_nom ? `<tr><td class="label">📖 Classe / Niveau</td><td class="valeur">${escapeHtml(eleve.classe_nom)}</td></tr>` : ''}
          ${eleve?.matricule ? `<tr><td class="label">🪪 Matricule</td><td class="valeur">${escapeHtml(eleve.matricule)}</td></tr>` : ''}
        </table>

        <table class="detail">
          <thead>
            <tr><th>Mois</th><th class="valeur">Montant à payer</th><th class="valeur">Échéance</th><th class="valeur">Montant payé</th><th style="text-align:center">Statut</th></tr>
          </thead>
          <tbody>${lignesMois}</tbody>
          <tfoot>
            <tr style="font-weight:800;background:${accent}14">
              <td>TOTAL ANNUEL</td><td colspan="2"></td><td class="valeur">${totalAnnuel.toLocaleString('fr-FR')} Ar</td><td></td>
            </tr>
          </tfoot>
        </table>

        <div class="ligne-cases" style="line-height:1.8">
          <strong style="color:#64748b; font-size:11px; text-transform:uppercase;">Instructions</strong><br />
          • Le paiement doit être effectué chaque mois.<br />
          • Ce carnet doit être présenté à chaque paiement (ou son reçu correspondant).<br />
          • En cas de perte, aucun duplicata ne sera délivré sans autorisation.
        </div>

        <div class="fait-le">
          <span>Date d'émission : <span class="pointille">${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</span></span>
        </div>
        <div class="signatures" style="justify-content:flex-end">
          <div><div class="case"><div class="cachet-rond"></div></div>Cachet &amp; signature — Administration</div>
        </div>
        <p class="pied"><em>Investir dans l'éducation, c'est construire l'avenir.</em></p>
      </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

const LIBELLE_CERTIFICAT = {
  scolarite: {
    titre: 'Certificat de scolarité',
    corps: (e, classeNom, anneeLibelle) => `certifie que <strong>${escapeHtml(`${e.prenom || ''} ${e.nom}`.trim())}</strong>` +
      `${e.date_naissance ? `, né(e) le ${escapeHtml(new Date(e.date_naissance).toLocaleDateString('fr-FR'))}${e.lieu_naissance ? ` à ${escapeHtml(e.lieu_naissance)}` : ''},` : ''}` +
      ` est régulièrement inscrit(e) dans notre établissement, en classe de <strong>${escapeHtml(classeNom)}</strong>, ` +
      `au titre de l'année scolaire <strong>${escapeHtml(anneeLibelle)}</strong>.`,
  },
  frequentation: {
    titre: 'Attestation de fréquentation',
    corps: (e, classeNom, anneeLibelle) => `atteste que <strong>${escapeHtml(`${e.prenom || ''} ${e.nom}`.trim())}</strong> ` +
      `fréquente assidûment notre établissement, en classe de <strong>${escapeHtml(classeNom)}</strong>, ` +
      `au titre de l'année scolaire <strong>${escapeHtml(anneeLibelle)}</strong>.`,
  },
  radiation: {
    titre: 'Certificat de radiation',
    corps: (e, classeNom, anneeLibelle) => `certifie que <strong>${escapeHtml(`${e.prenom || ''} ${e.nom}`.trim())}</strong>, ` +
      `inscrit(e) en classe de <strong>${escapeHtml(classeNom)}</strong> au titre de l'année scolaire ` +
      `<strong>${escapeHtml(anneeLibelle)}</strong>, ne figure plus sur les effectifs de notre établissement.`,
  },
};

/**
 * Impression d'un certificat/attestation de scolarité.
 * certificat: ligne renvoyée par POST/GET /certificats (numero, type_certificat, date_emission,
 * eleve_nom, eleve_prenom, matricule, classe_nom, annee_libelle, motif...)
 * autoPrint: false pour un simple aperçu (n'ouvre pas la boîte de dialogue d'impression).
 * Retourne false si la fenêtre a été bloquée par le navigateur (pop-up), true sinon —
 * permet à l'appelant d'avertir l'utilisateur avec un toast plutôt que d'échouer en silence.
 */
export function printAttestationScolarite({ certificat, autoPrint = true, ecole }) {
  const win = window.open('', '_blank', 'width=800,height=950');
  if (!win) return false;

  const nomEcole = ecole?.nom_ecole || 'COPEC ISAHA';
  const ville = ecole?.adresse || 'Fianarantsoa';
  const modele = LIBELLE_CERTIFICAT[certificat.type_certificat] || LIBELLE_CERTIFICAT.scolarite;
  const eleve = { nom: certificat.eleve_nom, prenom: certificat.eleve_prenom, date_naissance: certificat.eleve_date_naissance, lieu_naissance: certificat.eleve_lieu_naissance };

  win.document.write(`
    <html>
      <head>
        <title>${escapeHtml(modele.titre)} — ${escapeHtml(certificat.numero)}</title>
        <meta charset="utf-8" />
        <style>
          body { font-family: 'Georgia', 'Times New Roman', serif; padding: 40px; color: #0f172a; }
          .entete { text-align: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 14px; margin-bottom: 30px; }
          .entete h1 { font-size: 18px; margin: 0; color: #1e3a8a; letter-spacing: 0.03em; }
          .entete p { margin: 3px 0 0; font-size: 11px; color: #64748b; }
          .numero { text-align: right; font-size: 11px; color: #64748b; margin-bottom: 30px; }
          .titre { text-align: center; margin-bottom: 40px; }
          .titre h2 { font-size: 20px; margin: 0; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 3px double #1e3a8a; display: inline-block; padding-bottom: 6px; }
          .corps { font-size: 15px; line-height: 2; text-align: justify; margin: 0 10px 40px; }
          .motif { font-size: 13px; color: #475569; font-style: italic; margin: 0 10px 40px; }
          .fait-a { text-align: right; font-size: 13px; margin: 0 10px 60px; }
          .signature { text-align: right; font-size: 13px; margin: 0 40px; }
          .signature .fonction { font-size: 11px; color: #64748b; margin-top: 60px; }
          @media print { body { padding: 0 20px; } }
        </style>
      </head>
      <body>
        <div class="entete">
          <h1>${escapeHtml(nomEcole)}</h1>
          <p>Établissement scolaire</p>
        </div>

        <p class="numero">N° ${escapeHtml(certificat.numero)}</p>

        <div class="titre"><h2>${escapeHtml(modele.titre)}</h2></div>

        <p class="corps">
          Le Directeur de l'établissement ${escapeHtml(nomEcole)}
          ${modele.corps(eleve, certificat.classe_nom, certificat.annee_libelle)}
          ${certificat.matricule ? ` (matricule n° ${escapeHtml(certificat.matricule)})` : ''}.
        </p>

        ${certificat.motif ? `<p class="motif">Motif : ${escapeHtml(certificat.motif)}</p>` : ''}

        <p class="corps" style="text-align:center; font-size: 13px; color: #64748b;">
          En foi de quoi, ce certificat est délivré à la famille pour servir et valoir ce que de droit.
        </p>

        <p class="fait-a">Fait à ${escapeHtml(ville)}, le ${escapeHtml(new Date(certificat.date_emission || Date.now()).toLocaleDateString('fr-FR'))}</p>

        <div class="signature">
          Le Directeur / La Directrice
          <div class="fonction">Signature et cachet de l'établissement</div>
        </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  if (autoPrint) setTimeout(() => { win.print(); }, 300);
  return true;
}

/**
 * Impression d'un bulletin de paie enseignant.
 * bulletin: résultat de GET /paie (ligne complète : nom, prenom, mois, annee, heures_normales,
 * heures_supplementaires, salaire_base, prime, retenue, salaire_brut, salaire_net, statut, date_paiement)
 */
const STATUT_PAIE_LABEL = { prepare: 'Préparé', valide: 'Validé', paye: 'Payé', annule: 'Annulé' };

export function printBulletinPaie({ bulletin, moisLibelle, ecole }) {
  const win = window.open('', '_blank', 'width=820,height=920');
  if (!win) return;

  const b = bulletin;
  const nomEcole = ecole?.nom_ecole || 'COPEC ISAHA';
  const coordonnees = [ecole?.adresse, ecole?.telephone, ecole?.email].filter(Boolean).join(' · ');
  const accent = '#0f7a45'; // vert, comme la fiche de paie de référence
  const net = Number(b.salaire_net);
  const dejaPaye = b.statut === 'paye';

  win.document.write(`
    <html>
      <head>
        <title>Fiche de paie — ${escapeHtml(b.nom)} ${escapeHtml(b.prenom || '')}</title>
        <meta charset="utf-8" />
        <style>
          ${STYLE_PIECE_COPEC(accent)}
          .cols { display: flex; gap: 14px; margin-bottom: 4px; }
          .cols table.detail { width: 50%; }
        </style>
      </head>
      <body>
      <div class="feuille">
        ${enteteCopec({ nomEcole, coordonnees, accent, icone: '🍎' })}
        <div class="bandeau"><h2>🍎 Fiche de paie — Réception de salaire enseignant</h2></div>
        <p class="numero">${escapeHtml(moisLibelle || '')} ${escapeHtml(String(b.annee))} · Édité le ${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</p>

        <table class="infos">
          <tr><td class="label">👤 Enseignant</td><td class="valeur">${escapeHtml(`${b.prenom || ''} ${b.nom}`.trim())}</td></tr>
          <tr><td class="label">🏫 Établissement</td><td class="valeur">${escapeHtml(nomEcole)}</td></tr>
          <tr><td class="label">📋 Statut</td><td class="valeur">${escapeHtml(STATUT_PAIE_LABEL[b.statut] || b.statut)}</td></tr>
          ${b.date_paiement ? `<tr><td class="label">📅 Payé le</td><td class="valeur">${escapeHtml(new Date(b.date_paiement).toLocaleDateString('fr-FR'))}</td></tr>` : ''}
          ${b.mode_paiement ? `<tr><td class="label">💳 Mode</td><td class="valeur">${escapeHtml(b.mode_paiement)}</td></tr>` : ''}
          ${b.reference_paiement ? `<tr><td class="label">🔖 Référence</td><td class="valeur">${escapeHtml(b.reference_paiement)}</td></tr>` : ''}
        </table>

        <div class="cols">
          <table class="detail">
            <thead><tr><th colspan="2">💰 Éléments de rémunération</th></tr></thead>
            <tbody>
              <tr><td>Salaire de base</td><td class="valeur">${Number(b.salaire_base).toLocaleString('fr-FR')} Ar</td></tr>
              <tr><td>Heures normales</td><td class="valeur">${Number(b.heures_normales).toLocaleString('fr-FR')} h</td></tr>
              ${Number(b.heures_supplementaires) > 0 ? `<tr><td>Heures supplémentaires</td><td class="valeur">${Number(b.heures_supplementaires).toLocaleString('fr-FR')} h</td></tr>` : ''}
              <tr><td>Prime / Bonus</td><td class="valeur">+ ${Number(b.prime).toLocaleString('fr-FR')} Ar</td></tr>
              <tr style="font-weight:800;background:${accent}14"><td>TOTAL BRUT</td><td class="valeur">${Number(b.salaire_brut).toLocaleString('fr-FR')} Ar</td></tr>
            </tbody>
          </table>
          <table class="detail">
            <thead><tr><th colspan="2">➖ Déductions</th></tr></thead>
            <tbody>
              <tr><td>Retenues (CNAPS, IRSA, autres)</td><td class="valeur">− ${Number(b.retenue).toLocaleString('fr-FR')} Ar</td></tr>
              <tr style="font-weight:800;background:${accent}14"><td>TOTAL DÉDUCTIONS</td><td class="valeur">− ${Number(b.retenue).toLocaleString('fr-FR')} Ar</td></tr>
            </tbody>
          </table>
        </div>

        <div class="montant-bloc">
          <div class="valeur">${net.toLocaleString('fr-FR')} Ar</div>
          <div class="label">Net à payer</div>
        </div>

        <div class="bandeau" style="background:${accent}"><h2 style="font-size:12px">Reçu</h2></div>
        <div class="recu-bloc" style="margin-top:8px">
          Je soussigné(e) <strong>${escapeHtml(`${b.prenom || ''} ${b.nom}`.trim())}</strong>
          reconnais avoir reçu de ${escapeHtml(nomEcole)} la somme de
          <strong>${net.toLocaleString('fr-FR')} Ar</strong>,
          en toutes lettres : <em>${escapeHtml(montantEnLettres(net))} ariary</em>,
          pour solde de tout compte relatif au mois et à l'année indiqués ci-dessus.
          ${!dejaPaye ? '<br /><span style="color:#b45309">⚠ Bulletin non encore marqué « payé » dans le système.</span>' : ''}
        </div>

        <div class="fait-le">
          <span>Fait à <span class="pointille">${escapeHtml(ecole?.adresse || '.......................')}</span></span>
          <span>Le <span class="pointille">${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</span></span>
        </div>

        <div class="signatures">
          <div><div class="case"></div>Signature de l'enseignant</div>
          <div><div class="case"><div class="cachet-rond"></div></div>Cachet &amp; signature — Direction</div>
        </div>
        <p class="pied">Cette fiche de paie sert de preuve de paiement — à conserver. <br /><em>Un enseignant motivé, forme des générations engagées.</em></p>
      </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

/** Mention pédagogique standard à partir de la moyenne générale (/20). */
/**
 * Variante multi-sections de printTable : plusieurs tableaux à la suite dans une même
 * fenêtre d'impression, chacun sous son propre sous-titre.
 * sections: [{ title, columns, rows }, ...]
 */
export function printMultiSectionTable({ title, subtitle, sections }) {
  const win = window.open('', '_blank', 'width=1000,height=700');
  if (!win) return;
  const sectionsHtml = (sections || [])
    .filter((s) => s.rows && s.rows.length > 0)
    .map((s) => {
      const headHtml = s.columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join('');
      const rowsHtml = s.rows.map((row) => `<tr>${s.columns.map((col) => `<td>${escapeHtml(String(col.value(row) ?? ''))}</td>`).join('')}</tr>`).join('');
      return `<h2>${escapeHtml(s.title)}</h2><table><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
    })
    .join('');

  win.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #0f172a; }
          h1 { font-size: 18px; margin-bottom: 2px; }
          h2 { font-size: 13px; margin: 22px 0 8px; color: #1e4a78; }
          p.subtitle { font-size: 12px; color: #64748b; margin-top: 0; margin-bottom: 18px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 6px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
          th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; color: #475569; }
          tr:nth-child(even) td { background: #f8fafc; }
          @media print { body { padding: 0; } h2 { break-after: avoid; } table { break-inside: avoid; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
        ${sectionsHtml || '<p>Aucune donnée sur la période sélectionnée.</p>'}
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

export function mentionMoyenne(moyenne) {
  const v = Number(moyenne);
  if (Number.isNaN(v)) return { label: '—', tone: 'slate' };
  if (v >= 16) return { label: 'Excellent', tone: 'green' };
  if (v >= 14) return { label: 'Très bien', tone: 'green' };
  if (v >= 12) return { label: 'Bien', tone: 'brand' };
  if (v >= 10) return { label: 'Assez bien', tone: 'amber' };
  return { label: 'Insuffisant', tone: 'red' };
}

/**
 * Impression d'une grille (jours en colonnes) - utilisé pour l'emploi du temps.
 * rowsGrid: [{ label: '07:00–08:00', cells: { Lundi: 'Maths — RAKOTO', ... } }]
 */
export function printGrid({ title, subtitle, jours, rowsGrid }) {
  const win = window.open('', '_blank', 'width=1200,height=800');
  if (!win) return;
  const headHtml = `<th>Horaire</th>${jours.map((j) => `<th>${escapeHtml(j)}</th>`).join('')}`;
  const bodyHtml = rowsGrid
    .map((r) => `<tr><td class="horaire">${escapeHtml(r.label)}</td>${jours.map((j) => `<td>${escapeHtml(r.cells[j] || '—')}</td>`).join('')}</tr>`)
    .join('');

  win.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #0f172a; }
          h1 { font-size: 18px; margin-bottom: 2px; }
          p.subtitle { font-size: 12px; color: #64748b; margin-top: 0; margin-bottom: 18px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
          th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; word-wrap: break-word; }
          th { background: #f1f5f9; text-transform: uppercase; font-size: 9px; letter-spacing: 0.04em; color: #475569; }
          td.horaire { font-weight: bold; white-space: nowrap; width: 90px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
        <table>
          <thead><tr>${headHtml}</tr></thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
