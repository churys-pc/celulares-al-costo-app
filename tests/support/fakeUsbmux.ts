// Simulador del servicio de Apple (usbmuxd + lockdownd + diagnostics_relay) SOLO para pruebas y desarrollo.
// Habla el mismo protocolo que el servicio real, sin TLS (EnableSessionSSL: false).
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { toXml as rawXml, parseAny } from '../../src/server/plist.ts';
// Como el servicio real de Apple: plist «formateado», con saltos de línea y tabulaciones entre etiquetas.
const toXml = (v: unknown) => rawXml(v).replace(/(<\/[a-z]+>|<(?:dict|array|plist[^>]*)>)(?=<)/g, '$1\n\t');

/** Certificados como los del emparejamiento (RSA 2048, autofirmados): uno para la PC y otro para el iPhone. */
let certs: { hostCert: string; hostKey: string; devCert: string; devKey: string } | null = null;
function pairCerts() {
  if (certs) return certs;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-'));
  const mk = (name: string) => {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, `${name}.key`), '-out', path.join(dir, `${name}.crt`), '-days', '30', '-subj', `/CN=${name}`], { stdio: 'ignore' });
    return { cert: fs.readFileSync(path.join(dir, `${name}.crt`), 'utf8'), key: fs.readFileSync(path.join(dir, `${name}.key`), 'utf8') };
  };
  const h = mk('host'), d = mk('device');
  certs = { hostCert: h.cert, hostKey: h.key, devCert: d.cert, devKey: d.key };
  return certs;
}

export interface FakeDevice {
  /** Sesión cifrada como en un iPhone real (EnableSessionSSL / EnableServiceSSL). */
  ssl?: boolean;
  /** Sin el dominio de fábrica (iOS viejos) y/o con el uso de disco lento, como cuando iOS calcula todo el uso. */
  noFactory?: boolean; diskDelayMs?: number;
  udid: string; deviceId: number; paired: boolean; locked?: boolean; values: Record<string, any>;
  disk?: Record<string, any>; battery?: Record<string, any>; ioreg?: Record<string, any> | null; deviceClass?: string;
}

export function startFakeMux(devices: FakeDevice[]) {
  const sockets = new Set<net.Socket>();
  const diagPort = 50001;
  const server = net.createServer((s) => {
    sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => {});
    let buf = Buffer.alloc(0); let mode: 'mux' | 'lockdown' | 'diag' = 'mux'; let dev: FakeDevice | null = null; let session = false;
    let out: net.Socket | tls.TLSSocket = s;
    /** El servidor pasa a TLS en el mismo socket (después de responder StartSession o al abrir el servicio). */
    const upgrade = () => {
      const c = pairCerts();
      s.removeListener('data', onData);
      const t = new tls.TLSSocket(s, { isServer: true, cert: c.devCert, key: c.devKey, requestCert: true, rejectUnauthorized: false });
      t.on('data', onData); t.on('error', () => {});
      out = t;
    };
    const muxReply = (tag: number, obj: any) => {
      const body = Buffer.from(toXml(obj)); const h = Buffer.alloc(16);
      h.writeUInt32LE(16 + body.length, 0); h.writeUInt32LE(1, 4); h.writeUInt32LE(8, 8); h.writeUInt32LE(tag, 12);
      s.write(Buffer.concat([h, body]));
    };
    const ldReply = (obj: any) => { const b = Buffer.from(toXml(obj)); const h = Buffer.alloc(4); h.writeUInt32BE(b.length, 0); out.write(Buffer.concat([h, b])); };
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (mode === 'mux') {
          if (buf.length < 16) return;
          const len = buf.readUInt32LE(0); if (buf.length < len) return;
          const tag = buf.readUInt32LE(12); const msg: any = parseAny(buf.subarray(16, len)); buf = buf.subarray(len);
          if (msg.MessageType === 'ListDevices') muxReply(tag, { DeviceList: devices.map((x) => ({ DeviceID: x.deviceId, MessageType: 'Attached', Properties: { ConnectionType: 'USB', SerialNumber: x.udid, DeviceID: x.deviceId } })) });
          else if (msg.MessageType === 'ReadPairRecord') {
            const x = devices.find((y) => y.udid === msg.PairRecordID);
            if (x?.paired) { const c = pairCerts(); muxReply(tag, { PairRecordData: Buffer.from(toXml({ HostID: 'HOST-1', SystemBUID: 'BUID-1', HostCertificate: Buffer.from(c.hostCert), HostPrivateKey: Buffer.from(c.hostKey), DeviceCertificate: Buffer.from(c.devCert) })) }); }
            else muxReply(tag, { MessageType: 'Result', Number: 2 });
          } else if (msg.MessageType === 'Connect') {
            const port = ((msg.PortNumber & 0xff) << 8) | (msg.PortNumber >> 8);
            dev = devices.find((y) => y.deviceId === msg.DeviceID) ?? null;
            if (!dev) { muxReply(tag, { MessageType: 'Result', Number: 2 }); continue; }
            muxReply(tag, { MessageType: 'Result', Number: 0 });
            mode = port === 62078 ? 'lockdown' : port === diagPort ? 'diag' : 'lockdown';
            if (mode === 'diag' && dev.ssl) upgrade();
          } else muxReply(tag, { MessageType: 'Result', Number: 1 });
        } else {
          if (buf.length < 4) return;
          const len = buf.readUInt32BE(0); if (buf.length < 4 + len) return;
          const msg: any = parseAny(buf.subarray(4, 4 + len)); buf = buf.subarray(4 + len);
          const d = dev!;
          if (mode === 'diag') {
            if (msg.Request === 'IORegistry') ldReply(d.ioreg ? { Status: 'Success', Diagnostics: { IORegistry: d.ioreg } } : { Status: 'Failure' });
            else ldReply({ Status: 'Success' });
            continue;
          }
          switch (msg.Request) {
            case 'QueryType': ldReply({ Request: 'QueryType', Type: 'com.apple.mobile.lockdown' }); break;
            case 'GetValue': {
              if (!session) { ldReply({ Request: 'GetValue', Value: { ProductType: d.values.ProductType, ProductVersion: d.values.ProductVersion, BuildVersion: d.values.BuildVersion, DeviceClass: d.deviceClass ?? 'iPhone' } }); break; }
              if (msg.Domain === 'com.apple.disk_usage.factory') ldReply({ Request: 'GetValue', Value: d.noFactory ? {} : { TotalDiskCapacity: d.disk?.TotalDiskCapacity } });
              else if (msg.Domain === 'com.apple.disk_usage') { const r = { Request: 'GetValue', Value: d.disk ?? {} }; if (d.diskDelayMs) setTimeout(() => ldReply(r), d.diskDelayMs); else ldReply(r); }
              else if (msg.Domain === 'com.apple.mobile.battery') ldReply({ Request: 'GetValue', Value: d.battery ?? {} });
              else ldReply({ Request: 'GetValue', Value: { ...d.values, DeviceClass: d.deviceClass ?? 'iPhone' } });
              break;
            }
            case 'StartSession':
              if (d.locked) ldReply({ Request: 'StartSession', Error: 'PasswordProtected' });
              else if (!d.paired || msg.HostID !== 'HOST-1') ldReply({ Request: 'StartSession', Error: 'InvalidHostID' });
              else { session = true; ldReply({ Request: 'StartSession', SessionID: 'S1', EnableSessionSSL: !!d.ssl }); if (d.ssl) upgrade(); }
              break;
            case 'StartService': ldReply(session ? { Request: 'StartService', Port: diagPort, EnableServiceSSL: !!d.ssl, Service: msg.Service } : { Error: 'NoRunningSession' }); break;
            case 'StopSession': session = false; ldReply({ Request: 'StopSession' }); break;
            default: ldReply({ Error: 'InvalidRequest' });
          }
        }
      }
    };
    s.on('data', onData);
  });
  return new Promise<{ port: number; close: () => Promise<void>; devices: FakeDevice[] }>((ok) => server.listen(0, '127.0.0.1', () => ok({
    port: (server.address() as net.AddressInfo).port, devices,
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  })));
}

export const SAMPLE_IPHONE = (over: Partial<FakeDevice> = {}): FakeDevice => ({
  udid: '00008110-001A2B3C4D5E801E', deviceId: 7, paired: true,
  values: { ProductType: 'iPhone14,5', ProductVersion: '18.1', BuildVersion: '22B83', SerialNumber: 'F2LXK0ABCD12', ModelNumber: 'MLPF3', RegionInfo: 'LL/A',
    InternationalMobileEquipmentIdentity: '351234567890124', InternationalMobileEquipmentIdentity2: '359876543210983', DeviceName: 'iPhone de Juan' },
  disk: { TotalDiskCapacity: 127989469184 }, battery: { BatteryCurrentCapacity: 76, BatteryIsCharging: true },
  ioreg: { CycleCount: 412, DesignCapacity: 3227, NominalChargeCapacity: 2802 },
  ...over,
});
