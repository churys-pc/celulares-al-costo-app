// Búsquedas de portada en segundo plano («Buscar imagen»). Cada búsqueda queda registrada (tabla cover_jobs) para
// que siga aunque se cierre el formulario, se cambie de pantalla o se reinicie la app. El servidor busca y descarga;
// la app quita el fondo y arma el WebP 768 × 768 (coverProcess.ts) y lo devuelve. Antes de guardar se verifica que
// la búsqueda siga vigente, que el producto exista y siga siendo el mismo modelo.
import crypto from 'node:crypto';
import type { Db } from './db.ts';
import type { CoverStore } from './covers.ts';
import { enqueue } from './repoSync.ts';
import { decodeImage } from './photos.ts';
import { CoverSearchOffline, downloadImage, searchCoverCandidates, slugKey, type CoverCandidate } from './coverSearch.ts';
import { normalizeModelName } from '../shared/covers.ts';
import { ValidationError } from '../shared/types.ts';

export const COVERS_DIR = 'covers/';
export type JobStatus = 'pending' | 'searching' | 'processing' | 'done' | 'not_found' | 'offline' | 'error' | 'cancelled' | 'discarded';
export const ACTIVE: JobStatus[] = ['pending', 'searching', 'processing'];
export interface CoverJob {
  id: string; key: string; brand: string; model: string; productRepoId: string | null;
  status: JobStatus; message: string | null; createdAt: string; updatedAt: string; candidates: number; url?: string | null;
}

const ID_RE = /^[a-f0-9-]{36}$/;
const now = () => new Date().toISOString();
const clean = (s: unknown, max = 80) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

export class CoverJobs {
  constructor(private db: Db, private covers: CoverStore, private search = searchCoverCandidates, private download = downloadImage) {}

  private row(r: any): CoverJob {
    const c = r.candidates ? JSON.parse(r.candidates) as CoverCandidate[] : [];
    return { id: r.id, key: r.key, brand: r.brand, model: r.model, productRepoId: r.product_repo_id ?? null, status: r.status,
      message: r.message ?? null, createdAt: r.created_at, updatedAt: r.updated_at, candidates: c.length,
      url: r.status === 'done' ? this.covers.urlOf(r.key) : null };
  }
  get(id: string): CoverJob & { list: CoverCandidate[] } {
    const r = ID_RE.test(id) ? this.db.prepare('SELECT * FROM cover_jobs WHERE id = ?').get(id) : undefined;
    if (!r) throw new ValidationError('La búsqueda de portada ya no existe');
    return { ...this.row(r), list: r.candidates ? JSON.parse(r.candidates) : [] };
  }
  private set(id: string, status: JobStatus, message: string | null = null, candidates?: CoverCandidate[]) {
    this.db.prepare(`UPDATE cover_jobs SET status = ?, message = ?, updated_at = ?${candidates ? ', candidates = ?' : ''} WHERE id = ?`)
      .run(...[status, message, now(), ...(candidates ? [JSON.stringify(candidates)] : []), id]);
  }

  /** Activas y las terminadas en las últimas 24 h (para mostrar el estado en la lista). */
  list(): CoverJob[] {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    return this.db.prepare(`SELECT * FROM cover_jobs WHERE status IN ('pending','searching','processing') OR updated_at > ? ORDER BY created_at DESC LIMIT 200`)
      .all(since).map((r) => this.row(r));
  }

  /** Pide la portada de un modelo: si ya hay una, la devuelve; si no, crea (o reutiliza) una búsqueda. */
  request(body: any): { status: 'exists'; key: string; url: string } | CoverJob {
    const brand = clean(body?.brand, 40), model = clean(body?.model);
    if (brand.length < 2 || model.length < 1) throw new ValidationError('Elegí el modelo antes de buscar la imagen');
    const productRepoId = typeof body?.productRepoId === 'string' && ID_RE.test(body.productRepoId) ? body.productRepoId : null;
    const existing = this.covers.keyFor(brand, model);
    const url = existing ? this.covers.urlOf(existing) : null;
    if (existing && url) return { status: 'exists', key: existing, url };
    const key = existing ?? slugKey(brand, model);
    // Sin duplicados: una sola búsqueda activa por modelo.
    const active = this.db.prepare(`SELECT * FROM cover_jobs WHERE key = ? AND status IN ('pending','searching','processing') ORDER BY created_at DESC LIMIT 1`).get(key);
    if (active) {
      if (productRepoId && !active.product_repo_id) this.db.prepare('UPDATE cover_jobs SET product_repo_id = ? WHERE id = ?').run(productRepoId, active.id);
      return this.row(this.db.prepare('SELECT * FROM cover_jobs WHERE id = ?').get(active.id));
    }
    const id = crypto.randomUUID(), t = now();
    this.db.prepare(`INSERT INTO cover_jobs (id, key, brand, model, product_repo_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, key, brand, model, productRepoId, 'pending', t, t);
    return this.get(id);
  }

  /** Vincula la búsqueda con el producto guardado o la cancela (cambio de equipo o foto manual). */
  update(id: string, body: any): CoverJob {
    const j = this.get(id);
    if (body?.productRepoId !== undefined) {
      const pid = typeof body.productRepoId === 'string' && ID_RE.test(body.productRepoId) ? body.productRepoId : null;
      this.db.prepare('UPDATE cover_jobs SET product_repo_id = ?, updated_at = ? WHERE id = ?').run(pid, now(), id);
    }
    if (body?.cancel && ACTIVE.includes(j.status)) this.set(id, 'cancelled', clean(body.reason, 120) || 'Cancelada');
    return this.get(id);
  }

  /** Foto manual elegida para un producto: sus búsquedas en curso se descartan. */
  discardForProduct(productRepoId: string) {
    this.db.prepare(`UPDATE cover_jobs SET status = 'discarded', message = 'Se eligió una foto manual', updated_at = ?
      WHERE product_repo_id = ? AND status IN ('pending','searching','processing')`).run(now(), productRepoId);
  }

  /** Paso 1 (servidor): buscar candidatos en la web. */
  async runSearch(id: string): Promise<CoverJob> {
    const j = this.get(id);
    if (!ACTIVE.includes(j.status)) return j;
    if (this.covers.urlOf(j.key)) { this.set(id, 'done', 'Ya había una portada para este modelo'); return this.get(id); }
    this.set(id, 'searching');
    try {
      const list = await this.search(j.brand, j.model);
      if (!ACTIVE.includes(this.get(id).status)) return this.get(id);
      if (!list.length) this.set(id, 'not_found', 'No encontramos una imagen para este modelo', []);
      else this.set(id, 'processing', null, list);
    } catch (e) {
      if (ACTIVE.includes(this.get(id).status)) {
        if (e instanceof CoverSearchOffline) this.set(id, 'offline', 'Sin conexión a internet: no se pudo buscar la imagen');
        else this.set(id, 'error', `No se pudo buscar la imagen (${(e as Error).message.slice(0, 80)})`);
      }
    }
    return this.get(id);
  }

  /** Paso 2 (servidor): descargar la imagen n.º i para que la app la procese. */
  async image(id: string, i: number) {
    const j = this.get(id);
    const c = j.list[i];
    if (!c || !ACTIVE.includes(j.status)) throw new ValidationError('Imagen no disponible');
    return this.download(c.url);
  }

  /** Paso 3: la app devuelve el WebP procesado. Se valida que la búsqueda siga vigente antes de guardar. */
  result(id: string, body: any): CoverJob {
    const j = this.get(id);
    if (!ACTIVE.includes(j.status)) return j; // cancelada, descartada o ya resuelta: se ignora el resultado viejo
    if (j.productRepoId) {
      const p = this.db.prepare(`SELECT b.name AS brand, m.name AS model, (SELECT COUNT(*) FROM photos ph WHERE ph.product_id = p.id) AS photos
        FROM products p JOIN variants v ON v.id = p.variant_id JOIN models m ON m.id = v.model_id JOIN brands b ON b.id = m.brand_id WHERE p.repo_id = ?`).get(j.productRepoId);
      if (!p) { this.set(id, 'discarded', 'El producto ya no existe'); return this.get(id); }
      if (String(p.brand).toLowerCase() !== j.brand.toLowerCase() || normalizeModelName(String(p.model)) !== normalizeModelName(j.model)) {
        this.set(id, 'discarded', 'El producto cambió de modelo'); return this.get(id);
      }
    }
    if (this.covers.urlOf(j.key)) { this.set(id, 'done', 'Ya había una portada para este modelo'); return this.get(id); }
    const i = Number(body?.index);
    const c = j.list[i];
    if (!c) throw new ValidationError('Resultado inválido');
    const img = decodeImage(body?.dataUrl, 3 * 1024 * 1024);
    if (img.mime !== 'image/webp') throw new ValidationError('La portada debe ser WebP');
    const savedAt = now();
    this.covers.saveCustom({ key: j.key, brand: j.brand, model: j.model, url: c.url, page: c.page, source: c.source }, img.buf, savedAt);
    // Se guarda en el repo de datos del catálogo: queda disponible en las demás PCs aunque cambie la URL de origen.
    enqueue(this.db, `${COVERS_DIR}${j.key}.json`, 'put', JSON.stringify({ key: j.key, brand: j.brand, model: j.model, url: c.url, page: c.page,
      source: c.source, savedAt, webp: img.buf.toString('base64') }));
    this.covers.assignKeys(this.db);
    this.set(id, 'done', `Portada encontrada en ${c.source}`);
    return this.get(id);
  }

  /** La app no pudo usar ningún candidato (fondo no liso, imagen rota…). */
  fail(id: string, body: any): CoverJob {
    const j = this.get(id);
    if (!ACTIVE.includes(j.status)) return j;
    const offline = body?.reason === 'offline';
    this.set(id, offline ? 'offline' : 'not_found', offline ? 'Sin conexión a internet: no se pudo descargar la imagen' : 'No encontramos una imagen para este modelo');
    return this.get(id);
  }
}

/** Portada compartida por otra PC (covers/<clave>.json en el repo de datos). */
export function applyCoverDoc(covers: CoverStore, doc: any) {
  if (!doc?.key || !doc.webp || !doc.brand || !doc.model) return;
  covers.saveCustom({ key: String(doc.key), brand: String(doc.brand), model: String(doc.model), url: String(doc.url ?? ''), page: doc.page ?? null, source: doc.source ?? null },
    Buffer.from(String(doc.webp), 'base64'), String(doc.savedAt ?? now()));
}
