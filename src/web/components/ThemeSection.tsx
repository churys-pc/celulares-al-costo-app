// Ajustes → «Colores de la app»: paletas predefinidas (masculinas y femeninas) y un color personalizado.
import { useState } from 'react';
import { Icon } from '../icons.tsx';
import { PALETTES, applyTheme, loadTheme, themeValues, type Palette, type ThemeChoice } from '../theme.ts';

const preview = (hue: number, sat: number) => ({
  bg: `hsl(${hue + 7} ${70 * sat}% 7%)`, panel: `hsl(${hue + 5} ${63 * sat}% 14%)`,
  a1: `hsl(${hue - 2} ${100 * sat}% 59%)`, a2: `hsl(${hue - 19} ${100 * sat}% 56%)`, text: `hsl(${hue + 4} ${100 * sat}% 92%)`,
});

export function ThemeSection() {
  const [cur, setCur] = useState<ThemeChoice>(loadTheme);
  const [custom, setCustom] = useState(cur.id === 'custom' && 'color' in cur ? cur.color : '#2f8bff');
  const pick = (t: ThemeChoice) => { setCur(t); applyTheme(t); };
  const card = (p: Palette) => {
    const c = preview(p.hue, p.sat);
    return (
      <button key={p.id} type="button" className={`theme-card ${cur.id === p.id ? 'on' : ''}`} onClick={() => pick({ id: p.id })} aria-pressed={cur.id === p.id}>
        <span className="theme-prev" style={{ background: c.bg }}>
          <i style={{ background: c.panel }} /><i style={{ background: `linear-gradient(135deg, ${c.a1}, ${c.a2})` }} /><i style={{ background: c.a2 }} />
        </span>
        <span className="theme-name">{cur.id === p.id && <Icon name="check" size={14} />}{p.name}</span>
      </button>);
  };
  const cv = themeValues({ id: 'custom', color: custom }); const cp = preview(cv.hue, cv.sat);
  return (
    <div className="section">
      <h2>Colores de la app</h2>
      <p className="muted small" style={{ marginTop: 0 }}>Elegí una paleta; se aplica al instante y queda guardada en esta PC. Los colores de estado (verde, rojo, ámbar) no cambian.</p>
      <h3 className="theme-group">Masculinos</h3>
      <div className="theme-grid">{PALETTES.filter((p) => p.group === 'masculinos').map(card)}</div>
      <h3 className="theme-group">Femeninos</h3>
      <div className="theme-grid">{PALETTES.filter((p) => p.group === 'femeninos').map(card)}</div>
      <h3 className="theme-group">Personalizado</h3>
      <div className="row">
        <button type="button" style={{ width: 180 }} className={`theme-card ${cur.id === 'custom' ? 'on' : ''}`} onClick={() => pick({ id: 'custom', color: custom })} aria-pressed={cur.id === 'custom'}>
          <span className="theme-prev" style={{ background: cp.bg }}>
            <i style={{ background: cp.panel }} /><i style={{ background: `linear-gradient(135deg, ${cp.a1}, ${cp.a2})` }} /><i style={{ background: cp.a2 }} />
          </span>
          <span className="theme-name">{cur.id === 'custom' && <Icon name="check" size={14} />}Mi color</span>
        </button>
        <label className="theme-custom">Elegí el color
          <input className="input color-input" type="color" value={custom} aria-label="Color personalizado"
            onChange={(e) => { setCustom(e.target.value); pick({ id: 'custom', color: e.target.value }); }} /></label>
        <button type="button" className="btn ghost" onClick={() => pick({ id: 'azul' })}>Volver al de fábrica</button>
      </div>
    </div>
  );
}
