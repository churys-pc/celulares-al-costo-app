// Inicio para el personal del local: buscador de equipos, pendientes del local y novedades de celulares.
import { useEffect, useRef, useState } from 'react';
import type { CompareModel, ProductDetail, Settings, Stats } from '../../shared/types.ts';
import { api, type NewsItem, type NewsState, type SearchHit, type Task } from '../api.ts';
import { Icon } from '../icons.tsx';
import { useEscape } from '../useEscape.ts';
import type { Nav } from '../sections.ts';
import { useCovers } from '../covers.ts';
import { dualPrice, num } from '../format.ts';
import { iosSupport, IOS_SOURCE } from '../../shared/iosSupport.ts';
import { keySpecValues } from '../../shared/keySpecs.ts';
import { AllSpecs, ProductSheet } from './ProductSheet.tsx';

const nf = (n: number) => n.toLocaleString('es-UY');
const fecha = (iso: string, withYear = true) => new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });

export function Home({ settings, go }: { settings: Settings | null } & Nav) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [open, setOpen] = useState<ProductDetail | null>(null);
  const [model, setModel] = useState<CompareModel | null>(null);
  useEffect(() => { api.stats(false).then(setStats).catch(() => {}); }, []);

  async function choose(h: SearchHit) {
    if (h.productId) setOpen(await api.product(h.productId));
    else setModel((await api.compare([h.modelId]))[0] ?? null);
  }

  return (
    <div className="home3">
      <header className="h3-head">
        <div><h1>Inicio</h1></div>
        {stats && <div className="h3-stock"><Icon name="box" size={18} className="accent" />{nf(stats.stockTotal)} unidades en stock</div>}
      </header>

      <HomeSearch settings={settings} onPick={choose} onAll={(q) => go('catalogo', q)} />

      <div className="home-cols">
        <TasksPanel />
        <NewsPanel />
      </div>

      {open && <ProductSheet key={open.id} product={open} settings={settings} onClose={() => setOpen(null)}
        onEdit={() => { setOpen(null); go('catalogo', `${open.brand} ${open.model}`); }} onChanged={() => {}} />}
      {model && <ModelSheet m={model} onClose={() => setModel(null)} onCompare={() => { setModel(null); go('comparador'); }} />}
    </div>
  );
}

/** «Buscá un equipo»: sugerencias al escribir (miniatura, nombre, precio, disponibilidad). */
function HomeSearch({ settings, onPick, onAll }: { settings: Settings | null; onPick: (h: SearchHit) => Promise<void>; onAll: (q: string) => void }) {
  const cover = useCovers();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [sel, setSel] = useState(0);
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits(null); return; }
    const n = ++seq.current;
    const t = setTimeout(() => api.search(term).then((r) => { if (n === seq.current) { setHits(r); setSel(0); } }).catch(() => {}), 140);
    return () => clearTimeout(t);
  }, [q]);

  const pick = async (h: SearchHit) => { setFocus(false); ref.current?.blur(); await onPick(h); };
  const show = focus && q.trim() && hits !== null;

  const run = () => { if (hits?.[sel]) void pick(hits[sel]); else if (q.trim()) { ref.current?.focus(); setFocus(true); } };
  return (
    <section className="h3-search">
      <div className="h3-search-main">
        <div className="h3-title"><span className="h3-tile big"><Icon name="search" size={20} /></span><h2>Buscá un celular</h2></div>
        <div className="hs-wrap">
          <form className="h3-bar" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <Icon name="search" size={20} />
            <input ref={ref} value={q} placeholder="Marca, modelo, memoria o código"
              onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setQ(''); return; }
                if (!hits?.length) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              }} aria-label="Buscar un equipo" role="combobox" aria-expanded={!!show} />
            {q ? <button type="button" className="icon-btn" onClick={() => { setQ(''); ref.current?.focus(); }} aria-label="Borrar"><Icon name="x" size={16} /></button>
              : <span className="keys"><kbd>Ctrl</kbd><kbd>K</kbd></span>}
            <button type="submit" className="btn primary h3-go">Buscar</button>
          </form>
          {show && (
            <div className="hs-list" role="listbox">
              {hits!.length === 0 && <div className="hs-empty muted">No hay equipos que coincidan con «{q.trim()}».</div>}
              {hits!.map((h, i) => {
                const img = cover(h.brand, h.model, h.coverKey) ?? h.photoUrl;
                const pr = h.price && h.currency ? dualPrice({ price: h.price, currency: h.currency }, settings) : null;
                return (
                  <button key={`${h.type}-${h.productId ?? h.modelId}`} role="option" aria-selected={i === sel} className={`hs-item ${i === sel ? 'on' : ''}`}
                    onMouseEnter={() => setSel(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => void pick(h)}>
                    <span className="hs-img">{img ? <img src={img} alt="" /> : <Icon name="phone" size={22} />}</span>
                    <span className="hs-name"><b>{h.brand} {h.model}</b><small className="muted">{h.type === 'model' ? 'Sin unidades cargadas · ver ficha del modelo' : [h.variant, h.availability].filter(Boolean).join(' · ')}</small></span>
                    <span className="hs-price">{pr?.usd != null ? <><b>USD {num(pr.usd)}</b>{pr.uyu != null && <small className="muted">$ {num(pr.uyu)}</small>}</> : <small className="muted">—</small>}</span>
                  </button>);
              })}
              {hits!.length > 0 && <button className="hs-all link" onMouseDown={(e) => e.preventDefault()} onClick={() => onAll(q.trim())}>Ver todos los resultados en el catálogo <Icon name="arrow" size={14} /></button>}
            </div>)}
        </div>
        <div className="h3-try"><span>Probá con</span>
          {['iPhone 15 Pro', 'Galaxy A56 8/256', 'SM-A566B'].map((t) => (
            <button key={t} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(t); setFocus(true); ref.current?.focus(); }}>{t}</button>))}
        </div>
      </div>
      <SearchArt />
    </section>
  );
}

/** Ilustración del buscador (celular + lupa), dibujada con SVG propio. */
function SearchArt() {
  const dots = [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 17; x++) dots.push(<circle key={`${x}-${y}`} cx={8 + x * 25} cy={10 + y * 25} r={1.3} />);
  return (
    <svg className="h3-art" viewBox="0 0 430 230" aria-hidden="true">
      <g fill="rgba(110,160,255,.28)">{dots}</g>
      <g fill="none" stroke="rgba(110,170,255,.35)" strokeWidth="1.2">
        <ellipse cx="240" cy="112" rx="150" ry="100" /><ellipse cx="240" cy="112" rx="112" ry="78" />
      </g>
      <g fill="#3f86ff"><circle cx="96" cy="94" r="4" /><circle cx="370" cy="48" r="4" /><circle cx="388" cy="135" r="4" /><circle cx="150" cy="196" r="4" /></g>
      <g transform="rotate(14 230 112)">
        <rect x="185" y="20" width="96" height="180" rx="18" fill="rgba(20,50,110,.55)" stroke="#5aa2ff" strokeWidth="3" />
        <rect x="193" y="30" width="80" height="160" rx="12" fill="rgba(30,70,150,.35)" stroke="rgba(120,180,255,.5)" />
        <rect x="218" y="36" width="30" height="5" rx="2.5" fill="#5aa2ff" />
        <rect x="208" y="62" width="50" height="40" rx="8" fill="rgba(110,170,255,.35)" stroke="#6eaaff" />
        <path d="M206 120h52M206 132h52M206 144h34" stroke="#6eaaff" strokeWidth="4" strokeLinecap="round" />
        <path d="M222 178h22" stroke="#6eaaff" strokeWidth="4" strokeLinecap="round" />
      </g>
      <rect x="128" y="128" width="40" height="40" rx="8" fill="rgba(30,70,150,.6)" stroke="#5aa2ff" />
      <path d="M140 148l6 6 11-12" fill="none" stroke="#8cc2ff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="300" y="82" width="70" height="70" rx="14" fill="url(#h3g)" stroke="#7fb8ff" />
      <circle cx="331" cy="113" r="13" fill="none" stroke="#fff" strokeWidth="3.4" /><path d="M341 123l11 11" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
      <defs><linearGradient id="h3g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3d8cff" /><stop offset="1" stopColor="#1d5fd6" /></linearGradient></defs>
    </svg>
  );
}

/** Ficha de un modelo sin producto cargado (agotado): portada, características principales y ficha completa. */
function ModelSheet({ m, onClose, onCompare }: { m: CompareModel; onClose: () => void; onCompare: () => void }) {
  useEscape(onClose);
  const cover = useCovers();
  const img = cover(m.brand, m.model, m.coverKey) ?? m.photoUrl;
  const highlights = keySpecValues(m.specs);
  const ios = iosSupport(m.brand, m.model);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <div className="row">
          <button className="btn drawer-back" onClick={onClose}><Icon name="left" size={16} /> Volver</button>
          <span className="badge out">Sin stock</span>
        </div>
        <h2 style={{ margin: '10px 0 2px' }}>{m.brand} {m.model}</h2>
        <div className="muted">No hay unidades cargadas en el catálogo.</div>
        <div className="gallery"><div className="g-main" style={{ cursor: 'default' }}>{img ? <img className="cover" src={img} alt={`${m.brand} ${m.model}`} /> : <Icon name="phone" size={40} />}</div></div>
        <h3>Ficha técnica</h3>
        {highlights.length ? <div className="highlights">{highlights.map((s) => <div key={s.label} className="hl"><b>{s.label}</b>{s.value}</div>)}</div>
          : <p className="muted small">Este modelo todavía no tiene ficha cargada.</p>}
        {ios && <div className="ios-box">
          <span className="ios-ico"><Icon name="shield" size={18} /></span>
          <div><b>Actualizaciones de iOS</b><span>{ios.label}</span>
            <small className="muted">{ios.estimate} · Fuente: <a href={IOS_SOURCE.url} target="_blank" rel="noreferrer">{IOS_SOURCE.name}</a></small></div>
        </div>}
        {m.specs.length > 0 && <AllSpecs specs={m.specs} />}
        <div className="row" style={{ marginTop: 20 }}><button className="btn" onClick={onCompare}><Icon name="layers" size={16} /> Ir al comparador</button></div>
      </aside>
    </div>
  );
}

/** «Pendientes del local»: notas de tareas compartidas entre las PCs del local. */
function TasksPanel() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const load = () => api.tasks().then((t) => { setTasks(t); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { void load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!menu) return; const c = () => setMenu(null); window.addEventListener('click', c); return () => window.removeEventListener('click', c); }, [menu]);

  const run = async (p: Promise<unknown>) => { try { await p; } catch (e) { setError((e as Error).message); } await load(); };
  const open = (tasks ?? []).filter((t) => !t.done);
  const done = (tasks ?? []).filter((t) => t.done);
  const row = (t: Task) => <TaskRow key={t.id} t={t} menuOpen={menu === t.id} onMenu={() => setMenu(menu === t.id ? null : t.id)}
    onToggle={() => run(api.updateTask(t.id, { done: !t.done }))} onEdit={() => { setMenu(null); setEditing(t); }}
    onDelete={() => { setMenu(null); if (confirm(`¿Eliminar «${t.title}»?`)) void run(api.deleteTask(t.id)); }} />;

  return (
    <section className="h3-card">
      <div className="h3-card-head">
        <span className="h3-tile"><Icon name="clipcheck" size={20} /></span>
        <h2>Pendientes del local</h2>
        <button className="btn primary h3-add" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> Agregar pendiente</button>
      </div>
      <div className="h3-card-body">
        {error && <p className="err small">{error}</p>}
        {editing && <TaskForm task={editing === 'new' ? null : editing} onCancel={() => setEditing(null)}
          onSave={async (b) => { await run(editing === 'new' ? api.addTask(b) : api.updateTask(editing.id, b)); setEditing(null); }} />}
        {tasks === null ? <p className="muted small h3-pad">Cargando…</p> : open.length === 0 && !editing
          ? <div className="hp-empty muted">No hay pendientes abiertos.</div>
          : <ul className="tasks3">{open.map(row)}</ul>}
        {showDone && done.length > 0 && <>
          <div className="h3-sub">Completadas</div>
          <ul className="tasks3 done">{done.map(row)}</ul>
        </>}
      </div>
      <div className="h3-card-foot">
        <span>{open.length} {open.length === 1 ? 'pendiente' : 'pendientes'}</span>
        <span className="spacer" />
        {done.length > 0 && <button className="link" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
          {showDone ? 'Ocultar completados' : `Ver completados (${done.length})`} <Icon name={showDone ? 'down' : 'right'} size={15} /></button>}
      </div>
    </section>
  );
}

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

function TaskRow({ t, menuOpen, onMenu, onToggle, onEdit, onDelete }: { t: Task; menuOpen: boolean; onMenu: () => void; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className={`task3 ${t.done ? 'done' : ''}`}>
      <button className="task-check" onClick={onToggle} aria-label={t.done ? 'Reabrir' : 'Marcar como completada'} title={t.done ? 'Reabrir' : 'Completar'}>
        {t.done && <Icon name="check" size={14} />}
      </button>
      <div className="task-body">
        <b>{t.title}</b>
        {t.description && <p>{t.description}</p>}
        {t.done && t.completedAt && <small className="muted">Completada el {fecha(t.completedAt)}{t.createdBy ? ` · ${t.createdBy.split('@')[0]}` : ''}</small>}
      </div>
      {!t.done && isToday(t.createdAt) && <span className="h3-today" title={`Creado hoy${t.createdBy ? ` por ${t.createdBy.split('@')[0]}` : ''}`}>Hoy</span>}
      <span className="more">
        <button className="icon-btn dots" onClick={(e) => { e.stopPropagation(); onMenu(); }} title="Opciones" aria-label="Opciones">⋯</button>
        {menuOpen && <div className="menu" onClick={(e) => e.stopPropagation()}>
          <button onClick={onToggle}><Icon name={t.done ? 'undo' : 'check'} size={15} /> {t.done ? 'Reabrir' : 'Completar'}</button>
          <button onClick={onEdit}><Icon name="edit" size={15} /> Editar</button>
          <button className="danger" onClick={onDelete}><Icon name="trash" size={15} /> Eliminar</button>
        </div>}
      </span>
    </li>
  );
}

function TaskForm({ task, onSave, onCancel }: { task: Task | null; onSave: (b: { title: string; description: string }) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <form className="task-form" onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return; setBusy(true); await onSave({ title, description }); setBusy(false); }}>
      <input className="input" autoFocus maxLength={120} placeholder="Título (ej. Llamar al proveedor de fundas)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input" rows={2} maxLength={2000} placeholder="Descripción (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="row">
        <button className="btn primary small-btn" disabled={busy || !title.trim()}>{task ? 'Guardar cambios' : 'Agregar'}</button>
        <button type="button" className="btn small-btn" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

const BRAND_CLS: Record<string, string> = { Apple: 'apple', Samsung: 'samsung', Xiaomi: 'xiaomi', Motorola: 'motorola', Honor: 'honor' };
/** Ícono según el tema de la nota: actualización/seguridad, IA/funciones nuevas, ubicación o lanzamiento. */
function newsIcon(n: NewsItem) {
  const t = `${n.title} ${n.summary}`;
  if (/ubicaci|gps|mapa|location/i.test(t)) return 'pin';
  if (/\b(ia|ai)\b|intelligence|gemini|galaxy ai|inteligencia/i.test(t)) return 'sparkle';
  if (/actualiz|update|corrige|parche|seguridad|ios \d|one ui|hyperos|android \d/i.test(t)) return 'shieldcheck';
  return 'phone';
}

/** «Novedades de celulares»: hasta tres notas recientes con fuente; sin conexión muestra las guardadas. */
function NewsPanel() {
  const [st, setSt] = useState<NewsState | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); try { setSt(await api.refreshNews()); } catch { /* se queda con lo guardado */ } setBusy(false); };
  useEffect(() => {
    api.news().then((s) => {
      setSt(s);
      // Si nunca se bajaron o pasaron más de 3 horas, se actualizan al abrir Inicio.
      if (!s.fetchedAt || Date.now() - +new Date(s.fetchedAt) > 3 * 3600_000) void refresh();
    }).catch(() => setSt({ items: [], fetchedAt: null, lastAttemptAt: null, error: null }));
  }, []);
  const offline = !!st?.error && !!st.lastAttemptAt && (!st.fetchedAt || st.lastAttemptAt > st.fetchedAt);

  return (
    <section className="h3-card">
      <div className="h3-card-head">
        <span className="h3-tile"><Icon name="news" size={20} /></span>
        <h2>Novedades de celulares</h2>
        <button className="h3-refresh" onClick={refresh} disabled={busy} title="Actualizar novedades" aria-label="Actualizar novedades">
          <Icon name="refresh" size={17} className={busy ? 'spin' : ''} /></button>
      </div>
      <div className="h3-card-body">
        {offline && st!.items.length > 0 && <p className="hp-note small">Sin conexión: se muestran las últimas novedades guardadas{st!.fetchedAt ? ` (actualizadas el ${fecha(st!.fetchedAt)})` : ''}.</p>}
        {!st ? <p className="muted small h3-pad">Cargando…</p> : st.items.length === 0
          ? <div className="hp-empty muted">{busy ? 'Buscando novedades…' : 'No hay novedades disponibles'}</div>
          : <ul className="news3">
              {st.items.map((n) => (
                <li key={n.url} className={`n3 ${BRAND_CLS[n.brand] ?? 'other'}`}>
                  <span className="n3-ico"><Icon name={newsIcon(n)} size={20} /></span>
                  <div className="n3-body">
                    <div className="n3-meta"><b className="n3-brand">{n.brand}</b><span>· {fecha(n.date, false)}</span>
                      <span className="spacer" /><a className="n3-src" href={n.url} target="_blank" rel="noreferrer">{n.source} <Icon name="external" size={14} /></a></div>
                    <a className="n3-title" title={n.title} href={n.url} target="_blank" rel="noreferrer">{n.title}</a>
                    {n.summary && <p>{n.summary}</p>}
                  </div>
                </li>))}
            </ul>}
      </div>
    </section>
  );
}
