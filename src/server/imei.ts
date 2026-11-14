// IMEI Check (servidor): consulta las fuentes de lista negativa habilitadas, con tiempo máximo por proveedor,
// sin duplicar consultas idénticas en curso y sin guardar ni registrar el IMEI completo.
//
// Fuentes previstas (ver PROVIDERS): GSMA Device Check y Phonecheck (API comercial sobre la base de GSMA).
// Ninguna tiene todavía acceso comercial ni documentación de integración de la cuenta, así que quedan
// «Proveedor sin configurar»: no se inventa un endpoint. Para Uruguay (Antel, Claro, Tigo) solo hay atención
// manual: la app muestra «Consultar con la operadora» y «Cobertura Uruguay no confirmada».
import crypto from 'node:crypto';
import fs from 'node:fs';
import { validateImei, maskImei, type SourceResult, type SourceStatus } from '../shared/imei.ts';
import { ValidationError } from '../shared/types.ts';

export interface ProviderInfo {
  id: string; name: string; base: string; coverage: string; coversUruguay: boolean; configured: boolean;
  /** Se consulta automáticamente (una por base; otra base distinta suma cobertura). */
  auto: boolean; retryCharges: boolean; reportTypes: string; update: string; terms: string; docs: string; howTo: string; status: string;
}

interface Adapter { info: ProviderInfo; query(imei: string, signal: AbortSignal): Promise<Omit<SourceResult, 'provider' | 'providerName' | 'base' | 'coverage' | 'coversUruguay' | 'checkedAt' | 'retryCharges'>> }

const GSMA: ProviderInfo = {
  id: 'gsma', name: 'GSMA Device Check', base: 'GSMA Device Registry', coverage: 'Internacional: operadores que reportan a GSMA',
  coversUruguay: false, configured: false, auto: true, retryCharges: true,
  reportTypes: 'Robo, extravío, fraude y otros bloqueos informados por operadores (según contrato).',
  update: 'Según el plan contratado (a confirmar con GSMA).',
  terms: 'Uso comercial bajo contrato con GSMA; cada consulta puede tener costo.',
  docs: 'https://devicecheck.gsma.com/rtlapp/index?locale=es',
  howTo: 'Contratar el acceso comercial de GSMA Device Check, pedir la documentación de integración (API) de la cuenta y confirmar por escrito la cobertura de operadores de Uruguay. Con esa documentación se integra el adaptador y la credencial se guarda cifrada en la PC, como la clave de GitHub.',
  status: 'Proveedor sin configurar',
};
const PHONECHECK: ProviderInfo = {
  id: 'phonecheck', name: 'Phonecheck', base: 'GSMA Device Registry', coverage: 'La de la base de GSMA que consulta',
  coversUruguay: false, configured: false, auto: false, retryCharges: true,
  reportTypes: 'Estado de robo o extravío en la lista de GSMA.',
  update: 'La de GSMA (a confirmar con Phonecheck).',
  terms: 'API comercial de Phonecheck; requiere cuenta y credenciales.',
  docs: 'https://phonecheck.atlassian.net/wiki/spaces/KB/pages/2257911835/IMEI%2BService%2B-%2BGET%2BGSMA%2BBlacklist%2Bfor%2BLost%2Bor%2BStolen%2BStatus',
  howTo: 'Alternativa a la conexión directa con GSMA (misma base: no se consultan las dos automáticamente). Requiere cuenta comercial y la documentación de la API de la cuenta para integrar el adaptador.',
  status: 'Proveedor sin configurar',
};

/** Atención de las operadoras de Uruguay (solo manual). */
export const UY_OPERATORS = [
  { name: 'Antel', url: 'https://antel.com.uy/personas/servicios/movil/otros-servicios/denuncia-por-hurto-o-extravio-de-celulares' },
  { name: 'Claro', url: 'https://asistencia.claro.com.uy/asistencia/celulares-y-accesorios/soporte/que-hago-si-me-robaron-o-perdi-mi-celular' },
  { name: 'Tigo', url: 'https://ayuda.tigo.com.uy/hc/centro-de-ayuda/articles/49177628171411-como-denunciar-el-robo-o-extravio-de-mi-equipo' },
];
export const APPLE_USED_IPHONE = 'https://support.apple.com/en-mide/104999';

function notConfigured(info: ProviderInfo): Adapter {
  return { info, query: async () => ({ status: 'not_configured', reason: null, reportDate: null, model: null,
    message: 'Proveedor sin configurar: falta el acceso comercial y la documentación de integración de la cuenta.' }) };
}

/* Pruebas: CEL_IMEI_MOCK=<archivo.json> { "providers": [{ "id", "name", "base", "coversUruguay", "delayMs", "responses": { "<imei>": {...} | "timeout" | "garbage" | "error" } }] } */
function mockAdapters(): Adapter[] | null {
  const file = process.env.CEL_IMEI_MOCK;
  if (!file) return null;
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (cfg.providers ?? []).map((p: any): Adapter => { const seen = new Set<string>(); return {
    info: { ...GSMA, id: p.id, name: p.name, base: p.base, coverage: p.coverage ?? 'Simulada (pruebas)', coversUruguay: !!p.coversUruguay,
      configured: true, auto: p.auto ?? true, retryCharges: !!p.retryCharges, status: 'Simulado (solo pruebas)' },
    query: (imei, signal) => new Promise((ok, ko) => {
      let r = p.responses?.[imei] ?? p.responses?.default;
      if (p.failFirst?.includes(imei) && !seen.has(imei)) { seen.add(imei); r = 'error'; }
      const t = setTimeout(() => {
        if (r === 'error') return ko(new Error('HTTP 503'));
        if (r === 'garbage' || r === undefined) return ok(parseProviderJson('<html>?</html>'));
        ok(parseProviderJson(JSON.stringify(r)));
      }, r === 'timeout' ? 60_000 : Number(p.delayMs) || 0);
      signal.addEventListener('abort', () => { clearTimeout(t); ko(new Error('timeout')); });
    }),
  }; });
}

/** Respuesta normalizada de un proveedor. Cualquier formato inesperado es «unexpected», nunca un negativo. */
export function parseProviderJson(text: string): Awaited<ReturnType<Adapter['query']>> {
  let j: any;
  try { j = JSON.parse(text); } catch { return { status: 'unexpected', reason: null, reportDate: null, model: null, message: 'Respuesta con formato inesperado' }; }
  const st = j?.status;
  if (!['reported', 'clean', 'history'].includes(st)) return { status: 'unexpected', reason: null, reportDate: null, model: null, message: 'Respuesta con formato inesperado' };
  return { status: st as SourceStatus, reason: typeof j.reason === 'string' ? j.reason.slice(0, 120) : null,
    reportDate: typeof j.reportDate === 'string' ? j.reportDate.slice(0, 30) : null,
    model: j.brand && j.model ? { brand: String(j.brand).slice(0, 40), model: String(j.model).slice(0, 60) } : null, message: null };
}

const TIMEOUT_MS = 15_000;

export class ImeiChecker {
  private adapters: Adapter[];
  private inflight = new Map<string, Promise<SourceResult & { imei: string }>>();
  constructor(adapters?: Adapter[], private timeoutMs = TIMEOUT_MS) {
    this.adapters = adapters ?? mockAdapters() ?? [notConfigured(GSMA), notConfigured(PHONECHECK)];
  }

  /** Fuentes y a cuáles se enviará el IMEI automáticamente (una por base). */
  providers() {
    const seen = new Set<string>();
    const list = this.adapters.map((a) => {
      const auto = a.info.configured && a.info.auto && !seen.has(a.info.base);
      if (auto) seen.add(a.info.base);
      return { ...a.info, auto };
    });
    return { providers: list, operators: UY_OPERATORS, apple: APPLE_USED_IPHONE, timeoutSeconds: this.timeoutMs / 1000 };
  }

  /** Consulta un IMEI en una fuente. Consultas idénticas en curso se comparten (doble clic). */
  check(body: any): Promise<SourceResult & { imei: string }> {
    const v = validateImei(body?.imei);
    if (!v.ok) throw new ValidationError(v.error);
    const a = this.adapters.find((x) => x.info.id === body?.provider);
    if (!a) throw new ValidationError('Fuente desconocida');
    const key = crypto.createHash('sha256').update(`${a.info.id}:${v.digits}`).digest('hex');
    const cur = this.inflight.get(key);
    if (cur) return cur;
    const p = this.run(a, v.digits).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async run(a: Adapter, imei: string): Promise<SourceResult & { imei: string }> {
    const base = { provider: a.info.id, providerName: a.info.name, base: a.info.base, coverage: a.info.coverage, coversUruguay: a.info.coversUruguay,
      retryCharges: a.info.retryCharges, imei: maskImei(imei) };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const r = await a.query(imei, ctrl.signal);
      return { ...base, ...r, checkedAt: new Date().toISOString() };
    } catch (e) {
      const timeout = ctrl.signal.aborted;
      // Sin el IMEI en el mensaje: solo el tipo de falla.
      return { ...base, status: timeout ? 'timeout' : 'error', reason: null, reportDate: null, model: null, checkedAt: new Date().toISOString(),
        message: timeout ? `Sin respuesta en ${this.timeoutMs / 1000} s` : `Error del proveedor (${String((e as Error).message).replace(/\d{14,}/g, '•••').slice(0, 60)})` };
    } finally { clearTimeout(timer); }
  }
}
