// Aviso de productos ya cargados al escribir el nombre en «Cargar productos». Solo avisa: no impide cargar.

export interface DupProduct { id: number; repoId?: string | null; brand: string; model: string; ramGb: number | null; storageGb: number | null; condition: string }
export interface DupResult<P> { same: P[]; similar: P[] }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Memoria escrita en el nombre: «8/256», «256GB», «256 gb», «1TB». */
export function parseMem(name: string): { ram: number | null; storage: number | null; rest: string } {
  let s = norm(name);
  let ram: number | null = null, storage: number | null = null;
  const pair = s.match(/\b(\d{1,2})\s*(?:gb)?\s*[/+]\s*(\d{2,4})\s*(gb|tb)?\b/);
  if (pair) { ram = Number(pair[1]); storage = Number(pair[2]) * (pair[3] === 'tb' ? 1024 : 1); s = s.replace(pair[0], ' '); }
  const single = s.match(/\b(\d{2,4}|1|2)\s*(gb|tb)\b/);
  if (single && storage == null) { storage = Number(single[1]) * (single[2] === 'tb' ? 1024 : 1); s = s.replace(single[0], ' '); }
  if (single && storage != null) s = s.replace(single[0], ' ');
  return { ram, storage, rest: s };
}

/** Palabras que identifican el modelo (sin memoria, colores ni relleno). */
const FILLER = new Set(['de', 'con', 'y', 'nuevo', 'nueva', 'cpo', 'usado', 'usada', 'sellado', 'celular', 'telefono', 'smartphone', 'dual', 'sim', 'ram',
  'negro', 'blanco', 'azul', 'verde', 'rojo', 'rosa', 'gris', 'violeta', 'lila', 'dorado', 'plateado', 'black', 'white', 'blue', 'green', 'gray', 'grey', 'purple', 'gold', 'silver', 'pink']);
export function modelTokens(s: string): string[] {
  return norm(s).replace(/[^a-z0-9+]+/g, ' ').split(' ').filter((t) => t && !FILLER.has(t));
}

/**
 * Productos iguales (mismo modelo y misma memoria, si se escribió) o parecidos (mismo modelo con otra memoria, o un
 * nombre que contiene al otro: «iPhone 15» y «iPhone 15 Pro»). La marca puede faltar en lo escrito.
 */
export function findDuplicates<P extends DupProduct>(name: string, products: P[], editingRepoId?: string | null): DupResult<P> {
  const typed = parseMem(name);
  const t = modelTokens(typed.rest);
  if (t.length === 0 || t.join('').length < 3) return { same: [], similar: [] };
  const same: P[] = [], similar: P[] = [];
  for (const p of products) {
    if (editingRepoId && p.repoId === editingRepoId) continue;
    const brand = modelTokens(p.brand);
    const pm = modelTokens(p.model).filter((x) => !brand.includes(x));
    const tm = t.filter((x) => !brand.includes(x));
    if (!pm.length || !tm.length) continue;
    const setP = new Set(pm), setT = new Set(tm);
    const equal = setP.size === setT.size && [...setT].every((x) => setP.has(x));
    if (equal) {
      const memOk = (typed.storage == null || p.storageGb == null || typed.storage === p.storageGb) && (typed.ram == null || p.ramGb == null || typed.ram === p.ramGb);
      (memOk ? same : similar).push(p);
      continue;
    }
    // Uno contiene al otro y comparten el número de modelo (evita «Galaxy A55» ≈ «Galaxy A15»).
    const contains = [...setT].every((x) => setP.has(x)) || [...setP].every((x) => setT.has(x));
    const hasNumber = [...setT].some((x) => /\d/.test(x) && setP.has(x));
    if (contains && hasNumber && Math.min(setP.size, setT.size) >= 1) similar.push(p);
  }
  return { same: same.slice(0, 5), similar: similar.slice(0, 5) };
}
