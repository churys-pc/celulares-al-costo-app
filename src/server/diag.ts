// Diagnóstico de iPhone (servidor): diagnósticos, resultados con historial, vinculación de Safari por QR.
// - El QR lleva solo un token aleatorio de un solo uso (en el fragmento de la URL): sin datos del equipo ni del cliente.
// - Al abrirlo, Safari recibe una credencial temporal PENDIENTE; el técnico la confirma en Windows comparando un código.
// - La credencial solo sirve para ese diagnóstico y se invalida al cerrar, cancelar, regenerar o vincular otro iPhone.
// - Los resultados se validan y se deduplican por «nonce» (reintentos de red no duplican).
import crypto from 'node:crypto';
import type { Db } from './db.ts';
import { tx } from './db.ts';
import { ValidationError } from '../shared/types.ts';
import { TESTS, TEST_BY_KEY, PHONE_TESTS, checkResult, verdict, maskId, modelName, type DeviceInfo, type TestResult, type TestStatus, type TestOrigin } from '../shared/diag.ts';

export class DiagError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const QR_TTL_MS = 10 * 60_000;
const PENDING_TTL_MS = 10 * 60_000;
const PHONE_TTL_MS = 12 * 3600_000;
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const nowIso = (now: number) => new Date(now).toISOString();

/** Resumen del navegador sin identificadores: «iPhone · iOS 18.1 · Safari». */
export function phoneInfoFromUa(ua: string | undefined): string {
  const s = String(ua ?? '');
  const os = s.match(/(?:iPhone|CPU) OS (\d+)[_.](\d+)/);
  const dev = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : 'Otro dispositivo';
  const br = /CriOS/.test(s) ? 'Chrome' : /FxiOS/.test(s) ? 'Firefox' : /Safari/.test(s) && /Version\//.test(s) ? 'Safari' : 'Navegador';
  return [dev, os ? `iOS ${os[1]}.${os[2]}` : null, br].filter(Boolean).join(' · ');
}

const DEVICE_FIELDS = ['model', 'productType', 'modelNumber', 'ios', 'build', 'capacityGb', 'serial', 'imei1', 'imei2'] as const;

function cleanDevice(input: any, prev: DeviceInfo, origin: 'usb' | 'manual'): DeviceInfo {
  const out: DeviceInfo = { ...prev, sources: { ...(prev.sources ?? {}) } };
  for (const k of DEVICE_FIELDS) {
    if (input?.[k] === undefined) continue;
    let v: any = input[k];
    if (v === null || v === '') { (out as any)[k] = null; delete out.sources![k]; continue; }
    if (k === 'capacityGb') { v = Number(v); if (!Number.isInteger(v) || v < 8 || v > 4096) throw new ValidationError('Capacidad inválida'); }
    else {
      v = String(v).trim().slice(0, 60);
      if ((k === 'imei1' || k === 'imei2') && !/^\d{15}$/.test(v.replace(/[\s-]/g, ''))) throw new ValidationError('El IMEI tiene 15 dígitos');
      if (k === 'imei1' || k === 'imei2') v = v.replace(/[\s-]/g, '');
      if (k === 'serial' && !/^[A-Z0-9]{8,14}$/i.test(v)) throw new ValidationError('Número de serie inválido');
      if (k === 'ios' && !/^\d{1,2}(\.\d{1,2}){0,2}$/.test(v)) throw new ValidationError('Versión de iOS inválida (ej.: 18.1)');
    }
    (out as any)[k] = v; out.sources![k] = origin;
  }
  if (input?.battery !== undefined) {
    const b = input.battery ?? {}; const pb = prev.battery ?? {};
    const num = (x: any, lo: number, hi: number) => (x === null || x === '' || x === undefined ? null : Number.isFinite(Number(x)) && Number(x) >= lo && Number(x) <= hi ? Math.round(Number(x)) : (() => { throw new ValidationError('Dato de batería inválido'); })());
    out.battery = { ...pb };
    for (const [k, lo, hi] of [['chargePct', 0, 100], ['cycles', 0, 5000], ['estimatedMaxPct', 1, 150], ['settingsMaxPct', 1, 100]] as const) {
      if (b[k] !== undefined) { (out.battery as any)[k] = num(b[k], lo, hi); if (b[k] === null || b[k] === '') delete out.sources![`battery.${k}`]; else out.sources![`battery.${k}`] = origin; }
    }
    if (b.charging !== undefined) out.battery.charging = b.charging === null ? null : !!b.charging;
  }
  if (!out.model && out.productType) out.model = modelName(out.productType);
  return out;
}

export class DiagStore {
  constructor(private db: Db, private now: () => number = Date.now) {}

  /* ---------- Diagnósticos ---------- */

  create(by: string | null) {
    const id = crypto.randomUUID();
    const t = this.now();
    // Fecha local (la del local), no UTC.
    const ld = new Date(t); const day = `${String(ld.getFullYear()).slice(2)}${String(ld.getMonth() + 1).padStart(2, '0')}${String(ld.getDate()).padStart(2, '0')}`;
    const n = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM diagnostics WHERE ref LIKE ?`).get(`D-${day}-%`) as any).n) + 1;
    const ref = `D-${day}-${String(n).padStart(3, '0')}`;
    this.db.prepare(`INSERT INTO diagnostics (id, ref, status, created_at, updated_at, created_by) VALUES (?, ?, 'open', ?, ?, ?)`).run(id, ref, nowIso(t), nowIso(t), by);
    return this.get(id);
  }

  private row(id: string): any {
    const r = this.db.prepare('SELECT * FROM diagnostics WHERE id = ?').get(id);
    if (!r) throw new DiagError(404, 'Diagnóstico no encontrado');
    return r;
  }
  private open(id: string) {
    const r = this.row(id);
    if (r.status !== 'open') throw new DiagError(409, 'El diagnóstico ya está cerrado.');
    return r;
  }
  private touch(id: string) { this.db.prepare('UPDATE diagnostics SET updated_at = ? WHERE id = ?').run(nowIso(this.now()), id); }

  list(q = '', limit = 100) {
    const rows = this.db.prepare(`SELECT * FROM diagnostics ORDER BY created_at DESC LIMIT ?`).all(Math.min(500, limit)) as any[];
    const f = q.trim().toLowerCase();
    return rows.map((r) => {
      const d: DeviceInfo = JSON.parse(r.device);
      return { id: r.id, ref: r.ref, status: r.status, createdAt: r.created_at, closedAt: r.closed_at, createdBy: r.created_by,
        model: d.model ?? d.productType ?? null, ios: d.ios ?? null, capacityGb: d.capacityGb ?? null, verdict: r.verdict ?? verdict(this.current(r.id)).label };
    }).filter((r) => !f || [r.ref, r.model, r.ios].some((x) => String(x ?? '').toLowerCase().includes(f)));
  }

  /** Último intento confirmado de cada prueba. */
  current(id: string): Record<string, TestResult> {
    const rows = this.db.prepare(`SELECT * FROM diag_results WHERE diag_id = ? ORDER BY id`).all(id) as any[];
    const cur: Record<string, TestResult> = {};
    for (const r of rows) cur[r.test] = this.toResult(r);
    return cur;
  }
  private toResult(r: any): TestResult {
    return { test: r.test, status: r.status, origin: r.origin, detail: r.detail, data: r.data ? JSON.parse(r.data) : null, createdAt: r.created_at, by: r.created_by };
  }

  get(id: string, opts: { reveal?: boolean } = {}) {
    const r = this.row(id);
    const d: DeviceInfo = JSON.parse(r.device);
    const device = opts.reveal ? d : { ...d, serial: d.serial ? maskId(d.serial) : null, imei1: d.imei1 ? maskId(d.imei1) : null, imei2: d.imei2 ? maskId(d.imei2) : null };
    const rows = this.db.prepare(`SELECT * FROM diag_results WHERE diag_id = ? ORDER BY id`).all(id) as any[];
    const history: Record<string, TestResult[]> = {};
    for (const x of rows) (history[x.test] ??= []).push(this.toResult(x));
    const current = this.current(id);
    const t = this.now();
    const links = (this.db.prepare(`SELECT * FROM diag_links WHERE diag_id = ? AND state IN ('open','pending','active') ORDER BY created_at`).all(id) as any[])
      .filter((l) => Date.parse(l.expires_at) > t);
    const qr = links.filter((l) => l.kind === 'qr' && l.state === 'open').at(-1);
    const pending = links.filter((l) => l.kind === 'phone' && l.state === 'pending').map((l) => ({ id: l.id, code: l.code, info: l.phone_info, since: l.created_at }));
    const active = links.filter((l) => l.kind === 'phone' && l.state === 'active').at(-1);
    return {
      id: r.id, ref: r.ref, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at, createdBy: r.created_by,
      device, masked: !opts.reveal, usbState: r.usb_state ? JSON.parse(r.usb_state) : null, hasUsbIdentity: !!r.udid_hash,
      observations: r.observations, current, history, requests: JSON.parse(r.requests) as string[],
      verdict: r.status === 'closed' && r.verdict ? { ...verdict(current), label: r.verdict } : verdict(current),
      phone: { qrExpiresAt: qr?.expires_at ?? null, pending, active: active ? { id: active.id, info: active.phone_info, lastSeen: active.last_seen } : null },
    };
  }

  updateDevice(id: string, body: any) {
    const r = this.open(id);
    const d = cleanDevice(body, JSON.parse(r.device), 'manual');
    this.db.prepare('UPDATE diagnostics SET device = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(d), nowIso(this.now()), id);
    return this.get(id);
  }

  /** Datos leídos por USB. Si el diagnóstico ya tiene un equipo USB, debe ser el mismo. */
  applyUsb(id: string, udid: string, info: DeviceInfo, usbState: object) {
    const r = this.open(id);
    const h = hash(`diag:${udid}`);
    if (r.udid_hash && r.udid_hash !== h) throw new DiagError(409, 'Es otro iPhone: no coincide con el equipo de este diagnóstico. Conectá el mismo equipo o iniciá un diagnóstico nuevo.');
    const prev: DeviceInfo = JSON.parse(r.device);
    // Lo leído por USB no pisa lo que el técnico corrigió a mano para ese campo.
    const keep = (k: string) => prev.sources?.[k] === 'manual';
    const patch: any = {};
    for (const k of DEVICE_FIELDS) if ((info as any)[k] != null && !keep(k)) patch[k] = (info as any)[k];
    if (info.battery) {
      patch.battery = {};
      for (const k of ['chargePct', 'cycles', 'estimatedMaxPct', 'charging'] as const) if (info.battery[k] != null && !keep(`battery.${k}`)) patch.battery[k] = info.battery[k];
    }
    const d = cleanDevice(patch, prev, 'usb');
    this.db.prepare('UPDATE diagnostics SET device = ?, udid_hash = ?, usb_state = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(d), h, JSON.stringify(usbState), nowIso(this.now()), id);
    return this.get(id);
  }
  /** Modelo e iOS leídos sin autorización (sin fijar la identidad del equipo). No pisa lo cargado a mano. */
  updateDeviceFromUsbBasic(id: string, info: DeviceInfo) {
    const r = this.open(id);
    const prev: DeviceInfo = JSON.parse(r.device);
    const patch: any = {};
    for (const k of ['productType', 'ios', 'build'] as const) if (info[k] && prev.sources?.[k] !== 'manual') patch[k] = info[k];
    if (info.model && prev.sources?.model !== 'manual') patch.model = info.model;
    const d = cleanDevice(patch, prev, 'usb');
    this.db.prepare('UPDATE diagnostics SET device = ? WHERE id = ?').run(JSON.stringify(d), id);
  }
    setUsbState(id: string, usbState: object) {
    this.row(id);
    this.db.prepare('UPDATE diagnostics SET usb_state = ? WHERE id = ?').run(JSON.stringify(usbState), id);
  }
  sameDevice(id: string, udid: string): boolean | null {
    const r = this.row(id);
    return r.udid_hash ? r.udid_hash === hash(`diag:${udid}`) : null;
  }

  /* ---------- Resultados ---------- */

  addResult(id: string, body: any, by: string | null, forceOrigin?: TestOrigin) {
    this.open(id);
    const origin = forceOrigin ?? body?.origin;
    const err = checkResult({ ...body, origin });
    if (err) throw new ValidationError(err);
    const nonce = body?.nonce == null ? null : String(body.nonce).slice(0, 64);
    if (nonce && !/^[\w-]{8,64}$/.test(nonce)) throw new ValidationError('Identificador de envío inválido');
    let data: string | null = null;
    if (body?.data != null) {
      data = JSON.stringify(body.data);
      if (data.length > 4000) throw new ValidationError('Datos de la prueba demasiado grandes');
    }
    return tx(this.db, () => {
      if (nonce) {
        const dup = this.db.prepare('SELECT * FROM diag_results WHERE diag_id = ? AND nonce = ?').get(id, nonce);
        if (dup) return { duplicate: true, result: this.toResult(dup) };
      }
      this.db.prepare(`INSERT INTO diag_results (diag_id, test, status, origin, detail, data, created_at, created_by, nonce) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, body.test, body.status as TestStatus, origin, String(body.detail ?? '').trim(), data, nowIso(this.now()), by, nonce);
      // Un resultado nuevo atiende el pedido de repetir esa prueba.
      const req = (JSON.parse(this.row(id).requests) as string[]).filter((k) => k !== body.test);
      this.db.prepare('UPDATE diagnostics SET requests = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(req), nowIso(this.now()), id);
      return { duplicate: false, result: this.current(id)[body.test] };
    });
  }

  /** «Repetir»: Safari vuelve a mostrar la prueba; el resultado anterior se conserva en el historial. */
  requestRepeat(id: string, test: string) {
    const r = this.open(id);
    if (!TEST_BY_KEY.get(test)?.phone) throw new ValidationError('Esta prueba se completa desde Windows');
    const req = new Set(JSON.parse(r.requests) as string[]); req.add(test);
    this.db.prepare('UPDATE diagnostics SET requests = ?, updated_at = ? WHERE id = ?').run(JSON.stringify([...req]), nowIso(this.now()), id);
    return this.get(id);
  }

  close(id: string, body: any, by: string | null) {
    this.open(id);
    const obs = String(body?.observations ?? '').trim().slice(0, 2000);
    const v = verdict(this.current(id));
    tx(this.db, () => {
      this.db.prepare(`UPDATE diagnostics SET status = 'closed', closed_at = ?, observations = ?, verdict = ?, updated_at = ?, requests = '[]' WHERE id = ?`)
        .run(nowIso(this.now()), obs, v.label, nowIso(this.now()), id);
      this.revokeAll(id);
    });
    return this.get(id);
  }
  cancel(id: string) {
    this.open(id);
    tx(this.db, () => {
      this.db.prepare(`UPDATE diagnostics SET status = 'cancelled', closed_at = ?, updated_at = ? WHERE id = ?`).run(nowIso(this.now()), nowIso(this.now()), id);
      this.revokeAll(id);
    });
    return this.get(id);
  }
  saveObservations(id: string, body: any) {
    this.open(id);
    this.db.prepare('UPDATE diagnostics SET observations = ?, updated_at = ? WHERE id = ?').run(String(body?.observations ?? '').slice(0, 2000), nowIso(this.now()), id);
    return { ok: true };
  }
  private revokeAll(id: string) { this.db.prepare(`UPDATE diag_links SET state = 'revoked' WHERE diag_id = ? AND state IN ('open','pending','active')`).run(id); }

  /* ---------- Vinculación de Safari ---------- */

  /** QR nuevo: invalida el anterior. Devuelve el token en claro una sola vez (se guarda solo su hash). */
  newQr(id: string) {
    this.open(id);
    const token = rand(24);
    const t = this.now();
    tx(this.db, () => {
      this.db.prepare(`UPDATE diag_links SET state = 'revoked' WHERE diag_id = ? AND kind = 'qr' AND state = 'open'`).run(id);
      this.db.prepare(`INSERT INTO diag_links (id, diag_id, kind, token_hash, state, created_at, expires_at) VALUES (?, ?, 'qr', ?, 'open', ?, ?)`)
        .run(crypto.randomUUID(), id, hash(token), nowIso(t), nowIso(t + QR_TTL_MS));
    });
    return { token, expiresAt: nowIso(t + QR_TTL_MS) };
  }

  /** Safari abre el QR: consume el token y recibe una credencial pendiente de confirmación en Windows. */
  claim(token: unknown, ua?: string) {
    if (typeof token !== 'string' || !/^[\w-]{20,64}$/.test(token)) throw new DiagError(400, 'Enlace inválido. Escaneá el QR de nuevo.');
    const t = this.now();
    return tx(this.db, () => {
      const l = this.db.prepare(`SELECT * FROM diag_links WHERE token_hash = ? AND kind = 'qr'`).get(hash(token)) as any;
      if (!l || l.state !== 'open') throw new DiagError(410, 'Este QR ya se usó o fue reemplazado. Pedí uno nuevo en la PC.');
      if (Date.parse(l.expires_at) <= t) throw new DiagError(410, 'El QR venció. Pedí uno nuevo en la PC.');
      const d = this.row(l.diag_id);
      if (d.status !== 'open') throw new DiagError(410, 'El diagnóstico ya está cerrado.');
      this.db.prepare(`UPDATE diag_links SET state = 'used', used_at = ? WHERE id = ?`).run(nowIso(t), l.id);
      const credential = rand(32);
      const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
      this.db.prepare(`INSERT INTO diag_links (id, diag_id, kind, token_hash, state, created_at, expires_at, code, phone_info, last_seen) VALUES (?, ?, 'phone', ?, 'pending', ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), l.diag_id, hash(credential), nowIso(t), nowIso(t + PENDING_TTL_MS), code, phoneInfoFromUa(ua), nowIso(t));
      return { credential, code };
    });
  }

  /** El técnico confirma (o rechaza) en Windows que es el iPhone correcto. Confirmar desvincula cualquier otro iPhone. */
  confirmPhone(id: string, linkId: string, accept: boolean) {
    this.open(id);
    const l = this.db.prepare(`SELECT * FROM diag_links WHERE id = ? AND diag_id = ? AND kind = 'phone'`).get(linkId, id) as any;
    if (!l || l.state !== 'pending' || Date.parse(l.expires_at) <= this.now()) throw new DiagError(410, 'La solicitud ya no está vigente: generá un QR nuevo.');
    tx(this.db, () => {
      if (accept) {
        this.db.prepare(`UPDATE diag_links SET state = 'revoked' WHERE diag_id = ? AND kind = 'phone' AND state IN ('active','pending') AND id <> ?`).run(id, linkId);
        this.db.prepare(`UPDATE diag_links SET state = 'active', expires_at = ? WHERE id = ?`).run(nowIso(this.now() + PHONE_TTL_MS), linkId);
      } else this.db.prepare(`UPDATE diag_links SET state = 'revoked' WHERE id = ?`).run(linkId);
    });
    return this.get(id);
  }
  disconnectPhone(id: string) {
    this.row(id);
    this.db.prepare(`UPDATE diag_links SET state = 'revoked' WHERE diag_id = ? AND kind = 'phone' AND state IN ('active','pending')`).run(id);
    return this.get(id);
  }

  /** Credencial de Safari → su enlace (solo de ESE diagnóstico). */
  private phoneLink(credential: unknown) {
    if (typeof credential !== 'string' || !/^[\w-]{20,64}$/.test(credential)) throw new DiagError(401, 'Sesión inválida. Escaneá el QR de nuevo.');
    const l = this.db.prepare(`SELECT * FROM diag_links WHERE token_hash = ? AND kind = 'phone'`).get(hash(credential)) as any;
    if (!l) throw new DiagError(401, 'Sesión inválida. Escaneá el QR de nuevo.');
    return l;
  }

  phoneState(credential: unknown) {
    const l = this.phoneLink(credential);
    const d = this.row(l.diag_id);
    const expired = Date.parse(l.expires_at) <= this.now();
    const state = d.status !== 'open' ? 'closed' : l.state === 'revoked' || expired ? 'revoked' : l.state === 'pending' ? 'pending' : 'active';
    if (state === 'active' || state === 'pending') this.db.prepare('UPDATE diag_links SET last_seen = ? WHERE id = ?').run(nowIso(this.now()), l.id);
    if (state !== 'active') return { state, code: state === 'pending' ? l.code : null };
    const cur = this.current(l.diag_id);
    // Sin identificadores del equipo ni del cliente: solo el estado de cada prueba.
    return {
      state, code: null, requests: JSON.parse(d.requests) as string[],
      tests: TESTS.filter((t) => t.phone).map((t) => ({ key: t.key, label: t.label, group: t.group, how: t.how, perception: !!t.perception, naAllowed: !!t.naAllowed,
        status: cur[t.key]?.status ?? null, origin: cur[t.key]?.origin ?? null })),
    };
  }

  phoneResult(credential: unknown, body: any) {
    const l = this.phoneLink(credential);
    if (l.state !== 'active' || Date.parse(l.expires_at) <= this.now()) throw new DiagError(403, l.state === 'pending' ? 'Falta confirmar el iPhone en la PC.' : 'Sesión terminada. Escaneá el QR de nuevo.');
    if (!PHONE_TESTS.includes(String(body?.test))) throw new ValidationError('Esta prueba no se registra desde Safari');
    // El diagnóstico sale SIEMPRE de la credencial: un iPhone no puede escribir en otro diagnóstico.
    // Origen: «Safari» si lo midió la página; «Manual» si el técnico lo comprobó a mano y lo marcó desde el iPhone.
    const origin: TestOrigin = body?.origin === 'manual' ? 'manual' : 'safari';
    const r = this.addResult(l.diag_id, { test: body.test, status: body.status, detail: body.detail, data: body.data, nonce: body.nonce }, 'Safari', origin);
    this.db.prepare('UPDATE diag_links SET last_seen = ? WHERE id = ?').run(nowIso(this.now()), l.id);
    return { ok: true, duplicate: r.duplicate };
  }
}
