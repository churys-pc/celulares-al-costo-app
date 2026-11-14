// Modo presentación para clientes: pantalla completa, un equipo por vez (o dos lado a lado con «Comparar»),
// sin datos internos (costo, notas). Filtros arriba: marca y condición (Nuevo / CPO).
import { useCallback, useEffect, useState } from 'react';
import type { Product, ProductDetail, Settings } from '../../shared/types.ts';
import { api } from '../api.ts';
import { dualPrice, num, warrantyLabel, storageLabel, USE_LABEL } from '../format.ts';
import { Icon, SPEC_ICON } from '../icons.tsx';
import { useCovers } from '../covers.ts';
import { keySpecValues } from '../../shared/keySpecs.ts';

const AUTO_MS = 8000;
/** En la app de Windows los botones de la ventana (—, ▢, ✕) quedan siempre arriba a la derecha, aun en pantalla completa. */
const IN_DESKTOP = !!(window as unknown as { desktop?: unknown }).desktop;
const nf = (n: number) => n.toLocaleString('es-UY');
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const title = (p: Product) => (p.brand === 'Apple' ? p.model : `${p.brand} ${p.model}`);
const variant = (p: Product) => [storageLabel(p.storageGb), p.ramGb && `${p.ramGb} GB RAM`, p.color].filter(Boolean).join(' · ');

const LABEL_GROUP: Record<string, string> = { Procesador: 'Chip', RAM: 'Memoria', Almacenamiento: 'Memoria', Pantalla: 'Pantalla',
  'Cámara principal': 'Cámaras', 'Cámara frontal': 'Cámaras', Batería: 'Batería y carga', Carga: 'Batería y carga', 'Red móvil': 'Conectividad' };
type Cond = '' | 'nuevo' | 'usado';

export function Presentation({ items, start = 0, settings, onClose }: { items: Product[]; start?: number; settings: Settings | null; onClose: () => void }) {
  const cover = useCovers();
  const all = items.filter((p) => p.status === 'disponible' && p.stock > 0);
  // Marcas para elegir qué mostrar (de las que hay en la lista), por cantidad de equipos.
  const brands = [...all.reduce((m, p) => m.set(p.brand, (m.get(p.brand) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const conds = new Set(all.map((p) => p.condition));
  const [brand, setBrand] = useState('');
  const [cond, setCond] = useState<Cond>('');
  const list = all.filter((p) => (!brand || p.brand === brand) && (!cond || p.condition === cond));
  const [i, setI] = useState(() => Math.max(0, all.findIndex((p) => p.id === items[start]?.id)));
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [photo, setPhoto] = useState(0);
  const [auto, setAuto] = useState(false);
  // Comparar: elegir 2 equipos (picking) y verlos lado a lado (pair).
  const [picking, setPicking] = useState<Product[] | null>(null);
  const [pair, setPair] = useState<[Product, Product] | null>(null);
  const filterBy = (b: string, c: Cond) => { setBrand(b); setCond(c); setI(0); setPhoto(0); };
  const go = useCallback((d: number) => { if (!list.length) return; setI((x) => (x + d + list.length) % list.length); setPhoto(0); }, [list.length]);
  const close = useCallback(() => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); onClose(); }, [onClose]);

  useEffect(() => { document.documentElement.requestFullscreen?.().catch(() => {}); }, []);
  useEffect(() => { const p = list[i]; if (p) api.product(p.id).then(setDetail).catch(() => setDetail(null)); }, [i, list.length, brand, cond]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc sale primero de la elección o de la comparación; recién después de la presentación.
      if (e.key === 'Escape') { if (picking) setPicking(null); else if (pair) setPair(null); else close(); return; }
      if (picking || pair) return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === ' ') { e.preventDefault(); setAuto((a) => !a); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, close, picking, pair]);
  useEffect(() => { if (!auto || pair || picking) return; const t = setInterval(() => go(1), AUTO_MS); return () => clearInterval(t); }, [auto, go, pair, picking]);

  if (!all.length) return (
    <div className="pres"><div className="pres-empty"><p>No hay equipos disponibles con precio para presentar.</p>
      <button className="btn" onClick={close}>Volver</button></div></div>);

  const base = list[Math.min(i, list.length - 1)] as Product | undefined;
  const p = base && detail && detail.id === base.id ? detail : null;
  const coverSrc = base ? cover(base.brand, base.model, base.coverKey) : null;
  const photos = [...(coverSrc ? [{ id: -1, url: coverSrc }] : []), ...(p?.photos ?? [])];

  return (
    <div className={`pres ${IN_DESKTOP ? 'in-desktop' : ''} ${pair ? 'comparing' : ''}`}>
      <header className="pres-top">
        <img src={settings?.logo ?? '/logo.png'} alt="" className="pres-logo" />
        {!pair && <>
          {brands.length > 1 && (
            <div className="pres-brands" role="tablist" aria-label="Marca">
              <button className={!brand ? 'on' : ''} onClick={() => filterBy('', cond)}>Todas</button>
              {brands.map(([b]) => <button key={b} className={brand === b ? 'on' : ''} onClick={() => filterBy(b, cond)}>{b}</button>)}
            </div>)}
          {conds.size > 1 && (
            <div className="pres-brands pres-cond" role="tablist" aria-label="Condición">
              {([['', 'Todos'], ['nuevo', 'Nuevos'], ['usado', 'CPO']] as const).map(([v, l]) => (
                <button key={v} className={cond === v ? 'on' : ''} onClick={() => filterBy(brand, v)}>{l}</button>))}
            </div>)}
          <span className="pres-count">{list.length ? `${Math.min(i + 1, list.length)} / ${list.length}` : '0'}</span>
          <button className="btn ghost" onClick={() => { setAuto(false); setPicking(base ? [base] : []); }} disabled={list.length < 2}
            title="Elegí 2 equipos para verlos lado a lado"><Icon name="layers" size={16} /> Comparar</button>
          <button className={`btn ghost ${auto ? 'on' : ''}`} onClick={() => setAuto(!auto)} title="Espacio">{auto ? '❚❚ Pausar' : '▶ Automático'}</button>
        </>}
        {pair && <>
          <span className="pres-count spacer-l">Comparando 2 equipos</span>
          <button className="btn ghost" onClick={() => setPicking([...pair])}><Icon name="swap" size={16} /> Cambiar equipos</button>
          <button className="btn ghost" onClick={() => setPair(null)}><Icon name="left" size={16} /> Volver</button>
        </>}
        <button className="btn ghost" onClick={close} title="Esc"><Icon name="x" size={16} /> Salir</button>
      </header>

      {pair ? <ComparePair pair={pair} settings={settings} />
        : !base ? <div className="pres-empty"><p>No hay equipos {cond === 'usado' ? 'CPO' : cond === 'nuevo' ? 'nuevos' : ''}{brand ? ` de ${brand}` : ''} para mostrar.</p>
          <button className="btn" onClick={() => filterBy('', '')}>Ver todos</button></div>
        : <>
          <button className="pres-nav left" onClick={() => go(-1)} aria-label="Anterior"><Icon name="left" size={28} /></button>
          <main className="pres-body" key={base.id}>
            <div className="pres-photo">
              {photos.length ? <img src={photos[Math.min(photo, photos.length - 1)].url} alt={`${base.brand} ${base.model}`} />
                : <Icon name="phone" size={140} className="ph-icon" />}
              {photos.length > 1 && <div className="pres-dots">{photos.map((ph, k) => <button key={ph.id} className={k === photo ? 'on' : ''} onClick={() => setPhoto(k)} aria-label={`Foto ${k + 1}`} />)}</div>}
            </div>
            <div className="pres-info">
              <Heading p={base} />
              <Price p={base} settings={settings} />
              <Specs list={p ? keySpecValues(p.specs).slice(0, 6) : []} />
              <Bench d={p} />
              {base.uses.length > 0 && <div className="row tight">{base.uses.map((u) => <span key={u} className="tag outline">Ideal para {USE_LABEL[u]}</span>)}</div>}
            </div>
          </main>
          <button className="pres-nav right" onClick={() => go(1)} aria-label="Siguiente"><Icon name="right" size={28} /></button>
        </>}
      <footer className="pres-hint">{pair ? 'Esc volver a la presentación' : '← → cambiar · Espacio automático · Esc salir'}</footer>

      {picking && <Picker list={list} chosen={picking} onChange={setPicking} onCancel={() => setPicking(null)}
        onDone={(a, b) => { setPicking(null); setPair([a, b]); }} cover={cover} settings={settings} />}
    </div>
  );
}

function Heading({ p }: { p: Product }) {
  return <>
    <div className="row tight">
      <span className={`tag ${p.condition}`}>{p.condition === 'nuevo' ? 'Nuevo' : 'CPO'}</span>
      {p.warrantyMonths > 0 && <span className="tag outline">Garantía {warrantyLabel(p.warrantyMonths)}</span>}
    </div>
    <h1>{title(p)}</h1>
    <p className="pres-variant">{variant(p)}</p>
  </>;
}

function Price({ p, settings }: { p: Product; settings: Settings | null }) {
  const price = dualPrice(p, settings);
  if (price.usd == null && price.uyu == null) return null;
  return (
    <div className="pres-price">
      {price.usd != null && <div><span>Dólares</span><b><small>USD</small> {num(price.usd)}</b></div>}
      {price.uyu != null && <div className="uyu"><span>Pesos</span><b><small>$</small> {num(price.uyu)}</b></div>}
    </div>);
}

function Specs({ list }: { list: { label: string; value: string | null }[] }) {
  if (!list.length) return null;
  return (
    <ul className="pres-specs">
      {list.map((s) => <li key={s.label} className={s.value ? '' : 'none'}><Icon name={SPEC_ICON[LABEL_GROUP[s.label] ?? 'Otros'] ?? 'dot'} size={22} />
        <div><span>{s.label}</span><b title={s.value ?? undefined}>{s.value ?? 'Sin datos'}</b></div></li>)}
    </ul>);
}

const benchOf = (d: ProductDetail | null) => d?.benchmarks.find((b) => b.version === 'v11') ?? d?.benchmarks[0] ?? null;
function Bench({ d, max = 4_000_000, best }: { d: ProductDetail | null; max?: number; best?: boolean }) {
  const bench = benchOf(d);
  if (!bench) return null;
  return (
    <div className={`pres-bench ${best ? 'best' : ''}`}>
      <span>Rendimiento AnTuTu {bench.version.toUpperCase()}{best && <em> · Más rápido</em>}</span>
      <b>{nf(bench.total)}</b>
      <div className="pres-bar"><i style={{ width: `${Math.min(100, (bench.total / max) * 100)}%` }} /></div>
      <small>Fuente: {bench.sourceName}</small>
    </div>);
}

/** Dos equipos lado a lado, con la misma ficha que la vista de uno y las filas alineadas. */
function ComparePair({ pair, settings }: { pair: [Product, Product]; settings: Settings | null }) {
  const cover = useCovers();
  const [details, setDetails] = useState<(ProductDetail | null)[]>([null, null]);
  useEffect(() => {
    setDetails([null, null]);
    Promise.all(pair.map((p) => api.product(p.id).catch(() => null))).then(setDetails);
  }, [pair[0].id, pair[1].id]);
  // Las mismas características en ambos lados (si a uno le falta, «Sin datos»), en el orden de la ficha.
  const specs = details.map((d) => (d ? keySpecValues(d.specs) : []));
  const labels = [...new Set(specs.flat().map((s) => s.label))].slice(0, 6);
  const rows = specs.map((l) => labels.map((label) => ({ label, value: l.find((s) => s.label === label)?.value ?? null })));
  const b = details.map(benchOf);
  const comparable = b[0] && b[1] && b[0].version === b[1].version && b[0].total !== b[1].total;
  const max = Math.max(b[0]?.total ?? 0, b[1]?.total ?? 0) * 1.08 || 4_000_000;
  return (
    <main className="pres-cmp">
      {pair.map((p, k) => {
        const src = cover(p.brand, p.model, p.coverKey) ?? details[k]?.photos[0]?.url ?? null;
        return (
          <section key={p.id} className="pres-cmp-col">
            <div className="pres-cmp-top">
              <div className="pres-photo small">{src ? <img src={src} alt={`${p.brand} ${p.model}`} /> : <Icon name="phone" size={90} className="ph-icon" />}</div>
              <div className="pres-info"><Heading p={p} /><Price p={p} settings={settings} /></div>
            </div>
            {details[k] ? <Specs list={rows[k]} /> : <p className="muted">Cargando ficha…</p>}
            <Bench d={details[k]} max={max} best={!!comparable && b[k]!.total === Math.max(b[0]!.total, b[1]!.total)} />
          </section>);
      })}
      <span className="pres-vs">VS</span>
    </main>);
}

/** Elegir los 2 equipos a comparar (de los que se están mostrando, respetando marca y condición). */
function Picker({ list, chosen, onChange, onCancel, onDone, cover, settings }: { list: Product[]; chosen: Product[]; onChange: (c: Product[]) => void;
  onCancel: () => void; onDone: (a: Product, b: Product) => void; cover: ReturnType<typeof useCovers>; settings: Settings | null }) {
  const [q, setQ] = useState('');
  const toks = fold(q).split(/\s+/).filter(Boolean);
  const shown = list.filter((p) => toks.every((t) => fold(`${p.brand} ${p.model} ${variant(p)} ${p.condition === 'nuevo' ? 'nuevo' : 'cpo'}`).includes(t)));
  const toggle = (p: Product) => {
    const has = chosen.some((c) => c.id === p.id);
    if (has) return onChange(chosen.filter((c) => c.id !== p.id));
    const next = [...chosen, p].slice(-2);
    if (next.length === 2) onDone(next[0], next[1]); else onChange(next);
  };
  return (
    <div className="pres-pick" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="pres-pick-box">
        <div className="row"><h2>Elegí 2 equipos para comparar</h2><span className="spacer" />
          <span className="muted">{chosen.length} de 2</span>
          <button className="btn ghost" onClick={onCancel}>Cancelar</button></div>
        <div className="searchbar inline"><Icon name="search" size={18} />
          <input autoFocus placeholder="Buscar marca, modelo o memoria" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="pres-pick-grid">
          {shown.map((p) => {
            const on = chosen.some((c) => c.id === p.id); const src = cover(p.brand, p.model, p.coverKey) ?? p.photoUrl; const pr = dualPrice(p, settings);
            return (
              <button key={p.id} className={`pres-pick-item ${on ? 'on' : ''}`} onClick={() => toggle(p)} aria-pressed={on}>
                <span className="img">{src ? <img src={src} alt="" /> : <Icon name="phone" size={28} />}</span>
                <span className="txt"><b>{title(p)}</b><small>{[storageLabel(p.storageGb), p.condition === 'nuevo' ? 'Nuevo' : 'CPO'].filter(Boolean).join(' · ')}</small>
                  {pr.usd != null && <small className="pr">USD {num(pr.usd)}</small>}</span>
                {on && <span className="chk"><Icon name="check" size={16} /></span>}
              </button>);
          })}
          {!shown.length && <p className="muted">No hay equipos que coincidan.</p>}
        </div>
      </div>
    </div>);
}
