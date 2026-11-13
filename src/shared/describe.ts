// Descripción comercial breve a partir de la ficha (sin IA externa: solo datos con fuente, nada inventado).
type S = { key: string; value: string };
const nf = (n: number) => n.toLocaleString('es-UY');

export function describe(specs: S[], antutu?: { version: string; total: number } | null): string {
  const g = (k: string) => specs.find((s) => s.key === k)?.value?.trim();
  const parts: string[] = [];
  const chip = g('Procesador');
  if (chip) parts.push(`Procesador ${chip}${antutu ? ` (${nf(antutu.total)} puntos en AnTuTu ${antutu.version.toUpperCase()})` : ''}`);
  const screen = g('Tamaño y tipo');
  if (screen) parts.push(`pantalla ${screen}${g('Frecuencia') ? ` de ${g('Frecuencia')}` : ''}`);
  const cam = g('Cámara principal');
  if (cam) parts.push(`cámara principal de ${cam}${g('Cámara frontal') ? ` y frontal de ${g('Cámara frontal')}` : ''}`);
  const bat = g('Batería');
  if (bat) parts.push(`batería de ${bat}${g('Carga rápida') ? ` con carga de ${g('Carga rápida')}` : ''}`);
  const mem = [g('RAM') && `${g('RAM')} de RAM`, g('Almacenamiento') && `${g('Almacenamiento')} de almacenamiento`].filter(Boolean).join(' y ');
  if (mem) parts.push(mem);
  const extras = [g('5G') === 'Sí' && '5G', g('NFC') === 'Sí' && 'NFC', g('Resistencia') && `resistencia ${g('Resistencia')}`].filter(Boolean);
  if (extras.length) parts.push(extras.join(', '));
  if (!parts.length) return '';
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
