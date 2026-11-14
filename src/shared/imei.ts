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
  | 'tac_only'       // solo identificó marca o modelo por TAC: NO es un chequeo de lista negra
  | 'not_configured' // proveedor sin configurar
  | 'manual_pending' // consulta manual todavía no registrada por el operador
  | 'timeout' | 'error' | 'unexpected' | 'pending';

export interface SourceResult {
  provider: string; providerName: string; base: string; coverage: string; coversUruguay: boolean;
  status: SourceStatus; reason: string | null; reportDate: string | null; checkedAt: string;
  message: string | null; model: { brand: string; model: string } | null; retryCharges: boolean;
  /** Fuente con base original o cobertura no confirmadas: un positivo pide revisión, un negativo no alcanza. */
  complementary?: boolean;
  /** Resultado cargado por el operador después de consultar el sitio del proveedor. */
  manual?: boolean;
  /** La fuente advierte que su cobertura del IMEI 2 es limitada (o solo admite el IMEI 1). */
  imei2Limited?: boolean;
}

export type ImeiStatus = 'reported' | 'clean' | 'partial' | 'unverified';
export const IMEI_STATUS_LABEL: Record<ImeiStatus, string> = {
  reported: 'Reporte activo',
  clean: 'Sin reporte en las fuentes consultadas',
  partial: 'Verificación parcial',
  unverified: 'No se pudo verificar',
};
export const COMPLEMENTARY_LABEL = 'Fuente complementaria · cobertura no confirmada';
export const MANUAL_LABEL = 'Consulta manual';
export const TAC_LABEL = 'Solo modelo por TAC · no es chequeo de lista negra';

export interface ImeiSummary {
  status: ImeiStatus; needsReview: boolean; history: boolean; notes: string[];
  /** Bases distintas con respuesta útil (dos servicios sobre la misma base cuentan una vez). */
  bases: string[];
}

const ANSWERED: SourceStatus[] = ['reported', 'clean', 'history'];
const NOT_A_FAILURE: SourceStatus[] = [...ANSWERED, 'not_configured', 'manual_pending', 'pending', 'tac_only'];

/**
 * Resumen de un IMEI a partir de las respuestas de cada fuente.
 * - Solo cuentan respuestas explícitas de lista negra; una identificación por TAC, un error, un timeout o una respuesta
 *   inesperada nunca son un negativo.
 * - Dos servicios sobre la misma base cuentan una vez (vale la respuesta más grave).
 * - «Reporte activo» exige una fuente de cobertura conocida; un posible reporte en una fuente complementaria pide revisión.
 * - «Sin reporte» exige negativos explícitos de fuentes de cobertura conocida, una de ellas con Uruguay confirmado, y que
 *   ninguna fuente haya fallado. Para el IMEI 2, una fuente con cobertura limitada del IMEI 2 se toma como complementaria.
 */
export function summarizeImei(results: SourceResult[], opts: { imei2?: boolean } = {}): ImeiSummary {
  const notes: string[] = [];
  const weak = (r: SourceResult) => !!r.complementary || (!!opts.imei2 && !!r.imei2Limited);
  const byBase = new Map<string, SourceResult>();
  const rank = (s: SourceStatus) => (s === 'reported' ? 3 : s === 'history' ? 2 : s === 'clean' ? 1 : 0);
  for (const r of results.filter((x) => ANSWERED.includes(x.status))) {
    const key = weak(r) ? `~${r.provider}` : r.base; // las complementarias no se agrupan con bases conocidas
    const cur = byBase.get(key);
    if (!cur || rank(r.status) > rank(cur.status)) byBase.set(key, r);
  }
  const answers = [...byBase.values()];
  const strong = answers.filter((a) => !weak(a));
  const comp = answers.filter(weak);
  const reportedStrong = strong.some((a) => a.status === 'reported');
  const reportedComp = comp.some((a) => a.status === 'reported');
  const negatives = answers.filter((a) => a.status === 'clean' || a.status === 'history');
  const history = answers.some((a) => a.status === 'history');
  const failed = results.filter((r) => !NOT_A_FAILURE.includes(r.status));
  const tacOnly = results.some((r) => r.status === 'tac_only');
  const bases = answers.map((a) => (weak(a) ? a.providerName : a.base));
  if (history) notes.push('Figura un reporte anterior retirado (antecedente).');
  if (opts.imei2 && results.some((r) => r.imei2Limited && ANSWERED.includes(r.status)))
    notes.push('Una fuente advierte cobertura limitada del IMEI 2: su respuesta se toma como complementaria.');
  if (reportedStrong) {
    const needsReview = negatives.length > 0 || reportedComp;
    if (negatives.length) notes.push('Las fuentes no coinciden: requiere revisión antes de comprar o tomar en parte de pago.');
    return { status: 'reported', needsReview, history, notes, bases };
  }
  if (reportedComp) {
    notes.push('Posible reporte en una fuente complementaria: requiere revisión y confirmación en una fuente de cobertura conocida.');
    return { status: 'partial', needsReview: true, history, notes, bases };
  }
  if (tacOnly && !answers.length) notes.push('Una fuente solo identificó el modelo por TAC: no es un chequeo de lista negra.');
  if (failed.length) notes.push(`${failed.length === 1 ? 'Una fuente no respondió' : `${failed.length} fuentes no respondieron`}.`);
  if (!answers.length) return { status: 'unverified', needsReview: false, history, notes, bases: [] };
  if (!strong.length) notes.push('Solo hay respuestas de fuentes complementarias: un negativo de esas fuentes no confirma la ausencia de reporte.');
  const uyOk = strong.some((a) => (a.status === 'clean' || a.status === 'history') && a.coversUruguay);
  if (strong.length && !uyOk) notes.push('Cobertura Uruguay no confirmada: consultá con la operadora.');
  const status: ImeiStatus = uyOk && !failed.length ? 'clean' : 'partial';
  return { status, needsReview: false, history, notes, bases };
}

/** Resumen del equipo: conserva la alerta más importante entre sus IMEI. */
export function summarizeDevice(perImei: ImeiSummary[], expectsTwo: boolean): { status: ImeiStatus; needsReview: boolean; notes: string[] } {
  const notes: string[] = [];
  if (!perImei.length) return { status: 'unverified', needsReview: false, notes };
  if (perImei.some((s) => s.status === 'reported')) {
    return { status: 'reported', needsReview: perImei.some((s) => s.needsReview) || perImei.some((s) => s.status !== 'reported'), notes };
  }
  const needsReview = perImei.some((s) => s.needsReview);
  if (needsReview) notes.push('Posible reporte en una fuente complementaria: confirmalo antes de comprar o tomar en parte de pago.');
  if (perImei.length === 1) notes.push(expectsTwo ? 'Falta verificar el IMEI 2: revisión parcial.' : '1 IMEI consultado.');
  if (needsReview) return { status: 'partial', needsReview, notes };
  if (perImei.every((s) => s.status === 'unverified')) return { status: 'unverified', needsReview: false, notes };
  if (perImei.every((s) => s.status === 'clean') && !(expectsTwo && perImei.length < 2)) return { status: 'clean', needsReview: false, notes };
  return { status: 'partial', needsReview: false, notes };
}
