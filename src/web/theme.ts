// Colores de la app: cada paleta cambia el tono (--hue) y la intensidad (--sat) de todo el tema oscuro.
// Se guarda en esta PC (cada vendedor puede elegir la suya); los colores de estado (verde, rojo, ámbar) no cambian.

export interface Palette { id: string; name: string; group: 'masculinos' | 'femeninos'; hue: number; sat: number }

export const PALETTES: Palette[] = [
  { id: 'azul', name: 'Azul eléctrico', group: 'masculinos', hue: 215, sat: 1 },
  { id: 'grafito', name: 'Grafito', group: 'masculinos', hue: 215, sat: 0.14 },
  { id: 'esmeralda', name: 'Verde esmeralda', group: 'masculinos', hue: 152, sat: 0.8 },
  { id: 'carmesi', name: 'Rojo carmesí', group: 'masculinos', hue: 352, sat: 0.85 },
  { id: 'petroleo', name: 'Azul petróleo', group: 'masculinos', hue: 196, sat: 0.55 },
  { id: 'rosa', name: 'Rosa', group: 'femeninos', hue: 330, sat: 0.9 },
  { id: 'lavanda', name: 'Lavanda', group: 'femeninos', hue: 268, sat: 0.75 },
  { id: 'fucsia', name: 'Fucsia', group: 'femeninos', hue: 305, sat: 0.9 },
  { id: 'coral', name: 'Coral', group: 'femeninos', hue: 12, sat: 0.85 },
  { id: 'menta', name: 'Menta', group: 'femeninos', hue: 165, sat: 0.55 },
];
export const DEFAULT_THEME = 'azul';
const KEY = 'app.theme';

export type ThemeChoice = { id: string } | { id: 'custom'; color: string };

/** Tono e intensidad de un color elegido a mano (#RRGGBB). */
export function hueOf(hex: string): { hue: number; sat: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { hue: 215, sat: 1 };
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const l = (max + min) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { hue: Math.round(((h * 60) + 360) % 360), sat: Math.round(Math.min(1, Math.max(0.08, s)) * 100) / 100 };
}

export function themeValues(t: ThemeChoice): { hue: number; sat: number } {
  if (t.id === 'custom' && 'color' in t) return hueOf(t.color);
  const p = PALETTES.find((x) => x.id === t.id) ?? PALETTES[0];
  return { hue: p.hue, sat: p.sat };
}

export function loadTheme(): ThemeChoice {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v?.id === 'custom' && /^#[0-9a-f]{6}$/i.test(v.color)) return { id: 'custom', color: v.color };
    if (v?.id && PALETTES.some((p) => p.id === v.id)) return { id: v.id };
  } catch { /* preferencia dañada: se usa la de fábrica */ }
  return { id: DEFAULT_THEME };
}

export function applyTheme(t: ThemeChoice, save = true) {
  const { hue, sat } = themeValues(t);
  const s = document.documentElement.style;
  s.setProperty('--hue', String(hue)); s.setProperty('--sat', String(sat));
  if (save) try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* sin almacenamiento: vale hasta cerrar */ }
}
