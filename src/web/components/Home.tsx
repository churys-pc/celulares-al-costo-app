import { useEffect, useRef, useState } from 'react';
import type { Product, ProductDetail, Settings, Stats } from '../../shared/types.ts';
import { api } from '../api.ts';
import { Icon, type IconName } from '../icons.tsx';
import { SECTIONS, type Nav } from '../sections.ts';
import { ProductCard } from './ProductCard.tsx';
import { ProductSheet } from './ProductSheet.tsx';

const nf = (n: number) => n.toLocaleString('es-UY');

export function Home({ settings, go }: { settings: Settings | null } & Nav) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [featured, setFeatured] = useState<Product[]>([]);
  const [open, setOpen] = useState<ProductDetail | null>(null);
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const load = () => {
    api.stats(false).then(setStats).catch(() => {});
    api.products({ includeDemo: false }).then((l) => setFeatured(l.filter((p) => p.stock > 0 && p.status === 'disponible').slice(0, 10))).catch(() => {});
  };
  useEffect(load, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scroll = (dir: number) => railRef.current?.scrollBy({ left: dir * railRef.current.clientWidth * 0.9, behavior: 'smooth' });
  const kpis: { icon: IconName; label: string; value: string; note?: string }[] = [
    { icon: 'phone', label: 'Productos', value: stats ? nf(stats.products) : '…' },
    { icon: 'cart', label: 'Ventas (hoy)', value: stats?.salesToday != null ? nf(stats.salesToday) : '—', note: stats?.salesToday == null ? 'Módulo de ventas pendiente' : undefined },
    { icon: 'box', label: 'Stock total', value: stats ? nf(stats.stockTotal) : '…' },
    { icon: 'swap', label: 'Tasaciones', value: stats?.tradeInsInProgress != null ? nf(stats.tradeInsInProgress) : '—', note: 'En proceso' },
  ];

  return (
    <>
      <header className="page-head">
        <div><h1>Inicio</h1><p className="sub">{settings?.slogan}</p></div>
        <form className="searchbar" onSubmit={(e) => { e.preventDefault(); go('catalogo', q.trim()); }}>
          <Icon name="search" size={18} />
          <input ref={searchRef} placeholder="Buscar modelos, marcas o IMEI…" value={q} onChange={(e) => setQ(e.target.value)} />
          <kbd>Ctrl + K</kbd>
        </form>
      </header>

      <section className="kpis">
        {kpis.map((k) => (
          <div key={k.label} className="kpi">
            <div className="kpi-icon"><Icon name={k.icon} size={22} /></div>
            <div><span>{k.label}</span><b>{k.value}</b>{k.note && <small>{k.note}</small>}</div>
          </div>))}
      </section>

      <section>
        <div className="sec-head">
          <h2><Icon name="flame" size={20} className="accent" />Destacados del catálogo</h2>
          <button className="link" onClick={() => go('catalogo')}>Ver catálogo completo <Icon name="arrow" size={14} /></button>
        </div>
        {featured.length ? (
          <div className="rail-wrap">
            <button className="rail-btn left" onClick={() => scroll(-1)} aria-label="Anterior"><Icon name="left" size={18} /></button>
            <div className="rail" ref={railRef}>
              {featured.map((p) => <ProductCard key={p.id} p={p} settings={settings} onOpen={async () => setOpen(await api.product(p.id))} />)}
            </div>
            <button className="rail-btn right" onClick={() => scroll(1)} aria-label="Siguiente"><Icon name="right" size={18} /></button>
          </div>
        ) : <div className="empty small-empty">Todavía no hay productos con stock. <button className="link" onClick={() => go('catalogo')}>Cargar productos</button></div>}
      </section>

      <section>
        <div className="sec-head"><h2><Icon name="layers" size={20} className="accent" />Herramientas principales</h2></div>
        <div className="tools">
          {(['comparador', 'identificar', 'diagnostico', 'imei', 'tasacion'] as const).map((id) => {
            const s = SECTIONS.find((x) => x.id === id)!;
            const title = { comparador: 'Comparador avanzado', identificar: 'Identificación visual', diagnostico: 'Diagnóstico iPhone (vía QR)', imei: 'Verificación de IMEI', tasacion: 'Tasación de usados' }[id];
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
        onEdit={() => { setOpen(null); go('catalogo', `${open.brand} ${open.model}`); }} onChanged={load} />}
    </>
  );
}
