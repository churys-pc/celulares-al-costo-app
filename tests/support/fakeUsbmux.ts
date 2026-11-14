// Simulador del servicio de Apple (usbmuxd + lockdownd + diagnostics_relay) SOLO para pruebas y desarrollo.
// Habla el mismo protocolo que el servicio real, sin TLS (EnableSessionSSL: false).
import net from 'node:net';
import { toXml, parseAny } from '../../src/server/plist.ts';

export interface FakeDevice {
  udid: string; deviceId: number; paired: boolean; locked?: boolean; values: Record<string, any>;
  disk?: Record<string, any>; battery?: Record<string, any>; ioreg?: Record<string, any> | null; deviceClass?: string;
}

export function startFakeMux(devices: FakeDevice[]) {
  const sockets = new Set<net.Socket>();
  const diagPort = 50001;
  const server = net.createServer((s) => {
    sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => {});
    let buf = Buffer.alloc(0); let mode: 'mux' | 'lockdown' | 'diag' = 'mux'; let dev: FakeDevice | null = null; let session = false;
    const muxReply = (tag: number, obj: any) => {
      const body = Buffer.from(toXml(obj)); const h = Buffer.alloc(16);
      h.writeUInt32LE(16 + body.length, 0); h.writeUInt32LE(1, 4); h.writeUInt32LE(8, 8); h.writeUInt32LE(tag, 12);
      s.write(Buffer.concat([h, body]));
    };
    const ldReply = (obj: any) => { const b = Buffer.from(toXml(obj)); const h = Buffer.alloc(4); h.writeUInt32BE(b.length, 0); s.write(Buffer.concat([h, b])); };
    s.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (mode === 'mux') {
          if (buf.length < 16) return;
          const len = buf.readUInt32LE(0); if (buf.length < len) return;
          const tag = buf.readUInt32LE(12); const msg: any = parseAny(buf.subarray(16, len)); buf = buf.subarray(len);
          if (msg.MessageType === 'ListDevices') muxReply(tag, { DeviceList: devices.map((x) => ({ DeviceID: x.deviceId, MessageType: 'Attached', Properties: { ConnectionType: 'USB', SerialNumber: x.udid, DeviceID: x.deviceId } })) });
          else if (msg.MessageType === 'ReadPairRecord') {
            const x = devices.find((y) => y.udid === msg.PairRecordID);
            if (x?.paired) muxReply(tag, { PairRecordData: Buffer.from(toXml({ HostID: 'HOST-1', SystemBUID: 'BUID-1', HostCertificate: Buffer.from('-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n'), HostPrivateKey: Buffer.from('k') })) });
            else muxReply(tag, { MessageType: 'Result', Number: 2 });
          } else if (msg.MessageType === 'Connect') {
            const port = ((msg.PortNumber & 0xff) << 8) | (msg.PortNumber >> 8);
            dev = devices.find((y) => y.deviceId === msg.DeviceID) ?? null;
            if (!dev) { muxReply(tag, { MessageType: 'Result', Number: 2 }); continue; }
            muxReply(tag, { MessageType: 'Result', Number: 0 });
            mode = port === 62078 ? 'lockdown' : port === diagPort ? 'diag' : 'lockdown';
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
              if (msg.Domain === 'com.apple.disk_usage') ldReply({ Request: 'GetValue', Value: d.disk ?? {} });
              else if (msg.Domain === 'com.apple.mobile.battery') ldReply({ Request: 'GetValue', Value: d.battery ?? {} });
              else ldReply({ Request: 'GetValue', Value: { ...d.values, DeviceClass: d.deviceClass ?? 'iPhone' } });
              break;
            }
            case 'StartSession':
              if (d.locked) ldReply({ Request: 'StartSession', Error: 'PasswordProtected' });
              else if (!d.paired || msg.HostID !== 'HOST-1') ldReply({ Request: 'StartSession', Error: 'InvalidHostID' });
              else { session = true; ldReply({ Request: 'StartSession', SessionID: 'S1', EnableSessionSSL: false }); }
              break;
            case 'StartService': ldReply(session ? { Request: 'StartService', Port: diagPort, EnableServiceSSL: false, Service: msg.Service } : { Error: 'NoRunningSession' }); break;
            case 'StopSession': session = false; ldReply({ Request: 'StopSession' }); break;
            default: ldReply({ Error: 'InvalidRequest' });
          }
        }
      }
    });
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
