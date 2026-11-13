import { useEffect, useMemo, useState } from 'react';
import { ANTUTU_VERSIONS, BENCH_SOURCES, type Benchmark, type CompareModel, type Settings, type SpecStatus } from '../../shared/types.ts';
import { buildComparison } from '../../shared/compare.ts';
import { api } from '../api.ts';
import { money } from '../format.ts';
import { Icon } from '../icons.tsx';
import { SpecEditor, AllSpecs, StatusTag } from './ProductSheet.tsx';
import { useIsAdmin } from '../session.ts';
import { iosSupport, IOS_SOURCE } from '../../shared/iosSupport.ts';

type Candidate = Awaited<ReturnType<typeof api.compareCandidates>>[number];
const MAX = 3;
const nf = (n: number) => n.toLocaleString('es-UY');
const name = (m: { brand: string; model: string }) => (m.brand === 'Apple' ? m.model : `${m.brand} ${m.model}`);

/** Búsquedas en fuentes confiables (se abren en el navegador; no se copia nada automáticamente). */
const sourceLinks = (m: { brand: string; model: string }) => {
  const q = encodeURIComponent(`${m.brand} ${m.model}`);
  return [
    { label: 'AnTuTu ranking', url: 'https://www.antutu.com/web/ranking' },
    { label: 'Kimovil', url: `https://www.google.com/search?q=site%3Akimovil.com+${q}+antutu` },
    { label: 'GSMArena', url: `https://www.gsmarena.com/res.php3?sSearch=${q}` },
    { label: 'Nanoreview', url: `https://www.google.com/search?q=site%3Ananoreview.net+${q}` },
  ];
};

// Filas principales del comparador (diseño del cliente). Los valores salen de la ficha con fuente; nunca se estiman.
const normKey = (k: string) => k.trim().toLowerCase();
const specOf = (m: CompareModel, key: string) => m.specs.find((s) => normKey(s.key) === normKey(key))?.value ?? null;
const ST_ORDER: SpecStatus[] = ['sin_confirmar', 'depende_variante', 'no_compatible', 'no_aplica'];
/** Estado a mostrar en una fila que combina varios datos: el menos firme. */
const statusOf = (m: CompareModel, keys: string[]): SpecStatus | null => {
  const st = keys.map((k) => m.specs.find((s) => normKey(s.key) === normKey(k))).filter(Boolean).map((s) => s!.status ?? 'sin_confirmar');
  if (!st.length) return null;
  return ST_ORDER.find((x) => st.includes(x)) ?? 'verificado';
};
const numOf = (v: string | null, re: RegExp) => {
  const x = v?.replace(/(\d)\.(\d{3})/g, '$1$2').match(re);
  return x ? Number(x[1].replace(',', '.')) : null;
};
type MainRow = { label: string; keys: string[]; value: (m: CompareModel) => string | null; sub?: (m: CompareModel) => string | null; best?: RegExp };
const MAIN_ROWS: MainRow[] = [
  { label: 'Procesador', keys: ['Procesador'], value: (m) => specOf(m, 'Procesador') },
  { label: 'Pantalla', keys: ['Tamaño y tipo', 'Frecuencia', 'Resolución'],
    value: (m) => [specOf(m, 'Tamaño y tipo'), specOf(m, 'Frecuencia')].filter(Boolean).join(' · ') || null, sub: (m) => specOf(m, 'Resolución') },
  { label: 'Batería', keys: ['Batería'], value: (m) => specOf(m, 'Batería'), best: /(\d+)\s*mah/i },
  { label: 'Carga', keys: ['Carga rápida'], value: (m) => specOf(m, 'Carga rápida'), best: /(\d+(?:[.,]\d+)?)\s*w/i },
  { label: 'Cámara principal', keys: ['Cámara principal'], value: (m) => specOf(m, 'Cámara principal') },
  { label: 'RAM', keys: ['RAM'], value: (m) => specOf(m, 'RAM') },
  { label: 'Almacenamiento', keys: ['Almacenamiento'], value: (m) => specOf(m, 'Almacenamiento') },
  { label: 'Actualizaciones', keys: ['Años de actualizaciones'],
    value: (m) => iosSupport(m.brand, m.model)?.label ?? specOf(m, 'Años de actualizaciones'), sub: (m) => iosSupport(m.brand, m.model)?.estimate ?? null },
  { label: 'Red móvil', keys: ['5G'], value: (m) => { const v = specOf(m, '5G'); return !v ? null : /^s[ií]/i.test(v) ? '5G' : /^no/i.test(v) ? 'Sin 5G' : v; } },
];
const MAIN_KEYS = new Set(MAIN_ROWS.flatMap((r) => r.keys.map(normKey)));
const differs = (vals: (string | null)[]) => vals.some((v) => v === null) || new Set(vals.map((v) => v!.trim().toLowerCase())).size > 1;

export function Compare({ settings }: { settings: Settings | null }) {
  const admin = useIsAdmin();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [ids, setIds] = useState<number[]>(() => {
    try { return (JSON.parse(localStorage.getItem('compare.ids') ?? '[]') as number[]).slice(0, MAX); } catch { return []; }
  });
  const [models, setModels] = useState<CompareModel[]>([]);
  const [adding, setAdding] = useState(false);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showBench, setShowBench] = useState(false);
  const [benchFor, setBenchFor] = useState<CompareModel | null>(null);
  const [specsFor, setSpecsFor] = useState<CompareModel | null>(null);
  const [newModel, setNewModel] = useState(false);
  const [error, setError] = useState('');

  const loadCandidates = () => api.compareCandidates(false).then(setCandidates).catch((e) => setError(e.message));
  const loadModels = () => {
    try { localStorage.setItem('compare.ids', JSON.stringify(ids)); } catch {}
    if (!ids.length) { setModels([]); return; }
    api.compare(ids).then(setModels).catch((e) => { setError(e.message); setIds([]); });
  };
  useEffect(() => { loadCandidates(); }, []);
  useEffect(loadModels, [ids]);

  const cmp = useMemo(() => buildComparison(models, settings?.usdRate ?? null), [models, settings?.usdRate]);
  const add = (id: number) => { if (!ids.includes(id) && ids.length < MAX) setIds([...ids, id]); setAdding(false); };
  const refresh = () => { loadModels(); loadCandidates(); };
  const a = cmp.antutu;
  // Ventaja del mejor sobre el segundo (solo si los puntajes son comparables).
  const lead = (() => {
    if (!a.comparable || a.best === null) return null;
    const totals = a.entries.map((b) => b?.total ?? 0).sort((x, y) => y - x);
    return totals[1] ? Math.round((totals[0] / totals[1] - 1) * 100) : null;
  })();
  // Barras de AnTuTu de mayor a menor puntaje; los modelos sin dato van al final.
  const byScore = models.map((_, i) => i).sort((x, y) => (a.entries[y]?.total ?? -1) - (a.entries[x]?.total ?? -1));
  const benchSources = [...new Set(a.entries.filter(Boolean).map((b) => b!.sourceName))];
  const mainRows = MAIN_ROWS.map((r) => {
    const values = models.map(r.value);
    const nums = r.best ? values.map((v) => numOf(v, r.best!)) : [];
    const max = nums.length && nums.every((n) => n !== null) && new Set(nums).size > 1 ? Math.max(...(nums as number[])) : null;
    const sts = models.map((m) => (r.label === 'Actualizaciones' && iosSupport(m.brand, m.model) ? 'verificado' : statusOf(m, r.keys)));
    return { ...r, values, sts, subs: r.sub ? models.map(r.sub) : null, win: nums.map((n) => max !== null && n === max), diff: differs(values) };
  }).filter((r) => r.values.some(Boolean) && (!onlyDiff || r.diff));
  const otherRows = cmp.rows.filter((r) => !MAIN_KEYS.has(normKey(r.key)) && (!onlyDiff || r.differs));
  const cols = { gridTemplateColumns: `minmax(96px, .8fr) repeat(${Math.max(models.length, 1)}, minmax(110px, 1fr))` };
  const fichas = models.map((m) => ({ m, url: m.specs.find((s) => s.sourceUrl)?.sourceUrl ?? null })).filter((x) => x.url);

  return (
    <div className="cmp2">
      <header className="page-head">
        <div><h1>Comparador</h1><p className="sub">Compará las especificaciones y el rendimiento de hasta {MAX} celulares.</p></div>
        <button className="btn primary" disabled={ids.length >= MAX} onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Agregar modelo</button>
      </header>
      {error && <p className="error">{error}</p>}

      <div className="cmp2-title"><h2>Modelos seleccionados</h2><span className="muted">{models.length} de {MAX}</span></div>
      <div className="cmp2-models">
        {models.map((m, i) => (
          <article key={m.modelId} className={`cmp2-model ${a.best === i ? 'on' : ''}`}>
            <div className="cmp2-photo">{m.photoUrl ? <img src={m.photoUrl} alt="" /> : <Icon name="phone" size={34} />}</div>
            <div className="cmp2-info">
              <h3>{name(m)}</h3>
              <div className={`cmp2-stock ${m.stock ? 'in' : ''}`}><i />{m.stock ? `En stock (${m.stock})` : 'Sin stock'}
                {m.priceFrom && <span> · desde {money(m.priceFrom.price, m.priceFrom.currency)}</span>}</div>
              <button className="btn small-btn" onClick={() => setSpecsFor(m)}><Icon name="doc" size={14} /> Ver ficha</button>
            </div>
            <button className="cmp2-x" onClick={() => setIds(ids.filter((x) => x !== m.modelId))} aria-label={`Quitar ${name(m)}`}><Icon name="x" size={14} /></button>
          </article>))}
        {models.length < MAX && (
          <button className="cmp2-model add" onClick={() => setAdding(true)}><Icon name="plus" size={22} /><span>Agregar modelo</span></button>)}
      </div>

      {models.length < 2 ? (
        <div className="empty"><Icon name="layers" size={36} /><p>Elegí al menos 2 modelos para comparar.</p></div>
      ) : (<>
        <section className="cmp2-panel">
          <div className="cmp2-head">
            <span className="cmp2-ico"><Icon name="pulse" size={18} /></span>
            <h2>Rendimiento AnTuTu</h2>{a.version && <span className="cmp2-ver">{a.version.toUpperCase()}</span>}
            {lead !== null && a.best !== null && <span className="cmp2-lead"><Icon name="trend" size={16} /> +{lead}% <b>{name(models[a.best])}</b></span>}
          </div>
          {a.warnings.map((w) => <div key={w} className="banner">{w}</div>)}
          <div className="cmp2-bars">
            {byScore.map((i) => {
              const m = models[i]; const b = a.entries[i];
              return (
                <div key={m.modelId} className="cmp2-bar">
                  <span className="cmp2-bar-name">{name(m)}</span>
                  {b ? <>
                    <div className="cmp2-track"><div className={a.best === i ? 'best' : ''} style={{ width: `${a.pct[i]}%` }} /></div>
                    <b className="cmp2-bar-val">{nf(b.total)}</b>
                  </> : <><div className="cmp2-track empty"><span className="muted small">Sin datos</span></div>
                    {admin && <button className="link" onClick={() => setBenchFor(m)}>Cargar puntaje</button>}</>}
                </div>);
            })}
          </div>
          <div className="cmp2-foot">
            <span className="muted small">{benchSources.length ? `Fuente: ${benchSources.join(', ')}` : 'Sin fuente'}</span>
            <button className="link" onClick={() => setShowBench(!showBench)}>{showBench ? 'Ocultar desglose' : 'Ver desglose y fuentes'}</button>
          </div>
          {showBench && (
            <div className="cmp2-detail">
              {byScore.map((i) => {
                const m = models[i]; const b = a.entries[i];
                return (
                  <div key={m.modelId} className="cmp2-detail-row">
                    <b>{name(m)}</b>
                    {b ? <span className="muted small">
                      {[b.cpu && `CPU ${nf(b.cpu)}`, b.gpu && `GPU ${nf(b.gpu)}`, b.mem && `MEM ${nf(b.mem)}`, b.ux && `UX ${nf(b.ux)}`].filter(Boolean).join(' · ')}
                      {' '}· {b.sourceUrl ? <a href={b.sourceUrl} target="_blank" rel="noreferrer">{b.sourceName}</a> : b.sourceName} · {b.measuredAt}{b.variant && ` · ${b.variant}`}{b.sample && ` · ${b.sample === 'promedio' ? 'promedio' : 'medición individual'}`}
                    </span> : <span className="muted small">Sin puntaje cargado</span>}
                    {admin && <button className="link" onClick={() => setBenchFor(m)}>{b ? 'Editar' : 'Cargar'}</button>}
                  </div>);
              })}
            </div>)}
        </section>

        <section className="cmp2-panel">
          <div className="cmp2-head">
            <span className="cmp2-ico"><Icon name="list" size={18} /></span><h2>Especificaciones</h2>
            <label className="cmp2-check"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Solo diferencias</label>
          </div>
          <div className="cmp2-table">
            <div className="cmp2-tr th" style={cols}><div>Característica</div>{models.map((m) => <div key={m.modelId}>{name(m)}</div>)}</div>
            {mainRows.map((r) => (
              <div key={r.label} className="cmp2-tr" style={cols}>
                <div className="cmp2-k">{r.label}</div>
                {r.values.map((v, i) => (
                  <div key={i} className={`${v ? '' : 'muted'} ${r.win[i] ? 'win' : ''}`}>{v ?? 'Sin datos (pendiente)'}
                    {v && r.sts[i] && r.sts[i] !== 'verificado' && <> <StatusTag status={r.sts[i]!} /></>}
                    {r.subs?.[i] && <small>{r.subs[i]}</small>}</div>))}
              </div>))}
            {showAll && otherRows.map((r) => (
              <div key={`${r.group}|${r.key}`} className="cmp2-tr" style={cols}>
                <div className="cmp2-k">{r.key}</div>
                {r.values.map((v, i) => { const sp = models[i].specs.find((s) => normKey(s.key) === normKey(r.key));
                  return <div key={i} className={v ? '' : 'muted'}>{v ?? 'Sin datos (pendiente)'}{sp && sp.status !== 'verificado' && <> <StatusTag status={sp.status} /></>}</div>; })}
              </div>))}
            {!mainRows.length && !(showAll && otherRows.length) && <p className="muted" style={{ padding: 14 }}>{onlyDiff ? 'No hay diferencias en estas características.' : 'Ningún modelo tiene ficha cargada. Usá «Ver ficha».'}</p>}
          </div>
          <div className="cmp2-foot">
            <span className="muted small">{fichas.length > 0 && <>Fuentes de las fichas: {fichas.map((x) => <a key={x.m.modelId} href={x.url!} target="_blank" rel="noreferrer">{name(x.m)}</a>)}</>}
              <span className="cmp2-legend">Datos sin etiqueta = verificados · <StatusTag status="sin_confirmar" /> <StatusTag status="depende_variante" /> <StatusTag status="no_compatible" /> · «Sin datos» = pendiente de investigar</span><br />
              {models.some((m) => iosSupport(m.brand, m.model)) && <> · Actualizaciones: <a href={IOS_SOURCE.url} target="_blank" rel="noreferrer">{IOS_SOURCE.name}</a> (el «hasta» es estimado)</>}</span>
            {otherRows.length > 0 && <button className="link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Ver menos' : `Ver todas (${otherRows.length} más)`}</button>}
          </div>
        </section>

        <section className="cmp2-panel">
          <div className="cmp2-head"><span className="cmp2-ico"><Icon name="star" size={18} /></span><h2>¿Cuál conviene?</h2></div>
          <ul className="cmp2-summary">{cmp.summary.map((t) => <li key={t}>{t}</li>)}</ul>
          <p className="muted small" style={{ margin: 0 }}>Calculado solo con los datos cargados (precios del catálogo y puntajes con fuente). No reemplaza la prueba del equipo.</p>
        </section>
      </>)}

      {adding && <AddModel candidates={candidates} ids={ids} onClose={() => setAdding(false)} onAdd={add}
        onImported={async (id) => { await loadCandidates(); add(id); }} onManual={admin ? () => { setAdding(false); setNewModel(true); } : undefined} />}
      {benchFor && <BenchForm model={benchFor} onClose={() => setBenchFor(null)} onSaved={() => { setBenchFor(null); refresh(); }} />}
      {specsFor && (
        <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && setSpecsFor(null)}>
          <div className="modal"><div className="row"><h2 style={{ margin: 0, flex: 1 }}>Ficha: {name(specsFor)}</h2>
            <button className="icon-btn" onClick={() => setSpecsFor(null)}><Icon name="x" size={18} /></button></div>
            {admin ? <>
              <div className="row small" style={{ margin: '8px 0' }}>Buscar datos en: {sourceLinks(specsFor).map((l) => <a key={l.label} href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}</div>
              <SpecEditor modelId={specsFor.modelId} initial={specsFor.specs} onSaved={() => { setSpecsFor(null); refresh(); }} />
            </> : specsFor.specs.length ? <AllSpecs specs={specsFor.specs} /> : <p className="muted">Este modelo no tiene ficha cargada.</p>}
          </div>
        </div>)}
      {newModel && <NewModel onClose={() => setNewModel(false)} onCreated={(id) => { setNewModel(false); loadCandidates(); add(id); }} />}
    </div>
  );
}

/** Ventana «Agregar modelo»: busca en la app y en internet (Nanoreview). */
function AddModel({ candidates, ids, onClose, onAdd, onImported, onManual }: {
  candidates: Candidate[]; ids: number[]; onClose: () => void; onAdd: (id: number) => void; onImported: (id: number) => Promise<void>; onManual?: () => void;
}) {
  const [q, setQ] = useState('');
  const [online, setOnline] = useState<{ slug: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setOnline(null);
    if (q.trim().length < 3) return;
    const t = setTimeout(() => api.lookup(q).then(setOnline).catch((e) => { setOnline([]); setError(e.message); }), 450);
    return () => clearTimeout(t);
  }, [q]);
  const local = candidates.filter((c) => !ids.includes(c.modelId) && name(c).toLowerCase().includes(q.toLowerCase()));
  async function importOnline(slug: string) {
    setBusy(slug); setError('');
    try { await onImported((await api.lookupImport(slug)).modelId); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal cmp2-add">
        <div className="row"><h2 style={{ margin: 0, flex: 1 }}>Agregar modelo</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="x" size={18} /></button></div>
        <div className="searchbar inline"><Icon name="search" size={18} />
          <input autoFocus placeholder="Buscá marca o modelo…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <ul className="cmp2-list">
          {(q ? local.slice(0, 8) : local.slice(0, 6)).map((c) => (
            <li key={c.modelId} onClick={() => onAdd(c.modelId)}>
              <Icon name="phone" size={16} /><b>{name(c)}</b>
              <span className="muted small">{c.specs} specs · {c.benches ? 'AnTuTu ✓' : 'sin AnTuTu'}</span></li>))}
          {q && !local.length && <li className="muted static">No está en la app.</li>}
          {q.trim().length >= 3 && <li className="sep static">Buscar en internet (Nanoreview)</li>}
          {online === null && q.trim().length >= 3 && <li className="muted static">Buscando…</li>}
          {online?.filter((o) => !candidates.some((c) => name(c).toLowerCase() === o.name.toLowerCase())).map((o) => (
            <li key={o.slug} onClick={() => !busy && importOnline(o.slug)}>
              <Icon name="search" size={16} /><b>{o.name}</b>
              <span className="muted small">{busy === o.slug ? 'Descargando ficha…' : 'traer ficha + AnTuTu'}</span></li>))}
          {online && !online.length && <li className="muted static">Sin resultados en internet.</li>}
        </ul>
        {error && <p className="error">{error}</p>}
        {onManual && <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <span className="muted small">¿No aparece? Cargalo a mano y completá la ficha.</span>
          <button className="btn ghost" onClick={onManual}><Icon name="plus" size={14} /> Modelo manual</button>
        </div>}
      </div>
    </div>
  );
}

function BenchForm({ model, onClose, onSaved }: { model: CompareModel; onClose: () => void; onSaved: () => void }) {
  const existing = model.benchmarks[0];
  const [f, setF] = useState<any>(() => ({
    version: existing?.version ?? 'v11', platform: existing?.platform ?? (model.brand.toLowerCase() === 'apple' ? 'ios' : 'android'),
    total: existing?.total ?? '', cpu: existing?.cpu ?? '', gpu: existing?.gpu ?? '', mem: existing?.mem ?? '', ux: existing?.ux ?? '',
    variant: existing?.variant ?? '', sourceName: existing?.sourceName ?? BENCH_SOURCES[0], sourceUrl: existing?.sourceUrl ?? '',
    measuredAt: new Date().toISOString().slice(0, 10), notes: existing?.notes ?? '',
  }));
  const [error, setError] = useState('');
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError('');
    try { await api.saveBenchmark(model.modelId, f); onSaved(); } catch (err) { setError((err as Error).message); }
  }
  async function remove(b: Benchmark) {
    if (!confirm(`¿Borrar AnTuTu ${b.version} de ${name(model)}?`)) return;
    await api.deleteBenchmark(b.id!); onSaved();
  }

  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={save}>
        <h2 style={{ marginTop: 0 }}>AnTuTu — {name(model)}</h2>
        <div className="row small" style={{ marginBottom: 10 }}>Buscar en: {sourceLinks(model).map((l) => <a key={l.label} href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}</div>
        <p className="muted small" style={{ marginTop: 0 }}>Copiá el puntaje tal cual figura en la fuente. V10 y V11 usan escalas distintas: elegí la versión correcta.</p>
        <div className="form">
          <label>Versión de AnTuTu<select className="input" value={f.version} onChange={set('version')}>{ANTUTU_VERSIONS.map((v) => <option key={v} value={v}>{v.toUpperCase()}</option>)}</select></label>
          <label>Plataforma<select className="input" value={f.platform} onChange={set('platform')}><option value="android">Android</option><option value="ios">iOS</option></select></label>
          <label className="full">Puntaje total *<input className="input" type="number" min={1} required value={f.total} onChange={set('total')} placeholder="Ej.: 1850000" /></label>
          <label>CPU<input className="input" type="number" min={1} value={f.cpu} onChange={set('cpu')} /></label>
          <label>GPU<input className="input" type="number" min={1} value={f.gpu} onChange={set('gpu')} /></label>
          <label>MEM<input className="input" type="number" min={1} value={f.mem} onChange={set('mem')} /></label>
          <label>UX<input className="input" type="number" min={1} value={f.ux} onChange={set('ux')} /></label>
          <label>Fuente *<select className="input" value={BENCH_SOURCES.includes(f.sourceName) ? f.sourceName : 'Otra'} onChange={set('sourceName')}>{BENCH_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Fecha (medición o consulta) *<input className="input" type="date" required value={f.measuredAt} onChange={set('measuredAt')} /></label>
          <label className="full">URL de la fuente<input className="input" value={f.sourceUrl} onChange={set('sourceUrl')} placeholder="https://…" /></label>
          <label>Variante medida<input className="input" value={f.variant} onChange={set('variant')} placeholder="Ej.: 12 GB + 256 GB" /></label>
          <label>Notas<input className="input" value={f.notes} onChange={set('notes')} /></label>
        </div>
        {model.benchmarks.length > 0 && <div className="small" style={{ marginTop: 12 }}>Cargados: {model.benchmarks.map((b) => (
          <span key={b.id} className="badge" style={{ marginRight: 6 }}>{b.version.toUpperCase()} {nf(b.total)} <button type="button" className="link" onClick={() => remove(b)}>borrar</button></span>))}</div>}
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary">Guardar puntaje</button>
        </div>
      </form>
    </div>
  );
}

function NewModel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" style={{ width: 'min(460px, 96%)' }} onSubmit={async (e) => {
        e.preventDefault();
        try { onCreated((await api.createModel(brand, model)).modelId); } catch (err) { setError((err as Error).message); }
      }}>
        <h2 style={{ marginTop: 0 }}>Modelo sin stock</h2>
        <p className="muted small">Para comparar un equipo que todavía no tenés en el catálogo (sin precio).</p>
        <div className="form">
          <label>Marca *<input className="input" required value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
          <label>Modelo *<input className="input" required value={model} onChange={(e) => setModel(e.target.value)} /></label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary">Crear y comparar</button>
        </div>
      </form>
    </div>
  );
}
