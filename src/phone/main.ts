// Página de pruebas que abre el iPhone en Safari al escanear el QR (sin instalar nada).
// - El token del QR viaja en el fragmento (#t=…) y se borra de la barra apenas se lee.
// - La credencial de la sesión queda en el almacenamiento local para reanudar si se corta Safari.
// - Las cámaras y el micrófono se piden al iniciar cada prueba y se apagan al salir; a la PC solo va el resultado.
// - Una API ausente o un permiso denegado se registra como «No verificado», con su alternativa manual.
type Status = 'ok' | 'observations' | 'fail' | 'unverified' | 'na';
interface PhoneTest { key: string; label: string; group: string; how: string; perception: boolean; naAllowed: boolean; status: Status | null; origin: string | null }
interface State { state: 'pending' | 'active' | 'closed' | 'revoked'; code: string | null; tests?: PhoneTest[]; requests?: string[] }

const STATUS_LABEL: Record<Status, string> = { ok: 'OK', observations: 'Con observaciones', fail: 'Falla', unverified: 'No verificado', na: 'No aplica' };
const GROUPS: Record<string, string> = { safari: 'Pruebas en Safari', guided: 'Controles guiados', checklist: 'Checklist manual' };
const KEY = 'cac-diag-session';
const QUEUE = 'cac-diag-queue';

const app = document.getElementById('app')!;
const overlay = document.getElementById('overlay')!;
let cred: string | null = null;
let last: State | null = null;
let busy = false; // hay una prueba abierta: no se redibuja la lista
let poll: number | undefined;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) (el as any)[k.toLowerCase()] = v; else if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c != null && c !== false) el.append(c);
  return el;
}
const render = (...nodes: Node[]) => { app.replaceChildren(h('div', { class: 'brand' }, 'Celulares al Costo · Diagnóstico'), ...nodes); };
const nonce = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '');
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

async function api(path: string, body?: unknown) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cred ? { 'X-Diag-Session': cred } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `Error ${r.status}`), { status: r.status });
  return j;
}

/* ---------- Envío de resultados con reintento (se conservan si se corta la conexión) ---------- */
interface Pending { test: string; status: Status; detail: string; data?: unknown; origin: 'safari' | 'manual'; nonce: string }
const queue = (): Pending[] => { try { return JSON.parse(store.get(QUEUE) ?? '[]'); } catch { return []; } };
async function flush() {
  for (const p of queue()) {
    try { await api('/p/api/result', p); store.set(QUEUE, JSON.stringify(queue().filter((x) => x.nonce !== p.nonce))); }
    catch (e: any) { if (e.status === 400) store.set(QUEUE, JSON.stringify(queue().filter((x) => x.nonce !== p.nonce))); else return; }
  }
}
async function submit(test: string, status: Status, detail: string, origin: 'safari' | 'manual', data?: unknown) {
  store.set(QUEUE, JSON.stringify([...queue(), { test, status, detail, origin, data, nonce: nonce() }]));
  stopMedia(); closeOverlay();
  await flush();
  if (wizard) return nextStep();
  busy = false; await refresh();
}

/* ---------- Recorrido automático ---------- */
// «Empezar» corre las pruebas una tras otra; cada una se responde con un toque. Después, el checklist en una pantalla.
let wizard: { queue: PhoneTest[]; i: number } | null = null;
let actx: AudioContext | null = null;
let motionPerm: 'granted' | 'denied' | 'none' | null = null;
const AUTO_ORDER = ['screen', 'touch', 'camera_back', 'camera_front', 'microphone', 'speaker', 'motion'];

async function startWizard(tests: PhoneTest[]) {
  busy = true;
  // Lo que Safari solo permite desde un toque se habilita acá: audio y permiso de movimiento.
  const AC: any = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  try { if (AC) { actx ??= new AC(); await actx!.resume(); } } catch { actx = null; }
  const DME: any = (window as any).DeviceMotionEvent;
  if (window.isSecureContext && DME && typeof DME.requestPermission === 'function' && motionPerm === null) {
    try { motionPerm = (await DME.requestPermission()) === 'granted' ? 'granted' : 'denied'; } catch { motionPerm = 'denied'; }
  } else if (motionPerm === null) motionPerm = window.isSecureContext && DME ? 'none' : 'denied';
  const req = new Set(last?.requests ?? []);
  const auto = tests.filter((t) => AUTO_ORDER.includes(t.key));
  let todo = auto.filter((t) => !t.status || req.has(t.key));
  if (!todo.length) todo = auto;
  todo.sort((a, b) => AUTO_ORDER.indexOf(a.key) - AUTO_ORDER.indexOf(b.key));
  wizard = { queue: todo, i: -1 };
  nextStep();
}

function nextStep() {
  if (!wizard) return;
  wizard.i++;
  if (wizard.i < wizard.queue.length) return openTest(wizard.queue[wizard.i]);
  wizard = null;
  checklistPage();
}

function stepHeader(t: PhoneTest): Node[] {
  if (!wizard) return [h('h1', {}, t.label)];
  return [h('p', { class: 'muted small' }, `Prueba ${wizard.i + 1} de ${wizard.queue.length}`), h('div', { class: 'bar' }, h('i', { style: `width:${(wizard.i / wizard.queue.length) * 100}%` })), h('h1', {}, t.label)];
}

/** Checklist rápido: todo en una pantalla, un toque por ítem. */
function checklistPage() {
  busy = true;
  const items = (last?.tests ?? []).filter((t) => !AUTO_ORDER.includes(t.key));
  const answers = new Map<string, { status: Status; detail: string }>();
  const rows = items.map((t) => {
    const detail = h('input', { class: 'input', placeholder: '¿Qué falla? (obligatorio)', hidden: true }) as HTMLInputElement;
    const btns: HTMLButtonElement[] = [];
    const pick = (st: Status, b: HTMLButtonElement) => {
      btns.forEach((x) => x.classList.remove('on')); b.classList.add('on');
      detail.hidden = st !== 'fail'; if (st === 'fail') detail.focus();
      answers.set(t.key, { status: st, detail: '' });
    };
    const mk = (st: Status, label: string, cls: string) => { const b = h('button', { class: `chk ${cls}` }, label) as HTMLButtonElement; b.onclick = () => pick(st, b); btns.push(b); return b; };
    return h('div', { class: `chk-row ${t.status ? 'done' : ''}` },
      h('div', { class: 'chk-head' }, h('b', {}, t.label), t.status ? h('span', { class: `pill ${t.status}` }, STATUS_LABEL[t.status]) : null),
      h('p', { class: 'muted small' }, t.how),
      h('div', { class: 'chk-btns' }, mk('ok', '✓ Funciona', 'ok'), mk('fail', '✗ Falla', 'bad'), t.naAllowed ? mk('na', 'No tiene', '') : null, mk('unverified', 'No probé', '')),
      detail);
  });
  const err = h('p', { class: 'err small' });
  const send = async () => {
    for (const [k, a] of answers) {
      if (a.status !== 'fail') continue;
      const inp = rows[items.findIndex((t) => t.key === k)].querySelector('input') as HTMLInputElement;
      a.detail = inp.value.trim();
      if (a.detail.length < 3) { err.textContent = `Contá qué falla en «${items.find((t) => t.key === k)!.label}».`; inp.focus(); return; }
    }
    for (const [k, a] of answers) store.set(QUEUE, JSON.stringify([...queue(), { test: k, status: a.status, detail: a.status === 'unverified' ? 'No se probó' : a.detail, origin: 'manual', nonce: nonce() }]));
    await flush();
    doneScreen();
  };
  render(h('h1', {}, 'Checklist rápido'), h('p', { class: 'muted' }, 'Marcá cada ítem. Lo que no marques queda pendiente.'), ...rows, err,
    h('button', { class: 'btn primary', onClick: () => void send() }, 'Enviar y terminar'),
    h('button', { class: 'btn', onClick: () => { busy = false; void refresh(); } }, 'Volver a la lista'));
}

function doneScreen() {
  busy = true;
  render(h('div', { class: 'card center' }, h('h1', {}, '¡Listo!'), h('p', {}, 'Los resultados ya están en la PC. El informe se ve en «Diagnóstico» → «Informe».'),
    h('button', { class: 'btn', onClick: () => { busy = false; void refresh(); } }, 'Ver la lista de pruebas')));
}

/* ---------- Ciclo principal ---------- */
async function start() {
  const m = location.hash.match(/t=([\w-]{20,64})/);
  if (m) history.replaceState(null, '', location.pathname); // el token no queda a la vista ni en el historial
  cred = store.get(KEY);
  if (m) {
    try { const r = await api('/p/api/claim', { token: m[1] }); cred = r.credential; store.set(KEY, cred); store.set(QUEUE, '[]'); }
    catch (e: any) { if (!cred) return render(h('div', { class: 'card' }, h('h1', {}, 'No se pudo vincular'), h('p', { class: 'err' }, e.message), h('p', { class: 'muted' }, 'Pedí en la PC un QR nuevo y volvé a escanearlo.'))); }
  }
  if (!cred) return render(h('div', { class: 'card' }, h('h1', {}, 'Escaneá el QR'), h('p', { class: 'muted' }, 'Abrí esta página escaneando el código que muestra la PC en «Diagnóstico».')));
  await refresh();
  poll = window.setInterval(() => { void flush(); void refresh(); }, 2500);
}

async function refresh() {
  let s: State;
  try { s = await api('/p/api/state'); }
  catch (e: any) {
    if (e.status === 401) { store.set(KEY, null); cred = null; clearInterval(poll); return render(h('div', { class: 'card' }, h('h1', {}, 'Sesión terminada'), h('p', { class: 'muted' }, 'Escaneá de nuevo el QR que muestra la PC.'))); }
    if (!busy) render(h('div', { class: 'card' }, h('h1', {}, 'Sin conexión con la PC'), h('p', { class: 'muted' }, 'Revisá que el iPhone esté en la misma red Wi‑Fi que la PC. El avance se conserva y se reintenta solo.')));
    return;
  }
  last = s;
  if (busy) return;
  if (s.state === 'pending') return render(h('div', { class: 'card center' }, h('h1', {}, 'Confirmá en la PC'), h('p', { class: 'muted' }, 'En la PC aparece este código. Confirmá que es este iPhone:'), h('div', { class: 'code' }, s.code ?? ''), h('p', { class: 'muted small' }, 'Esperando confirmación…')));
  if (s.state === 'closed' || s.state === 'revoked') {
    store.set(KEY, null); clearInterval(poll);
    return render(h('div', { class: 'card center' }, h('h1', {}, s.state === 'closed' ? 'Diagnóstico terminado' : 'Este iPhone se desvinculó'), h('p', { class: 'muted' }, s.state === 'closed' ? 'Ya podés cerrar esta página.' : 'Si hace falta, escaneá un QR nuevo desde la PC.')));
  }
  renderList(s);
}

function renderList(s: State) {
  const tests = s.tests ?? [];
  const req = new Set(s.requests ?? []);
  const nodes: Node[] = [h('h1', {}, 'Pruebas del equipo')];
  if (!window.isSecureContext) nodes.push(h('p', { class: 'note' }, 'Conexión sin HTTPS: Safari no permite cámara, micrófono ni sensores de movimiento. Esas pruebas quedan «No verificado» y se pueden comprobar a mano.'));
  const pend = queue().length;
  if (pend) nodes.push(h('p', { class: 'note' }, `${pend} resultado${pend > 1 ? 's' : ''} sin enviar: se reintenta solo.`));
  if (req.size) nodes.push(h('p', { class: 'note' }, `La PC pidió repetir: ${tests.filter((t) => req.has(t.key)).map((t) => t.label).join(', ')}.`));
  const done = tests.filter((t) => t.status).length;
  nodes.push(h('p', { class: 'muted small' }, `${done} de ${tests.length} registradas`), h('div', { class: 'bar' }, h('i', { style: `width:${tests.length ? (done / tests.length) * 100 : 0}%` })));
  const autoLeft = tests.filter((t) => AUTO_ORDER.includes(t.key) && (!t.status || req.has(t.key))).length;
  nodes.push(h('button', { class: 'btn primary big', onClick: () => void startWizard(tests) }, autoLeft ? `▶ Empezar diagnóstico (${autoLeft} pruebas)` : '▶ Repetir pruebas automáticas'),
    h('button', { class: 'btn', onClick: checklistPage }, 'Checklist rápido'),
    h('p', { class: 'muted small center' }, 'Subí el volumen y sacá el modo silencio antes de empezar.'));
  for (const g of Object.keys(GROUPS)) {
    const list = tests.filter((t) => t.group === g);
    if (!list.length) continue;
    nodes.push(h('h2', {}, GROUPS[g]));
    for (const t of list) nodes.push(h('button', { class: `test ${req.has(t.key) ? 'req' : ''}`, onClick: () => openTest(t) }, h('b', {}, t.label),
      h('span', { class: `pill ${t.status ?? ''}` }, t.status ? STATUS_LABEL[t.status] : req.has(t.key) ? 'Repetir' : 'Pendiente')));
  }
  render(...nodes);
}

/* ---------- Pruebas ---------- */
function closeOverlay() { overlay.hidden = true; overlay.replaceChildren(); overlay.style.background = ''; }
function back() { busy = false; wizard = null; closeOverlay(); stopMedia(); if (last) renderList(last); }
let media: MediaStream | null = null;
function stopMedia() { media?.getTracks().forEach((t) => t.stop()); media = null; }

/** Problemas frecuentes por prueba: un toque registra la falla con ese texto. */
const PROBLEMS: Record<string, string[]> = {
  screen: ['Manchas', 'Líneas', 'Píxeles muertos', 'Tinte o color raro', 'Brillo desparejo'],
  touch: ['Una zona no responde', 'Toques fantasma', 'Responde con demora'],
  camera_back: ['Imagen borrosa', 'No enfoca', 'Manchas en la imagen', 'No abre'],
  camera_front: ['Imagen borrosa', 'No enfoca', 'Manchas en la imagen', 'No abre'],
  microphone: ['No se escucha', 'Ruido o distorsión', 'Muy bajo'],
  speaker: ['No suena', 'Distorsiona', 'Muy bajo'],
  earpiece: ['No se escucha', 'Distorsiona', 'Muy bajo'], mics_specific: ['Uno no graba', 'Ruido o distorsión'], lenses: ['No enfoca', 'Imagen borrosa', 'No cambia de lente'],
  flash: ['No enciende', 'Muy débil'],
};

/** Respuesta de un toque: «Funciona bien» o «Tiene un problema» (con atajos para describirlo). */
function confirmBox(t: PhoneTest, origin: 'safari' | 'manual', data?: unknown, extra: Node[] = [], defaultDetail = ''): HTMLElement {
  const ta = h('textarea', { placeholder: 'Contá qué viste (o tocá una opción de arriba)' }) as HTMLTextAreaElement;
  ta.value = defaultDetail;
  const err = h('p', { class: 'err small' });
  const send = (st: Status, d = ta.value.trim()) => {
    if ((st === 'fail' || st === 'observations') && d.length < 3) { err.textContent = 'Contá qué viste.'; ta.focus(); return; }
    void submit(t.key, st, d, origin, data);
  };
  const problem = h('div', { class: 'problem', hidden: true },
    h('p', { class: 'small' }, '¿Qué problema tiene?'),
    h('div', { class: 'chips' }, ...(PROBLEMS[t.key] ?? []).map((p) => h('button', { class: 'chip', onClick: () => send('fail', ta.value.trim() ? `${p}: ${ta.value.trim()}` : p) }, p))),
    ta, err,
    h('div', { class: 'row' }, h('button', { class: 'btn bad', onClick: () => send('fail') }, 'Registrar falla'), h('button', { class: 'btn warn', onClick: () => send('observations') }, 'Es leve')));
  return h('div', { class: 'card' }, ...extra,
    h('button', { class: 'btn ok big', onClick: () => send('ok', defaultDetail) }, '✓ Funciona bien'),
    h('button', { class: 'btn bad', onClick: () => { problem.hidden = false; problem.scrollIntoView({ behavior: 'smooth' }); } }, '✗ Tiene un problema'),
    problem,
    t.naAllowed ? h('button', { class: 'btn', onClick: () => send('na') }, 'El modelo no lo tiene') : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn small-btn', onClick: () => void submit(t.key, 'unverified', 'No se pudo probar', origin, data) }, 'Saltar'),
      h('button', { class: 'btn small-btn', onClick: back }, wizard ? 'Salir' : 'Volver')));
}

function unsupported(t: PhoneTest, why: string, manual: string) {
  // En el recorrido automático se registra «No verificado» solo y se sigue; la PC muestra la alternativa manual.
  if (wizard) {
    render(...stepHeader(t), h('p', { class: 'note' }, why), h('p', { class: 'muted small' }, 'Se registra como «No verificado» y se sigue con la próxima prueba.'));
    setTimeout(() => void submit(t.key, 'unverified', why, 'safari'), 1400);
    return;
  }
  render(h('h1', {}, t.label), h('p', { class: 'note' }, why), h('div', { class: 'card' }, h('p', {}, h('b', {}, 'Alternativa manual: '), manual)),
    h('button', { class: 'btn', onClick: () => void submit(t.key, 'unverified', why, 'safari') }, 'Registrar «No verificado»'),
    h('p', { class: 'muted small center' }, 'Si lo comprobaste a mano, registralo:'), confirmBox(t, 'manual', { method: 'manual' }));
}

function openTest(t: PhoneTest) {
  busy = true; window.scrollTo(0, 0);
  const run: Record<string, () => void> = { screen: () => screenTest(t), touch: () => touchTest(t), camera_back: () => cameraTest(t, 'environment'),
    camera_front: () => cameraTest(t, 'user'), microphone: () => micTest(t), speaker: () => speakerTest(t), motion: () => motionTest(t) };
  (run[t.key] ?? (() => render(...stepHeader(t), h('div', { class: 'card' }, h('p', {}, t.how)), confirmBox(t, 'manual'))))();
}

function screenTest(t: PhoneTest) {
  const colors = [['#ffffff', 'Blanco'], ['#000000', 'Negro'], ['#ff0000', 'Rojo'], ['#00ff00', 'Verde'], ['#0000ff', 'Azul']];
  let i = 0;
  const show = () => {
    overlay.hidden = false; overlay.style.background = colors[i][0];
    overlay.replaceChildren(h('div', { class: 'hint' }, `${colors[i][1]} · ${i + 1}/${colors.length} · tocá para seguir`));
  };
  overlay.onclick = () => {
    i++;
    if (i < colors.length) return show();
    overlay.onclick = null; closeOverlay();
    render(...stepHeader(t), h('div', { class: 'card' }, h('p', {}, '¿Viste manchas, líneas, píxeles muertos o tinte en algún color?'),
      h('p', { class: 'muted small' }, 'Safari no cubre los bordes ni la zona de la cámara frontal: revisalos a mano con un fondo blanco.')),
      h('button', { class: 'btn', onClick: () => screenTest(t) }, 'Ver los colores de nuevo'), confirmBox(t, 'safari', { colors: colors.length }));
  };
  render(h('h1', {}, t.label), h('p', {}, 'Se muestran 5 colores a pantalla completa. Tocá para pasar al siguiente.'));
  show();
}

function touchTest(t: PhoneTest) {
  const cols = 6, rows = Math.max(10, Math.round((innerHeight / innerWidth) * cols));
  const total = cols * rows; const on = new Set<number>();
  const grid = h('div', { class: 'grid', style: `grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)` });
  for (let k = 0; k < total; k++) grid.append(h('div'));
  const mark = (x: number, y: number) => {
    const r = grid.getBoundingClientRect();
    const c = Math.floor(((x - r.left) / r.width) * cols), w = Math.floor(((y - r.top) / r.height) * rows);
    if (c < 0 || c >= cols || w < 0 || w >= rows) return;
    const k = w * cols + c; if (!on.has(k)) { on.add(k); (grid.children[k] as HTMLElement).className = 'on'; }
  };
  const handler = (e: TouchEvent) => { e.preventDefault(); for (const p of Array.from(e.touches)) mark(p.clientX, p.clientY); };
  grid.addEventListener('touchstart', handler, { passive: false }); grid.addEventListener('touchmove', handler, { passive: false });
  grid.addEventListener('pointermove', (e) => { if (e.buttons) mark(e.clientX, e.clientY); });
  grid.addEventListener('pointerdown', (e) => mark(e.clientX, e.clientY));
  const finish = () => {
    closeOverlay();
    const pct = Math.round((on.size / total) * 100);
    render(...stepHeader(t), h('div', { class: 'card' }, h('p', {}, `Área recorrida: ${on.size} de ${total} celdas (${pct} %).`),
      h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
      h('p', { class: 'muted small' }, pct < 100 ? 'Hay celdas sin recorrer: repetí o anotá la zona en observaciones.' : 'Se recorrió toda la cuadrícula.'),
      h('p', { class: 'muted small' }, 'Los bordes y la barra superior no se pueden probar desde Safari: revisalos a mano (por ejemplo, deslizando el Centro de control).')),
      h('button', { class: 'btn', onClick: () => touchTest(t) }, 'Repetir'), confirmBox(t, 'safari', { cells: total, covered: on.size, pct }, [], pct < 100 ? `Cobertura ${pct} %` : ''));
  };
  overlay.hidden = false; overlay.style.background = '#000';
  overlay.replaceChildren(grid, h('button', { class: 'done-btn', onClick: finish }, 'Terminar'));
}

async function cameraTest(t: PhoneTest, facing: 'user' | 'environment') {
  const alt = facing === 'user' ? 'Abrí la app Cámara, cambiá a la cámara frontal y sacá una foto.' : 'Abrí la app Cámara y probá cada lente (0,5×, 1×, teleobjetivo).';
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return unsupported(t, 'Safari no permite la cámara en esta conexión (requiere HTTPS).', alt);
  render(h('h1', {}, t.label), h('p', { class: 'muted' }, 'Pidiendo permiso para la cámara…'));
  try { media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing } }, audio: false }); }
  catch (e: any) {
    try { if (e?.name === 'OverconstrainedError') media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false }); else throw e; }
    catch (e2: any) { return unsupported(t, e2?.name === 'NotAllowedError' ? 'Permiso de cámara denegado.' : 'No se pudo abrir la cámara desde Safari.', alt); }
  }
  const v = h('video', { autoplay: true, playsinline: true, muted: true }) as HTMLVideoElement;
  v.srcObject = media;
  render(...stepHeader(t), v, h('p', { class: 'muted small' }, `${facing === 'environment' ? 'Safari elige la lente principal. ' : ''}Confirmá que la imagen se ve nítida y enfoca. ${facing === 'environment' ? 'Las demás lentes se prueban en «Lentes adicionales».' : ''}`),
    confirmBox(t, 'safari', { facing }));
}

async function micTest(t: PhoneTest) {
  const alt = 'Grabá una nota de voz en la app Notas de voz y reproducila.';
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return unsupported(t, 'Safari no permite el micrófono en esta conexión (requiere HTTPS).', alt);
  const status = h('p', { class: 'muted' }, 'Hablá cerca del iPhone: se graban 3 segundos y se reproducen acá (no se envía nada).');
  const audio = h('audio', { controls: true }) as HTMLAudioElement;
  const recBtn = h('button', { class: 'btn' }, 'Grabar de nuevo') as HTMLButtonElement;
  const record = async () => {
    try { media = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e: any) { return unsupported(t, e?.name === 'NotAllowedError' ? 'Permiso de micrófono denegado.' : 'No se pudo abrir el micrófono.', alt); }
    const chunks: Blob[] = []; const rec = new MediaRecorder(media);
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stopMedia();
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/mp4' });
      audio.src = URL.createObjectURL(blob);
      status.textContent = 'Escuchá la grabación y respondé.'; recBtn.disabled = false;
      // Reproducción automática con el audio habilitado al tocar «Empezar»; si no, con el reproductor.
      try { if (actx) { const buf = await actx.decodeAudioData(await blob.arrayBuffer()); const src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination); src.start(); } else await audio.play(); } catch { /* queda el reproductor */ }
    };
    recBtn.disabled = true; status.textContent = '● Grabando… hablá ahora'; rec.start(); setTimeout(() => rec.state !== 'inactive' && rec.stop(), 3000);
  };
  recBtn.onclick = () => void record();
  render(...stepHeader(t), status, audio, recBtn, confirmBox(t, 'safari', { recordSeconds: 3 }));
  if (wizard) void record(); else { recBtn.textContent = 'Grabar 3 segundos'; recBtn.className = 'btn primary'; }
}

function speakerTest(t: PhoneTest) {
  const AC: any = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return unsupported(t, 'Este navegador no puede reproducir el tono.', 'Reproducí un video o música con el volumen alto.');
  const play = () => {
    const ctx: AudioContext = actx ?? new AC(); void ctx.resume();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 1000; g.gain.value = 0.25; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 1.5); if (ctx !== actx) o.onended = () => void ctx.close();
  };
  render(...stepHeader(t), h('p', { class: 'muted' }, 'Tiene que sonar un tono por el altavoz inferior, sin distorsión. Volumen alto y sin modo silencio.'),
    h('button', { class: 'btn', onClick: play }, '🔊 Reproducir tono'), confirmBox(t, 'safari', { hz: 1000 }));
  if (wizard && actx) play();
}

async function motionTest(t: PhoneTest) {
  const alt = 'Desactivá el bloqueo de rotación y girá el equipo: la pantalla debe rotar en una app compatible.';
  const DME: any = (window as any).DeviceMotionEvent;
  if (!window.isSecureContext || !DME) return unsupported(t, 'Safari no entrega datos de movimiento en esta conexión (requiere HTTPS).', alt);
  const out = h('p', { class: 'muted' }, 'Tocá «Empezar» y mové el equipo en todas direcciones durante 4 segundos.');
  const go = h('button', { class: 'btn primary' }, 'Empezar') as HTMLButtonElement;
  go.onclick = async () => {
    if (motionPerm === 'denied') return unsupported(t, 'Permiso de movimiento denegado.', alt);
    if (typeof DME.requestPermission === 'function' && motionPerm !== 'granted') {
      try { if ((await DME.requestPermission()) !== 'granted') return unsupported(t, 'Permiso de movimiento denegado.', alt); }
      catch { return unsupported(t, 'No se pudo pedir el permiso de movimiento.', alt); }
    }
    let n = 0, acc = false, gyro = false;
    const on = (e: DeviceMotionEvent) => {
      n++;
      const a = e.accelerationIncludingGravity; if (a && [a.x, a.y, a.z].some((v) => v != null && Math.abs(v) > 0.01)) acc = true;
      const r = e.rotationRate; if (r && [r.alpha, r.beta, r.gamma].some((v) => v != null && Math.abs(v) > 0.01)) gyro = true;
    };
    window.addEventListener('devicemotion', on); go.disabled = true; out.textContent = 'Midiendo…';
    setTimeout(() => {
      window.removeEventListener('devicemotion', on);
      if (!n) return unsupported(t, 'El navegador no recibió datos de movimiento.', alt);
      const st: Status = acc && gyro ? 'ok' : 'unverified';
      const detail = acc && gyro ? `Acelerómetro y giroscopio con datos (${n} lecturas)` : `Datos incompletos: acelerómetro ${acc ? 'sí' : 'no'}, giroscopio ${gyro ? 'sí' : 'no'}`;
      void submit(t.key, st, detail, 'safari', { events: n, accelerometer: acc, gyroscope: gyro });
    }, 4000);
  };
  render(...stepHeader(t), out, go, h('button', { class: 'btn', onClick: back }, wizard ? 'Salir' : 'Volver'));
  if (wizard && motionPerm !== null) { out.textContent = 'Mové el iPhone en todas direcciones…'; go.click(); }
}

void start();
