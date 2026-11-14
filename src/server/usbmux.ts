// Lectura USB del iPhone en Windows a través del servicio de Apple («Apple Mobile Device Service», que instalan la app
// Dispositivos Apple o iTunes). Ese servicio expone usbmuxd en 127.0.0.1:27015; por ahí se habla con lockdownd.
//
// Alcance (solo lectura de metadatos autorizados):
// - Detectar equipos y saber si la PC está autorizada («Confiar»). La autorización la hace Dispositivos Apple / iTunes:
//   esta app NO empareja, NO hace copias, NO restaura, NO cambia ajustes, NO extrae archivos y NO evita bloqueos.
// - Sin autorización: modelo, versión de iOS y compilación (lo que lockdownd entrega sin sesión).
// - Con autorización (registro de emparejamiento existente): serie, IMEI, número de modelo, capacidad, carga actual y,
//   si el servicio de diagnóstico lo expone, ciclos y capacidad estimada de la batería.
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { toXml, parseAny, type PlistValue } from './plist.ts';
import { capacityGb, modelName, type DeviceInfo } from '../shared/diag.ts';

export type UsbState = 'service_unavailable' | 'none' | 'pending_trust' | 'locked' | 'connected' | 'error';

export interface MuxAddress { host?: string; port?: number; path?: string }
const parseAddr = (v: string): MuxAddress | null => {
  if (/^unix:/.test(v)) return { path: v.slice(5) };
  const m = v.match(/^\[?([^\]]+?)\]?:(\d{2,5})$/);
  return m ? { host: m[1], port: Number(m[2]) } : null;
};
/** Direcciones donde puede estar el servicio de Apple, en orden. */
export function muxAddresses(): MuxAddress[] {
  const env = process.env.CEL_USBMUX_ADDR; // solo desarrollo y pruebas (simulador)
  if (env) return [parseAddr(env)!];
  const out: MuxAddress[] = [];
  // Variable estándar de usbmuxd (la respetan otras herramientas).
  const std = process.env.USBMUXD_SOCKET_ADDRESS && parseAddr(process.env.USBMUXD_SOCKET_ADDRESS);
  if (std) out.push(std);
  if (process.platform === 'win32') out.push({ host: '127.0.0.1', port: 27015 }, { host: '::1', port: 27015 }, { host: 'localhost', port: 27015 });
  else out.push({ path: '/var/run/usbmuxd' });
  return out;
}
export const defaultMuxAddress = () => muxAddresses()[0];
const addrText = (a: MuxAddress) => (a.path ? a.path : `${a.host?.includes(':') ? `[${a.host}]` : a.host}:${a.port}`);

/** Lector con búfer para mensajes con prefijo de longitud. */
class Reader {
  private buf = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  private ended: Error | null = null;
  constructor(private sock: net.Socket | tls.TLSSocket) {
    sock.on('data', (d: Buffer) => { this.buf = Buffer.concat([this.buf, d]); this.wake(); });
    sock.on('end', () => { this.ended ??= new Error('conexión cerrada'); this.wake(); });
    sock.on('close', () => { this.ended ??= new Error('conexión cerrada'); this.wake(); });
    sock.on('error', (e) => { this.ended = e; this.wake(); });
  }
  private wake() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }
  async read(n: number, timeoutMs: number): Promise<Buffer> {
    const until = Date.now() + timeoutMs;
    while (this.buf.length < n) {
      if (this.ended) throw this.ended;
      const left = until - Date.now();
      if (left <= 0) throw new Error('tiempo de espera agotado');
      await new Promise<void>((r) => { const t = setTimeout(r, left); this.waiters.push(() => { clearTimeout(t); r(); }); });
    }
    const out = this.buf.subarray(0, n); this.buf = this.buf.subarray(n);
    return Buffer.from(out);
  }
  detach() { this.sock.removeAllListeners('data'); this.sock.removeAllListeners('end'); this.sock.removeAllListeners('close'); this.sock.removeAllListeners('error'); this.sock.on('error', () => {}); }
}

const TIMEOUT = 8_000;
let tag = 1;

export class Usbmux {
  private addrs: MuxAddress[];
  private good: MuxAddress | null = null;
  /** Detalle técnico de la última falla de conexión (para mostrar en pantalla). */
  lastError: string | null = null;
  constructor(addr?: MuxAddress | MuxAddress[]) { this.addrs = addr ? (Array.isArray(addr) ? addr : [addr]) : muxAddresses(); }

  private openAt(a: MuxAddress): Promise<net.Socket> {
    return new Promise((ok, ko) => {
      const s = a.path ? net.connect(a.path) : net.connect(a.port!, a.host!);
      const t = setTimeout(() => { s.destroy(); ko(Object.assign(new Error('no responde'), { code: 'ETIMEDOUT' })); }, 3000);
      s.once('connect', () => { clearTimeout(t); ok(s); });
      s.once('error', (e) => { clearTimeout(t); ko(e); });
    });
  }
  /** Prueba la dirección que funcionó la última vez y, si falla, las demás. */
  private async open(): Promise<net.Socket> {
    const order = this.good ? [this.good, ...this.addrs.filter((x) => x !== this.good)] : this.addrs;
    const errs: string[] = [];
    for (const a of order) {
      try { const s = await this.openAt(a); this.good = a; return s; }
      catch (e) { errs.push(`${addrText(a)} ${(e as any)?.code ?? (e as Error)?.message ?? 'error'}`); }
    }
    this.good = null;
    this.lastError = `Sin conexión al servicio de Apple (${errs.join(', ')})`;
    throw Object.assign(new Error(this.lastError), { code: 'MUX_UNAVAILABLE' });
  }

  private async exchange(sock: net.Socket, reader: Reader, msg: Record<string, PlistValue>) {
    const body = Buffer.from(toXml({ ClientVersionString: 'celulares-al-costo', ProgName: 'CelularesAlCosto', kLibUSBMuxVersion: 3, ...msg }), 'utf8');
    const head = Buffer.alloc(16);
    head.writeUInt32LE(16 + body.length, 0); head.writeUInt32LE(1, 4); head.writeUInt32LE(8, 8); head.writeUInt32LE(tag++, 12);
    sock.write(Buffer.concat([head, body]));
    const h = await reader.read(16, TIMEOUT);
    const len = h.readUInt32LE(0);
    if (len < 16 || len > 4_000_000) throw new Error('respuesta usbmux inválida');
    return parseAny(await reader.read(len - 16, TIMEOUT)) as Record<string, any>;
  }

  private async once(msg: Record<string, PlistValue>) {
    const s = await this.open(); const r = new Reader(s);
    try { return await this.exchange(s, r, msg); } finally { s.destroy(); }
  }

  /** Equipos por cable. `raw` cuenta todo lo que informó el servicio (incluye equipos por Wi‑Fi). */
  lastRaw: { total: number; network: number; address: string | null } = { total: 0, network: 0, address: null };
  async listDevices(): Promise<{ deviceId: number; udid: string }[]> {
    const r = await this.once({ MessageType: 'ListDevices' });
    const all = (Array.isArray(r.DeviceList) ? r.DeviceList : []).map((d: any) => {
      const p = d.Properties ?? {};
      return { deviceId: Number(d.DeviceID ?? p.DeviceID), udid: String(p.SerialNumber ?? p.UDID ?? p.UniqueDeviceID ?? ''), conn: p.ConnectionType };
    });
    this.lastRaw = { total: all.length, network: all.filter((d: any) => d.conn === 'Network').length, address: this.good ? addrText(this.good) : null };
    this.lastError = null;
    // Si el mismo iPhone figura por cable y por Wi‑Fi, se usa el cable; uno solo por Wi‑Fi no sirve para leer.
    return all.filter((d: any) => d.udid && Number.isFinite(d.deviceId) && d.conn !== 'Network');
  }

  /** Registro de emparejamiento que guardó el servicio de Apple al tocar «Confiar». null si la PC no está autorizada. */
  async readPairRecord(udid: string): Promise<Record<string, any> | null> {
    const r = await this.once({ MessageType: 'ReadPairRecord', PairRecordID: udid });
    if (!Buffer.isBuffer(r.PairRecordData)) return null;
    try { return parseAny(r.PairRecordData) as Record<string, any>; } catch { return null; }
  }

  /** Abre un túnel a un puerto del iPhone (62078 = lockdownd). */
  async connect(deviceId: number, port: number): Promise<net.Socket> {
    const s = await this.open(); const r = new Reader(s);
    const res = await this.exchange(s, r, { MessageType: 'Connect', DeviceID: deviceId, PortNumber: ((port & 0xff) << 8) | (port >> 8) });
    r.detach();
    if (Number(res.Number) !== 0) { s.destroy(); throw Object.assign(new Error(`conexión rechazada (${res.Number})`), { code: 'MUX_REFUSED' }); }
    return s;
  }
}

/** Conversación con lockdownd o con un servicio (mensajes plist XML con longitud de 4 bytes big-endian). */
class PlistChannel {
  reader: Reader;
  constructor(public sock: net.Socket | tls.TLSSocket) { this.reader = new Reader(sock); }
  async send(obj: Record<string, PlistValue>) {
    const body = Buffer.from(toXml(obj), 'utf8'); const h = Buffer.alloc(4); h.writeUInt32BE(body.length, 0);
    this.sock.write(Buffer.concat([h, body]));
  }
  async recv(): Promise<Record<string, any>> {
    const len = (await this.reader.read(4, TIMEOUT)).readUInt32BE(0);
    if (len > 8_000_000) throw new Error('respuesta demasiado grande');
    const b = await this.reader.read(len, TIMEOUT);
    return parseAny(b) as Record<string, any>;
  }
  async request(obj: Record<string, PlistValue>) { await this.send({ Label: 'CelularesAlCosto', ...obj }); return this.recv(); }
  /** Pasa a TLS con el certificado del emparejamiento (lo exige lockdownd al iniciar la sesión). */
  async upgrade(pair: Record<string, any>) {
    this.reader.detach();
    const pem = (x: any) => (Buffer.isBuffer(x) ? x.toString('utf8') : String(x));
    const base = { socket: this.sock as net.Socket, cert: pem(pair.HostCertificate), key: pem(pair.HostPrivateKey), rejectUnauthorized: false,
      checkServerIdentity: () => undefined, minVersion: 'TLSv1' as const };
    // OpenSSL (Node) necesita bajar el nivel de seguridad para los certificados de emparejamiento; BoringSSL (Electron)
    // no entiende «@SECLEVEL» y rechaza la lista: en ese caso se conecta sin esa opción.
    let s: tls.TLSSocket;
    try { s = tls.connect(process.versions.electron ? base : { ...base, ciphers: 'DEFAULT:@SECLEVEL=0' }); }
    catch { s = tls.connect(base); }
    await new Promise<void>((ok, ko) => {
      const t = setTimeout(() => ko(new Error('el cifrado no respondió')), TIMEOUT);
      s.once('secureConnect', () => { clearTimeout(t); ok(); });
      s.once('error', (e) => { clearTimeout(t); ko(e); });
    });
    this.sock = s; this.reader = new Reader(s);
  }
  close() { try { this.sock.destroy(); } catch {} }
}

const BASIC_KEYS = ['ProductType', 'ProductVersion', 'BuildVersion', 'DeviceClass'];

export interface UsbReading { state: UsbState; info: DeviceInfo; read: string[]; missing: string[]; message: string | null; detail?: string | null }

/** Texto técnico corto, sin identificadores largos. */
export const techText = (e: any) => String(e?.code ? `${e.code} ${e.message ?? ''}` : e?.message ?? e ?? '').replace(/[0-9A-F]{8}-?[0-9A-F]{8,}/gi, '•••').replace(/\s+/g, ' ').trim().slice(0, 140);

function errText(e: any): string { return String(e?.Error ?? e?.message ?? e ?? '').slice(0, 80); }

/** Lee los datos autorizados de un iPhone. Nunca cambia nada en el equipo. */
export async function readDevice(mux: Usbmux, dev: { deviceId: number; udid: string }): Promise<UsbReading> {
  const info: DeviceInfo = { battery: {} };
  const read: string[] = [];
  let step = 'conexión con el iPhone';
  let ld: PlistChannel;
  try { ld = new PlistChannel(await mux.connect(dev.deviceId, 62078)); }
  catch (e) { return { state: 'error', info, read, missing: [], message: 'No se pudo abrir la conexión con el iPhone. Desconectalo, desbloquealo y volvé a conectarlo.', detail: `${step}: ${techText(e)}` }; }
  try {
    step = 'consulta inicial';
    const qt = await ld.request({ Request: 'QueryType' });
    if (qt.Type !== 'com.apple.mobile.lockdown') throw new Error('el equipo no respondió como un iPhone');
    // Sin sesión: lo que el iPhone entrega a cualquier PC.
    const basic = await ld.request({ Request: 'GetValue' });
    const bv = (basic.Value ?? {}) as Record<string, any>;
    if (bv.DeviceClass && bv.DeviceClass !== 'iPhone') return { state: 'error', info, read, missing: [], message: `El equipo conectado es un ${bv.DeviceClass}: el diagnóstico es para iPhone.` };
    if (bv.ProductType) { info.productType = String(bv.ProductType); info.model = modelName(info.productType); read.push('model'); }
    if (bv.ProductVersion) { info.ios = String(bv.ProductVersion); read.push('ios'); }
    if (bv.BuildVersion) info.build = String(bv.BuildVersion);
    step = 'registro de autorización';
    const pair = await mux.readPairRecord(dev.udid);
    const partial = (state: UsbState, message: string): UsbReading => ({ state, info, read, missing: ['capacityGb', 'serial', 'imei1', 'battery'], message });
    if (!pair?.HostID || !pair?.HostCertificate) return partial('pending_trust', 'La PC no está autorizada: desbloqueá el iPhone, abrí Dispositivos Apple (o iTunes) y tocá «Confiar» en el iPhone.');
    step = 'inicio de sesión';
    const ss = await ld.request({ Request: 'StartSession', HostID: pair.HostID, SystemBUID: pair.SystemBUID });
    if (ss.Error) {
      if (/PasswordProtected/i.test(ss.Error)) return partial('locked', 'Desbloqueá el iPhone y volvé a intentar.');
      if (/InvalidHostID|PairingDialogResponsePending|UserDeniedPairing|InvalidPairRecord/i.test(ss.Error)) return partial('pending_trust', 'El iPhone no tiene autorizada esta PC: desbloquealo y tocá «Confiar» (si no aparece, abrí Dispositivos Apple con el iPhone conectado).');
      return partial('error', 'El iPhone no aceptó la sesión. Desconectalo, desbloquealo y volvé a conectarlo.');
    }
    step = 'conexión cifrada';
    if (ss.EnableSessionSSL) await ld.upgrade(pair);
    step = 'datos del equipo';
    const full = ((await ld.request({ Request: 'GetValue' })).Value ?? {}) as Record<string, any>;
    if (full.SerialNumber) { info.serial = String(full.SerialNumber); read.push('serial'); }
    if (full.InternationalMobileEquipmentIdentity) { info.imei1 = String(full.InternationalMobileEquipmentIdentity); read.push('imei1'); }
    if (full.InternationalMobileEquipmentIdentity2) { info.imei2 = String(full.InternationalMobileEquipmentIdentity2); read.push('imei2'); }
    if (full.ModelNumber) info.modelNumber = `${full.ModelNumber}${full.RegionInfo ?? ''}`;
    if (full.ProductType && !info.productType) { info.productType = String(full.ProductType); info.model = modelName(info.productType); }
    if (full.ProductVersion && !info.ios) info.ios = String(full.ProductVersion);
    step = 'capacidad y batería';
    const disk = ((await ld.request({ Request: 'GetValue', Domain: 'com.apple.disk_usage' })).Value ?? {}) as Record<string, any>;
    const cap = capacityGb(Number(disk.TotalDiskCapacity));
    if (cap) { info.capacityGb = cap; read.push('capacityGb'); }
    const bat = ((await ld.request({ Request: 'GetValue', Domain: 'com.apple.mobile.battery' })).Value ?? {}) as Record<string, any>;
    if (Number.isFinite(Number(bat.BatteryCurrentCapacity))) { info.battery!.chargePct = Number(bat.BatteryCurrentCapacity); read.push('battery.chargePct'); }
    if (typeof bat.BatteryIsCharging === 'boolean') info.battery!.charging = bat.BatteryIsCharging;
    // Batería: ciclos y capacidad estimada desde el registro de energía, si el servicio de diagnóstico está disponible.
    try {
      const svc = await ld.request({ Request: 'StartService', Service: 'com.apple.mobile.diagnostics_relay' });
      if (svc.Port) {
        const ch = new PlistChannel(await mux.connect(dev.deviceId, Number(svc.Port)));
        try {
          if (svc.EnableServiceSSL) await ch.upgrade(pair);
          let reg: any = null;
          for (const cls of ['IOPMPowerSource', 'AppleSmartBattery']) {
            const r = await ch.request({ Request: 'IORegistry', EntryClass: cls });
            if (r.Status === 'Success' && r.Diagnostics?.IORegistry) { reg = r.Diagnostics.IORegistry; break; }
          }
          if (reg) {
            if (Number.isFinite(Number(reg.CycleCount))) { info.battery!.cycles = Number(reg.CycleCount); read.push('battery.cycles'); }
            const design = Number(reg.DesignCapacity); const max = Number(reg.NominalChargeCapacity ?? reg.AppleRawMaxCapacity);
            if (design > 0 && max > 0) { info.battery!.estimatedMaxPct = Math.round((max / design) * 100); read.push('battery.estimatedMaxPct'); }
          }
          await ch.send({ Request: 'Goodbye' }).catch(() => {});
        } finally { ch.close(); }
      }
    } catch { /* sin datos de batería por USB: se cargan desde Configuración */ }
    await ld.request({ Request: 'StopSession', SessionID: ss.SessionID }).catch(() => {});
    const want = ['model', 'ios', 'capacityGb', 'serial', 'imei1', 'battery.chargePct', 'battery.cycles'];
    return { state: 'connected', info, read, missing: want.filter((k) => !read.includes(k)), message: null };
  } catch (e) {
    // Lo leído hasta acá se conserva (modelo e iOS); el resto se puede cargar a mano.
    const want = ['model', 'ios', 'capacityGb', 'serial', 'imei1', 'battery.chargePct', 'battery.cycles'];
    return { state: 'error', info, read, missing: want.filter((k) => !read.includes(k)),
      message: 'No se pudieron leer todos los datos por USB. Podés seguir: completá lo que falte con «Editar» y abrí las pruebas con el QR.', detail: `${step}: ${techText(e)}` };
  } finally { ld.close(); }
}

/** Estado del USB para la pantalla: equipos conectados (sin el identificador real, solo una clave opaca). */
export class UsbWatcher {
  private udids = new Map<string, { deviceId: number; udid: string }>();
  private cache = new Map<string, { at: number; basic: { productType?: string; ios?: string } }>();
  private salt = crypto.randomBytes(16).toString('hex');
  constructor(public mux = new Usbmux()) {}
  keyOf(udid: string) { return crypto.createHash('sha256').update(this.salt + udid).digest('hex').slice(0, 16); }
  udidOf(key: string) { return this.udids.get(key) ?? null; }

  async devices(): Promise<{ service: 'ok' | 'unavailable'; message: string | null; detail: string | null; devices: { key: string; model: string | null; productType: string | null; ios: string | null }[] }> {
    let list: { deviceId: number; udid: string }[];
    try { list = await this.mux.listDevices(); }
    catch (e) {
      const conn = (e as any)?.code === 'MUX_UNAVAILABLE';
      return { service: 'unavailable', devices: [],
        message: conn ? 'La app no encuentra el servicio de Apple para dispositivos móviles. Instalá «Dispositivos Apple» desde Microsoft Store (o iTunes desde apple.com) y volvé a intentar.'
          : 'El servicio de Apple respondió algo que la app no pudo interpretar.',
        detail: conn ? this.mux.lastError : `Respuesta no reconocida: ${String((e as Error)?.message ?? e).replace(/[0-9a-f]{8,}-?[0-9a-f]*/gi, '•••').slice(0, 120)}` };
    }
    const raw = this.mux.lastRaw;
    const detail = `Servicio de Apple en ${raw.address ?? '?'} · ${raw.total} equipo(s) informado(s)${raw.network ? `, ${raw.network} por Wi‑Fi` : ''}`;
    this.udids = new Map(list.map((d) => [this.keyOf(d.udid), d]));
    const out = [];
    for (const [key, d] of this.udids) {
      let c = this.cache.get(key);
      if (!c || Date.now() - c.at > 30_000) {
        c = { at: Date.now(), basic: {} };
        try {
          const ld = new PlistChannel(await this.mux.connect(d.deviceId, 62078));
          try { const v = ((await ld.request({ Request: 'GetValue' })).Value ?? {}) as Record<string, any>; c.basic = { productType: v.ProductType, ios: v.ProductVersion }; }
          finally { ld.close(); }
        } catch { /* se reintenta en la próxima lectura */ }
        this.cache.set(key, c);
      }
      out.push({ key, productType: c.basic.productType ?? null, model: modelName(c.basic.productType) ?? null, ios: c.basic.ios ?? null });
    }
    return { service: 'ok', message: !out.length && raw.network ? 'El iPhone figura solo por Wi‑Fi: conectalo con un cable de datos.' : null, detail, devices: out };
  }
}
