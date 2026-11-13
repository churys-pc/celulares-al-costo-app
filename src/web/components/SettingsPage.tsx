import { useState } from 'react';
import type { Settings } from '../../shared/types.ts';
import { api, fileToDataUrl } from '../api.ts';
import { UpdatesSection } from './UpdatesSection.tsx';
import { AccountSection, UsersSection } from './UsersSection.tsx';
import { FichasSection } from './FichasSection.tsx';
import { useIsAdmin } from '../session.ts';
import { RepoSection } from './RepoSection.tsx';

export function SettingsPage({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const admin = useIsAdmin();
  const [f, setF] = useState<any>({ ...settings, usdRate: settings.usdRate ?? '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<string>) => {
    setMsg(''); setError('');
    try { setMsg(await fn()); } catch (e) { setError((e as Error).message); }
  };

  const save = () => run(async () => { onChange(await api.saveSettings(f)); return 'Ajustes guardados.'; });

  const exportJson = (includeDemo: boolean) => run(async () => {
    const data = await api.exportCatalog(includeDemo);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `catalogo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    return `Exportados ${data.products.length} productos.`;
  });

  const importJson = (file: File) => run(async () => {
    const r = await api.importCatalog(JSON.parse(await file.text()));
    return `Importados ${r.products} productos.`;
  });

  return (
    <>
      <header className="page-head"><div><h1>Ajustes</h1><p className="sub">{admin ? 'Marca, cotización, usuarios y datos del catálogo' : 'Tu cuenta y la app'}</p></div></header>
      <AccountSection />
      {!admin && <div className="section"><h2>Cotización del dólar</h2>
        <p style={{ margin: 0 }}>{settings.usdRate ? <>1 USD = <b>$ {settings.usdRate.toLocaleString('es-UY')}</b></> : 'Todavía no está definida.'}</p>
        <p className="muted small">La define el administrador y llega sola a todas las PCs.</p></div>}
      {admin && <>
      <div className="section"><h2>Local y marca</h2>
        <div className="form">
          <label>Nombre del local<input className="input" value={f.storeName} onChange={(e) => setF({ ...f, storeName: e.target.value })} /></label>
          <label className="full">Eslogan (Inicio)<input className="input" maxLength={80} value={f.slogan} onChange={(e) => setF({ ...f, slogan: e.target.value })} /></label>
          <div className="full logo-edit">
            <img src={f.logo ?? '/logo.png'} alt="Logo" />
            <label className="btn">Cambiar logo<input type="file" accept="image/png,image/jpeg,image/webp" hidden
              onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = '';
                if (file) try { setF({ ...f, logo: await fileToDataUrl(file, 600) }); } catch (err) { setError((err as Error).message); } }} /></label>
            {f.logo && <button className="btn ghost" onClick={() => setF({ ...f, logo: null })}>Usar logo por defecto</button>}
            <span className="muted small">PNG con fondo transparente recomendado. Se guarda al tocar «Guardar».</span>
          </div>
          <label>Color de acento<input className="input" type="color" value={f.primaryColor} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} /></label>
          <label>Moneda por defecto<select className="input" value={f.defaultCurrency} onChange={(e) => setF({ ...f, defaultCurrency: e.target.value })}><option>USD</option><option>UYU</option></select></label>
          <label>Cotización del dólar (pesos por 1 USD)<input className="input" type="number" step="any" min={0} placeholder="Ej.: 40" value={f.usdRate} onChange={(e) => setF({ ...f, usdRate: e.target.value })} />
            <span className="muted small">Precio en pesos = dólares × cotización. Al guardar llega a todas las PCs.</span></label>
        </div>
        <button className="btn primary" style={{ marginTop: 12 }} onClick={save}>Guardar</button>
      </div>
      <div className="section"><h2>Datos del catálogo</h2>
        <div className="row">
          <button className="btn" onClick={() => exportJson(false)}>Exportar JSON</button>
          <label className="btn">Importar JSON<input type="file" accept="application/json,.json" hidden
            onChange={(e) => { const file = e.target.files?.[0]; if (file) importJson(file); e.target.value = ''; }} /></label>
        </div>
        <p className="muted small">La importación es atómica: si una fila tiene errores no se importa nada y se indica la fila.</p>
      </div>
      <FichasSection />
      <UsersSection />
      <RepoSection />
      </>}
      <UpdatesSection />
      {msg && <p style={{ color: 'var(--ok)' }}>{msg}</p>}
      {error && <p className="error">{error}</p>}
    </>
  );
}
