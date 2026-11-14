// Enlace HTTPS para Safari (Diagnóstico) mediante un túnel rápido de Cloudflare («quick tunnel», sin cuenta).
// cloudflared abre https://<algo>.trycloudflare.com con un certificado que el iPhone reconoce y lo reenvía al servidor
// de pruebas local (solo la página /d y la sesión del iPhone, protegidas por el token de un solo uso del QR).
// Así Safari permite cámara, micrófono y sensores. Si no hay internet o cloudflared no está, se usa la red local (HTTP).
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

export type TunnelState = 'off' | 'starting' | 'ready' | 'error' | 'unavailable';

export class DiagTunnel {
  private proc: ChildProcess | null = null;
  private url: string | null = null;
  private state: TunnelState;
  private error: string | null = null;
  private waiters: (() => void)[] = [];
  private stopping = false;
  private restarts = 0;
  constructor(private bin: string | null, private localPort: () => number) {
    this.state = bin && fs.existsSync(bin) ? 'off' : 'unavailable';
  }

  info() { return { state: this.state, url: this.state === 'ready' ? this.url : null, error: this.error }; }

  /** Arranca el túnel (si no estaba) y espera hasta `waitMs` a que tenga enlace. */
  async ensure(waitMs = 0): Promise<string | null> {
    if (this.state === 'unavailable') return null;
    if ((this.state === 'off' || this.state === 'error') && !this.proc) this.start();
    if (this.state === 'ready' || !waitMs) return this.state === 'ready' ? this.url : null;
    await new Promise<void>((r) => { const t = setTimeout(r, waitMs); this.waiters.push(() => { clearTimeout(t); r(); }); });
    return (this.state as TunnelState) === 'ready' ? this.url : null;
  }

  private wake() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }

  private start() {
    this.stopping = false; this.state = 'starting'; this.error = null; this.url = null;
    const p = spawn(this.bin!, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${this.localPort()}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = p;
    // Al cerrar la app (o si el proceso termina por cualquier motivo) no queda cloudflared corriendo en Windows.
    const kill = () => { try { p.kill(); } catch {} };
    process.once('exit', kill);
    p.once('exit', () => process.removeListener('exit', kill));
    let buf = '';
    const onOut = (d: Buffer) => {
      buf = (buf + d.toString('utf8')).slice(-8000);
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && this.state !== 'ready') { this.url = m[0]; this.state = 'ready'; this.restarts = 0; this.wake(); }
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

  stop() { this.stopping = true; const p = this.proc; this.proc = null; this.state = this.state === 'unavailable' ? 'unavailable' : 'off'; this.url = null; try { p?.kill(); } catch {} }
}
