// Sección «Cargar productos»: nombre + precio + foto → ficha y descripción automáticas → repo de GitHub.
import { useEffect, useRef, useState } from 'react';
import type { Product, Settings } from '../../shared/types.ts';
import { api, fileToDataUrl } from '../api.ts';
import { num } from '../format.ts';
import { Icon } from '../icons.tsx';
import { useCovers } from '../covers.ts';
import { normalizeModelName } from '../../shared/covers.ts';
import { cancelJob, isActive, linkJob, requestCover, useCoverJobs, type CoverJob } from '../coverJobs.ts';

type Match = { slug: string; name: string; brand: string; model: string; url: string; specs: { group: string; key: string; value: string; highlight: boolean }[];
  antutu: { version: string; total: number } | null; description: string };
const EMPTY = { id: '', name: '', price: '', currency: 'USD', condition: 'nuevo', description: '' }; // El precio se guarda siempre en dólares.
const PAGE = 6;
const CONDITIONS = [['nuevo', 'Nuevo'], ['usado', 'CPO']] as const;
const condLabel = (c: string) => (c === 'nuevo' ? 'Nuevo' : 'CPO');
const memLabel = (p: Pick<Product, 'ramGb' | 'storageGb'>) =>
  p.storageGb ? (p.storageGb >= 1024 ? `${p.storageGb / 1024} TB` : `${p.storageGb} GB`) + (p.ramGb ? ` · ${p.ramGb} GB RAM` : '') : p.ramGb ? `${p.ramGb} GB RAM` : '';

export function QuickAdd({ settings }: { settings: Settings | null }) {
  const cover = useCovers();
  const rate = settings?.usdRate || null;
  const [f, setF] = useState<any>({ ...EMPTY });
  const [photo, setPhoto] = useState<string | null | undefined>(undefined); // undefined = sin cambios, null = quitar la propia
  const [hasOwnPhoto, setHasOwnPhoto] = useState(false); // al editar: el producto ya tiene foto propia
  const [match, setMatch] = useState<Match | null>(null);
  const [cands, setCands] = useState<{ slug: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [pesos, setPesos] = useState<string | null>(null); // null = se muestra el equivalente; texto = se está escribiendo en pesos
  const [descOpen, setDescOpen] = useState(false);
  const [msg, setMsg] = useState(''); const [error, setError] = useState('');
  const [list, setList] = useState<Product[]>([]);
  const [repo, setRepo] = useState<Awaited<ReturnType<typeof api.repoStatus>> | null>(null);
  const descTouched = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [cond, setCond] = useState('');
  const [page, setPage] = useState(0);
  const [menu, setMenu] = useState<number | null>(null);
  // «Buscar imagen»
  const jobs = useCoverJobs();
  const [jobId, setJobId] = useState<string | null>(null);
  const [coverNote, setCoverNote] = useState<{ cls: string; text: string; retry?: boolean } | null>(null);
  const [variantChosen, setVariantChosen] = useState(false);
  const candRef = useRef<HTMLSelectElement>(null);
  const job = jobId ? jobs.find((j) => j.id === jobId) ?? null : null;

  // Búsqueda en la lista de cargados: marca, modelo, memoria y condición.
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const shown = list.filter((p) => (!cond || p.condition === cond)
    && norm(`${p.brand} ${p.model} ${p.ramGb ?? ''}/${p.storageGb ?? ''} ${p.storageGb ?? ''}gb ${condLabel(p.condition)}`).includes(norm(q.trim())));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const rows = shown.slice(pg * PAGE, pg * PAGE + PAGE);
  /** Búsqueda de portada de un producto de la lista: la vinculada al producto o la de su modelo. */
  const jobFor = (p: Product) => {
    const mine = jobs.filter((j) => j.productRepoId === p.repoId || (j.brand.toLowerCase() === p.brand.toLowerCase() && normalizeModelName(j.model) === normalizeModelName(p.model)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return mine.find(isActive) ?? mine[0] ?? null;
  };
  useEffect(() => setPage(0), [q, cond]);

  const load = () => { api.products({}).then((l) => setList(l.filter((p) => p.repoId))).catch(() => {}); api.repoStatus().then(setRepo).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (menu === null) return; const close = () => setMenu(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, [menu]);

  async function search(slug?: string) {
    if (f.name.trim().length < 3) return;
    setSearching(true); setError('');
    try {
      const r = await api.quickPreview(f.name, slug);
      setCands(r.candidates); setMatch(r.match); setSearched(true);
      if (r.match && !descTouched.current) setF((x: any) => ({ ...x, description: r.match!.description }));
    } catch (e) { setError((e as Error).message); } finally { setSearching(false); }
  }
  // Busca solo al dejar de escribir el nombre.
  useEffect(() => { if (f.id) return; setSearched(false); setVariantChosen(false); const t = setTimeout(() => search(), 900); return () => clearTimeout(t); }, [f.name]);

  /** Cancela la búsqueda del formulario si todavía no está vinculada a un producto guardado. */
  function dropJob(reason: string) {
    if (job && isActive(job) && !job.productRepoId) void cancelJob(job.id, reason).catch(() => {});
    setJobId(null); setCoverNote(null);
  }
  // Si cambia el equipo, el resultado de la búsqueda anterior ya no sirve.
  const modelKey = match ? `${match.brand}|${normalizeModelName(match.model)}` : '';
  useEffect(() => {
    if (job && isActive(job) && `${job.brand}|${normalizeModelName(job.model)}` !== modelKey) dropJob('Se cambió el equipo');
  }, [modelKey]);

  async function findCover() {
    if (!match) return;
    if (cands.length > 1 && !variantChosen && !f.id) {
      setCoverNote({ cls: 'pick', text: 'Hay varias variantes que coinciden: elegí la correcta en la lista de arriba y después buscá la imagen.' });
      candRef.current?.focus(); return;
    }
    if (photo) { setCoverNote({ cls: 'warn', text: 'Ya elegiste una foto manual: quitala para usar la imagen del modelo.' }); return; }
    setCoverNote({ cls: 'busy', text: 'Buscando imagen…' });
    try {
      const r = await requestCover(match.brand, match.model, f.id || null);
      if (r.status === 'exists') { setJobId(null); setCoverNote({ cls: 'ok', text: 'Este modelo ya tiene portada: se usa la del catálogo.' }); }
      else { setJobId(r.id); setCoverNote(null); }
    } catch (e) { setCoverNote({ cls: 'warn', text: (e as Error).message, retry: true }); }
  }

  function reset() {
    setJobId(null); setCoverNote(null); setVariantChosen(false);
    setF({ ...EMPTY }); setPhoto(undefined); setHasOwnPhoto(false); setMatch(null); setCands([]); setSearched(false);
    setPesos(null); setDescOpen(false); setError(''); descTouched.current = false;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(''); setMsg('');
    try {
      const r = await api.quickSave({ ...f, id: f.id || undefined, match, photo });
      // La búsqueda de portada sigue en segundo plano y se asigna sola al terminar.
      const pending = job && isActive(job) && !photo;
      if (pending) await linkJob(job!.id, r.id).catch(() => {});
      setMsg(`${f.id ? 'Producto actualizado.' : 'Producto cargado. Se sube al repositorio automáticamente.'}${pending ? ' La portada se asigna sola cuando termine la búsqueda.' : ''}`);
      reset(); load();
    } catch (err) { setError((err as Error).message); }
  }
  async function edit(p: Product) {
    const d = await api.product(p.id);
    reset(); setMsg('');
    setF({ id: p.repoId, name: `${p.brand} ${p.model}${p.ramGb && p.storageGb ? ` ${p.ramGb}/${p.storageGb}` : p.storageGb ? ` ${p.storageGb}GB` : ''}`,
      price: p.currency === 'USD' ? p.price : rate ? Math.round(p.price / rate) : p.price, currency: 'USD', condition: p.condition, description: p.description });
    descTouched.current = true; setHasOwnPhoto(!!p.photoUrl); setSearched(true);
    setMatch(d.specs.length ? { slug: '', name: `${p.brand} ${p.model}`, brand: p.brand, model: p.model, url: d.specs[0].sourceUrl ?? '',
      specs: d.specs.map(({ group, key, value, highlight }) => ({ group, key, value, highlight })), antutu: d.benchmarks[0] ?? null, description: p.description } : null);
    document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => nameRef.current?.focus(), 300);
  }
  async function remove(p: Product) {
    if (!confirm(`¿Eliminar ${p.brand} ${p.model} del catálogo? Se borra en todas las PCs.`)) return;
    await api.quickDelete(p.repoId!); if (f.id === p.repoId) reset(); load();
  }

  // Precio: se carga en dólares; también se puede escribir en pesos y se convierte con la cotización del catálogo.
  const usd = Number(f.price);
  const pesosShown = pesos ?? (rate && usd > 0 ? `$ ${num(usd * rate)}` : '');
  const coverSrc = match ? cover(match.brand, match.model) : null;
  const ownPhoto = photo ?? null;
  const thumb = ownPhoto ?? coverSrc;
  const status = searching ? { cls: 'busy', icon: 'refresh', text: 'Buscando la ficha…' }
    : match ? { cls: 'ok', icon: 'check', text: f.id ? `Ficha: ${match.name}` : 'Ficha encontrada' }
    : searched && f.name.trim().length >= 3 ? { cls: 'warn', icon: 'dot', text: 'No encontré ese equipo en internet. Podés cargarlo igual con tu descripción.' } : null;

  return (
    <div className="qa2">
      <div className="qa2-top">
        <nav className="crumbs"><Icon name="grid" size={16} /><span>Catálogo</span><Icon name="right" size={14} /><b>Cargar productos</b></nav>
        {repo && <RepoChip st={repo} onSync={async () => setRepo(await api.repoSync())} />}
      </div>
      <header className="qa2-head">
        <div><h1>Cargar productos</h1><p className="sub">Agregá equipos al catálogo con su ficha, precio y foto.</p></div>
        <div className="rate-chip"><Icon name="swap" size={16} className="accent" /><span>Cotización del catálogo</span>
          <b>{rate ? `USD 1 = $ ${rate.toLocaleString('es-UY')}` : 'Sin cargar (Ajustes)'}</b></div>
      </header>

      <div className="qa2-grid">
        <form className="qa2-card" onSubmit={save}>
          <div className="qa2-card-head">
            <span className="qa2-ico"><Icon name={f.id ? 'edit' : 'plus'} size={20} /></span>
            <div><h2>{f.id ? 'Editar producto' : 'Nuevo producto'}</h2><p>Buscá el equipo para completar la ficha automáticamente.</p></div>
          </div>
          <div className="qa2-body">
            <label className="fl">Nombre del equipo <i>*</i></label>
            <div className="qa2-name">
              <div className="field"><Icon name="search" size={18} />
                <input ref={nameRef} required maxLength={80} value={f.name} placeholder="Ej.: Samsung Galaxy A55 8/256"
                  onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <button type="button" className="btn qa2-find" onClick={() => search()} disabled={searching || f.name.trim().length < 3}>Buscar ficha</button>
            </div>
            {status && <div className={`qa2-status ${status.cls}`}><Icon name={status.icon} size={15} className={searching ? 'spin' : ''} />{status.text}
              {match?.url && !searching && <a href={match.url} target="_blank" rel="noreferrer">Fuente</a>}</div>}
            {cands.length > 1 && (
              <select ref={candRef} className={`field-select ${coverNote?.cls === 'pick' ? 'attention' : ''}`} value={match?.slug ?? ''} onChange={(e) => { setVariantChosen(true); setCoverNote(null); void search(e.target.value); }} aria-label="Coincidencia">
                {cands.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>)}

            <div className="qa2-two">
              <div>
                <label className="fl">Precio en dólares <i>*</i></label>
                <div className="field money"><span className="cur">USD</span>
                  <input type="number" min={1} step="any" required value={f.price} inputMode="decimal"
                    onChange={(e) => { setPesos(null); setF({ ...f, price: e.target.value }); }} /></div>
              </div>
              <div>
                <label className="fl">Equivalente en pesos (UYU)</label>
                <div className={`field money alt ${pesos !== null ? 'editing' : ''}`}>
                  <input value={pesos ?? pesosShown} readOnly={!rate} placeholder={rate ? '$ 0' : 'Falta la cotización en Ajustes'} aria-label="Equivalente en pesos"
                    onFocus={() => rate && setPesos(pesosShown)}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d]/g, ''); setPesos(v ? `$ ${num(Number(v))}` : '');
                      if (rate && v) setF({ ...f, price: String(Math.round((Number(v) / rate) * 100) / 100) });
                    }} onBlur={() => setPesos(null)} />
                  <button type="button" className="icon-btn" disabled={!rate} title="Escribir el precio en pesos"
                    onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement).focus()}><Icon name="swap" size={18} /></button>
                </div>
              </div>
            </div>

            <label className="fl">Condición</label>
            <div className="seg" role="radiogroup" aria-label="Condición">
              {CONDITIONS.map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={f.condition === v} className={f.condition === v ? 'on' : ''}
                  onClick={() => setF({ ...f, condition: v })}>{f.condition === v && <Icon name="check" size={15} />}{l}</button>))}
            </div>

            <label className="fl">Foto de portada <span className="opt">· Opcional</span></label>
            <div className="qa2-photo">
              <div className="ph">{thumb ? <img src={thumb} alt="" /> : <Icon name="image" size={22} />}</div>
              <div className="txt">
                <b>{ownPhoto ? 'Foto propia' : hasOwnPhoto && photo === undefined ? 'Foto propia (guardada)' : coverSrc ? 'Foto del catálogo' : 'Sin foto'}</b>
                <span>{ownPhoto || (hasOwnPhoto && photo === undefined) ? 'Se muestra en la galería de la unidad.' : coverSrc ? 'Podés usar esta imagen o subir una propia.' : 'Al encontrar la ficha se usa la imagen del modelo.'}</span>
              </div>
              <div className="row tight">
                {(ownPhoto || (f.id && hasOwnPhoto && photo === undefined)) && <button type="button" className="link" onClick={() => setPhoto(f.id ? null : undefined)}>Quitar</button>}
                <button type="button" className="btn qa2-findimg" onClick={findCover} disabled={!match || (!!job && isActive(job))}
                  title={match ? `Buscar en la web la foto de ${match.brand} ${match.model}` : 'Primero elegí el equipo (Buscar ficha)'}>
                  <Icon name={job && isActive(job) ? 'refresh' : 'search'} size={15} className={job && isActive(job) ? 'spin' : ''} /> {job && isActive(job) ? 'Buscando…' : 'Buscar imagen'}</button>
                <label className="btn"><Icon name="image" size={15} /> {thumb || hasOwnPhoto ? 'Cambiar foto' : 'Subir foto'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => {
                    const file = e.target.files?.[0]; e.target.value = '';
                    if (file) try { setPhoto(await fileToDataUrl(file, 1200, 'image/jpeg')); if (job && isActive(job)) dropJob('Se eligió una foto manual'); } catch (err) { setError((err as Error).message); } }} /></label>
              </div>
            </div>
            <CoverStatus job={job} note={coverNote} onRetry={() => void findCover()} />

            <div className={`qa2-desc ${descOpen ? 'open' : ''}`}>
              <button type="button" className="qa2-desc-head" onClick={() => setDescOpen(!descOpen)} aria-expanded={descOpen}>
                <Icon name="doc" size={18} className="accent" /><b>Descripción</b><span className="spacer" />
                <span className="muted">{descTouched.current && f.description ? 'Editada' : 'Autogenerada'} · Editable</span><Icon name="down" size={16} className="chev" />
              </button>
              {descOpen && <div className="qa2-desc-body">
                <textarea className="input" rows={4} maxLength={1500} value={f.description} placeholder="Se completa al encontrar la ficha."
                  onChange={(e) => { descTouched.current = true; setF({ ...f, description: e.target.value }); }} />
                {match && <div className="qa2-specs">
                  <span className="muted small">{match.specs.length} especificaciones se guardan con el producto{match.antutu ? ` · AnTuTu ${match.antutu.version.toUpperCase()}: ${num(match.antutu.total)}` : ''}.</span>
                </div>}
              </div>}
            </div>
            {error && <p className="error">{error}</p>}
            {msg && <p className="qa2-ok">{msg}</p>}
          </div>
          <div className="qa2-foot">
            <button type="button" className="link-muted" onClick={() => { reset(); setMsg(''); }}><Icon name="undo" size={16} /> {f.id ? 'Cancelar edición' : 'Limpiar formulario'}</button>
            <button type="submit" className="btn primary big"><Icon name={f.id ? 'check' : 'plus'} size={18} /> {f.id ? 'Guardar cambios' : 'Cargar producto'}</button>
          </div>
        </form>

        <section className="qa2-card">
          <div className="qa2-card-head">
            <span className="qa2-ico"><Icon name="list" size={20} /></span>
            <div><h2>Productos cargados</h2><p>Buscá y editá equipos del catálogo.</p></div>
            <span className="spacer" /><span className="count">{list.length}</span>
          </div>
          <div className="qa2-filters">
            <div className="field"><Icon name="search" size={18} /><input placeholder="Marca, modelo o memoria" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <label className="field sel"><Icon name="list" size={16} />
              <select value={cond} onChange={(e) => setCond(e.target.value)} aria-label="Filtrar por condición">
                <option value="">Condición</option>{CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select><Icon name="down" size={16} /></label>
          </div>
          <div className="qa2-table">
            <div className="th"><span>Equipo</span><span className="cond-col">Condición</span><span className="r">Precio</span><span /></div>
            {!list.length && <div className="empty small-empty">Todavía no cargaste productos.</div>}
            {list.length > 0 && !shown.length && <div className="empty small-empty">Ningún producto coincide con la búsqueda.</div>}
            {rows.map((p) => {
              const img = cover(p.brand, p.model, p.coverKey) ?? p.photoUrl;
              return (
                <div key={p.id} className={`tr ${f.id === p.repoId ? 'editing' : ''}`}>
                  <div className="eq"><span className="ph">{img ? <img src={img} alt="" /> : <Icon name="phone" size={20} />}</span>
                    <span className="nm"><b>{p.brand} {p.model}</b><small>{memLabel(p) || '—'}<span className={`cond cond-inline ${p.condition}`}>{condLabel(p.condition)}</span></small>
                      {(() => {
                        const j = jobFor(p);
                        if (j && isActive(j)) return <em className="qa2-jobst busy"><Icon name="refresh" size={12} className="spin" /> Buscando portada…</em>;
                        if (j && !img && (j.status === 'not_found' || j.status === 'offline' || j.status === 'error') && j.productRepoId === p.repoId)
                          return <em className="qa2-jobst warn">{j.status === 'offline' ? 'Sin conexión' : 'Sin portada'} · <button className="link" onClick={() => void requestCover(p.brand, p.model, p.repoId)}>Reintentar</button></em>;
                        return null;
                      })()}</span></div>
                  <span className="cond-col"><span className={`cond ${p.condition}`}>{condLabel(p.condition)}</span></span>
                  <span className="r pr"><b>{p.currency} {num(p.price)}</b>{p.currency === 'USD' && rate ? <small>$ {num(p.price * rate)}</small> : null}</span>
                  <span className="acts">
                    <button className="icon-btn" title="Editar" aria-label="Editar" onClick={() => edit(p)}><Icon name="edit" size={17} /></button>
                    <span className="more">
                      <button className="icon-btn" title="Más opciones" aria-label="Más opciones" onClick={(e) => { e.stopPropagation(); setMenu(menu === p.id ? null : p.id); }}>⋯</button>
                      {menu === p.id && <div className="menu" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { setMenu(null); void edit(p); }}><Icon name="edit" size={15} /> Editar</button>
                        {!img && <button onClick={() => { setMenu(null); void requestCover(p.brand, p.model, p.repoId); }}><Icon name="search" size={15} /> Buscar imagen</button>}
                        <button className="danger" onClick={() => { setMenu(null); void remove(p); }}><Icon name="trash" size={15} /> Eliminar</button>
                      </div>}
                    </span>
                  </span>
                </div>);
            })}
          </div>
          {shown.length > 0 && <div className="qa2-pager">
            <span>Mostrando {rows.length} de {shown.length} productos</span>
            <span className="spacer" />
            <button className="pg" disabled={pg === 0} onClick={() => setPage(pg - 1)} aria-label="Anterior"><Icon name="left" size={16} /></button>
            <button className="pg" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label="Siguiente"><Icon name="right" size={16} /></button>
          </div>}
        </section>
      </div>
    </div>
  );
}

/** Estado de «Buscar imagen» debajo de la foto de portada. */
function CoverStatus({ job, note, onRetry }: { job: CoverJob | null; note: { cls: string; text: string; retry?: boolean } | null; onRetry: () => void }) {
  let st = note;
  if (job) {
    if (isActive(job)) st = { cls: 'busy', text: 'Buscando imagen… Podés seguir cargando el producto: la portada se asigna sola.' };
    else if (job.status === 'done') st = { cls: 'ok', text: job.message ?? 'Portada encontrada' };
    else if (job.status === 'not_found') st = { cls: 'warn', text: 'No encontramos una imagen para este modelo. Podés reintentar o subir una foto.', retry: true };
    else if (job.status === 'offline') st = { cls: 'warn', text: 'Sin conexión a internet: no se pudo buscar la imagen. Revisá la conexión y reintentá.', retry: true };
    else if (job.status === 'error') st = { cls: 'warn', text: job.message ?? 'No se pudo buscar la imagen.', retry: true };
  }
  if (!st) return null;
  return (
    <div className={`qa2-status cover ${st.cls}`} role="status">
      <Icon name={st.cls === 'busy' ? 'refresh' : st.cls === 'ok' ? 'check' : 'dot'} size={15} className={st.cls === 'busy' ? 'spin' : ''} />
      <span>{st.text}</span>
      {st.retry && <button type="button" className="link" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}

export function RepoChip({ st, onSync }: { st: { ok: boolean; at: string | null; message: string; pending: number; hasToken: boolean }; onSync: () => void }) {
  const cls = !st.hasToken ? 'warn' : st.ok && !st.pending ? 'ok' : st.ok ? 'busy' : 'bad';
  const text = !st.hasToken ? 'Falta conectar GitHub (Ajustes)' : st.pending ? `${st.pending} cambios por subir` : st.ok ? 'Sincronizado con GitHub' : st.message;
  return <button className={`repo-chip ${cls}`} onClick={onSync} title={`${st.message}${st.at ? ' · ' + new Date(st.at).toLocaleString('es-UY') : ''}`}><i />{text}</button>;
}
