import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateImei, maskImei, summarizeImei, summarizeDevice, type SourceResult } from '../src/shared/imei.ts';
import { ImeiChecker, parseProviderJson } from '../src/server/imei.ts';

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

type Q = (imei: string, signal: AbortSignal) => Promise<any>;
const adapter = (id: string, base: string, query: Q, coversUruguay = false) => ({
  info: { id, name: id.toUpperCase(), base, coverage: 'prueba', coversUruguay, configured: true, auto: true, retryCharges: false,
    reportTypes: '', update: '', terms: '', docs: '', howTo: '', status: 'ok' }, query });
const ans = (status: string, extra: object = {}) => async () => ({ status, reason: null, reportDate: null, model: null, message: null, ...extra });

test('IMEI: el IMEI inválido no genera tráfico; consultas idénticas en curso se comparten', async () => {
  let calls = 0;
  const slow = adapter('a', 'Base A', async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return { status: 'clean', reason: null, reportDate: null, model: null, message: null }; });
  const c = new ImeiChecker([slow]);
  assert.throws(() => c.check({ imei: '351234567890125', provider: 'a' }), /dígito de control/);
  assert.equal(calls, 0);
  const [r1, r2] = await Promise.all([c.check({ imei: A, provider: 'a' }), c.check({ imei: A, provider: 'a' })]);
  assert.equal(calls, 1, 'doble clic: una sola consulta');
  assert.equal(r1, r2);
  assert.equal(r1.imei, '35•••••••••0124', 'el resultado no trae el IMEI completo');
});

test('IMEI: caída de una fuente, respuesta inesperada y tiempo agotado nunca cuentan como negativo', async () => {
  const c = new ImeiChecker([
    adapter('down', 'Base A', async () => { throw new Error(`HTTP 503 para ${A}`); }),
    adapter('raro', 'Base B', async () => parseProviderJson('<html>ok</html>')),
    adapter('lento', 'Base C', (_i, signal) => new Promise((_ok, ko) => signal.addEventListener('abort', () => ko(new Error('abort'))))),
  ], 80);
  const rs = await Promise.all(['down', 'raro', 'lento'].map((p) => c.check({ imei: A, provider: p })));
  assert.deepEqual(rs.map((r) => r.status), ['error', 'unexpected', 'timeout']);
  assert.ok(!rs[0].message!.includes(A), 'el error no expone el IMEI');
  assert.equal(summarizeImei(rs).status, 'unverified');
});

test('IMEI: fuentes que discrepan mantienen la alerta; la misma base cuenta una vez; cobertura UY no confirmada → parcial', async () => {
  const c = new ImeiChecker([
    adapter('gsma', 'GSMA', ans('reported', { reason: 'Robo', reportDate: '2026-10-02', model: { brand: 'Apple', model: 'iPhone 13' } })),
    adapter('phonecheck', 'GSMA', ans('clean')),
    adapter('local', 'Lista UY', ans('clean'), true),
  ]);
  const rs = await Promise.all(['gsma', 'phonecheck', 'local'].map((p) => c.check({ imei: A, provider: p })));
  const s = summarizeImei(rs);
  assert.equal(s.status, 'reported'); assert.equal(s.needsReview, true);
  assert.deepEqual(s.bases.sort(), ['GSMA', 'Lista UY'], 'GSMA por dos servicios cuenta una vez');
  // Solo negativos sin cobertura de Uruguay confirmada → parcial.
  const only = summarizeImei([await new ImeiChecker([adapter('g', 'GSMA', ans('clean'))]).check({ imei: B, provider: 'g' })]);
  assert.equal(only.status, 'partial'); assert.match(only.notes.join(' '), /Cobertura Uruguay no confirmada/);
  // Negativo explícito con cobertura confirmada → sin reporte.
  const ok = summarizeImei([await new ImeiChecker([adapter('l', 'Lista UY', ans('clean'), true)]).check({ imei: B, provider: 'l' })]);
  assert.equal(ok.status, 'clean');
  // Antecedente retirado.
  const hist = summarizeImei([await new ImeiChecker([adapter('l', 'Lista UY', ans('history'), true)]).check({ imei: B, provider: 'l' })]);
  assert.equal(hist.history, true); assert.match(hist.notes[0], /antecedente/);
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

test('IMEI: sin proveedores configurados → «Proveedor sin configurar» y «No se pudo verificar», sin salir de la PC', async () => {
  delete process.env.CEL_IMEI_MOCK;
  const c = new ImeiChecker();
  const info = c.providers();
  assert.deepEqual(info.providers.map((p) => [p.id, p.status, p.auto]), [['gsma', 'Proveedor sin configurar', false], ['phonecheck', 'Proveedor sin configurar', false]]);
  assert.deepEqual(info.operators.map((o) => o.name), ['Antel', 'Claro', 'Tigo']);
  const r = await c.check({ imei: A, provider: 'gsma' });
  assert.equal(r.status, 'not_configured');
  assert.equal(summarizeImei([r as SourceResult]).status, 'unverified');
});
