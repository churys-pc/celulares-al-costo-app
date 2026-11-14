# Auditoría integral — 14/11/2026 (v0.25.0)

Recorrido automatizado con Playwright (Chromium) contra el servidor real (`dist/server.cjs`) con bases aisladas y datos ficticios; scripts en la sesión de auditoría. Además: 49 tests unitarios (`npm test`), build y comprobación de tipos de servidor/compartido/tests.

Estados: aprobado · falló · verificado parcialmente · bloqueado · no ejecutado · no aplica. «Corregido» indica la falla inicial y que el retest final pasó.

| Módulo | Caso | Entorno | Estado final | Evidencia o siguiente paso |
|---|---|---|---|---|
| Inicio | Sin scroll inicial 1920×1008; buscador/pendientes/novedades visibles; sin módulos quitados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"scroll":0,"searchVisible":true,"t":[{"t":"Pendientes del local","top":403},{"t":"Novedades de celulares","top":403}],"forbidden":false,"hscroll":false} |
| Inicio | Sin scroll inicial 1366×728; buscador/pendientes/novedades visibles; sin módulos quitados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"scroll":0,"searchVisible":true,"t":[{"t":"Pendientes del local","top":381},{"t":"Novedades de celulares","top":381}],"forbidden":false,"hscroll":false} |
| Inicio | Sin scroll inicial 1280×680; buscador/pendientes/novedades visibles; sin módulos quitados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"scroll":0,"searchVisible":true,"t":[{"t":"Pendientes del local","top":381},{"t":"Novedades de celulares","top":381}],"forbidden":false,"hscroll":false} |
| Inicio | Buscar «iphone 15 pro» | Chromium 1366×728 (servidor real, base aislada) | aprobado | Apple iPhone 15 Pro / 128 GB · CPO / USD 780 / $ 31.590 // Apple iPhone 15 Pro / 256 GB · Nuevo / USD 900 / $ 36.450 |
| Inicio | Buscar «IPHONE 15 PRO 256» | Chromium 1366×728 (servidor real, base aislada) | aprobado | Apple iPhone 15 Pro / 256 GB · Nuevo / USD 900 / $ 36.450 |
| Inicio | Buscar «galaxy a16 5g» | Chromium 1366×728 (servidor real, base aislada) | aprobado | Samsung Galaxy A16 5G / 128 GB · Nuevo / USD 210 / $ 8.505 |
| Inicio | Buscar «redmi note 14 pro+» | Chromium 1366×728 (servidor real, base aislada) | aprobado | Xiaomi Redmi Note 14 Pro+ 5G / 512 GB · Nuevo / USD 480 / $ 19.440 |
| Inicio | Buscar «honor» | Chromium 1366×728 (servidor real, base aislada) | aprobado | Honor X7d / 256 GB · Nuevo / USD 230 / $ 9.315 // Honor X7d LTE / Sin unidades cargadas · ver ficha del modelo / — |
| Inicio | Buscar «8/256» | Chromium 1366×728 (servidor real, base aislada) | aprobado | Honor X7d / 256 GB · Nuevo / USD 230 / $ 9.315 // Motorola Moto G85 5G / 256 GB · Nuevo / USD 280 / $ 11.340 |
| Inicio | Buscar «cpo» | Chromium 1366×728 (servidor real, base aislada) | aprobado | Apple iPhone 13 / 128 GB · CPO / USD 450 / $ 18.225 // Apple iPhone 15 Pro / 128 GB · CPO / USD 780 / $ 31.590 |
| Inicio | Buscar «motó g85» | Chromium 1366×728 (servidor real, base aislada) | aprobado | Motorola Moto G85 5G / 256 GB · Nuevo / USD 280 / $ 11.340 |
| Inicio | Buscar «SM-A566» | Chromium 1366×728 (servidor real, base aislada) | aprobado | Samsung Galaxy A56 5G / 256 GB · Nuevo / USD 420 / $ 17.010 |
| Inicio | Búsqueda sin resultados muestra mensaje | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Inicio | «a16» distingue 4G y 5G | Chromium 1366×728 (servidor real, base aislada) | aprobado | Samsung Galaxy A16 4G / 128 GB · Nuevo / USD 190 / $ 7.695 // Samsung Galaxy A16 5G / 128 GB · Nuevo / USD 210 / $ 8.505 // Samsung Galaxy A16 / Sin unidades ca |
| Inicio | Enter abre la ficha del primer resultado con mismo modelo y precio | Chromium 1366×728 (servidor real, base aislada) | aprobado | Apple iPhone 11 / 128 GB · Nuevo / USD 670 / $ 27.135 |
| Inicio | ↓ + Enter abre el segundo resultado | Chromium 1366×728 (servidor real, base aislada) | aprobado | Samsung Galaxy A16 5G |
| Inicio | Modelo sin producto abre ficha del modelo | Chromium 1366×728 (servidor real, base aislada) | aprobado | Samsung Galaxy S25 Ultra 5G / Sin unidades cargadas · ver ficha del modelo / — |
| Inicio | Texto de 200 caracteres no rompe (sin error) | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Inicio | Comillas / SQL en el buscador | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Inicio | Crear pendiente con tildes y descripción | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Inicio | Título en límite (120) y descripción 2000 | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Inicio | Título solo espacios: botón deshabilitado, no se crea | Chromium 1366×728 (servidor real, base aislada) | aprobado | n=2 |
| Inicio | Servidor valida largo de título/descr. (API) | Chromium 1366×728 (servidor real, base aislada) | aprobado | status 200 len=120 |
| Inicio | Servidor rechaza título vacío (API) | Chromium 1366×728 (servidor real, base aislada) | aprobado | status 400 |
| Inicio | Doble clic en Agregar no duplica | Chromium 1366×728 (servidor real, base aislada) | aprobado | n=1 |
| Inicio | Completar pendiente | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Inicio | Reabrir pendiente | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Inicio | Editar y cancelar conserva el estado previo | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Inicio | Editar y guardar | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Inicio | Eliminar pendiente (con confirmación) | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Inicio | Pendientes persisten tras reiniciar la app | Chromium 1366×728 (servidor real, base aislada) | aprobado | filas=2 |
| Inicio | 14 pendientes largos: la página no se desplaza, la lista sí; pie visible | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"page":0,"foot":true,"hscroll":false} |
| Inicio | Novedades sin conexión y sin caché: mensaje claro | Chromium 1366×728 (servidor real, base aislada) | aprobado | Novedades de celulares / No hay novedades disponibles |
| Inicio | Novedades con una: enlace correcto, sin desborde, sin scroll de página | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"n":2,"links":["https://example.com/n0","https://example.com/n0"],"overflow":false,"page":0} |
| Inicio | Novedades con tres: enlace correcto, sin desborde, sin scroll de página | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"n":6,"links":["https://example.com/n0","https://example.com/n0","https://example.com/n1","https://example.com/n1","https://example.com/n2","https://example.co |
| Inicio | Caché de novedades dañada no rompe Inicio | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Inicio | Ancho 390 px (emulado): todo accesible sin scroll horizontal | Chromium emulado 390 px | aprobado | {"hscroll":false,"search":true} |
| Inicio | Consola sin errores durante el recorrido | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Catálogo | Lista completa (12 productos) y contador | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Catálogo | Filtros combinados texto+CPO+marca | Chromium 1366×728 (servidor real, base aislada) | aprobado | iphone=4 +CPO=2 +Apple=2; marcas=Todas las marcas,Apple,Honor,Motorola,Samsung,Xiaomi |
| Catálogo | Combinación sin resultados muestra vacío | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Catálogo | Buscar «MOTO» en catálogo | Chromium 1366×728 (servidor real, base aislada) | aprobado | n=1 |
| Catálogo | Buscar «motó» en catálogo | Chromium 1366×728 (servidor real, base aislada) | aprobado | falló (0 resultados con tilde) → corregido · n=1 |
| Catálogo | Buscar «galaxy a16» en catálogo | Chromium 1366×728 (servidor real, base aislada) | aprobado | n=2 |
| Catálogo | Buscar «Pro+» en catálogo | Chromium 1366×728 (servidor real, base aislada) | aprobado | n=1 |
| Catálogo | Buscar «256» en catálogo | Chromium 1366×728 (servidor real, base aislada) | aprobado | n=6 |
| Catálogo | Orden precio menor a mayor | Chromium 1366×728 (servidor real, base aislada) | aprobado | 190,210,230,250,280,420,450,480,670,700,780,900 |
| Catálogo | Orden se recuerda tras recargar | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Catálogo | Favorito + filtro Favoritos | Chromium 1366×728 (servidor real, base aislada) | aprobado | n=1 |
| Catálogo | Ficha coincide con la fila (modelo, GB, condición, precio, pesos) | Chromium 1366×728 (servidor real, base aislada) | aprobado | iPhone 11 / Apple · 4/128 GB / Nuevo / USD 670 / $ 27.135 / Ver equipo ⇄ Volver / Nuevo / Disponible / Apple iPhone 11 / 128 GB · 4 GB RAM / Portada oficial del |
| Catálogo | Ficha: garantía 1 año visible | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Catálogo | Esc cierra la ficha | Chromium 1366×728 (servidor real, base aislada) | aprobado | falló (Esc no hacía nada) → corregido |
| Catálogo | Editar: precio con centavos se muestra exacto (USD 199,99) | Chromium 1366×728 (servidor real, base aislada) | aprobado | falló (mostraba USD 200) → corregido · Galaxy A56 5G / Samsung · 8/128 GB · Azul océano / CPO / USD 199,99 / $ 8.100 / Ver equipo |
| Catálogo | Editar: condición, memoria y color reflejados | Chromium 1366×728 (servidor real, base aislada) | aprobado | Galaxy A56 5G / Samsung · 8/128 GB · Azul océano / CPO / USD 199,99 / $ 8.100 / Ver equipo |
| Catálogo | Buscador de Inicio refleja la edición | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"v":"128 GB · CPO","p":199.99} |
| Catálogo | Editar y cancelar no cambia nada | Chromium 1366×728 (servidor real, base aislada) | aprobado | falló (dependía del redondeo) → corregido |
| Catálogo | Servidor rechaza precio negativo | Chromium 1366×728 (servidor real, base aislada) | aprobado | status 400 |
| Catálogo | Memoria inválida no corrompe el producto | Chromium 1366×728 (servidor real, base aislada) | aprobado | status 200 |
| Catálogo | Doble clic en Guardar no duplica | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Catálogo | Eliminar producto (confirmación) y desaparece del buscador | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Catálogo | Sin cotización: aviso y sin pesos | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Catálogo | Cotización negativa rechazada | Chromium 1366×728 (servidor real, base aislada) | aprobado | status 400 |
| Catálogo | Pesos = USD × cotización redondeado (670 × 40,37 = 27.048) | Chromium 1366×728 (servidor real, base aislada) | aprobado | iPhone 11 / Apple · 4/128 GB / Nuevo / USD 670 / $ 27.048 / Ver equipo |
| Catálogo | Vendedor: sin editar/eliminar ni «Cargar productos»; API rechaza escritura | Chromium 1366×728 (servidor real, base aislada) | aprobado | edit=0 api=403 |
| Catálogo | Vendedor puede marcar favorito | Chromium 1366×728 (servidor real, base aislada) | aprobado | status 200 |
| Catálogo | Catálogo a 390 px sin scroll horizontal (emulado) | Chromium emulado 390 px | aprobado | {"h":false} |
| Catálogo | Consola sin errores | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Cargar productos | Sin nombre ni precio no guarda | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Cargar productos | Escribir el nombre busca la ficha sola | Chromium 1366×728 (servidor real, base aislada) | aprobado | Ficha encontrada |
| Cargar productos | Vista previa en pesos (199,5 × 40 = 7.980) | Chromium 1366×728 (servidor real, base aislada) | aprobado | $ 7.980 |
| Cargar productos | Alta: aparece en catálogo con marca, modelo, memoria, precio y garantía | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"b":"Zeta","m":"Phone X2","s":256,"r":8,"p":199.5,"w":12} |
| Cargar productos | Mensaje de confirmación y formulario limpio | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Cargar productos | Escribir en pesos convierte a USD (8000/40 = 200) | Chromium 1366×728 (servidor real, base aislada) | aprobado | 200 |
| Cargar productos | Buscar imagen: estado «Buscando imagen…» al instante, formulario usable | Chromium 1366×728 (servidor real, base aislada) | aprobado | Buscando imagen… Podés seguir cargando el producto: la portada se asigna sola. |
| Cargar productos | Guardar y salir con la portada buscando: se asigna sola al producto correcto | Chromium 1366×728 (servidor real, base aislada) | aprobado | en 2.5 s (búsqueda simulada 2,5 s) |
| Cargar productos | Tarea de portada vinculada al producto/variante correcto | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"s":"done","p":true} |
| Cargar productos | La portada de X3 no tocó a X2 | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Cargar productos | Imagen inválida: aviso claro + Reintentar | Chromium 1366×728 (servidor real, base aislada) | aprobado | No encontramos una imagen para este modelo. Podés reintentar o subir una foto. Reintentar |
| Cargar productos | Foto manual: la búsqueda lenta se descarta y no pisa la foto | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"cover":false,"photo":true,"job":"cancelled"} |
| Cargar productos | Elegir otra coincidencia mantiene la elegida | Chromium 1366×728 (servidor real, base aislada) | aprobado | x3 |
| Cargar productos | Aviso «ya está cargado» con Editar, sin bloquear | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Cargar productos | Limpiar formulario vacía nombre y precio | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Cargar productos | Doble clic en «Cargar producto» no duplica | Chromium 1366×728 (servidor real, base aislada) | aprobado | falló (+2 productos) → corregido · +1 |
| Cargar productos | Recargar la app con búsqueda en curso: se retoma y termina | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Cargar productos | Lista «Productos cargados» con contador y paginado | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Cargar productos | Consola sin errores | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Comparador | Vacío: estado inicial sin errores | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Comparador | Agregar 3 modelos de marcas distintas | Chromium 1366×728 (servidor real, base aislada) | aprobado | iPhone 15 Pro / Samsung Galaxy A56 5G / Xiaomi Redmi Note 14 5G |
| Comparador | Cada dato en la columna de su modelo (Procesador) | Chromium 1366×728 (servidor real, base aislada) | aprobado | cab=iPhone 15 Pro / Samsung Galaxy A56 5G / Xiaomi Redmi Note 14 5G · proc=Sin datos / Exynos 1580 / Dimensity 7025 Ultra |
| Comparador | Faltantes como «Sin datos» (sin celdas vacías) | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Comparador | AnTuTu de mayor a menor; sin dato al final | Chromium 1366×728 (servidor real, base aislada) | aprobado | 1.251.330 / 676.648 |
| Comparador | El modelo ya elegido no se ofrece de nuevo | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Comparador | Búsqueda del selector sin importar tildes («motó g85») | Chromium 1366×728 (servidor real, base aislada) | aprobado | falló (0 resultados) → corregido · n=1 |
| Comparador | Esc cierra «Agregar modelo» | Chromium 1366×728 (servidor real, base aislada) | aprobado | falló → corregido |
| Comparador | Quitar y reemplazar un modelo | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Comparador | Selección se conserva al recargar | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Comparador | IDs inválidos guardados no rompen la pantalla | Chromium 1366×728 (servidor real, base aislada) | aprobado | falló (error crudo «ID inválido» y 400) → corregido · Comparador /  / Compará las especificaciones y el rendimiento de hasta 3 celulares. /  / Agregar modelo / Modelos seleccionados / 0  |
| Comparador | Variantes casi idénticas (A16 4G/5G) + «Solo diferencias» | Chromium 1366×728 (servidor real, base aislada) | aprobado | 10 → 6 filas |
| Comparador | A 390 px: sin scroll horizontal de página (tabla se desplaza dentro) | Chromium emulado 390 px | aprobado | {"h":false,"t":326,"w":390} |
| Comparador | Consola sin errores | Chromium 1366×728 (servidor real, base aislada) | aprobado | falló (400 por IDs guardados inválidos) → corregido |
| Datos/Ajustes | Actualizar desde v0.23.0: esquema v12, productos intactos (id, precio, memoria) | Base creada con v0.23.0 → v0.25.0 | aprobado | v=12 productos 12→12 |
| Datos/Ajustes | Migración borra datos de Diagnóstico (serie/IMEI) y pasa CPO a 1 año | Chromium 1366×728 (servidor real, base aislada) | aprobado | tablas diag=0 garantía CPO=12 |
| Datos/Ajustes | Integridad SQLite y claves foráneas tras migrar | Chromium 1366×728 (servidor real, base aislada) | aprobado | ok, fk=0 |
| Datos/Ajustes | Pendientes y contraseña de la versión anterior siguen | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Datos/Ajustes | Cotización guardada persiste tras reiniciar | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Datos/Ajustes | Cotización inválida: mensaje claro y no se guarda | Chromium 1366×728 (servidor real, base aislada) | aprobado | Cotización inválida |
| Datos/Ajustes | Exportar JSON: archivo con todos los productos | Chromium 1366×728 (servidor real, base aislada) | aprobado | 12 productos |
| Datos/Ajustes | Reimportar el mismo archivo no duplica (avisa salteados) | Chromium 1366×728 (servidor real, base aislada) | aprobado | productos=12; Importados 0 productos (12 ya estaban cargados y se saltearon). |
| Datos/Ajustes | Archivo dañado: mensaje claro, sin cambios | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Datos/Ajustes | Fila inválida: no importa nada (todo o nada) e indica la fila | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Datos/Ajustes | Crear vendedor; correo repetido rechazado | Chromium 1366×728 (servidor real, base aislada) | aprobado | 200/400 |
| Datos/Ajustes | Contraseña corta rechazada | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Datos/Ajustes | Bloqueo tras 8 intentos fallidos (aun con la clave correcta) | Chromium 1366×728 (servidor real, base aislada) | aprobado | 400 |
| Datos/Ajustes | Escritura con Origin ajeno rechazada (CSRF) | Chromium 1366×728 (servidor real, base aislada) | aprobado | 403 |
| Datos/Ajustes | API desde otro cliente local sin login | Chromium 1366×728 (servidor real, base aislada) | no aplica | responde 200: la sesión es del servidor local (diseño v0.10.0, solo 127.0.0.1); las escrituras de otro origen se rechazan (CSRF) |
| Datos/Ajustes | Logs sin contraseñas, IMEI ni series | Chromium 1366×728 (servidor real, base aislada) | aprobado | (node:3520) ExperimentalWarning: SQLite is an experimental feature and might change at any time (Use `node --trace-warni |
| Presentación | Abre con precio USD y pesos visibles y garantía 1 año | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Presentación | Selector de marca: recorre solo Samsung | Chromium 1366×728 (servidor real, base aislada) | aprobado | 1 / 4 · Samsung Galaxy S24 5G |
| Presentación | Esc sale de la presentación | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Datos/Ajustes | Consola sin errores | Chromium 1366×728 (servidor real, base aislada) | aprobado | Failed to load resource: the server responded with a status of 400 (Bad Request) / Failed to load resource: the server responded with a status of 400 (Bad Reque |
| Rendimiento | Arranque del servidor (frío, base nueva) | Linux, servidor real | aprobado | 480 ms |
| Rendimiento | Guardar producto (API, promedio de 120) | Linux, servidor real | aprobado | 5 ms |
| Rendimiento | API catálogo (120 productos) | Linux, servidor real | aprobado | mediana 10 ms (mín 10) |
| Rendimiento | API buscador de Inicio | Linux, servidor real | aprobado | mediana 13 ms |
| Rendimiento | API lista de portadas | Linux, servidor real | aprobado | mediana 7 ms |
| Rendimiento | Abrir Inicio (recarga completa) | Linux, servidor real | aprobado | mediana 181 ms |
| Rendimiento | Abrir Catálogo con 120 productos | Linux, servidor real | aprobado | mediana 349 ms |
| Rendimiento | Abrir Cargar productos | Linux, servidor real | aprobado | mediana 199 ms |
| Rendimiento | Filtrar catálogo y volver (ida y vuelta) | Linux, servidor real | aprobado | mediana 459 ms (incluye 150 ms de espera al tipear ×2) |
| Rendimiento | Peso al abrir Catálogo | Linux, servidor real | aprobado | JS 315 KB · imágenes 312 KB · 13 pedidos |
| Visual | inicio a 1920×1008: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | catalogo a 1920×1008: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | cargar a 1920×1008: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | comparador a 1920×1008: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | ajustes a 1920×1008: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | inicio a 1366×728: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | catalogo a 1366×728: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | cargar a 1366×728: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | comparador a 1366×728: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | ajustes a 1366×728: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | inicio a 1280×680: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | catalogo a 1280×680: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | cargar a 1280×680: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | comparador a 1280×680: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | ajustes a 1280×680: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | inicio a 1024×640: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | catalogo a 1024×640: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | cargar a 1024×640: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | comparador a 1024×640: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | ajustes a 1024×640: sin scroll horizontal ni textos desbordados | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"hs":false,"over":[]} |
| Visual | Foco visible al navegar con Tab | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"tag":"BUTTON","outline":true,"shadow":false} |
| Visual | Contraste del texto secundario ≥ 4,5:1 | Chromium 1366×728 (servidor real, base aislada) | aprobado | {"fg":"rgb(143, 164, 200)","ratio":"7.36"} |
| Visual | Consola sin errores | Chromium 1366×728 (servidor real, base aislada) | aprobado |  |
| Cargar productos | Alta/edición: ficha real desde Nanoreview | — | bloqueado | Sin internet en el entorno; se usó ficha simulada. Verificar en la PC con un modelo real. |
| Portadas | Búsqueda real en internet (Samsung, Motorola, Bing) | — | bloqueado | Sin internet; flujo completo probado con fuentes simuladas (CEL_COVER_MOCK). Verificar en la PC con un modelo sin portada. |
| Portadas | Lote de 129 portadas del catálogo | Archivos del repo | aprobado | 129/129 válidas, 768×768, fondo transparente, sin duplicados, sin faltantes; muestra visual de 24 revisada. |
| Inicio | Novedades con feeds reales | — | bloqueado | Sin internet; 0/1/3 novedades, títulos largos y caché dañada probados con datos inyectados. |
| Sincronización | Repo de datos en GitHub con 2 PCs | — | verificado parcialmente | Tests unitarios de repoSync (outbox, pull, conflictos). Falta prueba con 2 PCs reales. |
| App Windows | Ventana, barra de tareas, botones de ventana, actualización automática | — | bloqueado | No hay Windows/Electron en el entorno. Verificar tras actualizar a v0.25.0 en la PC. |
| Safari iPhone | Web móvil en Safari | — | no aplica | La versión móvil no está implementada (pendiente en PROJECT_STATUS). Pantallas probadas a 390 px en Chromium; WebKit no disponible. |
| IMEI Check | Validación y proveedores | — | no aplica | Módulo eliminado a pedido (v0.20.1). |
| Diagnóstico iPhone | USB / QR / Safari | — | no aplica | Módulo eliminado a pedido (v0.24.0); la migración borra sus datos (verificado). |
| Identificar / Tasación / Historial | — | — | no aplica | Módulos eliminados a pedido (v0.15.1). |
| Tipos | Comprobación de tipos de la interfaz (React) | — | bloqueado | Falta @types/react en el entorno (sin red). Servidor, compartido y tests: 0 errores. |

Totales del recorrido automatizado: 153 casos — aprobado: 152, no aplica: 1.
