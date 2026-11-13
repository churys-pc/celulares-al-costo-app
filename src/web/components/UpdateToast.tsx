// Aviso de actualización integrado en la app (reemplaza el diálogo nativo de Windows).
import { useEffect, useState } from 'react';
import { Icon } from '../icons.tsx';

type UpdateState = { status: string; version?: string; percent?: number; notes?: string };
type Desktop = { version(): Promise<string>; updateState(): Promise<UpdateState>; installUpdate(): Promise<void>; onUpdateState(cb: (s: UpdateState) => void): () => void };
const desktop = (window as unknown as { desktop?: Desktop }).desktop;

export function UpdateToast() {
  const [st, setSt] = useState<UpdateState | null>(null);
  const [current, setCurrent] = useState('');
  const [later, setLater] = useState<string | null>(null); // versión pospuesta en esta sesión
  useEffect(() => {
    if (!desktop) return;
    desktop.version().then(setCurrent);
    desktop.updateState().then(setSt);
    return desktop.onUpdateState(setSt);
  }, []);
  if (!desktop || !st) return null;

  if (st.status === 'installing') return (
    <div className="upd-overlay"><div className="upd-installing">
      <div className="upd-spinner" /><b>Actualizando a la versión {st.version}…</b>
      <span>La app se vuelve a abrir sola en unos segundos.</span></div></div>);

  if (st.status === 'downloading') return (
    <div className="upd-toast mini" role="status">
      <Icon name="arrow" size={16} className="accent upd-down" />
      <div className="upd-body"><b>Descargando versión {st.version}</b>
        <div className="upd-progress"><i style={{ width: `${st.percent ?? 0}%` }} /></div></div>
      <span className="upd-pct">{st.percent ?? 0}%</span>
    </div>);

  if (st.status === 'ready' && later !== st.version) return (
    <div className="upd-toast" role="dialog" aria-label="Actualización lista">
      <div className="upd-head">
        <div className="upd-badge"><Icon name="star" size={18} /></div>
        <div><b>Nueva versión {st.version} lista</b><span>Tenés la {current}. Se instala en segundos y tus datos quedan intactos.</span></div>
      </div>
      {st.notes && <div className="upd-notes"><small>Novedades</small><p>{st.notes}</p></div>}
      <div className="upd-actions">
        <button className="btn ghost" onClick={() => setLater(st.version ?? '')}>Más tarde</button>
        <button className="btn primary" onClick={() => desktop.installUpdate()}>Reiniciar y actualizar</button>
      </div>
      <small className="upd-foot">Si elegís «Más tarde», se instala sola al cerrar la app.</small>
    </div>);

  return null;
}
