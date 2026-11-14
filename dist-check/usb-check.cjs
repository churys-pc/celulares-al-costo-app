"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tests/support/fakeUsbmux.ts
var import_node_net = __toESM(require("node:net"));
var import_node_tls = __toESM(require("node:tls"));
var import_node_fs = __toESM(require("node:fs"));
var import_node_os = __toESM(require("node:os"));
var import_node_path = __toESM(require("node:path"));
var import_node_child_process = require("node:child_process");

// src/server/plist.ts
var PReal = class {
  constructor(v) {
    this.v = v;
  }
  v;
};
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function toXml(v) {
  const ser = (x) => {
    if (x === null || x === void 0) return "<string></string>";
    if (x instanceof PReal) return `<real>${x.v}</real>`;
    if (typeof x === "boolean") return x ? "<true/>" : "<false/>";
    if (typeof x === "number") return Number.isInteger(x) ? `<integer>${x}</integer>` : `<real>${x}</real>`;
    if (typeof x === "bigint") return `<integer>${x}</integer>`;
    if (typeof x === "string") return `<string>${esc(x)}</string>`;
    if (Buffer.isBuffer(x)) return `<data>${x.toString("base64")}</data>`;
    if (x instanceof Date) return `<date>${x.toISOString().replace(/\.\d+Z$/, "Z")}</date>`;
    if (Array.isArray(x)) return `<array>${x.map(ser).join("")}</array>`;
    return `<dict>${Object.entries(x).filter(([, y]) => y !== void 0).map(([k, y]) => `<key>${esc(k)}</key>${ser(y)}`).join("")}</dict>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">${ser(v)}</plist>
`;
}
var unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
function parseXml(text) {
  const body = text.replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const re = /<(\/?)([a-zA-Z]+)(\s[^>]*)?(\/?)>|([^<]+)/g;
  const toks = [];
  let m;
  while (m = re.exec(body)) {
    if (m[5] !== void 0) {
      const prev = toks.at(-1);
      if (m[5].trim() || prev && !prev.close && !prev.self && (prev.name === "string" || prev.name === "key")) toks.push({ close: false, name: "#text", self: false, text: m[5] });
    } else toks.push({ close: m[1] === "/", name: m[2], self: m[4] === "/" });
  }
  let i = 0;
  const textUntil = (name) => {
    let s = "";
    while (i < toks.length && !(toks[i].close && toks[i].name === name)) {
      s += toks[i].text ?? "";
      i++;
    }
    i++;
    return s;
  };
  const val = () => {
    while (toks[i]?.name === "#text" && !toks[i].text.trim()) i++;
    const t = toks[i++];
    if (!t) throw new Error("plist incompleto");
    if (t.name === "plist") {
      const v = val();
      while (i < toks.length && !(toks[i].close && toks[i].name === "plist")) i++;
      i++;
      return v;
    }
    if (t.self) {
      if (t.name === "true") return true;
      if (t.name === "false") return false;
      if (t.name === "array") return [];
      if (t.name === "dict") return {};
      if (t.name === "string" || t.name === "data") return t.name === "data" ? Buffer.alloc(0) : "";
      throw new Error(`etiqueta inesperada ${t.name}`);
    }
    switch (t.name) {
      case "string":
        return unesc(textUntil("string"));
      case "integer": {
        const s = textUntil("integer").trim();
        const n = Number(s);
        return Number.isSafeInteger(n) ? n : BigInt(s);
      }
      case "real":
        return Number(textUntil("real").trim());
      case "date":
        return new Date(textUntil("date").trim());
      case "data":
        return Buffer.from(textUntil("data").replace(/\s+/g, ""), "base64");
      case "array": {
        const a = [];
        while (!(toks[i].close && toks[i].name === "array")) {
          if (toks[i].name === "#text" && !toks[i].text.trim()) {
            i++;
            continue;
          }
          a.push(val());
        }
        i++;
        return a;
      }
      case "dict": {
        const o = {};
        while (!(toks[i].close && toks[i].name === "dict")) {
          if (toks[i].name === "#text" && !toks[i].text.trim()) {
            i++;
            continue;
          }
          const k = toks[i++];
          if (k.name !== "key") throw new Error("dict sin clave");
          const key = unesc(textUntil("key"));
          o[key] = val();
        }
        i++;
        return o;
      }
      default:
        throw new Error(`etiqueta inesperada ${t.name}`);
    }
  };
  return val();
}
function parseBinary(buf) {
  if (buf.subarray(0, 8).toString("latin1") !== "bplist00") throw new Error("No es un plist binario");
  const tr = buf.subarray(buf.length - 32);
  const offSize = tr[6], refSize = tr[7];
  const numObjects = Number(tr.readBigUInt64BE(8)), top = Number(tr.readBigUInt64BE(16)), tableOff = Number(tr.readBigUInt64BE(24));
  const readN = (pos, n) => {
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + buf[pos + k];
    return v;
  };
  const offsets = Array.from({ length: numObjects }, (_, k) => readN(tableOff + k * offSize, offSize));
  const seen = /* @__PURE__ */ new Set();
  const obj = (ref) => {
    if (seen.has(ref)) throw new Error("plist con referencia circular");
    seen.add(ref);
    try {
      let p = offsets[ref];
      const marker = buf[p++];
      const hi = marker >> 4;
      let lo = marker & 15;
      const len = () => {
        if (lo !== 15) return lo;
        const m2 = buf[p++];
        const n = 1 << (m2 & 15);
        const v = readN(p, n);
        p += n;
        return v;
      };
      switch (hi) {
        case 0:
          return lo === 8 ? false : lo === 9 ? true : null;
        case 1: {
          const n = 1 << lo;
          if (n === 8) {
            const v = buf.readBigInt64BE(p);
            return v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER ? Number(v) : v;
          }
          return readN(p, n);
        }
        case 2:
          return lo === 2 ? buf.readFloatBE(p) : buf.readDoubleBE(p);
        case 3:
          return new Date(Date.UTC(2001, 0, 1) + buf.readDoubleBE(p) * 1e3);
        case 4: {
          const n = len();
          return Buffer.from(buf.subarray(p, p + n));
        }
        case 5: {
          const n = len();
          return buf.subarray(p, p + n).toString("latin1");
        }
        case 6: {
          const n = len();
          const b = Buffer.from(buf.subarray(p, p + n * 2));
          b.swap16();
          return b.toString("utf16le");
        }
        case 8:
          return readN(p, lo + 1);
        case 10: {
          const n = len();
          const a = [];
          for (let k = 0; k < n; k++) a.push(obj(readN(p + k * refSize, refSize)));
          return a;
        }
        case 13: {
          const n = len();
          const o = {};
          for (let k = 0; k < n; k++) o[String(obj(readN(p + k * refSize, refSize)))] = obj(readN(p + (n + k) * refSize, refSize));
          return o;
        }
        default:
          throw new Error(`tipo de plist binario no soportado (${hi})`);
      }
    } finally {
      seen.delete(ref);
    }
  };
  return obj(top);
}
function parseAny(buf) {
  return buf.subarray(0, 8).toString("latin1") === "bplist00" ? parseBinary(buf) : parseXml(buf.toString("utf8"));
}

// tests/support/fakeUsbmux.ts
var toXml2 = (v) => toXml(v).replace(/(<\/[a-z]+>|<(?:dict|array|plist[^>]*)>)(?=<)/g, "$1\n	");
var certs = null;
function pairCerts() {
  if (certs) return certs;
  const dir = import_node_fs.default.mkdtempSync(import_node_path.default.join(import_node_os.default.tmpdir(), "pair-"));
  const mk = (name) => {
    (0, import_node_child_process.execFileSync)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", import_node_path.default.join(dir, `${name}.key`), "-out", import_node_path.default.join(dir, `${name}.crt`), "-days", "30", "-subj", `/CN=${name}`], { stdio: "ignore" });
    return { cert: import_node_fs.default.readFileSync(import_node_path.default.join(dir, `${name}.crt`), "utf8"), key: import_node_fs.default.readFileSync(import_node_path.default.join(dir, `${name}.key`), "utf8") };
  };
  const h = mk("host"), d = mk("device");
  certs = { hostCert: h.cert, hostKey: h.key, devCert: d.cert, devKey: d.key };
  return certs;
}
function startFakeMux(devices) {
  const sockets = /* @__PURE__ */ new Set();
  const diagPort = 50001;
  const server = import_node_net.default.createServer((s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => {
    });
    let buf = Buffer.alloc(0);
    let mode = "mux";
    let dev = null;
    let session = false;
    let out = s;
    const upgrade = () => {
      const c = pairCerts();
      s.removeListener("data", onData);
      const t = new import_node_tls.default.TLSSocket(s, { isServer: true, cert: c.devCert, key: c.devKey, requestCert: true, rejectUnauthorized: false });
      t.on("data", onData);
      t.on("error", () => {
      });
      out = t;
    };
    const muxReply = (tag2, obj) => {
      const body = Buffer.from(toXml2(obj));
      const h = Buffer.alloc(16);
      h.writeUInt32LE(16 + body.length, 0);
      h.writeUInt32LE(1, 4);
      h.writeUInt32LE(8, 8);
      h.writeUInt32LE(tag2, 12);
      s.write(Buffer.concat([h, body]));
    };
    const ldReply = (obj) => {
      const b = Buffer.from(toXml2(obj));
      const h = Buffer.alloc(4);
      h.writeUInt32BE(b.length, 0);
      out.write(Buffer.concat([h, b]));
    };
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      for (; ; ) {
        if (mode === "mux") {
          if (buf.length < 16) return;
          const len = buf.readUInt32LE(0);
          if (buf.length < len) return;
          const tag2 = buf.readUInt32LE(12);
          const msg = parseAny(buf.subarray(16, len));
          buf = buf.subarray(len);
          if (msg.MessageType === "ListDevices") muxReply(tag2, { DeviceList: devices.map((x) => ({ DeviceID: x.deviceId, MessageType: "Attached", Properties: { ConnectionType: "USB", SerialNumber: x.udid, DeviceID: x.deviceId } })) });
          else if (msg.MessageType === "ReadPairRecord") {
            const x = devices.find((y) => y.udid === msg.PairRecordID);
            if (x?.paired) {
              const c = pairCerts();
              muxReply(tag2, { PairRecordData: Buffer.from(toXml2({ HostID: "HOST-1", SystemBUID: "BUID-1", HostCertificate: Buffer.from(c.hostCert), HostPrivateKey: Buffer.from(c.hostKey), DeviceCertificate: Buffer.from(c.devCert) })) });
            } else muxReply(tag2, { MessageType: "Result", Number: 2 });
          } else if (msg.MessageType === "Connect") {
            const port = (msg.PortNumber & 255) << 8 | msg.PortNumber >> 8;
            dev = devices.find((y) => y.deviceId === msg.DeviceID) ?? null;
            if (!dev) {
              muxReply(tag2, { MessageType: "Result", Number: 2 });
              continue;
            }
            muxReply(tag2, { MessageType: "Result", Number: 0 });
            mode = port === 62078 ? "lockdown" : port === diagPort ? "diag" : "lockdown";
            if (mode === "diag" && dev.ssl) upgrade();
          } else muxReply(tag2, { MessageType: "Result", Number: 1 });
        } else {
          if (buf.length < 4) return;
          const len = buf.readUInt32BE(0);
          if (buf.length < 4 + len) return;
          const msg = parseAny(buf.subarray(4, 4 + len));
          buf = buf.subarray(4 + len);
          const d2 = dev;
          if (mode === "diag") {
            if (msg.Request === "IORegistry") ldReply(d2.ioreg ? { Status: "Success", Diagnostics: { IORegistry: d2.ioreg } } : { Status: "Failure" });
            else ldReply({ Status: "Success" });
            continue;
          }
          switch (msg.Request) {
            case "QueryType":
              ldReply({ Request: "QueryType", Type: "com.apple.mobile.lockdown" });
              break;
            case "GetValue": {
              if (!session) {
                ldReply({ Request: "GetValue", Value: { ProductType: d2.values.ProductType, ProductVersion: d2.values.ProductVersion, BuildVersion: d2.values.BuildVersion, DeviceClass: d2.deviceClass ?? "iPhone" } });
                break;
              }
              if (msg.Domain === "com.apple.disk_usage.factory") ldReply({ Request: "GetValue", Value: d2.noFactory ? {} : { TotalDiskCapacity: d2.disk?.TotalDiskCapacity } });
              else if (msg.Domain === "com.apple.disk_usage") {
                const r = { Request: "GetValue", Value: d2.disk ?? {} };
                if (d2.diskDelayMs) setTimeout(() => ldReply(r), d2.diskDelayMs);
                else ldReply(r);
              } else if (msg.Domain === "com.apple.mobile.battery") ldReply({ Request: "GetValue", Value: d2.battery ?? {} });
              else ldReply({ Request: "GetValue", Value: { ...d2.values, DeviceClass: d2.deviceClass ?? "iPhone" } });
              break;
            }
            case "StartSession":
              if (d2.locked) ldReply({ Request: "StartSession", Error: "PasswordProtected" });
              else if (!d2.paired || msg.HostID !== "HOST-1") ldReply({ Request: "StartSession", Error: "InvalidHostID" });
              else {
                session = true;
                ldReply({ Request: "StartSession", SessionID: "S1", EnableSessionSSL: !!d2.ssl });
                if (d2.ssl) upgrade();
              }
              break;
            case "StartService":
              ldReply(session ? { Request: "StartService", Port: diagPort, EnableServiceSSL: !!d2.ssl, Service: msg.Service } : { Error: "NoRunningSession" });
              break;
            case "StopSession":
              session = false;
              ldReply({ Request: "StopSession" });
              break;
            default:
              ldReply({ Error: "InvalidRequest" });
          }
        }
      }
    };
    s.on("data", onData);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({
    port: server.address().port,
    devices,
    close: () => new Promise((r) => {
      for (const s of sockets) s.destroy();
      server.close(() => r());
    })
  })));
}
var SAMPLE_IPHONE = (over = {}) => ({
  udid: "00008110-001A2B3C4D5E801E",
  deviceId: 7,
  paired: true,
  values: {
    ProductType: "iPhone14,5",
    ProductVersion: "18.1",
    BuildVersion: "22B83",
    SerialNumber: "F2LXK0ABCD12",
    ModelNumber: "MLPF3",
    RegionInfo: "LL/A",
    InternationalMobileEquipmentIdentity: "351234567890124",
    InternationalMobileEquipmentIdentity2: "359876543210983",
    DeviceName: "iPhone de Juan"
  },
  disk: { TotalDiskCapacity: 127989469184 },
  battery: { BatteryCurrentCapacity: 76, BatteryIsCharging: true },
  ioreg: { CycleCount: 412, DesignCapacity: 3227, NominalChargeCapacity: 2802 },
  ...over
});

// src/server/usbmux.ts
var import_node_net2 = __toESM(require("node:net"));
var import_node_tls2 = __toESM(require("node:tls"));

// src/shared/diag.ts
var TESTS = [
  // Pruebas en Safari
  {
    key: "screen",
    label: "Pantalla (colores)",
    group: "safari",
    phone: true,
    perception: true,
    how: "Mostr\xE1 blanco, negro, rojo, verde y azul a pantalla completa y busc\xE1 manchas, l\xEDneas, p\xEDxeles muertos o tinte. Revis\xE1 tambi\xE9n los bordes y la zona de la Dynamic Island o el notch, que Safari no cubre."
  },
  {
    key: "touch",
    label: "Pantalla t\xE1ctil",
    group: "safari",
    phone: true,
    perception: true,
    how: "Recorr\xE9 con el dedo todas las celdas de la cuadr\xEDcula. Las zonas que Safari no deja cubrir (bordes y barra superior) se revisan a mano."
  },
  {
    key: "camera_back",
    label: "C\xE1mara trasera",
    group: "safari",
    phone: true,
    perception: true,
    how: "Vista previa de la c\xE1mara trasera: confirm\xE1 imagen y enfoque. Si no se puede elegir cada lente, probalas en la app C\xE1mara."
  },
  {
    key: "camera_front",
    label: "C\xE1mara frontal",
    group: "safari",
    phone: true,
    perception: true,
    how: "Vista previa de la c\xE1mara frontal: confirm\xE1 imagen y enfoque."
  },
  {
    key: "microphone",
    label: "Micr\xF3fono",
    group: "safari",
    phone: true,
    perception: true,
    how: "Grabaci\xF3n breve que se reproduce solo en el iPhone (no se env\xEDa). Confirm\xE1 que se escucha clara."
  },
  {
    key: "speaker",
    label: "Altavoz (tono)",
    group: "safari",
    phone: true,
    perception: true,
    how: "Reproduc\xED el tono y confirm\xE1 que se escucha sin distorsi\xF3n."
  },
  {
    key: "motion",
    label: "Sensores de movimiento",
    group: "safari",
    phone: true,
    how: "Toc\xE1 el bot\xF3n de la prueba, permit\xED el acceso al movimiento y mov\xE9 el equipo: se comprueba que el navegador recibe datos del aceler\xF3metro y el giroscopio."
  },
  // Controles guiados (Safari no los puede aislar)
  {
    key: "earpiece",
    label: "Auricular (parlante de llamadas)",
    group: "guided",
    phone: true,
    perception: true,
    how: "Hac\xE9 una llamada (por ejemplo al buz\xF3n) con el equipo en la oreja y confirm\xE1 que se escucha por el auricular superior."
  },
  {
    key: "mics_specific",
    label: "Micr\xF3fonos (inferior, frontal y trasero)",
    group: "guided",
    phone: true,
    perception: true,
    how: "Grab\xE1 una nota de voz (micr\xF3fono inferior), un video con la c\xE1mara frontal y otro con la trasera; reproduc\xED cada uno y confirm\xE1 el audio."
  },
  {
    key: "lenses",
    label: "Lentes adicionales",
    group: "guided",
    phone: true,
    naAllowed: true,
    perception: true,
    how: "En la app C\xE1mara, cambi\xE1 a 0,5\xD7 (ultra gran angular), al teleobjetivo y al modo macro si el modelo los tiene; confirm\xE1 imagen y enfoque en cada uno."
  },
  {
    key: "flash",
    label: "Flash y linterna",
    group: "guided",
    phone: true,
    perception: true,
    how: "Encend\xE9 la linterna desde el Centro de control y sac\xE1 una foto con flash."
  },
  // Checklist manual
  {
    key: "biometrics",
    label: "Face ID / Touch ID",
    group: "checklist",
    phone: true,
    naAllowed: true,
    how: "Ped\xED al cliente que desbloquee el equipo con su Face ID o Touch ID ya configurado. No se registra ni se cambia la configuraci\xF3n biom\xE9trica."
  },
  {
    key: "proximity",
    label: "Sensor de proximidad",
    group: "checklist",
    phone: true,
    how: "Durante una llamada, tap\xE1 la parte superior: la pantalla debe apagarse y volver al destapar."
  },
  {
    key: "buttons",
    label: "Botones",
    group: "checklist",
    phone: true,
    how: "Prob\xE1 volumen +, volumen \u2212, bot\xF3n lateral y el interruptor de silencio o el bot\xF3n de Acci\xF3n, seg\xFAn el modelo."
  },
  {
    key: "vibration",
    label: "Vibraci\xF3n",
    group: "checklist",
    phone: true,
    how: "Cambi\xE1 el modo silencio o recib\xED una notificaci\xF3n y confirm\xE1 que vibra."
  },
  {
    key: "charging",
    label: "Carga",
    group: "checklist",
    phone: true,
    how: "Conect\xE1 el cargador (y MagSafe o inal\xE1mbrica si corresponde) y confirm\xE1 que indica \xABCargando\xBB."
  },
  {
    key: "wifi",
    label: "Wi\u2011Fi",
    group: "checklist",
    phone: true,
    how: "Conectate a una red Wi\u2011Fi y abr\xED una p\xE1gina."
  },
  {
    key: "bluetooth",
    label: "Bluetooth",
    group: "checklist",
    phone: true,
    how: "Activ\xE1 Bluetooth y comprob\xE1 que encuentra dispositivos cercanos."
  },
  {
    key: "cellular",
    label: "Red m\xF3vil",
    group: "checklist",
    phone: true,
    how: "Con un chip o eSIM: comprob\xE1 se\xF1al, llamada y datos m\xF3viles."
  },
  // Equipo, batería y bloqueos (desde Windows)
  {
    key: "battery_health",
    label: "Salud de la bater\xEDa",
    group: "device",
    phone: false,
    how: "En el iPhone: Configuraci\xF3n \u2192 Bater\xEDa \u2192 Estado y carga de la bater\xEDa. Copi\xE1 la capacidad m\xE1xima, los ciclos (si aparecen) y el mensaje tal como los muestra iOS."
  },
  {
    key: "parts_history",
    label: "Historial de piezas y servicio",
    group: "device",
    phone: false,
    how: "Configuraci\xF3n \u2192 General \u2192 Informaci\xF3n \u2192 Historial de piezas y servicio (si aparece). Copi\xE1 el texto tal como lo muestra iOS: \xABPieza original de Apple\xBB, \xABPieza desconocida\xBB, etc. Si la secci\xF3n no aparece, anotalo: no certifica que el equipo nunca fue reparado."
  },
  {
    key: "activation_lock",
    label: "Bloqueo de activaci\xF3n",
    group: "device",
    phone: false,
    how: "Se verifica aparte: con el cliente, comprob\xE1 que \xABBuscar mi iPhone\xBB est\xE9 desactivado o que el equipo se pueda borrar y configurar sin pedir el Apple ID anterior. Sin evidencia v\xE1lida queda \xABNo verificado\xBB."
  },
  {
    key: "imei_blacklist",
    label: "Lista negra de IMEI",
    group: "device",
    phone: false,
    how: "La app no tiene verificador de IMEI. Si se consult\xF3 en una fuente confiable, registr\xE1 la fuente y el resultado; si no, queda \xABNo verificado\xBB."
  },
  {
    key: "carrier_lock",
    label: "Bloqueo de operador",
    group: "device",
    phone: false,
    how: "Configuraci\xF3n \u2192 General \u2192 Informaci\xF3n \u2192 \xABBloqueo del operador\xBB: debe decir \xABSin restricciones de SIM\xBB."
  }
];
var TEST_BY_KEY = new Map(TESTS.map((t) => [t.key, t]));
var PHONE_TESTS = TESTS.filter((t) => t.phone).map((t) => t.key);
var IPHONE_MODELS = {
  "iPhone8,1": "iPhone 6s",
  "iPhone8,2": "iPhone 6s Plus",
  "iPhone8,4": "iPhone SE (1.\xAA gen.)",
  "iPhone9,1": "iPhone 7",
  "iPhone9,3": "iPhone 7",
  "iPhone9,2": "iPhone 7 Plus",
  "iPhone9,4": "iPhone 7 Plus",
  "iPhone10,1": "iPhone 8",
  "iPhone10,4": "iPhone 8",
  "iPhone10,2": "iPhone 8 Plus",
  "iPhone10,5": "iPhone 8 Plus",
  "iPhone10,3": "iPhone X",
  "iPhone10,6": "iPhone X",
  "iPhone11,2": "iPhone XS",
  "iPhone11,4": "iPhone XS Max",
  "iPhone11,6": "iPhone XS Max",
  "iPhone11,8": "iPhone XR",
  "iPhone12,1": "iPhone 11",
  "iPhone12,3": "iPhone 11 Pro",
  "iPhone12,5": "iPhone 11 Pro Max",
  "iPhone12,8": "iPhone SE (2.\xAA gen.)",
  "iPhone13,1": "iPhone 12 mini",
  "iPhone13,2": "iPhone 12",
  "iPhone13,3": "iPhone 12 Pro",
  "iPhone13,4": "iPhone 12 Pro Max",
  "iPhone14,4": "iPhone 13 mini",
  "iPhone14,5": "iPhone 13",
  "iPhone14,2": "iPhone 13 Pro",
  "iPhone14,3": "iPhone 13 Pro Max",
  "iPhone14,6": "iPhone SE (3.\xAA gen.)",
  "iPhone14,7": "iPhone 14",
  "iPhone14,8": "iPhone 14 Plus",
  "iPhone15,2": "iPhone 14 Pro",
  "iPhone15,3": "iPhone 14 Pro Max",
  "iPhone15,4": "iPhone 15",
  "iPhone15,5": "iPhone 15 Plus",
  "iPhone16,1": "iPhone 15 Pro",
  "iPhone16,2": "iPhone 15 Pro Max",
  "iPhone17,3": "iPhone 16",
  "iPhone17,4": "iPhone 16 Plus",
  "iPhone17,1": "iPhone 16 Pro",
  "iPhone17,2": "iPhone 16 Pro Max",
  "iPhone17,5": "iPhone 16e"
};
var modelName = (productType) => productType ? IPHONE_MODELS[productType] ?? null : null;
function capacityGb(totalBytes) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  const gb = totalBytes / 1e9;
  const sizes = [16, 32, 64, 128, 256, 512, 1024, 2048];
  return sizes.reduce((best, s) => Math.abs(Math.log(s / gb)) < Math.abs(Math.log(best / gb)) ? s : best, sizes[0]);
}

// src/server/usbmux.ts
var parseAddr = (v) => {
  if (/^unix:/.test(v)) return { path: v.slice(5) };
  const m = v.match(/^\[?([^\]]+?)\]?:(\d{2,5})$/);
  return m ? { host: m[1], port: Number(m[2]) } : null;
};
function muxAddresses() {
  const env = process.env.CEL_USBMUX_ADDR;
  if (env) return [parseAddr(env)];
  const out = [];
  const std = process.env.USBMUXD_SOCKET_ADDRESS && parseAddr(process.env.USBMUXD_SOCKET_ADDRESS);
  if (std) out.push(std);
  if (process.platform === "win32") out.push({ host: "127.0.0.1", port: 27015 }, { host: "::1", port: 27015 }, { host: "localhost", port: 27015 });
  else out.push({ path: "/var/run/usbmuxd" });
  return out;
}
var addrText = (a) => a.path ? a.path : `${a.host?.includes(":") ? `[${a.host}]` : a.host}:${a.port}`;
var Reader = class {
  constructor(sock) {
    this.sock = sock;
    sock.on("data", (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.wake();
    });
    sock.on("end", () => {
      this.ended ??= new Error("conexi\xF3n cerrada");
      this.wake();
    });
    sock.on("close", () => {
      this.ended ??= new Error("conexi\xF3n cerrada");
      this.wake();
    });
    sock.on("error", (e) => {
      this.ended = e;
      this.wake();
    });
  }
  sock;
  buf = Buffer.alloc(0);
  waiters = [];
  ended = null;
  wake() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
  async read(n, timeoutMs) {
    const until = Date.now() + timeoutMs;
    while (this.buf.length < n) {
      if (this.ended) throw this.ended;
      const left = until - Date.now();
      if (left <= 0) throw new Error("tiempo de espera agotado");
      await new Promise((r) => {
        const t = setTimeout(r, left);
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return Buffer.from(out);
  }
  detach() {
    this.sock.removeAllListeners("data");
    this.sock.removeAllListeners("end");
    this.sock.removeAllListeners("close");
    this.sock.removeAllListeners("error");
    this.sock.on("error", () => {
    });
  }
};
var usbTiming = { step: 8e3, slow: 15e3, disk: 3e4 };
var TIMEOUT = 8e3;
var tag = 1;
var Usbmux = class {
  addrs;
  good = null;
  /** Detalle técnico de la última falla de conexión (para mostrar en pantalla). */
  lastError = null;
  constructor(addr) {
    this.addrs = addr ? Array.isArray(addr) ? addr : [addr] : muxAddresses();
  }
  openAt(a) {
    return new Promise((ok, ko) => {
      const s = a.path ? import_node_net2.default.connect(a.path) : import_node_net2.default.connect(a.port, a.host);
      const t = setTimeout(() => {
        s.destroy();
        ko(Object.assign(new Error("no responde"), { code: "ETIMEDOUT" }));
      }, 3e3);
      s.once("connect", () => {
        clearTimeout(t);
        ok(s);
      });
      s.once("error", (e) => {
        clearTimeout(t);
        ko(e);
      });
    });
  }
  /** Prueba la dirección que funcionó la última vez y, si falla, las demás. */
  async open() {
    const order = this.good ? [this.good, ...this.addrs.filter((x) => x !== this.good)] : this.addrs;
    const errs = [];
    for (const a of order) {
      try {
        const s = await this.openAt(a);
        this.good = a;
        return s;
      } catch (e) {
        errs.push(`${addrText(a)} ${e?.code ?? e?.message ?? "error"}`);
      }
    }
    this.good = null;
    this.lastError = `Sin conexi\xF3n al servicio de Apple (${errs.join(", ")})`;
    throw Object.assign(new Error(this.lastError), { code: "MUX_UNAVAILABLE" });
  }
  async exchange(sock, reader, msg) {
    const body = Buffer.from(toXml({ ClientVersionString: "celulares-al-costo", ProgName: "CelularesAlCosto", kLibUSBMuxVersion: 3, ...msg }), "utf8");
    const head = Buffer.alloc(16);
    head.writeUInt32LE(16 + body.length, 0);
    head.writeUInt32LE(1, 4);
    head.writeUInt32LE(8, 8);
    head.writeUInt32LE(tag++, 12);
    sock.write(Buffer.concat([head, body]));
    const h = await reader.read(16, TIMEOUT);
    const len = h.readUInt32LE(0);
    if (len < 16 || len > 4e6) throw new Error("respuesta usbmux inv\xE1lida");
    return parseAny(await reader.read(len - 16, TIMEOUT));
  }
  async once(msg) {
    const s = await this.open();
    const r = new Reader(s);
    try {
      return await this.exchange(s, r, msg);
    } finally {
      s.destroy();
    }
  }
  /** Equipos por cable. `raw` cuenta todo lo que informó el servicio (incluye equipos por Wi‑Fi). */
  lastRaw = { total: 0, network: 0, address: null };
  async listDevices() {
    const r = await this.once({ MessageType: "ListDevices" });
    const all = (Array.isArray(r.DeviceList) ? r.DeviceList : []).map((d) => {
      const p = d.Properties ?? {};
      return { deviceId: Number(d.DeviceID ?? p.DeviceID), udid: String(p.SerialNumber ?? p.UDID ?? p.UniqueDeviceID ?? ""), conn: p.ConnectionType };
    });
    this.lastRaw = { total: all.length, network: all.filter((d) => d.conn === "Network").length, address: this.good ? addrText(this.good) : null };
    this.lastError = null;
    return all.filter((d) => d.udid && Number.isFinite(d.deviceId) && d.conn !== "Network");
  }
  /** Registro de emparejamiento que guardó el servicio de Apple al tocar «Confiar». null si la PC no está autorizada. */
  async readPairRecord(udid) {
    const r = await this.once({ MessageType: "ReadPairRecord", PairRecordID: udid });
    if (!Buffer.isBuffer(r.PairRecordData)) return null;
    try {
      return parseAny(r.PairRecordData);
    } catch {
      return null;
    }
  }
  /** Abre un túnel a un puerto del iPhone (62078 = lockdownd). */
  async connect(deviceId, port) {
    const s = await this.open();
    const r = new Reader(s);
    const res = await this.exchange(s, r, { MessageType: "Connect", DeviceID: deviceId, PortNumber: (port & 255) << 8 | port >> 8 });
    r.detach();
    if (Number(res.Number) !== 0) {
      s.destroy();
      throw Object.assign(new Error(`conexi\xF3n rechazada (${res.Number})`), { code: "MUX_REFUSED" });
    }
    return s;
  }
};
var PlistChannel = class {
  constructor(sock) {
    this.sock = sock;
    this.reader = new Reader(sock);
  }
  sock;
  reader;
  async send(obj) {
    const body = Buffer.from(toXml(obj), "utf8");
    const h = Buffer.alloc(4);
    h.writeUInt32BE(body.length, 0);
    this.sock.write(Buffer.concat([h, body]));
  }
  /** Si una respuesta no llegó a tiempo, el canal queda desfasado y no se vuelve a usar. */
  broken = false;
  async recv(timeoutMs = usbTiming.step) {
    try {
      const len = (await this.reader.read(4, timeoutMs)).readUInt32BE(0);
      if (len > 8e6) throw new Error("respuesta demasiado grande");
      const b = await this.reader.read(len, timeoutMs);
      return parseAny(b);
    } catch (e) {
      this.broken = true;
      throw e;
    }
  }
  async request(obj, timeoutMs = usbTiming.step) {
    if (this.broken) throw new Error("la conexi\xF3n qued\xF3 esperando una respuesta anterior");
    await this.send({ Label: "CelularesAlCosto", ...obj });
    return this.recv(timeoutMs);
  }
  /** Pasa a TLS con el certificado del emparejamiento (lo exige lockdownd al iniciar la sesión). */
  async upgrade(pair) {
    this.reader.detach();
    const pem = (x) => Buffer.isBuffer(x) ? x.toString("utf8") : String(x);
    const base = {
      socket: this.sock,
      cert: pem(pair.HostCertificate),
      key: pem(pair.HostPrivateKey),
      rejectUnauthorized: false,
      checkServerIdentity: () => void 0,
      minVersion: "TLSv1"
    };
    let s;
    try {
      s = import_node_tls2.default.connect(process.versions.electron ? base : { ...base, ciphers: "DEFAULT:@SECLEVEL=0" });
    } catch {
      s = import_node_tls2.default.connect(base);
    }
    await new Promise((ok, ko) => {
      const t = setTimeout(() => ko(new Error("el cifrado no respondi\xF3")), TIMEOUT);
      s.once("secureConnect", () => {
        clearTimeout(t);
        ok();
      });
      s.once("error", (e) => {
        clearTimeout(t);
        ko(e);
      });
    });
    this.sock = s;
    this.reader = new Reader(s);
  }
  close() {
    try {
      this.sock.destroy();
    } catch {
    }
  }
};
var techText = (e) => String(e?.code ? `${e.code} ${e.message ?? ""}` : e?.message ?? e ?? "").replace(/[0-9A-F]{8}-?[0-9A-F]{8,}/gi, "\u2022\u2022\u2022").replace(/\s+/g, " ").trim().slice(0, 140);
async function readDevice(mux, dev) {
  const info = { battery: {} };
  const read = [];
  let step = "conexi\xF3n con el iPhone";
  let session = false;
  let ld;
  try {
    ld = new PlistChannel(await mux.connect(dev.deviceId, 62078));
  } catch (e) {
    return { state: "error", info, read, missing: [], message: "No se pudo abrir la conexi\xF3n con el iPhone. Desconectalo, desbloquealo y volv\xE9 a conectarlo.", detail: `${step}: ${techText(e)}` };
  }
  try {
    step = "consulta inicial";
    const qt = await ld.request({ Request: "QueryType" });
    if (qt.Type !== "com.apple.mobile.lockdown") throw new Error("el equipo no respondi\xF3 como un iPhone");
    const basic = await ld.request({ Request: "GetValue" });
    const bv = basic.Value ?? {};
    if (bv.DeviceClass && bv.DeviceClass !== "iPhone") return { state: "error", info, read, missing: [], message: `El equipo conectado es un ${bv.DeviceClass}: el diagn\xF3stico es para iPhone.` };
    if (bv.ProductType) {
      info.productType = String(bv.ProductType);
      info.model = modelName(info.productType);
      read.push("model");
    }
    if (bv.ProductVersion) {
      info.ios = String(bv.ProductVersion);
      read.push("ios");
    }
    if (bv.BuildVersion) info.build = String(bv.BuildVersion);
    step = "registro de autorizaci\xF3n";
    const pair = await mux.readPairRecord(dev.udid);
    const partial = (state, message) => ({ state, info, read, missing: ["capacityGb", "serial", "imei1", "battery"], message });
    if (!pair?.HostID || !pair?.HostCertificate) return partial("pending_trust", "La PC no est\xE1 autorizada: desbloque\xE1 el iPhone, abr\xED Dispositivos Apple (o iTunes) y toc\xE1 \xABConfiar\xBB en el iPhone.");
    step = "inicio de sesi\xF3n";
    const ss = await ld.request({ Request: "StartSession", HostID: pair.HostID, SystemBUID: pair.SystemBUID });
    if (ss.Error) {
      if (/PasswordProtected/i.test(ss.Error)) return partial("locked", "Desbloque\xE1 el iPhone y volv\xE9 a intentar.");
      if (/InvalidHostID|PairingDialogResponsePending|UserDeniedPairing|InvalidPairRecord/i.test(ss.Error)) return partial("pending_trust", "El iPhone no tiene autorizada esta PC: desbloquealo y toc\xE1 \xABConfiar\xBB (si no aparece, abr\xED Dispositivos Apple con el iPhone conectado).");
      return partial("error", "El iPhone no acept\xF3 la sesi\xF3n. Desconectalo, desbloquealo y volv\xE9 a conectarlo.");
    }
    step = "conexi\xF3n cifrada";
    if (ss.EnableSessionSSL) await ld.upgrade(pair);
    step = "datos del equipo";
    session = true;
    const full = (await ld.request({ Request: "GetValue" })).Value ?? {};
    if (full.SerialNumber) {
      info.serial = String(full.SerialNumber);
      read.push("serial");
    }
    if (full.InternationalMobileEquipmentIdentity) {
      info.imei1 = String(full.InternationalMobileEquipmentIdentity);
      read.push("imei1");
    }
    if (full.InternationalMobileEquipmentIdentity2) {
      info.imei2 = String(full.InternationalMobileEquipmentIdentity2);
      read.push("imei2");
    }
    if (full.ModelNumber) info.modelNumber = `${full.ModelNumber}${full.RegionInfo ?? ""}`;
    if (full.ProductType && !info.productType) {
      info.productType = String(full.ProductType);
      info.model = modelName(info.productType);
    }
    if (full.ProductVersion && !info.ios) info.ios = String(full.ProductVersion);
    session = true;
    const notes = [];
    const opt = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        notes.push(`${name}: ${techText(e)}`);
      }
    };
    await opt("carga actual", async () => {
      const bat = (await ld.request({ Request: "GetValue", Domain: "com.apple.mobile.battery" })).Value ?? {};
      if (Number.isFinite(Number(bat.BatteryCurrentCapacity))) {
        info.battery.chargePct = Number(bat.BatteryCurrentCapacity);
        read.push("battery.chargePct");
      }
      if (typeof bat.BatteryIsCharging === "boolean") info.battery.charging = bat.BatteryIsCharging;
    });
    await opt("ciclos de bater\xEDa", async () => {
      const svc = await ld.request({ Request: "StartService", Service: "com.apple.mobile.diagnostics_relay" });
      if (!svc.Port) throw new Error(svc.Error ? String(svc.Error) : "servicio no disponible");
      const ch = new PlistChannel(await mux.connect(dev.deviceId, Number(svc.Port)));
      try {
        if (svc.EnableServiceSSL) await ch.upgrade(pair);
        let reg = null;
        for (const cls of ["IOPMPowerSource", "AppleSmartBattery"]) {
          const r = await ch.request({ Request: "IORegistry", EntryClass: cls }, usbTiming.slow);
          if (r.Status === "Success" && r.Diagnostics?.IORegistry) {
            reg = r.Diagnostics.IORegistry;
            break;
          }
        }
        if (!reg) throw new Error("el iPhone no entreg\xF3 el registro de energ\xEDa");
        if (Number.isFinite(Number(reg.CycleCount))) {
          info.battery.cycles = Number(reg.CycleCount);
          read.push("battery.cycles");
        }
        const design = Number(reg.DesignCapacity);
        const max = Number(reg.NominalChargeCapacity ?? reg.AppleRawMaxCapacity);
        if (design > 0 && max > 0) {
          info.battery.estimatedMaxPct = Math.round(max / design * 100);
          read.push("battery.estimatedMaxPct");
        }
        await ch.send({ Request: "Goodbye" }).catch(() => {
        });
      } finally {
        ch.close();
      }
    });
    await opt("capacidad", async () => {
      let disk = (await ld.request({ Request: "GetValue", Domain: "com.apple.disk_usage.factory" })).Value ?? {};
      if (!Number(disk.TotalDiskCapacity)) disk = (await ld.request({ Request: "GetValue", Domain: "com.apple.disk_usage" }, usbTiming.disk)).Value ?? {};
      const cap = capacityGb(Number(disk.TotalDiskCapacity));
      if (!cap) throw new Error("el iPhone no inform\xF3 la capacidad");
      info.capacityGb = cap;
      read.push("capacityGb");
    });
    if (!ld.broken) await ld.request({ Request: "StopSession", SessionID: ss.SessionID }).catch(() => {
    });
    const want = ["model", "ios", "capacityGb", "serial", "imei1", "battery.chargePct", "battery.cycles"];
    const missing = want.filter((k) => !read.includes(k));
    return {
      state: "connected",
      session,
      info,
      read,
      missing,
      detail: notes.length ? notes.join(" \xB7 ") : null,
      message: notes.length ? "Algunos datos no se pudieron leer por USB: completalos con \xABEditar\xBB." : null
    };
  } catch (e) {
    const want = ["model", "ios", "capacityGb", "serial", "imei1", "battery.chargePct", "battery.cycles"];
    return {
      state: "error",
      session,
      info,
      read,
      missing: want.filter((k) => !read.includes(k)),
      message: "No se pudieron leer todos los datos por USB. Pod\xE9s seguir: complet\xE1 lo que falte con \xABEditar\xBB y abr\xED las pruebas con el QR.",
      detail: `${step}: ${techText(e)}`
    };
  } finally {
    ld.close();
  }
}

// scripts/usb-electron-check.ts
async function main() {
  console.log("Motor:", process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`, "\xB7 TLS:", process.versions.boringssl ? "BoringSSL" : `OpenSSL ${process.versions.openssl}`);
  const mux = await startFakeMux([SAMPLE_IPHONE({ ssl: true })]);
  try {
    const m = new Usbmux({ host: "127.0.0.1", port: mux.port });
    const [dev] = await m.listDevices();
    const r = await readDevice(m, dev);
    console.log("Estado:", r.state, "| le\xEDdo:", r.read.join(", "), "| detalle:", r.detail ?? "\u2014");
    if (r.state !== "connected" || r.info.serial !== "F2LXK0ABCD12" || r.info.battery?.cycles !== 412) throw new Error("La lectura cifrada no funcion\xF3");
    console.log("OK: lectura USB cifrada");
  } finally {
    await mux.close();
  }
}
main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
