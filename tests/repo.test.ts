import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from '../src/server/db.ts';
import { CatalogRepo } from '../src/server/catalog.ts';
import { RepoClient, setRepoConfig, repoStatus } from '../src/server/repoSync.ts';
import { applyDoc, deleteQuick, memoryFromName, removeLocal, saveQuick } from '../src/server/quickProducts.ts';
import { describe as describeSpecs } from '../src/shared/describe.ts';

/** GitHub falso en memoria: contents (GET/PUT/DELETE), git/trees y git/blobs. */
function fakeGitHub() {
  const files = new Map<string, { sha: string; content: string }>();
  const sha = (c: string) => crypto.createHash('sha1').update(c).digest('hex');
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const handler = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); const p = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    const m = init?.method ?? 'GET';
    if (p.startsWith('/contents/')) {
      const f = decodeURIComponent(p.slice(10));
      if (m === 'GET') return files.has(f) ? json({ sha: files.get(f)!.sha }) : json({}, 404);
      const body = JSON.parse(String(init!.body));
      if (files.has(f) && body.sha !== files.get(f)!.sha) return json({ message: 'sha' }, 409);
      if (m === 'PUT') { const s = sha(body.content); files.set(f, { sha: s, content: body.content }); return json({ content: { sha: s } }, 201); }
      files.delete(f); return json({});
    }
    if (p.startsWith('/git/trees/')) return files.size ? json({ tree: [...files].map(([path, v]) => ({ path, sha: v.sha, type: 'blob' })) }) : json({}, 409);
    if (p.startsWith('/git/blobs/')) { const v = [...files.values()].find((x) => x.sha === p.slice(11)); return v ? json({ content: v.content }) : json({}, 404); }
    return json({}, 404);
  };
  return { files, handler };
}

const PNG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const MATCH = { brand: 'Samsung', model: 'Galaxy A55 5G', url: 'https://nanoreview.net/en/phone/samsung-galaxy-a55',
  specs: [{ group: 'Chip', key: 'Procesador', value: 'Exynos 1480', highlight: true }, { group: 'Batería y carga', key: 'Batería', value: '5000 mAh', highlight: false }],
  antutu: { version: 'v11', total: 820000, cpu: 1, gpu: 1, mem: 1, ux: 1 } };

function pc() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-pc-'));
  const db = openDb(':memory:');
  setRepoConfig(db, { repo: 'churys-pc/datos', token: 'github_pat_' + 'x'.repeat(30) });
  const client = new RepoClient(db, (d, doc, photo) => applyDoc(d, dir, doc, photo), (d, id) => removeLocal(d, dir, id));
  return { db, dir, client, repo: new CatalogRepo(db) };
}

test('memoria y descripción a partir de la ficha', () => {
  assert.deepEqual(memoryFromName('Galaxy A55 8/256'), { ramGb: 8, storageGb: 256, clean: 'Galaxy A55' });
  assert.equal(memoryFromName('iPhone 15 128GB').storageGb, 128);
  assert.equal(describeSpecs(MATCH.specs, MATCH.antutu), 'Procesador Exynos 1480 (820.000 puntos en AnTuTu V11); batería de 5000 mAh.');
  assert.equal(describeSpecs([], null), '');
});

test('dos PCs: alta, edición y baja se sincronizan por el repo', async () => {
  const gh = fakeGitHub(); const real = globalThis.fetch;
  globalThis.fetch = gh.handler as typeof fetch;
  try {
    const a = pc(), b = pc();
    const { id } = saveQuick(a.db, a.dir, { name: 'Samsung Galaxy A55 8/256', price: 459, currency: 'USD', condition: 'nuevo', description: 'Ideal para fotos.', match: MATCH, photo: PNG });
    assert.equal(repoStatus(a.db).pending, 2);
    assert.equal((await a.client.sync()).ok, true);
    assert.equal(repoStatus(a.db).pending, 0);
    assert.ok(gh.files.has(`catalog/products/${id}.json`) && gh.files.has(`catalog/photos/${id}.jpg`));

    await b.client.sync();
    const [p] = b.repo.listProducts();
    assert.equal(p.model, 'Galaxy A55 5G'); assert.equal(p.price, 459); assert.equal(p.storageGb, 256); assert.equal(p.ramGb, 8);
    assert.equal(p.description, 'Ideal para fotos.'); assert.ok(p.photoUrl);
    const d = b.repo.getProduct(p.id)!;
    assert.equal(d.specs[0].value, 'Exynos 1480'); assert.equal(d.benchmarks[0].total, 820000);

    saveQuick(b.db, b.dir, { id, name: 'Samsung Galaxy A55 8/256', price: 439, currency: 'USD', match: MATCH, description: 'Oferta' });
    await b.client.sync(); await a.client.sync();
    assert.equal(a.repo.listProducts()[0].price, 439);
    assert.equal(a.repo.listProducts().length, 1);

    deleteQuick(a.db, a.dir, id);
    await a.client.sync(); await b.client.sync();
    assert.equal(b.repo.listProducts().length, 0);
    assert.ok(!gh.files.has(`catalog/products/${id}.json`));
  } finally { globalThis.fetch = real; }
});

test('sin clave o sin internet: queda pendiente y avisa', async () => {
  const db = openDb(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-pc-'));
  const client = new RepoClient(db, (d, doc, ph) => applyDoc(d, dir, doc, ph), (d, id) => removeLocal(d, dir, id));
  saveQuick(db, dir, { name: 'Moto G85', price: 299 });
  const st = await client.sync();
  assert.equal(st.ok, false); assert.match(st.message, /clave/); assert.equal(st.pending, 1);
  assert.throws(() => setRepoConfig(db, { token: 'hola' }), /github_pat_/);
});

test('clave incluida en la app: se usa si la PC no tiene una propia', async () => {
  const { builtinToken, repoConfig, setRepoConfig } = await import('../src/server/repoSync.ts');
  const { openDb } = await import('../src/server/db.ts');
  const fake = 'github_pat_' + 'A'.repeat(30);
  const k = Buffer.from('celulares-al-costo');
  process.env.CEL_BUILTIN_REPO_TOKEN = Buffer.from(Buffer.from(fake).map((x, i) => x ^ k[i % k.length])).toString('base64');
  try {
    assert.equal(builtinToken(), fake);
    const db = openDb(':memory:');
    assert.deepEqual([repoConfig(db).token, repoConfig(db).builtin], [fake, true]);
    const own = 'github_pat_' + 'B'.repeat(30);
    setRepoConfig(db, { token: own });
    assert.deepEqual([repoConfig(db).token, repoConfig(db).builtin], [own, false]);
  } finally { delete process.env.CEL_BUILTIN_REPO_TOKEN; }
});

test('dos PCs: la cotización y las cuentas del admin llegan a la otra PC', async () => {
  const { applySharedConfig, publishRate } = await import('../src/server/sharedConfig.ts');
  const { Auth } = await import('../src/server/auth.ts');
  const { getSettings, updateSettings } = await import('../src/server/settings.ts');
  const { ADMIN_EMAIL } = await import('../src/shared/types.ts');
  const gh = fakeGitHub(); const real = globalThis.fetch;
  globalThis.fetch = gh.handler as typeof fetch;
  const mk = () => {
    const x = pc();
    const client = new RepoClient(x.db, (d, doc, photo) => applyDoc(d, x.dir, doc, photo), (d, id) => removeLocal(d, x.dir, id), undefined, applySharedConfig);
    return { ...x, client, auth: new Auth(x.db, () => client.pulledOnce) };
  };
  try {
    const a = mk(), b = mk();
    await a.client.sync();
    a.auth.setupAdmin({ email: ADMIN_EMAIL, password: 'admin-123' });
    a.auth.addUser({ email: 'vende@local.uy', password: 'vende-123' });
    updateSettings(a.db, { usdRate: 41.2 }); publishRate(a.db);
    await a.client.sync();
    await b.client.sync();
    assert.equal(getSettings(b.db).usdRate, 41.2);
    assert.equal(b.auth.status().needsSetup, false);
    assert.equal(b.auth.login({ email: 'vende@local.uy', password: 'vende-123' }).user!.role, 'vendedor');
    assert.throws(() => b.auth.setupAdmin({ email: ADMIN_EMAIL, password: 'pisar-123' }));
  } finally { globalThis.fetch = real; }
});
