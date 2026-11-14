// IMEI Check: el personal ingresa el IMEI (o los dos) de un celular usado o en parte de pago y ve, por cada IMEI
// y fuente, si figura reportado. La validación de formato es local; las consultas las hace el servidor.
import { useEffect, useRef, useState } from 'react';
import { validateImei, maskImei, summarizeImei, summarizeDevice, IMEI_STATUS_LABEL, COMPLEMENTARY_LABEL, MANUAL_LABEL, TAC_LABEL,
  type SourceResult, type SourceStatus, type ImeiStatus } from '../../shared/imei.ts';
import { Icon } from '../icons.tsx';
import { useIsAdmin } from '../session.ts';

interface Provider { id: string; name: string; base: string; coverage: string; coversUruguay: boolean; configured: boolean; auto: boolean;
  retryCharges: boolean; complementary: boolean; manualUrl?: string; manualLabel?: string; imei2Limited?: boolean; configurable?: boolean; uyNote?: string;
  reportTypes: string; update: string; terms: string; docs: string; howTo: string; status: string }
interface ProvidersInfo { providers: Provider[]; operators: { name: string; url: string }[]; apple: string; timeoutSeconds: number }
type Row = SourceResult & { imei?: string };

const SOURCE_LABEL: Record<string, string> = {
  reported: 'Reporte activo', clean: 'Sin reporte', history: 'Antecedente (reporte retirado)', not_configured: 'Proveedor sin configurar',
  timeout: 'Sin respuesta (tiempo agotado)', error: 'Error del proveedor', unexpected: 'Respuesta inesperada', pending: 'Consultando…',
  tac_only: TAC_LABEL, manual_pending: 'Pendiente de consulta manual',
};
const MANUAL_OPTIONS: [SourceStatus, string][] = [['reported', 'Figura reportado'], ['clean', 'Sin reporte'], ['history', 'Reporte anterior retirado'], ['error', 'No se pudo consultar']];
const when = (iso: string) => new Date(iso).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function ImeiCheck({ title = 'IMEI Check', subtitle }: { title?: string; subtitle?: string }) {
  const [info, setInfo] = useState<ProvidersInfo | null>(null);
  const [imei1, setImei1] = useState('');
  const [imei2, setImei2] = useState('');
  const [two, setTwo] = useState(false);
  const [presented, setPresented] = useState('');
  const [touched, setTouched] = useState(false);
  const [results, setResults] = useState<{ digits: string; rows: Row[] }[] | null>(null);
  const [running, setRunning] = useState(false);
  const [checkedTwo, setCheckedTwo] = useState(false);
  const [manualForm, setManualForm] = useState<{ idx: number; provider: string; status: SourceStatus; reportDate: string; reason: string } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const busy = useRef(false);
  const isAdmin = useIsAdmin();
  const loadInfo = () => fetch('/api/imei/providers').then((r) => r.json()).then(setInfo).catch(() => {});

  useEffect(() => { void loadInfo(); }, []);

  const v1 = validateImei(imei1);
  // IMEI 2 vacío está permitido (equipo con dos IMEI y el segundo sin cargar): la revisión queda parcial.
  const imei2Empty = two && !imei2.trim();
  const v2 = two && !imei2Empty ? validateImei(imei2) : null;
  const same = v1.ok && v2?.ok && v1.digits === v2.digits;
  const formOk = v1.ok && (!v2 || (v2.ok && !same));
  const autoProviders = info?.providers.filter((p) => p.auto) ?? [];
  const manualSites = info?.providers.filter((p) => p.manualUrl) ?? [];
  // Sin configurar y sin sitio manual: se muestran en el resultado como «Proveedor sin configurar» (no salen de la PC).
  const unconfigured = info?.providers.filter((p) => !p.auto && !p.configured && !p.manualUrl) ?? [];

  async function query(digits: string, provider: Provider, idx: number) {
    const pending: Row = { ...baseRow(provider), status: 'pending' };
    const setRow = (row: Row) => setResults((cur) => cur && cur.map((r, i) => (i !== idx ? r : { ...r, rows: [...r.rows.filter((x) => x.provider !== provider.id), row] })));
    setRow(pending);
    try {
      const res = await fetch('/api/imei/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imei: digits, provider: provider.id }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.status) throw new Error(data?.error ?? `Error ${res.status}`);
      setRow(data);
    } catch (e) {
      setRow({ ...pending, status: 'error', message: (e as Error).message, checkedAt: new Date().toISOString() });
    }
  }

  function baseRow(p: Provider): Row {
    return { provider: p.id, providerName: p.name, base: p.base, coverage: p.coverage, coversUruguay: p.coversUruguay, complementary: p.complementary,
      imei2Limited: !!p.imei2Limited, status: 'pending', reason: null, reportDate: null, checkedAt: new Date().toISOString(), message: null, model: null, retryCharges: p.retryCharges };
  }

  async function verify() {
    setTouched(true);
    if (!formOk || busy.current) return; // sin tráfico externo si el formato no es válido; sin doble clic
    busy.current = true; setRunning(true);
    const list = [v1.ok ? v1.digits : '', v2?.ok ? v2.digits : ''].filter(Boolean);
    setCheckedTwo(two); setManualForm(null);
    // Las fuentes manuales quedan pendientes hasta que el operador registre lo que vio en el sitio.
    setResults(list.map((d) => ({ digits: d, rows: manualSites.map((p) => ({ ...baseRow(p), status: 'manual_pending' as const, manual: true })) })));
    // En paralelo: cada respuesta aparece a medida que llega.
    await Promise.all(list.flatMap((d, i) => [...autoProviders, ...unconfigured].map((p) => query(d, p, i))));
    busy.current = false; setRunning(false);
  }

  async function retry(idx: number, provider: Provider) {
    const r = results?.[idx];
    if (!r || busy.current) return;
    if (provider.retryCharges && !confirm(`Reintentar en ${provider.name} puede tener costo. ¿Reintentar igual?`)) return;
    busy.current = true; setRunning(true);
    await query(r.digits, provider, idx);
    busy.current = false; setRunning(false);
  }

  function saveManual() {
    if (!manualForm || !results) return;
    const p = info?.providers.find((x) => x.id === manualForm.provider);
    if (!p) return;
    const row: Row = { ...baseRow(p), manual: true, status: manualForm.status, checkedAt: new Date().toISOString(),
      reportDate: manualForm.status === 'reported' || manualForm.status === 'history' ? manualForm.reportDate.trim().slice(0, 30) || null : null,
      reason: manualForm.reason.trim().slice(0, 120) || null, message: manualForm.status === 'error' ? 'El operador no pudo completar la consulta' : null };
    setResults((cur) => cur && cur.map((r, i) => (i !== manualForm.idx ? r : { ...r, rows: r.rows.map((x) => (x.provider === p.id ? row : x)) })));
    setManualForm(null);
  }
  async function copyImei(idx: number) {
    const d = results?.[idx]?.digits;
    if (!d) return;
    try { await navigator.clipboard.writeText(d); setCopied(idx); setTimeout(() => setCopied(null), 1500); } catch {}
  }

  const summaries = results?.map((r, i) => summarizeImei(r.rows, { imei2: i === 1 })) ?? [];
  const device = results ? summarizeDevice(summaries, checkedTwo) : null;
  const models = results?.flatMap((r) => r.rows.filter((x) => x.model).map((x) => x.model!)) ?? [];
  const tacModel = models[0] ?? null;
  const mismatch = !!tacModel && !!presented.trim() && !fold(presented).includes(fold(tacModel.model).replace(fold(tacModel.brand), ''));
  const isApple = /iphone|apple/i.test(presented) || /apple/i.test(tacModel?.brand ?? '');

  return (
    <div className="imei">
      <header className="page-head"><div><h1>{title}</h1><p className="sub">{subtitle ?? 'Consultá si un celular usado o en parte de pago figura reportado por robo, extravío u otro bloqueo.'}</p></div></header>
      <div className="imei-grid">
        <section className="imei-card">
          <h2><Icon name="barcode" size={20} className="accent" /> Datos del equipo</h2>
          <p className="imei-help"><Icon name="phone" size={16} /> Marcá <b>*#06#</b> en el celular para ver sus IMEI.</p>
          <ImeiField label="IMEI 1" value={imei1} onChange={setImei1} v={v1} show={touched || imei1.length > 0} />
          {two ? <>
            {v2 ? <ImeiField label="IMEI 2" value={imei2} onChange={setImei2} v={v2} show={touched || imei2.length > 0} extra={same ? 'Es el mismo número que el IMEI 1: cargá el segundo IMEI del equipo.' : undefined} />
              : <label className="imei-label">IMEI 2
                <input className="input imei-input" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={25} value={imei2} onChange={(e) => setImei2(e.target.value)} placeholder="15 dígitos" />
                <span className="muted small">Si el equipo tiene dos IMEI y no cargás el segundo, la revisión queda parcial.</span></label>}
            <button type="button" className="link" onClick={() => { setTwo(false); setImei2(''); }}>Quitar IMEI 2</button>
          </> : <button type="button" className="btn small-btn" onClick={() => setTwo(true)}><Icon name="plus" size={14} /> Agregar IMEI 2</button>}
          <label className="imei-label">Equipo presentado <span className="muted">(opcional, para comparar con el modelo asociado al IMEI)</span>
            <input className="input" maxLength={60} value={presented} onChange={(e) => setPresented(e.target.value)} placeholder="Ej.: iPhone 13 128 GB" /></label>

          <div className="imei-sources">
            <b>Se enviará el IMEI a:</b>
            {autoProviders.length ? <ul>{autoProviders.map((p) => <li key={p.id}>{p.name} <span className="muted">· {p.base}</span></li>)}</ul>
              : <p className="muted">Ninguna fuente automática configurada. El IMEI no sale de esta PC.</p>}
            {manualSites.length > 0 && <p className="muted small">Consulta manual (la hacés vos en el sitio): {manualSites.map((p) => p.name).join(' · ')}.</p>}
          </div>
          <button className="btn primary imei-go" onClick={verify} disabled={running}>
            <Icon name={running ? 'refresh' : 'shieldcheck'} size={17} className={running ? 'spin' : ''} /> {running ? 'Verificando…' : 'Verificar IMEI'}</button>
          {touched && !formOk && <p className="err small">Corregí el IMEI antes de verificar.</p>}
          <p className="muted small">La validación de la app solo comprueba el formato (15 dígitos y dígito de control). No muestra el IMEI completo en los resultados.</p>
        </section>

        <section className="imei-card">
          <h2><Icon name="shield" size={20} className="accent" /> Resultado</h2>
          {!results && <p className="muted">Ingresá el IMEI y tocá «Verificar IMEI».</p>}
          {device && (
            <div className={`imei-sum ${device.status}`}>
              <b>{IMEI_STATUS_LABEL[device.status]}</b>
              {device.needsReview && <span>Requiere revisión antes de comprar o tomar en parte de pago.</span>}
              {device.notes.map((n) => <span key={n}>{n}</span>)}
              {device.status === 'clean' && <small>El estado puede cambiar después de la consulta. No acredita propiedad, autenticidad ni ausencia de deudas o restricciones.</small>}
            </div>)}
          {results?.map((r, i) => {
            const s = summaries[i];
            return (
              <div key={i} className="imei-block">
                <div className="row"><b>IMEI {i + 1}</b><code>{maskImei(r.digits)}</code><span className={`imei-pill ${s.status}`}>{IMEI_STATUS_LABEL[s.status]}</span>
                  {s.needsReview && s.status !== 'reported' && <span className="imei-pill reported">Requiere revisión</span>}
                  {manualSites.length > 0 && <button type="button" className="link small" onClick={() => copyImei(i)} title="Copia el número para pegarlo en el sitio de consulta manual">{copied === i ? 'Copiado' : 'Copiar IMEI'}</button>}</div>
                {s.notes.map((n) => <p key={n} className="imei-note">{n}</p>)}
                <ul className="src-list">
                  {r.rows.map((x) => {
                    const p = info?.providers.find((y) => y.id === x.provider);
                    const failed = !x.manual && ['timeout', 'error', 'unexpected'].includes(x.status);
                    const editing = manualForm?.idx === i && manualForm.provider === x.provider;
                    const label = x.status === 'reported' && x.complementary ? 'Posible reporte · requiere revisión' : SOURCE_LABEL[x.status];
                    return (
                      <li key={x.provider} className={`src-item st-${x.status}`}>
                        <div className="src-head">
                          <b>{x.providerName}</b>
                          {x.manual && <span className="tag manual">{MANUAL_LABEL}</span>}
                          {x.complementary && <span className="tag comp">{COMPLEMENTARY_LABEL}</span>}
                          <span className={`src-st ${x.status}`}>{x.status === 'pending' && <Icon name="refresh" size={12} className="spin" />} {label}</span>
                        </div>
                        <div className="src-meta">
                          <span><i>Base</i> {x.base}</span>
                          <span><i>Cobertura</i> {x.coverage}{!x.coversUruguay && ' · Cobertura Uruguay no confirmada'}{i === 1 && x.imei2Limited && ' · Cobertura del IMEI 2 limitada'}</span>
                          {x.reason && <span><i>Motivo</i> {x.reason}</span>}
                          {x.reportDate && <span><i>Fecha del reporte</i> {x.reportDate}</span>}
                          {x.status !== 'pending' && x.status !== 'manual_pending' && <span><i>Consulta</i> {when(x.checkedAt)}</span>}
                        </div>
                        {x.message && <p className="src-msg">{x.message}</p>}
                        {x.status === 'tac_only' && x.model && <p className="src-msg">Modelo asociado al IMEI: {x.model.brand} {x.model.model}</p>}
                        {(failed || (x.manual && p?.manualUrl)) && (
                          <div className="imei-acts">
                            {failed && p && <button className="link" onClick={() => retry(i, p)} disabled={running}>{p.retryCharges ? 'Reintentar (puede tener costo)' : 'Reintentar'}</button>}
                            {x.manual && p?.manualUrl && <>
                              <a className="btn small-btn" href={p.manualUrl} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> {p.manualLabel ?? `Abrir ${p.name}`}</a>
                              <button className="link" onClick={() => setManualForm({ idx: i, provider: x.provider, status: x.status === 'manual_pending' ? 'clean' : x.status, reportDate: x.reportDate ?? '', reason: x.reason ?? '' })}>
                                {x.status === 'manual_pending' ? 'Registrar resultado' : 'Corregir'}</button></>}
                          </div>)}
                        {editing && (
                          <div className="imei-manual-form">
                            <div className="row wrap">
                              <label>Estado que muestra {x.providerName}
                                <select className="field-select" value={manualForm!.status} onChange={(e) => setManualForm({ ...manualForm!, status: e.target.value as SourceStatus })}>
                                  {MANUAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                              {(manualForm!.status === 'reported' || manualForm!.status === 'history') && <label>Fecha del reporte (si aparece)
                                <input className="input" maxLength={30} value={manualForm!.reportDate} onChange={(e) => setManualForm({ ...manualForm!, reportDate: e.target.value })} placeholder="Ej.: 2026-10-02" /></label>}
                              <label>Motivo (si aparece)
                                <input className="input" maxLength={120} value={manualForm!.reason} onChange={(e) => setManualForm({ ...manualForm!, reason: e.target.value })} placeholder="Ej.: Robo" /></label>
                            </div>
                            <div className="row"><button className="btn primary" onClick={saveManual}>Guardar</button><button className="link" onClick={() => setManualForm(null)}>Cancelar</button></div>
                            <small className="muted">Es una fuente complementaria: un reporte pide revisión; un «Sin reporte» no confirma la ausencia de reporte.</small>
                          </div>)}
                      </li>);
                  })}
                  <li className="src-item st-manual">
                    <div className="src-head"><b>Operadoras de Uruguay</b><span className="tag manual">{MANUAL_LABEL}</span><span className="src-st manual_pending">Consultar con la operadora</span></div>
                    <div className="src-meta"><span><i>Base</i> Lista negativa local</span><span><i>Cobertura</i> Uruguay · Cobertura Uruguay no confirmada</span></div>
                    <div className="imei-acts">{info?.operators.map((o) => <a key={o.name} className="btn small-btn" href={o.url} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> {o.name}</a>)}</div>
                  </li>
                </ul>
              </div>);
          })}
          {tacModel && <div className={`imei-model ${mismatch ? 'warn' : ''}`}><b>Modelo asociado al IMEI:</b> {tacModel.brand} {tacModel.model}
            {mismatch && <span> · No coincide con el equipo presentado: revisión manual.</span>}</div>}
          {results && isApple && (
            <div className="imei-apple">
              <b>iPhone: revisiones aparte</b>
              <ul><li>Bloqueo de activación: al configurar el equipo no debe pedir el Apple ID del dueño anterior.</li>
                <li>Bloqueo de operador: Ajustes → General → Información → «Bloqueo del operador» debe decir «Sin restricciones de SIM».</li></ul>
              <a href={info?.apple} target="_blank" rel="noreferrer">Guía de Apple para revisar un iPhone usado</a>
            </div>)}
        </section>
      </div>

      <section className="imei-card imei-provs">
        <h2><Icon name="list" size={20} className="accent" /> Fuentes</h2>
        <table className="imei-table">
          <thead><tr><th>Fuente</th><th>Base original</th><th>Cobertura</th><th>Tipos de reporte</th><th>Actualización</th><th>Uso y costo</th><th>Estado</th></tr></thead>
          <tbody>{info?.providers.map((p) => (
            <tr key={p.id}><td><a href={p.docs} target="_blank" rel="noreferrer">{p.name}</a>
                {p.complementary && <small className="tag comp">{COMPLEMENTARY_LABEL}</small>}
                {p.manualUrl && <small><a href={p.manualUrl} target="_blank" rel="noreferrer">{p.manualLabel ?? 'Abrir'}</a></small>}</td>
              <td>{p.base}</td><td>{p.coverage}{p.coversUruguay ? <small> · Uruguay confirmado{p.uyNote ? ` (${p.uyNote})` : ''}</small> : <small> · Uruguay no confirmada</small>}</td>
              <td>{p.reportTypes}</td><td>{p.update}</td><td>{p.terms}</td>
              <td><b>{p.status}</b>{!p.configured && <small className="muted"> {p.howTo}</small>}
                {p.configurable && isAdmin && <ProviderConfig p={p} onSaved={setInfo} />}</td></tr>))}
            <tr><td>Antel · Claro · Tigo</td><td>Lista negativa de Uruguay</td><td>Uruguay</td><td>Hurto y extravío denunciados</td><td>—</td><td>Atención manual de cada operadora</td>
              <td><b>Consultar con la operadora</b><small className="muted"> Sin acceso automático autorizado: se habilita si una operadora o un proveedor habilitado documenta el acceso.</small></td></tr>
          </tbody>
        </table>
        <p className="muted small">No se usan verificadores anónimos, formularios sin autorización de automatización ni servicios de desbloqueo. El verificador público de CTIA es solo para uso no comercial desde EE. UU.</p>
      </section>
    </div>
  );
}

function ImeiField({ label, value, onChange, v, show, extra }: { label: string; value: string; onChange: (s: string) => void; v: ReturnType<typeof validateImei>; show: boolean; extra?: string }) {
  const err = show ? (v.ok ? extra : v.error) : undefined;
  return (
    <label className="imei-label">{label}
      <input className={`input imei-input ${err ? 'bad' : v.ok && show ? 'ok' : ''}`} inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={25}
        value={value} onChange={(e) => onChange(e.target.value)} placeholder="15 dígitos" aria-invalid={!!err} />
      {err ? <span className="err small">{err}</span> : v.ok && show ? <span className="ok-txt small"><Icon name="check" size={13} /> Formato válido</span> : null}
    </label>
  );
}

/** Configuración del proveedor (solo administrador): la clave se guarda cifrada en esta PC y nunca se vuelve a mostrar. */
function ProviderConfig({ p, onSaved }: { p: Provider; onSaved: (i: ProvidersInfo) => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [uy, setUy] = useState(p.coversUruguay);
  const [note, setNote] = useState(p.uyNote ?? '');
  const [err, setErr] = useState('');
  async function save(body: object) {
    setErr('');
    const r = await fetch('/api/imei/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: p.id, ...body }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { setErr(j?.error ?? `Error ${r.status}`); return; }
    onSaved(j); setToken(''); setOpen(false);
  }
  if (!open) return <button className="link small" onClick={() => setOpen(true)}>{p.configured ? 'Cambiar configuración' : 'Configurar'}</button>;
  return (
    <div className="imei-config">
      <label>Clave de API de {p.name} {p.configured && <span className="muted">(ya hay una guardada; dejá vacío para conservarla)</span>}
        <input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Pegá la clave de la cuenta" /></label>
      <label className="check"><input type="checkbox" checked={uy} onChange={(e) => setUy(e.target.checked)} /> {p.name} confirmó por escrito la cobertura de operadores de Uruguay</label>
      {uy && <label>Quién lo confirmó y cuándo<input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: correo de soporte del 20/11/2026" /></label>}
      {err && <span className="err small">{err}</span>}
      <div className="row">
        <button className="btn primary" onClick={() => save({ ...(token.trim() ? { apiToken: token } : {}), coversUruguay: uy, uyNote: note })}>Guardar</button>
        {p.configured && <button className="link" onClick={() => { if (confirm(`¿Quitar la clave de ${p.name} de esta PC?`)) void save({ apiToken: '', coversUruguay: false, uyNote: '' }); }}>Quitar clave</button>}
        <button className="link" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}

export type { ImeiStatus };
