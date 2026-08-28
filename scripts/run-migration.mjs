import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/run-migration.mjs <path-to-sql>');
  process.exit(1);
}

const sql = readFileSync(path.resolve(__dirname, '..', file), 'utf8');

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await client.connect();
try {
  await client.query(sql);
  console.log(`Applied ${file}`);
} finally {
  await client.end();
}
