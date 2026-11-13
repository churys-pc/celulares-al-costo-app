// Fichas técnicas verificadas campo por campo (una por variante). Son la fuente común del catálogo,
// «Ver equipo» y el comparador, y tienen prioridad sobre los datos cargados automáticamente.
// Reglas: fuente oficial de la variante exacta = verificado; si el fabricante no lo publica, dos fuentes técnicas
// independientes que coinciden. Si no, «Sin confirmar». Nunca se extrapola de otro modelo.
import type { Db } from './db.ts';
import { CatalogRepo } from './catalog.ts';
import { tx } from './db.ts';
import { FICHAS } from './data/fichas/index.ts';
import type { SpecStatus } from '../shared/types.ts';

export interface FichaSource { name: string; url: string; date: string; kind: 'oficial' | 'tecnica' }
export interface FichaField { group: string; key: string; value: string; status: SpecStatus; sources: string[]; note?: string; highlight?: boolean }
export interface Ficha {
  id: string; brand: string; model: string; aliases?: string[];
  /** Variante revisada (códigos de modelo, región) y qué la distingue. */
  variant: string;
  reviewedAt: string;
  sources: Record<string, FichaSource>;
  fields: FichaField[];
  antutu?: { version: 'v11' | 'v10' | 'v12'; total: number; cpu?: number; gpu?: number; mem?: number; ux?: number; sample: 'promedio' | 'individual' | null; source: string; note?: string };
  /** Datos prioritarios que siguen sin confirmar y por qué. */
  pending: { key: string; why: string }[];
}

const HIGHLIGHT = new Set(['Procesador', 'Tamaño y tipo', 'Cámara principal', 'Almacenamiento']);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function findFicha(brand: string, model: string): Ficha | undefined {
  return FICHAS.find((f) => norm(f.brand) === norm(brand) && [f.model, ...(f.aliases ?? [])].some((n) => norm(n) === norm(model)));
}

function write(db: Db, modelId: number, f: Ficha) {
  const repo = new CatalogRepo(db);
  const src = (id: string) => { const s = f.sources[id]; if (!s) throw new Error(`Ficha ${f.id}: fuente ${id} inexistente`); return s; };
  tx(db, () => {
    repo.setSpecs(modelId, f.fields.map((x) => {
      const [first, ...rest] = x.sources.map(src);
      return { group: x.group, key: x.key, value: x.value, highlight: x.highlight ?? HIGHLIGHT.has(x.key), status: x.status, note: x.note ?? null,
        sourceName: first?.name ?? null, sourceUrl: first?.url ?? null, sourceDate: first?.date ?? null,
        extraSources: rest.map((s) => ({ name: s.name, url: s.url, date: s.date })) };
    }));
    if (f.antutu) {
      const s = src(f.antutu.source);
      // Reemplaza cualquier puntaje de esa versión cargado antes desde una fuente sin revisar.
      repo.saveBenchmark(modelId, { ...f.antutu, platform: /apple/i.test(f.brand) ? 'ios' : 'android', sourceName: s.name, sourceUrl: s.url,
        measuredAt: s.date, notes: f.antutu.note ?? (f.antutu.sample === 'promedio' ? 'Promedio publicado por la fuente.' : 'Medición individual publicada por la fuente.') });
    }
    db.prepare('UPDATE models SET ficha_id = ?, ficha_rev = ? WHERE id = ?').run(f.id, f.reviewedAt, modelId);
  });
}

/** Aplica la ficha verificada a un modelo si existe una para esa marca y modelo. Devuelve true si el modelo tiene ficha. */
export function applyFichaFor(db: Db, modelId: number, brand: string, model: string): boolean {
  const f = findFicha(brand, model);
  if (!f) return false;
  const cur = db.prepare('SELECT ficha_id, ficha_rev FROM models WHERE id = ?').get(modelId);
  if (cur?.ficha_id !== f.id || cur?.ficha_rev !== f.reviewedAt) write(db, modelId, f);
  return true;
}

/** Al arrancar: crea los modelos de las fichas (para compararlos aunque no haya stock) y las aplica a todos sus nombres. */
export function applyFichas(db: Db): number {
  const repo = new CatalogRepo(db);
  let n = 0;
  for (const f of FICHAS) {
    repo.createModel({ brand: f.brand, model: f.model });
    for (const name of [f.model, ...(f.aliases ?? [])]) {
      const row = db.prepare(`SELECT m.id FROM models m JOIN brands b ON b.id = m.brand_id WHERE b.name = ? COLLATE NOCASE AND m.name = ? COLLATE NOCASE`).get(f.brand, name);
      if (row && applyFichaFor(db, Number(row.id), f.brand, name)) n++;
    }
  }
  return n;
}

/** Estado para Ajustes: qué modelos tienen ficha verificada y cuáles siguen pendientes (primero los que están en stock). */
export function fichasStatus(db: Db) {
  const rows = db.prepare(`SELECT m.id, m.name, b.name AS brand, m.ficha_id,
      (SELECT COUNT(*) FROM products p JOIN variants v ON v.id = p.variant_id WHERE v.model_id = m.id AND p.stock > 0) AS stock,
      (SELECT COUNT(*) FROM specs s WHERE s.model_id = m.id) AS specs,
      (SELECT COUNT(*) FROM specs s WHERE s.model_id = m.id AND s.status = 'verificado') AS verified
    FROM models m JOIN brands b ON b.id = m.brand_id WHERE m.is_demo = 0 ORDER BY stock DESC, b.name, m.name`).all();
  const items = rows.map((r) => {
    const f = r.ficha_id ? FICHAS.find((x) => x.id === r.ficha_id) : undefined;
    return { modelId: Number(r.id), brand: r.brand, model: r.name, inStock: Number(r.stock) > 0, specs: Number(r.specs), verified: Number(r.verified),
      ficha: f ? { id: f.id, variant: f.variant, reviewedAt: f.reviewedAt, pending: f.pending } : null };
  });
  return { total: items.length, withFicha: items.filter((i) => i.ficha).length, items };
}
