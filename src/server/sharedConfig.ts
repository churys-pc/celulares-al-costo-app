// Configuración compartida entre PCs por el repo de datos: cuentas (config/users.json) y cotización (config/settings.json).
import type { Db } from './db.ts';
import { enqueue } from './repoSync.ts';
import { applyUsersDoc, USERS_PATH } from './auth.ts';
import { getSettings, updateSettings } from './settings.ts';

export const SETTINGS_PATH = 'config/settings.json';

/** El admin cambió la cotización: se sube para que llegue a todas las PCs. */
export function publishRate(db: Db) {
  enqueue(db, SETTINGS_PATH, 'put', JSON.stringify({ usdRate: getSettings(db).usdRate, updatedAt: new Date().toISOString() }, null, 2));
}

export function applySharedConfig(db: Db, path: string, text: string) {
  if (path === USERS_PATH) return applyUsersDoc(db, text);
  if (path === SETTINGS_PATH) {
    const doc = JSON.parse(text);
    if ('usdRate' in doc) updateSettings(db, { usdRate: doc.usdRate });
  }
}
