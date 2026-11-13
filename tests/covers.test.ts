import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CoverStore } from '../src/server/covers.ts';
import { coverIndex, normalizeModelName, type CoverEntry } from '../src/shared/covers.ts';
import { FICHAS } from '../src/server/data/fichas/index.ts';
import data from '../src/server/data/covers.json';

const ALL = (data as { covers: CoverEntry[]; pending: { brand: string; model: string }[] });
// WebP mínimo válido (1x1, con canal alfa) para probar el guardado.
const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

test('portadas: claves únicas, origen oficial y sin nombres repetidos entre portadas', () => {
  const keys = new Set<string>(); const names = new Map<string, string>();
  for (const c of ALL.covers) {
    assert.ok(!keys.has(c.key), `clave repetida ${c.key}`); keys.add(c.key);
    assert.match(c.url, /^https:\/\/(www\.apple\.com|images\.samsung\.com|i0[12]\.appmifile\.com)\//, c.key);
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
  assert.equal(store.keyFor('Motorola', 'Moto G06'), null);
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
