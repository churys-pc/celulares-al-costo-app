import { useState } from 'react';
import { CONDITIONS, PRODUCT_STATUS, USES, type Brand, type ProductDetail, type ProductInput, type Settings } from '../../shared/types.ts';
import { api } from '../api.ts';
import { STATUS_LABEL, USE_LABEL } from '../format.ts';

interface Props { product?: ProductDetail; brands: Brand[]; settings: Settings | null; onClose: () => void; onSaved: (p: ProductDetail) => void }

export function ProductForm({ product: p, brands, settings, onClose, onSaved }: Props) {
  const [f, setF] = useState<any>(() => p ? {
    brand: p.brand, model: p.model, storageGb: p.storageGb ?? '', ramGb: p.ramGb ?? '', region: p.region ?? '',
    color: p.color ?? '', condition: p.condition, status: p.status, price: p.price, currency: p.currency,
    cost: p.cost ?? '', stock: p.stock, warrantyMonths: p.warrantyMonths, notes: p.notes, uses: p.uses, favorite: p.favorite,
  } : { brand: '', model: '', storageGb: '', ramGb: '', region: '', color: '', condition: 'nuevo', status: 'disponible',
    price: '', currency: settings?.defaultCurrency ?? 'USD', cost: '', stock: 1, warrantyMonths: 12, notes: '', uses: [], favorite: false });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const toggleUse = (u: string) => setF({ ...f, uses: f.uses.includes(u) ? f.uses.filter((x: string) => x !== u) : [...f.uses, u] });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try { onSaved(p ? await api.update(p.id, f as ProductInput) : await api.create(f as ProductInput)); }
    catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>{p ? 'Editar producto' : 'Nuevo producto'}</h2>
        <div className="form">
          <label>Marca *<input className="input" list="brands" value={f.brand} onChange={set('brand')} required maxLength={60} /></label>
          <datalist id="brands">{brands.map((b) => <option key={b.id} value={b.name} />)}</datalist>
          <label>Modelo *<input className="input" value={f.model} onChange={set('model')} required maxLength={80} /></label>
          <label>Almacenamiento (GB)<input className="input" type="number" min={1} value={f.storageGb} onChange={set('storageGb')} /></label>
          <label>RAM (GB)<input className="input" type="number" min={1} value={f.ramGb} onChange={set('ramGb')} /></label>
          <label>Color<input className="input" value={f.color} onChange={set('color')} maxLength={40} /></label>
          <label>Región / modelo regional<input className="input" value={f.region} onChange={set('region')} maxLength={40} placeholder="Ej.: LL/A, global" /></label>
          <label>Condición<select className="input" value={f.condition} onChange={set('condition')}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c === 'nuevo' ? 'Nuevo' : 'Usado'}</option>)}</select></label>
          <label>Estado<select className="input" value={f.status} onChange={set('status')}>
            {PRODUCT_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
          <label>Precio de venta *<input className="input" type="number" min={0} step="any" value={f.price} onChange={set('price')} required /></label>
          <label>Moneda<select className="input" value={f.currency} onChange={set('currency')}><option>USD</option><option>UYU</option></select></label>
          <label>Costo (interno)<input className="input" type="number" min={0} step="any" value={f.cost} onChange={set('cost')} /></label>
          <label>Stock<input className="input" type="number" min={0} value={f.stock} onChange={set('stock')} /></label>
          <label>Garantía (meses)<input className="input" type="number" min={0} max={120} value={f.warrantyMonths} onChange={set('warrantyMonths')} /></label>
          <label className="full">Ideal para
            <div className="row">{USES.map((u) => (
              <button type="button" key={u} className={`chip ${f.uses.includes(u) ? 'on' : ''}`} onClick={() => toggleUse(u)}>{USE_LABEL[u]}</button>))}
            </div></label>
          <label className="full">Notas<textarea className="input" rows={3} value={f.notes} onChange={set('notes')} maxLength={2000} /></label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  );
}
