// Búsqueda en línea de modelos (Nanoreview) e importación al comparador con fuente y fecha.
import type { Db } from './db.ts';
import { CatalogRepo } from './catalog.ts';
import { ANTUTU_VERSIONS, ValidationError } from '../shared/types.ts';
import { parseNanoreviewHtml, parseSearch, type LookupResult } from '../shared/nanoreview.ts';

const BASE = 'https://nanoreview.net';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CelularesAlCosto/1.0', Accept: 'text/html,application/json' };
export const LOOKUP_SOURCE = 'Nanoreview (búsqueda en línea)';

async function get(url: string): Promise<Response> {
  try { return await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new ValidationError('Sin conexión con Nanoreview. Revisá internet e intentá de nuevo.'); }
}

export async function searchOnline(q: unknown): Promise<LookupResult[]> {
  const query = String(q ?? '').trim().slice(0, 60);
  if (query.length < 2) return [];
  const res = await get(`${BASE}/api/search?q=${encodeURIComponent(query)}&limit=15`);
  if (!res.ok) throw new ValidationError(`Nanoreview respondió ${res.status}.`);
  return parseSearch(await res.json().catch(() => [])).slice(0, 8);
}

/** Descarga y lee la ficha (sin guardar). */
export async function fetchPhone(slug: string) {
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) throw new ValidationError('Modelo inválido');
  const url = `${BASE}/en/phone/${slug}`;
  const res = await get(url);
  if (!res.ok) throw new ValidationError(`No se encontró la ficha (Nanoreview ${res.status}).`);
  return { url, ...parseNanoreviewHtml(await res.text()) };
}

/** Descarga la ficha y la guarda. Solo completa lo vacío: no pisa fichas ni puntajes cargados a mano. */
export async function importOnline(db: Db, slug: unknown, as?: { brand?: string; model?: string }): Promise<{ modelId: number; name: string; specs: number; antutu: boolean }> {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{3,100}$/.test(slug)) throw new ValidationError('Modelo inválido');
  const url = `${BASE}/en/phone/${slug}`;
  const res = await get(url);
  if (!res.ok) throw new ValidationError(`No se encontró la ficha (Nanoreview ${res.status}).`);
  const p = parseNanoreviewHtml(await res.text());
  if (!p.name || !p.specs.length) throw new ValidationError('No se pudo leer la ficha (¿cambió el formato de la página?).');
  const repo = new CatalogRepo(db);
  // `as`: nombre con el que el modelo figura en el catálogo del local (para que quede vinculado a sus productos).
  const { modelId } = repo.createModel({ brand: as?.brand ?? p.brand, model: as?.model ?? p.model });
  const date = new Date().toISOString().slice(0, 10);
  let specs = 0, antutu = false;
  if (!repo.getSpecs(modelId).length) {
    repo.setSpecs(modelId, p.specs.map((s) => ({ ...s, sourceName: LOOKUP_SOURCE, sourceUrl: url, sourceDate: date })));
    specs = p.specs.length;
  }
  const a = p.antutu;
  if (a && (ANTUTU_VERSIONS as readonly string[]).includes(a.version) && !repo.listBenchmarks(modelId).some((b) => b.version === a.version)) {
    repo.saveBenchmark(modelId, { ...a, platform: p.brand.toLowerCase() === 'apple' ? 'ios' : 'android', sourceName: LOOKUP_SOURCE, sourceUrl: url,
      measuredAt: date, notes: 'Puntaje publicado por Nanoreview a partir de mediciones de usuarios; puede variar entre pruebas.' });
    antutu = true;
  }
  return { modelId, name: p.name, specs, antutu };
}

/** Base precargada: descarga en segundo plano (una vez por modelo) la lista de modelos populares y del catálogo. */
export function startPopularImport(db: Db, list: { slug: string; brand?: string; model?: string }[], log: (m: string) => void = () => {}) {
  const doneKey = (slug: string) => `nr:${slug}`;
  const isDone = (slug: string) => !!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(doneKey(slug));
  const mark = (slug: string, v: string) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(doneKey(slug), JSON.stringify(v));
  let running = false;
  const run = async () => {
    if (running) return; running = true;
    try {
      for (const it of list) {
        if (isDone(it.slug)) continue;
        try { await importOnline(db, it.slug, it.brand ? { brand: it.brand, model: it.model } : undefined); mark(it.slug, 'ok'); }
        catch (e) {
          const msg = (e as Error).message;
          if (/Sin conexión/.test(msg)) { log('base precargada: sin internet, se reintenta más tarde'); break; }
          mark(it.slug, `sin datos: ${msg.slice(0, 80)}`); // página inexistente o ilegible: no se reintenta
        }
        await new Promise((r) => setTimeout(r, 1500)); // sin apuro: no sobrecargar el sitio
      }
    } finally { running = false; }
  };
  setTimeout(run, 15_000);
  const t = setInterval(run, 60 * 60_000); t.unref?.();
}
