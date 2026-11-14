// Servidor HTTP mínimo (sin Express): API REST + archivos estáticos de la UI.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.ts';
import { CatalogRepo } from './catalog.ts';
import { getSettings, updateSettings } from './settings.ts';
import { PhotoRepo } from './photos.ts';
import { CoverStore } from './covers.ts';
import { CoverJobs } from './coverJobs.ts';
import { importOnline, searchOnline } from './lookup.ts';
import { deleteQuick, preview, saveQuick, updateQuick } from './quickProducts.ts';
import { repoStatus, setRepoConfig, type Secret } from './repoSync.ts';
import { Auth, AuthError } from './auth.ts';
import { publishRate } from './sharedConfig.ts';
import { fichasStatus } from './fichas.ts';
import { homeSearch } from './homeSearch.ts';
import { TaskRepo } from './tasks.ts';
import { newsState, refreshNews } from './news.ts';
import { DiagStore, DiagError } from './diag.ts';
import { DiagLan } from './diagLan.ts';
import { UsbWatcher, readDevice, techText } from './usbmux.ts';
import { ValidationError, type ProductFilter } from '../shared/types.ts';

const MAX_BODY = 5 * 1024 * 1024;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json',
};

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Archivo demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'",
};

export function createServer(db: Db, webRoot: string, dataDir: string, opts: { secret?: Secret; syncNow?: () => unknown; canSetup?: () => boolean } = {}) {
  const kick = () => { try { void opts.syncNow?.(); } catch {} };
  const auth = new Auth(db, opts.canSetup ?? (() => true));
  // Escrituras que también puede hacer un vendedor (el resto de las escrituras es solo del administrador).
  const SELLER_WRITES: [string, RegExp][] = [
    ['PUT', /^\/api\/catalog\/products\/\d+\/favorite$/], ['POST', /^\/api\/lookup$/], ['POST', /^\/api\/repo\/sync$/],
    // Cualquier sesión puede generar la portada oficial que falta en esta PC.
    ['POST', /^\/api\/covers\/[a-z0-9-]+$/],
    // Inicio: todo el personal maneja los pendientes del local y puede refrescar las novedades.
    ['POST', /^\/api\/tasks$/], ['PATCH', /^\/api\/tasks\/[a-f0-9-]{36}$/], ['DELETE', /^\/api\/tasks\/[a-f0-9-]{36}$/],
    ['POST', /^\/api\/news\/refresh$/],
    // Diagnóstico: todo el personal con sesión (la configuración de red es del administrador).
    ['POST', /^\/api\/diag(\/[a-f0-9-]{36}(\/[a-z-]+(\/[a-f0-9-]{36}\/confirm)?)?)?$/], ['PATCH', /^\/api\/diag\/[a-f0-9-]{36}\/device$/],
  ];
  const repo = new CatalogRepo(db);
  const tasks = new TaskRepo(db);
  const photos = new PhotoRepo(db, dataDir);
  const covers = new CoverStore(dataDir, undefined, webRoot, db);
  const coverJobs = new CoverJobs(db, covers);
  covers.assignKeys(db);
  const diag = new DiagStore(db);
  const lan = new DiagLan(db, diag, webRoot, dataDir, opts.secret);
  const usb = new UsbWatcher();
  const D = '([a-f0-9-]{36})';
  const who = () => auth.current()?.email ?? null;
  const idOf = (s: string) => { const n = Number(s); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'ID inválido'); return n; };

  type Handler = (m: RegExpMatchArray, req: http.IncomingMessage, url: URL) => Promise<unknown> | unknown;
  const routes: [string, RegExp, Handler][] = [
    // Diagnóstico de iPhone
    ['GET', /^\/api\/diag$/, (_m, _r, u) => diag.list(u.searchParams.get('q') ?? '')],
    ['POST', /^\/api\/diag$/, async () => { await lan.ensure(); return diag.create(who()); }],
    ['GET', /^\/api\/diag\/lan$/, async () => { await lan.ensure(); return lan.info(); }],
    ['PUT', /^\/api\/diag\/lan$/, async (_m, req) => lan.configure(await readJson(req))],
    ['GET', /^\/api\/diag\/usb$/, () => usb.devices()],
    ['GET', new RegExp(`^/api/diag/${D}$`), (m, _r, u) => {
      // Serie e IMEI completos: solo el administrador y a pedido.
      const reveal = u.searchParams.get('reveal') === '1';
      if (reveal) auth.require('admin');
      return diag.get(m[1], { reveal });
    }],
    ['PATCH', new RegExp(`^/api/diag/${D}/device$`), async (m, req) => diag.updateDevice(m[1], await readJson(req))],
    ['POST', new RegExp(`^/api/diag/${D}/results$`), async (m, req) => { diag.addResult(m[1], await readJson(req), who(), 'manual'); return diag.get(m[1]); }],
    ['POST', new RegExp(`^/api/diag/${D}/repeat$`), async (m, req) => diag.requestRepeat(m[1], String((await readJson(req)).test))],
    ['POST', new RegExp(`^/api/diag/${D}/observations$`), async (m, req) => diag.saveObservations(m[1], await readJson(req))],
    ['POST', new RegExp(`^/api/diag/${D}/close$`), async (m, req) => diag.close(m[1], await readJson(req), who())],
    ['POST', new RegExp(`^/api/diag/${D}/cancel$`), (m) => diag.cancel(m[1])],
    ['POST', new RegExp(`^/api/diag/${D}/qr$`), async (m) => {
      await lan.ensure();
      const i = lan.info();
      if (!i.running) throw new DiagError(503, i.error ?? 'No se pudo abrir la conexión para el iPhone.');
      const q = diag.newQr(m[1]);
      return { url: lan.urlFor(q.token), expiresAt: q.expiresAt, https: i.https, note: i.note };
    }],
    ['POST', new RegExp(`^/api/diag/${D}/phone/${D}/confirm$`), async (m, req) => diag.confirmPhone(m[1], m[2], !!(await readJson(req)).accept)],
    ['POST', new RegExp(`^/api/diag/${D}/disconnect$`), (m) => diag.disconnectPhone(m[1])],
    ['POST', new RegExp(`^/api/diag/${D}/usb$`), async (m, req) => {
      const key = String((await readJson(req)).device ?? '');
      const dev = usb.udidOf(key);
      if (!dev) throw new DiagError(404, 'El iPhone ya no está conectado. Volvé a conectarlo.');
      const same = diag.sameDevice(m[1], dev.udid);
      if (same === false) throw new DiagError(409, 'Es otro iPhone: no coincide con el equipo de este diagnóstico. Conectá el mismo equipo o iniciá un diagnóstico nuevo.');
      let r;
      try { r = await readDevice(usb.mux, dev); }
      catch (e) {
        const detail = techText(e);
        diag.setUsbState(m[1], { state: 'error', detail, at: new Date().toISOString() });
        throw new DiagError(502, `No se pudo leer el iPhone. Revisá el cable (de datos), desbloquealo y volvé a conectarlo. (Detalle técnico: ${detail})`);
      }
      const state = { state: r.state, message: r.message, detail: r.detail ?? null, read: r.read, missing: r.missing, at: new Date().toISOString() };
      // Sin autorización también se guardan modelo e iOS, pero no se fija la identidad del equipo hasta tener la sesión.
      if (r.state === 'connected') return diag.applyUsb(m[1], dev.udid, r.info, state);
      diag.setUsbState(m[1], state);
      if (r.info.productType || r.info.ios) diag.updateDeviceFromUsbBasic(m[1], r.info);
      return diag.get(m[1]);
    }],
    ['GET', /^\/api\/health$/, () => ({ ok: true })],
    ['GET', /^\/api\/auth$/, () => auth.status()],
    ['POST', /^\/api\/auth\/setup$/, async (_m, req) => { const r = auth.setupAdmin(await readJson(req)); kick(); return r; }],
    ['POST', /^\/api\/auth\/login$/, async (_m, req) => auth.login(await readJson(req))],
    ['POST', /^\/api\/auth\/logout$/, () => auth.logout()],
    ['POST', /^\/api\/auth\/password$/, async (_m, req) => { const r = auth.changeOwnPassword(await readJson(req)); kick(); return r; }],
    ['GET', /^\/api\/users$/, () => auth.list()],
    ['POST', /^\/api\/users$/, async (_m, req) => { const r = auth.addUser(await readJson(req)); kick(); return r; }],
    ['PUT', /^\/api\/users\/([^/]+)\/password$/, async (m, req) => { const r = auth.resetPassword(decodeURIComponent(m[1]), await readJson(req)); kick(); return r; }],
    ['DELETE', /^\/api\/users\/([^/]+)$/, (m) => { const r = auth.removeUser(decodeURIComponent(m[1])); kick(); return r; }],
    ['GET', /^\/api\/settings$/, () => getSettings(db)],
    ['PUT', /^\/api\/settings$/, async (_m, req) => {
      const body = await readJson(req); const before = getSettings(db).usdRate;
      const r = updateSettings(db, body);
      if ('usdRate' in body && r.usdRate !== before) { publishRate(db); kick(); }
      return r;
    }],
    ['GET', /^\/api\/search$/, (_m, _r, u) => homeSearch(db, repo, u.searchParams.get('q') ?? '', Math.min(20, Number(u.searchParams.get('limit')) || 8))],
    ['GET', /^\/api\/tasks$/, () => tasks.list()],
    ['POST', /^\/api\/tasks$/, async (_m, req) => { const t = tasks.create(await readJson(req), auth.current()?.email ?? null); kick(); return t; }],
    ['PATCH', /^\/api\/tasks\/([a-f0-9-]{36})$/, async (m, req) => { const t = tasks.update(m[1], await readJson(req)); kick(); return t; }],
    ['DELETE', /^\/api\/tasks\/([a-f0-9-]{36})$/, (m) => { const r = tasks.remove(m[1]); kick(); return { deleted: r }; }],
    ['GET', /^\/api\/news$/, () => newsState(db)],
    ['POST', /^\/api\/news\/refresh$/, () => refreshNews(db)],
    ['GET', /^\/api\/catalog\/brands$/, () => repo.listBrands()],
    ['GET', /^\/api\/catalog\/models$/, (_m, _r, u) => repo.listModels(u.searchParams.get('brandId') ? idOf(u.searchParams.get('brandId')!) : undefined)],
    ['GET', /^\/api\/catalog\/products$/, (_m, _r, u) => {
      const p = u.searchParams;
      const f: ProductFilter = {
        q: p.get('q') || undefined, condition: (p.get('condition') || undefined) as any,
        brandId: p.get('brandId') ? idOf(p.get('brandId')!) : undefined, use: (p.get('use') || undefined) as any,
        favorite: p.get('favorite') === '1', includeDemo: p.get('includeDemo') !== '0',
      };
      return repo.listProducts(f);
    }],
    ['POST', /^\/api\/catalog\/products$/, async (_m, req) => repo.createProduct(await readJson(req))],
    ['GET', /^\/api\/catalog\/products\/(\d+)$/, (m) => repo.getProduct(idOf(m[1])) ?? (() => { throw new HttpError(404, 'No encontrado'); })()],
    ['PUT', /^\/api\/catalog\/products\/(\d+)$/, async (m, req) => repo.updateProduct(idOf(m[1]), await readJson(req))],
    ['PUT', /^\/api\/catalog\/products\/(\d+)\/favorite$/, async (m, req) => { repo.setFavorite(idOf(m[1]), !!(await readJson(req)).favorite); return { ok: true }; }],
    ['DELETE', /^\/api\/catalog\/products\/(\d+)$/, (m) => { photos.removeForProduct(idOf(m[1])); return { deleted: repo.deleteProduct(idOf(m[1])) }; }],
    ['POST', /^\/api\/catalog\/products\/(\d+)\/photos$/, async (m, req) => photos.add(idOf(m[1]), await readJson(req))],
    ['DELETE', /^\/api\/photos\/(\d+)$/, (m) => ({ deleted: photos.remove(idOf(m[1])) })],
    ['GET', /^\/api\/compare\/models$/, (_m, _r, u) => repo.compareCandidates(u.searchParams.get('includeDemo') !== '0')],
    ['POST', /^\/api\/compare\/models$/, async (_m, req) => repo.createModel(await readJson(req))],
    ['GET', /^\/api\/lookup$/, (_m, _r, u) => searchOnline(u.searchParams.get('q'))],
    ['POST', /^\/api\/lookup$/, async (_m, req) => importOnline(db, (await readJson(req)).slug)],
    ['POST', /^\/api\/quick\/preview$/, async (_m, req) => { const b = await readJson(req); return preview(b.name, b.slug); }],
    ['GET', /^\/api\/covers$/, () => { covers.assignKeys(db); return covers.list(); }],
    ['GET', /^\/api\/covers\/coverage$/, () => covers.coverage(db)],
    ['POST', /^\/api\/covers\/([a-z0-9-]+)$/, async (m, req) => covers.save(m[1], await readJson(req))],
    ['POST', /^\/api\/quick\/products$/, async (_m, req) => {
      const b = await readJson(req); const r = saveQuick(db, dataDir, b);
      if (b?.photo) coverJobs.discardForProduct(r.id); // la foto manual tiene prioridad sobre la búsqueda automática
      kick(); return r;
    }],
    ['PATCH', /^\/api\/quick\/products\/([a-f0-9-]{36})$/, async (m, req) => {
      const b = await readJson(req); const r = updateQuick(db, dataDir, m[1], b);
      if (b?.photo) coverJobs.discardForProduct(r.id);
      kick(); return r;
    }],
    // «Buscar imagen»: búsquedas de portada en segundo plano.
    ['GET', /^\/api\/cover-jobs$/, () => coverJobs.list()],
    ['POST', /^\/api\/cover-jobs$/, async (_m, req) => coverJobs.request(await readJson(req))],
    ['PATCH', /^\/api\/cover-jobs\/([a-f0-9-]{36})$/, async (m, req) => coverJobs.update(m[1], await readJson(req))],
    ['POST', /^\/api\/cover-jobs\/([a-f0-9-]{36})\/search$/, (m) => coverJobs.runSearch(m[1])],
    ['POST', /^\/api\/cover-jobs\/([a-f0-9-]{36})\/result$/, async (m, req) => { const r = coverJobs.result(m[1], await readJson(req)); kick(); return r; }],
    ['POST', /^\/api\/cover-jobs\/([a-f0-9-]{36})\/fail$/, async (m, req) => coverJobs.fail(m[1], await readJson(req))],
    ['DELETE', /^\/api\/quick\/products\/([a-f0-9-]{36})$/, (m) => { deleteQuick(db, dataDir, m[1]); kick(); return { ok: true }; }],
    ['GET', /^\/api\/repo$/, () => repoStatus(db, opts.secret)],
    ['PUT', /^\/api\/repo$/, async (_m, req) => { setRepoConfig(db, await readJson(req), opts.secret); kick(); return repoStatus(db, opts.secret); }],
    ['POST', /^\/api\/repo\/sync$/, async () => { await opts.syncNow?.(); return repoStatus(db, opts.secret); }],
    ['GET', /^\/api\/compare$/, (_m, _r, u) => {
      const ids = (u.searchParams.get('ids') ?? '').split(',').filter(Boolean).map(idOf);
      return repo.compareModels([...new Set(ids)]);
    }],
    ['GET', /^\/api\/catalog\/models\/(\d+)\/benchmarks$/, (m) => repo.listBenchmarks(idOf(m[1]))],
    ['POST', /^\/api\/catalog\/models\/(\d+)\/benchmarks$/, async (m, req) => repo.saveBenchmark(idOf(m[1]), await readJson(req))],
    ['DELETE', /^\/api\/benchmarks\/(\d+)$/, (m) => ({ deleted: repo.deleteBenchmark(idOf(m[1])) })],
    ['GET', /^\/api\/fichas$/, () => fichasStatus(db)],
    ['GET', /^\/api\/stats$/, (_m, _r, u) => repo.stats(u.searchParams.get('includeDemo') !== '0')],
    ['GET', /^\/api\/catalog\/models\/(\d+)\/specs$/, (m) => repo.getSpecs(idOf(m[1]))],
    ['PUT', /^\/api\/catalog\/models\/(\d+)\/specs$/, async (m, req) => repo.setSpecs(idOf(m[1]), (await readJson(req)).specs)],
    ['GET', /^\/api\/catalog\/export$/, (_m, _r, u) => repo.exportCatalog(u.searchParams.get('includeDemo') === '1')],
    ['POST', /^\/api\/catalog\/import$/, async (_m, req) => repo.importCatalog(await readJson(req))],
  ];

  const root = path.resolve(webRoot);
  function serveStatic(pathname: string, res: http.ServerResponse) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    let file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) && file !== root) throw new HttpError(403, 'Prohibido');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html'); // SPA
    if (!fs.existsSync(file)) throw new HttpError(404, 'UI no compilada: ejecutá npm run build');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', ...SECURITY_HEADERS });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const photo = req.method === 'GET' && url.pathname.match(/^\/api\/photos\/(\d+)$/);
      if (photo) {
        const f = photos.file(idOf(photo[1]));
        if (!f) throw new HttpError(404, 'Foto no encontrada');
        res.writeHead(200, { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=86400', ...SECURITY_HEADERS });
        return void fs.createReadStream(f.path).pipe(res);
      }
      const cover = req.method === 'GET' && url.pathname.match(/^\/api\/covers\/([a-z0-9-]+)\.webp$/);
      if (cover) {
        const f = covers.file(cover[1]);
        if (!f) throw new HttpError(404, 'Portada no disponible');
        res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=604800', ...SECURITY_HEADERS });
        return void fs.createReadStream(f).pipe(res);
      }
      const jobImg = req.method === 'GET' && url.pathname.match(/^\/api\/cover-jobs\/([a-f0-9-]{36})\/image\/(\d)$/);
      if (jobImg) {
        auth.require('admin');
        const src = await coverJobs.image(jobImg[1], Number(jobImg[2]));
        res.writeHead(200, { 'Content-Type': src.mime, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
        return void res.end(src.buf);
      }
      const coverSrc = req.method === 'GET' && url.pathname.match(/^\/api\/covers\/([a-z0-9-]+)\/source$/);
      if (coverSrc) {
        auth.require();
        const src = await covers.fetchSource(coverSrc[1]);
        res.writeHead(200, { 'Content-Type': src.mime, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
        return void res.end(src.buf);
      }
      if (url.pathname.startsWith('/api/')) {
        // Mitigación CSRF básica: las escrituras deben venir de la propia app.
        if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
          throw new HttpError(403, 'Origen no permitido');
        }
        // Permisos: todo requiere sesión salvo el login; las escrituras son del admin salvo excepciones.
        if (!/^\/api\/(auth(\/|$)|health$)/.test(url.pathname)) {
          const seller = SELLER_WRITES.some(([m, re]) => m === req.method && re.test(url.pathname));
          auth.require(req.method === 'GET' || seller ? undefined : 'admin');
        }
        for (const [method, re, h] of routes) {
          const m = url.pathname.match(re);
          if (m && method === req.method) return send(res, 200, await h(m, req, url));
        }
        throw new HttpError(404, 'Ruta no encontrada');
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido');
      serveStatic(url.pathname, res);
    } catch (e) {
      if (e instanceof ValidationError) return send(res, 400, { error: e.message });
      if (e instanceof HttpError || e instanceof AuthError || e instanceof DiagError) return send(res, e.status, { error: e.message });
      const msg = String((e as Error)?.message ?? e);
      if (/UNIQUE|FOREIGN KEY|CHECK constraint/.test(msg)) return send(res, 409, { error: 'Conflicto con datos existentes' });
      // Sin números largos ni URLs con datos en el registro.
      console.error('[api] error interno:', (e as Error)?.name, msg.replace(/https?:\/\/\S+/g, '<url>').replace(/\d{14,}/g, '•••').slice(0, 200));
      send(res, 500, { error: 'Error interno' });
    }
  });
  // Al cerrar la app se cierra también la conexión para el iPhone.
  server.on('close', () => { void lan.stop(); });
  return server;
}
