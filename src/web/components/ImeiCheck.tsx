// IMEI Check: el personal ingresa el IMEI (o los dos) de un celular usado o en parte de pago y ve, por cada IMEI
// y fuente, si figura reportado. La validación de formato es local; las consultas las hace el servidor.
import { useEffect, useRef, useState } from 'react';
import { validateImei, maskImei, summarizeImei, summarizeDevice, IMEI_STATUS_LABEL, type SourceResult, type ImeiStatus } from '../../shared/imei.ts';
import { Icon } from '../icons.tsx';

interface Provider { id: string; name: string; base: string; coverage: string; coversUruguay: boolean; configured: boolean; auto: boolean;
  retryCharges: boolean; reportTypes: string; update: string; terms: string; docs: string; howTo: string; status: string }
interface ProvidersInfo { providers: Provider[]; operators: { name: string; url: string }[]; apple: string; timeoutSeconds: number }
type Row = SourceResult & { imei?: string };

const SOURCE_LABEL: Record<string, string> = {
  reported: 'Reporte activo', clean: 'Sin reporte', history: 'Antecedente (reporte retirado)', not_configured: 'Proveedor sin configurar',
  timeout: 'Sin respuesta (tiempo agotado)', error: 'Error del proveedor', unexpected: 'Respuesta inesperada', pending: 'Consultando…',
};
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
  const busy = useRef(false);

  useEffect(() => { fetch('/api/imei/providers').then((r) => r.json()).then(setInfo).catch(() => {}); }, []);

  const v1 = validateImei(imei1);
  const v2 = two ? validateImei(imei2) : null;
  const same = v1.ok && v2?.ok && v1.digits === v2.digits;
  const formOk = v1.ok && (!two || (v2?.ok && !same));
  const autoProviders = info?.providers.filter((p) => p.auto) ?? [];
  const manualProviders = info?.providers.filter((p) => !p.auto) ?? [];

  async function query(digits: string, provider: Provider, idx: number) {
    const pending: Row = { provider: provider.id, providerName: provider.name, base: provider.base, coverage: provider.coverage, coversUruguay: provider.coversUruguay,
      status: 'pending', reason: null, reportDate: null, checkedAt: new Date().toISOString(), message: null, model: null, retryCharges: provider.retryCharges };
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

  async function verify() {
    setTouched(true);
    if (!formOk || busy.current) return; // sin tráfico externo si el formato no es válido; sin doble clic
    busy.current = true; setRunning(true);
    const list = [v1.ok ? v1.digits : '', two && v2?.ok ? v2.digits : ''].filter(Boolean);
    setCheckedTwo(two);
    setResults(list.map((d) => ({ digits: d, rows: [] })));
    // En paralelo: cada respuesta aparece a medida que llega.
    await Promise.all(list.flatMap((d, i) => [...autoProviders, ...manualProviders.filter((p) => !p.configured)].map((p) => query(d, p, i))));
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

  const summaries = results?.map((r) => summarizeImei(r.rows)) ?? [];
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
            <ImeiField label="IMEI 2" value={imei2} onChange={setImei2} v={v2!} show={touched || imei2.length > 0} extra={same ? 'Es el mismo número que el IMEI 1.' : undefined} />
            <button type="button" className="link" onClick={() => { setTwo(false); setImei2(''); }}>Quitar IMEI 2</button>
          </> : <button type="button" className="btn small-btn" onClick={() => setTwo(true)}><Icon name="plus" size={14} /> Agregar IMEI 2</button>}
          <label className="imei-label">Equipo presentado <span className="muted">(opcional, para comparar con el modelo asociado al IMEI)</span>
            <input className="input" maxLength={60} value={presented} onChange={(e) => setPresented(e.target.value)} placeholder="Ej.: iPhone 13 128 GB" /></label>

          <div className="imei-sources">
            <b>Se enviará el IMEI a:</b>
            {autoProviders.length ? <ul>{autoProviders.map((p) => <li key={p.id}>{p.name} <span className="muted">· {p.base}</span></li>)}</ul>
              : <p className="muted">Ninguna fuente automática configurada. El IMEI no sale de esta PC.</p>}
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
                <div className="row"><b>IMEI {i + 1}</b><code>{maskImei(r.digits)}</code><span className={`imei-pill ${s.status}`}>{IMEI_STATUS_LABEL[s.status]}</span></div>
                {s.notes.map((n) => <p key={n} className="imei-note">{n}</p>)}
                <table className="imei-table">
                  <thead><tr><th>Proveedor</th><th>Base</th><th>Cobertura</th><th>Estado</th><th>Motivo</th><th>Fecha del reporte</th><th>Consulta</th><th /></tr></thead>
                  <tbody>
                    {r.rows.map((x) => {
                      const p = info?.providers.find((y) => y.id === x.provider);
                      const failed = ['timeout', 'error', 'unexpected'].includes(x.status);
                      return (
                        <tr key={x.provider} className={`st-${x.status}`}>
                          <td>{x.providerName}</td><td>{x.base}</td><td>{x.coverage}{!x.coversUruguay && <small> · Cobertura Uruguay no confirmada</small>}</td>
                          <td><span className={`src-st ${x.status}`}>{x.status === 'pending' && <Icon name="refresh" size={12} className="spin" />} {SOURCE_LABEL[x.status]}</span>
                            {x.message && <small className="muted"> {x.message}</small>}</td>
                          <td>{x.reason ?? '—'}</td><td>{x.reportDate ?? '—'}</td><td>{x.status === 'pending' ? '…' : when(x.checkedAt)}</td>
                          <td>{failed && p && <button className="link" onClick={() => retry(i, p)} disabled={running}>{p.retryCharges ? 'Reintentar (puede tener costo)' : 'Reintentar'}</button>}</td>
                        </tr>);
                    })}
                    <tr className="st-manual"><td>Operadoras de Uruguay</td><td>Lista negativa local</td><td>Uruguay · Cobertura Uruguay no confirmada</td>
                      <td colSpan={5}>Consultar con la operadora: {info?.operators.map((o, k) => <span key={o.name}>{k ? ' · ' : ''}<a href={o.url} target="_blank" rel="noreferrer">{o.name}</a></span>)}</td></tr>
                  </tbody>
                </table>
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
            <tr key={p.id}><td><a href={p.docs} target="_blank" rel="noreferrer">{p.name}</a></td><td>{p.base}</td><td>{p.coverage}{!p.coversUruguay && <small> · Uruguay no confirmada</small>}</td>
              <td>{p.reportTypes}</td><td>{p.update}</td><td>{p.terms}</td>
              <td><b>{p.status}</b>{!p.configured && <small className="muted"> {p.howTo}</small>}</td></tr>))}
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

export type { ImeiStatus };
