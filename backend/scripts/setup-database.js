const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const root = path.resolve(__dirname, '../..');
const schemaPath = path.join(root, 'database', 'schema.sql');
const seedPath = path.join(root, 'database', 'seed.sql');

function connectionConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
  return { host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432, database: process.env.PGDATABASE || 'gestion_ecole', user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres' };
}

async function main() {
  const client = new Client(connectionConfig());
  await client.connect();
  try {
    console.log('1/2 Application du schema.sql...');
    await client.query(fs.readFileSync(schemaPath, 'utf8'));
    console.log('2/2 Import du seed.sql (données COPEC3)...');
    await client.query(fs.readFileSync(seedPath, 'utf8'));
    console.log('✓ Base COPEC initialisée : schema.sql contient toute la structure finale.');
    console.log('✓ Aucune migration séparée à appliquer : elles sont intégrées dans database/schema.sql.');
  } finally { await client.end(); }
}
main().catch((err) => { console.error('✗ Échec initialisation DB:', err.message); process.exit(1); });
