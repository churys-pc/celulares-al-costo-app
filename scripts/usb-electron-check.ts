// Verificación en CI: la lectura USB con sesión cifrada usando el motor TLS de Electron (BoringSSL), que es el que
// corre en la app de escritorio. Se ejecuta con ELECTRON_RUN_AS_NODE=1 (ver .github/workflows).
import { startFakeMux, SAMPLE_IPHONE } from '../tests/support/fakeUsbmux.ts';
import { Usbmux, readDevice } from '../src/server/usbmux.ts';

async function main() {
  console.log('Motor:', process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`, '· TLS:', process.versions.boringssl ? 'BoringSSL' : `OpenSSL ${process.versions.openssl}`);
  const mux = await startFakeMux([SAMPLE_IPHONE({ ssl: true })]);
  try {
    const m = new Usbmux({ host: '127.0.0.1', port: mux.port });
    const [dev] = await m.listDevices();
    const r = await readDevice(m, dev);
    console.log('Estado:', r.state, '| leído:', r.read.join(', '), '| detalle:', r.detail ?? '—');
    if (r.state !== 'connected' || r.info.serial !== 'F2LXK0ABCD12' || r.info.battery?.cycles !== 412) throw new Error('La lectura cifrada no funcionó');
    console.log('OK: lectura USB cifrada');
  } finally { await mux.close(); }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
