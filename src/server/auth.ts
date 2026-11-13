// Inicio de sesión con correo y contraseña. Las cuentas se comparten entre PCs por el repo de datos
// (config/users.json, contraseñas con scrypt + sal). La sesión es de esta app (servidor local, un usuario a la vez).
import crypto from 'node:crypto';
import type { Db } from './db.ts';
import { enqueue } from './repoSync.ts';
import { ADMIN_EMAIL, ValidationError, type Role, type SessionUser, type UserInfo } from '../shared/types.ts';

export const USERS_PATH = 'config/users.json';
interface StoredUser { email: string; role: Role; salt: string; hash: string; createdAt: string }
interface UsersDoc { users: StoredUser[]; updatedAt: string }

const kv = (db: Db, key: string) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value as string | undefined;
const setKv = (db: Db, key: string, value: string) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

export const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const checkPassword = (p: unknown) => {
  const s = String(p ?? '');
  if (s.length < 4 || s.length > 128) throw new ValidationError('La contraseña debe tener al menos 4 caracteres.');
  return s;
};
function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 32).toString('hex') };
}
function verify(u: StoredUser, password: string) {
  const a = Buffer.from(hashPassword(password, u.salt).hash, 'hex'), b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function readUsers(db: Db): StoredUser[] {
  try { return (JSON.parse(kv(db, 'sharedUsers') ?? '{"users":[]}') as UsersDoc).users ?? []; } catch { return []; }
}
function writeUsers(db: Db, users: StoredUser[]) {
  const doc: UsersDoc = { users, updatedAt: new Date().toISOString() };
  const text = JSON.stringify(doc, null, 2);
  setKv(db, 'sharedUsers', text);
  enqueue(db, USERS_PATH, 'put', text);
}
/** Lo que llega del repo (otra PC) reemplaza la copia local. */
export function applyUsersDoc(db: Db, text: string) {
  const doc = JSON.parse(text) as UsersDoc;
  if (!Array.isArray(doc?.users)) return;
  setKv(db, 'sharedUsers', JSON.stringify(doc));
}

export class Auth {
  private failures = new Map<string, { n: number; until: number }>();
  constructor(private db: Db, private canSetup: () => boolean) {
    // Recordar sesión entre aperturas de la app, si la cuenta sigue existiendo.
  }

  current(): SessionUser | null {
    const email = kv(this.db, 'sessionEmail') ? JSON.parse(kv(this.db, 'sessionEmail')!) : null;
    const u = email ? readUsers(this.db).find((x) => x.email === email) : null;
    return u ? { email: u.email, role: u.role } : null;
  }

  status() {
    const admin = readUsers(this.db).find((u) => u.role === 'admin');
    return { user: this.current(), adminEmail: ADMIN_EMAIL, needsSetup: !admin, setupReady: !admin && this.canSetup() };
  }

  /** Primera vez: el correo administrador crea su contraseña (solo si todavía no existe ningún admin). */
  setupAdmin(body: any) {
    const email = normEmail(body?.email);
    if (email !== ADMIN_EMAIL) throw new ValidationError('Ese correo no es el administrador.');
    if (readUsers(this.db).some((u) => u.role === 'admin')) throw new ValidationError('El administrador ya tiene contraseña. Iniciá sesión.');
    if (!this.canSetup()) throw new ValidationError('Esperá a que la app se conecte con el catálogo compartido e intentá de nuevo.');
    const pw = checkPassword(body?.password);
    writeUsers(this.db, [...readUsers(this.db), { email, role: 'admin', ...hashPassword(pw), createdAt: new Date().toISOString() }]);
    setKv(this.db, 'sessionEmail', JSON.stringify(email));
    return this.status();
  }

  login(body: any) {
    const email = normEmail(body?.email);
    const f = this.failures.get(email);
    if (f && f.until > Date.now()) throw new ValidationError('Demasiados intentos. Esperá unos minutos.');
    const u = readUsers(this.db).find((x) => x.email === email);
    if (!u || !verify(u, String(body?.password ?? ''))) {
      const n = (f?.n ?? 0) + 1;
      this.failures.set(email, { n, until: n >= 8 ? Date.now() + 5 * 60_000 : 0 });
      throw new ValidationError('Correo o contraseña incorrectos.');
    }
    this.failures.delete(email);
    setKv(this.db, 'sessionEmail', JSON.stringify(u.email));
    return this.status();
  }

  logout() { this.db.prepare(`DELETE FROM settings WHERE key = 'sessionEmail'`).run(); return this.status(); }

  changeOwnPassword(body: any) {
    const me = this.require();
    const users = readUsers(this.db); const u = users.find((x) => x.email === me.email)!;
    if (!verify(u, String(body?.current ?? ''))) throw new ValidationError('La contraseña actual no es correcta.');
    Object.assign(u, hashPassword(checkPassword(body?.password)));
    writeUsers(this.db, users);
    return { ok: true };
  }

  // ---- Gestión de usuarios (solo admin) ----
  list(): UserInfo[] {
    this.require('admin');
    return readUsers(this.db).map(({ email, role, createdAt }) => ({ email, role, createdAt }));
  }
  addUser(body: any) {
    this.require('admin');
    const email = normEmail(body?.email);
    if (!EMAIL_RE.test(email) || email.length > 120) throw new ValidationError('Correo inválido.');
    const users = readUsers(this.db);
    if (users.some((u) => u.email === email)) throw new ValidationError('Ese correo ya tiene cuenta.');
    users.push({ email, role: 'vendedor', ...hashPassword(checkPassword(body?.password)), createdAt: new Date().toISOString() });
    writeUsers(this.db, users);
    return this.list();
  }
  resetPassword(emailRaw: string, body: any) {
    this.require('admin');
    const users = readUsers(this.db); const u = users.find((x) => x.email === normEmail(emailRaw));
    if (!u) throw new ValidationError('Usuario no encontrado.');
    Object.assign(u, hashPassword(checkPassword(body?.password)));
    writeUsers(this.db, users);
    return this.list();
  }
  removeUser(emailRaw: string) {
    this.require('admin');
    const email = normEmail(emailRaw);
    const users = readUsers(this.db);
    const u = users.find((x) => x.email === email);
    if (!u) throw new ValidationError('Usuario no encontrado.');
    if (u.role === 'admin') throw new ValidationError('No se puede eliminar al administrador.');
    writeUsers(this.db, users.filter((x) => x.email !== email));
    return this.list();
  }

  /** Corta la acción si no hay sesión o si falta el rol. */
  require(role?: Role): SessionUser {
    const u = this.current();
    if (!u) throw new AuthError(401, 'Iniciá sesión para continuar.');
    if (role === 'admin' && u.role !== 'admin') throw new AuthError(403, 'Solo el administrador puede hacer esto.');
    return u;
  }
}

export class AuthError extends Error { constructor(public status: number, msg: string) { super(msg); } }
