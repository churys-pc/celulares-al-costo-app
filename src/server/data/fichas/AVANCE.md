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

## Próximos lotes (orden)
1. Completar lo pendiente del lote 1 con la ficha oficial de Samsung y GSMArena.
2. Modelos de los lotes precargados (Apple, Samsung, Xiaomi, varios): ~49 modelos con datos de una sola fuente.
3. Base popular (`popular-models.json`, 84 modelos) que las PCs bajan de Nanoreview.
4. Cada modelo nuevo cargado en «Cargar productos» aparece en Ajustes → Fichas técnicas como pendiente.
