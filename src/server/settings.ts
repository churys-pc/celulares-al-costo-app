import type { Db } from './db.ts';
import { decodeImage } from './photos.ts';
import { CURRENCIES, DEFAULT_SETTINGS, ValidationError, type Settings } from '../shared/types.ts';

export function getSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s: any = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in s) s[r.key] = JSON.parse(r.value);
  return s;
}

export function updateSettings(db: Db, patch: any): Settings {
  if (!patch || typeof patch !== 'object') throw new ValidationError('Datos inválidos');
  const next = { ...getSettings(db) };
  if ('storeName' in patch) {
    const v = String(patch.storeName ?? '').replace(/[\u0000-\u001f]/g, '').trim();
    if (!v || v.length > 60) throw new ValidationError('Nombre del local inválido');
    next.storeName = v;
  }
  if ('primaryColor' in patch) {
    if (!/^#[0-9a-f]{6}$/i.test(patch.primaryColor)) throw new ValidationError('Color inválido (#RRGGBB)');
    next.primaryColor = patch.primaryColor;
  }
  if ('defaultCurrency' in patch) {
    if (!CURRENCIES.includes(patch.defaultCurrency)) throw new ValidationError('Moneda inválida');
    next.defaultCurrency = patch.defaultCurrency;
  }
  if ('usdRate' in patch) {
    const r = patch.usdRate === null || patch.usdRate === '' ? null : Number(patch.usdRate);
    if (r !== null && !(Number.isFinite(r) && r > 0 && r < 1000)) throw new ValidationError('Cotización inválida');
    next.usdRate = r;
  }
  if ('logo' in patch) {
    if (patch.logo === null || patch.logo === '') next.logo = null;
    else { decodeImage(patch.logo, 1024 * 1024); next.logo = patch.logo; }
  }
  if ('slogan' in patch) {
    const v = String(patch.slogan ?? '').replace(/[\u0000-\u001f]/g, '').trim();
    if (v.length > 80) throw new ValidationError('Eslogan demasiado largo');
    next.slogan = v;
  }
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(next)) stmt.run(k, JSON.stringify(v));
  return next;
}
