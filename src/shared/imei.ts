// IMEI Check: validación de formato (igual en la app y en el servidor) y armado del resultado por IMEI y por equipo.
// La validación local solo comprueba el formato: 15 dígitos y dígito de control (Luhn). No dice nada sobre bloqueos.

export type ImeiValidation = { ok: true; digits: string } | { ok: false; error: string };

/** Valida un IMEI escrito o pegado. Admite espacios y guiones como separadores; no completa ni recorta. */
export function validateImei(raw: unknown): ImeiValidation {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, error: 'Ingresá el IMEI.' };
  if (/[^\d\s-]/.test(s)) return { ok: false, error: 'El IMEI solo lleva números (podés separarlos con espacios o guiones).' };
  const digits = s.replace(/[\s-]/g, '');
  if (digits.length !== 15) return { ok: false, error: `El IMEI tiene 15 dígitos (hay ${digits.length}).` };
  if (/^0+$/.test(digits)) return { ok: false, error: 'IMEI inválido (todos ceros).' };
  if (!luhnOk(digits)) return { ok: false, error: 'El dígito de control no coincide: revisá el número.' };
  return { ok: true, digits };
}

export function luhnOk(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** IMEI enmascarado para mostrar y registrar: «35•••••••••4021». */
export const maskImei = (digits: string) => (digits.length === 15 ? `${digits.slice(0, 2)}${'•'.repeat(9)}${digits.slice(11)}` : '•••');

/** Estado de una fuente para un IMEI. */
export type SourceStatus =
  | 'reported'       // reporte vigente confirmado por la fuente
  | 'clean'          // respuesta negativa explícita
  | 'history'        // reporte histórico retirado (antecedente)
  | 'not_configured' // proveedor sin configurar
  | 'timeout' | 'error' | 'unexpected' | 'pending';

export interface SourceResult {
  provider: string; providerName: string; base: string; coverage: string; coversUruguay: boolean;
  status: SourceStatus; reason: string | null; reportDate: string | null; checkedAt: string;
  message: string | null; model: { brand: string; model: string } | null; retryCharges: boolean;
}

export type ImeiStatus = 'reported' | 'clean' | 'partial' | 'unverified';
export const IMEI_STATUS_LABEL: Record<ImeiStatus, string> = {
  reported: 'Reporte activo',
  clean: 'Sin reporte en las fuentes consultadas',
  partial: 'Verificación parcial',
  unverified: 'No se pudo verificar',
};

export interface ImeiSummary {
  status: ImeiStatus; needsReview: boolean; history: boolean; notes: string[];
  /** Bases distintas con respuesta útil (dos servicios sobre la misma base cuentan una vez). */
  bases: string[];
}

const ANSWERED: SourceStatus[] = ['reported', 'clean', 'history'];

/** Resumen de un IMEI a partir de las respuestas de cada fuente. */
export function summarizeImei(results: SourceResult[]): ImeiSummary {
  const notes: string[] = [];
  // Una respuesta por base: si dos servicios consultan la misma base, vale la más grave y cuenta una vez.
  const byBase = new Map<string, SourceResult>();
  const rank = (s: SourceStatus) => (s === 'reported' ? 3 : s === 'history' ? 2 : s === 'clean' ? 1 : 0);
  for (const r of results.filter((x) => ANSWERED.includes(x.status))) {
    const cur = byBase.get(r.base);
    if (!cur || rank(r.status) > rank(cur.status)) byBase.set(r.base, r);
  }
  const answers = [...byBase.values()];
  const reported = answers.some((a) => a.status === 'reported');
  const clean = answers.filter((a) => a.status === 'clean' || a.status === 'history');
  const history = answers.some((a) => a.status === 'history');
  const failed = results.filter((r) => !ANSWERED.includes(r.status) && r.status !== 'not_configured' && r.status !== 'pending');
  if (history) notes.push('Figura un reporte anterior retirado (antecedente).');
  if (reported) {
    const needsReview = clean.length > 0;
    if (needsReview) notes.push('Las fuentes no coinciden: requiere revisión antes de comprar o tomar en parte de pago.');
    return { status: 'reported', needsReview, history, notes, bases: answers.map((a) => a.base) };
  }
  if (!answers.length) return { status: 'unverified', needsReview: false, history, notes, bases: [] };
  const uyOk = clean.some((a) => a.coversUruguay);
  if (!uyOk) notes.push('Cobertura Uruguay no confirmada: consultá con la operadora.');
  if (failed.length) notes.push(`${failed.length === 1 ? 'Una fuente no respondió' : `${failed.length} fuentes no respondieron`}.`);
  const status: ImeiStatus = uyOk && !failed.length ? 'clean' : 'partial';
  return { status, needsReview: false, history, notes, bases: answers.map((a) => a.base) };
}

/** Resumen del equipo: conserva la alerta más importante entre sus IMEI. */
export function summarizeDevice(perImei: ImeiSummary[], expectsTwo: boolean): { status: ImeiStatus; needsReview: boolean; notes: string[] } {
  const notes: string[] = [];
  if (!perImei.length) return { status: 'unverified', needsReview: false, notes };
  if (perImei.some((s) => s.status === 'reported')) {
    return { status: 'reported', needsReview: perImei.some((s) => s.needsReview) || perImei.some((s) => s.status !== 'reported'), notes };
  }
  if (perImei.length === 1) notes.push(expectsTwo ? 'Falta verificar el IMEI 2: revisión parcial.' : '1 IMEI consultado.');
  if (perImei.every((s) => s.status === 'unverified')) return { status: 'unverified', needsReview: false, notes };
  if (perImei.every((s) => s.status === 'clean') && !(expectsTwo && perImei.length < 2)) return { status: 'clean', needsReview: false, notes };
  return { status: 'partial', needsReview: false, notes };
}
