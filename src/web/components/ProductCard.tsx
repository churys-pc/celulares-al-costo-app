import type { Product, Settings } from '../../shared/types.ts';
import { converted, money, storageLabel } from '../format.ts';
import { Icon } from '../icons.tsx';

interface Props { p: Product; settings: Settings | null; onOpen: () => void; onFavorite?: () => void }

/** Tarjeta de catálogo: foto, modelo y precio. El detalle completo está en la ficha. */
export function ProductCard({ p, settings, onOpen, onFavorite }: Props) {
  const conv = converted(p, settings);
  const sub = [p.ramGb && p.storageGb ? `${p.ramGb}/${p.storageGb} GB` : storageLabel(p.storageGb), p.color].filter(Boolean).join(' · ');
  return (
    <article className="pcard simple" onClick={onOpen} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="pcard-img">
        {p.photoUrl ? <img src={p.photoUrl} alt={`${p.brand} ${p.model}`} loading="lazy" /> : <Icon name="phone" size={54} className="ph-icon" />}
        <div className="pcard-tags">
          <span className={`tag ${p.condition}`}>{p.condition === 'nuevo' ? 'Nuevo' : 'Usado'}</span>
        </div>
        {onFavorite && <button className={`fav ${p.favorite ? 'on' : ''}`} aria-label="Favorito"
          onClick={(e) => { e.stopPropagation(); onFavorite(); }}><Icon name="star" size={16} /></button>}
      </div>
      <h3>{p.brand === 'Apple' ? p.model : `${p.brand} ${p.model}`}</h3>
      {sub && <span className="pcard-sub">{sub}</span>}
      <div className="pprice">
        {<>
          <b><small>{p.currency}</small> {money(p.price, p.currency).replace(/^\w+ /, '')}</b>
          {conv && <span>{conv}</span>}</>}
      </div>
    </article>
  );
}
