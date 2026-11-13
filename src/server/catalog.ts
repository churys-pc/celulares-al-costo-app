// Repositorio del catálogo: validación + SQL. Sin lógica de UI.
import type { Db } from './db.ts';
import { tx } from './db.ts';
import {
  ANTUTU_VERSIONS, PLATFORMS, type Benchmark, type CompareModel,
  type Stats, CONDITIONS, CURRENCIES, PRODUCT_STATUS, SPEC_GROUPS, SPEC_STATUSES, USES, ValidationError,
  type Brand, type CatalogExport, type PhoneModel, type Product, type ProductDetail,
  type ProductFilter, type ProductInput, type Spec,
} from '../shared/types.ts';

const text = (v: unknown, field: string, max = 120, required = false): string | null => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(`Falta ${field}`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new ValidationError(`${field} inválido`);
  // Quita caracteres de control; React escapa HTML al renderizar.
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (required && !s) throw new ValidationError(`Falta ${field}`);
  if (s.length > max) throw new ValidationError(`${field} supera ${max} caracteres`);
  return s || null;
};
const num = (v: unknown, field: string, opts: { int?: boolean; min?: number; max?: number } = {}): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} debe ser numérico`);
  if (opts.int && !Number.isInteger(n)) throw new ValidationError(`${field} debe ser entero`);
  if (opts.min !== undefined && n < opts.min) throw new ValidationError(`${field} debe ser ≥ ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new ValidationError(`${field} debe ser ≤ ${opts.max}`);
  return n;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], field: string, def?: T): T => {
  if ((v === undefined || v === null || v === '') && def) return def;
  if (!list.includes(v as T)) throw new ValidationError(`${field} inválido`);
  return v as T;
};
const isoDate = (v: unknown, field: string): string | null => {
  const s = text(v, field, 10);
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`${field} debe ser AAAA-MM-DD`);
  return s;
};
const url = (v: unknown, field: string): string | null => {
  const s = text(v, field, 500);
  if (s && !/^https?:\/\//i.test(s)) throw new ValidationError(`${field} debe empezar con http(s)://`);
  return s;
};

export function validateProduct(i: any): Required<Omit<ProductInput, 'releaseYear'>> & { releaseYear: number | null } {
  if (!i || typeof i !== 'object') throw new ValidationError('Datos inválidos');
  const uses = Array.isArray(i.uses) ? i.uses : [];
  return {
    brand: text(i.brand, 'marca', 60, true)!,
    model: text(i.model, 'modelo', 80, true)!,
    releaseYear: num(i.releaseYear, 'año', { int: true, min: 2000, max: 2100 }),
    storageGb: num(i.storageGb, 'almacenamiento', { int: true, min: 1, max: 16384 }),
    ramGb: num(i.ramGb, 'RAM', { int: true, min: 1, max: 64 }),
    region: text(i.region, 'región', 40),
    color: text(i.color, 'color', 40),
    condition: oneOf(i.condition, CONDITIONS, 'condición'),
    status: oneOf(i.status, PRODUCT_STATUS, 'estado', 'disponible'),
    price: num(i.price, 'precio', { min: 0, max: 1e9 }) ?? (() => { throw new ValidationError('Falta precio'); })(),
    currency: oneOf(i.currency, CURRENCIES, 'moneda'),
    cost: num(i.cost, 'costo', { min: 0, max: 1e9 }),
    stock: num(i.stock, 'stock', { int: true, min: 0, max: 100000 }) ?? 1,
    warrantyMonths: num(i.warrantyMonths, 'garantía', { int: true, min: 0, max: 120 }) ?? 0,
    notes: text(i.notes, 'notas', 2000) ?? '',
    uses: [...new Set(uses.map((u: unknown) => oneOf(u, USES, 'uso')))] as ProductInput['uses'] & {},
    favorite: Boolean(i.favorite),
  };
}

export function validateSpecs(list: unknown): Spec[] {
  if (!Array.isArray(list)) throw new ValidationError('specs debe ser una lista');
  if (list.length > 300) throw new ValidationError('Demasiadas especificaciones');
  return list.map((s: any) => ({
    group: oneOf(s?.group, SPEC_GROUPS, 'grupo de especificación', 'Otros'),
    key: text(s?.key, 'nombre de especificación', 80, true)!,
    value: text(s?.value, 'valor de especificación', 500, true)!,
    highlight: Boolean(s?.highlight),
    sourceName: text(s?.sourceName, 'fuente', 120),
    sourceUrl: url(s?.sourceUrl, 'URL de fuente'),
    sourceDate: isoDate(s?.sourceDate, 'fecha de fuente'),
    status: SPEC_STATUSES.includes(s?.status) ? s.status : 'sin_confirmar',
    note: text(s?.note, 'nota', 300),
    extraSources: Array.isArray(s?.extraSources) ? s.extraSources.slice(0, 6).map((x: any) => ({
      name: text(x?.name, 'fuente', 120, true)!, url: url(x?.url, 'URL de fuente'), date: isoDate(x?.date, 'fecha de fuente') })) : [],
  }));
}

const PRODUCT_SELECT = `
  SELECT p.id, p.condition, p.status, p.price, p.currency, p.cost, p.stock, p.warranty_months,
         p.notes, p.uses, p.favorite, p.is_demo, p.created_at, p.updated_at, p.source, p.availability, p.stock_known, p.repo_id, p.description,
         v.id AS variant_id, v.storage_gb, v.ram_gb, v.region, v.color,
         m.id AS model_id, m.name AS model, b.id AS brand_id, b.name AS brand,
         (SELECT ph.id FROM photos ph WHERE ph.product_id = p.id ORDER BY ph.position, ph.id LIMIT 1) AS photo_id,
         (SELECT json_group_array(json_object('group', grp, 'key', key, 'value', value)) FROM
           (SELECT grp, key, value FROM specs WHERE model_id = m.id AND highlight = 1 ORDER BY position, id LIMIT 4)) AS hl
  FROM products p JOIN variants v ON v.id = p.variant_id
  JOIN models m ON m.id = v.model_id JOIN brands b ON b.id = m.brand_id`;

const mapProduct = (r: any): Product => ({
  id: Number(r.id), brandId: Number(r.brand_id), brand: r.brand, modelId: Number(r.model_id), model: r.model,
  variantId: Number(r.variant_id), storageGb: r.storage_gb ?? null, ramGb: r.ram_gb ?? null,
  region: r.region ?? null, color: r.color ?? null, condition: r.condition, status: r.status,
  price: Number(r.price), currency: r.currency, cost: r.cost ?? null, stock: Number(r.stock),
  warrantyMonths: Number(r.warranty_months), notes: r.notes, uses: JSON.parse(r.uses),
  favorite: !!r.favorite, isDemo: !!r.is_demo, source: r.source ?? 'manual', repoId: r.repo_id ?? null, description: r.description ?? '', availability: r.availability ?? '', stockKnown: r.stock_known !== 0,
  photoUrl: r.photo_id ? `/api/photos/${r.photo_id}` : null, highlights: r.hl ? JSON.parse(r.hl) : [],
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const int = (v: unknown, field: string) => num(v, field, { int: true, min: 1, max: 100_000_000 });

export function validateBenchmark(modelId: number, b: any): Omit<Benchmark, 'id'> {
  if (!b || typeof b !== 'object') throw new ValidationError('Datos inválidos');
  const total = int(b.total, 'puntaje total');
  if (!total) throw new ValidationError('Falta el puntaje total de AnTuTu');
  const measuredAt = isoDate(b.measuredAt, 'fecha');
  if (!measuredAt) throw new ValidationError('Falta la fecha de la medición o de la consulta');
  return {
    modelId, total, measuredAt,
    version: oneOf(b.version, ANTUTU_VERSIONS, 'versión de AnTuTu'),
    platform: oneOf(b.platform, PLATFORMS, 'plataforma'),
    cpu: int(b.cpu, 'CPU'), gpu: int(b.gpu, 'GPU'), mem: int(b.mem, 'MEM'), ux: int(b.ux, 'UX'),
    variant: text(b.variant, 'variante', 60),
    sourceName: text(b.sourceName, 'fuente', 120, true)!,
    sourceUrl: url(b.sourceUrl, 'URL de la fuente'),
    notes: text(b.notes, 'notas', 500) ?? '',
    sample: b.sample === 'promedio' || b.sample === 'individual' ? b.sample : null,
  };
}

const mapBench = (r: any): Benchmark => ({
  id: Number(r.id), modelId: Number(r.model_id), version: r.version, platform: r.platform, total: Number(r.total),
  cpu: r.cpu ?? null, gpu: r.gpu ?? null, mem: r.mem ?? null, ux: r.ux ?? null, variant: r.variant ?? null,
  sourceName: r.source_name, sourceUrl: r.source_url ?? null, measuredAt: r.measured_at, notes: r.notes, sample: r.sample ?? null,
});

export class CatalogRepo {
  constructor(private db: Db) {}

  listBrands(): Brand[] {
    return this.db.prepare('SELECT id, name, is_demo FROM brands ORDER BY name').all()
      .map((r) => ({ id: Number(r.id), name: r.name, isDemo: !!r.is_demo }));
  }

  listModels(brandId?: number): PhoneModel[] {
    const rows = brandId
      ? this.db.prepare('SELECT * FROM models WHERE brand_id = ? ORDER BY name').all(brandId)
      : this.db.prepare('SELECT * FROM models ORDER BY name').all();
    return rows.map((r) => ({ id: Number(r.id), brandId: Number(r.brand_id), name: r.name,
      releaseYear: r.release_year ?? null, isDemo: !!r.is_demo }));
  }

  listProducts(f: ProductFilter = {}): Product[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.q) {
      const q = `%${String(f.q).slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`;
      where.push(`(b.name || ' ' || m.name || ' ' || IFNULL(v.color,'') || ' ' || IFNULL(v.storage_gb,'')) LIKE ? ESCAPE '\\'`);
      params.push(q);
    }
    if (f.condition) { where.push('p.condition = ?'); params.push(oneOf(f.condition, CONDITIONS, 'condición')); }
    if (f.brandId) { where.push('b.id = ?'); params.push(Number(f.brandId)); }
    if (f.use) { where.push(`EXISTS (SELECT 1 FROM json_each(p.uses) WHERE value = ?)`); params.push(oneOf(f.use, USES, 'uso')); }
    if (f.favorite) where.push('p.favorite = 1');
    if (f.includeDemo === false) where.push('p.is_demo = 0');
    const sql = `${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.is_demo, p.favorite DESC, b.name, m.name, v.storage_gb`;
    return this.db.prepare(sql).all(...params).map(mapProduct);
  }

  getProduct(id: number): ProductDetail | null {
    const r = this.db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);
    if (!r) return null;
    const p = mapProduct(r);
    const photos = this.db.prepare('SELECT id, license FROM photos WHERE product_id = ? ORDER BY position, id').all(id)
      .map((x) => ({ id: Number(x.id), url: `/api/photos/${x.id}`, license: x.license }));
    return { ...p, specs: this.getSpecs(p.modelId), photos, benchmarks: this.listBenchmarks(p.modelId) };
  }

  /** Uso interno (sincronización): crea/reutiliza marca, modelo y variante. */
  variantFor(i: ReturnType<typeof validateProduct>): number { return this.upsertChain(i, false); }

  private upsertChain(i: ReturnType<typeof validateProduct>, demo: boolean): number {
    const d = demo ? 1 : 0;
    this.db.prepare('INSERT INTO brands (name, is_demo) VALUES (?, ?) ON CONFLICT(name) DO NOTHING').run(i.brand, d);
    const brandId = this.db.prepare('SELECT id FROM brands WHERE name = ?').get(i.brand).id;
    this.db.prepare(`INSERT INTO models (brand_id, name, release_year, is_demo) VALUES (?, ?, ?, ?)
      ON CONFLICT(brand_id, name) DO UPDATE SET release_year = IFNULL(excluded.release_year, release_year)`)
      .run(brandId, i.model, i.releaseYear, d);
    const modelId = this.db.prepare('SELECT id FROM models WHERE brand_id = ? AND name = ?').get(brandId, i.model).id;
    const findVariant = () => this.db.prepare(`SELECT id FROM variants WHERE model_id = ?
      AND IFNULL(storage_gb,-1) = IFNULL(?,-1) AND IFNULL(ram_gb,-1) = IFNULL(?,-1)
      AND IFNULL(region,'') = IFNULL(?,'') AND IFNULL(color,'') = IFNULL(?,'')`)
      .get(modelId, i.storageGb, i.ramGb, i.region, i.color);
    let v = findVariant();
    if (!v) {
      this.db.prepare('INSERT INTO variants (model_id, storage_gb, ram_gb, region, color, is_demo) VALUES (?,?,?,?,?,?)')
        .run(modelId, i.storageGb, i.ramGb, i.region, i.color, d);
      v = findVariant();
    }
    return Number(v.id);
  }

  createProduct(input: unknown, opts: { demo?: boolean } = {}): ProductDetail {
    const i = validateProduct(input);
    const id = tx(this.db, () => {
      const variantId = this.upsertChain(i, !!opts.demo);
      const r = this.db.prepare(`INSERT INTO products (variant_id, condition, status, price, currency, cost, stock,
        warranty_months, notes, uses, favorite, is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(variantId, i.condition, i.status, i.price, i.currency, i.cost, i.stock, i.warrantyMonths,
          i.notes, JSON.stringify(i.uses), i.favorite ? 1 : 0, opts.demo ? 1 : 0);
      return Number(r.lastInsertRowid);
    });
    return this.getProduct(id)!;
  }

  updateProduct(id: number, input: unknown): ProductDetail {
    const existing = this.getProduct(id);
    if (!existing) throw new ValidationError('Producto inexistente');
    const i = validateProduct(input);
    tx(this.db, () => {
      const variantId = this.upsertChain(i, existing.isDemo);
      this.db.prepare(`UPDATE products SET variant_id=?, condition=?, status=?, price=?, currency=?, cost=?, stock=?,
        warranty_months=?, notes=?, uses=?, favorite=?, updated_at=datetime('now') WHERE id=?`)
        .run(variantId, i.condition, i.status, i.price, i.currency, i.cost, i.stock, i.warrantyMonths,
          i.notes, JSON.stringify(i.uses), i.favorite ? 1 : 0, id);
      this.pruneOrphans();
    });
    return this.getProduct(id)!;
  }

  setFavorite(id: number, favorite: boolean): void {
    this.db.prepare(`UPDATE products SET favorite=?, updated_at=datetime('now') WHERE id=?`).run(favorite ? 1 : 0, id);
  }

  deleteProduct(id: number): boolean {
    return tx(this.db, () => {
      const r = this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
      this.pruneOrphans();
      return Number(r.changes) > 0;
    });
  }

  /** Borra variantes sin productos. Modelos/marcas se conservan (pueden tener fichas técnicas). */
  private pruneOrphans() {
    this.db.exec('DELETE FROM variants WHERE id NOT IN (SELECT variant_id FROM products)');
  }

  getSpecs(modelId: number): Spec[] {
    return this.db.prepare(`SELECT s.id, s.grp, s.key, s.value, s.highlight, s.status, s.note, s.extra_sources, so.name AS source_name,
        so.url AS source_url, so.retrieved_at FROM specs s LEFT JOIN sources so ON so.id = s.source_id
      WHERE s.model_id = ? ORDER BY s.position, s.id`).all(modelId)
      .map((r) => ({ id: Number(r.id), group: r.grp, key: r.key, value: r.value, highlight: !!r.highlight,
        sourceName: r.source_name ?? null, sourceUrl: r.source_url ?? null, sourceDate: r.retrieved_at ?? null,
        status: r.status ?? 'sin_confirmar', note: r.note ?? null, extraSources: r.extra_sources ? JSON.parse(r.extra_sources) : [] }));
  }

  /** Reemplaza la ficha técnica completa de un modelo. */
  setSpecs(modelId: number, list: unknown): Spec[] {
    const specs = validateSpecs(list);
    if (!this.db.prepare('SELECT 1 FROM models WHERE id = ?').get(modelId)) throw new ValidationError('Modelo inexistente');
    tx(this.db, () => this.setSpecsNoTx(modelId, specs));
    return this.getSpecs(modelId);
  }

  exportCatalog(includeDemo = false): CatalogExport {
    const products = this.listProducts({ includeDemo }).map((p) => ({
      brand: p.brand, model: p.model, storageGb: p.storageGb, ramGb: p.ramGb, region: p.region, color: p.color,
      condition: p.condition, status: p.status, price: p.price, currency: p.currency, cost: p.cost, stock: p.stock,
      warrantyMonths: p.warrantyMonths, notes: p.notes, uses: p.uses, favorite: p.favorite,
      specs: this.getSpecs(p.modelId).map(({ id: _id, ...s }) => s),
    }));
    return { format: 'celulares-catalog', version: 1, exportedAt: new Date().toISOString(), products };
  }

  /** Importa en una sola transacción: si una fila falla, no se importa nada. */
  importCatalog(data: unknown): { products: number } {
    const d = data as CatalogExport;
    if (!d || d.format !== 'celulares-catalog' || !Array.isArray(d.products)) {
      throw new ValidationError('Archivo no reconocido (se espera formato celulares-catalog)');
    }
    if (d.products.length > 5000) throw new ValidationError('Demasiados productos en un solo archivo');
    const prepared = d.products.map((p, idx) => {
      try { return { p: validateProduct(p), specs: p.specs ? validateSpecs(p.specs) : [] }; }
      catch (e) { throw new ValidationError(`Fila ${idx + 1}: ${(e as Error).message}`); }
    });
    tx(this.db, () => {
      for (const { p, specs } of prepared) {
        const variantId = this.upsertChain(p, false);
        this.db.prepare(`INSERT INTO products (variant_id, condition, status, price, currency, cost, stock,
          warranty_months, notes, uses, favorite) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(variantId, p.condition, p.status, p.price, p.currency, p.cost, p.stock, p.warrantyMonths,
            p.notes, JSON.stringify(p.uses), p.favorite ? 1 : 0);
        if (specs.length) {
          const modelId = this.db.prepare('SELECT model_id FROM variants WHERE id = ?').get(variantId).model_id;
          this.setSpecsNoTx(Number(modelId), specs);
        }
      }
    });
    return { products: prepared.length };
  }

  private setSpecsNoTx(modelId: number, specs: Spec[]) {
    this.db.prepare('DELETE FROM specs WHERE model_id = ?').run(modelId);
    specs.forEach((s, pos) => {
      let sourceId: number | null = null;
      if (s.sourceName) {
        this.db.prepare(`INSERT INTO sources (name, url, retrieved_at) VALUES (?,?,?)
          ON CONFLICT(name, url, retrieved_at) DO NOTHING`).run(s.sourceName, s.sourceUrl, s.sourceDate);
        sourceId = Number(this.db.prepare(`SELECT id FROM sources WHERE name = ? AND url IS ? AND retrieved_at IS ?`)
          .get(s.sourceName, s.sourceUrl, s.sourceDate).id);
      }
      this.db.prepare('INSERT INTO specs (model_id, grp, key, value, highlight, source_id, position, status, note, extra_sources) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(modelId, s.group, s.key, s.value, s.highlight ? 1 : 0, sourceId, pos, s.status ?? 'sin_confirmar', s.note ?? null,
          s.extraSources?.length ? JSON.stringify(s.extraSources) : null);
    });
  }

  stats(includeDemo: boolean): Stats {
    const r = this.db.prepare(`SELECT COUNT(*) n, IFNULL(SUM(stock),0) s, IFNULL(SUM(favorite),0) f FROM products
      ${includeDemo ? '' : 'WHERE is_demo = 0'}`).get();
    return { products: Number(r.n), stockTotal: Number(r.s), favorites: Number(r.f), salesToday: null, tradeInsInProgress: null };
  }

  listBenchmarks(modelId: number): Benchmark[] {
    return this.db.prepare(`SELECT * FROM benchmarks WHERE model_id = ? ORDER BY version DESC`).all(modelId).map(mapBench);
  }

  /** Alta o reemplazo del puntaje de un modelo para una versión de AnTuTu. */
  saveBenchmark(modelId: number, input: unknown): Benchmark[] {
    if (!this.db.prepare('SELECT 1 FROM models WHERE id = ?').get(modelId)) throw new ValidationError('Modelo inexistente');
    const b = validateBenchmark(modelId, input);
    this.db.prepare(`INSERT INTO benchmarks (model_id, version, platform, total, cpu, gpu, mem, ux, variant, source_name, source_url, measured_at, notes, sample)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(model_id, kind, version) DO UPDATE SET platform=excluded.platform, sample=excluded.sample,
      total=excluded.total, cpu=excluded.cpu, gpu=excluded.gpu, mem=excluded.mem, ux=excluded.ux, variant=excluded.variant,
      source_name=excluded.source_name, source_url=excluded.source_url, measured_at=excluded.measured_at, notes=excluded.notes`)
      .run(modelId, b.version, b.platform, b.total, b.cpu, b.gpu, b.mem, b.ux, b.variant, b.sourceName, b.sourceUrl, b.measuredAt, b.notes, b.sample ?? null);
    return this.listBenchmarks(modelId);
  }

  deleteBenchmark(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM benchmarks WHERE id = ?').run(id).changes) > 0;
  }

  /** Modelos disponibles para comparar (con o sin productos). */
  compareCandidates(includeDemo: boolean) {
    return this.db.prepare(`SELECT m.id, m.name, m.is_demo, b.name AS brand,
        (SELECT COUNT(*) FROM benchmarks x WHERE x.model_id = m.id) AS benches,
        (SELECT COUNT(*) FROM specs s WHERE s.model_id = m.id) AS specs
      FROM models m JOIN brands b ON b.id = m.brand_id ${includeDemo ? '' : 'WHERE m.is_demo = 0'}
      ORDER BY m.is_demo, b.name, m.name`).all()
      .map((r) => ({ modelId: Number(r.id), brand: r.brand, model: r.name, isDemo: !!r.is_demo, benches: Number(r.benches), specs: Number(r.specs) }));
  }

  compareModels(ids: number[]): CompareModel[] {
    if (ids.length < 1 || ids.length > 4) throw new ValidationError('Elegí entre 2 y 4 modelos');
    return ids.map((id) => {
      const m = this.db.prepare(`SELECT m.*, b.name AS brand FROM models m JOIN brands b ON b.id = m.brand_id WHERE m.id = ?`).get(id);
      if (!m) throw new ValidationError('Modelo inexistente');
      const price = this.db.prepare(`SELECT p.price, p.currency FROM products p JOIN variants v ON v.id = p.variant_id
        WHERE v.model_id = ? AND p.stock > 0 AND p.status = 'disponible' AND p.price > 0
        ORDER BY (p.currency = 'USD') DESC, p.price LIMIT 1`).get(id);
      const stock = this.db.prepare(`SELECT IFNULL(SUM(p.stock),0) s FROM products p JOIN variants v ON v.id = p.variant_id
        WHERE v.model_id = ? AND p.status = 'disponible'`).get(id);
      const photo = this.db.prepare(`SELECT ph.id FROM photos ph JOIN products p ON p.id = ph.product_id
        JOIN variants v ON v.id = p.variant_id WHERE v.model_id = ? ORDER BY ph.position, ph.id LIMIT 1`).get(id);
      return {
        modelId: id, brand: m.brand, model: m.name, releaseYear: m.release_year ?? null, isDemo: !!m.is_demo,
        photoUrl: photo ? `/api/photos/${photo.id}` : null, specs: this.getSpecs(id), benchmarks: this.listBenchmarks(id),
        priceFrom: price ? { price: Number(price.price), currency: price.currency } : null, stock: Number(stock.s),
      };
    });
  }

  /** true si el modelo tiene ficha verificada: las importaciones automáticas no la pisan. */
  hasFicha(modelId: number): boolean {
    return !!this.db.prepare('SELECT ficha_id FROM models WHERE id = ?').get(modelId)?.ficha_id;
  }

  /** Crea un modelo sin productos (para cargar ficha y comparar antes de tener stock). */
  createModel(input: any): { modelId: number } {
    const brand = text(input?.brand, 'marca', 60, true)!;
    const model = text(input?.model, 'modelo', 80, true)!;
    const year = num(input?.releaseYear, 'año', { int: true, min: 2000, max: 2100 });
    this.db.prepare('INSERT INTO brands (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(brand);
    const brandId = this.db.prepare('SELECT id FROM brands WHERE name = ?').get(brand).id;
    this.db.prepare(`INSERT INTO models (brand_id, name, release_year) VALUES (?,?,?) ON CONFLICT(brand_id, name) DO NOTHING`).run(brandId, model, year);
    return { modelId: Number(this.db.prepare('SELECT id FROM models WHERE brand_id = ? AND name = ?').get(brandId, model).id) };
  }


}
