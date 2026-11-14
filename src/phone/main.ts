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
  await flush();
  busy = false; closeOverlay(); await refresh();
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
function back() { busy = false; closeOverlay(); stopMedia(); if (last) renderList(last); }
let media: MediaStream | null = null;
function stopMedia() { media?.getTracks().forEach((t) => t.stop()); media = null; }

/** Botones de confirmación humana. «Falla» y «Con observaciones» piden describir lo observado. */
function confirmBox(t: PhoneTest, origin: 'safari' | 'manual', data?: unknown, extra: Node[] = [], defaultDetail = ''): HTMLElement {
  const ta = h('textarea', { placeholder: 'Describí lo que viste (obligatorio para «Falla» u «Observaciones»)' }) as HTMLTextAreaElement;
  ta.value = defaultDetail;
  const err = h('p', { class: 'err small' });
  const send = (st: Status) => {
    const d = ta.value.trim();
    if ((st === 'fail' || st === 'observations') && d.length < 3) { err.textContent = st === 'fail' ? 'Describí la falla observada.' : 'Describí la observación.'; ta.focus(); return; }
    stopMedia(); void submit(t.key, st, d, origin, data);
  };
  return h('div', { class: 'card' }, ...extra,
    h('button', { class: 'btn ok', onClick: () => send('ok') }, t.perception ? 'Funciona bien' : 'OK'),
    h('button', { class: 'btn warn', onClick: () => send('observations') }, 'Con observaciones'),
    h('button', { class: 'btn bad', onClick: () => send('fail') }, 'Falla'),
    t.naAllowed ? h('button', { class: 'btn', onClick: () => send('na') }, 'No aplica (el modelo no lo tiene)') : null,
    ta, err,
    h('button', { class: 'btn', onClick: () => { stopMedia(); void submit(t.key, 'unverified', ta.value.trim() || 'No se pudo comprobar', origin, data); } }, 'No se pudo verificar'),
    h('button', { class: 'btn', onClick: back }, 'Volver sin guardar'));
}

function unsupported(t: PhoneTest, why: string, manual: string) {
  render(h('h1', {}, t.label), h('p', { class: 'note' }, why), h('div', { class: 'card' }, h('p', {}, h('b', {}, 'Alternativa manual: '), manual)),
    h('button', { class: 'btn', onClick: () => void submit(t.key, 'unverified', why, 'safari') }, 'Registrar «No verificado»'),
    h('p', { class: 'muted small center' }, 'Si lo comprobaste a mano, registralo:'), confirmBox(t, 'manual', { method: 'manual' }));
}

function openTest(t: PhoneTest) {
  busy = true; window.scrollTo(0, 0);
  const run: Record<string, () => void> = { screen: () => screenTest(t), touch: () => touchTest(t), camera_back: () => cameraTest(t, 'environment'),
    camera_front: () => cameraTest(t, 'user'), microphone: () => micTest(t), speaker: () => speakerTest(t), motion: () => motionTest(t) };
  (run[t.key] ?? (() => render(h('h1', {}, t.label), h('div', { class: 'card' }, h('p', {}, t.how)), confirmBox(t, 'manual'))))();
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
    render(h('h1', {}, t.label), h('div', { class: 'card' }, h('p', {}, '¿Viste manchas, líneas, píxeles muertos o tinte en algún color?'),
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
    render(h('h1', {}, t.label), h('div', { class: 'card' }, h('p', {}, `Área recorrida: ${on.size} de ${total} celdas (${pct} %).`),
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
  render(h('h1', {}, t.label), v, h('p', { class: 'muted small' }, `${facing === 'environment' ? 'Safari elige la lente principal. ' : ''}Confirmá que la imagen se ve nítida y enfoca. ${facing === 'environment' ? 'Las demás lentes se prueban en «Lentes adicionales».' : ''}`),
    confirmBox(t, 'safari', { facing }));
}

async function micTest(t: PhoneTest) {
  const alt = 'Grabá una nota de voz en la app Notas de voz y reproducila.';
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return unsupported(t, 'Safari no permite el micrófono en esta conexión (requiere HTTPS).', alt);
  const status = h('p', { class: 'muted' }, 'Tocá «Grabar» y hablá 3 segundos. La grabación se reproduce solo en este iPhone y no se envía.');
  const audio = h('audio', { controls: true }) as HTMLAudioElement;
  const recBtn = h('button', { class: 'btn primary' }, 'Grabar 3 segundos') as HTMLButtonElement;
  recBtn.onclick = async () => {
    try { media = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e: any) { return unsupported(t, e?.name === 'NotAllowedError' ? 'Permiso de micrófono denegado.' : 'No se pudo abrir el micrófono.', alt); }
    const chunks: Blob[] = []; const rec = new MediaRecorder(media);
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => { stopMedia(); audio.src = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'audio/mp4' })); void audio.play().catch(() => {}); status.textContent = 'Escuchá la grabación y confirmá.'; recBtn.disabled = false; recBtn.textContent = 'Grabar de nuevo'; };
    recBtn.disabled = true; status.textContent = 'Grabando…'; rec.start(); setTimeout(() => rec.state !== 'inactive' && rec.stop(), 3000);
  };
  render(h('h1', {}, t.label), status, recBtn, audio, confirmBox(t, 'safari', { recordSeconds: 3 }));
}

function speakerTest(t: PhoneTest) {
  const AC: typeof AudioContext | undefined = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return unsupported(t, 'Este navegador no puede reproducir el tono.', 'Reproducí un video o música con el volumen alto.');
  const play = () => {
    const ctx = new AC(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 1000; g.gain.value = 0.25; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 1.5); o.onended = () => void ctx.close();
  };
  render(h('h1', {}, t.label), h('p', { class: 'muted' }, 'Subí el volumen, quitá el modo silencio y tocá «Reproducir tono». Debe sonar por el altavoz inferior sin distorsión.'),
    h('button', { class: 'btn primary', onClick: play }, 'Reproducir tono'), confirmBox(t, 'safari', { hz: 1000 }));
}

async function motionTest(t: PhoneTest) {
  const alt = 'Desactivá el bloqueo de rotación y girá el equipo: la pantalla debe rotar en una app compatible.';
  const DME: any = (window as any).DeviceMotionEvent;
  if (!window.isSecureContext || !DME) return unsupported(t, 'Safari no entrega datos de movimiento en esta conexión (requiere HTTPS).', alt);
  const out = h('p', { class: 'muted' }, 'Tocá «Empezar» y mové el equipo en todas direcciones durante 4 segundos.');
  const go = h('button', { class: 'btn primary' }, 'Empezar') as HTMLButtonElement;
  go.onclick = async () => {
    if (typeof DME.requestPermission === 'function') {
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
  render(h('h1', {}, t.label), out, go, h('button', { class: 'btn', onClick: back }, 'Volver'));
}

void start();
