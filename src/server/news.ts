// «Novedades de celulares» para Inicio: lee los feeds públicos (RSS/Atom) de los fabricantes y de un medio de
// telefonía, se queda con lanzamientos confirmados y actualizaciones de software de las marcas del catálogo y
// guarda las últimas en la base (settings.newsCache) para mostrarlas sin conexión, con su fecha.
import type { Db } from './db.ts';

export interface NewsItem {
  brand: string;
  title: string;
  /** Fecha de publicación (ISO). */
  date: string;
  summary: string;
  url: string;
  source: string;
  /** true si la fuente es el fabricante. */
  official: boolean;
}
export interface NewsState { items: NewsItem[]; fetchedAt: string | null; lastAttemptAt: string | null; error: string | null }

interface Feed { url: string; source: string; official: boolean; brand?: string }
/** Fuentes: newsrooms oficiales en español cuando existen; Lenovo (dueña de Motorola) y Xataka Móvil para el resto. */
export const FEEDS: Feed[] = [
  { url: 'https://www.apple.com/mx/newsroom/rss-feed.rss', source: 'Apple Newsroom (México)', official: true, brand: 'Apple' },
  { url: 'https://news.samsung.com/latin/feed', source: 'Samsung Newsroom Latinoamérica', official: true, brand: 'Samsung' },
  { url: 'https://news.lenovo.com/feed/', source: 'Lenovo / Motorola StoryHub', official: true },
  { url: 'https://www.xatakamovil.com/index.xml', source: 'Xataka Móvil', official: false },
];

const BRANDS: [string, RegExp][] = [
  ['Apple', /\b(iphone|ios \d|ios\b|apple intelligence)/i],
  ['Samsung', /\b(galaxy|one ui)\b/i],
  ['Xiaomi', /\b(xiaomi|redmi|poco|hyperos)\b/i],
  ['Motorola', /\b(motorola|moto g\d*|moto e\d*|razr|edge \d\d)\b/i],
  ['Honor', /\bhonor\b/i],
];
/** Lo que más sirve para responder consultas: lanzamientos, llegada al mercado y actualizaciones de software. */
const USEFUL = /(lanza|presenta|anuncia|llega|disponible|ya se puede|actualizaci|update|one ui|hyperos|ios \d|android \d|nuev[oa]s? (galaxy|iphone|redmi|poco|moto|honor)|launch|announce|unveil|introduc|rolls? out|now available)/i;
/** Rumores, filtraciones y ofertas (precios de otros países): no se muestran. */
const EXCLUDE = /(rumor|filtra|filtraci|podr[íi]a|se espera|supuest|leak|tipped|could |might |reportedly|render|oferta|descuento|black friday|cyber|gangas|chollo|rebaja|cup[óo]n|deal|\bvs\b|comparativa|lavarropa|lavadora|monitor|televisor|smart tv|\btv\b|heladera|refrigerador|aire acondicionado|windfree|hoteler)/i;

const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const strip = (html: string) => decode(decode(html)).replace(/<(script|style|figure)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? '';

/** Resumen breve: primeras oraciones (≤ 240 caracteres), sin precios en otras monedas (no son de Uruguay). */
export function summarize(text: string, title: string): string {
  const sentences = text.replace(/^(.*?)(\s+La noticia .* fue publicada.*)$/i, '$1').split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 20 && !/[€£$]|\beuros?\b|\busd\b|\bd[óo]lares\b|\bprecio/i.test(s) && s.trim() !== title.trim());
  let out = '';
  for (const s of sentences) { if ((out + ' ' + s).trim().length > 240) break; out = (out + ' ' + s).trim(); }
  if (!out && sentences[0]) out = sentences[0].slice(0, 237).replace(/\s+\S*$/, '') + '…';
  return out;
}

/** Lee un RSS 2.0 o un Atom (sin dependencias). */
export function parseFeed(xml: string, feed: Feed): NewsItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const out: NewsItem[] = [];
  for (const b of blocks) {
    const title = strip(tag(b, 'title'));
    let url = decode(tag(b, 'link')).trim();
    if (!url) url = decode(b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? b.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? '');
    const dateRaw = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const date = new Date(decode(dateRaw).trim());
    const body = strip(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content') || tag(b, 'content:encoded'));
    if (!title || !/^https:\/\//.test(url) || isNaN(+date)) continue;
    const text = `${title} ${body.slice(0, 600)}`;
    const brand = feed.brand ?? BRANDS.find(([, re]) => re.test(title))?.[0] ?? BRANDS.find(([, re]) => re.test(text))?.[0];
    if (!brand) continue;
    out.push({ brand, title, date: date.toISOString(), summary: summarize(body, title), url, source: feed.source, official: feed.official });
  }
  return out;
}

/** Elige hasta `max` novedades: de celulares, útiles para el mostrador, recientes y de marcas distintas si se puede. */
export function pickNews(all: NewsItem[], now = Date.now(), max = 3): NewsItem[] {
  const recent = all.filter((n) => now - +new Date(n.date) < 45 * 86_400_000 && +new Date(n.date) <= now + 86_400_000);
  const relevant = recent.filter((n) => {
    const text = `${n.title} ${n.summary}`;
    if (EXCLUDE.test(n.title)) return false;
    const phone = BRANDS.find(([b]) => b === n.brand)![1].test(text) || /\b(celular|smartphone|tel[ée]fono|m[óo]vil|phone)\b/i.test(text);
    return phone && USEFUL.test(text);
  });
  const score = (n: NewsItem) => (n.official ? 2 : 0) - (now - +new Date(n.date)) / (7 * 86_400_000);
  const seen = new Set<string>();
  const sorted = [...relevant].sort((a, b) => score(b) - score(a)).filter((n) => !seen.has(n.url) && seen.add(n.url));
  const picked: NewsItem[] = [];
  for (const n of sorted) if (picked.length < max && !picked.some((p) => p.brand === n.brand)) picked.push(n);
  for (const n of sorted) if (picked.length < max && !picked.includes(n)) picked.push(n);
  return picked.sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

const KEY = 'newsCache';
export function newsState(db: Db): NewsState {
  const v = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY)?.value;
  try { if (v) return JSON.parse(String(v)); } catch { /* caché dañada */ }
  return { items: [], fetchedAt: null, lastAttemptAt: null, error: null };
}
function saveState(db: Db, s: NewsState) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(s));
}

type Fetcher = (url: string) => Promise<string>;
const httpGet: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CelularesAlCosto', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

let running: Promise<NewsState> | null = null;
/** Baja los feeds. Si ninguno responde, se conservan las últimas novedades guardadas. */
export function refreshNews(db: Db, get: Fetcher = httpGet, now = Date.now()): Promise<NewsState> {
  return (running ??= (async () => {
    const prev = newsState(db);
    const results = await Promise.allSettled(FEEDS.map(async (f) => parseFeed(await get(f.url), f)));
    const ok = results.filter((r): r is PromiseFulfilledResult<NewsItem[]> => r.status === 'fulfilled');
    const at = new Date(now).toISOString();
    let state: NewsState;
    if (!ok.length) state = { ...prev, lastAttemptAt: at, error: 'Sin conexión con las fuentes de novedades.' };
    else {
      const items = pickNews(ok.flatMap((r) => r.value), now);
      state = { items: items.length ? items : prev.items, fetchedAt: at, lastAttemptAt: at,
        error: ok.length < FEEDS.length ? `${FEEDS.length - ok.length} de ${FEEDS.length} fuentes no respondieron.` : null };
    }
    saveState(db, state);
    return state;
  })().finally(() => { running = null; }));
}

export function startNewsRefresh(db: Db, log?: (m: string) => void, everyMs = 3 * 3600_000) {
  const run = () => refreshNews(db).then((s) => log?.(`Novedades: ${s.items.length} (${s.error ?? 'ok'})`)).catch(() => {});
  const first = setTimeout(run, 8000); first.unref?.();
  const t = setInterval(run, everyMs); t.unref?.();
}
