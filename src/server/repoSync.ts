// Sincronización del catálogo con un repo privado de GitHub (un JSON por producto + su foto).
// Cada PC trabaja con su SQLite local; los cambios se encolan (repo_outbox) y se suben/bajan cada 30 s.
import type { Db } from './db.ts';
import { tx } from './db.ts';
import { getSettings } from './settings.ts';
import { ValidationError } from '../shared/types.ts';

export interface RepoStatus { ok: boolean; at: string | null; message: string; pending: number; repo: string; hasToken: boolean; builtin: boolean }
export interface Secret { encrypt(s: string): string; decrypt(s: string): string }
const PLAIN: Secret = { encrypt: (s) => s, decrypt: (s) => s };
export const DEFAULT_REPO = 'churys-pc/celulares-al-costo-datos';
export const PRODUCTS_DIR = 'catalog/products/';
export const PHOTOS_DIR = 'catalog/photos/';

const kv = (db: Db, key: string) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value as string | undefined;
const setKv = (db: Db, key: string, value: string) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

/** Clave incluida en la app al compilar (secreto DATA_REPO_TOKEN del workflow), levemente ofuscada. Vacía en desarrollo. */
export function builtinToken(): string | null {
  const enc = process.env.CEL_BUILTIN_REPO_TOKEN ?? '';
  if (!enc) return null;
  const b = Buffer.from(enc, 'base64');
  const k = Buffer.from('celulares-al-costo');
  const t = Buffer.from(b.map((x, i) => x ^ k[i % k.length])).toString('utf8');
  return /^(github_pat_|ghp_)/.test(t) ? t : null;
}

export function repoConfig(db: Db, secret: Secret = PLAIN) {
  const repo = kv(db, 'repoName') ? JSON.parse(kv(db, 'repoName')!) : DEFAULT_REPO;
  const enc = kv(db, 'repoToken');
  let token: string | null = null;
  try { token = enc ? secret.decrypt(JSON.parse(enc)) : null; } catch { token = null; }
  // La clave pegada en esta PC tiene prioridad; si no hay, se usa la incluida en la app.
  const builtin = !token ? builtinToken() : null;
  return { repo: repo as string, token: token ?? builtin, builtin: !!builtin };
}

export function setRepoConfig(db: Db, body: any, secret: Secret = PLAIN) {
  if (body?.repo !== undefined) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(String(body.repo))) throw new ValidationError('Repo inválido (formato usuario/repo)');
    setKv(db, 'repoName', JSON.stringify(String(body.repo)));
  }
  if (body?.token !== undefined) {
    const t = String(body.token).trim();
    if (t && !/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(t)) throw new ValidationError('La clave debe empezar con github_pat_');
    if (t) setKv(db, 'repoToken', JSON.stringify(secret.encrypt(t))); else db.prepare(`DELETE FROM settings WHERE key = 'repoToken'`).run();
  }
}

export function repoStatus(db: Db, secret: Secret = PLAIN): RepoStatus {
  const c = repoConfig(db, secret);
  const st = kv(db, 'repoStatus') ? JSON.parse(kv(db, 'repoStatus')!) : { ok: false, at: null, message: 'Todavía no se sincronizó.' };
  const pending = Number(db.prepare('SELECT COUNT(*) n FROM repo_outbox').get().n);
  return { ...st, pending, repo: c.repo, hasToken: !!c.token, builtin: c.builtin };
}

/** Encola un cambio para subir al repo (el último cambio de una ruta reemplaza a los anteriores). */
export function enqueue(db: Db, path: string, op: 'put' | 'delete', content?: Buffer | string) {
  db.prepare('DELETE FROM repo_outbox WHERE path = ?').run(path);
  const b64 = content === undefined ? null : Buffer.from(content).toString('base64');
  db.prepare('INSERT INTO repo_outbox (path, op, content) VALUES (?,?,?)').run(path, op, b64);
}

type Apply = (db: Db, doc: any, photo: Buffer | null) => void;
/** Archivos compartidos de configuración (cuentas, cotización). */
export const CONFIG_DIR = 'config/';
type ApplyConfig = (db: Db, path: string, text: string) => void;
type Remove = (db: Db, repoId: string) => void;

export class RepoClient {
  /** true después de la primera bajada completa del repo en esta sesión. */
  pulledOnce = false;
  constructor(private db: Db, private apply: Apply, private remove: Remove, private secret: Secret = PLAIN, private applyConfig?: ApplyConfig) {}

  private async gh(path: string, init: RequestInit = {}) {
    const { repo, token } = repoConfig(this.db, this.secret);
    if (!token) throw new ValidationError('Falta la clave de GitHub (Ajustes → Repositorio de datos).');
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
        ...init, signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'CelularesAlCosto', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) },
      });
    } catch { throw new Error('Sin conexión con GitHub.'); }
    if (res.status === 401 || res.status === 403) throw new ValidationError('GitHub rechazó la clave (¿venció o no tiene permiso Contents: Read and write?).');
    return res;
  }

  /** Sube los cambios pendientes en orden. */
  async push(): Promise<number> {
    let n = 0;
    for (const row of this.db.prepare('SELECT * FROM repo_outbox ORDER BY id').all()) {
      const cur = await this.gh(`/contents/${row.path}?ref=main`);
      const sha = cur.ok ? (await cur.json()).sha : undefined;
      if (row.op === 'delete' && !sha) { this.db.prepare('DELETE FROM repo_outbox WHERE id = ?').run(row.id); continue; }
      const res = await this.gh(`/contents/${row.path}`, {
        method: row.op === 'put' ? 'PUT' : 'DELETE',
        body: JSON.stringify({ message: `${row.op === 'put' ? 'Actualiza' : 'Elimina'} ${row.path}`, branch: 'main', ...(row.op === 'put' ? { content: row.content } : {}), ...(sha ? { sha } : {}) }),
      });
      if (!res.ok) throw new Error(`GitHub ${res.status} al ${row.op === 'put' ? 'subir' : 'borrar'} ${row.path}`);
      const body = row.op === 'put' ? await res.json() : null;
      tx(this.db, () => {
        this.db.prepare('DELETE FROM repo_outbox WHERE id = ?').run(row.id);
        if (body?.content?.sha) this.db.prepare('INSERT INTO repo_files (path, sha) VALUES (?,?) ON CONFLICT(path) DO UPDATE SET sha = excluded.sha').run(row.path, body.content.sha);
        else this.db.prepare('DELETE FROM repo_files WHERE path = ?').run(row.path);
      });
      n++;
    }
    return n;
  }

  private async blob(sha: string): Promise<Buffer> {
    const res = await this.gh(`/git/blobs/${sha}`);
    if (!res.ok) throw new Error(`GitHub ${res.status} al leer un archivo`);
    return Buffer.from((await res.json()).content, 'base64');
  }

  /** Baja lo que cambió en el repo (otras PCs). Lo pendiente de subir en esta PC tiene prioridad. */
  async pull(): Promise<number> {
    const res = await this.gh('/git/trees/main?recursive=1');
    // 404/409: repo sin archivos (todavía vacío o se borró todo) → árbol vacío, igual se procesan las bajas.
    if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error(`GitHub ${res.status} al listar el catálogo`);
    const tree: { path: string; sha: string; type: string }[] = res.ok ? (await res.json()).tree ?? [] : [];
    const remote = new Map(tree.filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]));
    const local = new Map<string, string>(this.db.prepare('SELECT path, sha FROM repo_files').all().map((r) => [r.path, r.sha]));
    const pending = new Set<string>(this.db.prepare('SELECT path FROM repo_outbox').all().map((r) => r.path));
    let n = 0;
    for (const [path, sha] of remote) {
      if (path.startsWith(CONFIG_DIR) && path.endsWith('.json') && !pending.has(path) && local.get(path) !== sha) {
        const text = (await this.blob(sha)).toString('utf8');
        tx(this.db, () => {
          try { this.applyConfig?.(this.db, path, text); } catch { /* archivo inválido: se ignora */ }
          this.db.prepare('INSERT INTO repo_files (path, sha) VALUES (?,?) ON CONFLICT(path) DO UPDATE SET sha = excluded.sha').run(path, sha);
        });
        n++; continue;
      }
      if (!path.startsWith(PRODUCTS_DIR) || !path.endsWith('.json') || pending.has(path)) continue;
      const doc = JSON.parse((await this.blob(sha)).toString('utf8'));
      const photoSha = doc.photo ? remote.get(doc.photo) : undefined;
      const needPhoto = !!photoSha && (local.get(path) !== sha || local.get(doc.photo) !== photoSha);
      if (local.get(path) === sha && !needPhoto) continue;
      const photo = needPhoto ? await this.blob(photoSha!) : null;
      tx(this.db, () => {
        this.apply(this.db, doc, photo);
        const up = this.db.prepare('INSERT INTO repo_files (path, sha) VALUES (?,?) ON CONFLICT(path) DO UPDATE SET sha = excluded.sha');
        up.run(path, sha); if (photoSha) up.run(doc.photo, photoSha);
      });
      n++;
    }
    for (const [path] of local) {
      if (path.startsWith(PRODUCTS_DIR) && !remote.has(path) && !pending.has(path)) {
        tx(this.db, () => { this.remove(this.db, path.slice(PRODUCTS_DIR.length, -5)); this.db.prepare('DELETE FROM repo_files WHERE path = ?').run(path); });
        n++;
      }
    }
    return n;
  }

  async sync(): Promise<RepoStatus> {
    try {
      if (!repoConfig(this.db, this.secret).token) throw new ValidationError('Falta la clave de GitHub (Ajustes → Repositorio de datos).');
      const up = await this.push();
      const down = await this.pull();
      this.pulledOnce = true;
      setKv(this.db, 'repoStatus', JSON.stringify({ ok: true, at: new Date().toISOString(), message: `Sincronizado (${up} subidos, ${down} recibidos).` }));
    } catch (e) {
      setKv(this.db, 'repoStatus', JSON.stringify({ ok: false, at: new Date().toISOString(), message: (e as Error).message.slice(0, 200) }));
    }
    return repoStatus(this.db, this.secret);
  }
}

export function startRepoSync(client: RepoClient, everyMs = 30_000) {
  let running: Promise<unknown> | null = null;
  const run = () => (running ??= client.sync().finally(() => { running = null; }));
  setTimeout(run, 3000);
  const t = setInterval(run, everyMs); t.unref?.();
  return { syncNow: () => run() };
}
