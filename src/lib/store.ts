// JSON-file store. MVP persistence: a db.json file created from data/seed.json
// on first boot. NOTE: on Vercel this is ephemeral (filesystem is read-only
// at runtime on serverless) — production needs Postgres/Neon before launch.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Db } from './types';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'db.json');
const SEED_PATH = join(DATA_DIR, 'seed.json');

export function dbPath(): string {
  return DB_PATH;
}

export function readDb(): Db {
  if (!existsSync(DB_PATH)) {
    mkdirSync(DATA_DIR, { recursive: true });
    const seed = readFileSync(SEED_PATH, 'utf-8');
    writeFileSync(DB_PATH, seed);
    return JSON.parse(seed) as Db;
  }
  return JSON.parse(readFileSync(DB_PATH, 'utf-8')) as Db;
}

export function writeDb(db: Db): void {
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

/** Apply a mutation to the DB atomically (read-modify-write). */
export function mutateDb<T>(fn: (db: Db) => T): T {
  const db = readDb();
  const result = fn(db);
  writeDb(db);
  return result;
}

export function nextId(db: Db, prefix: string): string {
  db.seq += 1;
  return `${prefix}-${db.seq}`;
}
