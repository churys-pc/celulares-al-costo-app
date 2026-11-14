// Acceso SQLite. Usa node:sqlite (Node >= 22.13 / Electron >= 37) y cae a better-sqlite3 si no está.
// Ambas APIs comparten prepare().run/get/all y exec(), así que el resto del código no cambia.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// En el bundle CJS existe `require`; en tests (ESM vía tsx) se crea uno desde el cwd.
const req: NodeJS.Require = typeof require === 'function' ? require : createRequire(path.join(process.cwd(), 'x.js'));

export interface Stmt {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}
export interface Db {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  close(): void;
}

export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  let db: Db;
  try {
    const { DatabaseSync } = req('node:sqlite');
    db = new DatabaseSync(file) as Db;
  } catch {
    const BetterSqlite = req('better-sqlite3');
    db = new BetterSqlite(file) as Db;
  }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

const depth = new WeakMap<Db, number>();
/** Transacción reentrante: la externa usa BEGIN/COMMIT; las anidadas, SAVEPOINT. */
export function tx<T>(db: Db, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  const sp = `sp${d}`;
  db.exec(d ? `SAVEPOINT ${sp}` : 'BEGIN');
  depth.set(db, d + 1);
  try { const r = fn(); db.exec(d ? `RELEASE ${sp}` : 'COMMIT'); return r; }
  catch (e) { db.exec(d ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK'); throw e; }
  finally { depth.set(db, d); }
}

const MIGRATIONS: string[] = [
  `CREATE TABLE brands (
     id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, is_demo INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE models (
     id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
     name TEXT NOT NULL COLLATE NOCASE, release_year INTEGER, is_demo INTEGER NOT NULL DEFAULT 0,
     UNIQUE(brand_id, name));
   CREATE TABLE variants (
     id INTEGER PRIMARY KEY, model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
     storage_gb INTEGER, ram_gb INTEGER, region TEXT, color TEXT, is_demo INTEGER NOT NULL DEFAULT 0);
   CREATE UNIQUE INDEX ux_variant ON variants(model_id, IFNULL(storage_gb,-1), IFNULL(ram_gb,-1),
     IFNULL(region,''), IFNULL(color,''));
   CREATE TABLE products (
     id INTEGER PRIMARY KEY, variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
     condition TEXT NOT NULL CHECK (condition IN ('nuevo','usado')),
     status TEXT NOT NULL DEFAULT 'disponible',
     price REAL NOT NULL CHECK (price >= 0), currency TEXT NOT NULL CHECK (currency IN ('UYU','USD')),
     cost REAL, stock INTEGER NOT NULL DEFAULT 1 CHECK (stock >= 0),
     warranty_months INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
     uses TEXT NOT NULL DEFAULT '[]', favorite INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE sources (
     id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT, retrieved_at TEXT,
     UNIQUE(name, url, retrieved_at));
   CREATE TABLE specs (
     id INTEGER PRIMARY KEY, model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
     grp TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, highlight INTEGER NOT NULL DEFAULT 0,
     source_id INTEGER REFERENCES sources(id), position INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE photos (
     id INTEGER PRIMARY KEY, model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
     product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
     file TEXT NOT NULL, license TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  // v2: benchmarks (AnTuTu) por modelo. Puntajes solo comparables dentro de la misma versión.
  `CREATE TABLE benchmarks (
     id INTEGER PRIMARY KEY, model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
     kind TEXT NOT NULL DEFAULT 'antutu', version TEXT NOT NULL, platform TEXT NOT NULL,
     total INTEGER NOT NULL CHECK (total > 0), cpu INTEGER, gpu INTEGER, mem INTEGER, ux INTEGER,
     variant TEXT, source_name TEXT NOT NULL, source_url TEXT, measured_at TEXT NOT NULL,
     notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE(model_id, kind, version));`,
  // v3: productos sincronizados desde el catálogo de Google Drive.
  `ALTER TABLE products ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
   ALTER TABLE products ADD COLUMN external_key TEXT;
   ALTER TABLE products ADD COLUMN availability TEXT NOT NULL DEFAULT '';
   ALTER TABLE products ADD COLUMN stock_known INTEGER NOT NULL DEFAULT 1;
   CREATE UNIQUE INDEX ux_products_external ON products(external_key) WHERE external_key IS NOT NULL;`,
  // v4: productos cargados a mano y guardados en el repo de datos de GitHub; se retira el catálogo de Drive.
  `ALTER TABLE products ADD COLUMN repo_id TEXT;
   ALTER TABLE products ADD COLUMN description TEXT NOT NULL DEFAULT '';
   CREATE UNIQUE INDEX ux_products_repo ON products(repo_id) WHERE repo_id IS NOT NULL;
   CREATE TABLE repo_outbox (id INTEGER PRIMARY KEY, path TEXT NOT NULL, op TEXT NOT NULL CHECK (op IN ('put','delete')),
     content TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE repo_files (path TEXT PRIMARY KEY, sha TEXT NOT NULL);
   DELETE FROM products WHERE source = 'drive';
   DELETE FROM variants WHERE id NOT IN (SELECT variant_id FROM products);
   DELETE FROM settings WHERE key = 'catalogSyncStatus';`,
  // v5: se eliminan los registros DEMO de ejemplo (pedido del usuario).
  `DELETE FROM photos WHERE product_id IN (SELECT id FROM products WHERE is_demo = 1);
   DELETE FROM products WHERE is_demo = 1;
   DELETE FROM variants WHERE is_demo = 1 AND id NOT IN (SELECT variant_id FROM products);
   DELETE FROM specs WHERE model_id IN (SELECT id FROM models WHERE is_demo = 1 AND id NOT IN (SELECT model_id FROM variants));
   DELETE FROM benchmarks WHERE model_id IN (SELECT id FROM models WHERE is_demo = 1 AND id NOT IN (SELECT model_id FROM variants));
   DELETE FROM photos WHERE model_id IN (SELECT id FROM models WHERE is_demo = 1 AND id NOT IN (SELECT model_id FROM variants));
   DELETE FROM models WHERE is_demo = 1 AND id NOT IN (SELECT model_id FROM variants);
   DELETE FROM brands WHERE is_demo = 1 AND id NOT IN (SELECT brand_id FROM models);
   DELETE FROM settings WHERE key IN ('showDemo', 'demoSeeded');`,
  // v6: fichas verificadas campo por campo (estado, nota, fuentes extra) y AnTuTu promedio/individual.
  `ALTER TABLE specs ADD COLUMN status TEXT NOT NULL DEFAULT 'sin_confirmar';
   ALTER TABLE specs ADD COLUMN note TEXT;
   ALTER TABLE specs ADD COLUMN extra_sources TEXT;
   ALTER TABLE benchmarks ADD COLUMN sample TEXT;
   ALTER TABLE models ADD COLUMN ficha_id TEXT;
   ALTER TABLE models ADD COLUMN ficha_rev TEXT;`,
  // v7: portada oficial vinculada al ID de cada modelo (clave de data/covers.json).
  `ALTER TABLE models ADD COLUMN cover_key TEXT;`,
  // v8: «Pendientes del local» (notas de tareas del personal; se comparten por el repo de datos como tasks/<id>.json).
  `CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
     done INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT);`,
  // v9: portadas encontradas desde la app («Buscar imagen») y sus búsquedas en segundo plano.
  `CREATE TABLE covers_custom (key TEXT PRIMARY KEY, brand TEXT NOT NULL, model TEXT NOT NULL, url TEXT NOT NULL,
     page TEXT, source TEXT, saved_at TEXT NOT NULL);
   CREATE TABLE cover_jobs (id TEXT PRIMARY KEY, key TEXT NOT NULL, brand TEXT NOT NULL, model TEXT NOT NULL,
     product_repo_id TEXT, status TEXT NOT NULL, message TEXT, candidates TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX ix_cover_jobs_key ON cover_jobs(key, status);`,
  // v10: Diagnóstico de iPhone (Windows + Safari por QR). Solo local: no se sube al repo de datos.
  `CREATE TABLE diagnostics (id TEXT PRIMARY KEY, ref TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
     closed_at TEXT, created_by TEXT, device TEXT NOT NULL DEFAULT '{}', udid_hash TEXT, usb_state TEXT, observations TEXT NOT NULL DEFAULT '',
     verdict TEXT, requests TEXT NOT NULL DEFAULT '[]');
   CREATE TABLE diag_results (id INTEGER PRIMARY KEY AUTOINCREMENT, diag_id TEXT NOT NULL REFERENCES diagnostics(id) ON DELETE CASCADE,
     test TEXT NOT NULL, status TEXT NOT NULL, origin TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', data TEXT, created_at TEXT NOT NULL,
     created_by TEXT, nonce TEXT, UNIQUE (diag_id, nonce));
   CREATE INDEX ix_diag_results ON diag_results(diag_id, test, id);
   CREATE TABLE diag_links (id TEXT PRIMARY KEY, diag_id TEXT NOT NULL REFERENCES diagnostics(id) ON DELETE CASCADE, kind TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE, state TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT,
     code TEXT, phone_info TEXT, last_seen TEXT);`,
  // v11: se quitó Diagnóstico (pedido del usuario): se borran los diagnósticos guardados (tenían serie e IMEI) y su configuración.
  `DROP TABLE IF EXISTS diag_results; DROP TABLE IF EXISTS diag_links; DROP TABLE IF EXISTS diagnostics;
   DELETE FROM settings WHERE key IN ('diagLan');`,
];

function migrate(db: Db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get();
  let v: number = row ? Number(row.v) : 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  for (; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.prepare('UPDATE schema_version SET v = ?').run(v + 1);
    });
  }
}
