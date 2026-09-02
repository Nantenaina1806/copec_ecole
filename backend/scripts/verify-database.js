const { Client } = require('pg');
require('dotenv').config();
const cfg = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : { host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432, database: process.env.PGDATABASE || 'gestion_ecole', user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres' };
const tables = ['utilisateur','agent','annee_scolaire','cycle','niveau','matiere','classe','eleve','inscription','parent','salle','emploi_du_temps','pointage_eleve','pointage_enseignant','note','bulletin','devoir','absence_eleve','absence_enseignant','frais_scolaire','paiement','notification','actualite','examen','resultat_examen','discipline'];
(async () => { const client = new Client(cfg); await client.connect(); try { for (const table of tables) { const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`); console.log(`${table.padEnd(24)} ${rows[0].count}`); } } finally { await client.end(); } })().catch((err) => { console.error('✗ Vérification DB échouée:', err.message); process.exit(1); });
