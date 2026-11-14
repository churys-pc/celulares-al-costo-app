import type { Product, Settings } from '../shared/types.ts';

export const money = (n: number, c: string) => `${c} ${n.toLocaleString('es-UY', { maximumFractionDigits: 0 })}`;

/** Precio en la otra moneda solo si hay cotización configurada; si no, null (no se inventa). */
export const converted = (p: Pick<Product, 'price' | 'currency'>, s: Settings | null): string | null => {
  if (!s?.usdRate || !p.price) return null;
  return p.currency === 'USD' ? money(p.price * s.usdRate, 'UYU') : money(p.price / s.usdRate, 'USD');
};

export const storageLabel = (gb: number | null) => (gb ? (gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`) : null);

export const variantLabel = (p: Product) =>
  [storageLabel(p.storageGb), p.ramGb && `${p.ramGb} GB RAM`, p.color, p.region].filter(Boolean).join(' · ');

export const USE_LABEL: Record<string, string> = { gaming: 'Gaming', fotos: 'Fotos', redes: 'Redes', trabajo: 'Trabajo' };
export const STATUS_LABEL: Record<string, string> = { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido', en_revision: 'En revisión' };

/** Precio del catálogo: dólares como principal y pesos = dólares × cotización de Ajustes (sin cotización, pesos = null). */
export function dualPrice(p: Pick<Product, 'price' | 'currency'>, s: Settings | null): { usd: number | null; uyu: number | null } {
  const rate = s?.usdRate || null;
  if (!p.price) return { usd: null, uyu: null };
  if (p.currency === 'USD') return { usd: p.price, uyu: rate ? Math.round(p.price * rate) : null };
  return { usd: rate ? Math.round(p.price / rate) : null, uyu: p.price };
}
/** Números con separador de miles; los centavos se muestran solo si existen (USD 199,99; $ 8.100). */
export const num = (n: number) => n.toLocaleString('es-UY', { maximumFractionDigits: 2 });

/** «1 año», «2 años» o «N meses». */
export const warrantyLabel = (m: number) => (m % 12 === 0 ? `${m / 12} ${m === 12 ? 'año' : 'años'}` : `${m} meses`);
