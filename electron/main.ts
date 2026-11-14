import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
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
  const win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1024, minHeight: 640, backgroundColor: '#0a0f1a',
    title: 'Celulares al Costo', autoHideMenuBar: true,
    // Barra de título oscura integrada; Windows dibuja los botones minimizar/maximizar/cerrar.
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#071228', symbolColor: '#cfe0ff', height: 36 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  // Enlaces externos (fuentes de specs) se abren en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(srv.url)) e.preventDefault(); });
  await win.loadURL(srv.url);
}

// Una sola instancia: si ya está abierta, se enfoca esa ventana.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });

const logFile = () => path.join(app.getPath('userData'), 'error.log');
function log(msg: string) {
  try { fs.mkdirSync(path.dirname(logFile()), { recursive: true }); fs.appendFileSync(logFile(), `${new Date().toISOString()} ${msg}\n`); } catch {}
}

// Diagnóstico → «Exportar PDF»: imprime a PDF la vista del informe y pide dónde guardarlo.
ipcMain.handle('diag:pdf', async (e, name: unknown) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return { error: 'Ventana no disponible' };
  const safe = String(name ?? 'Diagnostico.pdf').replace(/[^\w.-]/g, '_').slice(0, 80) || 'Diagnostico.pdf';
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), safe), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  const pdf = await e.sender.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
  fs.writeFileSync(r.filePath, pdf);
  return { ok: true };
});

app.whenReady().then(async () => { setupUpdates(log); await createWindow(); }).catch((e: Error) => {
  // Error claro en vez de cierre silencioso; se guarda un log local sin datos sensibles.
  const log_ = logFile(); log(String(e?.stack ?? e));
  dialog.showErrorBox('Celulares al Costo — no se pudo iniciar', `${e?.message ?? e}\n\nDetalle guardado en:\n${log_}`);
  app.quit();
});
app.on('window-all-closed', () => { stop?.(); app.quit(); });
