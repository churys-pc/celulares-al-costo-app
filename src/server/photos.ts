// Fotos de productos: archivos en <dataDir>/photos, metadatos (licencia) en SQLite.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Db } from './db.ts';
import { PHOTO_LICENSES, ValidationError, type Photo } from '../shared/types.ts';

export const MAX_PHOTOS = 5;
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': { ext: '.png', magic: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  'image/webp': { ext: '.webp', magic: (b) => b.subarray(8, 12).toString() === 'WEBP' },
};

/** Decodifica un data URL de imagen y verifica tipo real (bytes mágicos) y tamaño. */
export function decodeImage(dataUrl: unknown, maxBytes = MAX_BYTES): { mime: string; ext: string; buf: Buffer } {
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new ValidationError('Imagen inválida (se acepta JPG, PNG o WebP)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw new ValidationError(`La imagen supera ${Math.round(maxBytes / 1048576)} MB`);
  const t = TYPES[m[1]];
  if (!t.magic(buf)) throw new ValidationError('El archivo no coincide con su tipo de imagen');
  return { mime: m[1], ext: t.ext, buf };
}

export class PhotoRepo {
  private dir: string;
  constructor(private db: Db, dataDir: string) {
    this.dir = path.join(dataDir, 'photos');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  list(productId: number): Photo[] {
    return this.db.prepare('SELECT id, license FROM photos WHERE product_id = ? ORDER BY position, id').all(productId)
      .map((r) => ({ id: Number(r.id), url: `/api/photos/${r.id}`, license: r.license }));
  }

  add(productId: number, body: any): Photo[] {
    if (!this.db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw new ValidationError('Producto inexistente');
    if (!PHOTO_LICENSES.includes(body?.license)) throw new ValidationError('Indicá el origen/derechos de la foto');
    const n = Number(this.db.prepare('SELECT COUNT(*) c FROM photos WHERE product_id = ?').get(productId).c);
    if (n >= MAX_PHOTOS) throw new ValidationError(`Máximo ${MAX_PHOTOS} fotos por producto`);
    const img = decodeImage(body?.dataUrl);
    const file = crypto.randomUUID() + img.ext;
    fs.writeFileSync(path.join(this.dir, file), img.buf);
    this.db.prepare('INSERT INTO photos (product_id, file, license, position) VALUES (?,?,?,?)').run(productId, file, body.license, n);
    return this.list(productId);
  }

  remove(id: number): boolean {
    const r = this.db.prepare('SELECT file FROM photos WHERE id = ?').get(id);
    if (!r) return false;
    this.db.prepare('DELETE FROM photos WHERE id = ?').run(id);
    fs.rmSync(path.join(this.dir, path.basename(r.file)), { force: true });
    return true;
  }

  /** Borra archivos de fotos de un producto (antes de eliminarlo). */
  removeForProduct(productId: number) {
    for (const p of this.list(productId)) this.remove(p.id);
  }

  file(id: number): { path: string; mime: string } | null {
    const r = this.db.prepare('SELECT file FROM photos WHERE id = ?').get(id);
    if (!r) return null;
    const f = path.join(this.dir, path.basename(r.file));
    const mime = Object.entries(TYPES).find(([, t]) => f.endsWith(t.ext))?.[0] ?? 'application/octet-stream';
    return fs.existsSync(f) ? { path: f, mime } : null;
  }
}
