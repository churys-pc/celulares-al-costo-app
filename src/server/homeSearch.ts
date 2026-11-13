// Buscador de Inicio: productos del catálogo (con y sin stock) y modelos de la base que no tienen producto.
// Busca por marca, modelo, variante (RAM/almacenamiento/color/condición) y código de modelo (ej. SM-A566B).
import type { Db } from './db.ts';
import type { CatalogRepo } from './catalog.ts';
import type { Currency } from '../shared/types.ts';
import covers from './data/covers.json';

export interface SearchHit {
  type: 'product' | 'model';
  /** Producto (type = product) o null. */
  productId: number | null;
  modelId: number;
  brand: string;
  model: string;
  /** Variante legible: «8/256 GB · Negro · CPO». */
  variant: string;
  price: number | null;
  currency: Currency | null;
  available: boolean;
  /** «Disponible», «Reservado», «Sin stock»… */
  availabilityLabel: string;
  /** Disponibilidad por local tal cual el catálogo (ej. «1 PANDO - 1 BU»), si está registrada. */
  availability: string;
  coverKey: string | null;
  photoUrl: string | null;
}

export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Códigos de modelo conocidos por portada (Samsung SM-…): el código completo, sin sufijo regional y corto. */
const CODES = new Map<string, string[]>();
for (const c of (covers as any).covers as { key: string; code?: string }[]) {
  if (!c.code) continue;
  const full = c.code.toUpperCase();
  const base = full.match(/^SM-[A-Z]\d{3,4}[A-Z]?/)?.[0] ?? full;
  CODES.set(c.key, [...new Set([full, base, base.replace(/^SM-/, ''), base.replace(/[A-Z]$/, '')])]);
}

function tokens(q: string) { return fold(q).split(/[\s,;]+/).map((t) => t.replace(/gb$/, '')).filter(Boolean); }

function matches(hay: string, toks: string[]) {
  const compact = hay.replace(/[\s\-/·()]+/g, '');
  return toks.every((t) => hay.includes(t) || compact.includes(t.replace(/[\s\-/]+/g, '')));
}

export function homeSearch(db: Db, repo: CatalogRepo, q: string, limit = 8): SearchHit[] {
  const toks = tokens(String(q ?? '').slice(0, 80));
  if (!toks.length) return [];
  const hits: (SearchHit & { score: number })[] = [];
  const modelsWithProduct = new Set<number>();
  for (const p of repo.listProducts({ includeDemo: false })) {
    modelsWithProduct.add(p.modelId);
    const mem = p.ramGb && p.storageGb ? `${p.ramGb}/${p.storageGb}` : p.storageGb ? `${p.storageGb}` : '';
    const cond = p.condition === 'nuevo' ? 'Nuevo' : 'CPO';
    const codes = p.coverKey ? CODES.get(p.coverKey) ?? [] : [];
    const hay = fold([p.brand, p.model, mem, mem && `${p.storageGb}gb`, p.ramGb ? `${p.ramGb}gb ram` : '', p.color ?? '', cond, ...codes].join(' '));
    if (!matches(hay, toks)) continue;
    const available = p.status === 'disponible' && p.stock > 0;
    const label = available ? 'Disponible' : p.status === 'reservado' ? 'Reservado' : p.status === 'en_revision' ? 'En revisión' : 'Sin stock';
    hits.push({
      type: 'product', productId: p.id, modelId: p.modelId, brand: p.brand, model: p.model,
      variant: [mem && `${mem} GB`, p.color, cond].filter(Boolean).join(' · '),
      price: p.price > 0 ? p.price : null, currency: p.price > 0 ? p.currency : null,
      available, availabilityLabel: label, availability: available ? (p.availability ?? '').trim() : '',
      coverKey: p.coverKey ?? null, photoUrl: p.photoUrl, score: rank(p.brand, p.model, toks) + (available ? 100 : 0),
    });
  }
  const models = db.prepare(`SELECT m.id, m.name, m.cover_key, b.name AS brand FROM models m JOIN brands b ON b.id = m.brand_id
    WHERE m.is_demo = 0 ORDER BY b.name, m.name`).all();
  for (const m of models) {
    const id = Number(m.id);
    if (modelsWithProduct.has(id)) continue;
    const codes = m.cover_key ? CODES.get(String(m.cover_key)) ?? [] : [];
    if (!matches(fold([m.brand, m.name, ...codes].join(' ')), toks)) continue;
    hits.push({
      type: 'model', productId: null, modelId: id, brand: String(m.brand), model: String(m.name), variant: '',
      price: null, currency: null, available: false, availabilityLabel: 'Sin stock', availability: '',
      coverKey: m.cover_key ?? null, photoUrl: null, score: rank(String(m.brand), String(m.name), toks),
    });
  }
  hits.sort((a, b) => b.score - a.score || a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model, 'es', { numeric: true }) || (a.price ?? 1e9) - (b.price ?? 1e9));
  return hits.slice(0, limit).map(({ score: _s, ...h }) => h);
}

/** Más arriba cuanto más se parece el nombre a lo escrito (nombre exacto > empieza igual > contiene). */
function rank(brand: string, model: string, toks: string[]) {
  const q = toks.join(' ');
  const name = fold(model), full = fold(`${brand} ${model}`);
  if (name === q || full === q) return 50;
  if (name.startsWith(q) || full.startsWith(q)) return 30 - Math.min(20, name.length - q.length);
  return 10 - Math.min(9, name.length / 4);
}
