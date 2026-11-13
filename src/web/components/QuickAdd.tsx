// Sección «Cargar productos»: nombre + precio + foto → ficha y descripción automáticas → repo de GitHub.
import { useEffect, useRef, useState } from 'react';
import type { Product, Settings } from '../../shared/types.ts';
import { api, fileToDataUrl } from '../api.ts';
import { money } from '../format.ts';
import { Icon } from '../icons.tsx';
import { useCovers } from '../covers.ts';

type Match = { slug: string; name: string; brand: string; model: string; url: string; specs: { group: string; key: string; value: string; highlight: boolean }[];
  antutu: { version: string; total: number } | null; description: string };
const EMPTY = { id: '', name: '', price: '', currency: 'USD', condition: 'nuevo', description: '' }; // El precio se carga siempre en dólares.

export function QuickAdd({ settings }: { settings: Settings | null }) {
  const cover = useCovers();
  const [f, setF] = useState<any>({ ...EMPTY });
  const [photo, setPhoto] = useState<string | null | undefined>(undefined); // undefined = sin cambios
  const [match, setMatch] = useState<Match | null>(null);
  const [cands, setCands] = useState<{ slug: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState(''); const [error, setError] = useState('');
  const [list, setList] = useState<Product[]>([]);
  const [repo, setRepo] = useState<Awaited<ReturnType<typeof api.repoStatus>> | null>(null);
  const descTouched = useRef(false);
  const [q, setQ] = useState('');
  // Búsqueda en la lista de cargados: marca, modelo, memoria y estado.
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const shown = list.filter((p) => norm(`${p.brand} ${p.model} ${p.ramGb ?? ''}/${p.storageGb ?? ''} ${p.storageGb ?? ''}gb ${p.condition}`).includes(norm(q.trim())));

  const load = () => { api.products({}).then((l) => setList(l.filter((p) => p.repoId))).catch(() => {}); api.repoStatus().then(setRepo).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, []);

  async function search(slug?: string) {
    if (f.name.trim().length < 3) return;
    setSearching(true); setError('');
    try {
      const r = await api.quickPreview(f.name, slug);
      setCands(r.candidates); setMatch(r.match);
      if (r.match && !descTouched.current) setF((x: any) => ({ ...x, description: r.match!.description }));
      if (!r.match) setError('No encontré ese equipo en internet. Podés guardarlo igual con tu descripción.');
    } catch (e) { setError((e as Error).message); } finally { setSearching(false); }
  }
  // Busca solo al dejar de escribir el nombre.
  useEffect(() => { if (f.id) return; const t = setTimeout(() => search(), 900); return () => clearTimeout(t); }, [f.name]);

  function reset() { setF({ ...EMPTY }); setPhoto(undefined); setMatch(null); setCands([]); descTouched.current = false; }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(''); setMsg('');
    try {
      await api.quickSave({ ...f, id: f.id || undefined, match, photo });
      setMsg(f.id ? 'Producto actualizado.' : 'Producto cargado. Se sube al repositorio automáticamente.');
      reset(); load();
    } catch (err) { setError((err as Error).message); }
  }
  async function edit(p: Product) {
    const d = await api.product(p.id);
    setF({ id: p.repoId, name: `${p.brand} ${p.model}${p.ramGb && p.storageGb ? ` ${p.ramGb}/${p.storageGb}` : p.storageGb ? ` ${p.storageGb}GB` : ''}`, price: p.currency === 'USD' ? p.price : settings?.usdRate ? Math.round(p.price / settings.usdRate) : p.price, currency: 'USD', condition: p.condition, description: p.description });
    descTouched.current = true; setPhoto(undefined); setCands([]);
    setMatch(d.specs.length ? { slug: '', name: `${p.brand} ${p.model}`, brand: p.brand, model: p.model, url: d.specs[0].sourceUrl ?? '',
      specs: d.specs.map(({ group, key, value, highlight }) => ({ group, key, value, highlight })), antutu: d.benchmarks[0] ?? null, description: p.description } : null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function remove(p: Product) {
    if (!confirm(`¿Eliminar ${p.brand} ${p.model} del catálogo? Se borra en todas las PCs.`)) return;
    await api.quickDelete(p.repoId!); load();
  }

  const hl = match?.specs.filter((s) => ['Procesador', 'Tamaño y tipo', 'Cámara principal', 'Batería', 'Carga rápida', 'RAM'].includes(s.key)) ?? [];
  return (
    <>
      <header className="page-head">
        <div><h1>Cargar productos</h1><p className="sub">Nombre, precio y foto: la ficha y la descripción se completan solas.</p></div>
        {repo && <RepoChip st={repo} onSync={async () => setRepo(await api.repoSync())} />}
      </header>
      <div className="qa">
        <form className="section qa-form" onSubmit={save}>
          <h2>{f.id ? 'Editar producto' : 'Nuevo producto'}</h2>
          <div className="form">
            <label className="full">Nombre del equipo *
              <div className="row tight" style={{ flexWrap: 'nowrap' }}>
                <input className="input" style={{ flex: 1 }} required maxLength={80} value={f.name} placeholder="Ej.: Samsung Galaxy A55 8/256"
                  onChange={(e) => setF({ ...f, name: e.target.value })} />
                <button type="button" className="btn" onClick={() => search()} disabled={searching}><Icon name="search" size={14} /> {searching ? 'Buscando…' : 'Buscar ficha'}</button>
              </div></label>
            {cands.length > 1 && (
              <label className="full">Coincidencia
                <select className="input" value={match?.slug ?? ''} onChange={(e) => search(e.target.value)}>
                  {cands.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </select></label>)}
            <label>Precio en dólares (USD) *<input className="input" type="number" min={1} step="any" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
            <div className="qa-uyu"><span className="muted small">En pesos (catálogo)</span>
              <b>{settings?.usdRate ? (Number(f.price) > 0 ? `$ ${Math.round(Number(f.price) * settings.usdRate).toLocaleString('es-UY')}` : '—') : 'Falta la cotización en Ajustes'}</b>
              {settings?.usdRate ? <span className="muted small">Cotización: $ {settings.usdRate.toLocaleString('es-UY')}</span> : null}</div>
            <label>Condición<select className="input" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}><option value="nuevo">Nuevo</option><option value="usado">CPO</option></select></label>
            <label>Foto (opcional)
              <div className="row tight">
                <label className="btn"><Icon name="image" size={14} /> {photo ? 'Cambiar' : 'Elegir foto'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => {
                    const file = e.target.files?.[0]; e.target.value = '';
                    if (file) try { setPhoto(await fileToDataUrl(file, 1200, 'image/jpeg')); } catch (err) { setError((err as Error).message); } }} /></label>
                {photo && <img src={photo} alt="" className="qa-thumb" />}
                {f.id && photo !== null && <button type="button" className="link" onClick={() => setPhoto(null)}>Quitar foto</button>}
              </div></label>
            <label className="full">Descripción (generada, podés editarla)
              <textarea className="input" rows={4} maxLength={1500} value={f.description} placeholder="Se completa al encontrar la ficha."
                onChange={(e) => { descTouched.current = true; setF({ ...f, description: e.target.value }); }} /></label>
          </div>
          {match && (
            <div className="qa-match">
              <div className="row"><Icon name="layers" size={16} className="accent" /><b>{match.name}</b>
                {match.antutu && <span className="tag outline">AnTuTu {match.antutu.version.toUpperCase()}: {match.antutu.total.toLocaleString('es-UY')}</span>}
                {match.url && <a href={match.url} target="_blank" rel="noreferrer" className="small">Fuente</a>}</div>
              <ul>{hl.map((s) => <li key={s.key}><span>{s.key}</span>{s.value}</li>)}</ul>
              <span className="muted small">{match.specs.length} especificaciones se guardan con el producto.</span>
            </div>)}
          {error && <p className="error">{error}</p>}
          {msg && <p style={{ color: 'var(--ok)' }}>{msg}</p>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            {f.id && <button type="button" className="btn ghost" onClick={reset}>Cancelar edición</button>}
            <button type="submit" className="btn primary"><Icon name="plus" size={16} /> {f.id ? 'Guardar cambios' : 'Cargar producto'}</button>
          </div>
        </form>

        <section className="qa-list">
          <h2>Cargados ({q ? `${shown.length} de ${list.length}` : list.length})</h2>
          {list.length > 0 && <div className="searchbar inline qa-search"><Icon name="search" size={18} />
            <input placeholder="Buscar en los cargados (marca, modelo, memoria…)" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
          {!list.length && <div className="empty small-empty">Todavía no cargaste productos.</div>}
          {list.length > 0 && !shown.length && <div className="empty small-empty">Ningún producto coincide con «{q}».</div>}
          {shown.map((p) => (
            <div key={p.id} className="qa-item">
              <div className="qa-img">{(cover(p.brand, p.model, p.coverKey) ?? p.photoUrl) ? <img src={cover(p.brand, p.model, p.coverKey) ?? p.photoUrl!} alt="" /> : <Icon name="phone" size={22} className="ph-icon" />}</div>
              <div className="qa-info"><b>{p.brand} {p.model}</b><span className="muted small">{[p.ramGb && `${p.ramGb} GB RAM`, p.storageGb && `${p.storageGb} GB`, p.condition === 'nuevo' ? 'Nuevo' : 'CPO'].filter(Boolean).join(' · ')}</span></div>
              <b className="qa-price">{money(p.price, p.currency)}{p.currency === 'USD' && settings?.usdRate ? <small className="muted"> · $ {Math.round(p.price * settings.usdRate).toLocaleString('es-UY')}</small> : null}</b>
              <button className="icon-btn" title="Editar" onClick={() => edit(p)}><Icon name="edit" size={16} /></button>
              <button className="icon-btn" title="Eliminar" onClick={() => remove(p)}><Icon name="trash" size={16} /></button>
            </div>))}
        </section>
      </div>
    </>
  );
}

export function RepoChip({ st, onSync }: { st: { ok: boolean; at: string | null; message: string; pending: number; hasToken: boolean }; onSync: () => void }) {
  const cls = !st.hasToken ? 'warn' : st.ok && !st.pending ? 'ok' : st.ok ? 'busy' : 'bad';
  const text = !st.hasToken ? 'Falta conectar GitHub (Ajustes)' : st.pending ? `${st.pending} cambios por subir` : st.ok ? 'Sincronizado con GitHub' : st.message;
  return <button className={`repo-chip ${cls}`} onClick={onSync} title={`${st.message}${st.at ? ' · ' + new Date(st.at).toLocaleString('es-UY') : ''}`}><i />{text}</button>;
}
