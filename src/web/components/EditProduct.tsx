// Edición rápida desde el catálogo (solo admin): precio en dólares, estado, memoria, color y foto.
import { useState } from 'react';
import type { Product, Settings } from '../../shared/types.ts';
import { api, fileToDataUrl } from '../api.ts';
import { Icon } from '../icons.tsx';
import { useEscape } from '../useEscape.ts';

export function EditProduct({ p, settings, onClose, onSaved }: { p: Product; settings: Settings | null; onClose: () => void; onSaved: () => void }) {
  useEscape(onClose);
  const [f, setF] = useState({ price: String(p.price), condition: p.condition, ramGb: p.ramGb ? String(p.ramGb) : '', storageGb: p.storageGb ? String(p.storageGb) : '', color: p.color ?? '' });
  const [photo, setPhoto] = useState<string | null | undefined>(undefined); // undefined = sin cambios, null = quitar
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const rate = settings?.usdRate ?? null;

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      await api.quickUpdate(p.repoId!, { price: Number(f.price), condition: f.condition, ramGb: f.ramGb ? Number(f.ramGb) : null,
        storageGb: f.storageGb ? Number(f.storageGb) : null, color: f.color.trim() || null, ...(photo !== undefined ? { photo } : {}) });
      onSaved();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const preview = photo === undefined ? p.photoUrl : photo;

  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" style={{ width: 'min(520px, 96%)' }} onSubmit={save}>
        <div className="row"><h2 style={{ margin: 0, flex: 1 }}>Editar {p.brand === 'Apple' ? p.model : `${p.brand} ${p.model}`}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="x" size={18} /></button></div>
        <div className="form" style={{ marginTop: 12 }}>
          <label>Precio en dólares (USD) *<input className="input" type="number" min={1} step="any" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
            {rate && Number(f.price) > 0 && <span className="muted small">$ {Math.round(Number(f.price) * rate).toLocaleString('es-UY')} con la cotización actual</span>}</label>
          <label>Estado<select className="input" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value as Product['condition'] })}>
            <option value="nuevo">Nuevo</option><option value="usado">CPO</option></select></label>
          <label>RAM (GB)<input className="input" type="number" min={1} value={f.ramGb} onChange={(e) => setF({ ...f, ramGb: e.target.value })} /></label>
          <label>Almacenamiento (GB)<input className="input" type="number" min={1} value={f.storageGb} onChange={(e) => setF({ ...f, storageGb: e.target.value })} /></label>
          <label className="full">Color<input className="input" maxLength={40} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></label>
          <div className="full row">
            <div className="cat2-img">{preview ? <img src={preview} alt="" /> : <Icon name="phone" size={26} />}</div>
            <label className="btn">{preview ? 'Cambiar foto' : 'Agregar foto'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) try { setPhoto(await fileToDataUrl(file, 1200, 'image/jpeg')); } catch (err) { setError((err as Error).message); } }} /></label>
            {preview && <button type="button" className="btn ghost" onClick={() => setPhoto(null)}>Quitar foto</button>}
          </div>
        </div>
        <p className="muted small">La marca, el modelo y la ficha técnica no cambian. Los cambios llegan a todas las PCs.</p>
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      </form>
    </div>
  );
}
