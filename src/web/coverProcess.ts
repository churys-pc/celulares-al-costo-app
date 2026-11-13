// Procesa una imagen oficial de un celular para usarla como portada: quita el fondo liso (si no es transparente),
// recorta al equipo y lo centra en un cuadrado de 768 × 768 con márgenes parejos, como WebP con transparencia.
// Se ejecuta en el navegador (canvas). Es el mismo criterio de las portadas incluidas en la app.

export interface CoverResult { blob: Blob; width: number; height: number; removedBackground: boolean }

export const COVER_SIDE = 768;   // portada final: cuadrado de 768 × 768
const MARGIN = 0.06;              // margen parejo alrededor del equipo (fracción del lado)

/** Quita el fondo liso conectado a los bordes (inundación desde el borde) con borde suavizado. Devuelve false si el fondo no es liso. */
export function removeFlatBackground(img: ImageData): boolean {
  const { width: w, height: h, data: d } = img;
  // Color de fondo: mediana de los píxeles del borde.
  const border: number[][] = [];
  for (let x = 0; x < w; x++) border.push(px(d, x, 0, w), px(d, x, h - 1, w));
  for (let y = 0; y < h; y++) border.push(px(d, 0, y, w), px(d, w - 1, y, w));
  const med = [0, 1, 2].map((c) => border.map((p) => p[c]).sort((a, b) => a - b)[border.length >> 1]);
  const close = border.filter((p) => dist(p, med) < 18).length / border.length;
  if (close < 0.9) return false; // fondo no uniforme: no se toca (queda pendiente de revisión)
  const HARD = 22, SOFT = 70;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => { if (!seen[i]) { seen[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop()!;
    const o = i * 4;
    const dd = dist([d[o], d[o + 1], d[o + 2]], med);
    if (dd >= SOFT) continue;
    if (dd >= HARD) {
      // Borde: transparencia parcial y se descuenta el color de fondo (sin halo claro).
      const a = (dd - HARD) / (SOFT - HARD);
      for (let c = 0; c < 3; c++) d[o + c] = clamp((d[o + c] - med[c] * (1 - a)) / Math.max(a, 0.05));
      d[o + 3] = Math.round(d[o + 3] * a);
      continue;
    }
    d[o + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  return true;
}

function px(d: Uint8ClampedArray, x: number, y: number, w: number) { const o = (y * w + x) * 4; return [d[o], d[o + 1], d[o + 2], d[o + 3]]; }
function dist(a: number[], b: number[]) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function clamp(v: number) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

/** Proporción de píxeles del borde que ya son transparentes. */
function borderTransparency(img: ImageData): number {
  const { width: w, height: h, data: d } = img; let t = 0, n = 0;
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { n++; if (d[(y * w + x) * 4 + 3] < 16) t++; }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { n++; if (d[(y * w + x) * 4 + 3] < 16) t++; }
  return t / n;
}

/** Recuadro de los píxeles visibles. */
function bbox(img: ImageData) {
  const { width: w, height: h, data: d } = img; let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export async function processCover(source: Blob): Promise<CoverResult> {
  const bmp = await createImageBitmap(source);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  let removed = false;
  if (borderTransparency(img) < 0.9) {
    if (!removeFlatBackground(img)) throw new Error('El fondo de la imagen no es liso: no se puede recortar de forma confiable');
    removed = true;
  }
  const box = bbox(img);
  if (!box) throw new Error('La imagen quedó vacía al quitar el fondo');
  ctx.putImageData(img, 0, 0);
  const inner = COVER_SIDE * (1 - MARGIN * 2);
  const scale = inner / Math.max(box.w, box.h);
  const dw = box.w * scale, dh = box.h * scale;
  const ow = COVER_SIDE, oh = COVER_SIDE;
  const out = new OffscreenCanvas(ow, oh);
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(c, box.x, box.y, box.w, box.h, (ow - dw) / 2, (oh - dh) / 2, dw, dh);
  const blob = await out.convertToBlob({ type: 'image/webp', quality: 0.92 });
  if (blob.type !== 'image/webp') throw new Error('Este equipo no puede generar WebP');
  return { blob, width: ow, height: oh, removedBackground: removed };
}
