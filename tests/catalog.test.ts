import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.ts';
import { CatalogRepo } from '../src/server/catalog.ts';
import { createServer } from '../src/server/http.ts';
import { ADMIN_EMAIL } from '../src/shared/types.ts';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

async function loginAdmin(url: string) {
  const r = await fetch(`${url}/api/auth/setup`, { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: 'clave-segura-1' }) });
  assert.equal(r.status, 200, await r.text());
}
const base = { brand: 'Apple', model: 'iPhone Prueba', storageGb: 128, color: 'Negro', condition: 'nuevo', price: 999, currency: 'USD' };

test('CRUD de producto reutiliza marca/modelo/variante', () => {
  const repo = new CatalogRepo(openDb(':memory:'));
  const a = repo.createProduct(base);
  const b = repo.createProduct({ ...base, condition: 'usado', price: 600 });
  assert.equal(a.variantId, b.variantId);
  assert.equal(repo.listBrands().length, 1);
  const u = repo.updateProduct(a.id, { ...base, storageGb: 256, price: 1100, uses: ['fotos'] });
  assert.notEqual(u.variantId, a.variantId);
  assert.deepEqual(u.uses, ['fotos']);
  assert.equal(repo.listProducts({ use: 'fotos' }).length, 1);
  assert.equal(repo.listProducts({ q: 'prueba 256' }).length, 1); // cada palabra por separado (modelo + memoria)
  assert.equal(repo.listProducts({ q: 'IPHÓNE prueba' }).length, 2, 'sin importar tildes ni mayúsculas');
  assert.equal(repo.listProducts({ q: 'prueba cpo' }).length, 1, 'condición CPO');
  assert.equal(repo.listProducts({ q: 'iphone' }).length, 2);
  assert.ok(repo.deleteProduct(b.id));
  assert.equal(repo.listProducts().length, 1);
});

test('validación rechaza datos inválidos', () => {
  const repo = new CatalogRepo(openDb(':memory:'));
  assert.throws(() => repo.createProduct({ ...base, brand: '' }), /marca/);
  assert.throws(() => repo.createProduct({ ...base, price: -1 }), /precio/);
  assert.throws(() => repo.createProduct({ ...base, currency: 'EUR' }), /moneda/);
  assert.throws(() => repo.createProduct({ ...base, uses: ['hackear'] }), /uso/);
  assert.equal(repo.listProducts({ q: "%' OR 1=1 --" }).length, 0);
});

test('specs guardan fuente y fecha; URL validada', () => {
  const repo = new CatalogRepo(openDb(':memory:'));
  const p = repo.createProduct(base);
  const specs = repo.setSpecs(p.modelId, [
    { group: 'Pantalla', key: 'Tamaño', value: '6,1"', highlight: true, sourceName: 'Fabricante', sourceUrl: 'https://example.com', sourceDate: '2026-11-01' },
    { group: 'Otros', key: 'Nota', value: 'sin fuente' },
  ]);
  assert.equal(specs[0].sourceName, 'Fabricante');
  assert.equal(specs[0].sourceDate, '2026-11-01');
  assert.equal(specs[1].sourceName, null);
  assert.throws(() => repo.setSpecs(p.modelId, [{ group: 'Otros', key: 'x', value: 'y', sourceUrl: 'javascript:alert(1)' }]), /URL/);
});

test('export/import JSON es atómico', () => {
  const src = new CatalogRepo(openDb(':memory:'));
  const p = src.createProduct(base);
  src.setSpecs(p.modelId, [{ group: 'Chip', key: 'Chip', value: 'X', highlight: true }]);
  const dump = src.exportCatalog();
  const dst = new CatalogRepo(openDb(':memory:'));
  assert.deepEqual(dst.importCatalog(dump), { products: 1 });
  assert.equal(dst.getProduct(dst.listProducts()[0].id)!.specs[0].value, 'X');
  const bad = { ...dump, products: [...dump.products, { ...base, price: 'abc' }] };
  assert.throws(() => dst.importCatalog(bad), /Fila 2/);
  assert.equal(dst.listProducts().length, 1);
});

test('API HTTP: alta, error 400 y origen ajeno bloqueado', async () => {
  const server = createServer(openDb(':memory:'), '/nonexistent', fs.mkdtempSync(path.join(os.tmpdir(), 'cel-')));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  await loginAdmin(`http://127.0.0.1:${(server.address() as any).port}`);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const ok = await fetch(`${url}/api/catalog/products`, { method: 'POST', body: JSON.stringify(base) });
    assert.equal(ok.status, 200);
    const bad = await fetch(`${url}/api/catalog/products`, { method: 'POST', body: JSON.stringify({ ...base, price: 'x' }) });
    assert.equal(bad.status, 400);
    const csrf = await fetch(`${url}/api/catalog/products/1`, { method: 'DELETE', headers: { origin: 'http://evil.test' } });
    assert.equal(csrf.status, 403);
    const list = await (await fetch(`${url}/api/catalog/products`)).json();
    assert.equal(list.length, 1);
  } finally { server.close(); }
});

test('fotos: valida tipo real, licencia y máximo; stats reales', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-'));
  const server = createServer(openDb(':memory:'), '/nonexistent', dir);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  await loginAdmin(`http://127.0.0.1:${(server.address() as any).port}`);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (u: string, b: unknown) => fetch(url + u, { method: 'POST', body: JSON.stringify(b) });
  try {
    const p = await (await post('/api/catalog/products', { ...base, stock: 3 })).json();
    const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000', 'hex').toString('base64');
    assert.equal((await post(`/api/catalog/products/${p.id}/photos`, { dataUrl: png })).status, 400); // sin licencia
    const fake = 'data:image/png;base64,' + Buffer.from('hola mundo').toString('base64');
    assert.equal((await post(`/api/catalog/products/${p.id}/photos`, { dataUrl: fake, license: 'propia' })).status, 400);
    for (let i = 0; i < 5; i++) assert.equal((await post(`/api/catalog/products/${p.id}/photos`, { dataUrl: png, license: 'propia' })).status, 200);
    assert.equal((await post(`/api/catalog/products/${p.id}/photos`, { dataUrl: png, license: 'propia' })).status, 400);
    const list = await (await fetch(`${url}/api/catalog/products`)).json();
    assert.match(list[0].photoUrl, /^\/api\/photos\/\d+$/);
    assert.equal((await fetch(url + list[0].photoUrl)).headers.get('content-type'), 'image/png');
    const stats = await (await fetch(`${url}/api/stats`)).json();
    assert.deepEqual(stats, { products: 1, stockTotal: 3, favorites: 0, salesToday: null, tradeInsInProgress: null });
    await fetch(`${url}/api/catalog/products/${p.id}`, { method: 'DELETE' });
    assert.equal(fs.readdirSync(path.join(dir, 'photos')).length, 0);
  } finally { server.close(); }
});

test('migración v5: se borran los registros DEMO viejos', () => {
  const db = openDb(':memory:');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM products WHERE is_demo = 1').get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM brands WHERE name = 'DEMO'`).get().n, 0);
});
