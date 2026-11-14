// IMEI Check (servidor): consulta las fuentes de lista negativa habilitadas por HTTPS, con tiempo máximo por proveedor,
// sin duplicar consultas idénticas en curso y sin guardar ni registrar el IMEI completo.
//
// Fuentes (PROVIDERS):
// - GSMA Device Check: prioridad internacional. Sin documentación de integración de la cuenta → «Proveedor sin configurar»
//   (no se inventa un endpoint a partir del portal).
// - Phonecheck: API documentada públicamente sobre la lista de GSMA (misma base: cuenta una vez). Adaptador real; se activa
//   al pegar la clave de API de la cuenta (guardada cifrada como la clave de GitHub). Uruguay solo se toma como cubierto si
//   el administrador marca que Phonecheck lo confirmó por escrito.
// - CheckMEND e IMEICheck.com: ofrecen API comercial, pero no publican base original, cobertura ni el servicio exacto →
//   «Fuente complementaria · cobertura no confirmada» y sin consulta automática hasta tener la documentación.
// - IMEIpro.info e IMEICheck.com (web): consulta manual en su sitio; el operador registra el resultado en la app.
// - Antel, Claro y Tigo: solo atención manual → «Consultar con la operadora» y «Cobertura Uruguay no confirmada».
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Db } from './db.ts';
import type { Secret } from './repoSync.ts';
import { validateImei, maskImei, type SourceResult, type SourceStatus } from '../shared/imei.ts';
import { ValidationError } from '../shared/types.ts';

export interface ProviderInfo {
  id: string; name: string; base: string; coverage: string; coversUruguay: boolean; configured: boolean;
  /** Se consulta automáticamente (una por base; otra base distinta suma cobertura). */
  auto: boolean; retryCharges: boolean; complementary: boolean;
  /** Consulta manual en el sitio del proveedor (sin el IMEI en la URL). */
  manualUrl?: string; manualLabel?: string;
  /** Advertencia del proveedor sobre el IMEI 2, si la publica. */
  imei2Limited?: boolean;
  reportTypes: string; update: string; terms: string; docs: string; howTo: string; status: string;
  /** Configurable desde la app (credencial cifrada en esta PC). */
  configurable?: boolean; uyNote?: string;
}

type QueryResult = Pick<SourceResult, 'status' | 'reason' | 'reportDate' | 'model' | 'message'>;
export interface Adapter { info: ProviderInfo; query(imei: string, signal: AbortSignal): Promise<QueryResult> }

const NOT_CONFIGURED_MSG = 'Proveedor sin configurar: falta el acceso comercial y la documentación de integración de la cuenta.';

const GSMA: ProviderInfo = {
  id: 'gsma', name: 'GSMA Device Check', base: 'GSMA Device Registry', coverage: 'Internacional: operadores que reportan a GSMA',
  coversUruguay: false, configured: false, auto: true, retryCharges: true, complementary: false,
  reportTypes: 'Robo, extravío, fraude y otros bloqueos informados por operadores (según contrato).',
  update: 'Según el plan contratado (a confirmar con GSMA).',
  terms: 'Uso comercial bajo contrato con GSMA; cada consulta puede tener costo. Términos: devicecheck.gsma.com/rtlapp/termsOfUse',
  docs: 'https://devicecheck.gsma.com/rtlapp/index?locale=es',
  howTo: 'Contratar el acceso comercial de GSMA Device Check y pedir la documentación de integración (API) de la cuenta, los permisos y la confirmación escrita de qué operadores de Uruguay reportan a la base. Con esa documentación se integra el adaptador y la credencial se guarda cifrada en la PC.',
  status: 'Proveedor sin configurar',
};
const PHONECHECK: ProviderInfo = {
  id: 'phonecheck', name: 'Phonecheck', base: 'GSMA Device Registry', coverage: 'La de la lista de GSMA que consulta',
  coversUruguay: false, configured: false, auto: true, retryCharges: true, complementary: false, configurable: true,
  reportTypes: 'Lista de bloqueo de GSMA: robo o extravío vigente e historial de altas y bajas (motivo, fecha, operador, país).',
  update: 'La de GSMA; la respuesta indica si vino de caché.',
  terms: 'API comercial de Phonecheck (cuenta Cloud Dash, clave de API). Cada consulta consume licencias de la cuenta.',
  docs: 'https://phonecheck.atlassian.net/wiki/spaces/KB/pages/2257911835/IMEI%2BService%2B-%2BGET%2BGSMA%2BBlacklist%2Bfor%2BLost%2Bor%2BStolen%2BStatus',
  howTo: 'Abrir una cuenta comercial de Phonecheck, crear una clave de API en Cloud Dash → Integraciones y pegarla acá (solo el administrador). Pedir por escrito qué operadores de Uruguay reportan a la lista de GSMA y marcarlo al configurar. Es alternativa a GSMA directo: misma base, se consulta una sola.',
  status: 'Proveedor sin configurar',
};
const CHECKMEND: ProviderInfo = {
  id: 'checkmend', name: 'CheckMEND', base: 'No informada (ecosistema propio de datos de equipos usados)', coverage: 'Según el plan (países y registros a confirmar)',
  coversUruguay: false, configured: false, auto: true, retryCharges: true, complementary: true,
  reportTypes: 'Equipos reportados (registros incluidos según el plan); alertas de cambio de estado opcionales.',
  update: 'No publicada.',
  terms: 'Cuenta corporativa con API; precio según volumen, cobertura geográfica y agregados.',
  docs: 'https://www.checkmend.com/us/corporate-accounts',
  howTo: 'Pedir cuenta corporativa y que confirme por escrito qué registros y países cubre el plan (incluido Uruguay), la documentación de la API, el permiso de uso automático y los costos. Hasta entonces es fuente complementaria.',
  status: 'Proveedor sin configurar',
};
const IMEICHECK: ProviderInfo = {
  id: 'imeicheck', name: 'IMEICheck.com', base: 'No informada', coverage: 'No informada (las muestras citan operadores de otros países)',
  coversUruguay: false, configured: false, auto: false, retryCharges: true, complementary: true,
  manualUrl: 'https://imeicheck.com/es/checar-lista-negra', manualLabel: 'Abrir IMEICheck.com',
  reportTypes: '«Blacklist PRO Check»: estado de lista negra, operador que reportó, fecha y país. El verificador general (marca y modelo por TAC) no es chequeo de lista negra.',
  update: 'No publicada.',
  terms: 'Servicios pagos por consulta (Blacklist PRO Check figura a USD 0,06). Publica API para DHRU Fusion y PHP JSON, sin documentación ni términos de uso automático públicos.',
  docs: 'https://imeicheck.com/',
  howTo: 'Para automatizar: pedir al proveedor la documentación de la API, el ID exacto del servicio de lista negra, que devuelva el estado de reporte, la base de origen y su cobertura, y el permiso de uso comercial. Mientras tanto se consulta a mano en el verificador de lista negra.',
  status: 'Consulta manual · automática sin configurar',
};
const IMEIPRO: ProviderInfo = {
  id: 'imeipro', name: 'IMEIpro.info', base: 'No informada', coverage: 'No informada',
  coversUruguay: false, configured: false, auto: false, retryCharges: false, complementary: true,
  manualUrl: 'https://www.imeipro.info/', manualLabel: 'Abrir IMEIpro',
  reportTypes: 'Lo que informe el formulario público.', update: 'No publicada.',
  terms: 'Formulario público con CAPTCHA: sin autorización de automatización.',
  docs: 'https://www.imeipro.info/',
  howTo: 'Se consulta a mano en el sitio y se registra el resultado. La consulta automática solo se habilita si el proveedor confirma una API o un canal de integración autorizado para el local.',
  status: 'Consulta manual',
};

/** Atención de las operadoras de Uruguay (solo manual). */
export const UY_OPERATORS = [
  { name: 'Antel', url: 'https://antel.com.uy/personas/servicios/movil/otros-servicios/denuncia-por-hurto-o-extravio-de-celulares' },
  { name: 'Claro', url: 'https://asistencia.claro.com.uy/asistencia/celulares-y-accesorios/soporte/que-hago-si-me-robaron-o-perdi-mi-celular' },
  { name: 'Tigo', url: 'https://ayuda.tigo.com.uy/hc/centro-de-ayuda/articles/49177628171411-como-denunciar-el-robo-o-extravio-de-mi-equipo' },
];
export const APPLE_USED_IPHONE = 'https://support.apple.com/en-mide/104999';

function notConfigured(info: ProviderInfo): Adapter {
  return { info, query: async () => ({ status: 'not_configured', reason: null, reportDate: null, model: null, message: NOT_CONFIGURED_MSG }) };
}

/* ---------- Phonecheck (API documentada) ---------- */

type Fetch = typeof fetch;
const PC_API = 'https://api.phonecheck.com';

/** Interpreta la respuesta de GET /v2/imei/blacklist/<IMEI>. Todo lo que no sea el formato documentado es «unexpected». */
export function parsePhonecheck(j: any): QueryResult {
  const unexpected: QueryResult = { status: 'unexpected', reason: null, reportDate: null, model: null, message: 'Respuesta con formato inesperado' };
  const d = j?.data;
  if (!d || typeof d !== 'object' || d.responseStatus !== 'success') return unexpected;
  const hist: any[] = Array.isArray(d.imeiHistory) ? d.imeiHistory : [];
  const blocks = hist.filter((h) => /block insert/i.test(String(h?.action ?? ''))).sort((a, b) => String(b?.date ?? '').localeCompare(String(a?.date ?? '')));
  const last = blocks[0];
  const claims = hist.filter((h) => /general insert/i.test(String(h?.action ?? ''))).map((h) => String(h?.reasoncodedesc ?? '').slice(0, 40)).filter(Boolean);
  const model = d.make && d.make !== 'NA' && d.model ? { brand: String(d.make).slice(0, 40), model: String(d.model).slice(0, 60) } : null;
  const reason = last ? [last.reasoncodedesc, last.by, last.country ?? last.Country].filter(Boolean).map(String).join(' · ').slice(0, 140) : null;
  const extra = [claims.length ? `Registro general: ${claims.join(', ')}` : '', j?.fromCache ? 'Respuesta desde caché del proveedor' : ''].filter(Boolean).join(' · ') || null;
  if (d.blacklistStatus === 'Reported lost or stolen') return { status: 'reported', reason: reason ?? 'Robo o extravío', reportDate: last?.date ? String(last.date).slice(0, 30) : null, model, message: extra };
  if (d.blacklistStatus === 'Not reported lost or stolen') {
    if (last) return { status: 'history', reason, reportDate: String(last.date ?? '').slice(0, 30) || null, model, message: extra };
    return { status: 'clean', reason: null, reportDate: null, model, message: extra };
  }
  return unexpected;
}

export function phonecheckAdapter(info: ProviderInfo, apiToken: string, fetchImpl: Fetch = fetch): Adapter {
  let jwt: { token: string; header: string; until: number } | null = null;
  async function login(signal: AbortSignal) {
    const r = await fetchImpl(`${PC_API}/v2/auth/api-token/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiToken }), signal });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || typeof j?.token !== 'string') throw new Error(r.status === 401 ? 'clave de API rechazada' : `inicio de sesión ${r.status}`);
    const header = ['token_master', 'token_user'].includes(j?.usage?.header) ? j.usage.header : 'token_master';
    jwt = { token: j.token, header, until: Date.now() + (Number(j.expiresIn) || 86_400) * 1000 - 300_000 };
    return jwt;
  }
  return {
    info,
    async query(imei, signal) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const auth = jwt && jwt.until > Date.now() ? jwt : await login(signal);
        // El IMEI va en la ruta (así lo exige la API): la URL nunca se registra ni se muestra.
        const r = await fetchImpl(`${PC_API}/v2/imei/blacklist/${imei}`, { headers: { [auth.header]: auth.token }, signal });
        const j: any = await r.json().catch(() => null);
        if (r.ok) return parsePhonecheck(j);
        const msg = String(j?.msg ?? j?.err ?? '');
        if ((r.status === 401 || /validate token/i.test(msg)) && attempt === 0) { jwt = null; continue; }
        if (r.status === 404) return { status: 'error', reason: null, reportDate: null, model: null, message: 'La fuente no tiene información de este IMEI (no es un negativo)' };
        if (r.status === 403) return { status: 'error', reason: null, reportDate: null, model: null, message: 'La cuenta no tiene consultas disponibles (licencias agotadas)' };
        if (r.status === 400 && /manufacturer/i.test(msg)) return { status: 'error', reason: null, reportDate: null, model: null, message: 'El servicio no admite este IMEI' };
        throw new Error(`HTTP ${r.status}`);
      }
      throw new Error('sesión rechazada');
    },
  };
}

/* ---------- Configuración (credenciales cifradas en esta PC) ---------- */

const CONF_KEY = 'imeiProviders';
interface ProviderConf { token?: string; coversUruguay?: boolean; uyNote?: string; updatedAt?: string }
function readConf(db?: Db): Record<string, ProviderConf> {
  if (!db) return {};
  try { return JSON.parse((db.prepare('SELECT value FROM settings WHERE key = ?').get(CONF_KEY)?.value as string) ?? '{}'); } catch { return {}; }
}
function writeConf(db: Db, c: Record<string, ProviderConf>) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(CONF_KEY, JSON.stringify(c));
}

/* ---------- Simulación para pruebas ---------- */
/* CEL_IMEI_MOCK=<archivo.json> { "providers": [{ "id", "name", "base", "coversUruguay", "complementary", "imei2Limited", "delayMs",
   "responses": { "<imei>": {...} | "timeout" | "garbage" | "error" | "tac" } }] } */
function mockAdapters(): Adapter[] | null {
  const file = process.env.CEL_IMEI_MOCK;
  if (!file) return null;
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sims = (cfg.providers ?? []).map((p: any): Adapter => { const seen = new Set<string>(); return {
    info: { ...GSMA, id: p.id, name: p.name, base: p.base, coverage: p.coverage ?? 'Simulada (pruebas)', coversUruguay: !!p.coversUruguay,
      complementary: !!p.complementary, imei2Limited: !!p.imei2Limited, configured: true, auto: p.auto ?? true, retryCharges: !!p.retryCharges,
      status: 'Simulado (solo pruebas)', howTo: '', configurable: false },
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
  // Las fuentes manuales se mantienen igual en la simulación.
  return [...sims, notConfigured(IMEICHECK), notConfigured(IMEIPRO)];
}

/**
 * Respuesta normalizada (formato de las simulaciones). Formato inesperado → «unexpected», nunca un negativo.
 * Una respuesta que solo trae marca/modelo (identificación por TAC) → «tac_only»: no es un chequeo de lista negra.
 */
export function parseProviderJson(text: string): QueryResult {
  let j: any;
  try { j = JSON.parse(text); } catch { return { status: 'unexpected', reason: null, reportDate: null, model: null, message: 'Respuesta con formato inesperado' }; }
  const model = j?.brand && j?.model ? { brand: String(j.brand).slice(0, 40), model: String(j.model).slice(0, 60) } : null;
  const st = j?.status;
  if (!['reported', 'clean', 'history'].includes(st)) {
    if (st === undefined && model) return { status: 'tac_only', reason: null, reportDate: null, model, message: 'Solo identificó marca y modelo por TAC' };
    return { status: 'unexpected', reason: null, reportDate: null, model: null, message: 'Respuesta con formato inesperado' };
  }
  return { status: st as SourceStatus, reason: typeof j.reason === 'string' ? j.reason.slice(0, 120) : null,
    reportDate: typeof j.reportDate === 'string' ? j.reportDate.slice(0, 30) : null, model, message: null };
}

const TIMEOUT_MS = 15_000;
const PLAIN: Secret = { encrypt: (s) => s, decrypt: (s) => s };

export class ImeiChecker {
  private fixed: Adapter[] | null;
  private pc: { token: string; adapter: Adapter } | null = null;
  private inflight = new Map<string, Promise<SourceResult & { imei: string }>>();
  private db?: Db; private secret: Secret; private fetchImpl: Fetch; private timeoutMs: number;
  constructor(opts: { adapters?: Adapter[]; timeoutMs?: number; db?: Db; secret?: Secret; fetchImpl?: Fetch } = {}) {
    this.fixed = opts.adapters ?? mockAdapters();
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS; this.db = opts.db; this.secret = opts.secret ?? PLAIN; this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Adaptadores vigentes (la configuración puede cambiar desde la app). */
  private adapters(): Adapter[] {
    if (this.fixed) return this.fixed;
    const conf = readConf(this.db).phonecheck ?? {};
    let token: string | null = null;
    try { token = conf.token ? this.secret.decrypt(conf.token) : null; } catch { token = null; }
    let pc: Adapter;
    if (token) {
      const info: ProviderInfo = { ...PHONECHECK, configured: true, coversUruguay: !!conf.coversUruguay, uyNote: conf.uyNote,
        status: conf.coversUruguay ? 'Configurado · Uruguay confirmado por escrito' : 'Configurado · cobertura Uruguay no confirmada' };
      if (this.pc?.token !== token) this.pc = { token, adapter: phonecheckAdapter(info, token, this.fetchImpl) };
      this.pc.adapter.info = info;
      pc = this.pc.adapter;
    } else { this.pc = null; pc = notConfigured(PHONECHECK); }
    return [notConfigured(GSMA), pc, notConfigured(CHECKMEND), notConfigured(IMEICHECK), notConfigured(IMEIPRO)];
  }

  /** Fuentes y a cuáles se enviará el IMEI automáticamente (una por base). */
  providers() {
    const seen = new Set<string>();
    const list = this.adapters().map((a) => {
      const auto = a.info.configured && a.info.auto && !seen.has(a.info.base);
      if (auto) seen.add(a.info.base);
      return { ...a.info, auto };
    });
    return { providers: list, operators: UY_OPERATORS, apple: APPLE_USED_IPHONE, timeoutSeconds: this.timeoutMs / 1000 };
  }

  /** Guarda la configuración de un proveedor (solo administrador). La clave se guarda cifrada y nunca se devuelve. */
  configure(body: any) {
    if (!this.db) throw new ValidationError('Configuración no disponible');
    if (body?.provider !== 'phonecheck') throw new ValidationError('Este proveedor no se configura desde la app');
    const conf = readConf(this.db);
    const cur = conf.phonecheck ?? {};
    if (body.apiToken !== undefined) {
      const t = String(body.apiToken).trim();
      if (t && !/^[\w.\-~+/=]{16,600}$/.test(t)) throw new ValidationError('La clave de API no tiene un formato válido.');
      if (t) cur.token = this.secret.encrypt(t); else delete cur.token;
    }
    if (body.coversUruguay !== undefined) cur.coversUruguay = !!body.coversUruguay;
    if (body.uyNote !== undefined) cur.uyNote = String(body.uyNote).slice(0, 200);
    if (cur.coversUruguay && !cur.uyNote?.trim()) throw new ValidationError('Indicá quién confirmó por escrito la cobertura de Uruguay y cuándo.');
    cur.updatedAt = new Date().toISOString();
    conf.phonecheck = cur; writeConf(this.db, conf);
    return this.providers();
  }

  /** Consulta un IMEI en una fuente. Consultas idénticas en curso se comparten (doble clic). */
  check(body: any): Promise<SourceResult & { imei: string }> {
    const v = validateImei(body?.imei);
    if (!v.ok) throw new ValidationError(v.error);
    const a = this.adapters().find((x) => x.info.id === body?.provider);
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
      retryCharges: a.info.retryCharges, complementary: a.info.complementary, imei2Limited: !!a.info.imei2Limited, imei: maskImei(imei) };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const r = await a.query(imei, ctrl.signal);
      return { ...base, ...r, checkedAt: new Date().toISOString() };
    } catch (e) {
      const timeout = ctrl.signal.aborted;
      // Sin el IMEI ni la URL en el mensaje: solo el tipo de falla.
      const why = String((e as Error)?.message ?? '').replace(/https?:\/\/\S+/g, '').replace(/\d{8,}/g, '•••').trim().slice(0, 60) || 'sin detalle';
      return { ...base, status: timeout ? 'timeout' : 'error', reason: null, reportDate: null, model: null, checkedAt: new Date().toISOString(),
        message: timeout ? `Sin respuesta en ${this.timeoutMs / 1000} s` : `Error del proveedor (${why})` };
    } finally { clearTimeout(timer); }
  }
}
