import { app, BrowserWindow, dialog, safeStorage, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../src/server/main.ts';
import { setupUpdates } from './updater.ts';

let stop: (() => void) | undefined;

async function createWindow() {
  const srv = await startServer({ dataDir: path.join(app.getPath('userData'), 'data'), webRoot: path.join(__dirname, 'web'), log,
    // La clave de GitHub se guarda cifrada con la protección de Windows del usuario (DPAPI).
    secret: safeStorage.isEncryptionAvailable() ? {
      encrypt: (t: string) => safeStorage.encryptString(t).toString('base64'),
      decrypt: (t: string) => safeStorage.decryptString(Buffer.from(t, 'base64')),
    } : undefined });
  stop = srv.close;
  // Tamaño según el área útil de la pantalla (sin la barra de tareas): nunca queda nada debajo de ella.
  const place = windowPlacement();
  const win = new BrowserWindow({
    ...place.bounds, minWidth: Math.min(1024, place.work.width), minHeight: Math.min(640, place.work.height), backgroundColor: '#0a0f1a', show: false,
    title: 'Celulares al Costo', autoHideMenuBar: true,
    // Barra de título oscura integrada; Windows dibuja los botones minimizar/maximizar/cerrar.
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#071228', symbolColor: '#cfe0ff', height: 36 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  if (place.maximized) win.maximize();
  win.show();
  // Se recuerda tamaño, posición y si estaba maximizada para la próxima vez.
  const remember = () => { if (!win.isDestroyed() && !win.isFullScreen()) saveWindowState({ ...(win.isMaximized() ? (readWindowState() ?? {}) : win.getBounds()), maximized: win.isMaximized() }); };
  win.on('resize', remember); win.on('move', remember); win.on('maximize', remember); win.on('unmaximize', remember);
  // Al salir de pantalla completa (modo presentación) la ventana vuelve a entrar en el área útil.
  win.on('leave-full-screen', () => setTimeout(() => { if (!win.isMaximized()) win.setBounds(fitBounds(win.getBounds())); }, 50));
  // Enlaces externos (fuentes de specs) se abren en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(srv.url)) e.preventDefault(); });
  await win.loadURL(srv.url);
}

type Bounds = { x: number; y: number; width: number; height: number };
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function readWindowState(): (Partial<Bounds> & { maximized?: boolean }) | null {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return null; }
}
function saveWindowState(st: Partial<Bounds> & { maximized?: boolean }) { try { fs.writeFileSync(stateFile(), JSON.stringify(st)); } catch {} }

/** Ajusta un rectángulo al área útil de la pantalla donde está (descontando la barra de tareas). */
function fitBounds(b: Bounds): Bounds {
  const work = screen.getDisplayMatching(b).workArea;
  const width = Math.min(b.width, work.width), height = Math.min(b.height, work.height);
  const x = Math.min(Math.max(b.x, work.x), work.x + work.width - width);
  const y = Math.min(Math.max(b.y, work.y), work.y + work.height - height);
  return { x, y, width, height };
}

/** Posición inicial: la guardada (si sigue entrando en alguna pantalla) o 1360 × 860 centrada; si la pantalla es chica, maximizada. */
function windowPlacement() {
  const saved = readWindowState();
  const primary = screen.getPrimaryDisplay().workArea;
  if (saved && Number(saved.width) > 0 && Number(saved.height) > 0 && saved.x != null && saved.y != null) {
    const b = fitBounds(saved as Bounds);
    return { bounds: b, work: screen.getDisplayMatching(b).workArea, maximized: !!saved.maximized };
  }
  const width = Math.min(1360, primary.width), height = Math.min(860, primary.height);
  const bounds = { x: primary.x + Math.round((primary.width - width) / 2), y: primary.y + Math.round((primary.height - height) / 2), width, height };
  return { bounds, work: primary, maximized: primary.width < 1400 || primary.height < 900 };
}

// Una sola instancia: si ya está abierta, se enfoca esa ventana.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });

const logFile = () => path.join(app.getPath('userData'), 'error.log');
function log(msg: string) {
  try { fs.mkdirSync(path.dirname(logFile()), { recursive: true }); fs.appendFileSync(logFile(), `${new Date().toISOString()} ${msg}\n`); } catch {}
}

app.whenReady().then(async () => { setupUpdates(log); await createWindow(); }).catch((e: Error) => {
  // Error claro en vez de cierre silencioso; se guarda un log local sin datos sensibles.
  const log_ = logFile(); log(String(e?.stack ?? e));
  dialog.showErrorBox('Celulares al Costo — no se pudo iniciar', `${e?.message ?? e}\n\nDetalle guardado en:\n${log_}`);
  app.quit();
});
app.on('window-all-closed', () => { stop?.(); app.quit(); });
