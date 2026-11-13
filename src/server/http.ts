// Servidor HTTP mínimo (sin Express): API REST + archivos estáticos de la UI.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.ts';
import { CatalogRepo } from './catalog.ts';
import { getSettings, updateSettings } from './settings.ts';
import { PhotoRepo } from './photos.ts';
import { CoverStore } from './covers.ts';
import { importOnline, searchOnline } from './lookup.ts';
import { deleteQuick, preview, saveQuick, updateQuick } from './quickProducts.ts';
import { repoStatus, setRepoConfig, type Secret } from './repoSync.ts';
import { Auth, AuthError } from './auth.ts';
import { publishRate } from './sharedConfig.ts';
import { fichasStatus } from './fichas.ts';
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
  ];
  const repo = new CatalogRepo(db);
  const photos = new PhotoRepo(db, dataDir);
  const covers = new CoverStore(dataDir);
  const idOf = (s: string) => { const n = Number(s); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'ID inválido'); return n; };

  type Handler = (m: RegExpMatchArray, req: http.IncomingMessage, url: URL) => Promise<unknown> | unknown;
  const routes: [string, RegExp, Handler][] = [
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
    ['GET', /^\/api\/covers$/, () => covers.list()],
    ['POST', /^\/api\/covers\/([a-z0-9-]+)$/, async (m, req) => covers.save(m[1], await readJson(req))],
    ['POST', /^\/api\/quick\/products$/, async (_m, req) => { const r = saveQuick(db, dataDir, await readJson(req)); kick(); return r; }],
    ['PATCH', /^\/api\/quick\/products\/([a-f0-9-]{36})$/, async (m, req) => { const r = updateQuick(db, dataDir, m[1], await readJson(req)); kick(); return r; }],
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

  return http.createServer(async (req, res) => {
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
      if (e instanceof HttpError || e instanceof AuthError) return send(res, e.status, { error: e.message });
      const msg = String((e as Error)?.message ?? e);
      if (/UNIQUE|FOREIGN KEY|CHECK constraint/.test(msg)) return send(res, 409, { error: 'Conflicto con datos existentes' });
      console.error('[api] error interno:', (e as Error)?.name, msg.slice(0, 200));
      send(res, 500, { error: 'Error interno' });
    }
  });
}
