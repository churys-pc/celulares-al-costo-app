import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/server/db.ts';
import { CatalogRepo } from '../src/server/catalog.ts';
import { applyFichas } from '../src/server/fichas.ts';
import { importProducts } from '../src/server/quickProducts.ts';

test('importar JSON: entra al catálogo compartido, no duplica al reimportar, todo o nada y no pisa fichas', () => {
  const db = openDb(':memory:'); const repo = new CatalogRepo(db); applyFichas(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-i-'));
  const row = (o: object) => ({ brand: 'Samsung', model: 'Galaxy A16', storageGb: 128, ramGb: 4, color: null, condition: 'nuevo', status: 'disponible', price: 199, currency: 'USD', stock: 1, ...o });
  const file = { format: 'celulares-catalog', version: 1, products: [row({}), row({ condition: 'usado', price: 150 }),
    { ...row({ brand: 'Zeta', model: 'Phone Z' }), specs: [{ group: 'Chip', key: 'Procesador', value: 'Chip Z' }] }] };
  assert.deepEqual(importProducts(db, dir, file), { products: 3, skipped: 0 });
  assert.equal(repo.listProducts().length, 3);
  // Cada fila queda en el repo de datos (llega a las demás PCs).
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM repo_outbox WHERE path LIKE 'catalog/products/%'`).get().n, 3);
  assert.ok(repo.listProducts().every((p) => p.repoId), 'con id del repo');
  // Reimportar el mismo archivo no duplica.
  assert.deepEqual(importProducts(db, dir, file), { products: 0, skipped: 3 });
  assert.equal(repo.listProducts().length, 3);
  // Todo o nada: una fila inválida cancela el resto.
  assert.throws(() => importProducts(db, dir, { ...file, products: [row({ price: 300 }), row({ price: -1 })] }), /Fila 2/);
  assert.equal(repo.listProducts().length, 3);
  assert.throws(() => importProducts(db, dir, { format: 'otro', products: [] }), /no reconocido/);
  // La ficha verificada del modelo no se pisa con la del archivo; la del modelo nuevo sí se usa.
  const a16 = repo.listProducts().find((p) => p.model === 'Galaxy A16')!;
  importProducts(db, dir, { ...file, products: [{ ...row({ price: 99 }), specs: [{ group: 'Chip', key: 'Procesador', value: 'Pisado' }] }] });
  assert.match(repo.getSpecs(a16.modelId).find((s) => s.key === 'Procesador')!.value, /Helio G99/);
  const z = repo.listProducts().find((p) => p.model === 'Phone Z')!;
  assert.equal(repo.getSpecs(z.modelId).find((s) => s.key === 'Procesador')!.value, 'Chip Z');
});
