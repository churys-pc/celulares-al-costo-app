import { useEffect, useState } from 'react';

type UpdateState = { status: string; version?: string; percent?: number; message?: string };
type Desktop = {
  version(): Promise<string>; updateState(): Promise<UpdateState>; checkUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<void>; onUpdateState(cb: (s: UpdateState) => void): () => void;
};
const desktop = (window as unknown as { desktop?: Desktop }).desktop;

const TEXT: Record<string, (s: UpdateState) => string> = {
  dev: () => 'Modo desarrollo: las actualizaciones funcionan solo en la app instalada.',
  idle: () => 'Se buscan actualizaciones automáticamente cada 10 segundos.',
  checking: () => 'Buscando actualizaciones…',
  none: () => 'Tenés la última versión. Se revisa cada 10 segundos.',
  downloading: (s) => `Descargando versión ${s.version ?? ''}… ${s.percent ?? 0}%`,
  ready: (s) => `Versión ${s.version} lista para instalar.`,
  error: (s) => s.message ?? 'Error al buscar actualizaciones.',
  installing: (s) => `Instalando versión ${s.version}…`,
};

export function UpdatesSection() {
  const [version, setVersion] = useState('');
  const [st, setSt] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!desktop) return;
    desktop.version().then(setVersion);
    desktop.updateState().then(setSt);
    return desktop.onUpdateState(setSt);
  }, []);
  if (!desktop) return null; // en el navegador / móvil no aplica

  return (
    <div className="section"><h2>Versión y actualizaciones</h2>
      <p style={{ marginTop: 0 }}>Versión instalada: <b>{version || '…'}</b></p>
      <p className="muted">{st ? TEXT[st.status]?.(st) : '…'}</p>
      <div className="row">
        <button className="btn" disabled={!st || ['checking', 'downloading', 'dev'].includes(st.status)}
          onClick={async () => setSt(await desktop.checkUpdates())}>Buscar actualizaciones</button>
        {st?.status === 'ready' && <button className="btn primary" onClick={() => desktop.installUpdate()}>Reiniciar y actualizar</button>}
      </div>
    </div>
  );
}
