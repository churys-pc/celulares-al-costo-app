import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/server/db.ts';
import { CatalogRepo } from '../src/server/catalog.ts';
import { applyFichas } from '../src/server/fichas.ts';
import { applyDoc, updateQuick } from '../src/server/quickProducts.ts';

test('editar desde el catálogo: cambia precio/estado/memoria y conserva marca, modelo y ficha', () => {
  const db = openDb(':memory:'); const repo = new CatalogRepo(db); applyFichas(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-e-'));
  const id = '11111111-2222-4333-8444-555555555555';
  applyDoc(db, dir, { id, name: 'Samsung Galaxy A16 4/128 (CPO)', brand: 'Samsung', model: 'Galaxy A16', price: 225, currency: 'USD', condition: 'usado',
    storageGb: 128, ramGb: 4, color: null, description: 'Texto', specs: [], antutu: null, source: null, photo: null, updatedAt: '' }, null);
  updateQuick(db, dir, id, { price: 199, condition: 'nuevo', ramGb: 6, storageGb: 128 });
  const [p] = repo.listProducts();
  assert.equal(p.model, 'Galaxy A16'); assert.equal(p.price, 199); assert.equal(p.condition, 'nuevo'); assert.equal(p.ramGb, 6);
  assert.match(repo.getSpecs(p.modelId).find((s) => s.key === 'Procesador')!.value, /^MediaTek Helio G99/);
  const out = db.prepare(`SELECT content FROM repo_outbox WHERE path = ?`).get(`catalog/products/${id}.json`);
  const doc = JSON.parse(Buffer.from(out.content, 'base64').toString());
  assert.equal(doc.name, 'Samsung Galaxy A16 6/128'); assert.equal(doc.description, 'Texto');
  assert.throws(() => updateQuick(db, dir, id, { price: -1 }));
});
