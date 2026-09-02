/**
 * Crée/réinitialise les comptes de démonstration avec le mot de passe connu.
 * Usage : node scripts/reset-demo-passwords.js
 * Démo uniquement — ne pas utiliser ce mot de passe en production.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

const MOT_DE_PASSE_DEMO = 'Ecole@2026';

const utilisateurs = [
  { nom: 'Nantenaina', prenom: 'Eugène', email: 'admin@ecole.mg', role: 'admin', telephone: '0340000000', adresse: 'Fianarantsoa' },
  { nom: 'ANDRIANINA', prenom: 'Luc', email: 'luc.andrianina@ecole.mg', role: 'enseignant', telephone: '0340000008', adresse: 'Antananarivo' },
];

const agents = [
  { nom: 'Rasolofo', prenom: 'Nirina', email: 'secretaire@ecole.mg', role_agent: 'secretaire', telephone: '0330000001', adresse: 'Fianarantsoa' },
  { nom: 'Rasoanaivo', prenom: 'Voahangy', email: 'economie@ecole.mg', role_agent: 'economie', telephone: '0330000003', adresse: 'Fianarantsoa' },
  { nom: 'Andrianary', prenom: 'Toky', email: 'accueil@ecole.mg', role_agent: 'surveillant', telephone: '0330000002', adresse: 'Fianarantsoa' },
];

async function main() {
  const hash = await bcrypt.hash(MOT_DE_PASSE_DEMO, 10);

  for (const u of utilisateurs) {
    await pool.query(
      `INSERT INTO utilisateur (nom, prenom, email, mot_de_passe, role, telephone, adresse, actif, compte_confirme)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,TRUE)
       ON CONFLICT (email) DO UPDATE SET
         mot_de_passe=EXCLUDED.mot_de_passe, role=EXCLUDED.role, actif=TRUE,
         compte_confirme=TRUE, updated_at=CURRENT_TIMESTAMP`,
      [u.nom, u.prenom, u.email, hash, u.role, u.telephone, u.adresse]
    );
  }

  for (const a of agents) {
    await pool.query(
      `INSERT INTO agent (nom, prenom, email, mot_de_passe, role_agent, telephone, adresse, actif)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
       ON CONFLICT (email) DO UPDATE SET
         mot_de_passe=EXCLUDED.mot_de_passe, role_agent=EXCLUDED.role_agent, actif=TRUE,
         updated_at=CURRENT_TIMESTAMP`,
      [a.nom, a.prenom, a.email, hash, a.role_agent, a.telephone, a.adresse]
    );
  }

  console.log('Comptes de connexion créés/réinitialisés : 5');
  console.log('Mot de passe commun : Ecole@2026');
  console.log('  admin@ecole.mg          -> /auth/login');
  console.log('  luc.andrianina@ecole.mg -> /auth/login');
  console.log('  economie@ecole.mg      -> /auth/login-agent');
  console.log('  secretaire@ecole.mg    -> /auth/login-agent');
  console.log('  accueil@ecole.mg       -> /auth/login-agent');
} 

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());
