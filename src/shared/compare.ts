// Lógica pura del comparador (sin I/O): filas alineadas, AnTuTu comparable y resumen para el cliente.
// Regla de oro: si faltan datos o no son comparables, se dice "Sin datos" / "No comparable"; nunca se estima.
import { ANTUTU_VERSIONS, SPEC_GROUPS, type AntutuVersion, type Benchmark, type CompareModel } from './types.ts';

export interface CompareRow { group: string; key: string; values: (string | null)[]; differs: boolean }
export interface AntutuResult {
  version: AntutuVersion | null;
  comparable: boolean;
  warnings: string[];
  entries: (Benchmark | null)[];
  /** Porcentaje respecto del mejor (0-100) por modelo; null si no hay dato. */
  pct: (number | null)[];
  best: number | null;
}
export interface Comparison { rows: CompareRow[]; antutu: AntutuResult; summary: string[]; usd: (number | null)[] }

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const fmt = (n: number) => Math.round(n).toLocaleString('es-UY');
const label = (m: CompareModel) => (m.brand === 'Apple' ? m.model : `${m.brand} ${m.model}`);

export function buildRows(models: CompareModel[]): CompareRow[] {
  const order = new Map<string, { group: string; key: string; pos: number }>();
  models.forEach((m) => m.specs.forEach((s, i) => {
    const id = `${s.group}|${norm(s.key)}`;
    if (!order.has(id)) order.set(id, { group: s.group, key: s.key, pos: SPEC_GROUPS.indexOf(s.group as never) * 1000 + i });
  }));
  return [...order.entries()].sort((a, b) => a[1].pos - b[1].pos).map(([id, r]) => {
    const values = models.map((m) => m.specs.find((s) => `${s.group}|${norm(s.key)}` === id)?.value ?? null);
    const present = values.filter((v): v is string => v !== null).map(norm);
    return { group: r.group, key: r.key, values, differs: new Set(present).size > 1 || present.length !== values.length };
  });
}

export function pickAntutu(models: CompareModel[]): AntutuResult {
  const warnings: string[] = [];
  // Versión más nueva que tengan TODOS; si no hay, la más nueva que tenga alguno (y se marca no comparable).
  const common = ANTUTU_VERSIONS.find((v) => models.every((m) => m.benchmarks.some((b) => b.version === v)));
  const any = ANTUTU_VERSIONS.find((v) => models.some((m) => m.benchmarks.some((b) => b.version === v)));
  const version = common ?? any ?? null;
  const entries = models.map((m) => m.benchmarks.find((b) => b.version === version) ?? null);
  const comparable = !!common && models.length > 1;
  if (!version) warnings.push('Ningún modelo tiene puntaje AnTuTu cargado.');
  else if (!common) warnings.push(`No todos tienen AnTuTu ${version}. Puntajes de distintas versiones no se pueden comparar.`);
  const platforms = new Set(entries.filter(Boolean).map((b) => b!.platform));
  if (platforms.size > 1) warnings.push('AnTuTu indica que Android (Vulkan) e iOS (Metal) no son directamente comparables: tomalo como referencia.');
  const max = Math.max(0, ...entries.map((b) => b?.total ?? 0));
  const best = comparable && max > 0 ? entries.findIndex((b) => b?.total === max) : null;
  return { version, comparable, warnings, entries, pct: entries.map((b) => (b && max ? Math.round((b.total / max) * 100) : null)), best };
}

/** Precio en USD para comparar; con UYU requiere cotización configurada. */
export function toUsd(m: CompareModel, usdRate: number | null): number | null {
  if (!m.priceFrom || m.priceFrom.price <= 0) return null;
  if (m.priceFrom.currency === 'USD') return m.priceFrom.price;
  return usdRate ? m.priceFrom.price / usdRate : null;
}

const parseNum = (v: string | null | undefined, unit: RegExp) => {
  const m = v?.replace(/\./g, '').match(unit);
  return m ? Number(m[1].replace(',', '.')) : null;
};

export function buildComparison(models: CompareModel[], usdRate: number | null): Comparison {
  const rows = buildRows(models);
  const antutu = pickAntutu(models);
  const usd = models.map((m) => toUsd(m, usdRate));
  const summary: string[] = [];
  if (models.length < 2) return { rows, antutu, summary, usd };

  if (antutu.comparable && antutu.best !== null) {
    summary.push(`Más rendimiento (gaming, multitarea): ${label(models[antutu.best])} con ${fmt(antutu.entries[antutu.best]!.total)} puntos AnTuTu ${antutu.version}.`);
  } else summary.push('Rendimiento: sin datos comparables de AnTuTu para todos los modelos.');

  const priced = usd.map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p !== null);
  if (priced.length === models.length) {
    const cheap = priced.reduce((a, b) => (b.p < a.p ? b : a));
    const exp = priced.reduce((a, b) => (b.p > a.p ? b : a));
    summary.push(`Más económico: ${label(models[cheap.i])} (desde US$ ${fmt(cheap.p)}).`);
    if (antutu.comparable && cheap.i !== exp.i) {
      const a = antutu.entries[cheap.i]!.total, b = antutu.entries[exp.i]!.total;
      const pricePct = Math.round(((exp.p - cheap.p) / cheap.p) * 100);
      const perfPct = Math.round(((b - a) / a) * 100);
      summary.push(`¿Vale la diferencia? ${label(models[exp.i])} cuesta ${pricePct}% más (US$ ${fmt(exp.p - cheap.p)}) y rinde ${perfPct >= 0 ? `${perfPct}% más` : `${-perfPct}% menos`} en AnTuTu.`
        + (perfPct > pricePct ? ' En rendimiento, la diferencia se justifica.' : perfPct <= 0 ? ' En rendimiento no se justifica.' : ' Se paga más de lo que crece el rendimiento; conviene si importan otras características (cámara, pantalla, marca).'));
      const value = priced.map((x) => ({ i: x.i, v: antutu.entries[x.i]!.total / x.p })).reduce((a, b) => (b.v > a.v ? b : a));
      summary.push(`Mejor relación precio/rendimiento: ${label(models[value.i])} (${fmt(value.v)} puntos por dólar).`);
    }
  } else summary.push('Precio: falta precio en catálogo (con stock) para algún modelo' + (usdRate ? '.' : ' o la cotización USD en Ajustes.'));

  const batt = models.map((m) => parseNum(m.specs.find((s) => norm(s.key) === 'batería')?.value, /(\d+)\s*mah/i));
  if (batt.every((b) => b !== null)) {
    const i = batt.indexOf(Math.max(...(batt as number[])));
    if (new Set(batt).size > 1) summary.push(`Mayor batería (redes, uso intenso): ${label(models[i])} con ${fmt(batt[i]!)} mAh (la autonomía real también depende del chip y la pantalla).`);
  }
  return { rows, antutu, summary, usd };
}
