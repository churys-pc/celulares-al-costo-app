// Fichas y AnTuTu investigados (con fuente/fecha). Solo completan lo vacío: nunca pisan lo cargado a mano.
import type { Db } from './db.ts';
import { CatalogRepo } from './catalog.ts';
import { SPEC_TEMPLATE } from '../shared/specTemplate.ts';
import apple from './data/apple.json';
import samsung from './data/samsung.json';
import xiaomi from './data/xiaomi.json';
import xiaomiNano from './data/xiaomi-nanoreview.json';
import variosNano from './data/varios-nanoreview.json';


interface Batch {
  batch: string; date: string; sourceName: string; note: string; brand?: string;
  models: { model: string; brand?: string; url: string; specs: Record<string, string>; antutu?: { total: number; cpu?: number; gpu?: number; mem?: number; ux?: number } }[];
}
const BATCHES: (Batch & { brand: string })[] = [
  { ...(apple as unknown as Batch), brand: 'Apple' },
  { ...(samsung as unknown as Batch), brand: 'Samsung' },
  { ...(xiaomi as unknown as Batch), brand: 'Xiaomi' },
  { ...(xiaomiNano as unknown as Batch), brand: 'Xiaomi' },
  { ...(variosNano as unknown as Batch), brand: 'Varios' }, // cada modelo trae su marca
];

export function applySeedData(db: Db): { models: number; specs: number; benchmarks: number } {
  const repo = new CatalogRepo(db);
  let models = 0, specs = 0, benchmarks = 0;
  for (const b of BATCHES) {
    const done = db.prepare(`SELECT 1 FROM settings WHERE key = ?`).get(`seed:${b.batch}`);
    if (done) continue;
    for (const m of b.models) {
      const { modelId } = repo.createModel({ brand: m.brand ?? b.brand, model: m.model });
      models++;
      if (!repo.getSpecs(modelId).length) {
        const list = Object.entries(m.specs).map(([key, value]) => {
          const t = SPEC_TEMPLATE.find((x) => x.key === key);
          return { group: t?.group ?? 'Otros', key, value, highlight: !!t?.highlight, sourceName: b.sourceName, sourceUrl: m.url, sourceDate: b.date };
        });
        repo.setSpecs(modelId, list); specs += list.length;
      }
      if (m.antutu && !repo.listBenchmarks(modelId).some((x) => x.version === 'v11')) {
        repo.saveBenchmark(modelId, { version: 'v11', platform: (m.brand ?? b.brand) === 'Apple' ? 'ios' : 'android', ...m.antutu,
          sourceName: b.sourceName, sourceUrl: m.url, measuredAt: b.date, notes: b.note });
        benchmarks++;
      }
    }
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, 'true')`).run(`seed:${b.batch}`);
  }
  return { models, specs, benchmarks };
}

