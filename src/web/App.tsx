import { useEffect, useState } from 'react';
import { startCoverWorker } from './covers.ts';
import { resumeCoverJobs } from './coverJobs.ts';
import type { AuthStatus, Settings } from '../shared/types.ts';
import { api } from './api.ts';
import { Icon } from './icons.tsx';
import { SECTIONS, type Nav } from './sections.ts';
import { Catalog } from './components/Catalog.tsx';
import { Compare } from './components/Compare.tsx';
import { QuickAdd } from './components/QuickAdd.tsx';
import { Home } from './components/Home.tsx';
import { SettingsPage } from './components/SettingsPage.tsx';
import { UpdateToast } from './components/UpdateToast.tsx';
import { Login } from './components/Login.tsx';
import { SessionContext } from './session.ts';

export function App() {
  const [section, setSection] = useState(() => {
    // Secciones quitadas (Identificar, Tasación, Historial, IMEI Check, Diagnóstico) u otras desconocidas vuelven a Inicio.
    const h = location.hash.slice(1).split('?')[0];
    return SECTIONS.some((x) => x.id === h) ? h : 'inicio';
  });
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const user = auth?.user ?? null;
  const isAdmin = user?.role === 'admin';
  useEffect(() => {
    const check = () => api.auth().then(setAuth).catch(() => {});
    check(); window.addEventListener('auth:changed', check);
    return () => window.removeEventListener('auth:changed', check);
  }, []);
  useEffect(() => { if (user) api.settings().then(setSettings).catch(() => {}); }, [user?.email]);
  useEffect(() => { if (user) { void startCoverWorker(); void resumeCoverJobs(); } }, [user?.email]);
  // La cotización y otros ajustes pueden llegar desde otra PC: se refrescan cada minuto.
  useEffect(() => { if (!user) return; const t = setInterval(() => api.settings().then(setSettings).catch(() => {}), 60_000); return () => clearInterval(t); }, [user?.email]);
  useEffect(() => { if (user && !isAdmin && section === 'cargar') setSection('catalogo'); }, [user, isAdmin, section]);
  useEffect(() => { history.replaceState(null, '', '#' + section); }, [section]);

  const go: Nav['go'] = (s, q) => { setQuery(q ?? ''); setSection(SECTIONS.some((x) => x.id === s) ? s : 'inicio'); };
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const visible = SECTIONS.filter((s) => isAdmin || !s.adminOnly);

  if (!auth) return <div className="app"><div className="titlebar" /></div>;
  if (!user) return <div className="app"><div className="titlebar" /><Login status={auth} settings={settings} onDone={setAuth} /><UpdateToast /></div>;

  return (
    <SessionContext.Provider value={user}>
    <div className="app">
      <div className="titlebar" />
      <div className="layout">
        <nav className="sidebar">
          <div className="logo-wrap">
            <img src={settings?.logo ?? '/logo.png'} alt={settings?.storeName ?? 'Logo'} />
          </div>
          {visible.map((s) => (
            <button key={s.id} className={`nav ${section === s.id ? 'active' : ''}`} onClick={() => go(s.id)}>
              <Icon name={s.icon} size={22} /><span>{s.label}</span>
            </button>))}
          <div className="side-user">
            <button className="su-ico" onClick={async () => setAuth(await api.logout())} title="Cerrar sesión" aria-label="Cerrar sesión"><Icon name="logout" size={20} /></button>
            <div className="su-txt">
              <b title={user.email}>{isAdmin ? 'Administrador' : 'Vendedor'}</b>
              <button className="link" onClick={async () => setAuth(await api.logout())}>Cerrar sesión</button>
            </div>
          </div>
        </nav>
        <main className="main">
          {section === 'inicio' && <Home settings={settings} go={go} />}
          {section === 'catalogo' && <Catalog key={query} settings={settings} initialQuery={query} onNew={isAdmin ? () => go('cargar') : undefined} />}
          {section === 'cargar' && isAdmin && <QuickAdd settings={settings} />}
          {section === 'comparador' && <Compare settings={settings} />}
          {section === 'ajustes' && settings && <SettingsPage settings={settings} onChange={setSettings} />}
          {!['catalogo', 'ajustes', 'inicio', 'comparador', 'cargar'].includes(section) && (
            <>
              <header className="page-head"><div><h1>{current.label}</h1><p className="sub">{current.desc}</p></div></header>
              <div className="empty"><Icon name={current.icon} size={36} />
                <p>Módulo en construcción (Fase {current.phase}). No se muestran datos simulados.</p></div>
            </>)}
        </main>
      </div>
      <UpdateToast />
    </div>
    </SessionContext.Provider>
  );
}
