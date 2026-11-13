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
// Lote 3a: Samsung serie A en stock.
import sg_a07_4g from './samsung-galaxy-a07-4g.json';
import sg_a17_5g from './samsung-galaxy-a17-5g.json';
import sg_a17_4g from './samsung-galaxy-a17-4g.json';
import sg_a26_5g from './samsung-galaxy-a26-5g.json';
import sg_a27_5g from './samsung-galaxy-a27-5g.json';
import sg_a34_5g from './samsung-galaxy-a34-5g.json';
import sg_a35_5g from './samsung-galaxy-a35-5g.json';
import sg_a37_5g from './samsung-galaxy-a37-5g.json';
import sg_a57_5g from './samsung-galaxy-a57-5g.json';
// Lote 3b: Samsung serie S en stock.
import sg_s20_fe_5g from './samsung-galaxy-s20-fe-5g.json';
import sg_s23 from './samsung-galaxy-s23.json';
import sg_s23_fe from './samsung-galaxy-s23-fe.json';
import sg_s24 from './samsung-galaxy-s24.json';
import sg_s24_plus from './samsung-galaxy-s24-plus.json';
import sg_s25 from './samsung-galaxy-s25.json';
import sg_s25_plus from './samsung-galaxy-s25-plus.json';
import sg_s25_ultra from './samsung-galaxy-s25-ultra.json';
import sg_s25_fe from './samsung-galaxy-s25-fe.json';
import sg_s26 from './samsung-galaxy-s26.json';
import sg_s26_ultra from './samsung-galaxy-s26-ultra.json';

export const FICHAS = [iphone11, a54, a16_5g, a16_4g,
  ip_8_plus, ip_12, ip_13, ip_13_pro, ip_13_pro_max, ip_14, ip_14_pro, ip_14_pro_max, ip_15, ip_16, ip_17, ip_air, ip_17_pro, ip_17_pro_max, ip_18_pro, ip_18_pro_max,
  sg_a07_4g, sg_a17_5g, sg_a17_4g, sg_a26_5g, sg_a27_5g, sg_a34_5g, sg_a35_5g, sg_a37_5g, sg_a57_5g,
  sg_s20_fe_5g, sg_s23, sg_s23_fe, sg_s24, sg_s24_plus, sg_s25, sg_s25_plus, sg_s25_ultra, sg_s25_fe, sg_s26, sg_s26_ultra] as unknown as Ficha[];
