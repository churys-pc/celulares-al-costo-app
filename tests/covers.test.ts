import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CoverStore } from '../src/server/covers.ts';
import { coverIndex, normalizeModelName, type CoverEntry } from '../src/shared/covers.ts';
import { FICHAS } from '../src/server/data/fichas/index.ts';
import data from '../src/server/data/covers.json';
import { openDb } from '../src/server/db.ts';
import { applySeedData } from '../src/server/seedData.ts';
import { applyFichas } from '../src/server/fichas.ts';

const ALL = (data as { covers: CoverEntry[]; pending: { brand: string; model: string }[] });
// WebP mínimo válido (1x1, con canal alfa) para probar el guardado.
const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

test('portadas: claves únicas, origen https y sin nombres repetidos entre portadas', () => {
  const keys = new Set<string>(); const names = new Map<string, string>();
  for (const c of ALL.covers) {
    assert.ok(!keys.has(c.key), `clave repetida ${c.key}`); keys.add(c.key);
    assert.match(c.url, /^https:\/\//, c.key);
    assert.match(c.page, /^https:\/\//, c.key);
    for (const m of c.models) {
      const n = c.brand.toLowerCase() + '|' + normalizeModelName(m);
      assert.ok(!names.has(n) || names.get(n) === c.key, `${m} apunta a dos portadas`);
      names.set(n, c.key);
    }
  }
});

test('portadas: cada ficha verificada tiene portada o está marcada como pendiente', () => {
  const store = new CoverStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cel-cov-')));
  const pend = new Set(ALL.pending.map((p) => p.brand.toLowerCase() + '|' + normalizeModelName(p.model)));
  for (const f of FICHAS) {
    const has = [f.model, ...(f.aliases ?? [])].some((n) => store.keyFor(f.brand, n));
    assert.ok(has || pend.has(f.brand.toLowerCase() + '|' + normalizeModelName(f.model)), `${f.brand} ${f.model} sin portada`);
  }
  // Variantes parecidas: cada una con su imagen.
  assert.equal(store.keyFor('Samsung', 'Galaxy A17 LTE'), 'samsung-galaxy-a17-lte');
  assert.equal(store.keyFor('Samsung', 'Galaxy A17 5G'), 'samsung-galaxy-a17-5g');
  assert.equal(store.keyFor('Samsung', 'Galaxy A16'), 'samsung-galaxy-a16');
  assert.equal(store.keyFor('Samsung', 'Galaxy A16 5G'), 'samsung-galaxy-a16-5g');
  assert.equal(store.keyFor('Samsung', 'Galaxy S24 Plus 5G'), 'samsung-galaxy-s24-plus');
  assert.equal(store.keyFor('Xiaomi', 'Redmi Note 14 LTE'), 'xiaomi-redmi-note-14');
  assert.equal(store.keyFor('Xiaomi', 'Redmi Note 14 5G'), 'xiaomi-redmi-note-14-5g');
  assert.equal(store.keyFor('Apple', 'iPhone 17 Air'), 'apple-iphone-air');
  assert.equal(store.keyFor('Apple', 'iPhone 17'), 'apple-iphone-17');
  assert.equal(store.keyFor('Apple', 'iPhone 17 Pro Max'), 'apple-iphone-17-pro');
  assert.equal(store.keyFor('Motorola', 'Moto G06'), 'motorola-moto-g06');
  assert.equal(store.keyFor('Xiaomi', 'Redmi Note 13 LTE'), 'xiaomi-redmi-note-13-4g');
  assert.equal(store.keyFor('Xiaomi', 'Redmi Note 13 5G'), 'xiaomi-redmi-note-13-5g');
  assert.equal(store.keyFor('Xiaomi', 'Poco X7 5G'), 'xiaomi-poco-x7');
  assert.equal(store.keyFor('Xiaomi', 'Poco X7 Pro'), 'xiaomi-poco-x7-pro');
  assert.equal(store.keyFor('CAT', 'S42 H+'), 'cat-s42-h-plus');
  assert.equal(ALL.pending.length, 0, 'no quedan modelos pendientes');
});

test('portadas: solo se guarda WebP, queda disponible tras reiniciar y se regenera si cambia el origen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-cov-'));
  const entry = ALL.covers.find((c) => c.key === 'apple-iphone-12')!;
  const store = new CoverStore(dir, [entry]);
  assert.equal(store.list()[0].url, null);
  assert.throws(() => store.save('apple-iphone-12', { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }));
  assert.throws(() => store.save('../etc', { dataUrl: WEBP }));
  store.save('apple-iphone-12', { dataUrl: WEBP, width: 1, height: 1 });
  // «Reinicio»: un almacén nuevo sobre la misma carpeta encuentra la portada.
  const again = new CoverStore(dir, [entry]);
  assert.match(again.list()[0].url!, /^\/api\/covers\/apple-iphone-12\.webp\?v=/);
  assert.ok(again.file('apple-iphone-12'));
  const moved = new CoverStore(dir, [{ ...entry, url: entry.url.replace('black', 'blue') }]);
  assert.equal(moved.list()[0].url, null, 'si cambia la imagen oficial, la portada se vuelve a generar');
  // Índice de la app: resuelve por nombre normalizado.
  const idx = coverIndex(again.list());
  assert.ok(idx.get('apple|' + normalizeModelName('iPhone 12')));
});

test('portadas incluidas: cada portada es un WebP 768 × 768 con transparencia y se ve sin internet', () => {
  for (const c of ALL.covers) {
    const f = path.join('src/web/covers', c.key + '.webp');
    assert.ok(fs.existsSync(f), `falta el archivo de ${c.key}`);
    const b = fs.readFileSync(f);
    assert.equal(b.toString('ascii', 0, 4), 'RIFF', c.key);
    assert.equal(b.toString('ascii', 8, 12), 'WEBP', c.key);
    // Cabecera VP8X: ancho/alto - 1 en 24 bits, y bandera de alfa.
    assert.equal(b.toString('ascii', 12, 16), 'VP8X', `${c.key}: WebP sin cabecera extendida`);
    assert.ok(b[20] & 0x10, `${c.key}: sin canal alfa`);
    assert.equal(b.readUIntLE(24, 3) + 1, 768, `${c.key}: ancho`);
    assert.equal(b.readUIntLE(27, 3) + 1, 768, `${c.key}: alto`);
  }
  // La portada incluida tiene prioridad y no depende de descargas.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-cov-'));
  const store = new CoverStore(dir, ALL.covers, 'src/web');
  for (const c of store.list()) assert.match(c.url ?? '', new RegExp(`^/covers/${c.key}\\.webp\\?v=\\d+$`), c.key);
});

test('portadas: cobertura del 100 % de los modelos de la base, vinculados por ID', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-cov-'));
  const db = openDb(path.join(dir, 'c.db'));
  applySeedData(db); applyFichas(db);
  const store = new CoverStore(dir, ALL.covers, 'src/web');
  const cov = store.coverage(db);
  assert.ok(cov.total > 0);
  assert.deepEqual(cov.pending.map((m) => `${m.brand} ${m.model}`), []);
  assert.equal(cov.withCover, cov.total);
  const row = db.prepare("SELECT m.cover_key FROM models m JOIN brands b ON b.id = m.brand_id WHERE b.name = 'Apple' AND m.name = 'iPhone 16'").get();
  assert.equal(row?.cover_key, 'apple-iphone-16');
  db.close();
});
