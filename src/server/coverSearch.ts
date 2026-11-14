// «Buscar imagen»: busca en la web la foto de UN modelo, con el mismo criterio que se usó para armar las portadas
// del catálogo (lote 2026-11): primero las fuentes oficiales (catálogo de Samsung, tienda oficial de Motorola),
// después el buscador de imágenes con fondo transparente, priorizando los sitios del fabricante y luego
// distribuidores y reseñas confiables; descarta rumores, otras variantes (4G/5G, Pro/Plus/Ultra/Max/FE…) y
// sitios con marca de agua. El recorte, el fondo transparente y el WebP 768 × 768 los hace la app (coverProcess.ts).
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { normalizeModelName } from '../shared/covers.ts';

export interface CoverCandidate { url: string; page: string; source: string; official: boolean; title: string }
export class CoverSearchOffline extends Error {}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Texto en palabras sueltas: «Galaxy-A56_5G.png» → « galaxy a56 5g png ». */
function decodeURIComponentSafe(s: string) { try { return decodeURIComponent(s); } catch { return s; } }

/** Clave nueva para un modelo que todavía no tiene portada: «samsung-galaxy-a07-5g». */
export function slugKey(brand: string, model: string) {
  const b = fold(brand).trim();
  const m = fold(model).replace(/\+/g, ' plus ');
  const base = `${b} ${m.startsWith(b + ' ') ? m.slice(b.length + 1) : m}`.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base.slice(0, 60).replace(/-+$/, '');
}

/** Palabras que cambian el equipo: si el modelo las tiene, la imagen también; si la imagen tiene otra, es otro equipo. */
const MODIFIERS = ['pro', 'plus', 'ultra', 'max', 'fe', 'lite', 'mini', 'neo', 'prime', 'power', 'play', 'fusion', 'turbo', 'stylus', 'flip', 'fold', 'air', 'go', 'core'];

/** Palabras separando letras y números («iPhone15Pro» → iphone 15 pro), con 4G/5G juntos. */
function splitLD(s: string) {
  return fold(decodeURIComponentSafe(s)).replace(/\+/g, ' plus ').replace(/([a-z])(?=\d)|(\d)(?=[a-z])/g, '$1$2 ')
    .replace(/\b([45]) g\b/g, '$1g').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

/** ¿El texto (título + URL) corresponde exactamente a este modelo y variante? */
export function sameVariant(text: string, model: string, brand = ''): boolean {
  const tw = new Set(splitLD(text));
  const compact = fold(decodeURIComponentSafe(text)).replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
  const mw = splitLD(model);
  const brandWords = new Set(splitLD(brand));
  // 1) Códigos con número tal cual (a56, e14, 13c, x6b, 14t, 15…), sin otro número pegado antes o después.
  const ids = fold(model).replace(/\+/g, ' ').split(/[^a-z0-9]+/).filter((w) => /\d/.test(w) && !/^[45]g$/.test(w));
  if (!ids.length) return false;
  const spaced = fold(decodeURIComponentSafe(text)).replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, ' ');
  // Después del código no puede venir otro número ni una letra suelta de sufijo (13 ≠ 13c, A16 ≠ A16s).
  for (const id of ids) if (!new RegExp(`(^|[^0-9])${id}(?![0-9])(?![a-z](?![a-z]))`).test(spaced)) return false;
  // 2) Nombre de la línea (iphone, galaxy, redmi, note, moto, poco, edge, blade…).
  for (const w of mw) {
    if (w.length < 2 || /\d/.test(w) || MODIFIERS.includes(w) || brandWords.has(w) || /^[45]g$|^lte$/.test(w)) continue;
    if (!compact.includes(w)) return false;
  }
  // 3) Variante: Pro/Plus/Ultra/Max/FE/Lite… tienen que coincidir.
  for (const w of MODIFIERS) {
    const inModel = mw.includes(w);
    if (inModel !== tw.has(w)) return false;
  }
  // 4) Red: 5G y 4G/LTE son equipos distintos.
  const m5 = mw.includes('5g'), m4 = mw.includes('4g') || mw.includes('lte');
  const t5 = tw.has('5g'), t4 = tw.has('4g') || tw.has('lte');
  if (m5 && t4) return false;
  if (m4 && t5) return false;
  if (!m5 && !m4 && t5) return false;
  return true;
}

const OFFICIAL = /(^|\.)(apple\.com|samsung\.com|mi\.com|appmifile\.com|motorola\.com(\.\w+)?|vteximg\.com\.br|vtexassets\.com|static\.pub|honor\.com|hihonor\.com|ztedevices\.com|itel-life\.com|itel-\w+\.com|catphones\.com|xiaomi\.com|lenovo\.com)$/;
const TRUSTED = /(^|\.)(beebom\.com|tecnoblog\.net|gsmarena\.com|kibotek\.com|mistermobile\.com\.sg|superfon\.rs|pakmobizone\.pk|mediamarkt\.\w+|mmsrg\.com|fdn\.fr|alza\.\w+|walmartimages\.com|claroshop\.com|tiendamovistar\.\w+|movistar\.\w+|claro\.\w+|nyc\.com\.ec|greentelcom\.ph|honorstore\.\w+|ais\.th|frandroid\.com|xatakamovil\.com|inside-digital\.de)$/;
const BLOCKED = /(pinterest|aliexpress|alicdn|ebay|mercadolibre|mlstatic|canaltech|ctcdn|shutterstock|istockphoto|gettyimages|dreamstime|123rf|wallpaper|freepik|vecteezy|youtube|ytimg|facebook|fbcdn|instagram|tiktok)/;
const BAD_URL = /(watermark|wallpaper|case|funda|cover-|protector|templado|glass|caja|box|unbox|banner|promo|oferta|vs-|comparativa|render-leak|leak|rumor|concept)/i;

function host(u: string) { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }

/** Ordena y filtra candidatos: oficiales primero, después confiables, sin sitios bloqueados ni otras variantes. */
export function rankCandidates(list: CoverCandidate[], model: string, brand = ''): CoverCandidate[] {
  const seen = new Set<string>();
  const score = (c: CoverCandidate) => {
    const h = host(c.url), ph = host(c.page);
    return (c.official || OFFICIAL.test(h) || OFFICIAL.test(ph) ? 100 : TRUSTED.test(h) || TRUSTED.test(ph) ? 50 : 0)
      + (/\.png(\?|$)/i.test(c.url) ? 5 : 0) + (/front|back|frente|traseira|atras|dorso|render/i.test(c.url) ? 3 : 0);
  };
  return list
    .filter((c) => (/^https:\/\//.test(c.url) || (mockEnabled() && /^http:\/\/127\.0\.0\.1[:/]/.test(c.url))) && !BLOCKED.test(host(c.url)) && !BLOCKED.test(host(c.page)) && !BAD_URL.test(c.url))
    .filter((c) => sameVariant(`${c.title} ${c.url}`, model, brand))
    .filter((c) => !seen.has(c.url) && !!seen.add(c.url))
    .map((c) => ({ ...c, official: c.official || OFFICIAL.test(host(c.url)) || OFFICIAL.test(host(c.page)) }))
    .sort((a, b) => score(b) - score(a));
}

type Getter = (url: string, accept?: string) => Promise<string>;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
export const httpText: Getter = async (url, accept = 'text/html,application/json') => {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8' } });
  } catch { throw new CoverSearchOffline('Sin conexión'); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

const decodeHtml = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Buscador de imágenes (Bing) con filtro de fondo transparente, igual que en la carga de portadas del catálogo. */
export function parseBing(html: string): CoverCandidate[] {
  const out: CoverCandidate[] = [];
  for (const m of html.matchAll(/class="iusc"[^>]*?\sm="([^"]+)"/g)) {
    try {
      const j = JSON.parse(decodeHtml(m[1]));
      if (j.murl) out.push({ url: String(j.murl), page: String(j.purl ?? j.murl), source: host(String(j.purl ?? j.murl)).replace(/^www\./, ''), official: false, title: String(j.t ?? '') });
    } catch { /* resultado ilegible */ }
  }
  return out;
}

/** Catálogo oficial de Samsung (API del buscador de la tienda): foto del producto en PNG transparente. */
export function parseSamsung(json: string): CoverCandidate[] {
  const out: CoverCandidate[] = [];
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    const name = o.displayName ?? o.modelName ?? o.fmyEngName;
    if (typeof o.thumbUrl === 'string' && typeof name === 'string') {
      const u = o.thumbUrl.startsWith('//') ? 'https:' + o.thumbUrl : o.thumbUrl;
      if (/^https:\/\/images\.samsung\.com\//.test(u)) {
        out.push({ url: u.split('?')[0] + '?$Q90_1248_936_F_PNG$', page: o.pdpUrl ? `https://www.samsung.com${o.pdpUrl}` : 'https://www.samsung.com',
          source: 'samsung.com', official: true, title: `${name.replace(/<[^>]+>/g, '')} ${o.modelCode ?? ''}` });
      }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  };
  try { walk(JSON.parse(json)); } catch { /* respuesta inválida */ }
  return out;
}

/** Tienda oficial de Motorola (VTEX): primera imagen «frente/dorso» de cada producto. */
export function parseVtex(json: string, origin: string): CoverCandidate[] {
  const out: CoverCandidate[] = [];
  let list: any[] = [];
  try { list = JSON.parse(json); } catch { return out; }
  for (const p of Array.isArray(list) ? list : []) {
    const name = String(p.productName ?? '');
    if (/pel[ií]cula|capa|funda|case|cargador|kit|\+ moto buds/i.test(name)) continue;
    const imgs: { imageUrl: string }[] = p.items?.[0]?.images ?? [];
    const pick = imgs.find((i) => /frente|traseira|atras|render|_01/i.test(i.imageUrl)) ?? imgs[0];
    if (pick?.imageUrl) out.push({ url: pick.imageUrl.split('?')[0], page: `${origin}/${p.linkText ?? ''}/p`, source: host(origin).replace(/^www\./, ''), official: true, title: name });
  }
  return out;
}

const SAMSUNG_SITES = ['uy', 'ar', 'co', 'mx', 'cl', 'br'];

/** Busca candidatos para un modelo. Lanza CoverSearchOffline si no hubo conexión con ninguna fuente. */
export async function searchCoverCandidates(brand: string, model: string, get: Getter = httpText, code?: string | null): Promise<CoverCandidate[]> {
  const mock = mockCandidates(brand, model);
  if (mock) return mock;
  const all: CoverCandidate[] = [];
  let reached = 0, offline = 0;
  const tryGet = async (url: string, accept?: string) => {
    try { const t = await get(url, accept); reached++; return t; } catch (e) { if (e instanceof CoverSearchOffline) offline++; return null; }
  };
  const b = brand.toLowerCase();
  if (b === 'samsung') {
    for (const cc of SAMSUNG_SITES) {
      const t = await tryGet(`https://searchapi.samsung.com/v6/front/b2c/product/finder/global?type=01010000&siteCode=${cc}&start=1&num=300&sort=newest&onlyFilterInfoYN=N&keySummaryYN=N`, 'application/json');
      if (!t) continue;
      const found = rankCandidates(parseSamsung(t), model, brand);
      if (found.length) { all.push(...found); break; }
    }
  }
  if (b === 'motorola') {
    const q = normalizeModelName(model) ? model.replace(/^motorola\s+/i, '') : model;
    const t = await tryGet(`https://www.motorola.com.br/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}&_from=0&_to=10`, 'application/json');
    if (t) all.push(...parseVtex(t, 'https://www.motorola.com.br'));
  }
  const full = model.toLowerCase().startsWith(b) ? model : `${brand} ${model}`;
  for (const q of [`${full}${code ? ' ' + code : ''} png`, `${full} front back png`]) {
    const t = await tryGet(`https://www.bing.com/images/search?q=${encodeURIComponent(q)}&qft=+filterui:photo-transparent&form=IRFLTR&first=1`);
    if (t) all.push(...parseBing(t));
    if (rankCandidates(all, model, brand).length >= 6) break;
  }
  if (!reached && offline) throw new CoverSearchOffline('Sin conexión');
  return rankCandidates(all, model, brand).slice(0, 8);
}

/** Descarga la imagen de un candidato (cualquier sitio https, con redirecciones y límite de tamaño). */
export function downloadImage(url: string, redirects = 4): Promise<{ mime: string; buf: Buffer }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(url); } catch { return reject(new Error('URL inválida')); }
    const local = mockEnabled() && u.protocol === 'http:' && u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !local) return reject(new Error('Solo se descargan imágenes por https'));
    if (!local && /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(u.hostname)) return reject(new Error('Origen no permitido'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' }, timeout: 20000 }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return void downloadImage(new URL(res.headers.location, u).toString(), redirects - 1).then(resolve, reject);
      }
      const mime = String(res.headers['content-type'] ?? '').split(';')[0].trim();
      if (code !== 200 || !/^image\/(jpeg|png|webp)$/.test(mime)) { res.resume(); return reject(new Error(`El sitio respondió ${code} ${mime}`)); }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > 12 * 1024 * 1024) { req.destroy(); reject(new Error('Imagen demasiado grande')); } else chunks.push(c); });
      res.on('end', () => resolve({ mime, buf: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', (e) => reject(/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH/.test(String(e)) ? new CoverSearchOffline('Sin conexión') : e));
  });
}

/* Pruebas: CEL_COVER_MOCK=<archivo.json> { "delayMs": 3000, "results": { "marca|modelo": [candidatos] } } */
function mockEnabled() { return !!process.env.CEL_COVER_MOCK; }
function mockCandidates(brand: string, model: string): Promise<CoverCandidate[]> | null {
  if (!mockEnabled()) return null;
  const cfg = JSON.parse(fs.readFileSync(process.env.CEL_COVER_MOCK!, 'utf8'));
  const key = `${brand.toLowerCase()}|${normalizeModelName(model)}`;
  return new Promise((ok, ko) => setTimeout(() => {
    if (cfg.offline) return ko(new CoverSearchOffline('Sin conexión'));
    ok(rankCandidates((cfg.results?.[key] ?? []).map((c: any) => ({ source: 'prueba', official: false, title: '', page: c.url, ...c })), model, brand));
  }, Number(cfg.delayMs) || 0));
}
