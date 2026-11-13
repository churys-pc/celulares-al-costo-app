// Portadas por modelo: una imagen del equipo por modelo (catálogo, ficha y comparador).
// Las portadas vienen incluidas en la app (web/covers/<clave>.webp, WebP 768 × 768 con fondo transparente),
// así se ven desde el primer inicio y sin internet. Si alguna no viniera incluida, la app baja la imagen de
// origen (solo de los sitios oficiales listados), la recorta en el navegador y la guarda en <dataDir>/covers.
// Cada modelo de la base queda vinculado a su portada por ID (models.cover_key).
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { decodeImage } from './photos.ts';
import { ValidationError } from '../shared/types.ts';
import { normalizeModelName, type CoverEntry, type CoverInfo } from '../shared/covers.ts';
import data from './data/covers.json';
import type { Db } from './db.ts';

const ENTRIES = (data as { covers: CoverEntry[] }).covers;
/** Solo se descargan imágenes de los sitios oficiales usados en covers.json. */
const ALLOWED_HOSTS = new Set(['www.apple.com', 'images.samsung.com', 'i01.appmifile.com', 'i02.appmifile.com']);
const MAX_SOURCE = 12 * 1024 * 1024;
const MAX_COVER = 3 * 1024 * 1024;
const KEY_RE = /^[a-z0-9-]{3,60}$/;

interface Meta { url: string; savedAt: string; width?: number; height?: number }

export class CoverStore {
  readonly dir: string;
  private metaPath: string;
  private meta: Record<string, Meta>;
  /** Carpeta de portadas incluidas en la app (o null). */
  private bundledDir: string | null;
  constructor(dataDir: string, private entries: CoverEntry[] = ENTRIES, webRoot?: string) {
    this.bundledDir = webRoot ? path.join(webRoot, 'covers') : null;
    this.dir = path.join(dataDir, 'covers');
    fs.mkdirSync(this.dir, { recursive: true });
    this.metaPath = path.join(this.dir, 'index.json');
    try { this.meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf8')); } catch { this.meta = {}; }
  }

  private entry(key: string): CoverEntry {
    const e = KEY_RE.test(key) ? this.entries.find((x) => x.key === key) : undefined;
    if (!e) throw new ValidationError('Portada desconocida');
    return e;
  }

  /** true si la portada guardada corresponde a la URL de origen vigente. */
  private ready(e: CoverEntry): boolean {
    return this.meta[e.key]?.url === e.url && fs.existsSync(path.join(this.dir, e.key + '.webp'));
  }

  /** Archivo incluido en la app para esa clave (o null). */
  bundled(key: string): string | null {
    if (!this.bundledDir || !KEY_RE.test(key)) return null;
    const f = path.join(this.bundledDir, key + '.webp');
    try { return fs.statSync(f).size > 0 ? f : null; } catch { return null; }
  }

  private urlFor(e: CoverEntry): string | null {
    const b = this.bundled(e.key);
    if (b) return `/covers/${e.key}.webp?v=${fs.statSync(b).size}`;
    return this.ready(e) ? `/api/covers/${e.key}.webp?v=${encodeURIComponent(this.meta[e.key].savedAt)}` : null;
  }

  list(): CoverInfo[] {
    return this.entries.map((e) => ({ key: e.key, brand: e.brand, models: e.models, page: e.page, note: e.note ?? null,
      bundled: !!this.bundled(e.key), url: this.urlFor(e) }));
  }

  /** Vincula cada modelo de la base con su portada (models.cover_key). Devuelve cuántos cambiaron. */
  assignKeys(db: Db): number {
    const rows = db.prepare('SELECT m.id, m.name, m.cover_key, b.name AS brand FROM models m JOIN brands b ON b.id = m.brand_id').all();
    const upd = db.prepare('UPDATE models SET cover_key = ? WHERE id = ?');
    let n = 0;
    for (const r of rows) {
      const k = this.keyFor(String(r.brand), String(r.name));
      if ((r.cover_key ?? null) !== k) { upd.run(k, r.id); n++; }
    }
    return n;
  }

  /** Control de cobertura: todos los modelos de la base (con o sin stock) contra sus portadas visibles. */
  coverage(db: Db) {
    this.assignKeys(db);
    const rows = db.prepare(`SELECT m.id, m.name, m.cover_key, b.name AS brand,
        (SELECT COUNT(*) FROM products p JOIN variants v ON v.id = p.variant_id WHERE v.model_id = m.id) AS products
      FROM models m JOIN brands b ON b.id = m.brand_id WHERE m.is_demo = 0 ORDER BY b.name, m.name`).all();
    const models = rows.map((r) => {
      const e = r.cover_key ? this.entries.find((x) => x.key === r.cover_key) : undefined;
      return { modelId: Number(r.id), brand: String(r.brand), model: String(r.name), coverKey: r.cover_key ?? null,
        inCatalog: Number(r.products) > 0, url: e ? this.urlFor(e) : null };
    });
    const pending = models.filter((m) => !m.url);
    return { total: models.length, withCover: models.length - pending.length, pending };
  }

  /** Clave de portada para una marca y modelo (o null si no hay portada para ese modelo). */
  keyFor(brand: string, model: string): string | null {
    const b = brand.trim().toLowerCase(), m = normalizeModelName(model);
    return this.entries.find((e) => e.brand.toLowerCase() === b && e.models.some((n) => normalizeModelName(n) === m))?.key ?? null;
  }

  file(key: string): string | null {
    const e = this.entry(key);
    return this.ready(e) ? path.join(this.dir, e.key + '.webp') : null;
  }

  /** Descarga la imagen oficial de origen para procesarla en la app. */
  fetchSource(key: string): Promise<{ mime: string; buf: Buffer }> {
    return download(this.entry(key).url, 3);
  }

  save(key: string, body: any): CoverInfo {
    const e = this.entry(key);
    const img = decodeImage(body?.dataUrl, MAX_COVER);
    if (img.mime !== 'image/webp') throw new ValidationError('La portada debe ser WebP');
    const file = path.join(this.dir, e.key + '.webp');
    fs.writeFileSync(file + '.tmp', img.buf);
    fs.renameSync(file + '.tmp', file);
    const w = Number(body?.width), h = Number(body?.height);
    this.meta[e.key] = { url: e.url, savedAt: new Date().toISOString(), ...(w > 0 && h > 0 ? { width: w, height: h } : {}) };
    fs.writeFileSync(this.metaPath + '.tmp', JSON.stringify(this.meta, null, 1));
    fs.renameSync(this.metaPath + '.tmp', this.metaPath);
    return this.list().find((x) => x.key === e.key)!;
  }
}

function download(url: string, redirects: number): Promise<{ mime: string; buf: Buffer }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) return reject(new ValidationError('Origen de imagen no permitido'));
    const req = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (CelularesAlCosto)', Accept: 'image/*' }, timeout: 20000 }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return void download(new URL(res.headers.location, u).toString(), redirects - 1).then(resolve, reject);
      }
      const mime = String(res.headers['content-type'] ?? '').split(';')[0];
      if (code !== 200 || !/^image\/(jpeg|png|webp)$/.test(mime)) { res.resume(); return reject(new Error(`El sitio oficial respondió ${code}`)); }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > MAX_SOURCE) { req.destroy(); reject(new Error('Imagen demasiado grande')); } else chunks.push(c); });
      res.on('end', () => resolve({ mime, buf: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', reject);
  });
}
