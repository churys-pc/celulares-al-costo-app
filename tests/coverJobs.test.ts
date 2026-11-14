import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/server/db.ts';
import { applySeedData } from '../src/server/seedData.ts';
import { applyFichas } from '../src/server/fichas.ts';
import { CoverStore } from '../src/server/covers.ts';
import { CoverJobs, applyCoverDoc } from '../src/server/coverJobs.ts';
import { applyDoc, saveQuick, removeLocal } from '../src/server/quickProducts.ts';
import { parseBing, parseSamsung, parseVtex, rankCandidates, sameVariant, searchCoverCandidates, CoverSearchOffline, type CoverCandidate } from '../src/server/coverSearch.ts';

const WEBP = fs.readFileSync('src/web/covers/samsung-galaxy-a56-5g.webp');
const dataUrl = 'data:image/webp;base64,' + WEBP.toString('base64');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function setup(search?: (b: string, m: string) => Promise<CoverCandidate[]>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-cj-'));
  const db = openDb(path.join(dir, 'c.db'));
  applySeedData(db); applyFichas(db);
  const covers = new CoverStore(dir, undefined, 'src/web', db);
  const jobs = new CoverJobs(db, covers, search ?? (async () => []), async () => ({ mime: 'image/png', buf: PNG }));
  return { dir, db, covers, jobs };
}
const cand = (url: string, title = ''): CoverCandidate => ({ url, page: url, source: new URL(url).hostname, official: false, title });

test('buscar imagen: lee el buscador, el catálogo de Samsung y la tienda de Motorola, y ordena oficiales primero', () => {
  const bing = `<a class="iusc" m="{&quot;murl&quot;:&quot;https://cdn.beebom.com/mobile/galaxy-a07-5g-front-back.png&quot;,&quot;purl&quot;:&quot;https://gadgets.beebom.com/mobile/galaxy-a07-5g&quot;,&quot;t&quot;:&quot;Galaxy A07 5G&quot;}" href="#">x</a>
    <a class="iusc" m="{&quot;murl&quot;:&quot;https://cdn.beebom.com/mobile/galaxy-a07-4g.png&quot;,&quot;purl&quot;:&quot;https://x.com&quot;}">y</a>
    <a class="iusc" m="{&quot;murl&quot;:&quot;https://i.pinimg.com/galaxy-a07-5g.png&quot;,&quot;purl&quot;:&quot;https://pinterest.com/x&quot;}">z</a>`;
  const b = parseBing(bing);
  assert.equal(b.length, 3);
  const sam = parseSamsung(JSON.stringify({ response: { resultData: { productList: [{ modelList: [
    { displayName: 'Galaxy A07 5G', modelCode: 'SM-A076B', thumbUrl: '//images.samsung.com/is/image/samsung/p6pim/uy/sm-a076b/gallery/a07?$X$', pdpUrl: '/uy/smartphones/a07-5g/' },
    { displayName: 'Galaxy A07', modelCode: 'SM-A075M', thumbUrl: '//images.samsung.com/is/image/samsung/p6pim/uy/sm-a075m/gallery/a07-4g' }] }] } } }));
  assert.equal(sam[0].url, 'https://images.samsung.com/is/image/samsung/p6pim/uy/sm-a076b/gallery/a07?$Q90_1248_936_F_PNG$');
  const ranked = rankCandidates([...b, ...sam], 'Galaxy A07 5G', 'Samsung');
  assert.deepEqual(ranked.map((c) => c.source), ['samsung.com', 'gadgets.beebom.com'], 'oficial primero; sin la 4G ni pinterest');
  const moto = parseVtex(JSON.stringify([
    { productName: 'Smartphone Motorola Moto g06 64GB', linkText: 'moto-g06', items: [{ images: [{ imageUrl: 'https://brmotorolanew.vteximg.com.br/arquivos/ids/1/tela.png' }, { imageUrl: 'https://brmotorolanew.vteximg.com.br/arquivos/ids/2/traseira-frente-moto-g06.png?v=1' }] }] },
    { productName: 'Película transparente moto g06', items: [{ images: [{ imageUrl: 'https://x/p.png' }] }] }]), 'https://www.motorola.com.br');
  assert.deepEqual(moto.map((c) => c.url), ['https://brmotorolanew.vteximg.com.br/arquivos/ids/2/traseira-frente-moto-g06.png']);
  // Variantes parecidas.
  assert.equal(sameVariant('https://x/redmi-note-13-4g.png', 'Redmi Note 13 5G', 'Xiaomi'), false);
  assert.equal(sameVariant('https://x/redmi-note-13-5g-black.png', 'Redmi Note 13 5G', 'Xiaomi'), true);
  assert.equal(sameVariant('https://x/redmi-note-13-pro-5g.png', 'Redmi Note 13 5G', 'Xiaomi'), false);
  assert.equal(sameVariant('https://x/galaxy-s24-fe.png', 'Galaxy S24', 'Samsung'), false);
  assert.equal(sameVariant('https://x/iphone-16-plus.png', 'iPhone 16', 'Apple'), false);
});

test('buscar imagen: sin conexión con ninguna fuente avisa «sin conexión»', async () => {
  await assert.rejects(searchCoverCandidates('Samsung', 'Galaxy A07 5G', async () => { throw new CoverSearchOffline('x'); }), CoverSearchOffline);
  assert.deepEqual(await searchCoverCandidates('ZTE', 'Blade A75', async () => '<html></html>'), []);
});

test('buscar imagen: si el modelo ya tiene portada la devuelve al instante; sin duplicados', () => {
  const { jobs } = setup();
  const r = jobs.request({ brand: 'Samsung', model: 'Galaxy A56 5G' });
  assert.equal(r.status, 'exists');
  const a = jobs.request({ brand: 'Samsung', model: 'Galaxy A07 5G' });
  const b = jobs.request({ brand: 'Samsung', model: 'Galaxy A07 5G' });
  assert.equal(a.status, 'pending'); assert.equal((a as any).id, (b as any).id, 'una sola búsqueda por modelo');
  assert.equal((a as any).key, 'samsung-galaxy-a07-5g', 'la 5G no usa la portada de la A07 4G');
  assert.throws(() => jobs.request({ brand: 'Samsung', model: '' }), /Elegí el modelo/);
});

test('buscar imagen: búsqueda lenta, el producto se guarda antes y la portada se asigna sola al terminar (y sigue tras reiniciar)', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { dir, db, covers, jobs } = setup(async () => { await gate; return [cand('https://images.samsung.com/a07-5g.png', 'Galaxy A07 5G')]; });
  const job = jobs.request({ brand: 'Samsung', model: 'Galaxy A07 5G' }) as any;
  const searching = jobs.runSearch(job.id);
  // Mientras busca, se guarda el producto: queda disponible al instante.
  const saved = saveQuick(db, dir, { name: 'Samsung Galaxy A07 5G 4/128', price: 150, match: { brand: 'Samsung', model: 'Galaxy A07 5G', specs: [] } });
  assert.ok(db.prepare('SELECT id FROM products WHERE repo_id = ?').get(saved.id));
  jobs.update(job.id, { productRepoId: saved.id });
  release(); await searching;
  assert.equal(jobs.get(job.id).status, 'processing');
  const done = jobs.result(job.id, { index: 0, dataUrl });
  assert.equal(done.status, 'done');
  assert.match(done.url ?? '', /^\/api\/covers\/samsung-galaxy-a07-5g\.webp\?v=/);
  // Vinculada al ID del modelo, en el repo del catálogo y sin tocar otros datos del producto.
  const m = db.prepare(`SELECT m.cover_key, p.price FROM products p JOIN variants v ON v.id = p.variant_id JOIN models m ON m.id = v.model_id WHERE p.repo_id = ?`).get(saved.id);
  assert.equal(m.cover_key, 'samsung-galaxy-a07-5g'); assert.equal(m.price, 150);
  assert.ok(db.prepare(`SELECT 1 FROM repo_outbox WHERE path = 'covers/samsung-galaxy-a07-5g.json'`).get());
  // «Reinicio»: otra instancia lee la portada guardada.
  const again = new CoverStore(dir, undefined, 'src/web', db);
  assert.equal(again.list().find((c) => c.key === 'samsung-galaxy-a07-5g')?.url?.startsWith('/api/covers/'), true);
  assert.ok(again.file('samsung-galaxy-a07-5g'));
  // Un resultado tardío de la misma búsqueda ya no cambia nada.
  assert.equal(jobs.result(job.id, { index: 0, dataUrl }).status, 'done');
  void covers;
});

test('buscar imagen: foto manual, producto borrado o cambio de equipo descartan el resultado', async () => {
  const { dir, db, jobs } = setup(async () => [cand('https://images.samsung.com/a07-5g.png', 'Galaxy A07 5G')]);
  const saved = saveQuick(db, dir, { name: 'Samsung Galaxy A07 5G', price: 150, match: { brand: 'Samsung', model: 'Galaxy A07 5G', specs: [] } });
  let j = jobs.request({ brand: 'Samsung', model: 'Galaxy A07 5G', productRepoId: saved.id }) as any;
  await jobs.runSearch(j.id);
  jobs.discardForProduct(saved.id); // el usuario eligió una foto manual
  assert.equal(jobs.result(j.id, { index: 0, dataUrl }).status, 'discarded');
  // Producto borrado mientras buscaba.
  j = jobs.request({ brand: 'Samsung', model: 'Galaxy A07 5G', productRepoId: saved.id }) as any;
  await jobs.runSearch(j.id);
  removeLocal(db, dir, saved.id);
  assert.equal(jobs.result(j.id, { index: 0, dataUrl }).status, 'discarded');
  // Cancelada desde el formulario (se cambió el equipo).
  j = jobs.request({ brand: 'Samsung', model: 'Galaxy A07 5G' }) as any;
  await jobs.runSearch(j.id);
  jobs.update(j.id, { cancel: true, reason: 'Se cambió el equipo' });
  assert.equal(jobs.result(j.id, { index: 0, dataUrl }).status, 'cancelled');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM covers_custom`).get().n, 0);
});

test('buscar imagen: modelo sin imagen verificable o sin conexión → estado claro y se puede reintentar', async () => {
  const { jobs } = setup(async (_b, m) => { if (m === 'Blade A75') return []; throw new CoverSearchOffline('x'); });
  const a = jobs.request({ brand: 'ZTE', model: 'Blade A75' }) as any;
  assert.equal((await jobs.runSearch(a.id)).status, 'not_found');
  const b = jobs.request({ brand: 'Itel', model: 'A80' }) as any;
  const r = await jobs.runSearch(b.id);
  assert.equal(r.status, 'offline'); assert.match(r.message ?? '', /Sin conexión/);
  const retry = jobs.request({ brand: 'Itel', model: 'A80' }) as any;
  assert.notEqual(retry.id, b.id, 'reintentar crea una búsqueda nueva');
});

test('buscar imagen: la portada encontrada en otra PC llega por el repo de datos', () => {
  const { db, covers } = setup();
  applyCoverDoc(covers, { key: 'honor-x9c', brand: 'Honor', model: 'X9c', url: 'https://www.honor.com/x9c.png', page: null, source: 'honor.com', savedAt: '2026-11-13T00:00:00Z', webp: WEBP.toString('base64') });
  assert.equal(covers.keyFor('Honor', 'X9c'), 'honor-x9c');
  assert.ok(covers.urlOf('honor-x9c'));
  void db; void applyDoc;
});
