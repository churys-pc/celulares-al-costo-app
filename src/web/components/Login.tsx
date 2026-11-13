// Pantalla de ingreso. La primera vez, el correo administrador crea su contraseña.
import { useEffect, useState } from 'react';
import type { AuthStatus, Settings } from '../../shared/types.ts';
import { api } from '../api.ts';
import { Icon } from '../icons.tsx';

export function Login({ status, settings, onDone }: { status: AuthStatus; settings: Settings | null; onDone: (s: AuthStatus) => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [st, setSt] = useState(status);
  const isAdminSetup = st.needsSetup && email.trim().toLowerCase() === st.adminEmail;
  // Mientras se conecta con el catálogo compartido, se revisa cada 3 s si ya se puede crear el admin.
  useEffect(() => {
    if (!isAdminSetup || st.setupReady) return;
    const t = setInterval(() => api.auth().then(setSt).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [isAdminSetup, st.setupReady]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (isAdminSetup && password !== confirm) return setError('Las contraseñas no coinciden.');
    setBusy(true);
    try { onDone(isAdminSetup ? await api.setupAdmin(email, password) : await api.login(email, password)); }
    catch (err) { setError((err as Error).message); api.auth().then(setSt).catch(() => {}); }
    finally { setBusy(false); }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img className="login-logo" src={settings?.logo ?? '/logo.png'} alt={settings?.storeName ?? 'Logo'} />
        <h1>{isAdminSetup ? 'Crear contraseña de administrador' : 'Iniciar sesión'}</h1>
        <p className="muted small">{isAdminSetup ? 'Es la primera vez que entra el administrador. Elegí una contraseña de al menos 4 caracteres.' : 'Ingresá con el correo y la contraseña de tu cuenta.'}</p>
        <label>Correo<input className="input" type="email" autoFocus autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Contraseña<input className="input" type="password" autoComplete={isAdminSetup ? 'new-password' : 'current-password'} required minLength={isAdminSetup ? 4 : 1} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {isAdminSetup && <label>Repetir contraseña<input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>}
        {isAdminSetup && !st.setupReady && <p className="login-wait"><Icon name="clock" size={16} /> Conectando con el catálogo compartido… (necesita internet)</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy || (isAdminSetup && !st.setupReady)}>{busy ? 'Ingresando…' : isAdminSetup ? 'Crear y entrar' : 'Ingresar'}</button>
        <p className="muted small" style={{ margin: 0 }}>¿No tenés cuenta? Pedísela al administrador.</p>
      </form>
    </div>
  );
}
