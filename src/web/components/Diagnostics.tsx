// Diagnóstico de iPhone (puesto del técnico en Windows): conexión USB, QR para Safari, avance en vivo, controles manuales,
// cierre con observaciones, historial e informe imprimible / PDF.
import { useEffect, useMemo, useRef, useState } from 'react';
import { TESTS, GROUP_LABEL, STATUS_LABEL, ORIGIN_LABEL, TEST_BY_KEY, maskId, type TestResult, type TestStatus, type DeviceInfo, type Verdict } from '../../shared/diag.ts';
import { qrSvg } from '../../shared/qr.ts';
import { Icon } from '../icons.tsx';
import { useIsAdmin } from '../session.ts';

interface Diag {
  id: string; ref: string; status: 'open' | 'closed' | 'cancelled'; createdAt: string; closedAt: string | null; createdBy: string | null;
  device: DeviceInfo; masked: boolean; usbState: { state: string; message: string | null; detail?: string | null; read?: string[]; missing?: string[]; at: string } | null; hasUsbIdentity: boolean;
  observations: string; current: Record<string, TestResult>; history: Record<string, TestResult[]>; requests: string[]; verdict: Verdict;
  phone: { qrExpiresAt: string | null; pending: { id: string; code: string; info: string; since: string }[]; active: { id: string; info: string; lastSeen: string | null } | null };
}
interface UsbList { service: 'ok' | 'unavailable'; message: string | null; detail?: string | null; devices: { key: string; model: string | null; productType: string | null; ios: string | null }[] }
interface Lan { running: boolean; error: string | null; port: number; https: boolean; host: string | null; addresses: string[]; configuredHost: string | null; certName: string | null; note: string | null }
interface Row { id: string; ref: string; status: string; createdAt: string; closedAt: string | null; createdBy: string | null; model: string | null; ios: string | null; capacityGb: number | null; verdict: string }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) window.dispatchEvent(new Event('auth:changed'));
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j as T;
}
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const STATE_LABEL: Record<string, string> = { open: 'En curso', closed: 'Cerrado', cancelled: 'Cancelado' };
const OPEN_KEY = 'diag-open-id';

export function Diagnostics() {
  const [openId, setOpenId] = useState<string | null>(() => sessionStorage.getItem(OPEN_KEY));
  const [reportId, setReportId] = useState<string | null>(null);
  useEffect(() => { if (openId) sessionStorage.setItem(OPEN_KEY, openId); else sessionStorage.removeItem(OPEN_KEY); }, [openId]);
  if (reportId) return <Report id={reportId} onBack={() => setReportId(null)} />;
  if (openId) return <Session id={openId} onBack={() => setOpenId(null)} onReport={setReportId} />;
  return <DiagHome onOpen={setOpenId} onReport={setReportId} />;
}

/* ---------------- Inicio del módulo: nuevo diagnóstico, iPhone detectado e historial ---------------- */

function DiagHome({ onOpen, onReport }: { onOpen: (id: string) => void; onReport: (id: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [usb, setUsb] = useState<UsbList | null>(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => call<Row[]>('GET', `/api/diag?q=${encodeURIComponent(q)}`).then(setRows).catch(() => {}), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const load = () => call<UsbList>('GET', '/api/diag/usb').then(setUsb).catch(() => {});
    load(); const t = setInterval(load, 2500); return () => clearInterval(t);
  }, []);
  async function start(device?: string) {
    if (creating) return;
    setCreating(true); setErr('');
    try {
      const d = await call<Diag>('POST', '/api/diag');
      if (device) sessionStorage.setItem(`diag-autoread-${d.id}`, device);
      onOpen(d.id);
    } catch (e) { setErr((e as Error).message); } finally { setCreating(false); }
  }
  const open = rows.filter((r) => r.status === 'open');
  return (
    <div className="dg">
      <header className="page-head"><div><h1>Diagnóstico</h1><p className="sub">Conectá el iPhone por USB: la app lo detecta, lee sus datos y abre las pruebas en Safari con un QR.</p></div>
        <button className="btn primary" onClick={() => start()} disabled={creating}><Icon name="plus" size={16} /> Nuevo diagnóstico</button></header>
      {err && <p className="err">{err}</p>}
      <section className="dg-detect">
        {!usb ? <p className="muted">Buscando iPhone conectados…</p>
          : usb.service === 'unavailable' ? <div className="dg-detect-msg"><Icon name="pulse" size={22} /><div><b>Lectura USB no disponible</b><p className="muted">{usb.message} Mientras tanto podés iniciar el diagnóstico y seguir con el QR.</p></div></div>
          : !usb.devices.length ? <div className="dg-detect-msg"><Icon name="phone" size={22} /><div><b>Conectá un iPhone</b><p className="muted">Usá un cable de datos, desbloqueá el iPhone y tocá «Confiar» si lo pide.</p></div></div>
          : usb.devices.map((d) => (
            <div key={d.key} className="dg-detect-msg found"><Icon name="phone" size={22} /><div><b>{d.model ?? d.productType ?? 'iPhone'} detectado</b><p className="muted">{d.ios ? `iOS ${d.ios}` : 'Desbloquealo para leer más datos'}</p></div>
              <button className="btn primary" onClick={() => start(d.key)} disabled={creating}>Empezar diagnóstico</button></div>))}
        {usb?.message && usb.service === 'ok' && <p className="dg-note">{usb.message}</p>}
        {usb?.detail && <p className="muted small dg-tech">Detalle técnico: {usb.detail}</p>}
      </section>
      {open.length > 0 && <section className="dg-card"><h2>En curso</h2>{open.map((r) => <HistRow key={r.id} r={r} onOpen={onOpen} onReport={onReport} />)}</section>}
      <section className="dg-card">
        <div className="dg-row-head"><h2>Historial</h2><input className="input" placeholder="Buscar por referencia, modelo o iOS" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {rows.filter((r) => r.status !== 'open').length === 0 ? <p className="muted">Todavía no hay diagnósticos cerrados.</p>
          : rows.filter((r) => r.status !== 'open').map((r) => <HistRow key={r.id} r={r} onOpen={onOpen} onReport={onReport} />)}
      </section>
      <LanSettings />
    </div>
  );
}

function HistRow({ r, onOpen, onReport }: { r: Row; onOpen: (id: string) => void; onReport: (id: string) => void }) {
  return (
    <div className="dg-hist">
      <div><b>{r.ref}</b><span className="muted"> · {when(r.createdAt)}</span></div>
      <div>{r.model ?? 'Equipo sin identificar'}{r.capacityGb ? ` · ${r.capacityGb} GB` : ''}{r.ios ? ` · iOS ${r.ios}` : ''}</div>
      <div className="muted">{STATE_LABEL[r.status]} · {r.verdict}</div>
      <div className="dg-hist-acts">
        {r.status === 'open' ? <button className="btn" onClick={() => onOpen(r.id)}>Continuar</button> : <button className="btn" onClick={() => onOpen(r.id)}>Ver</button>}
        <button className="btn ghost" onClick={() => onReport(r.id)}><Icon name="doc" size={14} /> Informe</button>
      </div>
    </div>
  );
}

/* ---------------- Sesión de diagnóstico ---------------- */

function Session({ id, onBack, onReport }: { id: string; onBack: () => void; onReport: (id: string) => void }) {
  const [d, setD] = useState<Diag | null>(null);
  const [usb, setUsb] = useState<UsbList | null>(null);
  const [err, setErr] = useState('');
  const [reading, setReading] = useState(false);
  const [chosen, setChosen] = useState<string | null>(() => sessionStorage.getItem(`diag-autoread-${id}`));
  const [qr, setQr] = useState<{ url: string; expiresAt: string; https: boolean; note: string | null } | null>(null);
  const [manualDevice, setManualDevice] = useState(false);
  const [form, setForm] = useState<{ test: string; status: TestStatus; detail: string } | null>(null);
  const [obs, setObs] = useState('');
  const [closing, setClosing] = useState(false);
  const autoRead = useRef<string | null>(null);
  const autoQr = useRef(false);
  const isAdmin = useIsAdmin();

  const load = () => call<Diag>('GET', `/api/diag/${id}`).then((x) => { setD(x); return x; }).catch((e) => { setErr((e as Error).message); return null; });
  useEffect(() => { void load().then((x) => x && setObs(x.observations)); const t = setInterval(load, 1500); return () => clearInterval(t); }, [id]);
  const open = d?.status === 'open';
  useEffect(() => {
    if (!open) return;
    const l = () => call<UsbList>('GET', '/api/diag/usb').then(setUsb).catch(() => {});
    l(); const t = setInterval(l, 2000); return () => clearInterval(t);
  }, [open]);

  // Equipo elegido: el que se eligió, o el único conectado.
  const devices = usb?.devices ?? [];
  const device = devices.find((x) => x.key === chosen) ?? (devices.length === 1 ? devices[0] : null);
  const usbState = d?.usbState?.state;
  const wasConnected = usbState === 'connected' || d?.hasUsbIdentity;
  const status: { key: string; label: string } =
    usb?.service === 'unavailable' ? { key: 'off', label: 'Lectura USB no disponible' }
    : !device ? (wasConnected ? { key: 'disconnected', label: 'Desconectado' } : { key: 'none', label: devices.length > 1 ? 'Elegí un iPhone' : 'Sin equipo' })
    : usbState === 'connected' && d?.usbState && autoRead.current === device.key ? { key: 'connected', label: d.usbState.detail ? 'Conectado · faltan datos' : 'Conectado' }
    : usbState === 'pending_trust' ? { key: 'pending', label: 'Pendiente de autorización' }
    : usbState === 'locked' ? { key: 'pending', label: 'Desbloqueá el iPhone' }
    : usbState === 'error' && autoRead.current === device.key && !reading ? { key: 'partial', label: 'Lectura incompleta' }
    : reading ? { key: 'reading', label: 'Leyendo…' } : { key: 'detected', label: 'Detectado' };

  async function readUsb(key: string) {
    setReading(true); setErr(''); autoRead.current = key;
    try { setD(await call<Diag>('POST', `/api/diag/${id}/usb`, { device: key })); }
    catch (e) { setErr((e as Error).message); }
    finally { setReading(false); sessionStorage.removeItem(`diag-autoread-${id}`); }
  }
  // Detectado → leer solo (una vez por conexión). Pendiente de autorización o bloqueado → reintenta cada 5 s.
  useEffect(() => {
    if (!open || !device || reading) return;
    if (autoRead.current !== device.key) { void readUsb(device.key); return; }
    if (usbState === 'pending_trust' || usbState === 'locked') { const t = setTimeout(() => void readUsb(device.key), 5000); return () => clearTimeout(t); }
  }, [open, device?.key, usbState, reading]);
  // Equipo desconectado: la próxima vez que aparezca se vuelve a leer (y se verifica que sea el mismo).
  useEffect(() => { if (!device) autoRead.current = null; }, [device?.key]);

  // Al vincular el iPhone, el QR ya no hace falta (se vuelve a pedir con «Vincular otro iPhone»).
  const activeId = d?.phone.active?.id;
  useEffect(() => { if (activeId) setQr(null); }, [activeId]);
  async function newQr() {
    setErr('');
    try { setQr(await call('POST', `/api/diag/${id}/qr`)); } catch (e) { setErr((e as Error).message); }
  }
  // Con los datos leídos (o si se sigue sin USB) se genera el QR automáticamente.
  useEffect(() => {
    if (!open || autoQr.current || d?.phone.active) return;
    if (usbState === 'connected' || usbState === 'error' || manualDevice || usb?.service === 'unavailable') { autoQr.current = true; void newQr(); }
  }, [open, usbState, manualDevice, usb?.service, d?.phone.active]);

  async function act(path: string, body?: unknown) {
    setErr('');
    try { const r = await call<any>('POST', `/api/diag/${id}/${path}`, body ?? {}); if (r?.id) setD(r); else void load(); return true; }
    catch (e) { setErr((e as Error).message); return false; }
  }

  if (!d) return <div className="dg"><button className="btn ghost" onClick={onBack}><Icon name="left" size={14} /> Diagnósticos</button>{err && <p className="err">{err}</p>}</div>;
  const missingCount = d.verdict.missing.length;

  return (
    <div className="dg">
      <header className="page-head">
        <div>
          <button className="btn ghost dg-back" onClick={onBack}><Icon name="left" size={14} /> Diagnósticos</button>
          <h1>{d.ref} <span className={`dg-state ${d.status}`}>{STATE_LABEL[d.status]}</span></h1>
          <p className="sub">{d.device.model ?? d.device.productType ?? 'Equipo sin identificar'}{d.device.ios ? ` · iOS ${d.device.ios}` : ''} · iniciado {when(d.createdAt)}</p>
        </div>
        <button className="btn" onClick={() => onReport(d.id)}><Icon name="doc" size={15} /> Informe</button>
      </header>
      {err && <p className="err dg-err">{err}</p>}
      <div className={`dg-verdict ${d.verdict.key}`}><b>{d.verdict.label}</b>{missingCount > 0 && <span>Sin verificar: {d.verdict.missing.join(', ')}.</span>}</div>

      <div className="dg-grid">
        <div className="dg-col">
          {open && (
            <section className="dg-card">
              <h2><Icon name="phone" size={18} /> Conectar iPhone <span className={`dg-usb ${status.key}`}>{status.label}</span></h2>
              <ol className="dg-steps"><li>Conectá el iPhone con un <b>cable de datos</b> (algunos cables solo cargan).</li><li>Desbloquealo y, si aparece, tocá <b>«Confiar»</b> e ingresá el código.</li></ol>
              {usb?.service === 'unavailable' && <p className="dg-note">{usb.message}</p>}
              {usb?.detail && !device && <p className="muted small dg-tech">Detalle técnico: {usb.detail}</p>}
              {devices.length > 1 && (
                <label className="dg-field">Hay {devices.length} iPhone conectados: elegí el que vas a diagnosticar
                  <select className="input" value={chosen ?? ''} onChange={(e) => { setChosen(e.target.value || null); autoRead.current = null; }}>
                    <option value="">Elegir…</option>{devices.map((x) => <option key={x.key} value={x.key}>{x.model ?? x.productType ?? 'iPhone'}{x.ios ? ` · iOS ${x.ios}` : ''}</option>)}
                  </select></label>)}
              {d.usbState?.message && device && <p className="dg-note">{d.usbState.message}</p>}
              {d.usbState?.detail && device && <p className="muted small dg-tech">Detalle técnico: {d.usbState.detail}</p>}
              {status.key === 'disconnected' && <p className="dg-note">Se desconectó el cable. El avance se conserva: al reconectar se verifica que sea el mismo iPhone.</p>}
              {status.key === 'none' && !wasConnected && <p className="muted small">¿No aparece? Probá otro cable o puerto, desbloqueá el iPhone y abrí la app Dispositivos Apple para comprobar si Windows lo reconoce.</p>}
              <div className="dg-acts">
                {device && <button className="btn" onClick={() => readUsb(device.key)} disabled={reading}><Icon name="refresh" size={14} className={reading ? 'spin' : ''} /> Leer de nuevo</button>}
                {!manualDevice && <button className="btn ghost" onClick={() => setManualDevice(true)}>Seguir sin USB</button>}
              </div>
            </section>)}

          {open && (
            <section className="dg-card">
              <h2><Icon name="qr" size={18} /> Abrir pruebas en iPhone</h2>
              {d.phone.active ? (
                <div className="dg-linked"><div><Icon name="check" size={16} /> <b>Vinculado:</b> {d.phone.active.info}</div><span className="muted small">Última actividad {when(d.phone.active.lastSeen)}. Las pruebas aparecen a la derecha a medida que llegan.</span>
                  <div className="dg-acts"><button className="btn ghost" onClick={() => { autoQr.current = true; void newQr(); }}>Vincular otro iPhone</button>
                    <button className="btn ghost" onClick={() => act('disconnect')}>Desvincular</button></div></div>
              ) : null}
              {d.phone.pending.map((p) => (
                <div key={p.id} className="dg-pending">
                  <p>Un equipo abrió el QR: <b>{p.info}</b></p>
                  <p>Código en el iPhone: <span className="dg-code">{p.code}</span></p>
                  <p className="muted small">Confirmá solo si ves el mismo código en el iPhone que estás diagnosticando.</p>
                  <div className="dg-acts"><button className="btn primary" onClick={() => act(`phone/${p.id}/confirm`, { accept: true })}>Es este iPhone</button>
                    <button className="btn" onClick={() => act(`phone/${p.id}/confirm`, { accept: false })}>No es</button></div>
                </div>))}
              {(!d.phone.active || qr) && <QrBox qr={qr} expiresAt={d.phone.qrExpiresAt} onNew={newQr} />}
            </section>)}

          <DeviceCard d={d} editable={!!open} isAdmin={isAdmin} onSaved={setD} startEditing={manualDevice && !d.device.model} />


          <section className="dg-card">
            <h2>Observaciones</h2>
            <textarea className="input dg-obs" maxLength={2000} value={obs} disabled={!open} onChange={(e) => setObs(e.target.value)}
              onBlur={() => open && act('observations', { observations: obs })} placeholder="Estado estético, accesorios, lo que contó el cliente, etc. (sin datos personales)" />
            {open && (closing ? (
              <div className="dg-close">
                {missingCount > 0 && <p className="dg-note">Quedan {missingCount} pruebas sin verificar. El informe lo va a indicar y no habrá aprobación global.</p>}
                <div className="dg-acts"><button className="btn primary" onClick={async () => { if (await act('close', { observations: obs })) setClosing(false); }}>Cerrar diagnóstico</button>
                  <button className="btn ghost" onClick={() => setClosing(false)}>Volver</button></div>
              </div>) : (
              <div className="dg-acts"><button className="btn primary" onClick={() => setClosing(true)}>Cerrar diagnóstico…</button>
                <button className="btn ghost danger" onClick={() => { if (confirm('¿Cancelar este diagnóstico? Se desvincula el iPhone.')) void act('cancel'); }}>Cancelar diagnóstico</button></div>))}
          </section>
        </div>

        <div className="dg-col">
          <section className="dg-card">
            <h2>Pruebas <span className="muted small">{TESTS.length - missingCount} de {TESTS.length} registradas</span></h2>
            {(['device', 'safari', 'guided', 'checklist'] as const).map((g) => (
              <div key={g} className="dg-group">
                <h3>{GROUP_LABEL[g]}</h3>
                {TESTS.filter((t) => t.group === g).map((t) => {
                  const r = d.current[t.key]; const hist = d.history[t.key] ?? [];
                  const editing = form?.test === t.key;
                  return (
                    <div key={t.key} className={`dg-test ${r?.status ?? 'none'}`}>
                      <div className="dg-test-head">
                        <b>{t.label}</b>
                        {d.requests.includes(t.key) && <span className="dg-pill req">Repetir en Safari</span>}
                        <span className={`dg-pill ${r?.status ?? ''}`}>{r ? STATUS_LABEL[r.status] : 'Pendiente'}</span>
                      </div>
                      {r && <div className="dg-test-meta">{ORIGIN_LABEL[r.origin]} · {when(r.createdAt)}{r.detail ? ` · ${r.detail}` : ''}</div>}
                      {hist.length > 1 && <details className="dg-hist-list"><summary>{hist.length} intentos</summary>
                        {hist.slice(0, -1).reverse().map((x, i) => <div key={i} className="muted small">{when(x.createdAt)} · {STATUS_LABEL[x.status]} · {ORIGIN_LABEL[x.origin]}{x.detail ? ` · ${x.detail}` : ''}</div>)}</details>}
                      {open && !editing && (
                        <div className="dg-test-acts">
                          <button className="link" onClick={() => setForm({ test: t.key, status: r?.status && r.status !== 'unverified' ? r.status : 'ok', detail: '' })}>Completar manual</button>
                          {t.phone && d.phone.active && r && <button className="link" onClick={() => act('repeat', { test: t.key })}>Repetir</button>}
                          {(!r || r.status !== 'unverified') && <button className="link" onClick={() => act('results', { test: t.key, status: 'unverified', detail: 'Omitida por el técnico' })}>Omitir</button>}
                        </div>)}
                      {editing && <ManualForm t={t.key} form={form!} setForm={setForm} onSave={async () => { if (await act('results', { test: form!.test, status: form!.status, detail: form!.detail })) setForm(null); }} />}
                    </div>);
                })}
              </div>))}
          </section>
        </div>
      </div>
    </div>
  );
}

function ManualForm({ t, form, setForm, onSave }: { t: string; form: { test: string; status: TestStatus; detail: string }; setForm: (f: any) => void; onSave: () => void }) {
  const def = TEST_BY_KEY.get(t)!;
  const needs = form.status === 'fail' || form.status === 'observations';
  return (
    <div className="dg-form">
      <p className="muted small">{def.how}</p>
      <div className="dg-seg">
        {(['ok', 'observations', 'fail', 'unverified', ...(def.naAllowed ? ['na'] : [])] as TestStatus[]).map((s) => (
          <button key={s} className={`dg-seg-b ${s} ${form.status === s ? 'on' : ''}`} onClick={() => setForm({ ...form, status: s })}>{STATUS_LABEL[s]}</button>))}
      </div>
      <textarea className="input" maxLength={600} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })}
        placeholder={form.status === 'fail' ? 'Describí la falla observada (obligatorio)' : t === 'battery_health' ? 'Ej.: Capacidad máxima 87 %, ciclos 412, «Rendimiento máximo»' : t === 'parts_history' ? 'Texto tal como lo muestra iOS (ej.: «Pantalla: Pieza desconocida»)' : 'Detalle (opcional)'} />
      {needs && form.detail.trim().length < 3 && <p className="err small">{form.status === 'fail' ? 'Una «Falla» exige describir la falla observada.' : 'Describí la observación.'}</p>}
      <div className="dg-acts"><button className="btn primary" disabled={needs && form.detail.trim().length < 3} onClick={onSave}>Guardar</button><button className="btn ghost" onClick={() => setForm(null)}>Cancelar</button></div>
    </div>
  );
}

function QrBox({ qr, expiresAt, onNew }: { qr: { url: string; expiresAt: string; https: boolean; note: string | null } | null; expiresAt: string | null; onNew: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const svg = useMemo(() => (qr ? qrSvg(qr.url) : null), [qr?.url]);
  const exp = qr ? Date.parse(qr.expiresAt) : expiresAt ? Date.parse(expiresAt) : 0;
  const left = Math.max(0, Math.round((exp - now) / 1000));
  if (!qr || !left) return (
    <div className="dg-qr-empty"><p className="muted">{qr ? 'El QR venció.' : 'Generá el QR para abrir las pruebas en Safari.'}</p><button className="btn primary" onClick={onNew}><Icon name="qr" size={15} /> {qr ? 'Generar QR nuevo' : 'Mostrar QR'}</button></div>);
  return (
    <div className="dg-qr">
      <div className="dg-qr-img" dangerouslySetInnerHTML={{ __html: svg! }} />
      <div>
        <ol className="dg-steps"><li>Con el iPhone en la <b>misma red Wi‑Fi</b> que esta PC, abrí la Cámara y escaneá el código.</li><li>Tocá el enlace: se abre Safari.</li><li>Confirmá acá que el código coincide.</li></ol>
        <p className="muted small">Vence en {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · se usa una sola vez.</p>
        {qr.note && <p className="dg-note small">{qr.note}</p>}
        <button className="btn ghost" onClick={onNew}><Icon name="refresh" size={14} /> Regenerar</button>
      </div>
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = { model: 'Modelo', ios: 'iOS', capacityGb: 'Capacidad', serial: 'Número de serie', imei1: 'IMEI 1', imei2: 'IMEI 2', modelNumber: 'Número de modelo' };

function DeviceCard({ d, editable, isAdmin, onSaved, startEditing }: { d: Diag; editable: boolean; isAdmin: boolean; onSaved: (d: Diag) => void; startEditing: boolean }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [full, setFull] = useState<DeviceInfo | null>(null);
  useEffect(() => { if (startEditing) begin(); }, [startEditing]);
  const dev = full ?? d.device;
  const src = (k: string) => d.device.sources?.[k];
  function begin() {
    const b = d.device.battery ?? {};
    setF({ model: d.device.model ?? '', ios: d.device.ios ?? '', capacityGb: d.device.capacityGb ? String(d.device.capacityGb) : '', serial: '', imei1: '', imei2: '',
      settingsMaxPct: b.settingsMaxPct != null ? String(b.settingsMaxPct) : '', cycles: b.cycles != null ? String(b.cycles) : '', chargePct: b.chargePct != null ? String(b.chargePct) : '' });
    setEdit(true); setErr('');
  }
  async function save() {
    setErr('');
    const body: any = { model: f.model, ios: f.ios, capacityGb: f.capacityGb, battery: { settingsMaxPct: f.settingsMaxPct, cycles: f.cycles, chargePct: f.chargePct } };
    // Serie e IMEI solo si se escribieron (los guardados se muestran enmascarados).
    for (const k of ['serial', 'imei1', 'imei2']) if (f[k].trim()) body[k] = f[k];
    try { onSaved(await call<Diag>('PATCH', `/api/diag/${d.id}/device`, body)); setEdit(false); setFull(null); } catch (e) { setErr((e as Error).message); }
  }
  async function reveal() { try { setFull((await call<Diag>('GET', `/api/diag/${d.id}?reveal=1`)).device); } catch (e) { setErr((e as Error).message); } }
  const b = dev.battery ?? {};
  const missing = d.usbState?.missing ?? [];
  const Badge = ({ k }: { k: string }) => (src(k) ? <span className={`dg-src ${src(k)}`}>{src(k) === 'usb' ? 'USB' : 'Manual'}</span> : null);
  if (edit) return (
    <section className="dg-card">
      <h2>Datos del equipo</h2>
      <p className="muted small">Completá lo que no se pudo leer por USB copiándolo del iPhone: Configuración → General → Información, y Configuración → Batería.</p>
      <div className="dg-fields">
        {([['model', 'Modelo', 'iPhone 13'], ['ios', 'Versión de iOS', '18.1'], ['capacityGb', 'Capacidad (GB)', '128'], ['serial', 'Número de serie', dev.serial ? `${dev.serial} (cargado)` : ''],
          ['imei1', 'IMEI 1', dev.imei1 ? `${dev.imei1} (cargado)` : ''], ['imei2', 'IMEI 2', dev.imei2 ? `${dev.imei2} (cargado)` : ''],
          ['settingsMaxPct', 'Capacidad máxima (Configuración) %', '87'], ['cycles', 'Ciclos de carga', '412'], ['chargePct', 'Carga actual %', '76']] as const).map(([k, l, ph]) => (
          <label key={k} className="dg-field">{l}<input className="input" value={f[k] ?? ''} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>))}
      </div>
      {err && <p className="err small">{err}</p>}
      <div className="dg-acts"><button className="btn primary" onClick={save}>Guardar</button><button className="btn ghost" onClick={() => setEdit(false)}>Cancelar</button></div>
    </section>);
  return (
    <section className="dg-card">
      <h2>Datos del equipo {editable && <button className="link small" onClick={begin}>Editar</button>}</h2>
      <dl className="dg-dl">
        <dt>Modelo</dt><dd>{dev.model ?? (dev.productType ? `${dev.productType} (modelo no identificado: cargalo a mano)` : '—')} <Badge k="model" />{dev.modelNumber ? <span className="muted"> · {dev.modelNumber}</span> : null}</dd>
        <dt>iOS</dt><dd>{dev.ios ?? '—'}{dev.build ? <span className="muted"> ({dev.build})</span> : null} <Badge k="ios" /></dd>
        <dt>Capacidad</dt><dd>{dev.capacityGb ? `${dev.capacityGb} GB` : '—'} <Badge k="capacityGb" /></dd>
        <dt>Número de serie</dt><dd>{dev.serial ?? '—'} <Badge k="serial" /></dd>
        <dt>IMEI 1</dt><dd>{dev.imei1 ?? '—'} <Badge k="imei1" /></dd>
        <dt>IMEI 2</dt><dd>{dev.imei2 ?? '—'} <Badge k="imei2" /></dd>
        <dt>Carga actual</dt><dd>{b.chargePct != null ? `${b.chargePct} %${b.charging ? ' (cargando)' : ''}` : '—'} <Badge k="battery.chargePct" /></dd>
        <dt>Capacidad máxima</dt><dd>{b.settingsMaxPct != null ? `${b.settingsMaxPct} % (Configuración → Batería)` : '— (copiala de Configuración → Batería)'} <Badge k="battery.settingsMaxPct" />
          {b.estimatedMaxPct != null && <div className="muted small">Estimada por USB: {b.estimatedMaxPct} % (puede diferir de lo que muestra iOS)</div>}</dd>
        <dt>Ciclos</dt><dd>{b.cycles != null ? b.cycles : '—'} <Badge k="battery.cycles" /></dd>
      </dl>
      {missing.length > 0 && d.usbState?.state === 'connected' && <p className="muted small">No se pudo leer por USB: {missing.map((k) => FIELD_LABEL[k] ?? (k.startsWith('battery') ? 'datos de batería' : k)).join(', ')}. Cargalos con «Editar».</p>}
      {d.masked && (dev.serial || dev.imei1) && (isAdmin ? (!full ? <button className="link small" onClick={reveal}>Mostrar serie e IMEI completos</button> : <button className="link small" onClick={() => setFull(null)}>Ocultar</button>)
        : <p className="muted small">Serie e IMEI enmascarados.</p>)}
      {err && <p className="err small">{err}</p>}
    </section>);
}

/* ---------------- Informe ---------------- */

function Report({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<Diag | null>(null);
  const [full, setFull] = useState(false);
  const [err, setErr] = useState('');
  const isAdmin = useIsAdmin();
  useEffect(() => { call<Diag>('GET', `/api/diag/${id}${full ? '?reveal=1' : ''}`).then(setD).catch((e) => setErr((e as Error).message)); }, [id, full]);
  async function pdf() {
    const desk = (window as any).desktop;
    if (desk?.savePdf) { try { const r = await desk.savePdf(`Diagnostico-${d!.ref}.pdf`); if (r?.error) setErr(r.error); } catch (e) { setErr((e as Error).message); } }
    else window.print();
  }
  if (!d) return <div className="dg">{err ? <p className="err">{err}</p> : <p className="muted">Cargando…</p>}</div>;
  const b = d.device.battery ?? {};
  return (
    <div className="dg-report-wrap">
      <div className="dg-report-bar no-print">
        <button className="btn ghost" onClick={onBack}><Icon name="left" size={14} /> Volver</button>
        {isAdmin && <label className="dg-check"><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Incluir serie e IMEI completos</label>}
        <button className="btn" onClick={() => window.print()}>Imprimir</button>
        <button className="btn primary" onClick={pdf}>Exportar PDF</button>
        {err && <span className="err">{err}</span>}
      </div>
      <article className="dg-report">
        <header><img src="/logo.png" alt="" /><div><h1>Informe de diagnóstico</h1><p>Referencia interna <b>{d.ref}</b> · {STATE_LABEL[d.status]}</p></div></header>
        <section className="dg-r-grid">
          <div><span>Modelo</span><b>{d.device.model ?? d.device.productType ?? '—'}</b></div>
          <div><span>iOS</span><b>{d.device.ios ?? '—'}</b></div>
          <div><span>Capacidad</span><b>{d.device.capacityGb ? `${d.device.capacityGb} GB` : '—'}</b></div>
          <div><span>Fecha</span><b>{when(d.closedAt ?? d.createdAt)}</b></div>
          <div><span>Número de serie</span><b>{full ? d.device.serial ?? '—' : d.device.serial ? maskId(d.device.serial) : '—'}</b></div>
          <div><span>IMEI</span><b>{[d.device.imei1, d.device.imei2].filter(Boolean).map((x) => (full ? x : maskId(x))).join(' / ') || '—'}</b></div>
          <div><span>Batería</span><b>{b.settingsMaxPct != null ? `Capacidad máxima ${b.settingsMaxPct} %` : b.estimatedMaxPct != null ? `Estimada por USB ${b.estimatedMaxPct} %` : '—'}{b.cycles != null ? ` · ${b.cycles} ciclos` : ''}</b></div>
          <div><span>Técnico</span><b>{d.createdBy ?? '—'}</b></div>
        </section>
        <div className={`dg-verdict ${d.verdict.key}`}><b>{d.verdict.label}</b>{d.verdict.missing.length > 0 && <span>Sin verificar: {d.verdict.missing.join(', ')}.</span>}</div>
        <table className="dg-r-table">
          <thead><tr><th>Prueba</th><th>Estado</th><th>Origen</th><th>Fecha</th><th>Detalle</th></tr></thead>
          <tbody>{TESTS.map((t) => { const r = d.current[t.key]; return (
            <tr key={t.key} className={r?.status ?? 'none'}><td>{t.label}</td><td>{r ? STATUS_LABEL[r.status] : 'No verificado'}</td><td>{r ? ORIGIN_LABEL[r.origin] : '—'}</td><td>{r ? when(r.createdAt) : '—'}</td><td>{r?.detail || '—'}</td></tr>); })}</tbody>
        </table>
        <section><h2>Observaciones</h2><p className="dg-r-obs">{d.observations || 'Sin observaciones.'}</p></section>
        <footer>
          <p>El resultado refleja el estado al momento de las pruebas. «No verificado» indica que la prueba no se pudo realizar o no hubo evidencia válida.
            La ausencia del Historial de piezas y servicio no certifica que el equipo nunca haya sido reparado. La lista negra de IMEI y el bloqueo de activación se verifican por separado.
            La capacidad de batería «estimada por USB» puede diferir de la que muestra iOS.</p>
        </footer>
      </article>
    </div>
  );
}

/* ---------------- Configuración de la conexión para el iPhone ---------------- */

function LanSettings() {
  const [lan, setLan] = useState<Lan | null>(null);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [pfx, setPfx] = useState<string | null>(null);
  const [pass, setPass] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const isAdmin = useIsAdmin();
  useEffect(() => { call<Lan>('GET', '/api/diag/lan').then((l) => { setLan(l); setHost(l.configuredHost ?? ''); setPort(String(l.port)); }).catch(() => {}); }, []);
  async function save(extra: object = {}) {
    setErr('');
    try { const l = await call<Lan>('PUT', '/api/diag/lan', { host, port: Number(port), ...(pfx ? { pfxBase64: pfx, passphrase: pass, certName: name } : {}), ...extra }); setLan(l); setPfx(null); setPass(''); }
    catch (e) { setErr((e as Error).message); }
  }
  if (!lan) return null;
  return (
    <section className="dg-card">
      <h2>Conexión con el iPhone <span className={`dg-usb ${lan.running ? 'connected' : 'off'}`}>{lan.running ? (lan.https ? 'HTTPS activo' : 'HTTP activo') : 'Detenida'}</span></h2>
      <p className="muted small">El iPhone abre {lan.https ? 'https' : 'http'}://{lan.host ?? '(sin red)'}:{lan.port}/d en la red del local. Si Windows pregunta, permití la app en <b>redes privadas</b>.</p>
      {lan.error && <p className="err small">{lan.error}</p>}
      {lan.note && <p className="dg-note small">{lan.note}</p>}
      {isAdmin && (!open ? <button className="link small" onClick={() => setOpen(true)}>Configurar dirección y HTTPS</button> : (
        <div className="dg-fields">
          <label className="dg-field">Dirección o nombre para el iPhone<input className="input" value={host} placeholder={lan.addresses[0] ?? '192.168.1.10'} onChange={(e) => setHost(e.target.value)} />
            <span className="muted small">Vacío = IP automática ({lan.addresses.join(', ') || 'sin red'}). Con HTTPS usá el nombre del certificado.</span></label>
          <label className="dg-field">Puerto<input className="input" value={port} onChange={(e) => setPort(e.target.value)} /></label>
          <label className="dg-field">Certificado HTTPS (.pfx){lan.certName && <span className="muted small"> Actual: {lan.certName}</span>}
            <input type="file" accept=".pfx,.p12" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const b = new Uint8Array(await f.arrayBuffer()); let s = ''; b.forEach((x) => { s += String.fromCharCode(x); }); setPfx(btoa(s)); setName(f.name); }} /></label>
          {pfx && <label className="dg-field">Contraseña del .pfx<input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>}
          {err && <p className="err small">{err}</p>}
          <div className="dg-acts"><button className="btn primary" onClick={() => save()}>Guardar y reiniciar conexión</button>
            {lan.certName && <button className="btn ghost" onClick={() => save({ removeCert: true })}>Quitar certificado (volver a HTTP)</button>}
            <button className="btn ghost" onClick={() => setOpen(false)}>Cerrar</button></div>
        </div>))}
    </section>
  );
}
