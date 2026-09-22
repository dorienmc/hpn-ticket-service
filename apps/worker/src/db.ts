import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : fs.existsSync(path.resolve(process.cwd(), 'db', 'schema.sql'))
    ? process.cwd()
    : path.resolve(process.cwd(), '..', '..');

const databasePath = process.env.DATABASE_PATH || path.resolve(repoRoot, 'db', 'tickets.db');
const schemaPath = path.resolve(repoRoot, 'db', 'schema.sql');

const dbDir = path.dirname(databasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');

if (fs.existsSync(schemaPath)) {
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);
}

export function getDb() {
  return db;
}
