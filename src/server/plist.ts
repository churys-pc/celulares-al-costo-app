// Listas de propiedades de Apple (plist): XML (lectura y escritura) y binario «bplist00» (solo lectura).
// Es lo que usan usbmuxd y lockdownd para hablar con el iPhone.

export type PlistValue = string | number | bigint | boolean | Buffer | Date | PlistValue[] | { [k: string]: PlistValue } | null;
/** Para forzar <real> en lugar de <integer>. */
export class PReal { constructor(public v: number) {} }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toXml(v: unknown): string {
  const ser = (x: any): string => {
    if (x === null || x === undefined) return '<string></string>';
    if (x instanceof PReal) return `<real>${x.v}</real>`;
    if (typeof x === 'boolean') return x ? '<true/>' : '<false/>';
    if (typeof x === 'number') return Number.isInteger(x) ? `<integer>${x}</integer>` : `<real>${x}</real>`;
    if (typeof x === 'bigint') return `<integer>${x}</integer>`;
    if (typeof x === 'string') return `<string>${esc(x)}</string>`;
    if (Buffer.isBuffer(x)) return `<data>${x.toString('base64')}</data>`;
    if (x instanceof Date) return `<date>${x.toISOString().replace(/\.\d+Z$/, 'Z')}</date>`;
    if (Array.isArray(x)) return `<array>${x.map(ser).join('')}</array>`;
    return `<dict>${Object.entries(x).filter(([, y]) => y !== undefined).map(([k, y]) => `<key>${esc(k)}</key>${ser(y)}`).join('')}</dict>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${ser(v)}</plist>\n`;
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');

export function parseXml(text: string): PlistValue {
  const body = text.replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z]+)(\s[^>]*)?(\/?)>|([^<]+)/g;
  const toks: { close: boolean; name: string; self: boolean; text?: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[5] !== undefined) { if (m[5].trim() || toks.at(-1)?.name === 'string' || toks.at(-1)?.name === 'key') toks.push({ close: false, name: '#text', self: false, text: m[5] }); }
    else toks.push({ close: m[1] === '/', name: m[2], self: m[4] === '/' });
  }
  let i = 0;
  const textUntil = (name: string) => { let s = ''; while (i < toks.length && !(toks[i].close && toks[i].name === name)) { s += toks[i].text ?? ''; i++; } i++; return s; };
  const val = (): PlistValue => {
    const t = toks[i++];
    if (!t) throw new Error('plist incompleto');
    if (t.name === 'plist') { const v = val(); while (i < toks.length && !(toks[i].close && toks[i].name === 'plist')) i++; i++; return v; }
    if (t.self) {
      if (t.name === 'true') return true; if (t.name === 'false') return false;
      if (t.name === 'array') return []; if (t.name === 'dict') return {}; if (t.name === 'string' || t.name === 'data') return t.name === 'data' ? Buffer.alloc(0) : '';
      throw new Error(`etiqueta inesperada ${t.name}`);
    }
    switch (t.name) {
      case 'string': return unesc(textUntil('string'));
      case 'integer': { const s = textUntil('integer').trim(); const n = Number(s); return Number.isSafeInteger(n) ? n : BigInt(s); }
      case 'real': return Number(textUntil('real').trim());
      case 'date': return new Date(textUntil('date').trim());
      case 'data': return Buffer.from(textUntil('data').replace(/\s+/g, ''), 'base64');
      case 'array': { const a: PlistValue[] = []; while (!(toks[i].close && toks[i].name === 'array')) a.push(val()); i++; return a; }
      case 'dict': {
        const o: Record<string, PlistValue> = {};
        while (!(toks[i].close && toks[i].name === 'dict')) {
          const k = toks[i++]; if (k.name !== 'key') throw new Error('dict sin clave');
          const key = unesc(textUntil('key'));
          o[key] = val();
        }
        i++; return o;
      }
      default: throw new Error(`etiqueta inesperada ${t.name}`);
    }
  };
  return val();
}

/** Lector de plist binario («bplist00»). */
export function parseBinary(buf: Buffer): PlistValue {
  if (buf.subarray(0, 8).toString('latin1') !== 'bplist00') throw new Error('No es un plist binario');
  const tr = buf.subarray(buf.length - 32);
  const offSize = tr[6], refSize = tr[7];
  const numObjects = Number(tr.readBigUInt64BE(8)), top = Number(tr.readBigUInt64BE(16)), tableOff = Number(tr.readBigUInt64BE(24));
  const readN = (pos: number, n: number) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + buf[pos + k]; return v; };
  const offsets = Array.from({ length: numObjects }, (_, k) => readN(tableOff + k * offSize, offSize));
  const seen = new Set<number>();
  const obj = (ref: number): PlistValue => {
    if (seen.has(ref)) throw new Error('plist con referencia circular');
    seen.add(ref);
    try {
      let p = offsets[ref]; const marker = buf[p++]; const hi = marker >> 4; let lo = marker & 0xf;
      const len = () => { if (lo !== 0xf) return lo; const m2 = buf[p++]; const n = 1 << (m2 & 0xf); const v = readN(p, n); p += n; return v; };
      switch (hi) {
        case 0x0: return lo === 0x8 ? false : lo === 0x9 ? true : null;
        case 0x1: { const n = 1 << lo; if (n === 8) { const v = buf.readBigInt64BE(p); return v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER ? Number(v) : v; } return readN(p, n); }
        case 0x2: return lo === 2 ? buf.readFloatBE(p) : buf.readDoubleBE(p);
        case 0x3: return new Date(Date.UTC(2001, 0, 1) + buf.readDoubleBE(p) * 1000);
        case 0x4: { const n = len(); return Buffer.from(buf.subarray(p, p + n)); }
        case 0x5: { const n = len(); return buf.subarray(p, p + n).toString('latin1'); }
        case 0x6: { const n = len(); const b = Buffer.from(buf.subarray(p, p + n * 2)); b.swap16(); return b.toString('utf16le'); }
        case 0x8: return readN(p, lo + 1);
        case 0xa: { const n = len(); const a: PlistValue[] = []; for (let k = 0; k < n; k++) a.push(obj(readN(p + k * refSize, refSize))); return a; }
        case 0xd: {
          const n = len(); const o: Record<string, PlistValue> = {};
          for (let k = 0; k < n; k++) o[String(obj(readN(p + k * refSize, refSize)))] = obj(readN(p + (n + k) * refSize, refSize));
          return o;
        }
        default: throw new Error(`tipo de plist binario no soportado (${hi})`);
      }
    } finally { seen.delete(ref); }
  };
  return obj(top);
}

export function parseAny(buf: Buffer): PlistValue {
  return buf.subarray(0, 8).toString('latin1') === 'bplist00' ? parseBinary(buf) : parseXml(buf.toString('utf8'));
}
