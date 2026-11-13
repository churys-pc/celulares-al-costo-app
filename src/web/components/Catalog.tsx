import { useCallback, useEffect, useState } from 'react';
import { USES, type Brand, type Product, type ProductDetail, type Settings } from '../../shared/types.ts';
import { api } from '../api.ts';
import { dualPrice, num, USE_LABEL } from '../format.ts';
import { Icon } from '../icons.tsx';
import { Presentation } from './Presentation.tsx';
import { ProductForm } from './ProductForm.tsx';
import { ProductSheet } from './ProductSheet.tsx';
import { EditProduct } from './EditProduct.tsx';
import { useIsAdmin } from '../session.ts';
import { useCovers } from '../covers.ts';

export function Catalog({ settings, initialQuery = '', onNew }: { settings: Settings | null; initialQuery?: string; onNew?: () => void }) {
  const cover = useCovers();
  const [items, setItems] = useState<Product[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [q, setQ] = useState(initialQuery);
  const [condition, setCondition] = useState<'' | 'nuevo' | 'usado'>('');
  const [brandId, setBrandId] = useState('');
  const [use, setUse] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [sort, setSort] = useState<'' | 'asc' | 'desc'>(() => { try { return (localStorage.getItem('catalog.sort') as any) || ''; } catch { return ''; } });
  useEffect(() => { try { localStorage.setItem('catalog.sort', sort); } catch {} }, [sort]);
  const [open, setOpen] = useState<ProductDetail | null>(null);
  const [form, setForm] = useState<{ product?: ProductDetail } | null>(null);
  const [error, setError] = useState('');
  const [present, setPresent] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, b] = await Promise.all([
        api.products({ q, condition: condition || undefined, brandId: brandId ? Number(brandId) : undefined,
          use: (use || undefined) as any, favorite, includeDemo: false }),
        api.brands(),
      ]);
      setItems(list); setBrands(b); setError('');
    } catch (e) { setError((e as Error).message); }
  }, [q, condition, brandId, use, favorite]);

  useEffect(() => { const t = setTimeout(load, 150); return () => clearTimeout(t); }, [load]);

  const openProduct = async (id: number) => setOpen(await api.product(id));
  const toggleFav = async (p: Product) => { await api.favorite(p.id, !p.favorite); load(); };
  const admin = useIsAdmin();
  const [editing, setEditing] = useState<Product | null>(null);
  const edit = (p: Product) => (p.repoId ? setEditing(p) : api.product(p.id).then((d) => setForm({ product: d })));
  async function removeProduct(p: Product) {
    if (!confirm(`¿Eliminar ${p.brand} ${p.model}${p.storageGb ? ` ${p.storageGb} GB` : ''} del catálogo? Se borra en todas las PCs.`)) return;
    try { await (p.repoId ? api.quickDelete(p.repoId) : api.remove(p.id)); setOpen(null); load(); } catch (e) { setError((e as Error).message); }
  }

  // Orden por precio comparando en dólares (los productos sin precio van al final).
  const usdOf = (p: Product) => dualPrice(p, settings).usd;
  const sorted = !sort ? items : [...items].sort((a, b) => {
    const x = usdOf(a), y = usdOf(b);
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return sort === 'asc' ? x - y : y - x;
  });
  const USE_ICON: Record<string, string> = { gaming: 'gamepad', fotos: 'camera', redes: 'chat', trabajo: 'briefcase' };

  return (
    <div className="cat2">
      <header className="page-head">
        <div><h1>Catálogo</h1></div>
        <button className="btn" onClick={() => setPresent(0)} disabled={!items.length} title="Muestra los equipos filtrados en pantalla completa para el cliente"><Icon name="screen" size={16} /> Modo presentación</button>
        {onNew && <button className="btn primary" onClick={onNew}><Icon name="plus" size={16} /> Cargar producto</button>}
      </header>
      <div className="cat2-search">
        <div className="searchbar inline"><Icon name="search" size={18} />
          <input autoFocus={!!initialQuery} placeholder="Buscar celulares" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
          <option value="">Todas las marcas</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Ordenar">
          <option value="">Ordenar: destacados</option>
          <option value="asc">Precio: menor a mayor</option>
          <option value="desc">Precio: mayor a menor</option>
        </select>
      </div>
      <div className="cat2-filters">
        <div className="cat2-seg">
          {(['', 'nuevo', 'usado'] as const).map((c) => (
            <button key={c} className={condition === c ? 'on' : ''} onClick={() => setCondition(c)}>{c === '' ? 'Todos' : c === 'nuevo' ? 'Nuevos' : 'CPO'}</button>))}
        </div>
        {USES.map((u) => <button key={u} className={`cat2-use ${use === u ? 'on' : ''}`} onClick={() => setUse(use === u ? '' : u)}><Icon name={USE_ICON[u]} size={16} /> {USE_LABEL[u]}</button>)}
        <button className={`cat2-fav ${favorite ? 'on' : ''}`} onClick={() => setFavorite(!favorite)}><Icon name="star" size={16} /> Favoritos</button>
      </div>
      <div className="cat2-count"><b>{items.length} equipos</b>
        {!settings?.usdRate && <span className="cat2-warn">Cargá la cotización del dólar en Ajustes para ver los precios en pesos.</span>}</div>
      {error && <p className="error">{error}</p>}
      {items.length === 0 ? <div className="empty">No hay productos con estos filtros.</div> : (
        <div className={`cat2-table ${admin ? 'admin' : ''}`}>
          <div className="cat2-tr th"><div>Equipo</div><div>Estado</div><div className="r">Precio</div><div className="r">Acciones</div></div>
          {sorted.map((p) => {
            const pr = dualPrice(p, settings);
            const sub = [p.brand, p.ramGb && p.storageGb ? `${p.ramGb}/${p.storageGb} GB` : p.storageGb ? `${p.storageGb} GB` : null, p.color].filter(Boolean).join(' · ');
            return (
              <div key={p.id} className="cat2-tr" onClick={() => openProduct(p.id)}>
                <div className="cat2-eq">
                  <div className="cat2-img">{(cover(p.brand, p.model, p.coverKey) ?? p.photoUrl) ? <img src={cover(p.brand, p.model, p.coverKey) ?? p.photoUrl!} alt={`${p.brand} ${p.model}`} loading="lazy" /> : <Icon name="phone" size={28} />}</div>
                  <div><h3>{p.model}</h3>
                    <span className="muted small">{sub}</span></div>
                </div>
                <div><span className={`cat2-pill ${p.condition}`}><i />{p.condition === 'nuevo' ? 'Nuevo' : 'CPO'}</span></div>
                <div className="r cat2-price">
                  {pr.usd === null && pr.uyu === null ? <span className="muted small">Sin precio</span> : <>
                    {pr.usd !== null && <b><small>USD</small> {num(pr.usd)}</b>}
                    {pr.uyu !== null && <span className="cat2-uyu">$ {num(pr.uyu)}</span>}</>}
                </div>
                <div className="r cat2-act" onClick={(e) => e.stopPropagation()}>
                  <button className={`cat2-star ${p.favorite ? 'on' : ''}`} aria-label="Favorito" onClick={() => toggleFav(p)}><Icon name="star" size={16} /></button>
                  {admin && <button className="cat2-star" title="Editar" aria-label="Editar" onClick={() => edit(p)}><Icon name="edit" size={16} /></button>}
                  {admin && <button className="cat2-star del" title="Eliminar" aria-label="Eliminar" onClick={() => removeProduct(p)}><Icon name="trash" size={16} /></button>}
                  <button className="cat2-see" onClick={() => openProduct(p.id)}>Ver equipo <Icon name="right" size={14} /></button>
                </div>
              </div>);
          })}
        </div>)}

      {open && <ProductSheet key={open.id} product={open} settings={settings} onClose={() => setOpen(null)}
        onEdit={() => { const o = open; setOpen(null); if (o.repoId) setEditing(o); else setForm({ product: o }); }} onDelete={() => removeProduct(open)} onChanged={load}
        onPresent={() => { const k = sorted.findIndex((x) => x.id === open.id); setOpen(null); setPresent(Math.max(0, k)); }} />}
      {present !== null && <Presentation items={sorted} start={present} settings={settings} onClose={() => setPresent(null)} />}
      {form && <ProductForm product={form.product} brands={brands} settings={settings} onClose={() => setForm(null)}
        onSaved={(p) => { setForm(null); load(); setOpen(p); }} />}
      {editing && <EditProduct p={editing} settings={settings} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
