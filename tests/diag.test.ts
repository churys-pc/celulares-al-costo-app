import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/server/db.ts';
import { DiagStore, phoneInfoFromUa } from '../src/server/diag.ts';
import { DiagLan, usableHost } from '../src/server/diagLan.ts';
import { Usbmux, UsbWatcher, readDevice, usbTiming } from '../src/server/usbmux.ts';
import { toXml, parseXml, parseBinary } from '../src/server/plist.ts';
import { verdict, TESTS, maskId, capacityGb, checkResult } from '../src/shared/diag.ts';
import { startFakeMux, SAMPLE_IPHONE } from './support/fakeUsbmux.ts';

const db = () => openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'diag-')), 'c.db'));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

test('Diagnóstico: veredicto sin aprobación global si faltan pruebas; «Falla» exige la falla observada', () => {
  assert.equal(verdict({}).key, 'incomplete');
  const all = Object.fromEntries(TESTS.map((t) => [t.key, { test: t.key, status: 'ok' as const, origin: 'manual' as const, detail: '', createdAt: '' }]));
  assert.equal(verdict(all).key, 'pass');
  assert.equal(verdict({ ...all, wifi: { ...all.wifi, status: 'unverified' } }).key, 'incomplete');
  assert.equal(verdict({ ...all, wifi: { ...all.wifi, status: 'observations' } }).key, 'observations');
  assert.equal(verdict({ ...all, wifi: { ...all.wifi, status: 'fail' } }).key, 'fail');
  assert.match(checkResult({ test: 'wifi', status: 'fail', origin: 'manual', detail: '' })!, /falla observada/);
  assert.match(checkResult({ test: 'wifi', status: 'na', origin: 'manual' })!, /No aplica/);
  assert.equal(checkResult({ test: 'lenses', status: 'na', origin: 'manual' }), null);
  assert.equal(maskId('351234567890124'), '35•••••••••0124');
  assert.equal(capacityGb(127989469184), 128); assert.equal(capacityGb(255_869_321_216), 256);
  assert.equal(phoneInfoFromUa(UA), 'iPhone · iOS 18.1 · Safari');
  assert.equal(usableHost('chury'), false); assert.equal(usableHost('192.168.1.34'), true); assert.equal(usableHost('diag.celularesalcosto.uy'), true);
});

test('Diagnóstico: QR de un solo uso, confirmación en Windows y credencial limitada a ese diagnóstico', () => {
  let now = Date.parse('2026-11-14T12:00:00Z');
  const s = new DiagStore(db(), () => now);
  const a = s.create('tecnico@x'), b = s.create('tecnico@x');
  assert.match(a.ref, /^D-\d{6}-001$/); assert.match(b.ref, /^D-\d{6}-002$/);
  const qr = s.newQr(a.id);
  const { credential, code } = s.claim(qr.token, UA);
  assert.match(code, /^\d{4}$/);
  assert.throws(() => s.claim(qr.token, UA), /ya se usó/, 'el token es de un solo uso');
  assert.equal(s.phoneState(credential).state, 'pending');
  assert.throws(() => s.phoneResult(credential, { test: 'screen', status: 'ok', nonce: 'n-00000001' }), /Falta confirmar/);
  const g = s.get(a.id);
  assert.equal(g.phone.pending.length, 1); assert.equal(g.phone.pending[0].code, code); assert.equal(g.phone.pending[0].info, 'iPhone · iOS 18.1 · Safari');
  s.confirmPhone(a.id, g.phone.pending[0].id, true);
  const st: any = s.phoneState(credential);
  assert.equal(st.state, 'active');
  assert.ok(!JSON.stringify(st).match(/D-2611|tecnico|serial|imei/i), 'Safari no recibe referencia, usuario ni identificadores');
  // Resultado con reintento duplicado: se guarda una vez.
  const r1 = s.phoneResult(credential, { test: 'screen', status: 'ok', nonce: 'nonce-screen-1' });
  const r2 = s.phoneResult(credential, { test: 'screen', status: 'ok', nonce: 'nonce-screen-1' });
  assert.equal(r1.duplicate, false); assert.equal(r2.duplicate, true);
  assert.equal(s.get(a.id).history.screen.length, 1);
  // La credencial no puede escribir en otro diagnóstico (el ID viene de la credencial, no del pedido).
  s.phoneResult(credential, { test: 'touch', status: 'ok', nonce: 'nonce-touch-1', diagId: b.id } as any);
  assert.equal(s.get(b.id).current.touch, undefined); assert.equal(s.get(a.id).current.touch.origin, 'safari');
  // Pruebas de Windows no se registran desde Safari.
  assert.throws(() => s.phoneResult(credential, { test: 'activation_lock', status: 'ok', nonce: 'nonce-al-1' }), /no se registra desde Safari/);
  // QR vencido.
  const q2 = s.newQr(a.id); now += 11 * 60_000;
  assert.throws(() => s.claim(q2.token, UA), /venció/);
  // Regenerar invalida el anterior.
  const q3 = s.newQr(a.id); s.newQr(a.id);
  assert.throws(() => s.claim(q3.token, UA), /reemplazado/);
  // Vincular otro iPhone desvincula el anterior.
  const q4 = s.newQr(a.id); const other = s.claim(q4.token, UA);
  s.confirmPhone(a.id, s.get(a.id).phone.pending[0].id, true);
  assert.equal(s.phoneState(credential).state, 'revoked'); assert.equal(s.phoneState(other.credential).state, 'active');
  // Cerrar invalida el acceso.
  s.close(a.id, { observations: 'ok' }, 'tecnico@x');
  assert.equal(s.phoneState(other.credential).state, 'closed');
  assert.throws(() => s.phoneResult(other.credential, { test: 'touch', status: 'ok', nonce: 'nonce-touch-9' }), /cerrado|terminada/);
  assert.throws(() => s.newQr(a.id), /cerrado/);
  assert.equal(s.get(a.id).verdict.key, 'incomplete');
});

test('Diagnóstico: repetir conserva el historial y usa el último intento', () => {
  const s = new DiagStore(db());
  const d = s.create(null);
  s.addResult(d.id, { test: 'speaker', status: 'fail', detail: 'No se escucha el tono' }, 'tec', 'manual');
  s.requestRepeat(d.id, 'speaker');
  assert.deepEqual(s.get(d.id).requests, ['speaker']);
  s.addResult(d.id, { test: 'speaker', status: 'ok', detail: '' }, 'tec', 'manual');
  const g = s.get(d.id);
  assert.equal(g.current.speaker.status, 'ok'); assert.equal(g.history.speaker.length, 2); assert.deepEqual(g.requests, []);
  assert.throws(() => s.requestRepeat(d.id, 'activation_lock'), /desde Windows/);
});

test('Diagnóstico: datos manuales validados; serie e IMEI enmascarados salvo a pedido', () => {
  const s = new DiagStore(db());
  const d = s.create(null);
  assert.throws(() => s.updateDevice(d.id, { imei1: '123' }), /15 dígitos/);
  assert.throws(() => s.updateDevice(d.id, { ios: 'dieciocho' }), /iOS/);
  s.updateDevice(d.id, { model: 'iPhone 13', ios: '18.1', capacityGb: 128, serial: 'F2LXK0ABCD12', imei1: '35 123456 7890124', battery: { settingsMaxPct: 87 } });
  const g = s.get(d.id);
  assert.equal(g.device.imei1, '35•••••••••0124'); assert.equal(g.device.serial, 'F2••••••CD12'); assert.equal(g.device.sources!.serial, 'manual');
  assert.equal(s.get(d.id, { reveal: true }).device.imei1, '351234567890124');
  assert.equal(g.device.battery!.settingsMaxPct, 87);
});

test('plist: XML ida y vuelta, y lectura de plist binario', () => {
  const v = { a: 'x & <y>', n: 42, big: 2n ** 60n, f: 1.5, t: true, d: Buffer.from('hola'), arr: [1, 'dos', { k: false }] };
  const back: any = parseXml(toXml(v));
  assert.equal(back.a, 'x & <y>'); assert.equal(back.n, 42); assert.equal(back.big, 2n ** 60n); assert.equal(back.f, 1.5); assert.equal(back.t, true);
  assert.equal(back.d.toString(), 'hola'); assert.deepEqual(back.arr, [1, 'dos', { k: false }]);
  // Formato de Apple: espacio entre etiquetas (se ignora) y espacios dentro de <string> (se conservan).
  const apple = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>DeviceList</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>DeviceID</key>\n\t\t\t<integer>3</integer>\n\t\t\t<key>Name</key>\n\t\t\t<string>  dos  espacios </string>\n\t\t\t<key>Empty</key>\n\t\t\t<string></string>\n\t\t</dict>\n\t</array>\n</dict>\n</plist>\n';
  assert.deepEqual(parseXml(apple), { DeviceList: [{ DeviceID: 3, Name: '  dos  espacios ', Empty: '' }] });
  // bplist00 armado a mano: { "HostID": "H1", "N": 7, "B": true }
  const objs = [Buffer.from([0xd3, 1, 2, 3, 4, 5, 6]), Buffer.from([0x56, ...Buffer.from('HostID')]), Buffer.from([0x51, ...Buffer.from('N')]), Buffer.from([0x51, ...Buffer.from('B')]),
    Buffer.from([0x52, ...Buffer.from('H1')]), Buffer.from([0x10, 7]), Buffer.from([0x09])];
  let off = 8; const offsets: number[] = []; for (const o of objs) { offsets.push(off); off += o.length; }
  const trailer = Buffer.alloc(32); trailer[6] = 1; trailer[7] = 1; trailer.writeBigUInt64BE(BigInt(objs.length), 8); trailer.writeBigUInt64BE(0n, 16); trailer.writeBigUInt64BE(BigInt(off), 24);
  const bp = Buffer.concat([Buffer.from('bplist00'), ...objs, Buffer.from(offsets), trailer]);
  assert.deepEqual(parseBinary(bp), { HostID: 'H1', N: 7, B: true });
});

test('USB: lectura con la PC autorizada (modelo, iOS, capacidad, serie, IMEI y batería) sin el nombre del equipo', async () => {
  const mux = await startFakeMux([SAMPLE_IPHONE()]);
  try {
    const m = new Usbmux({ host: '127.0.0.1', port: mux.port });
    const [dev] = await m.listDevices();
    const r = await readDevice(m, dev);
    assert.equal(r.state, 'connected');
    assert.equal(r.info.model, 'iPhone 13'); assert.equal(r.info.ios, '18.1'); assert.equal(r.info.capacityGb, 128);
    assert.equal(r.info.serial, 'F2LXK0ABCD12'); assert.equal(r.info.imei1, '351234567890124'); assert.equal(r.info.imei2, '359876543210983');
    assert.equal(r.info.modelNumber, 'MLPF3LL/A');
    assert.deepEqual(r.info.battery, { chargePct: 76, charging: true, cycles: 412, estimatedMaxPct: 87 });
    assert.ok(!JSON.stringify(r).includes('Juan'), 'no se lee el nombre del equipo (dato del cliente)');
    assert.deepEqual(r.missing, []);
  } finally { await mux.close(); }
});

test('USB: sesión cifrada como en un iPhone real (TLS con el certificado del emparejamiento)', async () => {
  const mux = await startFakeMux([SAMPLE_IPHONE({ ssl: true })]);
  try {
    const m = new Usbmux({ host: '127.0.0.1', port: mux.port });
    const [dev] = await m.listDevices();
    const r = await readDevice(m, dev);
    assert.equal(r.state, 'connected', r.detail ?? '');
    assert.equal(r.info.serial, 'F2LXK0ABCD12'); assert.equal(r.info.capacityGb, 128); assert.equal(r.info.battery!.cycles, 412);
  } finally { await mux.close(); }
});

test('USB: si la capacidad tarda (iOS calculando el uso), se conserva todo lo demás', async () => {
  const prev = { ...usbTiming }; usbTiming.disk = 600; usbTiming.slow = 600;
  const mux = await startFakeMux([SAMPLE_IPHONE({ ssl: true, noFactory: true, diskDelayMs: 5000 })]);
  try {
    const m = new Usbmux({ host: '127.0.0.1', port: mux.port });
    const [dev] = await m.listDevices();
    const r = await readDevice(m, dev);
    assert.equal(r.state, 'connected'); assert.equal(r.session, true);
    assert.equal(r.info.serial, 'F2LXK0ABCD12'); assert.equal(r.info.imei1, '351234567890124');
    assert.equal(r.info.battery!.chargePct, 76); assert.equal(r.info.battery!.cycles, 412);
    assert.equal(r.info.capacityGb, undefined); assert.deepEqual(r.missing, ['capacityGb']);
    assert.match(r.detail!, /^capacidad: .*tiempo de espera agotado/); assert.match(r.message!, /Editar/);
    // Con el dominio de fábrica, la capacidad sale al instante aunque el uso de disco sea lento.
    mux.devices[0] = SAMPLE_IPHONE({ ssl: true, diskDelayMs: 5000 });
    const r2 = await readDevice(m, dev);
    assert.equal(r2.info.capacityGb, 128); assert.equal(r2.detail, null);
  } finally { Object.assign(usbTiming, prev); await mux.close(); }
});

test('USB: si falla un paso se conserva lo leído y se informa en qué paso', async () => {
  const mux = await startFakeMux([SAMPLE_IPHONE({ ssl: true })]);
  try {
    const m = new Usbmux({ host: '127.0.0.1', port: mux.port });
    const [dev] = await m.listDevices();
    // Registro de emparejamiento con una clave que no corresponde al certificado: falla la conexión cifrada.
    const orig = m.readPairRecord.bind(m);
    m.readPairRecord = async (u: string) => ({ ...(await orig(u))!, HostPrivateKey: Buffer.from('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n') });
    const r = await readDevice(m, dev);
    assert.equal(r.state, 'error');
    assert.equal(r.info.model, 'iPhone 13'); assert.equal(r.info.ios, '18.1');
    assert.match(r.detail!, /^conexión cifrada: /); assert.match(r.message!, /Podés seguir/);
  } finally { await mux.close(); }
});

test('USB: sin autorización, bloqueado, sin servicio, otro tipo de equipo y varios iPhone', async () => {
  const mux = await startFakeMux([SAMPLE_IPHONE({ paired: false }), SAMPLE_IPHONE({ udid: 'B-2', deviceId: 8, locked: true, values: { ...SAMPLE_IPHONE().values, ProductType: 'iPhone17,3' } })]);
  try {
    const m = new Usbmux({ host: '127.0.0.1', port: mux.port });
    const [a, b] = await m.listDevices();
    const ra = await readDevice(m, a);
    assert.equal(ra.state, 'pending_trust'); assert.equal(ra.info.model, 'iPhone 13'); assert.equal(ra.info.ios, '18.1');
    assert.equal(ra.info.serial, undefined, 'sin autorización no hay serie ni IMEI'); assert.match(ra.message!, /Confiar/);
    const rb = await readDevice(m, b);
    assert.equal(rb.state, 'locked'); assert.equal(rb.info.model, 'iPhone 16');
    const w = new UsbWatcher(m);
    const list = await w.devices();
    assert.equal(list.service, 'ok'); assert.equal(list.devices.length, 2);
    assert.ok(list.devices.every((d) => /^[a-f0-9]{16}$/.test(d.key)), 'la pantalla recibe una clave opaca, no el UDID');
    assert.ok(!JSON.stringify(list).includes('00008110'));
    assert.match(list.detail!, /2 equipo\(s\)/);
    mux.devices.push({ ...SAMPLE_IPHONE({ udid: 'C-3', deviceId: 9 }), deviceClass: 'iPad' });
    assert.match((await readDevice(m, { deviceId: 9, udid: 'C-3' })).message!, /iPad/);
  } finally { await mux.close(); }
  const none = new UsbWatcher(new Usbmux([{ host: '127.0.0.1', port: 1 }, { host: '127.0.0.1', port: 2 }]));
  const r = await none.devices();
  assert.equal(r.service, 'unavailable'); assert.match(r.message!, /Dispositivos Apple/);
  assert.match(r.detail!, /127\.0\.0\.1:1 ECONNREFUSED, 127\.0\.0\.1:2 ECONNREFUSED/, 'muestra las direcciones probadas');
});

test('USB: si la primera dirección falla, prueba la siguiente; un iPhone solo por Wi‑Fi se avisa', async () => {
  const mux = await startFakeMux([SAMPLE_IPHONE()]);
  try {
    const m = new Usbmux([{ host: '127.0.0.1', port: 1 }, { host: '127.0.0.1', port: mux.port }]);
    assert.equal((await m.listDevices()).length, 1);
    const w = new UsbWatcher(m);
    assert.match((await w.devices()).detail!, new RegExp(`127\\.0\\.0\\.1:${mux.port} · 1 equipo`));
  } finally { await mux.close(); }
});

test('USB: al reconectar se verifica que sea el mismo equipo', async () => {
  const s = new DiagStore(db());
  const d = s.create(null);
  const mux = await startFakeMux([SAMPLE_IPHONE(), SAMPLE_IPHONE({ udid: 'OTRO-UDID', deviceId: 8, values: { ...SAMPLE_IPHONE().values, SerialNumber: 'G0000000ZZZZ' } })]);
  try {
    const m = new Usbmux({ host: '127.0.0.1', port: mux.port });
    const [a, b] = await m.listDevices();
    // El técnico corrigió la capacidad a mano: la lectura USB no la pisa.
    s.updateDevice(d.id, { capacityGb: 256 });
    const ra = await readDevice(m, a);
    const g = s.applyUsb(d.id, a.udid, ra.info, { state: 'connected' });
    assert.equal(g.device.model, 'iPhone 13'); assert.equal(g.device.capacityGb, 256); assert.equal(g.device.sources!.capacityGb, 'manual');
    assert.equal(g.device.sources!.serial, 'usb'); assert.equal(g.device.battery!.cycles, 412);
    assert.equal(s.sameDevice(d.id, a.udid), true); assert.equal(s.sameDevice(d.id, b.udid), false);
    const rb = await readDevice(m, b);
    assert.throws(() => s.applyUsb(d.id, b.udid, rb.info, { state: 'connected' }), /Es otro iPhone/);
  } finally { await mux.close(); }
});

test('Servidor para Safari: solo la página y la sesión del iPhone; datos inválidos y orígenes ajenos rechazados', async () => {
  const d = db();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-'));
  fs.mkdirSync(path.join(dir, 'web', 'phone'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'web', 'phone', 'phone.html'), '<html>ok</html>');
  const s = new DiagStore(d);
  const lan = new DiagLan(d, s, path.join(dir, 'web'), dir);
  d.prepare(`INSERT INTO settings (key, value) VALUES ('diagLan', ?)`).run(JSON.stringify({ port: 5199 + Math.floor(Math.random() * 400), host: '127.0.0.1' }));
  await lan.ensure();
  await assert.rejects(lan.configure({ host: 'chury' }), /nombre de la PC/);
  // Un nombre sin dominio guardado antes se ignora: el QR usa la IP.
  d.prepare(`UPDATE settings SET value = ? WHERE key = 'diagLan'`).run(JSON.stringify({ ...JSON.parse((d.prepare(`SELECT value FROM settings WHERE key = 'diagLan'`).get() as any).value), host: 'chury' }));
  assert.equal(lan.info().badHost, 'chury'); assert.notEqual(lan.info().host, 'chury');
  d.prepare(`UPDATE settings SET value = ? WHERE key = 'diagLan'`).run(JSON.stringify({ ...JSON.parse((d.prepare(`SELECT value FROM settings WHERE key = 'diagLan'`).get() as any).value), host: '127.0.0.1' }));
  const info = lan.info();
  assert.equal(info.running, true, info.error ?? ''); assert.equal(info.https, false); assert.match(info.note!, /HTTPS/);
  const base = `http://127.0.0.1:${info.port}`;
  try {
    const diagRow = s.create(null);
    const url = await lan.urlFor(s.newQr(diagRow.id).token);
    assert.match(url, new RegExp(`^${base}/d#t=[\\w-]{32}$`), 'el QR solo lleva el token, en el fragmento');
    assert.equal((await fetch(`${base}/d`)).status, 200);
    for (const p of ['/api/catalog/products', '/api/diag', '/', '/p/api/../api/diag', '/d/../celulares.db']) assert.equal((await fetch(base + p)).status, 404, p);
    const token = url.split('#t=')[1];
    const post = (p: string, body: any, h: Record<string, string> = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) });
    assert.equal((await post('/p/api/claim', { token }, { Origin: 'https://evil.example' })).status, 403);
    const claim = await (await post('/p/api/claim', { token }, { 'User-Agent': UA })).json() as any;
    assert.ok(claim.credential && claim.code);
    assert.equal((await post('/p/api/claim', { token })).status, 410);
    const sess = { 'X-Diag-Session': claim.credential };
    assert.equal(((await (await fetch(`${base}/p/api/state`, { headers: sess })).json()) as any).state, 'pending');
    s.confirmPhone(diagRow.id, s.get(diagRow.id).phone.pending[0].id, true);
    const st: any = await (await fetch(`${base}/p/api/state`, { headers: sess })).json();
    assert.equal(st.state, 'active'); assert.ok(st.tests.length > 5);
    assert.equal((await post('/p/api/result', { test: 'screen', status: 'rojo', nonce: 'abcdefgh1' }, sess)).status, 400);
    assert.equal((await post('/p/api/result', { test: 'screen', status: 'fail', nonce: 'abcdefgh2' }, sess)).status, 400, 'falla sin descripción');
    assert.equal((await post('/p/api/result', { test: 'screen', status: 'ok', nonce: 'abcdefgh3' }, { 'X-Diag-Session': 'x'.repeat(40) })).status, 401);
    assert.equal((await post('/p/api/result', { test: 'screen', status: 'ok', nonce: 'abcdefgh4' }, sess)).status, 200);
    const big = await fetch(`${base}/p/api/result`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...sess }, body: JSON.stringify({ test: 'screen', status: 'ok', detail: 'x'.repeat(20000) }) }).catch(() => null);
    assert.ok(!big || big.status === 413 || big.status === 400);
    assert.equal(s.get(diagRow.id).current.screen.origin, 'safari');
  } finally { await lan.stop(); }
});

test('Enlace seguro (túnel): el QR usa https cuando está listo; sin cloudflared, la red local', async () => {
  const d = db();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tun-'));
  fs.mkdirSync(path.join(dir, 'web', 'phone'), { recursive: true });
  const s = new DiagStore(d);
  d.prepare(`INSERT INTO settings (key, value) VALUES ('diagLan', ?)`).run(JSON.stringify({ port: 5600 + Math.floor(Math.random() * 300), host: '127.0.0.1' }));
  const lan = new DiagLan(d, s, path.join(dir, 'web'), dir, undefined, path.resolve('tests/support/fake-cloudflared.cjs'));
  try {
    await lan.ensure();
    const x = s.create(null);
    const url = await lan.urlFor(s.newQr(x.id).token);
    assert.match(url, /^https:\/\/prueba-enlace-seguro\.trycloudflare\.com\/d#t=[\w-]{32}$/);
    const i = lan.info();
    assert.equal(i.secure, true); assert.equal(i.note, null); assert.equal(i.tunnel.state, 'ready');
    // Pedidos que llegan por el túnel: origen https con el host del túnel.
    const base = `http://127.0.0.1:${i.port}`;
    const token = url.split('#t=')[1];
    const r = await fetch(`${base}/p/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `https://127.0.0.1:${i.port}`, 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify({ token }) });
    assert.equal(r.status, 200);
    // Apagado por el administrador: vuelve a la red local.
    await lan.configure({ tunnel: false });
    assert.match(await lan.urlFor(s.newQr(x.id).token), /^http:\/\/127\.0\.0\.1:/);
  } finally { await lan.stop(); }
  const none = new DiagLan(d, s, path.join(dir, 'web'), dir, undefined, path.join(dir, 'no-existe.exe'));
  try {
    d.prepare(`UPDATE settings SET value = ? WHERE key = 'diagLan'`).run(JSON.stringify({ port: 5600 + Math.floor(Math.random() * 300), host: '127.0.0.1' }));
    await none.ensure();
    const y = s.create(null);
    assert.match(await none.urlFor(s.newQr(y.id).token), /^http:\/\//);
    assert.equal(none.info().tunnel.available, false);
  } finally { await none.stop(); }
});
