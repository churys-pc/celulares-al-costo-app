// Índice de fichas verificadas. Para agregar una: crear <marca-modelo>.json con el mismo formato y sumarla acá.
import type { Ficha } from '../../fichas.ts';
import iphone11 from './apple-iphone-11.json';
import a54 from './samsung-galaxy-a54-5g.json';
import a16_5g from './samsung-galaxy-a16-5g.json';
import a16_4g from './samsung-galaxy-a16-4g.json';

export const FICHAS = [iphone11, a54, a16_5g, a16_4g] as unknown as Ficha[];
