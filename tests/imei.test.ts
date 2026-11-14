import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateImei, maskImei, summarizeImei, summarizeDevice, type SourceResult } from '../src/shared/imei.ts';
import { ImeiChecker, parseProviderJson, parsePhonecheck, phonecheckAdapter, type Adapter, type ProviderInfo } from '../src/server/imei.ts';
import { openDb } from '../src/server/db.ts';

const A = '351234567890124', B = '359876543210983', ZERO_LEAD = '012345678901237';

test('IMEI: formato, separadores, ceros iniciales y dígito de control', () => {
  assert.deepEqual(validateImei('35-123456 7890124'), { ok: true, digits: A });
  assert.deepEqual(validateImei(ZERO_LEAD), { ok: true, digits: ZERO_LEAD }, 'conserva el cero inicial');
  for (const [bad, msg] of [['', /Ingresá/], ['35123456789012A', /solo lleva números/], ['35123456789012', /15 dígitos \(hay 14\)/],
    ['3512345678901244', /hay 16/], ['000000000000000', /todos ceros/], ['351234567890125', /dígito de control/]] as const) {
    const v = validateImei(bad); assert.equal(v.ok, false, bad); assert.match((v as any).error, msg);
  }
  assert.equal(maskImei(A), '35•••••••••0124');
});

type Q = Adapter['query'];
const info = (id: string, base: string, extra: Partial<ProviderInfo> = {}): ProviderInfo => ({ id, name: id.toUpperCase(), base, coverage: 'prueba',
  coversUruguay: false, configured: true, auto: true, retryCharges: false, complementary: false, reportTypes: '', update: '', terms: '', docs: '', howTo: '', status: 'ok', ...extra });
const adapter = (id: string, base: string, query: Q, extra: Partial<ProviderInfo> = {}): Adapter => ({ info: info(id, base, extra), query });
const ans = (status: string, extra: object = {}): Q => async () => ({ status: status as any, reason: null, reportDate: null, model: null, message: null, ...extra });
const one = async (a: Adapter, imei = A) => new ImeiChecker({ adapters: [a] }).check({ imei, provider: a.info.id });

test('IMEI: el IMEI inválido no genera tráfico; consultas idénticas en curso se comparten', async () => {
  let calls = 0;
  const slow = adapter('a', 'Base A', async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return { status: 'clean', reason: null, reportDate: null, model: null, message: null }; });
  const c = new ImeiChecker({ adapters: [slow] });
  assert.throws(() => c.check({ imei: '351234567890125', provider: 'a' }), /dígito de control/);
  assert.throws(() => c.check({ imei: '', provider: 'a' }), /Ingresá/);
  assert.equal(calls, 0);
  const [r1, r2] = await Promise.all([c.check({ imei: A, provider: 'a' }), c.check({ imei: A, provider: 'a' })]);
  assert.equal(calls, 1, 'doble clic: una sola consulta');
  assert.equal(r1, r2);
  assert.equal(r1.imei, '35•••••••••0124', 'el resultado no trae el IMEI completo');
});

test('IMEI: caída de una fuente, respuesta inesperada y tiempo agotado nunca cuentan como negativo', async () => {
  const c = new ImeiChecker({ timeoutMs: 80, adapters: [
    adapter('down', 'Base A', async () => { throw new Error(`HTTP 503 https://api.x.com/v2/imei/blacklist/${A}`); }),
    adapter('raro', 'Base B', async () => parseProviderJson('<html>ok</html>')),
    adapter('lento', 'Base C', (_i, signal) => new Promise((_ok, ko) => signal.addEventListener('abort', () => ko(new Error('abort'))))),
  ] });
  const rs = await Promise.all(['down', 'raro', 'lento'].map((p) => c.check({ imei: A, provider: p })));
  assert.deepEqual(rs.map((r) => r.status), ['error', 'unexpected', 'timeout']);
  assert.ok(!rs[0].message!.includes(A) && !rs[0].message!.includes('http'), 'el error no expone el IMEI ni la URL');
  assert.equal(summarizeImei(rs).status, 'unverified');
});

test('IMEI: fuentes que discrepan mantienen la alerta; la misma base cuenta una vez; cobertura UY no confirmada → parcial', async () => {
  const c = new ImeiChecker({ adapters: [
    adapter('gsma', 'GSMA', ans('reported', { reason: 'Robo', reportDate: '2026-10-02', model: { brand: 'Apple', model: 'iPhone 13' } })),
    adapter('phonecheck', 'GSMA', ans('clean')),
    adapter('local', 'Lista UY', ans('clean'), { coversUruguay: true }),
  ] });
  const rs = await Promise.all(['gsma', 'phonecheck', 'local'].map((p) => c.check({ imei: A, provider: p })));
  const s = summarizeImei(rs);
  assert.equal(s.status, 'reported'); assert.equal(s.needsReview, true);
  assert.deepEqual(s.bases.sort(), ['GSMA', 'Lista UY'], 'GSMA por dos servicios cuenta una vez');
  const only = summarizeImei([await one(adapter('g', 'GSMA', ans('clean')), B)]);
  assert.equal(only.status, 'partial'); assert.match(only.notes.join(' '), /Cobertura Uruguay no confirmada/);
  const ok = summarizeImei([await one(adapter('l', 'Lista UY', ans('clean'), { coversUruguay: true }), B)]);
  assert.equal(ok.status, 'clean');
  const hist = summarizeImei([await one(adapter('l', 'Lista UY', ans('history'), { coversUruguay: true }), B)]);
  assert.equal(hist.history, true); assert.match(hist.notes[0], /antecedente/);
});

test('IMEI: fuente complementaria — un posible reporte pide revisión; un negativo no confirma', async () => {
  const comp = { complementary: true };
  const rs = [await one(adapter('cm', 'Desconocida', ans('reported'), comp)), await one(adapter('l', 'Lista UY', ans('clean'), { coversUruguay: true }))];
  const s = summarizeImei(rs);
  assert.equal(s.status, 'partial'); assert.equal(s.needsReview, true); assert.match(s.notes.join(' '), /fuente complementaria/);
  const d = summarizeDevice([s], false);
  assert.equal(d.status, 'partial'); assert.equal(d.needsReview, true);
  const neg = summarizeImei([await one(adapter('cm', 'Desconocida', ans('clean'), { ...comp, coversUruguay: true }))]);
  assert.equal(neg.status, 'partial'); assert.match(neg.notes.join(' '), /no confirma la ausencia/);
  const both = summarizeImei([await one(adapter('g', 'GSMA', ans('reported'))), await one(adapter('cm', 'X', ans('reported'), comp))]);
  assert.equal(both.status, 'reported');
});

test('IMEI: identificación por TAC nunca cuenta como chequeo de lista negra', async () => {
  const tac = parseProviderJson(JSON.stringify({ brand: 'Samsung', model: 'Galaxy A55' }));
  assert.equal(tac.status, 'tac_only'); assert.deepEqual(tac.model, { brand: 'Samsung', model: 'Galaxy A55' });
  const r = await one(adapter('tac', 'TAC', async () => tac, { coversUruguay: true }));
  const s = summarizeImei([r]);
  assert.equal(s.status, 'unverified'); assert.match(s.notes.join(' '), /TAC: no es un chequeo de lista negra/);
  const s2 = summarizeImei([r, await one(adapter('l', 'Lista UY', ans('clean'), { coversUruguay: true }))]);
  assert.equal(s2.status, 'clean'); assert.deepEqual(s2.bases, ['Lista UY']);
});

test('IMEI: cobertura limitada del IMEI 2 y consultas manuales pendientes', async () => {
  const lim = adapter('g', 'GSMA', ans('clean'), { coversUruguay: true, imei2Limited: true });
  const r = await one(lim, B);
  assert.equal(summarizeImei([r], { imei2: false }).status, 'clean', 'para el IMEI 1 vale');
  const s2 = summarizeImei([r], { imei2: true });
  assert.equal(s2.status, 'partial'); assert.match(s2.notes.join(' '), /cobertura limitada del IMEI 2/);
  const other = await one(adapter('l', 'Lista UY', ans('clean'), { coversUruguay: true }), B);
  assert.equal(summarizeImei([r, other], { imei2: true }).status, 'clean', 'el IMEI 2 se cubre con otra fuente');
  const pend = { ...other, provider: 'imeipro', status: 'manual_pending' as const, manual: true, complementary: true };
  assert.equal(summarizeImei([other, pend]).status, 'clean', 'una consulta manual sin registrar no es una falla');
  assert.equal(summarizeImei([pend]).status, 'unverified');
});

test('IMEI: dos IMEI con resultados distintos conservan la alerta del equipo; falta el IMEI 2 → parcial', () => {
  const mk = (status: 'reported' | 'clean') => ({ status, needsReview: false, history: false, notes: [] as string[], bases: ['X'] });
  const rep = mk('reported'), clean = mk('clean');
  const d = summarizeDevice([clean, rep], true);
  assert.equal(d.status, 'reported'); assert.equal(d.needsReview, true);
  assert.equal(summarizeDevice([clean], true).status, 'partial');
  assert.match(summarizeDevice([clean], false).notes[0], /1 IMEI consultado/);
  assert.equal(summarizeDevice([clean, clean], true).status, 'clean');
});

test('IMEI: fuentes por defecto — GSMA/Phonecheck/CheckMEND sin configurar, IMEICheck.com e IMEIpro manuales, sin salir de la PC', async () => {
  delete process.env.CEL_IMEI_MOCK;
  const c = new ImeiChecker();
  const { providers, operators } = c.providers();
  const by = Object.fromEntries(providers.map((p) => [p.id, p]));
  assert.deepEqual(Object.keys(by), ['gsma', 'phonecheck', 'checkmend', 'imeicheck', 'imeipro']);
  assert.ok(providers.every((p) => !p.auto), 'ninguna consulta automática sin acceso');
  assert.equal(by.imeipro.status, 'Consulta manual'); assert.equal(by.imeipro.manualUrl, 'https://www.imeipro.info/'); assert.equal(by.imeipro.manualLabel, 'Abrir IMEIpro');
  assert.equal(by.imeicheck.manualUrl, 'https://imeicheck.com/es/checar-lista-negra', 'verificador de lista negra, no el general por TAC');
  for (const p of providers) if (p.manualUrl) assert.ok(!/\d{14,}/.test(p.manualUrl), 'el enlace no lleva el IMEI');
  assert.ok(by.checkmend.complementary && by.imeicheck.complementary && by.imeipro.complementary);
  assert.ok(!by.gsma.complementary && !by.phonecheck.complementary);
  assert.deepEqual(operators.map((o) => o.name), ['Antel', 'Claro', 'Tigo']);
  const r = await c.check({ imei: A, provider: 'gsma' });
  assert.equal(r.status, 'not_configured');
  assert.equal(summarizeImei([r as SourceResult]).status, 'unverified');
});

/* ---------- Phonecheck ---------- */

const pcData = (blacklistStatus: string, history: object[] = [], extra: object = {}) => ({ data: { overall: 'good', responseStatus: 'success', imei: A, blacklistStatus,
  imeiHistory: history, make: 'Apple', model: 'iPhone 13', ...extra }, serviceProviders: [], fromCache: false });

test('Phonecheck: interpreta reporte, negativo, antecedente y formatos inesperados', () => {
  const rep = parsePhonecheck(pcData('Reported lost or stolen', [{ action: 'Block Insert', reasoncode: '0011', reasoncodedesc: 'Stolen or Lost', date: '2026-10-02', by: 'O2 UK', country: 'GB' }]));
  assert.equal(rep.status, 'reported'); assert.equal(rep.reportDate, '2026-10-02'); assert.match(rep.reason!, /Stolen or Lost · O2 UK · GB/);
  assert.deepEqual(rep.model, { brand: 'Apple', model: 'iPhone 13' });
  assert.equal(parsePhonecheck(pcData('Not reported lost or stolen')).status, 'clean');
  const hist = parsePhonecheck(pcData('Not reported lost or stolen', [{ action: 'Block Insert', reasoncodedesc: 'Stolen or Lost', date: '2025-01-05' }, { action: 'Block Remove', reasoncodedesc: 'Found', date: '2025-02-01' }]));
  assert.equal(hist.status, 'history');
  assert.equal(parsePhonecheck(pcData('Something new')).status, 'unexpected');
  assert.equal(parsePhonecheck({ data: { responseStatus: 'failure' } }).status, 'unexpected');
  assert.equal(parsePhonecheck(null).status, 'unexpected');
  assert.equal(parsePhonecheck(pcData('Not reported lost or stolen', [], { make: 'NA' })).model, null);
});

function fakeFetch(routes: (url: string, init: any) => { status: number; body: any }) {
  const calls: { url: string; init: any }[] = [];
  const f = (async (url: any, init: any) => { calls.push({ url: String(url), init }); const r = routes(String(url), init);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
  return { f, calls };
}

test('Phonecheck: inicia sesión con la clave de API, usa el encabezado indicado y renueva el token vencido', async () => {
  let logins = 0, expired = true;
  const { f, calls } = fakeFetch((url) => {
    if (url.endsWith('/v2/auth/api-token/login')) { logins++; return { status: 200, body: { token: `jwt${logins}`, tokenType: 'master', expiresIn: 86400, usage: { header: 'token_master' } } }; }
    if (url.includes(`/v2/imei/blacklist/${A}`)) {
      if (expired) { expired = false; return { status: 500, body: { msg: 'failed to validate token' } }; }
      return { status: 200, body: pcData('Not reported lost or stolen') };
    }
    if (url.includes(`/v2/imei/blacklist/${B}`)) return { status: 404, body: { msg: 'Device not found' } };
    return { status: 403, body: { msg: 'license limit exceeded' } };
  });
  const c = new ImeiChecker({ adapters: [phonecheckAdapter(info('phonecheck', 'GSMA Device Registry'), 'api-token-123456789', f)] });
  const r = await c.check({ imei: A, provider: 'phonecheck' });
  assert.equal(r.status, 'clean'); assert.equal(logins, 2, 'token vencido → nueva sesión una vez');
  assert.equal(calls[0].init.method, 'POST'); assert.deepEqual(JSON.parse(calls[0].init.body), { apiToken: 'api-token-123456789' });
  assert.equal(calls.at(-1)!.init.headers.token_master, 'jwt2');
  const nf = await c.check({ imei: B, provider: 'phonecheck' });
  assert.equal(nf.status, 'error'); assert.match(nf.message!, /no es un negativo/);
  const lic = await c.check({ imei: ZERO_LEAD, provider: 'phonecheck' });
  assert.equal(lic.status, 'error'); assert.match(lic.message!, /licencias/);
  assert.equal(summarizeImei([r]).status, 'partial', 'sin cobertura Uruguay confirmada no hay «Sin reporte»');
});

test('Phonecheck: la clave se guarda cifrada, nunca se devuelve y activa la consulta automática', async () => {
  delete process.env.CEL_IMEI_MOCK;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imei-'));
  const db = openDb(path.join(dir, 'c.db'));
  const secret = { encrypt: (s: string) => `enc:${Buffer.from(s).toString('base64')}`, decrypt: (s: string) => Buffer.from(s.slice(4), 'base64').toString() };
  const { f } = fakeFetch((url) => url.endsWith('/login') ? { status: 200, body: { token: 'jwt', usage: { header: 'token_master' } } }
    : { status: 200, body: pcData('Reported lost or stolen', [{ action: 'Block Insert', reasoncodedesc: 'Stolen or Lost', date: '2026-09-01' }]) });
  const c = new ImeiChecker({ db, secret, fetchImpl: f });
  assert.throws(() => c.configure({ provider: 'gsma', apiToken: 'x' }), /no se configura/);
  assert.throws(() => c.configure({ provider: 'phonecheck', apiToken: 'corta' }), /formato/);
  assert.throws(() => c.configure({ provider: 'phonecheck', apiToken: 'clave-de-api-larga-123', coversUruguay: true }), /confirmó por escrito/);
  const out = c.configure({ provider: 'phonecheck', apiToken: 'clave-de-api-larga-123' });
  assert.ok(!JSON.stringify(out).includes('clave-de-api-larga-123'), 'la respuesta no incluye la clave');
  const stored = String((db.prepare(`SELECT value FROM settings WHERE key = 'imeiProviders'`).get() as any).value);
  assert.ok(!stored.includes('clave-de-api-larga-123') && stored.includes('enc:'), 'guardada cifrada');
  const pc = out.providers.find((p) => p.id === 'phonecheck')!;
  assert.equal(pc.configured, true); assert.equal(pc.auto, true); assert.equal(pc.coversUruguay, false);
  const r = await c.check({ imei: A, provider: 'phonecheck' });
  assert.equal(r.status, 'reported'); assert.equal(r.reportDate, '2026-09-01');
  c.configure({ provider: 'phonecheck', coversUruguay: true, uyNote: 'Correo de Phonecheck 20/11/2026' });
  assert.equal(c.providers().providers.find((p) => p.id === 'phonecheck')!.coversUruguay, true);
  c.configure({ provider: 'phonecheck', apiToken: '' });
  assert.equal(c.providers().providers.find((p) => p.id === 'phonecheck')!.configured, false);
});
