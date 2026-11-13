// «Cargar productos»: nombre + precio + foto opcional → ficha y descripción automáticas → se guarda local y en el repo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.ts';
import { tx } from './db.ts';
import { CatalogRepo, validateSpecs } from './catalog.ts';
import { decodeImage } from './photos.ts';
import { fetchPhone, searchOnline, LOOKUP_SOURCE } from './lookup.ts';
import { enqueue, PHOTOS_DIR, PRODUCTS_DIR } from './repoSync.ts';
import { describe } from '../shared/describe.ts';
import { ANTUTU_VERSIONS, CONDITIONS, CURRENCIES, ValidationError, type Spec } from '../shared/types.ts';
import { splitBrand } from '../shared/nanoreview.ts';

export interface ProductDoc {
  id: string; name: string; brand: string; model: string;
  price: number; currency: 'USD' | 'UYU'; condition: 'nuevo' | 'usado';
  storageGb: number | null; ramGb: number | null; color: string | null;
  description: string; specs: Omit<Spec, 'id'>[]; antutu: { version: string; total: number; cpu: number | null; gpu: number | null; mem: number | null; ux: number | null } | null;
  source: { name: string; url: string; date: string } | null; photo: string | null; updatedAt: string;
}

/** Memoria escrita en el nombre: «8/256», «8+256», «256GB». */
export function memoryFromName(name: string): { ramGb: number | null; storageGb: number | null; clean: string } {
  const m = name.match(/(\d{1,2})\s*[/+]\s*(\d{2,4})\s*(?:gb)?/i);
  const s = !m ? name.match(/(\d{2,4})\s*gb/i) : null;
  const clean = name.replace(m?.[0] ?? s?.[0] ?? '', '').replace(/\s+/g, ' ').trim();
  return { ramGb: m ? Number(m[1]) : null, storageGb: m ? Number(m[2]) : s ? Number(s[1]) : null, clean };
}

/** Busca el equipo en internet y arma ficha + descripción para revisar antes de guardar. */
export async function preview(name: unknown, slug?: unknown) {
  const q = memoryFromName(String(name ?? '').trim().slice(0, 80)).clean;
  if (q.length < 2) throw new ValidationError('Escribí el nombre del equipo');
  const candidates = await searchOnline(q);
  const pick = typeof slug === 'string' && slug ? slug : candidates[0]?.slug;
  if (!pick) return { candidates, match: null };
  const p = await fetchPhone(pick);
  const antutu = p.antutu && (ANTUTU_VERSIONS as readonly string[]).includes(p.antutu.version) ? p.antutu : null;
  return {
    candidates,
    match: { slug: pick, name: p.name, brand: p.brand, model: p.model, url: p.url, specs: p.specs, antutu, description: describe(p.specs, antutu) },
  };
}

const PHOTO_DIR = (dataDir: string) => path.join(dataDir, 'photos');

/** Aplica un documento del repo (o recién creado) a la base local. Reemplaza ficha, AnTuTu y foto del producto. */
export function applyDoc(db: Db, dataDir: string, doc: ProductDoc, photo: Buffer | null) {
  const repo = new CatalogRepo(db);
  const input = { brand: doc.brand, model: doc.model, storageGb: doc.storageGb, ramGb: doc.ramGb, color: doc.color,
    condition: doc.condition, status: 'disponible', price: doc.price, currency: doc.currency, stock: 1, warrantyMonths: doc.condition === 'nuevo' ? 12 : 3 };
  const existing = db.prepare('SELECT id FROM products WHERE repo_id = ?').get(doc.id);
  const p = existing ? repo.updateProduct(Number(existing.id), input) : repo.createProduct(input);
  db.prepare(`UPDATE products SET repo_id = ?, description = ?, source = 'repo', notes = '' WHERE id = ?`).run(doc.id, doc.description ?? '', p.id);
  if (doc.specs?.length) repo.setSpecs(p.modelId, doc.specs.map((s) => ({ ...s, sourceName: s.sourceName ?? doc.source?.name ?? null, sourceUrl: s.sourceUrl ?? doc.source?.url ?? null, sourceDate: s.sourceDate ?? doc.source?.date ?? null })));
  if (doc.antutu && doc.source) repo.saveBenchmark(p.modelId, { ...doc.antutu, platform: doc.brand.toLowerCase() === 'apple' ? 'ios' : 'android',
    sourceName: doc.source.name, sourceUrl: doc.source.url, measuredAt: doc.source.date, notes: 'Puntaje publicado por Nanoreview a partir de mediciones de usuarios.' });
  if (photo) {
    const dir = PHOTO_DIR(dataDir); fs.mkdirSync(dir, { recursive: true });
    for (const old of db.prepare('SELECT file FROM photos WHERE product_id = ?').all(p.id)) fs.rmSync(path.join(dir, path.basename(old.file)), { force: true });
    db.prepare('DELETE FROM photos WHERE product_id = ?').run(p.id);
    const file = `${doc.id}-${crypto.randomUUID().slice(0, 8)}.jpg`;
    fs.writeFileSync(path.join(dir, file), photo);
    db.prepare(`INSERT INTO photos (product_id, file, license, position) VALUES (?, ?, 'propia', 0)`).run(p.id, file);
  }
  return p.id;
}

export function removeLocal(db: Db, dataDir: string, repoId: string) {
  const r = db.prepare('SELECT id FROM products WHERE repo_id = ?').get(repoId);
  if (!r) return;
  for (const f of db.prepare('SELECT file FROM photos WHERE product_id = ?').all(r.id)) fs.rmSync(path.join(PHOTO_DIR(dataDir), path.basename(f.file)), { force: true });
  new CatalogRepo(db).deleteProduct(Number(r.id));
}

/** Alta o edición desde la sección «Cargar productos». */
export function saveQuick(db: Db, dataDir: string, body: any): { id: string; productId: number } {
  const name = String(body?.name ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
  if (name.length < 2 || name.length > 80) throw new ValidationError('Nombre inválido');
  const price = Number(body?.price);
  if (!Number.isFinite(price) || price <= 0 || price > 1e8) throw new ValidationError('Precio inválido');
  const currency = CURRENCIES.includes(body?.currency) ? body.currency : 'USD';
  const condition = CONDITIONS.includes(body?.condition) ? body.condition : 'nuevo';
  const id = typeof body?.id === 'string' && /^[a-f0-9-]{36}$/.test(body.id) ? body.id : crypto.randomUUID();
  const mem = memoryFromName(name);
  const match = body?.match && typeof body.match === 'object' ? body.match : null;
  const fromMatch = match?.brand ? { brand: String(match.brand), model: String(match.model) } : splitBrand(mem.clean);
  const specs = match?.specs ? validateSpecs(match.specs).map(({ group, key, value, highlight }) => ({ group, key, value, highlight, sourceName: null, sourceUrl: null, sourceDate: null })) : [];
  const a = match?.antutu;
  const antutu = a && (ANTUTU_VERSIONS as readonly string[]).includes(a.version) && Number(a.total) > 0
    ? { version: a.version, total: Number(a.total), cpu: Number(a.cpu) || null, gpu: Number(a.gpu) || null, mem: Number(a.mem) || null, ux: Number(a.ux) || null } : null;
  const url = typeof match?.url === 'string' && /^https:\/\/nanoreview\.net\//.test(match.url) ? match.url : null;
  const prev = db.prepare('SELECT photos.file FROM products JOIN photos ON photos.product_id = products.id WHERE products.repo_id = ? LIMIT 1').get(id);
  const photoBuf = body?.photo ? decodeImage(body.photo).buf : null;
  const photoPath = photoBuf || (prev && body?.photo !== null) ? `${PHOTOS_DIR}${id}.jpg` : null;
  const doc: ProductDoc = {
    id, name, brand: fromMatch.brand, model: fromMatch.model, price, currency, condition,
    storageGb: Number(body?.storageGb) || mem.storageGb, ramGb: Number(body?.ramGb) || mem.ramGb, color: body?.color ? String(body.color).slice(0, 40) : null,
    description: String(body?.description ?? '').slice(0, 1500), specs, antutu,
    source: url ? { name: LOOKUP_SOURCE, url, date: new Date().toISOString().slice(0, 10) } : null,
    photo: photoPath, updatedAt: new Date().toISOString(),
  };
  const productId = tx(db, () => {
    const pid = applyDoc(db, dataDir, doc, photoBuf);
    if (body?.photo === null) db.prepare('DELETE FROM photos WHERE product_id = ?').run(pid);
    enqueue(db, `${PRODUCTS_DIR}${id}.json`, 'put', JSON.stringify(doc, null, 1));
    if (photoBuf) enqueue(db, `${PHOTOS_DIR}${id}.jpg`, 'put', photoBuf);
    if (body?.photo === null) enqueue(db, `${PHOTOS_DIR}${id}.jpg`, 'delete');
    return pid;
  });
  return { id, productId };
}

export function deleteQuick(db: Db, dataDir: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ValidationError('Producto inválido');
  tx(db, () => {
    removeLocal(db, dataDir, id);
    enqueue(db, `${PRODUCTS_DIR}${id}.json`, 'delete');
    enqueue(db, `${PHOTOS_DIR}${id}.jpg`, 'delete');
  });
}
