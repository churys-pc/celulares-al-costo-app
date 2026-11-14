// Puente mínimo y seguro entre la UI y Electron (solo versión y actualizaciones).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  version: () => ipcRenderer.invoke('app:version'),
  updateState: () => ipcRenderer.invoke('updates:state'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  // Diagnóstico: guarda el informe que se ve en pantalla como PDF.
  savePdf: (name: string) => ipcRenderer.invoke('diag:pdf', name),
  onUpdateState: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('updates:state', h);
    return () => ipcRenderer.removeListener('updates:state', h);
  },
});
