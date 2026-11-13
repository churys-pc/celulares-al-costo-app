// Modo presentación para clientes: pantalla completa, un equipo por vez, sin datos internos (costo, notas).
import { useCallback, useEffect, useState } from 'react';
import type { Product, ProductDetail, Settings } from '../../shared/types.ts';
import { api } from '../api.ts';
import { converted, money, storageLabel, USE_LABEL } from '../format.ts';
import { Icon, SPEC_ICON } from '../icons.tsx';
import { useCovers } from '../covers.ts';
import { keySpecValues } from '../../shared/keySpecs.ts';

const AUTO_MS = 8000;
const nf = (n: number) => n.toLocaleString('es-UY');

const LABEL_GROUP: Record<string, string> = { Procesador: 'Chip', RAM: 'Memoria', Almacenamiento: 'Memoria', Pantalla: 'Pantalla',
  'Cámara principal': 'Cámaras', 'Cámara frontal': 'Cámaras', Batería: 'Batería y carga', Carga: 'Batería y carga', 'Red móvil': 'Conectividad' };

export function Presentation({ items, start = 0, settings, onClose }: { items: Product[]; start?: number; settings: Settings | null; onClose: () => void }) {
  const cover = useCovers();
  const list = items.filter((p) => p.status === 'disponible' && p.stock > 0);
  const [i, setI] = useState(() => Math.max(0, list.findIndex((p) => p.id === items[start]?.id)));
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [photo, setPhoto] = useState(0);
  const [auto, setAuto] = useState(false);
  const go = useCallback((d: number) => { setI((x) => (x + d + list.length) % list.length); setPhoto(0); }, [list.length]);
  const close = useCallback(() => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); onClose(); }, [onClose]);

  useEffect(() => { document.documentElement.requestFullscreen?.().catch(() => {}); }, []);
  useEffect(() => { const p = list[i]; if (p) api.product(p.id).then(setDetail).catch(() => setDetail(null)); }, [i, list.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === ' ') { e.preventDefault(); setAuto((a) => !a); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, close]);
  useEffect(() => { if (!auto) return; const t = setInterval(() => go(1), AUTO_MS); return () => clearInterval(t); }, [auto, go]);

  if (!list.length) return (
    <div className="pres"><div className="pres-empty"><p>No hay equipos disponibles con precio para presentar.</p>
      <button className="btn" onClick={close}>Volver</button></div></div>);

  const p = detail && detail.id === list[i].id ? detail : null;
  const base = list[i];
  const conv = converted(base, settings);
  // Las 6 especificaciones más importantes (mismo orden que la ficha y el comparador).
  const highlights = p ? keySpecValues(p.specs).map((s) => ({ key: s.label, value: s.value, group: LABEL_GROUP[s.label] ?? 'Otros' })).slice(0, 6) : [];
  const bench = p?.benchmarks.find((b) => b.version === 'v11') ?? p?.benchmarks[0];
  const coverSrc = cover(base.brand, base.model, base.coverKey);
  const photos = [...(coverSrc ? [{ id: -1, url: coverSrc }] : []), ...(p?.photos ?? [])];

  return (
    <div className="pres">
      <header className="pres-top">
        <img src={settings?.logo ?? '/logo.png'} alt="" className="pres-logo" />
        <span className="pres-count">{i + 1} / {list.length}</span>
        <button className={`btn ghost ${auto ? 'on' : ''}`} onClick={() => setAuto(!auto)} title="Espacio">{auto ? '❚❚ Pausar' : '▶ Automático'}</button>
        <button className="btn ghost" onClick={close} title="Esc"><Icon name="x" size={16} /> Salir</button>
      </header>

      <button className="pres-nav left" onClick={() => go(-1)} aria-label="Anterior"><Icon name="left" size={28} /></button>
      <main className="pres-body" key={base.id}>
        <div className="pres-photo">
          {photos.length ? <img src={photos[Math.min(photo, photos.length - 1)].url} alt={`${base.brand} ${base.model}`} />
            : <Icon name="phone" size={140} className="ph-icon" />}
          {photos.length > 1 && <div className="pres-dots">{photos.map((ph, k) => <button key={ph.id} className={k === photo ? 'on' : ''} onClick={() => setPhoto(k)} aria-label={`Foto ${k + 1}`} />)}</div>}
        </div>
        <div className="pres-info">
          <div className="row tight">
            <span className={`tag ${base.condition}`}>{base.condition === 'nuevo' ? 'Nuevo' : /CPO/.test(base.notes) ? 'CPO · Reacondicionado' : 'Usado'}</span>
            {base.warrantyMonths > 0 && <span className="tag outline">Garantía {base.warrantyMonths} meses</span>}
          </div>
          <h1>{base.brand === 'Apple' ? base.model : `${base.brand} ${base.model}`}</h1>
          <p className="pres-variant">{[storageLabel(base.storageGb), base.ramGb && `${base.ramGb} GB RAM`, base.color].filter(Boolean).join(' · ')}</p>

          {highlights.length > 0 && (
            <ul className="pres-specs">
              {highlights.map((s) => <li key={s.key}><Icon name={SPEC_ICON[s.group] ?? 'dot'} size={22} /><div><span>{s.key}</span><b>{s.value}</b></div></li>)}
            </ul>)}

          {bench && (
            <div className="pres-bench">
              <span>Rendimiento AnTuTu {bench.version.toUpperCase()}</span>
              <b>{nf(bench.total)}</b>
              <div className="pres-bar"><i style={{ width: `${Math.min(100, (bench.total / 4_000_000) * 100)}%` }} /></div>
              <small>Fuente: {bench.sourceName}</small>
            </div>)}

          {base.uses.length > 0 && <div className="row tight">{base.uses.map((u) => <span key={u} className="tag outline">Ideal para {USE_LABEL[u]}</span>)}</div>}

          <div className="pres-price">
            <b><small>{base.currency}</small> {money(base.price, base.currency).replace(/^\w+ /, '')}</b>
            {conv && <span>{conv}</span>}
          </div>
        </div>
      </main>
      <button className="pres-nav right" onClick={() => go(1)} aria-label="Siguiente"><Icon name="right" size={28} /></button>
      <footer className="pres-hint">← → cambiar · Espacio automático · Esc salir</footer>
    </div>
  );
}
