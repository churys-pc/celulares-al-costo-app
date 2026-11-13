// Arranque del backend. Lo usa Electron (in-process) y también `npm run server` (solo navegador).
import path from 'node:path';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { openDb } from './db.ts';
import { CatalogRepo } from './catalog.ts';
import { createServer } from './http.ts';
import { applySeedData } from './seedData.ts';
import { applyFichas } from './fichas.ts';
import { startPopularImport } from './lookup.ts';
import { repoConfig, RepoClient, startRepoSync, type Secret } from './repoSync.ts';
import { applySharedConfig } from './sharedConfig.ts';
import { applyDoc, removeLocal } from './quickProducts.ts';
import popular from './data/popular-models.json';

export function defaultDataDir() {
  const base = process.env.APPDATA ?? path.join(os.homedir(), '.local', 'share');
  return process.env.CELULARES_DATA_DIR ?? path.join(base, 'CelularesAlCosto');
}

export async function startServer(opts: { dataDir?: string; webRoot: string; port?: number; log?: (m: string) => void; noBackgroundJobs?: boolean; secret?: Secret }) {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const db = openDb(path.join(dataDir, 'celulares.db'));
  applySeedData(db);
  // Fichas verificadas: tienen prioridad sobre los lotes y las cargas automáticas.
  applyFichas(db);
  // Catálogo compartido entre PCs: repo privado de GitHub (reemplaza la lectura de la planilla de Drive).
  const client = new RepoClient(db, (d, doc, photo) => applyDoc(d, dataDir, doc, photo), (d, id) => removeLocal(d, dataDir, id), opts.secret, applySharedConfig);
  const sync = opts.noBackgroundJobs ? { syncNow: () => client.sync() } : startRepoSync(client);
  const server = createServer(db, opts.webRoot, dataDir, { secret: opts.secret, syncNow: sync.syncNow,
    // Crear el admin solo después de bajar el repo (así no se pisa una cuenta creada en otra PC). Sin clave: modo local.
    canSetup: () => !repoConfig(db, opts.secret).token || client.pulledOnce });
  if (!opts.noBackgroundJobs) startPopularImport(db, popular.items, opts.log);
  // Solo loopback: la web móvil (Fase 3) tendrá su propio listener HTTPS con sesión QR.
  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { port, url: `http://127.0.0.1:${port}`, close: () => { server.close(); db.close(); } };
}
