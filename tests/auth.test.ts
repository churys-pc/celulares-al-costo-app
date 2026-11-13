import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/server/db.ts';
import { createServer } from '../src/server/http.ts';
import { ADMIN_EMAIL } from '../src/shared/types.ts';

async function start(canSetup = () => true) {
  const db = openDb(':memory:');
  const server = createServer(db, '/nonexistent', fs.mkdtempSync(path.join(os.tmpdir(), 'cel-')), { canSetup });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, u: string, b?: unknown) => {
    const r = await fetch(url + u, { method, body: b === undefined ? undefined : JSON.stringify(b) });
    return { status: r.status, body: await r.json() };
  };
  return { db, server, call };
}

test('login: admin crea contraseña, vendedor no puede editar ni cambiar la cotización', async () => {
  const { db, server, call } = await start();
  try {
    assert.equal((await call('GET', '/api/catalog/products')).status, 401);
    assert.equal((await call('POST', '/api/auth/setup', { email: 'otro@x.com', password: '12345678' })).status, 400);
    assert.equal((await call('POST', '/api/auth/setup', { email: ADMIN_EMAIL, password: '123' })).status, 400);
    const setup = await call('POST', '/api/auth/setup', { email: ADMIN_EMAIL.toUpperCase(), password: '1234' });
    assert.equal(setup.status, 200); assert.equal(setup.body.user.role, 'admin');
    assert.equal((await call('POST', '/api/auth/setup', { email: ADMIN_EMAIL, password: 'otra-clave' })).status, 400);
    // Cotización: el admin la cambia y queda encolada para todas las PCs.
    assert.equal((await call('PUT', '/api/settings', { usdRate: 40.5 })).status, 200);
    assert.ok(db.prepare(`SELECT 1 FROM repo_outbox WHERE path = 'config/settings.json'`).get());
    assert.ok(db.prepare(`SELECT 1 FROM repo_outbox WHERE path = 'config/users.json'`).get());
    assert.equal((await call('POST', '/api/users', { email: 'Vende@Local.uy', password: 'vende-123' })).status, 200);
    await call('POST', '/api/auth/logout');
    assert.equal((await call('POST', '/api/auth/login', { email: 'vende@local.uy', password: 'mala-clave' })).status, 400);
    const v = await call('POST', '/api/auth/login', { email: 'vende@local.uy', password: 'vende-123' });
    assert.equal(v.body.user.role, 'vendedor');
    assert.equal((await call('GET', '/api/catalog/products')).status, 200);
    assert.equal((await call('PUT', '/api/settings', { usdRate: 1 })).status, 403);
    assert.equal((await call('POST', '/api/quick/products', { name: 'X', price: 1 })).status, 403);
    assert.equal((await call('GET', '/api/users')).status, 403);
    assert.equal((await call('GET', '/api/settings')).body.usdRate, 40.5);
  } finally { server.close(); }
});

test('login: no se crea el admin hasta bajar el catálogo compartido', async () => {
  let ready = false;
  const { server, call } = await start(() => ready);
  try {
    assert.equal((await call('GET', '/api/auth')).body.setupReady, false);
    assert.equal((await call('POST', '/api/auth/setup', { email: ADMIN_EMAIL, password: 'admin-123' })).status, 400);
    ready = true;
    assert.equal((await call('POST', '/api/auth/setup', { email: ADMIN_EMAIL, password: 'admin-123' })).status, 200);
  } finally { server.close(); }
});
