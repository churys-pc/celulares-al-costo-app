import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/server/db.ts';
import { CatalogRepo } from '../src/server/catalog.ts';
import { applyFichas, fichasStatus, findFicha } from '../src/server/fichas.ts';
import { applyDoc } from '../src/server/quickProducts.ts';
import { FICHAS } from '../src/server/data/fichas/index.ts';
import { SPEC_STATUSES } from '../src/shared/types.ts';

const spec = (repo: CatalogRepo, id: number, key: string) => repo.getSpecs(id).find((s) => s.key === key);

test('fichas: formato válido (fuentes existentes, estados válidos, sin campos vacíos)', () => {
  for (const f of FICHAS) {
    for (const x of f.fields) {
      assert.ok(SPEC_STATUSES.includes(x.status), `${f.id} ${x.key}: estado inválido`);
      assert.ok(x.value.trim(), `${f.id} ${x.key}: vacío`);
      assert.ok(x.sources.length && x.sources.every((s) => f.sources[s]), `${f.id} ${x.key}: fuente inexistente`);
      // Verificado = una fuente oficial o al menos dos técnicas.
      if (x.status === 'verificado') assert.ok(x.sources.some((s) => f.sources[s].kind === 'oficial') || x.sources.length >= 2, `${f.id} ${x.key}: verificado sin respaldo suficiente`);
    }
  }
});

test('fichas: iPhone, par 4G/5G y modelo sin stock usan la misma ficha en catálogo y comparador', () => {
  const db = openDb(':memory:'); const repo = new CatalogRepo(db);
  applyFichas(db);
  const id = (m: string) => repo.compareCandidates(false).find((c) => c.model === m)!.modelId;
  const [cmp] = repo.compareModels([id('iPhone 11')]);
  assert.equal(spec(repo, id('iPhone 11'), 'Batería')!.status, 'verificado');
  assert.equal(spec(repo, id('iPhone 11'), '5G')!.status, 'no_compatible');
  assert.deepEqual(cmp.specs, repo.getSpecs(id('iPhone 11'))); // misma fuente para ficha y comparador
  assert.equal(repo.listBenchmarks(id('iPhone 11'))[0].sample, 'individual');
  // Nombres parecidos: cada variante tiene su propia ficha.
  assert.match(spec(repo, id('Galaxy A16'), 'Procesador')!.value, /^MediaTek Helio G99/);
  assert.equal(spec(repo, id('Galaxy A16 5G'), 'Procesador')!.status, 'depende_variante');
  assert.equal(findFicha('Samsung', 'Galaxy A16 LTE')!.id, 'samsung-galaxy-a16-4g');
  // Pendiente ≠ no compatible: el A16 4G no tiene 5G (oficial) → «No compatible»; su carga inalámbrica sigue «Sin confirmar».
  assert.equal(spec(repo, id('Galaxy A16'), '5G')!.status, 'no_compatible');
  assert.equal(spec(repo, id('Galaxy A16'), 'Carga inalámbrica')!.status, 'sin_confirmar');
  assert.equal(spec(repo, id('Galaxy A16 5G'), 'Carga inalámbrica')!.status, 'no_compatible');
  const st = fichasStatus(db);
  assert.equal(st.withFicha, 4);
});

test('fichas: la sincronización de un producto no pisa la ficha verificada', () => {
  const db = openDb(':memory:'); const repo = new CatalogRepo(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-f-'));
  applyFichas(db);
  applyDoc(db, dir, { id: '20a22b0a-7403-495c-b5cf-24b1281b1e02', name: 'iPhone 11', brand: 'Apple', model: 'iPhone 11', price: 250, currency: 'USD', condition: 'nuevo',
    specs: [{ group: 'Batería y carga', key: 'Batería', value: '9999 mAh', highlight: false }], antutu: { version: 'v11', total: 1, cpu: 1, gpu: 1, mem: 1, ux: 1 },
    source: { name: 'Nanoreview', url: 'https://nanoreview.net/x', date: '2026-11-13' } } as any, null);
  const [p] = repo.listProducts();
  assert.equal(spec(repo, p.modelId, 'Batería')!.value, '3110 mAh');
  assert.equal(repo.listBenchmarks(p.modelId)[0].total, 1087108);
});
