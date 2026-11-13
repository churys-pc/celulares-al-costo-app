// Portadas por modelo: tipos y búsqueda por nombre, compartidos entre servidor y app.

export interface CoverEntry {
  key: string;
  brand: string;
  /** Nombres del modelo que usan esta portada (catálogo, fichas y base de comparación). */
  models: string[];
  /** Imagen oficial de origen. */
  url: string;
  /** Página oficial donde se tomó la imagen. */
  page: string;
  /** Código de modelo del fabricante verificado en la imagen (Samsung). */
  code?: string;
  note?: string;
}

export interface CoverInfo { key: string; brand: string; models: string[]; page: string; note: string | null; url: string | null; bundled?: boolean }

/** Normaliza el nombre de un modelo: minúsculas, sin paréntesis, sin espacios y «Plus» = «+». */
export function normalizeModelName(s: string): string {
  return s.toLowerCase().replace(/[()]/g, ' ').replace(/\bplus\b/g, '+').replace(/\s+/g, '').trim();
}

/** Índice marca|modelo → portada, para buscar rápido en la app. */
export function coverIndex(list: CoverInfo[]): Map<string, CoverInfo> {
  const map = new Map<string, CoverInfo>();
  for (const c of list) for (const m of c.models) map.set(c.brand.toLowerCase() + '|' + normalizeModelName(m), c);
  return map;
}
