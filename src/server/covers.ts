// Portadas por modelo: una imagen oficial del fabricante por modelo (catálogo, ficha y comparador).
// La app baja la imagen de origen (solo de los sitios oficiales listados), la recorta en el navegador
// (fondo transparente, WebP) y la guarda en <dataDir>/covers/<clave>.webp. Si cambia la URL de origen en
// data/covers.json, la portada se vuelve a generar.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { decodeImage } from './photos.ts';
import { ValidationError } from '../shared/types.ts';
import { normalizeModelName, type CoverEntry, type CoverInfo } from '../shared/covers.ts';
import data from './data/covers.json';

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
  constructor(dataDir: string, private entries: CoverEntry[] = ENTRIES) {
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

  list(): CoverInfo[] {
    return this.entries.map((e) => {
      const ok = this.ready(e);
      return { key: e.key, brand: e.brand, models: e.models, page: e.page, note: e.note ?? null,
        url: ok ? `/api/covers/${e.key}.webp?v=${encodeURIComponent(this.meta[e.key].savedAt)}` : null };
    });
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
