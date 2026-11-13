// Actualizaciones de iOS por modelo de iPhone.
// Dato oficial: qué versión de iOS recibe (lista de compatibilidad de iOS 27, Apple, junio 2026).
// Apple NO publica hasta cuándo actualiza cada modelo: el «hasta» es una estimación basada en el historial
// (los iPhone recibieron nuevas versiones de iOS durante 5 a 7 años desde su lanzamiento) y se muestra como tal.
// Actualizar CURRENT_IOS cada año cuando Apple publique la nueva lista.

export const CURRENT_IOS = 27;
const CURRENT_YEAR = 2026;
export const IOS_SOURCE = { name: 'Apple: compatibilidad de iOS 27 (jun. 2026)', url: 'https://9to5mac.com/2026/06/08/ios-27-here-are-all-the-compatible-iphone-models/' };

/** Año de lanzamiento por generación (dato público de Apple). */
const LAUNCH: [RegExp, number][] = [
  [/\bse\b.*(3|2022|tercera)/i, 2022], [/\bse\b.*(2|2020|segunda)/i, 2020],
  [/\b18\b/, 2026], [/\b17e\b/i, 2026], [/\b17\b|\bair\b/i, 2025], [/\b16e\b/i, 2025], [/\b16\b/, 2024], [/\b15\b/, 2023],
  [/\b14\b/, 2022], [/\b13\b/, 2021], [/\b12\b/, 2020], [/\b11\b/, 2019],
  [/\bx[sr]\b|\bxs max\b/i, 2018], [/\bx\b/i, 2017], [/\b8\b/, 2017],
];
/** Última versión mayor de iOS para modelos que ya no reciben la actual. */
const LAST_IOS: [RegExp, number][] = [[/\bx[sr]\b|\bxs max\b/i, 18], [/\bx\b/i, 16], [/\b8\b/, 16]];

export interface IosSupport { launchYear: number; latest: number; current: boolean; label: string; estimate: string }

export function iosSupport(brand: string, model: string): IosSupport | null {
  if (!/apple/i.test(brand) && !/iphone/i.test(model)) return null;
  const m = model.replace(/iphone/i, ' ').trim();
  const launch = LAUNCH.find(([re]) => re.test(m))?.[1];
  if (!launch) return null;
  const old = launch < 2019 ? LAST_IOS.find(([re]) => re.test(m))?.[1] : undefined;
  if (old) {
    return { launchYear: launch, latest: old, current: false,
      label: `Llegó hasta iOS ${old}`, estimate: 'Ya no recibe nuevas versiones de iOS' };
  }
  // Estimación: 6 a 7 años desde el lanzamiento, nunca antes del año actual (si hoy recibe la versión vigente).
  const from = Math.max(launch + 6, CURRENT_YEAR), to = Math.max(launch + 7, from + 1);
  return { launchYear: launch, latest: CURRENT_IOS, current: true,
    label: `Recibe iOS ${CURRENT_IOS} (la actual)`, estimate: `Estimado: hasta ${from}–${to} (no oficial)` };
}
