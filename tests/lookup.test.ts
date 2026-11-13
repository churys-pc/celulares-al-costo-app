import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNanoreviewHtml, parseSearch } from '../src/shared/nanoreview.ts';

// Fragmento con la misma estructura que las páginas reales (title + filas cell-h/cell-s + barra AnTuTu).
const row = (k: string, v: string) => `<tr>\n<td class="cell-h">${k}</td>\n<td class="cell-s">${v}</td>\n</tr>`;
const HTML = `<html><head><title>Samsung Galaxy S24 Plus (Snapdragon): specs, benchmarks, and user reviews</title></head><body>
<table>${row('Type', 'Dynamic AMOLED')}${row('Size', '6.7 inches')}${row('Refresh rate', '120 Hz')}${row('Weight', '196 g (6.91 oz)')}
${row('Height', '158.5 mm (6.24 inches)')}${row('Width', '75.9 mm (2.99 inches)')}${row('Thickness', '7.7 mm (0.3 inches)')}
${row('Chipset', 'Qualcomm Snapdragon 8 Gen 3')}${row('CPU', '688360')}${row('GPU', '749548')}${row('Memory', '331952')}${row('UX', '501410')}
${row('Total score', '2271270')}${row('Capacity', '4900 mAh')}${row('Wireless charging', 'Yes (15 W)')}${row('8K video recording', 'No')}
${row('4K video recording', 'Up to 60FPS')}${row('NFC*', 'Yes')}${row('USB type', 'USB Type-C')}${row('USB version', '3.2')}
${row('Operating system', 'Android 14 (Can be upgraded to Android 17)')}</table>
<div class="score-bar"><div class="score-bar-name">AnTuTu Benchmark 11</div><div class="score-bar-result"><span class="score-bar-result-number">2271270</span></div></div>
</body></html>`;

test('lee ficha y AnTuTu de una página de Nanoreview', () => {
  const p = parseNanoreviewHtml(HTML);
  assert.equal(p.brand, 'Samsung'); assert.equal(p.model, 'Galaxy S24 Plus (Snapdragon)');
  assert.deepEqual(p.antutu, { version: 'v11', total: 2271270, cpu: 688360, gpu: 749548, mem: 331952, ux: 501410 });
  const v = Object.fromEntries(p.specs.map((s) => [s.key, s.value]));
  assert.equal(v['Tamaño y tipo'], '6,7" Dynamic AMOLED');
  assert.equal(v['Medidas'], '158,5 x 75,9 x 7,7 mm');
  assert.equal(v['Carga inalámbrica'], 'Sí (15 W)');
  assert.equal(v['Video'], '4K hasta 60 fps');
  assert.equal(v['NFC'], 'Sí');
  assert.equal(v['Puerto'], 'USB-C 3,2');
  assert.equal(v['Peso'], '196 g');
  assert.match(v['Sistema operativo'], /actualizable a Android 17/);
});

test('página sin puntaje o con formato distinto: no inventa', () => {
  const p = parseNanoreviewHtml('<title>X Y: specs</title><table>' + row('Chipset', 'Chip X') + '</table>');
  assert.equal(p.antutu, null);
  assert.equal(p.specs.length, 1);
});

test('búsqueda: solo teléfonos con slug válido', () => {
  assert.deepEqual(parseSearch([{ slug: 'samsung-galaxy-a55', name: 'Samsung Galaxy A55 5G', content_type: 'phone' },
    { slug: 'acer-nitro', name: 'Acer', content_type: 'laptop' }, { slug: '../x', content_type: 'phone' }]),
  [{ slug: 'samsung-galaxy-a55', name: 'Samsung Galaxy A55 5G' }]);
  assert.deepEqual(parseSearch({ error: 1 }), []);
});

test('importar en línea: vincula con el nombre del catálogo y no pisa datos manuales', async () => {
  const { openDb } = await import('../src/server/db.ts');
  const { CatalogRepo } = await import('../src/server/catalog.ts');
  const { importOnline } = await import('../src/server/lookup.ts');
  const db = openDb(':memory:');
  const repo = new CatalogRepo(db);
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(HTML, { status: 200 })) as typeof fetch;
  try {
    const r = await importOnline(db, 'samsung-galaxy-s24-plus', { brand: 'Samsung', model: 'Galaxy S24 Plus 5G' });
    assert.equal(r.antutu, true);
    const m = repo.compareModels([r.modelId])[0];
    assert.equal(m.model, 'Galaxy S24 Plus 5G');
    assert.equal(m.benchmarks[0].sourceName, 'Nanoreview (búsqueda en línea)');
    assert.equal(m.specs.find((s) => s.key === 'Procesador')!.sourceUrl, 'https://nanoreview.net/en/phone/samsung-galaxy-s24-plus');
    const again = await importOnline(db, 'samsung-galaxy-s24-plus', { brand: 'Samsung', model: 'Galaxy S24 Plus 5G' });
    assert.deepEqual([again.specs, again.antutu], [0, false]);
    await assert.rejects(importOnline(db, '../etc'), /inválido/);
  } finally { globalThis.fetch = real; }
});
