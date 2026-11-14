import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/server/db.ts';
import { CatalogRepo } from '../src/server/catalog.ts';
import { applyFichas } from '../src/server/fichas.ts';
import { applySeedData } from '../src/server/seedData.ts';
import { applyDoc } from '../src/server/quickProducts.ts';
import { CoverStore } from '../src/server/covers.ts';
import { homeSearch } from '../src/server/homeSearch.ts';
import { TaskRepo, applyTaskDoc, removeTaskLocal, TASKS_DIR } from '../src/server/tasks.ts';
import { RepoClient } from '../src/server/repoSync.ts';
import { parseFeed, pickNews, refreshNews, newsState, summarize, FEEDS } from '../src/server/news.ts';

function catalogDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-home-'));
  const db = openDb(path.join(dir, 'c.db'));
  applySeedData(db); applyFichas(db);
  const doc = (id: string, brand: string, model: string, ramGb: number, storageGb: number, price: number, condition = 'nuevo') =>
    applyDoc(db, dir, { id, name: `${brand} ${model}`, brand, model, price, currency: 'USD', condition: condition as 'nuevo' | 'usado', storageGb, ramGb, color: 'Negro',
      description: '', specs: [], antutu: null, source: null, photo: null, updatedAt: '' }, null);
  doc('11111111-1111-4111-8111-111111111111', 'Samsung', 'Galaxy A56 5G', 8, 256, 420);
  doc('22222222-2222-4222-8222-222222222222', 'Apple', 'iPhone 15 Pro', 8, 128, 780, 'usado');
  new CoverStore(dir, undefined, 'src/web').assignKeys(db);
  return { db, dir, repo: new CatalogRepo(db) };
}

test('buscador de Inicio: marca, modelo, variante y código; agotados con «Sin stock»', () => {
  const { db, repo } = catalogDb();
  const [a56] = homeSearch(db, repo, 'a56 8/256');
  assert.equal(a56.type, 'product'); assert.equal(a56.model, 'Galaxy A56 5G'); assert.equal(a56.price, 420); assert.equal(a56.available, true);
  assert.equal(a56.coverKey, 'samsung-galaxy-a56-5g');
  assert.equal(a56.variant, '256 GB · Nuevo', 'GB y condición (sin color)');
  assert.equal(homeSearch(db, repo, 'iphone 15 pro cpo')[0]?.variant, '128 GB · CPO');
  // Código de modelo de Samsung (SM-A566…) encuentra el mismo equipo.
  assert.equal(homeSearch(db, repo, 'SM-A566')[0]?.productId, a56.productId);
  assert.equal(homeSearch(db, repo, 'iphone 15 pro cpo')[0]?.model, 'iPhone 15 Pro');
  assert.equal(homeSearch(db, repo, 'galaxy  a56')[0]?.productId, a56.productId, 'espacios de más');
  // Modelo de la base sin producto cargado: aparece igual, como «Sin stock», y abre su ficha por ID de modelo.
  const g24 = homeSearch(db, repo, 'galaxy s25 ultra').find((h) => h.model === 'Galaxy S25 Ultra 5G');
  assert.ok(g24, 'aparece el modelo sin stock');
  assert.equal(g24.type, 'model'); assert.equal(g24.available, false); assert.equal(g24.availabilityLabel, 'Sin stock');
  assert.equal(repo.compareModels([g24.modelId])[0].model, 'Galaxy S25 Ultra 5G');
  // Producto vendido: sigue apareciendo con «Sin stock».
  db.prepare(`UPDATE products SET status = 'vendido', stock = 0 WHERE id = ?`).run(a56.productId);
  const sold = homeSearch(db, repo, 'a56 5g').find((h) => h.productId === a56.productId)!;
  assert.equal(sold.available, false); assert.equal(sold.availabilityLabel, 'Sin stock');
  // Garantía: Nuevo y CPO, 1 año.
  assert.deepEqual(repo.listProducts({ includeDemo: false }).map((p) => [p.condition, p.warrantyMonths]).sort(), [['nuevo', 12], ['usado', 12]]);
  assert.deepEqual(homeSearch(db, repo, '   '), []);
  assert.deepEqual(homeSearch(db, repo, 'zzzz inexistente'), []);
});

test('pendientes del local: crear, editar, completar, reabrir, borrar y se conservan al reiniciar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-tasks-'));
  const file = path.join(dir, 'c.db');
  let db = openDb(file); let tasks = new TaskRepo(db);
  assert.throws(() => tasks.create({ title: '  ' }, null), /título/);
  const a = tasks.create({ title: 'Llamar al proveedor', description: 'Pedir fundas A16' }, 'ana@local.uy');
  const b = tasks.create({ title: 'Cambiar vidriera' }, null);
  tasks.update(a.id, { title: 'Llamar al proveedor de fundas' });
  tasks.update(b.id, { done: true });
  assert.deepEqual(tasks.list().map((t) => [t.title, t.done]), [['Llamar al proveedor de fundas', false], ['Cambiar vidriera', true]], 'abiertas primero');
  db.close();
  // «Reinicio»: se vuelve a abrir la base del disco.
  db = openDb(file); tasks = new TaskRepo(db);
  const after = tasks.list();
  assert.equal(after.length, 2); assert.equal(after[0].description, 'Pedir fundas A16'); assert.equal(after[0].createdBy, 'ana@local.uy');
  assert.ok(after[1].completedAt);
  tasks.update(b.id, { done: false });
  assert.equal(tasks.get(b.id).completedAt, null);
  tasks.remove(a.id);
  assert.deepEqual(tasks.list().map((t) => t.id), [b.id]);
  // Cada cambio queda encolado para las demás PCs (tasks/<id>.json).
  const out = db.prepare(`SELECT path, op FROM repo_outbox WHERE path LIKE 'tasks/%' ORDER BY path`).all().map((r) => `${r.op} ${r.path}`);
  assert.deepEqual(out.sort(), [`delete ${TASKS_DIR}${a.id}.json`, `put ${TASKS_DIR}${b.id}.json`].sort());
  db.close();
});

test('pendientes: se reciben de otra PC por el repo y se borran cuando allá los borran', async () => {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO settings (key, value) VALUES ('repoToken', ?)`).run(JSON.stringify('github_pat_' + 'x'.repeat(30)));
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const doc = { id, title: 'Reponer protectores', description: '', done: false, createdBy: null, createdAt: '2026-11-13T10:00:00.000Z', updatedAt: '2026-11-13T10:00:00.000Z', completedAt: null };
  let tree = [{ path: `${TASKS_DIR}${id}.json`, sha: 's1', type: 'blob' }];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree }), { status: 200 });
    if (url.includes('/git/blobs/s1')) return new Response(JSON.stringify({ content: Buffer.from(JSON.stringify(doc)).toString('base64') }), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  try {
    const client = new RepoClient(db, () => {}, () => {}, undefined, undefined, [{ dir: TASKS_DIR, apply: applyTaskDoc, remove: removeTaskLocal }]);
    assert.equal((await client.sync()).ok, true);
    assert.deepEqual(new TaskRepo(db).list().map((t) => t.title), ['Reponer protectores']);
    tree = [];
    await client.sync();
    assert.equal(new TaskRepo(db).list().length, 0);
  } finally { globalThis.fetch = realFetch; }
});

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Samsung presenta el Galaxy A57 5G en Latinoamérica]]></title><link>https://news.samsung.com/latin/a57</link>
<pubDate>Thu, 12 Nov 2026 10:00:00 +0000</pubDate><description><![CDATA[<p>El nuevo Galaxy A57 5G llega con One UI 8 y seis años de actualizaciones.</p><p>Su precio es de 499 dólares.</p>]]></description></item>
<item><title>Samsung WindFree protege el sueño</title><link>https://news.samsung.com/latin/windfree</link><pubDate>Thu, 12 Nov 2026 09:00:00 +0000</pubDate><description>Aire acondicionado.</description></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Ya están disponibles las actualizaciones de iOS 27.1 para el iPhone</title><link href="https://www.apple.com/mx/newsroom/2026/11/ios-27-1/"/>
<updated>2026-11-10T16:00:00Z</updated><content type="html">&lt;p&gt;iOS 27.1 suma nuevas funciones para el iPhone 11 y posteriores.&lt;/p&gt;</content></entry>
<entry><title>Apple Music anuncia su artista del año</title><link href="https://www.apple.com/mx/newsroom/2026/11/music/"/><updated>2026-11-09T16:00:00Z</updated></entry>
</feed>`;
const XATAKA = `<rss><channel>
<item><title>Xiaomi lanza el Redmi Note 17 en Europa</title><link>https://www.xatakamovil.com/xiaomi/redmi-note-17</link><pubDate>Wed, 11 Nov 2026 12:00:00 +0100</pubDate><description>&lt;p&gt;Xiaomi presentó el Redmi Note 17 con HyperOS 3. Cuesta 299 euros.&lt;/p&gt;</description></item>
<item><title>Se filtra el POCO F8: podría llegar en diciembre</title><link>https://www.xatakamovil.com/xiaomi/poco-f8</link><pubDate>Wed, 11 Nov 2026 13:00:00 +0100</pubDate><description>Rumor.</description></item>
<item><title>Xiaomi, Samsung y Motorola activan las ofertas previas al Black Friday</title><link>https://www.xatakamovil.com/ofertas</link><pubDate>Fri, 13 Nov 2026 11:00:00 +0100</pubDate><description>Ofertas.</description></item>
</channel></rss>`;
const NOW = Date.parse('2026-11-13T15:00:00Z');

test('novedades: lee RSS y Atom, se queda con lanzamientos y actualizaciones, sin rumores, ofertas ni precios de otros países', () => {
  const all = [
    ...parseFeed(RSS, FEEDS[1]), ...parseFeed(ATOM, FEEDS[0]), ...parseFeed(XATAKA, FEEDS[3]),
  ];
  const picked = pickNews(all, NOW);
  assert.equal(picked.length, 3);
  assert.deepEqual(picked.map((n) => n.brand).sort(), ['Apple', 'Samsung', 'Xiaomi']);
  for (const n of picked) { assert.match(n.url, /^https:\/\//); assert.ok(n.date && n.title && n.source); }
  const s = picked.find((n) => n.brand === 'Samsung')!;
  assert.equal(s.summary, 'El nuevo Galaxy A57 5G llega con One UI 8 y seis años de actualizaciones.');
  assert.doesNotMatch(picked.find((n) => n.brand === 'Xiaomi')!.summary, /euros/);
  assert.ok(!picked.some((n) => /filtra|ofertas|WindFree|Apple Music/i.test(n.title)));
  assert.equal(summarize('Precio: 999 €. Llega con Android 16 y carga de 45 W.', 'x'), 'Llega con Android 16 y carga de 45 W.');
});

test('novedades: sin conexión se muestran las últimas guardadas con su fecha; sin nada guardado, lista vacía', async () => {
  const db = openDb(':memory:');
  assert.deepEqual(newsState(db).items, []);
  const ok = await refreshNews(db, async (url) => url.includes('samsung') ? RSS : url.includes('apple') ? ATOM : url.includes('xataka') ? XATAKA : '<rss/>', NOW);
  assert.equal(ok.items.length, 3); assert.ok(ok.fetchedAt);
  const off = await refreshNews(db, async () => { throw new Error('offline'); }, NOW + 3600_000);
  assert.equal(off.items.length, 3, 'conserva las guardadas');
  assert.equal(off.fetchedAt, ok.fetchedAt);
  assert.match(off.error ?? '', /Sin conexión/);
  const empty = openDb(':memory:');
  const none = await refreshNews(empty, async () => { throw new Error('offline'); }, NOW);
  assert.deepEqual(none.items, []);
});

test('migración v12: los CPO con 3 meses de garantía pasan a 1 año', () => {
  const { db, dir } = catalogDb();
  db.prepare(`UPDATE products SET warranty_months = 3 WHERE condition = 'usado'`).run();
  db.prepare('UPDATE schema_version SET v = 11').run();
  db.close();
  const again = openDb(path.join(dir, 'c.db'));
  assert.deepEqual(again.prepare('SELECT condition, warranty_months AS w FROM products ORDER BY condition').all().map((r: any) => [r.condition, Number(r.w)]),
    [['nuevo', 12], ['usado', 12]]);
});
