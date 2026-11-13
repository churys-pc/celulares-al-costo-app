import { useState } from 'react';
import { PHOTO_LICENSE_LABEL, PHOTO_LICENSES, SPEC_GROUPS, SPEC_STATUSES, SPEC_STATUS_LABEL, type SpecStatus, type Photo, type ProductDetail, type Settings, type Spec } from '../../shared/types.ts';
import { api, fileToDataUrl } from '../api.ts';
import { useIsAdmin } from '../session.ts';
import { iosSupport, IOS_SOURCE } from '../../shared/iosSupport.ts';
import { Icon } from '../icons.tsx';
import { useCovers } from '../covers.ts';
import { keySpecValues, prioritySort } from '../../shared/keySpecs.ts';
import { SPEC_TEMPLATE } from '../../shared/specTemplate.ts';
import { converted, money, STATUS_LABEL, USE_LABEL, variantLabel } from '../format.ts';

interface Props { product: ProductDetail; settings: Settings | null; onClose: () => void; onEdit: () => void; onDelete?: () => void; onChanged: () => void; onPresent?: () => void }

export function ProductSheet({ product: p, settings, onClose, onEdit, onDelete, onChanged, onPresent }: Props) {
  const ios = iosSupport(p.brand, p.model);
  const cover = useCovers();
  const admin = useIsAdmin();
  const [showAll, setShowAll] = useState(true);
  const [editing, setEditing] = useState(false);
  const [specs, setSpecs] = useState<Spec[]>(p.specs);
  const highlights = keySpecValues(specs);
  const conv = converted(p, settings);

  async function remove() {
    if (!confirm(`¿Eliminar ${p.brand} ${p.model}? Esta acción no se puede deshacer.`)) return;
    await api.remove(p.id); onChanged(); onClose();
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <div className="row">
          <span className={`badge ${p.condition}`}>{p.condition === 'nuevo' ? 'Nuevo' : 'Usado'}</span>
          <span className="badge">{STATUS_LABEL[p.status]}</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <h2 style={{ margin: '10px 0 2px' }}>{p.brand} {p.model}</h2>
        <div className="muted">{variantLabel(p) || 'Variante sin detallar'}</div>
        <Gallery productId={p.id} initial={p.photos} cover={cover(p.brand, p.model)} label={`${p.brand} ${p.model}`} onChanged={onChanged} readOnly={!!p.repoId || !admin} />
        <div className="row">
          <span className="price">{money(p.price, p.currency)}</span>
          {conv && <span className="muted small">≈ {conv} (cotización manual)</span>}
        </div>
        <div className="muted small" style={{ marginTop: 4 }}>
          Stock {p.stock} · Garantía {p.warrantyMonths} meses{p.cost !== null && ` · Costo ${money(p.cost, p.currency)}`}
        </div>
        {p.uses.length > 0 && <div className="row" style={{ marginTop: 8 }}>{p.uses.map((u) => <span key={u} className="badge">Ideal para {USE_LABEL[u]}</span>)}</div>}
        {p.notes && !p.repoId && <p className="muted">{p.notes}</p>}

        <h3 style={{ marginTop: 20 }}>Ficha técnica</h3>
        {highlights.length ? (
          <div className="highlights">{highlights.map((s) => <div key={s.label} className="hl"><b>{s.label}</b>{s.value}</div>)}</div>
        ) : <p className="muted small">Sin especificaciones principales cargadas. Cargalas con "Editar ficha" (con fuente y fecha).</p>}
        {ios && <div className="ios-box">
          <span className="ios-ico"><Icon name="shield" size={18} /></span>
          <div><b>Actualizaciones de iOS</b><span>{ios.label}</span>
            <small className="muted">{ios.estimate} · Fuente: <a href={IOS_SOURCE.url} target="_blank" rel="noreferrer">{IOS_SOURCE.name}</a></small></div>
        </div>}

        <div className="row">
          {specs.length > 0 && <button className="btn" onClick={() => setShowAll(!showAll)}>{showAll ? 'Ocultar' : 'Ver todas las especificaciones'}</button>}
          {admin && <button className="btn" onClick={() => setEditing(!editing)}>{editing ? 'Cerrar editor' : 'Editar ficha'}</button>}
        </div>
        {showAll && !editing && <AllSpecs specs={specs} />}
        {editing && <SpecEditor modelId={p.modelId} initial={specs} onSaved={(s) => { setSpecs(s); setEditing(false); onChanged(); }} />}

        <div className="row" style={{ marginTop: 24 }}>
          {onPresent && <button className="btn" onClick={onPresent}><Icon name="screen" size={16} /> Presentar al cliente</button>}
          {admin && <>
            <button className="btn primary" onClick={onEdit}><Icon name="edit" size={16} /> Editar producto</button>
            <button className="btn danger" onClick={onDelete ?? remove}><Icon name="trash" size={16} /> Eliminar</button></>}
        </div>
      </aside>
    </div>
  );
}

/** Las etiquetas de estado (Verificado / Sin confirmar / No compatible…) no se muestran (pedido del usuario);
 *  el estado sigue guardado en cada dato y se edita en «Editar ficha». */
export function StatusTag(_: { status?: SpecStatus }) {
  return null;
}

export function AllSpecs({ specs }: { specs: Spec[] }) {
  // Fuentes únicas de la ficha, numeradas para referenciarlas en cada dato.
  const all: { name: string; url: string | null; date: string | null }[] = [];
  const refOf = (n: string | null, u: string | null, d: string | null) => {
    if (!n) return null;
    let i = all.findIndex((x) => x.name === n && x.url === u);
    if (i < 0) { all.push({ name: n, url: u, date: d }); i = all.length - 1; }
    return i + 1;
  };
  const rows = prioritySort(specs).map((s) => ({ s, refs: [refOf(s.sourceName, s.sourceUrl, s.sourceDate), ...(s.extraSources ?? []).map((x) => refOf(x.name, x.url, x.date))].filter(Boolean) }));
  return <>{SPEC_GROUPS.filter((g) => specs.some((s) => s.group === g)).map((g) => (
    <div key={g} className="spec-group"><h4>{g}</h4>
      <table className="specs"><tbody>{rows.filter((r) => r.s.group === g).map(({ s, refs }, i) => (
        <tr key={i}><td>{s.key}</td><td>{s.value} <StatusTag status={s.status} />
          {refs.length > 0 && <sup className="muted"> [{refs.join(', ')}]</sup>}
          {s.note && <div className="muted small">{s.note}</div>}
          {!s.sourceName && <div className="muted small">Sin fuente</div>}
        </td></tr>))}</tbody></table>
    </div>))}
    {all.length > 0 && <div className="spec-sources"><h4>Fuentes</h4><ol>{all.map((x, i) => (
      <li key={i}>{x.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.name}</a> : x.name}{x.date && <span className="muted"> · consultada {x.date}</span>}</li>))}</ol></div>}
  </>;
}

const blank = (): Spec => ({ group: 'Chip', key: '', value: '', highlight: false, sourceName: '', sourceUrl: '', sourceDate: '' });

export function SpecEditor({ modelId, initial, onSaved }: { modelId: number; initial: Spec[]; onSaved: (s: Spec[]) => void }) {
  const [rows, setRows] = useState<Spec[]>(initial.length ? initial.map((s) => ({ ...s })) : [blank()]);
  const [src, setSrc] = useState({ sourceName: '', sourceUrl: '', sourceDate: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState('');
  const upd = (i: number, k: keyof Spec, v: unknown) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  async function save() {
    setError('');
    const clean = rows.filter((r) => r.key.trim() && r.value.trim()).map((r) =>
      // Filas nuevas sin fuente heredan la fuente común indicada abajo.
      !r.sourceName && src.sourceName ? { ...r, ...src } : r);
    try { onSaved(await api.saveSpecs(modelId, clean)); } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="section" style={{ marginTop: 12, padding: 12 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <p className="muted small" style={{ margin: 0, flex: 1 }}>Cargá solo datos verificados. ★ = aparece en la ficha breve.</p>
        <button type="button" className="btn ghost" title="Agrega las características principales estándar que falten"
          onClick={() => {
            const have = new Set(rows.map((r) => r.key.trim().toLowerCase()));
            const add = SPEC_TEMPLATE.filter((t) => !have.has(t.key.toLowerCase()))
              .map((t) => ({ ...blank(), group: t.group, key: t.key, highlight: !!t.highlight }));
            setRows([...rows.filter((r) => r.key.trim() || r.value.trim()), ...add]);
          }}>Usar plantilla estándar</button>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="spec-edit">
          <select className="input" value={r.group} onChange={(e) => upd(i, 'group', e.target.value)}>
            {SPEC_GROUPS.map((g) => <option key={g}>{g}</option>)}</select>
          <input className="input" placeholder="Especificación" value={r.key} onChange={(e) => upd(i, 'key', e.target.value)} />
          <input className="input" placeholder={SPEC_TEMPLATE.find((t) => t.key === r.key)?.hint ?? 'Valor'} value={r.value} onChange={(e) => upd(i, 'value', e.target.value)} />
          <select className="input" value={r.status ?? 'sin_confirmar'} onChange={(e) => upd(i, 'status', e.target.value)} title="Estado del dato">
            {SPEC_STATUSES.map((st) => <option key={st} value={st}>{SPEC_STATUS_LABEL[st]}</option>)}</select>
          <button type="button" className={`icon-btn ${r.highlight ? 'on' : ''}`} title="Destacar" onClick={() => upd(i, 'highlight', !r.highlight)}>★</button>
        </div>))}
      <button className="btn ghost" onClick={() => setRows([...rows, blank()])}>+ Agregar fila</button>
      <div className="form" style={{ marginTop: 12 }}>
        <label>Fuente (para filas sin fuente)<input className="input" value={src.sourceName} placeholder="Ej.: Sitio oficial del fabricante" onChange={(e) => setSrc({ ...src, sourceName: e.target.value })} /></label>
        <label>Fecha de consulta<input className="input" type="date" value={src.sourceDate} onChange={(e) => setSrc({ ...src, sourceDate: e.target.value })} /></label>
        <label className="full">URL de la fuente<input className="input" value={src.sourceUrl} placeholder="https://…" onChange={(e) => setSrc({ ...src, sourceUrl: e.target.value })} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" style={{ marginTop: 10 }} onClick={save}>Guardar ficha</button>
    </div>
  );
}

function Gallery({ productId, initial, cover, label, onChanged, readOnly }: { productId: number; initial: Photo[]; cover: string | null; label: string; onChanged: () => void; readOnly?: boolean }) {
  const [photos, setPhotos] = useState(initial);
  // -1 = portada oficial del modelo; 0..n = fotos reales de la unidad.
  const [sel, setSel] = useState(cover ? -1 : 0);
  const [license, setLicense] = useState<string>('');
  const [zoom, setZoom] = useState(false);
  const [error, setError] = useState('');
  const onCover = !!cover && (sel === -1 || !photos.length);
  const cur = onCover ? null : photos[Math.min(Math.max(sel, 0), photos.length - 1)];
  const mainSrc = onCover ? cover : cur?.url;

  async function upload(files: FileList | null) {
    setError('');
    if (!license) { setError('Primero indicá el origen de las fotos (no se aceptan imágenes sin derechos).'); return; }
    try {
      let list = photos;
      for (const f of Array.from(files ?? [])) list = await api.addPhoto(productId, await fileToDataUrl(f), license);
      setPhotos(list); onChanged();
    } catch (e) { setError((e as Error).message); }
  }
  async function remove(ph: Photo) {
    if (!confirm('¿Eliminar esta foto?')) return;
    await api.removePhoto(ph.id); setPhotos(photos.filter((x) => x.id !== ph.id)); setSel(0); onChanged();
  }

  return (
    <div className="gallery">
      <div className="g-main" onClick={() => mainSrc && setZoom(true)}>
        {mainSrc ? <img src={mainSrc} alt={label} className={onCover ? 'cover' : ''} /> : <div className="g-empty"><Icon name="image" size={40} /><span>Sin fotos cargadas</span></div>}
      </div>
      {onCover ? <div className="muted small">Portada oficial del modelo (imagen del fabricante){photos.length ? ' · las fotos de la unidad están abajo' : ''}</div>
        : cur && <div className="muted small">Foto de la unidad · Origen: {PHOTO_LICENSE_LABEL[cur.license]}</div>}
      <div className="g-thumbs">
        {cover && photos.length > 0 && <div className={`g-thumb cover ${onCover ? 'on' : ''}`} onClick={() => setSel(-1)} title="Portada oficial"><img src={cover} alt="" /></div>}
        {photos.map((ph, i) => (
          <div key={ph.id} className={`g-thumb ${!onCover && i === sel ? 'on' : ''}`} onClick={() => setSel(i)}>
            <img src={ph.url} alt="" loading="lazy" />
            {!readOnly && <button className="g-del" onClick={(e) => { e.stopPropagation(); remove(ph); }} aria-label="Eliminar foto"><Icon name="x" size={12} /></button>}
          </div>))}
        {!readOnly && photos.length < 5 && (
          <div className="g-add">
            <select className="input" value={license} onChange={(e) => setLicense(e.target.value)}>
              <option value="">Origen de la foto…</option>
              {PHOTO_LICENSES.map((l) => <option key={l} value={l}>{PHOTO_LICENSE_LABEL[l]}</option>)}
            </select>
            <label className="btn"><Icon name="plus" size={14} /> Agregar ({photos.length}/5)
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></label>
          </div>)}
      </div>
      {error && <p className="error">{error}</p>}
      {zoom && mainSrc && <div className="zoom" onClick={() => setZoom(false)}><img src={mainSrc} alt={label} /></div>}
    </div>
  );
}
