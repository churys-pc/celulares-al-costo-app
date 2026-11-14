// «Buscar imagen»: corre las búsquedas de portada en segundo plano, fuera de cualquier pantalla, así siguen aunque
// se cierre el formulario o se cambie de sección. El servidor busca y descarga; acá se quita el fondo y se arma el
// WebP 768 × 768 con el mismo proceso que las portadas del catálogo (coverProcess.ts). Al terminar se recargan las
// portadas y se actualizan solas en catálogo, ficha, comparador y la lista de cargados.
import { useEffect, useState } from 'react';
import { processCover } from './coverProcess.ts';
import { loadCovers } from './covers.ts';

export type JobStatus = 'pending' | 'searching' | 'processing' | 'done' | 'not_found' | 'offline' | 'error' | 'cancelled' | 'discarded';
export interface CoverJob {
  id: string; key: string; brand: string; model: string; productRepoId: string | null;
  status: JobStatus; message: string | null; createdAt: string; updatedAt: string; candidates: number; url?: string | null;
}
export type CoverRequest = { status: 'exists'; key: string; url: string } | CoverJob;
export const isActive = (j: Pick<CoverJob, 'status'>) => j.status === 'pending' || j.status === 'searching' || j.status === 'processing';

let jobs = new Map<string, CoverJob>();
const running = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
function put(j: CoverJob) { jobs = new Map(jobs).set(j.id, j); emit(); }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data as T;
}
const toDataUrl = (b: Blob) => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = ko; r.readAsDataURL(b); });

/** Pide la portada de un modelo. Si ya existe vuelve enseguida; si no, arranca la búsqueda y devuelve la tarea. */
export async function requestCover(brand: string, model: string, productRepoId?: string | null): Promise<CoverRequest> {
  const r = await call<CoverRequest>('POST', '/api/cover-jobs', { brand, model, productRepoId: productRepoId ?? undefined });
  if (r.status === 'exists') return r;
  put(r as CoverJob);
  void run((r as CoverJob).id);
  return r;
}

export async function linkJob(id: string, productRepoId: string) { put(await call<CoverJob>('PATCH', `/api/cover-jobs/${id}`, { productRepoId })); }
export async function cancelJob(id: string, reason: string) { put(await call<CoverJob>('PATCH', `/api/cover-jobs/${id}`, { cancel: true, reason })); }

/** Corre una búsqueda (una sola vez por tarea aunque se pida de varios lugares). */
async function run(id: string) {
  if (running.has(id)) return;
  running.add(id);
  try {
    let j = await call<CoverJob>('POST', `/api/cover-jobs/${id}/search`);
    put(j);
    if (j.status !== 'processing') return finish(j);
    let offline = 0;
    for (let i = 0; i < j.candidates; i++) {
      try {
        const res = await fetch(`/api/cover-jobs/${id}/image/${i}`);
        if (!res.ok) { const e = await res.json().catch(() => ({})); if (/conexi/i.test(e.error ?? '')) offline++; continue; }
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        const small = Math.max(bmp.width, bmp.height) < 300; bmp.close();
        if (small) continue; // imagen demasiado chica: no queda nítida
        const out = await processCover(blob);
        j = await call<CoverJob>('POST', `/api/cover-jobs/${id}/result`, { index: i, dataUrl: await toDataUrl(out.blob) });
        put(j);
        return finish(j);
      } catch { /* este candidato no sirve (fondo no liso, imagen rota): se prueba el siguiente */ }
      const cur = jobs.get(id);
      if (cur && !isActive(cur)) return;
    }
    j = await call<CoverJob>('POST', `/api/cover-jobs/${id}/fail`, { reason: offline && offline === j.candidates ? 'offline' : 'not_found' });
    put(j); finish(j);
  } catch (e) {
    const cur = jobs.get(id);
    if (cur) put({ ...cur, status: 'error', message: (e as Error).message });
  } finally { running.delete(id); }
}

function finish(j: CoverJob) { if (j.status === 'done') void loadCovers(); }

/** Al iniciar sesión: retoma las búsquedas que quedaron a medias (por ejemplo si se cerró la app). */
export async function resumeCoverJobs() {
  try {
    const list = await call<CoverJob[]>('GET', '/api/cover-jobs');
    jobs = new Map(list.map((j) => [j.id, j])); emit();
    for (const j of list) if (isActive(j)) void run(j.id);
  } catch { /* sin sesión todavía */ }
}

/** Hook: lista de búsquedas (se actualiza sola). */
export function useCoverJobs(): CoverJob[] {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return [...jobs.values()];
}
