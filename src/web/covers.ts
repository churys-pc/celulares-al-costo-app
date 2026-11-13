// Portadas en la app: carga la lista, resuelve la portada de cada modelo y genera en segundo plano
// las que falten en esta PC (baja la imagen oficial, quita el fondo y la guarda como WebP).
import { useEffect, useState } from 'react';
import { coverIndex, normalizeModelName, type CoverInfo } from '../shared/covers.ts';
import { processCover } from './coverProcess.ts';

let list: CoverInfo[] = [];
let index = new Map<string, CoverInfo>();
const listeners = new Set<() => void>();
const failed = new Set<string>();
let running = false;

function set(next: CoverInfo[]) {
  list = next; index = coverIndex(next);
  listeners.forEach((f) => f());
}

export async function loadCovers(): Promise<CoverInfo[]> {
  const res = await fetch('/api/covers');
  if (res.ok) set(await res.json());
  return list;
}

/** URL de la portada del modelo o null si no hay (o si todavía no se generó en esta PC). */
export function coverUrl(brand: string, model: string): string | null {
  return index.get(brand.toLowerCase() + '|' + normalizeModelName(model))?.url ?? null;
}

/** Hook: devuelve la función de búsqueda y vuelve a pintar cuando aparecen portadas nuevas. */
export function useCovers(): (brand: string, model: string) => string | null {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n: number) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return coverUrl;
}

const toDataUrl = (b: Blob) => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = ko; r.readAsDataURL(b); });

/** Genera, de a una, las portadas que falten. Los errores quedan para el próximo inicio de la app. */
export async function startCoverWorker() {
  if (running) return;
  running = true;
  try {
    await loadCovers();
    for (const c of list.filter((x) => !x.url && !failed.has(x.key))) {
      try {
        const src = await fetch(`/api/covers/${c.key}/source`);
        if (!src.ok) throw new Error(`origen ${src.status}`);
        const out = await processCover(await src.blob());
        const res = await fetch(`/api/covers/${c.key}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl: await toDataUrl(out.blob), width: out.width, height: out.height }),
        });
        if (!res.ok) throw new Error(`guardar ${res.status}`);
        const saved: CoverInfo = await res.json();
        set(list.map((x) => (x.key === saved.key ? saved : x)));
      } catch (e) {
        failed.add(c.key);
        console.warn('[portadas]', c.key, (e as Error).message);
      }
    }
  } finally { running = false; }
}
