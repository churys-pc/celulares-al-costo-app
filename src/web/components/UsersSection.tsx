// Ajustes → Usuarios (solo admin) y Mi cuenta (todos).
import { useEffect, useState } from 'react';
import type { UserInfo } from '../../shared/types.ts';
import { api } from '../api.ts';
import { Icon } from '../icons.tsx';
import { useIsAdmin, useSession } from '../session.ts';

export function UsersSection() {
  const admin = useIsAdmin();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const [msg, setMsg] = useState(''); const [error, setError] = useState('');
  useEffect(() => { if (admin) api.users().then(setUsers).catch((e) => setError(e.message)); }, [admin]);
  const run = async (fn: () => Promise<UserInfo[]>, ok: string) => {
    setMsg(''); setError('');
    try { setUsers(await fn()); setMsg(ok); } catch (e) { setError((e as Error).message); }
  };
  if (!admin) return null;
  return (
    <div className="section"><h2>Usuarios</h2>
      <p className="muted small" style={{ marginTop: 0 }}>Los vendedores ven el catálogo y el comparador, pero no pueden cargar ni modificar productos ni ajustes. Las cuentas llegan a todas las PCs.</p>
      <ul className="users">
        {users.map((u) => (
          <li key={u.email}><b>{u.email}</b><span className={`badge ${u.role === 'admin' ? 'st-aprobado' : ''}`}>{u.role === 'admin' ? 'Administrador' : 'Vendedor'}</span>
            {u.role !== 'admin' && <span className="users-act">
              <button className="link" onClick={() => { const p = prompt(`Nueva contraseña para ${u.email} (mínimo 4 caracteres):`); if (p) run(() => api.resetUserPassword(u.email, p), 'Contraseña cambiada.'); }}>Cambiar contraseña</button>
              <button className="link danger" onClick={() => confirm(`¿Dar de baja a ${u.email}?`) && run(() => api.removeUser(u.email), 'Usuario dado de baja.')}>Dar de baja</button>
            </span>}</li>))}
      </ul>
      <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); run(() => api.addUser(email, pw), 'Vendedor creado. Pasale el correo y la contraseña.').then(() => { setEmail(''); setPw(''); }); }}>
        <input className="input" type="email" required placeholder="Correo del vendedor" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 2 }} />
        <input className="input" type="text" required minLength={4} placeholder="Contraseña inicial (4+)" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} autoComplete="off" />
        <button className="btn primary">Agregar vendedor</button>
      </form>
      {msg && <p style={{ color: 'var(--ok)' }}>{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function AccountSection() {
  const me = useSession();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState('');
  const [msg, setMsg] = useState(''); const [error, setError] = useState('');
  return (
    <div className="section"><h2>Mi cuenta</h2>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <p className="muted small" style={{ margin: 0 }}>{me?.email} · {me?.role === 'admin' ? 'Administrador' : 'Vendedor'}</p>
        <button className="btn" onClick={async () => { await api.logout().catch(() => {}); window.dispatchEvent(new Event('auth:changed')); }}>
          <Icon name="arrow" size={16} /> Cerrar sesión</button>
      </div>
      <form className="row" onSubmit={async (e) => {
        e.preventDefault(); setMsg(''); setError('');
        try { await api.changePassword(cur, pw); setCur(''); setPw(''); setMsg('Contraseña actualizada.'); } catch (err) { setError((err as Error).message); }
      }}>
        <input className="input" type="password" required placeholder="Contraseña actual" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <input className="input" type="password" required minLength={4} placeholder="Nueva contraseña (4+)" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn">Cambiar contraseña</button>
      </form>
      {msg && <p style={{ color: 'var(--ok)' }}>{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
