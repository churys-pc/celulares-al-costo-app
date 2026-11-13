// Índice de fichas verificadas. Para agregar una: crear <marca-modelo>.json con el mismo formato y sumarla acá.
import type { Ficha } from '../../fichas.ts';
import iphone11 from './apple-iphone-11.json';
import a54 from './samsung-galaxy-a54-5g.json';
import a16_5g from './samsung-galaxy-a16-5g.json';
import a16_4g from './samsung-galaxy-a16-4g.json';
// Lote 2: iPhone en stock.
import ip_8_plus from './apple-iphone-8-plus.json';
import ip_12 from './apple-iphone-12.json';
import ip_13 from './apple-iphone-13.json';
import ip_13_pro from './apple-iphone-13-pro.json';
import ip_13_pro_max from './apple-iphone-13-pro-max.json';
import ip_14 from './apple-iphone-14.json';
import ip_14_pro from './apple-iphone-14-pro.json';
import ip_14_pro_max from './apple-iphone-14-pro-max.json';
import ip_15 from './apple-iphone-15.json';
import ip_16 from './apple-iphone-16.json';
import ip_17 from './apple-iphone-17.json';
import ip_air from './apple-iphone-air.json';
import ip_17_pro from './apple-iphone-17-pro.json';
import ip_17_pro_max from './apple-iphone-17-pro-max.json';
import ip_18_pro from './apple-iphone-18-pro.json';
import ip_18_pro_max from './apple-iphone-18-pro-max.json';

export const FICHAS = [iphone11, a54, a16_5g, a16_4g,
  ip_8_plus, ip_12, ip_13, ip_13_pro, ip_13_pro_max, ip_14, ip_14_pro, ip_14_pro_max, ip_15, ip_16, ip_17, ip_air, ip_17_pro, ip_17_pro_max, ip_18_pro, ip_18_pro_max] as unknown as Ficha[];
