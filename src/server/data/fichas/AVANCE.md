# Fichas técnicas — registro de avance

Una ficha por variante (`<marca>-<modelo>.json`, sumarla en `index.ts`). La app la aplica al arrancar y al sincronizar,
y tiene prioridad sobre los datos cargados automáticamente (Nanoreview / lotes viejos), que quedan como «Sin confirmar».

## Reglas
- **Verificado**: fuente oficial de la variante exacta, o dos fuentes técnicas independientes que coinciden.
  Dos páginas con el mismo valor exacto de AnTuTu cuentan como una sola fuente (copia).
- **Sin confirmar**: una sola fuente técnica, o fuentes que se contradicen.
- **Depende de la variante**: cambia según código de modelo o región; la nota dice qué dato hace falta para identificarla.
- **No compatible / No aplica**: solo con respaldo.
- AnTuTu: versión, fuente y si es promedio o medición individual. Solo se comparan puntajes de la misma versión.

## Lote 1 — 2026-11-13 (en stock + prueba 4G/5G)
| Ficha | Estado | Pendiente |
|---|---|---|
| apple-iphone-11 (en stock) | 28/31 verificados (oficial Apple) | Frecuencia de pantalla, microSD, iOS de fábrica |
| samsung-galaxy-a54-5g (en stock) | 19/35 verificados (2 fuentes técnicas) | RAM/almacenamiento, brillo típico/HBM, Wi-Fi, BT, IP67, microSD, macro, bandas/eSIM (falta código SM-A546…) |
| samsung-galaxy-a16-5g | 18/31 verificados | Procesador por región, RAM/almacenamiento, actualizaciones, IP54, Wi-Fi, BT, eSIM, microSD |
| samsung-galaxy-a16-4g | 0/26 verificados | Toda la ficha: una sola fuente técnica |

Fuentes usadas: support.apple.com, nanoreview.net, comparigon.com.
**Bloqueado**: samsung.com y gsmarena.com necesitan que el usuario habilite el acceso en esta sesión.

## Lote 1b — 2026-11-13 (reapertura de «Sin confirmar» con fuentes oficiales)
| Ficha | Antes → ahora (verificados) | Sigue abierto |
|---|---|---|
| apple-iphone-11 | 28/31 → 30/33 | microSD (una sola fuente explícita) |
| samsung-galaxy-a54-5g | 19/35 → 30/35 | Materiales; bandas/eSIM de la unidad; brillo típico/HBM |
| samsung-galaxy-a16-5g | 18/31 → 23/31 | Procesador de la unidad; RAM/almacenamiento; microSD máxima (Samsung se contradice) |
| samsung-galaxy-a16-4g | 0/26 → 23/32 | Nombre del chip; RAM/almacenamiento; Android de fábrica; carga inalámbrica |

Fuentes oficiales agregadas: Apple Newsroom (iPhone 11), Samsung Newsroom global/UK/Argentina, Samsung Hong Kong, Samsung Colombia (SM-A166M), Samsung Líbano (SM-A165F).

### Pendiente de búsqueda web (requiere aprobar acceso a gsmarena.com)
- iPhone 11 · microSD → `"iPhone 11" "card slot" site:gsmarena.com`
- Galaxy A54 5G · materiales → `"Galaxy A54" build frame plastic site:gsmarena.com`
- Galaxy A16 (SM-A165F) · chip → `"Galaxy A16" SM-A165F chipset site:gsmarena.com`
- Galaxy A16 (SM-A165F) · Android de fábrica → `"Galaxy A16" LTE "Android 14" site:gsmarena.com`
- Galaxy A16 5G · 4 GB/128 GB → `"Galaxy A16 5G" "4GB RAM" 128GB site:samsung.com`

### Valores vistos en Google sin validar
- GSMArena (vista previa): Galaxy A16 «4-8GB RAM Helio G99» y modelos SM-A165F/M. No se abrió: el acceso a gsmarena.com quedó sin aprobar.
- Three UK (devicesupport.three.co.uk): A16 4G con Helio G99 y BT 5.3. No se abrió: operador, dominio sin aprobar.

## Lote 2 — 2026-11-13 (iPhone en stock, 16 fichas)
Verificados: 436 de 481 campos (91%) · Sin confirmar 30 · Depende de la variante 14 · No compatible 1.

| Ficha | Verificados | Sigue abierto |
|---|---|---|
| iPhone 8 Plus | 23/28 | RAM, batería, frecuencia (una sola fuente); AnTuTu sin versión |
| iPhone 12 | 28/30 | Sistema de fábrica, fecha (una fuente) |
| iPhone 13 | 28/30 | Sistema de fábrica, fecha |
| iPhone 13 Pro | 28/31 | Batería (3125 vs 3095), potencia de carga (20 vs 23 W) |
| iPhone 13 Pro Max | 28/30 | Batería (4373 vs 4352), potencia de carga |
| iPhone 14 | 27/30 | Sistema de fábrica, fecha |
| iPhone 14 Pro / Pro Max | 28/30 | Sistema de fábrica |
| iPhone 15 | 26/30 | Batería (3300 vs 3349/3389) |
| iPhone 16 | 27/30 | Potencia de carga (30 vs 27 W) |
| iPhone 17 | 27/30 | Sistema de fábrica, fecha |
| iPhone 17 Air (iPhone Air) | 27/29 | AnTuTu (2.568.709 vs 1.821.832: no se cargó) |
| iPhone 17 Pro | 27/30 | Batería según versión SIM/eSIM; Nanoreview no respondió |
| iPhone 17 Pro Max | 27/31 | Batería según versión (4823 nano-SIM / 5088 eSIM) |
| iPhone 18 Pro | 28/31 | RAM (una fuente); AnTuTu v11 sin publicar |
| iPhone 18 Pro Max | 29/31 | AnTuTu v11 sin publicar |

Criterios: todo lo que Apple publica (pantalla, chip, cámaras, medidas, conectividad, carga en minutos) = oficial. RAM/mAh/W: dos fuentes técnicas que coincidan. SIM desde el 14: «Depende de la variante» (EE.UU. solo eSIM). Batería del 17 Pro/Pro Max y 18 Pro/Pro Max: «Depende de la variante» (cambia entre versión con bandeja SIM y solo eSIM).
AnTuTu: solo valores marcados como v11, medición individual. **Ojo**: Comparigon copia varios puntajes de Nanoreview (12, 13, 14 Pro): cuentan como una sola fuente.
Fuentes nuevas: MacRumors y PhoneArena (baterías 18 Pro según Apple / base energética de la UE), Macworld (baterías Pro Max por generación).

### Pendiente de búsqueda web (lote 2)
- iPhone 13 Pro / Pro Max · batería → `"iPhone 13 Pro" battery mAh site:gsmarena.com`
- iPhone 15 · batería → `"iPhone 15" 3349 mAh site:gsmarena.com`
- iPhone 16 · potencia de carga → `"iPhone 16" wired charging W site:gsmarena.com`
- iPhone 8 Plus · RAM/batería → `"iPhone 8 Plus" site:gsmarena.com`
- iPhone 18 Pro · RAM → `"iPhone 18 Pro" RAM site:gsmarena.com`
- AnTuTu v11 de 8 Plus, Air, 18 Pro, 18 Pro Max → `"iPhone 18 Pro" AnTuTu v11`

### Valores vistos en Google sin validar (lote 2)
- GSMArena (vista previa): iPhone 18 Pro Max «12GB RAM» en todas las capacidades. No se abrió (dominio sin aprobar).
- Rumores previos al lanzamiento (Macworld, Notebookcheck, HotHardware): 18 Pro Max 5235/5425 mAh. Descartados: el dato confirmado es 5391 mAh (versión con bandeja SIM).

## Próximos lotes (orden)
1. ~~Lote 2: iPhone en stock~~ (hecho, ver arriba).
2. Modelos de los lotes precargados (Apple, Samsung, Xiaomi, varios): ~49 modelos con datos de una sola fuente.
3. Base popular (`popular-models.json`, 84 modelos) que las PCs bajan de Nanoreview.
4. Cada modelo nuevo cargado en «Cargar productos» aparece en Ajustes → Fichas técnicas como pendiente.
