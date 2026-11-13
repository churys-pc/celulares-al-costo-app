// Ajustes → Fichas técnicas (admin): qué modelos tienen ficha verificada y qué falta, primero los que están en stock.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';

type St = Awaited<ReturnType<typeof api.fichas>>;

export function FichasSection() {
  const [st, setSt] = useState<St | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { api.fichas().then(setSt).catch(() => {}); }, []);
  if (!st) return null;
  const list = all ? st.items : st.items.filter((i) => i.inStock || i.ficha);
  return (
    <div className="section"><h2>Fichas técnicas</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        {st.withFicha} de {st.total} modelos tienen ficha revisada campo por campo. Los demás muestran datos cargados de una sola fuente
        («Sin confirmar»). Los modelos nuevos aparecen acá como pendientes, primero los que están en stock.
      </p>
      <table className="fichas"><thead><tr><th>Modelo</th><th>Stock</th><th>Estado</th></tr></thead><tbody>
        {list.map((i) => (
          <tr key={i.modelId}><td><b>{i.brand} {i.model}</b>{i.ficha && <div className="muted small">{i.ficha.variant}</div>}</td>
            <td>{i.inStock ? 'En stock' : '—'}</td>
            <td>{i.ficha ? <>
              <span className="vtag v-verificado">Revisada {i.ficha.reviewedAt}</span> <span className="muted small">{i.verified} de {i.specs} datos verificados</span>
              {i.ficha.pending.length > 0 && <ul className="muted small">{i.ficha.pending.map((p) => <li key={p.key}><b>{p.key}:</b> {p.why}</li>)}</ul>}
            </> : <span className="vtag v-sin_confirmar">Pendiente de revisar</span>}</td></tr>))}
      </tbody></table>
      <button className="link" onClick={() => setAll(!all)}>{all ? 'Ver solo stock y revisadas' : `Ver los ${st.total} modelos`}</button>
    </div>
  );
}
