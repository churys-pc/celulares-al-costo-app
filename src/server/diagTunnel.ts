// Enlace HTTPS para Safari (Diagnóstico) mediante un túnel rápido de Cloudflare («quick tunnel», sin cuenta).
// cloudflared abre https://<algo>.trycloudflare.com con un certificado que el iPhone reconoce y lo reenvía al servidor
// de pruebas local (solo la página /d y la sesión del iPhone, protegidas por el token de un solo uso del QR).
// Así Safari permite cámara, micrófono y sensores. Si no hay internet o cloudflared no está, se usa la red local (HTTP).
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import dns from 'node:dns';

/** Comprueba desde la PC que el enlace ya se pueda usar: el nombre figura en DNS públicos y la página responde por HTTPS.
 *  (Si el iPhone lo abre antes de que exista, su DNS recuerda «no existe» por un rato.) */
export async function verifyTunnel(url: string, signal: AbortSignal): Promise<boolean> {
  const host = new URL(url).hostname;
  const r = new dns.promises.Resolver({ timeout: 3000, tries: 1 });
  r.setServers(['1.1.1.1', '8.8.8.8']);
  while (!signal.aborted) {
    try {
      const ips = await r.resolve4(host);
      if (ips.length) {
        const res = await fetch(`${url}/d`, { method: 'GET', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
        if (res.status === 200) return true;
      }
    } catch { /* todavía no */ }
    await new Promise((ok) => setTimeout(ok, 2500));
  }
  return false;
}

export type TunnelState = 'off' | 'starting' | 'ready' | 'error' | 'unavailable';

export class DiagTunnel {
  private proc: ChildProcess | null = null;
  private url: string | null = null;
  private state: TunnelState;
  private error: string | null = null;
  private waiters: (() => void)[] = [];
  private stopping = false;
  private restarts = 0;
  private checker: AbortController | null = null;
  constructor(private bin: string | null, private localPort: () => number, private verify: (url: string, signal: AbortSignal) => Promise<boolean> = verifyTunnel) {
    this.state = bin && fs.existsSync(bin) ? 'off' : 'unavailable';
  }

  info() { return { state: this.state, url: this.state === 'ready' ? this.url : null, error: this.error }; }

  /** Arranca el túnel (si no estaba) y espera hasta `waitMs` a que tenga enlace. */
  async ensure(waitMs = 0): Promise<string | null> {
    if (this.state === 'unavailable') return null;
    if ((this.state === 'off' || this.state === 'error') && !this.proc) this.start();
    if (this.state === 'ready' || !waitMs) return this.state === 'ready' ? this.url : null;
    const until = Date.now() + waitMs;
    while ((this.state as TunnelState) === 'starting' && Date.now() < until) {
      await new Promise<void>((r) => { const t = setTimeout(r, until - Date.now()); this.waiters.push(() => { clearTimeout(t); r(); }); });
    }
    return (this.state as TunnelState) === 'ready' ? this.url : null;
  }

  private wake() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }

  private start() {
    this.stopping = false; this.state = 'starting'; this.error = null; this.url = null; this.checker?.abort(); this.checker = null;
    const args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${this.localPort()}`];
    // Un .cjs es el simulador de las pruebas (corre con Node en cualquier sistema).
    const p = this.bin!.endsWith('.cjs') ? spawn(process.execPath, [this.bin!, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(this.bin!, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = p;
    // Al cerrar la app (o si el proceso termina por cualquier motivo) no queda cloudflared corriendo en Windows.
    const kill = () => { try { p.kill(); } catch {} };
    process.once('exit', kill);
    p.once('exit', () => process.removeListener('exit', kill));
    let buf = '';
    const onOut = (d: Buffer) => {
      buf = (buf + d.toString('utf8')).slice(-8000);
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !this.url) this.url = m[0];
      // Listo recién cuando Cloudflare registró la conexión Y el enlace ya responde desde internet.
      if (this.url && !this.checker && this.state === 'starting' && /Registered tunnel connection/i.test(buf)) {
        const ctl = new AbortController(); this.checker = ctl;
        const giveUp = setTimeout(() => ctl.abort(), 90_000); giveUp.unref?.();
        void this.verify(this.url, ctl.signal).then((ok) => {
          clearTimeout(giveUp);
          if (this.proc !== p || this.checker !== ctl) return;
          this.checker = null;
          if (ok) { this.state = 'ready'; this.error = null; this.restarts = 0; }
          else { this.error = 'El enlace seguro no respondió desde internet.'; try { p.kill(); } catch {} }
          this.wake();
        });
      }
    };
    p.stdout?.on('data', onOut); p.stderr?.on('data', onOut);
    p.on('error', () => { this.state = 'error'; this.error = 'No se pudo iniciar el enlace seguro.'; this.wake(); });
    p.on('exit', () => {
      if (this.proc !== p) return;
      this.proc = null;
      if (this.stopping) { this.state = 'off'; return; }
      this.state = 'error'; this.url = null;
      this.error = /failed to request quick Tunnel|dial tcp|no such host|context deadline/i.test(buf) ? 'Sin conexión a internet para el enlace seguro.' : 'El enlace seguro se cerró.';
      this.wake();
      // Reintento automático (por ejemplo, si volvió internet), con espera creciente.
      if (this.restarts < 5) { const d = 5000 * 2 ** this.restarts++; setTimeout(() => { if (this.state === 'error' && !this.stopping) this.start(); }, d).unref?.(); }
    });
    // Si en 25 s no hay enlace, se informa (sigue intentando).
    setTimeout(() => { if (this.proc === p && this.state === 'starting') { this.error = 'El enlace seguro está tardando (¿hay internet?).'; this.wake(); } }, 25_000).unref?.();
  }

  stop() { this.checker?.abort(); this.checker = null; this.stopping = true; const p = this.proc; this.proc = null; this.state = this.state === 'unavailable' ? 'unavailable' : 'off'; this.url = null; try { p?.kill(); } catch {} }
}
