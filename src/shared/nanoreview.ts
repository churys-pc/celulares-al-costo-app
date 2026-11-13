// Lector de fichas públicas de Nanoreview (búsqueda en línea para modelos sin stock).
// Solo extrae datos factuales de la tabla de especificaciones y el puntaje AnTuTu; si el formato cambia,
// devuelve lo que pudo leer y el resto queda «Sin datos» (nunca se inventa).
import type { SpecGroup } from './types.ts';

export interface LookupResult { slug: string; name: string }
export interface ParsedPhone {
  name: string;
  brand: string;
  model: string;
  specs: { group: SpecGroup; key: string; value: string; highlight: boolean }[];
  antutu: { version: string; total: number; cpu: number | null; gpu: number | null; mem: number | null; ux: number | null } | null;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** Filas «clave | valor» de las tablas (primera aparición de cada clave; se quita el «*» final). */
export function tableRows(html: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1]));
    if (cells.length >= 2 && cells[0]) {
      const key = cells[0].replace(/\*$/, '').trim();
      if (!map.has(key)) map.set(key, cells[1]);
    }
  }
  return map;
}

const num = (s?: string) => { const n = s ? Number(s.replace(/[^\d]/g, '')) : NaN; return Number.isFinite(n) && n > 0 ? n : null; };
/** Traduce los valores típicos en inglés de la tabla. */
const es = (s?: string) => s?.replace(/^Yes\b/i, 'Sí').replace(/^No\b/i, 'No').replace(/Depends on the region/i, 'Según la región')
  .replace(/\(Can be upgraded to ([^)]+)\)/i, '(actualizable a $1)').replace(/Up to (\d+)\s*FPS/i, 'hasta $1 fps');
const yesNo = es;
const video = (k8?: string, k4?: string) => (k8 && !/^no/i.test(k8) ? `8K ${es(k8)}` : k4 && !/^no/i.test(k4) ? `4K ${es(k4)}` : undefined);
const mm = (s?: string) => s?.match(/([\d.]+)\s*mm/)?.[1];

export function splitBrand(name: string): { brand: string; model: string } {
  const [brand, ...rest] = name.trim().split(/\s+/);
  return { brand, model: rest.join(' ') || name };
}

export function parseNanoreviewHtml(html: string): ParsedPhone {
  const title = strip(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const name = title.split(':')[0].trim();
  const r = tableRows(html);
  const g = (k: string) => r.get(k);
  const dims = [mm(g('Height')), mm(g('Width')), mm(g('Thickness'))];
  const raw: [SpecGroup, string, string | undefined, boolean?][] = [
    ['Chip', 'Procesador', g('Chipset'), true],
    ['Chip', 'GPU', g('Graphics')],
    ['Memoria', 'RAM', g('RAM size')],
    ['Memoria', 'Almacenamiento', g('Storage size'), true],
    ['Pantalla', 'Tamaño y tipo', g('Size') && `${g('Size')!.replace(' inches', '"')} ${g('Type') ?? ''}`.trim(), true],
    ['Pantalla', 'Resolución', g('Resolution')?.replace(' pixels', '')],
    ['Pantalla', 'Frecuencia', g('Refresh rate')],
    ['Pantalla', 'Brillo máximo', g('Max rated brightness')],
    ['Cámaras', 'Cámara principal', g('Matrix')?.replace(' megapixels', ' MP'), true],
    ['Cámaras', 'Lentes', g('Lenses')],
    ['Cámaras', 'Cámara frontal', g('Megapixels')?.replace(' megapixels', ' MP')],
    ['Cámaras', 'Video', video(g('8K video recording'), g('4K video recording'))],
    ['Batería y carga', 'Batería', g('Capacity')],
    ['Batería y carga', 'Carga rápida', g('Max charge power')],
    ['Batería y carga', 'Carga inalámbrica', es(g('Wireless charging'))],
    ['Conectividad', '5G', yesNo(g('5G support'))],
    ['Conectividad', 'NFC', yesNo(g('NFC'))],
    ['Conectividad', 'eSIM', yesNo(g('eSIM support'))],
    ['Conectividad', 'Puerto', g('USB type') ? `${g('USB type')!.replace('USB Type-C', 'USB-C')} ${g('USB version') ?? ''}`.trim() : undefined],
    ['Dimensiones', 'Peso', g('Weight')?.replace(/\s*\(.*\)/, '')],
    ['Dimensiones', 'Medidas', dims.every(Boolean) ? `${dims.join(' x ')} mm` : undefined],
    ['Protección', 'Resistencia', g('Waterproof')],
    ['Soporte', 'Sistema operativo', es(g('Operating system'))],
  ];
  const specs = raw.filter((x): x is [SpecGroup, string, string, boolean?] => !!x[2] && x[2] !== '-' && x[2].length < 200)
    .map(([group, key, value, hl]) => ({ group, key, value: value.replace(/\.(\d)/g, ',$1'), highlight: !!hl }));

  // Puntaje AnTuTu principal (barra «AnTuTu Benchmark N») + desglose de la tabla.
  const bar = html.match(/AnTuTu Benchmark\s*(\d+)[\s\S]{0,400}?score-bar-result-number[^>]*>\s*([\d\s,.]+)</i);
  const total = num(bar?.[2]) ?? null;
  const antutu = bar && total ? {
    version: `v${bar[1]}`, total,
    cpu: num(g('CPU')), gpu: num(g('GPU')), mem: num(g('Memory')), ux: num(g('UX')),
  } : null;
  return { name, ...splitBrand(name), specs, antutu };
}

export function parseSearch(json: unknown): LookupResult[] {
  if (!Array.isArray(json)) return [];
  return json.filter((x) => x && x.content_type === 'phone' && /^[a-z0-9-]+$/.test(x.slug))
    .map((x) => ({ slug: String(x.slug), name: String(x.name ?? x.label ?? x.slug) }));
}
