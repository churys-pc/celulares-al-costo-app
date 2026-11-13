// Actualizaciones automáticas desde GitHub Releases (repo público de instaladores).
import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
// quitAndInstall(true, true): instalación silenciosa (sin ventana del instalador) y la app se vuelve a abrir sola.

export type UpdateState = { status: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'installing' | 'error' | 'dev'; version?: string; percent?: number; message?: string; notes?: string };

/** Notas del release en texto plano (GitHub puede mandarlas en HTML). */
const plainNotes = (n: unknown): string | undefined => {
  const raw = Array.isArray(n) ? n.map((x) => x?.note ?? '').join('\n') : typeof n === 'string' ? n : '';
  const t = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
  return t ? t.slice(0, 600) : undefined;
};
let state: UpdateState = { status: app.isPackaged ? 'idle' : 'dev' };
const CHECK_EVERY_MS = 10_000; // cada 10 segundos (pedido del local)
const ERROR_BACKOFF_MS = 5 * 60_000; // si GitHub falla o limita, se espera 5 min antes de reintentar
let pausedUntil = 0;

const push = (s: UpdateState) => { state = s; for (const w of BrowserWindow.getAllWindows()) w.webContents.send('updates:state', s); };

export function setupUpdates(log: (msg: string) => void) {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('updates:state', () => state);
  ipcMain.handle('updates:check', () => check());
  ipcMain.handle('updates:install', () => {
    if (state.status !== 'ready') return;
    push({ ...state, status: 'installing' });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 600); // deja ver el aviso «Actualizando…»
  });
  if (!app.isPackaged) return; // en desarrollo no hay instalador que actualizar

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // si elige "Más tarde", se instala al cerrar la app
  autoUpdater.on('checking-for-update', () => { if (state.status !== 'none') push({ status: 'checking' }); });
  autoUpdater.on('update-available', (i) => push({ status: 'downloading', version: i.version, percent: 0, notes: plainNotes(i.releaseNotes) }));
  autoUpdater.on('update-not-available', () => push({ status: 'none' }));
  autoUpdater.on('download-progress', (p) => push({ ...state, status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('error', (e) => { pausedUntil = Date.now() + ERROR_BACKOFF_MS; log(`updater: ${e?.message ?? e}`); push({ status: 'error', message: 'No se pudo buscar actualizaciones (¿sin internet?).' }); });
  // El aviso se muestra dentro de la app (UpdateToast); sin diálogos nativos de Windows.
  autoUpdater.on('update-downloaded', (i) => push({ status: 'ready', version: i.version, notes: plainNotes(i.releaseNotes) ?? state.notes }));

  setTimeout(check, 3000);
  setInterval(() => { if (Date.now() >= pausedUntil) void check(); }, CHECK_EVERY_MS);
}

async function check(): Promise<UpdateState> {
  if (!app.isPackaged) return state;
  if (['checking', 'downloading', 'ready'].includes(state.status)) return state;
  try { await autoUpdater.checkForUpdates(); } catch { /* el evento 'error' ya informa */ }
  return state;
}
