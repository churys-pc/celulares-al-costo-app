// Inicio para el personal del local: buscador de equipos, pendientes del local y novedades de celulares.
import { useEffect, useRef, useState } from 'react';
import type { CompareModel, ProductDetail, Settings, Stats } from '../../shared/types.ts';
import { api, type NewsState, type SearchHit, type Task } from '../api.ts';
import { Icon } from '../icons.tsx';
import { SECTIONS, type Nav } from '../sections.ts';
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
    <div className="home2">
      <header className="page-head">
        <div><h1>Inicio</h1><p className="sub">{settings?.slogan}</p></div>
        {stats && <div className="home-stats muted small">{nf(stats.products)} productos · {nf(stats.stockTotal)} unidades en stock</div>}
      </header>

      <HomeSearch settings={settings} onPick={choose} onAll={(q) => go('catalogo', q)} />

      <div className="home-cols">
        <TasksPanel />
        <NewsPanel />
      </div>

      <section className="home-tools">
        <div className="sec-head"><h2><Icon name="layers" size={20} className="accent" />Herramientas</h2></div>
        <div className="tools">
          {(['comparador', 'diagnostico', 'imei'] as const).map((id) => {
            const s = SECTIONS.find((x) => x.id === id)!;
            const title = { comparador: 'Comparador avanzado', diagnostico: 'Diagnóstico iPhone (vía QR)', imei: 'Verificación de IMEI' }[id];
            return (
              <button key={id} className="tool" onClick={() => go(id)}>
                <Icon name={id === 'diagnostico' ? 'qr' : s.icon} size={30} className="accent" />
                <b>{title}</b><span>{s.desc}</span>
                <Icon name="arrow" size={16} className="tool-arrow" />
              </button>);
          })}
        </div>
      </section>

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

  return (
    <section className="home-search">
      <h2 className="home-h"><Icon name="search" size={20} className="accent" />Buscá un equipo</h2>
      <div className="hs-wrap">
        <form className="searchbar hs-bar" onSubmit={(e) => { e.preventDefault(); if (hits?.[sel]) void pick(hits[sel]); }}>
          <Icon name="search" size={18} />
          <input ref={ref} value={q} placeholder="Marca, modelo, variante o código (ej. A56 8/256, iPhone 15 Pro, SM-A566B)"
            onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
            onKeyDown={(e) => {
              if (!hits?.length) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === 'Escape') { setQ(''); }
            }} aria-label="Buscar un equipo" role="combobox" aria-expanded={!!show} />
          {q ? <button type="button" className="icon-btn" onClick={() => { setQ(''); ref.current?.focus(); }} aria-label="Borrar"><Icon name="x" size={16} /></button> : <kbd>Ctrl + K</kbd>}
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
                  <span className="hs-name"><b>{h.brand} {h.model}</b><small className="muted">{h.variant || (h.type === 'model' ? 'Modelo sin producto cargado' : '')}</small></span>
                  <span className="hs-price">{pr?.usd != null ? <><b>USD {num(pr.usd)}</b>{pr.uyu != null && <small className="muted">$ {num(pr.uyu)}</small>}</> : <small className="muted">—</small>}</span>
                  <span className="hs-av"><span className={`hs-pill ${h.available ? 'ok' : h.availabilityLabel === 'Sin stock' ? 'out' : 'warn'}`}>{h.availabilityLabel}</span>
                    {h.availability && <small className="muted">{h.availability}</small>}</span>
                </button>);
            })}
            {hits!.length > 0 && <button className="hs-all link" onMouseDown={(e) => e.preventDefault()} onClick={() => onAll(q.trim())}>Ver todos los resultados en el catálogo <Icon name="arrow" size={14} /></button>}
          </div>)}
      </div>
    </section>
  );
}

/** Ficha de un modelo sin producto cargado (agotado): portada, características principales y ficha completa. */
function ModelSheet({ m, onClose, onCompare }: { m: CompareModel; onClose: () => void; onCompare: () => void }) {
  const cover = useCovers();
  const img = cover(m.brand, m.model, m.coverKey) ?? m.photoUrl;
  const highlights = keySpecValues(m.specs);
  const ios = iosSupport(m.brand, m.model);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <div className="row">
          <span className="badge out">Sin stock</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
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
  const load = () => api.tasks().then((t) => { setTasks(t); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { void load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);

  const run = async (p: Promise<unknown>) => { try { await p; } catch (e) { setError((e as Error).message); } await load(); };
  const open = (tasks ?? []).filter((t) => !t.done);
  const done = (tasks ?? []).filter((t) => t.done);

  return (
    <section className="home-panel">
      <div className="hp-head">
        <h2 className="home-h"><Icon name="task" size={20} className="accent" />Pendientes del local</h2>
        <button className="btn primary small-btn" onClick={() => setEditing('new')}><Icon name="plus" size={15} /> Agregar pendiente</button>
      </div>
      {error && <p className="err small">{error}</p>}
      {editing && <TaskForm task={editing === 'new' ? null : editing} onCancel={() => setEditing(null)}
        onSave={async (b) => { await run(editing === 'new' ? api.addTask(b) : api.updateTask(editing.id, b)); setEditing(null); }} />}
      {tasks === null ? <p className="muted small">Cargando…</p> : open.length === 0 && !editing
        ? <div className="hp-empty muted">No hay pendientes abiertos.</div>
        : <ul className="tasks">{open.map((t) => <TaskRow key={t.id} t={t} onToggle={() => run(api.updateTask(t.id, { done: true }))}
            onEdit={() => setEditing(t)} onDelete={() => confirm(`¿Eliminar «${t.title}»?`) && run(api.deleteTask(t.id))} />)}</ul>}
      {done.length > 0 && (
        <div className="tasks-done">
          <button className="td-toggle" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            <Icon name="down" size={16} className={showDone ? 'rot' : ''} /> Completadas ({done.length})
          </button>
          {showDone && <ul className="tasks">{done.map((t) => <TaskRow key={t.id} t={t} onToggle={() => run(api.updateTask(t.id, { done: false }))}
            onEdit={() => setEditing(t)} onDelete={() => confirm(`¿Eliminar «${t.title}»?`) && run(api.deleteTask(t.id))} />)}</ul>}
        </div>)}
    </section>
  );
}

function TaskRow({ t, onToggle, onEdit, onDelete }: { t: Task; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className={`task ${t.done ? 'done' : ''}`}>
      <button className="task-check" onClick={onToggle} aria-label={t.done ? 'Reabrir' : 'Marcar como completada'} title={t.done ? 'Reabrir' : 'Completar'}>
        {t.done && <Icon name="check" size={14} />}
      </button>
      <div className="task-body">
        <b>{t.title}</b>
        {t.description && <p>{t.description}</p>}
        <small className="muted">{t.done && t.completedAt ? `Completada el ${fecha(t.completedAt)}` : `Creada el ${fecha(t.createdAt)}`}{t.createdBy ? ` · ${t.createdBy.split('@')[0]}` : ''}</small>
      </div>
      <div className="task-actions">
        {t.done && <button className="icon-btn" onClick={onToggle} title="Reabrir" aria-label="Reabrir"><Icon name="undo" size={15} /></button>}
        <button className="icon-btn" onClick={onEdit} title="Editar" aria-label="Editar"><Icon name="edit" size={15} /></button>
        <button className="icon-btn" onClick={onDelete} title="Eliminar" aria-label="Eliminar"><Icon name="trash" size={15} /></button>
      </div>
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
    <section className="home-panel">
      <div className="hp-head">
        <h2 className="home-h"><Icon name="news" size={20} className="accent" />Novedades de celulares</h2>
        <button className="icon-btn" onClick={refresh} disabled={busy} title="Actualizar novedades" aria-label="Actualizar novedades">
          <Icon name="refresh" size={16} className={busy ? 'spin' : ''} /></button>
      </div>
      {offline && st!.items.length > 0 && <p className="hp-note small">Sin conexión: se muestran las últimas novedades guardadas{st!.fetchedAt ? ` (actualizadas el ${fecha(st!.fetchedAt)})` : ''}.</p>}
      {!st ? <p className="muted small">Cargando…</p> : st.items.length === 0
        ? <div className="hp-empty muted">{busy ? 'Buscando novedades…' : 'No hay novedades disponibles'}</div>
        : <div className="news">
            {st.items.map((n) => (
              <article key={n.url} className="news-item">
                <div className="row tight"><span className="news-brand">{n.brand}</span><small className="muted">{fecha(n.date)}</small></div>
                <h3><a href={n.url} target="_blank" rel="noreferrer">{n.title}</a></h3>
                {n.summary && <p>{n.summary}</p>}
                <a className="news-src small" href={n.url} target="_blank" rel="noreferrer">{n.source} <Icon name="external" size={13} /></a>
              </article>))}
          </div>}
      {st?.fetchedAt && !offline && <p className="muted small hp-foot">Actualizado el {fecha(st.fetchedAt)} {new Date(st.fetchedAt).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}</p>}
    </section>
  );
}
