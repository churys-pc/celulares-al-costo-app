// Especificaciones más importantes, en el orden en que se muestran primero en la ficha, el comparador y la presentación.
import type { Spec } from './types.ts';

export interface KeySpec { label: string; keys: string[]; value: (get: (key: string) => string | null) => string | null }

const net = (v: string | null) => (!v ? null : /^s[ií]/i.test(v) ? '5G' : /^no/i.test(v) ? '4G (sin 5G)' : v);

export const KEY_SPECS: KeySpec[] = [
  { label: 'Procesador', keys: ['Procesador'], value: (g) => g('Procesador') },
  { label: 'RAM', keys: ['RAM'], value: (g) => g('RAM') },
  { label: 'Pantalla', keys: ['Tamaño y tipo', 'Frecuencia'], value: (g) => [g('Tamaño y tipo'), g('Frecuencia')].filter(Boolean).join(' · ') || null },
  { label: 'Cámara principal', keys: ['Cámara principal'], value: (g) => g('Cámara principal') },
  { label: 'Cámara frontal', keys: ['Cámara frontal'], value: (g) => g('Cámara frontal') },
  { label: 'Batería', keys: ['Batería'], value: (g) => g('Batería') },
  { label: 'Almacenamiento', keys: ['Almacenamiento'], value: (g) => g('Almacenamiento') },
  { label: 'Carga', keys: ['Carga rápida'], value: (g) => g('Carga rápida') },
  { label: 'Red móvil', keys: ['5G'], value: (g) => net(g('5G')) },
];

/** Orden de los datos dentro de cada grupo de la ficha completa: primero los importantes. */
export const SPEC_PRIORITY = ['Procesador', 'RAM', 'Tamaño y tipo', 'Resolución', 'Frecuencia', 'Cámara principal', 'Cámara frontal',
  'Batería', 'Almacenamiento', 'Carga rápida', '5G', 'Red', 'Carga inalámbrica', 'GPU', 'Brillo', 'Gran angular', 'Teleobjetivo', 'Zoom óptico', 'Video', 'microSD'];

const norm = (s: string) => s.trim().toLowerCase();

/** Valores de las especificaciones clave de una ficha (solo las que tienen dato). */
export function keySpecValues(specs: Spec[]): { label: string; value: string }[] {
  const get = (k: string) => specs.find((s) => norm(s.key) === norm(k))?.value?.trim() || null;
  return KEY_SPECS.map((k) => ({ label: k.label, value: k.value(get) })).filter((x): x is { label: string; value: string } => !!x.value);
}

export function prioritySort<T extends { key: string }>(list: T[]): T[] {
  const rank = (k: string) => { const i = SPEC_PRIORITY.findIndex((p) => norm(p) === norm(k)); return i < 0 ? SPEC_PRIORITY.length : i; };
  return list.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x.key) - rank(b.x.key) || a.i - b.i).map((o) => o.x);
}
