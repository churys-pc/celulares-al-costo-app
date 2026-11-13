import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.ts';
import { CatalogRepo } from '../src/server/catalog.ts';
import { buildComparison } from '../src/shared/compare.ts';

const bench = { platform: 'android', sourceName: 'Medición propia en el local', measuredAt: '2026-11-12' };

function setup() {
  const repo = new CatalogRepo(openDb(':memory:'));
  const a = repo.createProduct({ brand: 'Marca', model: 'Alfa', condition: 'nuevo', price: 400, currency: 'USD', stock: 2 });
  const b = repo.createProduct({ brand: 'Marca', model: 'Beta', condition: 'nuevo', price: 600, currency: 'USD', stock: 1 });
  repo.setSpecs(a.modelId, [{ group: 'Batería y carga', key: 'Batería', value: '5000 mAh' }, { group: 'Pantalla', key: 'Frecuencia', value: '120 Hz' }]);
  repo.setSpecs(b.modelId, [{ group: 'Batería y carga', key: 'batería', value: '4.500 mAh' }, { group: 'Pantalla', key: 'Frecuencia', value: '120 Hz' }]);
  return { repo, a: a.modelId, b: b.modelId };
}

test('benchmark: valida versión, fuente y fecha; upsert por versión', () => {
  const { repo, a } = setup();
  assert.throws(() => repo.saveBenchmark(a, { ...bench, version: 'v8', total: 1 }), /versión/);
  assert.throws(() => repo.saveBenchmark(a, { ...bench, version: 'v11', total: 1, sourceName: '' }), /fuente/);
  assert.throws(() => repo.saveBenchmark(a, { ...bench, version: 'v11', total: 1, measuredAt: '' }), /fecha/);
  repo.saveBenchmark(a, { ...bench, version: 'v11', total: 1000000 });
  assert.equal(repo.saveBenchmark(a, { ...bench, version: 'v11', total: 1100000 }).length, 1);
});

test('comparación: filas alineadas, diferencias y resumen con datos reales', () => {
  const { repo, a, b } = setup();
  repo.saveBenchmark(a, { ...bench, version: 'v11', total: 1000000 });
  repo.saveBenchmark(b, { ...bench, version: 'v11', total: 1600000 });
  const c = buildComparison(repo.compareModels([a, b]), null);
  const batt = c.rows.find((r) => r.key.toLowerCase() === 'batería')!;
  assert.deepEqual(batt.values, ['5000 mAh', '4.500 mAh']);
  assert.equal(batt.differs, true);
  assert.equal(c.rows.find((r) => r.key === 'Frecuencia')!.differs, false);
  assert.equal(c.antutu.comparable, true);
  assert.equal(c.antutu.best, 1);
  assert.deepEqual(c.antutu.pct, [63, 100]);
  assert.match(c.summary.join('\n'), /cuesta 50% más .* rinde 60% más/);
  assert.match(c.summary.join('\n'), /Mayor batería .*Alfa/);
});

test('comparación: versiones distintas no se comparan; sin precio no se inventa', () => {
  const { repo, a, b } = setup();
  repo.saveBenchmark(a, { ...bench, version: 'v11', total: 1000000 });
  repo.saveBenchmark(b, { ...bench, version: 'v10', total: 900000 });
  repo.createModel({ brand: 'Marca', model: 'Gamma' });
  const g = repo.compareCandidates(true).find((m) => m.model === 'Gamma')!.modelId;
  const c = buildComparison(repo.compareModels([a, b, g]), null);
  assert.equal(c.antutu.comparable, false);
  assert.equal(c.antutu.best, null);
  assert.match(c.antutu.warnings.join(' '), /distintas versiones/);
  assert.match(c.summary.join(' '), /sin datos comparables/);
  assert.match(c.summary.join(' '), /falta precio/);
  assert.throws(() => repo.compareModels([1, 2, 3, 4, 5]), /entre 2 y 4/);
});
