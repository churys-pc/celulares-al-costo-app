// Servidor para Safari en la red del local (Diagnóstico). Es un listener APARTE del servidor de la app (que sigue solo en
// 127.0.0.1): expone únicamente la página de pruebas y tres rutas de la sesión del iPhone. No da acceso al catálogo ni a
// nada más. Arranca recién cuando el técnico abre Diagnóstico.
//
// HTTP o HTTPS: Safari solo permite cámara, micrófono y movimiento en una conexión segura. Con HTTP (IP local) las demás
// pruebas funcionan y esas quedan «No verificado» con su alternativa manual. Para HTTPS se carga un certificado .pfx emitido
// para un nombre que el iPhone reconozca (ver PROJECT_STATUS → Diagnóstico → HTTPS).
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.ts';
import type { Secret } from './repoSync.ts';
import { DiagStore, DiagError } from './diag.ts';
import { DiagTunnel } from './diagTunnel.ts';
import { ValidationError } from '../shared/types.ts';

export const DEFAULT_PORT = 5181;
const MAX_BODY = 16 * 1024;
const CONF_KEY = 'diagLan';
interface LanConf { host?: string; port?: number; pfxFile?: string; pass?: string; certName?: string; tunnel?: boolean }
const PLAIN: Secret = { encrypt: (s) => s, decrypt: (s) => s };

const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
};

/** IPv4 de la red local (sin adaptadores virtuales ni de enlace local). */
export function lanAddresses(): { address: string; iface: string }[] {
  const out: { address: string; iface: string }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|docker|veth|br-/i.test(name)) continue;
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ address: a.address, iface: name });
    }
  }
  const priv = (ip: string) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return out.sort((a, b) => Number(priv(b.address)) - Number(priv(a.address)));
}

/** Lo que el iPhone puede resolver: una IPv4 o un nombre con dominio (con punto). El nombre de la PC solo («chury») no. */
export const usableHost = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || (/\./.test(h) && /^[a-z0-9.-]+$/i.test(h));

export class DiagLan {
  private server: http.Server | https.Server | null = null;
  private starting: Promise<void> | null = null;
  private error: string | null = null;
  private port = 0;
  private https = false;
  private hits = new Map<string, { n: number; t: number }>();
  private tunnel: DiagTunnel;
  constructor(private db: Db, private store: DiagStore, private webRoot: string, private dataDir: string, private secret: Secret = PLAIN, tunnelBin: string | null = null,
    tunnelVerify?: (url: string, signal: AbortSignal) => Promise<boolean>) {
    this.tunnel = new DiagTunnel(tunnelBin, () => this.port || this.conf().port || DEFAULT_PORT, tunnelVerify);
  }
  /** Enlace seguro automático (Cloudflare): activado salvo que el administrador lo apague o use su propio certificado. */
  private tunnelOn() { const c = this.conf(); return c.tunnel !== false && !c.pfxFile; }

  private conf(): LanConf { try { return JSON.parse((this.db.prepare('SELECT value FROM settings WHERE key = ?').get(CONF_KEY) as any)?.value ?? '{}'); } catch { return {}; } }
  private saveConf(c: LanConf) { this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(CONF_KEY, JSON.stringify(c)); }

  info() {
    const c = this.conf();
    const addrs = lanAddresses();
    const badHost = !!c.host && !usableHost(c.host);
    const host = (c.host && !badHost ? c.host : null) || addrs[0]?.address || null;
    const t = this.tunnel.info();
    const secure = this.tunnelOn() && t.state === 'ready';
    return { badHost: badHost ? c.host : null, tunnel: { enabled: this.tunnelOn(), available: t.state !== 'unavailable', state: t.state, url: t.url, error: t.error, configured: c.tunnel !== false }, secure, running: !!this.server, error: this.error, port: this.port || c.port || DEFAULT_PORT, https: this.https || !!c.pfxFile,
      host, addresses: addrs.map((a) => a.address), configuredHost: c.host ?? null, certName: c.certName ?? null,
      note: this.https || c.pfxFile || secure ? null : 'Conexión HTTP: Safari no permite cámara, micrófono ni sensores de movimiento sin HTTPS; esas pruebas quedan «No verificado» con su alternativa manual.' };
  }

  /** URL del QR: solo el token, en el fragmento (no viaja en pedidos ni queda en registros del servidor).
   *  Con el enlace seguro listo (o si aparece en hasta 15 s) se usa HTTPS; si no, la red local. */
  async urlFor(token: string) {
    if (this.tunnelOn()) { const u = await this.tunnel.ensure(30_000); if (u) return `${u}/d#t=${token}`; }
    const i = this.info();
    if (!i.host) throw new DiagError(503, 'La PC no tiene una red local activa: conectala al Wi‑Fi o a la red del local.');
    return `${i.https ? 'https' : 'http'}://${i.host}:${i.port}/d#t=${token}`;
  }

  async ensure() {
    if (this.server) { if (this.tunnelOn()) void this.tunnel.ensure(0); return; }
    this.starting ??= this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async start() {
    const c = this.conf();
    const port = c.port || DEFAULT_PORT;
    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => void this.handle(req, res);
    let srv: http.Server | https.Server;
    try {
      if (c.pfxFile) {
        const pfx = fs.readFileSync(path.join(this.dataDir, c.pfxFile));
        srv = https.createServer({ pfx, passphrase: c.pass ? this.secret.decrypt(c.pass) : undefined, minVersion: 'TLSv1.2' }, handler);
        this.https = true;
      } else { srv = http.createServer(handler); this.https = false; }
      srv.requestTimeout = 15_000; srv.headersTimeout = 10_000;
      await new Promise<void>((ok, ko) => { srv.once('error', ko); srv.listen(port, '0.0.0.0', () => { srv.off('error', ko); ok(); }); });
      this.server = srv; this.port = port; this.error = null;
      if (this.tunnelOn()) void this.tunnel.ensure(0);
    } catch (e) {
      const code = (e as any)?.code;
      this.error = code === 'EADDRINUSE' ? `El puerto ${port} está ocupado por otro programa: cambialo en la configuración.` :
        /mac verify|pkcs12|PFX|bad decrypt/i.test(String((e as Error)?.message)) ? 'No se pudo abrir el certificado: revisá el archivo .pfx y su contraseña.' :
        'No se pudo abrir la conexión para el iPhone.';
      this.server = null;
    }
  }

  async restart() { await this.stop(); await this.ensure(); }
  async stop() { this.tunnel.stop(); const s = this.server; this.server = null; this.port = 0; if (s) await new Promise<void>((r) => s.close(() => r())); }

  /** Configuración (solo administrador): dirección/nombre, puerto y certificado .pfx para HTTPS. */
  async configure(body: any) {
    const c = this.conf();
    if (body?.host !== undefined) {
      const h = String(body.host ?? '').trim();
      if (h && !/^[a-z0-9.-]{1,253}$/i.test(h)) throw new ValidationError('Nombre o dirección inválida');
      if (h && !usableHost(h)) throw new ValidationError(`«${h}» parece el nombre de la PC: el iPhone no lo puede encontrar. Dejá el campo vacío (se usa la IP automáticamente) o poné una IP o un nombre con dominio.`);
      c.host = h || undefined;
    }
    if (body?.port !== undefined) {
      const p = Number(body.port);
      if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new ValidationError('Puerto inválido (1024–65535)');
      c.port = p;
    }
    if (body?.tunnel !== undefined) c.tunnel = !!body.tunnel;
    if (body?.removeCert) { if (c.pfxFile) fs.rmSync(path.join(this.dataDir, c.pfxFile), { force: true }); delete c.pfxFile; delete c.pass; delete c.certName; }
    if (body?.pfxBase64) {
      const buf = Buffer.from(String(body.pfxBase64), 'base64');
      if (buf.length < 100 || buf.length > 200_000) throw new ValidationError('El archivo .pfx no es válido');
      // Se prueba antes de guardarlo.
      try { https.createServer({ pfx: buf, passphrase: body.passphrase ? String(body.passphrase) : undefined }).close(); }
      catch { throw new ValidationError('No se pudo abrir el certificado: revisá el archivo .pfx y su contraseña.'); }
      fs.mkdirSync(path.join(this.dataDir, 'diag-tls'), { recursive: true });
      c.pfxFile = path.join('diag-tls', 'cert.pfx');
      fs.writeFileSync(path.join(this.dataDir, c.pfxFile), buf);
      c.pass = body.passphrase ? this.secret.encrypt(String(body.passphrase)) : undefined;
      c.certName = String(body.certName ?? '').slice(0, 80) || undefined;
    }
    this.saveConf(c);
    await this.restart();
    return this.info();
  }

  private limited(ip: string) {
    const t = Date.now(); const e = this.hits.get(ip);
    if (!e || t - e.t > 60_000) { this.hits.set(ip, { n: 1, t }); return false; }
    e.n++; return e.n > 30;
  }

  private body(req: http.IncomingMessage): Promise<any> {
    return new Promise((ok, ko) => {
      let n = 0; const parts: Buffer[] = [];
      req.on('data', (c: Buffer) => { n += c.length; if (n > MAX_BODY) { ko(new DiagError(413, 'Datos demasiado grandes')); req.destroy(); } else parts.push(c); });
      req.on('end', () => { try { ok(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch { ko(new DiagError(400, 'Datos inválidos')); } });
      req.on('error', ko);
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...HEADERS }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const p = url.pathname;
      if (req.method === 'GET' && (p === '/d' || p === '/d/')) return this.file(res, 'phone.html', 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/d/phone.js') return this.file(res, 'phone.js', 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && p === '/d/phone.css') return this.file(res, 'phone.css', 'text/css; charset=utf-8');
      if (p.startsWith('/p/api/')) {
        // Solo pedidos de la propia página (sin otros orígenes).
        const origin = req.headers.origin;
        // (por el enlace seguro llega como https://<host> aunque el servidor local sea HTTP)
        if (req.method !== 'GET' && origin && origin !== `https://${req.headers.host}` && origin !== `http://${req.headers.host}`) throw new DiagError(403, 'Origen no permitido');
        const cred = req.headers['x-diag-session'];
        if (req.method === 'POST' && p === '/p/api/claim') {
          const ip = /^(::ffff:)?127\.|^::1$/.test(req.socket.remoteAddress ?? '') ? String(req.headers['cf-connecting-ip'] ?? 'local') : req.socket.remoteAddress ?? '?';
          if (this.limited(ip)) throw new DiagError(429, 'Demasiados intentos: esperá un minuto.');
          const b = await this.body(req);
          return json(200, this.store.claim(b.token, req.headers['user-agent']));
        }
        if (req.method === 'GET' && p === '/p/api/state') return json(200, this.store.phoneState(cred));
        if (req.method === 'POST' && p === '/p/api/result') return json(200, this.store.phoneResult(cred, await this.body(req)));
      }
      res.writeHead(404, HEADERS); res.end();
    } catch (e) {
      if (e instanceof DiagError) return json(e.status, { error: e.message });
      if (e instanceof ValidationError) return json(400, { error: e.message });
      json(500, { error: 'Error interno' });
    }
  }

  private file(res: http.ServerResponse, name: string, type: string) {
    try { const buf = fs.readFileSync(path.join(this.webRoot, 'phone', name)); res.writeHead(200, { 'Content-Type': type, ...HEADERS }); res.end(buf); }
    catch { res.writeHead(404, HEADERS); res.end(); }
  }
}
