// Diagnóstico de iPhone: catálogo de pruebas, estados y veredicto (igual en Windows, en Safari y en el servidor).

export type TestStatus = 'ok' | 'observations' | 'fail' | 'unverified' | 'na';
export type TestOrigin = 'usb' | 'safari' | 'manual';
export type TestGroup = 'device' | 'safari' | 'guided' | 'checklist';

export const STATUS_LABEL: Record<TestStatus, string> = {
  ok: 'OK', observations: 'Con observaciones', fail: 'Falla', unverified: 'No verificado', na: 'No aplica',
};
export const ORIGIN_LABEL: Record<TestOrigin, string> = { usb: 'USB', safari: 'Safari', manual: 'Manual' };
export const GROUP_LABEL: Record<TestGroup, string> = {
  device: 'Equipo, batería y bloqueos', safari: 'Pruebas en Safari', guided: 'Controles guiados', checklist: 'Checklist manual',
};

export interface TestDef {
  key: string; label: string; group: TestGroup;
  /** Se puede hacer desde la página de Safari. */
  phone: boolean;
  /** Puede no existir según el modelo («No aplica»). */
  naAllowed?: boolean;
  /** Prueba de percepción: requiere confirmación humana (imagen o sonido). */
  perception?: boolean;
  /** Indicaciones para hacerla o completarla a mano. */
  how: string;
}

export const TESTS: TestDef[] = [
  // Pruebas en Safari
  { key: 'screen', label: 'Pantalla (colores)', group: 'safari', phone: true, perception: true,
    how: 'Mostrá blanco, negro, rojo, verde y azul a pantalla completa y buscá manchas, líneas, píxeles muertos o tinte. Revisá también los bordes y la zona de la Dynamic Island o el notch, que Safari no cubre.' },
  { key: 'touch', label: 'Pantalla táctil', group: 'safari', phone: true, perception: true,
    how: 'Recorré con el dedo todas las celdas de la cuadrícula. Las zonas que Safari no deja cubrir (bordes y barra superior) se revisan a mano.' },
  { key: 'camera_back', label: 'Cámara trasera', group: 'safari', phone: true, perception: true,
    how: 'Vista previa de la cámara trasera: confirmá imagen y enfoque. Si no se puede elegir cada lente, probalas en la app Cámara.' },
  { key: 'camera_front', label: 'Cámara frontal', group: 'safari', phone: true, perception: true,
    how: 'Vista previa de la cámara frontal: confirmá imagen y enfoque.' },
  { key: 'microphone', label: 'Micrófono', group: 'safari', phone: true, perception: true,
    how: 'Grabación breve que se reproduce solo en el iPhone (no se envía). Confirmá que se escucha clara.' },
  { key: 'speaker', label: 'Altavoz (tono)', group: 'safari', phone: true, perception: true,
    how: 'Reproducí el tono y confirmá que se escucha sin distorsión.' },
  { key: 'motion', label: 'Sensores de movimiento', group: 'safari', phone: true,
    how: 'Tocá el botón de la prueba, permití el acceso al movimiento y mové el equipo: se comprueba que el navegador recibe datos del acelerómetro y el giroscopio.' },
  // Controles guiados (Safari no los puede aislar)
  { key: 'earpiece', label: 'Auricular (parlante de llamadas)', group: 'guided', phone: true, perception: true,
    how: 'Hacé una llamada (por ejemplo al buzón) con el equipo en la oreja y confirmá que se escucha por el auricular superior.' },
  { key: 'mics_specific', label: 'Micrófonos (inferior, frontal y trasero)', group: 'guided', phone: true, perception: true,
    how: 'Grabá una nota de voz (micrófono inferior), un video con la cámara frontal y otro con la trasera; reproducí cada uno y confirmá el audio.' },
  { key: 'lenses', label: 'Lentes adicionales', group: 'guided', phone: true, naAllowed: true, perception: true,
    how: 'En la app Cámara, cambiá a 0,5× (ultra gran angular), al teleobjetivo y al modo macro si el modelo los tiene; confirmá imagen y enfoque en cada uno.' },
  { key: 'flash', label: 'Flash y linterna', group: 'guided', phone: true, perception: true,
    how: 'Encendé la linterna desde el Centro de control y sacá una foto con flash.' },
  // Checklist manual
  { key: 'biometrics', label: 'Face ID / Touch ID', group: 'checklist', phone: true, naAllowed: true,
    how: 'Pedí al cliente que desbloquee el equipo con su Face ID o Touch ID ya configurado. No se registra ni se cambia la configuración biométrica.' },
  { key: 'proximity', label: 'Sensor de proximidad', group: 'checklist', phone: true,
    how: 'Durante una llamada, tapá la parte superior: la pantalla debe apagarse y volver al destapar.' },
  { key: 'buttons', label: 'Botones', group: 'checklist', phone: true,
    how: 'Probá volumen +, volumen −, botón lateral y el interruptor de silencio o el botón de Acción, según el modelo.' },
  { key: 'vibration', label: 'Vibración', group: 'checklist', phone: true,
    how: 'Cambiá el modo silencio o recibí una notificación y confirmá que vibra.' },
  { key: 'charging', label: 'Carga', group: 'checklist', phone: true,
    how: 'Conectá el cargador (y MagSafe o inalámbrica si corresponde) y confirmá que indica «Cargando».' },
  { key: 'wifi', label: 'Wi‑Fi', group: 'checklist', phone: true,
    how: 'Conectate a una red Wi‑Fi y abrí una página.' },
  { key: 'bluetooth', label: 'Bluetooth', group: 'checklist', phone: true,
    how: 'Activá Bluetooth y comprobá que encuentra dispositivos cercanos.' },
  { key: 'cellular', label: 'Red móvil', group: 'checklist', phone: true,
    how: 'Con un chip o eSIM: comprobá señal, llamada y datos móviles.' },
  // Equipo, batería y bloqueos (desde Windows)
  { key: 'battery_health', label: 'Salud de la batería', group: 'device', phone: false,
    how: 'En el iPhone: Configuración → Batería → Estado y carga de la batería. Copiá la capacidad máxima, los ciclos (si aparecen) y el mensaje tal como los muestra iOS.' },
  { key: 'parts_history', label: 'Historial de piezas y servicio', group: 'device', phone: false,
    how: 'Configuración → General → Información → Historial de piezas y servicio (si aparece). Copiá el texto tal como lo muestra iOS: «Pieza original de Apple», «Pieza desconocida», etc. Si la sección no aparece, anotalo: no certifica que el equipo nunca fue reparado.' },
  { key: 'activation_lock', label: 'Bloqueo de activación', group: 'device', phone: false,
    how: 'Se verifica aparte: con el cliente, comprobá que «Buscar mi iPhone» esté desactivado o que el equipo se pueda borrar y configurar sin pedir el Apple ID anterior. Sin evidencia válida queda «No verificado».' },
  { key: 'imei_blacklist', label: 'Lista negra de IMEI', group: 'device', phone: false,
    how: 'La app no tiene verificador de IMEI. Si se consultó en una fuente confiable, registrá la fuente y el resultado; si no, queda «No verificado».' },
  { key: 'carrier_lock', label: 'Bloqueo de operador', group: 'device', phone: false,
    how: 'Configuración → General → Información → «Bloqueo del operador»: debe decir «Sin restricciones de SIM».' },
];

export const TEST_BY_KEY = new Map(TESTS.map((t) => [t.key, t]));
export const PHONE_TESTS = TESTS.filter((t) => t.phone).map((t) => t.key);

export interface TestResult { test: string; status: TestStatus; origin: TestOrigin; detail: string; data?: Record<string, unknown> | null; createdAt: string; by?: string | null }

/** Valida un resultado. «Falla» exige describir la falla observada. */
export function checkResult(r: { test?: unknown; status?: unknown; origin?: unknown; detail?: unknown }): string | null {
  const t = TEST_BY_KEY.get(String(r.test));
  if (!t) return 'Prueba desconocida';
  if (!(String(r.status) in STATUS_LABEL)) return 'Estado inválido';
  if (!(String(r.origin) in ORIGIN_LABEL)) return 'Origen inválido';
  if (r.status === 'na' && !t.naAllowed) return `«No aplica» no corresponde a ${t.label}`;
  const detail = typeof r.detail === 'string' ? r.detail.trim() : '';
  if (r.status === 'fail' && detail.length < 3) return 'Una «Falla» exige describir la falla observada.';
  if (r.status === 'observations' && detail.length < 3) return 'Describí la observación.';
  if (detail.length > 600) return 'El detalle es demasiado largo';
  return null;
}

export type Verdict = { key: 'fail' | 'incomplete' | 'observations' | 'pass'; label: string; missing: string[] };

/** Veredicto del diagnóstico: nunca hay aprobación global si faltan pruebas. */
export function verdict(current: Record<string, TestResult | undefined>): Verdict {
  const missing = TESTS.filter((t) => { const r = current[t.key]; return !r || r.status === 'unverified'; }).map((t) => t.label);
  const fails = TESTS.filter((t) => current[t.key]?.status === 'fail');
  if (fails.length) return { key: 'fail', label: `Con fallas: ${fails.map((t) => t.label).join(', ')}`, missing };
  if (missing.length) return { key: 'incomplete', label: `Incompleto: ${missing.length} ${missing.length === 1 ? 'prueba sin verificar' : 'pruebas sin verificar'}`, missing };
  if (TESTS.some((t) => current[t.key]?.status === 'observations')) return { key: 'observations', label: 'Aprobado con observaciones', missing };
  return { key: 'pass', label: 'Sin fallas en las pruebas realizadas', missing };
}

/** Serie o IMEI enmascarado por defecto: «F2•••••••XYZ». */
export function maskId(v: string | null | undefined): string {
  if (!v) return '—';
  const s = String(v);
  return s.length <= 5 ? '•'.repeat(s.length) : `${s.slice(0, 2)}${'•'.repeat(Math.max(3, s.length - 6))}${s.slice(-4)}`;
}

export interface DeviceInfo {
  model?: string | null; productType?: string | null; modelNumber?: string | null; ios?: string | null; build?: string | null;
  capacityGb?: number | null; serial?: string | null; imei1?: string | null; imei2?: string | null;
  /** iosMaxPct: la «Capacidad máxima» que calcula iOS, cuando el registro de energía la trae; estimatedMaxPct: cálculo propio. */
  battery?: { chargePct?: number | null; charging?: boolean | null; cycles?: number | null; estimatedMaxPct?: number | null; iosMaxPct?: number | null; settingsMaxPct?: number | null } | null;
  /** «Buscar mi iPhone» activado (implica Bloqueo de activación), leído por USB. */
  findMy?: boolean | null;
  /** Origen de cada campo: «usb» si lo leyó la conexión autorizada, «manual» si lo cargó el técnico. */
  sources?: Record<string, 'usb' | 'manual'>;
}

/** Nombre comercial a partir del identificador del modelo (ProductType). Desconocido → null (se muestra el identificador). */
export const IPHONE_MODELS: Record<string, string> = {
  'iPhone8,1': 'iPhone 6s', 'iPhone8,2': 'iPhone 6s Plus', 'iPhone8,4': 'iPhone SE (1.ª gen.)',
  'iPhone9,1': 'iPhone 7', 'iPhone9,3': 'iPhone 7', 'iPhone9,2': 'iPhone 7 Plus', 'iPhone9,4': 'iPhone 7 Plus',
  'iPhone10,1': 'iPhone 8', 'iPhone10,4': 'iPhone 8', 'iPhone10,2': 'iPhone 8 Plus', 'iPhone10,5': 'iPhone 8 Plus', 'iPhone10,3': 'iPhone X', 'iPhone10,6': 'iPhone X',
  'iPhone11,2': 'iPhone XS', 'iPhone11,4': 'iPhone XS Max', 'iPhone11,6': 'iPhone XS Max', 'iPhone11,8': 'iPhone XR',
  'iPhone12,1': 'iPhone 11', 'iPhone12,3': 'iPhone 11 Pro', 'iPhone12,5': 'iPhone 11 Pro Max', 'iPhone12,8': 'iPhone SE (2.ª gen.)',
  'iPhone13,1': 'iPhone 12 mini', 'iPhone13,2': 'iPhone 12', 'iPhone13,3': 'iPhone 12 Pro', 'iPhone13,4': 'iPhone 12 Pro Max',
  'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13', 'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max', 'iPhone14,6': 'iPhone SE (3.ª gen.)',
  'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus', 'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max',
  'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus', 'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max',
  'iPhone17,3': 'iPhone 16', 'iPhone17,4': 'iPhone 16 Plus', 'iPhone17,1': 'iPhone 16 Pro', 'iPhone17,2': 'iPhone 16 Pro Max', 'iPhone17,5': 'iPhone 16e',
};
export const modelName = (productType?: string | null) => (productType ? IPHONE_MODELS[productType] ?? null : null);

/** Capacidad comercial a partir de los bytes totales del disco. */
export function capacityGb(totalBytes: number): number | null {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  const gb = totalBytes / 1e9;
  const sizes = [16, 32, 64, 128, 256, 512, 1024, 2048];
  return sizes.reduce((best, s) => (Math.abs(Math.log(s / gb)) < Math.abs(Math.log(best / gb)) ? s : best), sizes[0]);
}
