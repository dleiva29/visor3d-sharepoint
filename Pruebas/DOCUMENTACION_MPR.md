# Visor MPR: documentación técnica y revisión de mantenimiento

**Fecha:** 8 de noviembre de 2026. **Base revisada:** `mpr.html`, versión guardada 258. Esta entrega mantiene el visor como un único HTML y conserva Three.js 0.180.0, sus iconos y sus formatos de archivo.

## Resultado y alcance

Se ha revisado estáticamente el HTML, la cascada CSS y el módulo JavaScript completo, y se han aplicado correcciones concretas de carga, validación, gestión de recursos y selección. El archivo tiene ahora formato uniforme y 22 bloques funcionales identificados. Se han añadido comentarios sobre coordenadas, propiedad de recursos y contratos de datos. Se han eliminado variables y una construcción de interfaz que no se utilizaban.

La revisión automática del módulo no encuentra errores con las reglas configuradas de ESLint ni variables declaradas sin uso. Las 24 pruebas específicas pasan. Esto no equivale a una certificación de ausencia de errores: no se ha podido ejecutar una prueba visual integral del visor en Chromium/WebGL en este entorno. La carga interactiva de casos reales, el rendimiento y la apariencia en móvil requieren las comprobaciones del apartado final.

## Cambios aplicados

| Área | Problema verificado | Corrección |
|---|---|---|
| Descarga automática | La alternativa de NRRD sin fragmentos iniciaba un `fetch` y luego otra descarga del mismo recurso. | Se conserva una única descarga con progreso y validación HTTP. |
| Sustitución del volumen | Se borraban trayectoria, referencias y mediciones antes de analizar el nuevo NRRD. Un fallo de análisis dejaba parte del estado anterior borrado. | Se analizan geometría, datos y ventana antes de modificar el estado. La protección cubre errores de análisis; no constituye una transacción completa ante fallos posteriores de GPU o creación de cortes. |
| Geometría NRRD | Faltaban comprobaciones explícitas de dimensión, tamaños, número de vectores y coordenadas no finitas. | Se exige dimensión 3, tres tamaños enteros positivos, origen de tres componentes finitas y tres vectores válidos. Se conserva la restricción de ejes ortogonales alineados. |
| Datos NRRD | No se comprobaba la longitud del array devuelto por el lector frente a los tamaños declarados. | Se rechaza un volumen cuyo número de vóxeles no coincida con la cabecera. |
| Volumen de un corte | Los selectores forzaban un mínimo de dos posiciones incluso en un eje de tamaño 1. | El máximo del selector es 0 cuando sólo hay un corte. |
| Recursos Three.js | `clearRoot` sólo liberaba geometrías de hijos directos; los GLB suelen contener grupos anidados. | Se recorren descendientes y se liberan geometrías, materiales y texturas una sola vez por recurso compartido. |
| Flechas de los deslizadores | La instalación no era idempotente. Sólo algunos controles sincronizaban posteriores cambios de `disabled`. | No se duplican envoltorios; todas las parejas de flechas siguen el estado de su selector. |
| Configuraciones JSON | Un objeto nulo provocaba un error genérico. Se aceptaban capas duplicadas/incompletas, índices fraccionarios o identificadores de ventana desconocidos. | Se rechazan con mensajes controlados antes de restaurar. |
| Vistas guardadas | Las lecturas locales, importaciones y descargas publicadas tenían validaciones diferentes; una entrada local nula podía interrumpir la recuperación. | `validateSavedView` centraliza la validación. La lectura local omite entradas inválidas y conserva las válidas. |
| Deshacer eliminación | Podía recuperar la vista número 101 después de volver a llenar una lista de 100. | Se respeta el límite y se informa de que hay que liberar una posición. |
| Selección de ramas | Una rama quedaba parcialmente seleccionada aunque todas sus estructuras visibles estuvieran seleccionadas, si había otras ocultas. | El estado de selección se calcula sobre los descendientes visibles. La casilla de visibilidad sigue considerando toda la rama. |
| Árbol v1 | La migración modificaba variables globales antes de completar la validación y podía expandir demasiadas referencias. | Migración iterativa con límite de 10.000 nodos y validación previa a la confirmación. Se rechazan identificadores vacíos. |
| Copia de configuración | `configData().views` compartía el objeto mutable de zoom y desplazamiento. | La captura incluye una copia independiente de `viewStates`. |

Las comprobaciones más estrictas pueden rechazar JSON manipulados o incompletos que antes se aceptaban parcialmente. No se ha cambiado la versión de los formatos ni se ha migrado o sobrescrito automáticamente ningún archivo externo de vistas o estructuras.

## Organización del archivo

Los comentarios `01` a `22` permiten localizar rápidamente cada bloque. Se ha mantenido el orden de inicialización porque muchos manejadores comparten estado y referencias DOM.

| Bloques | Responsabilidad | Puntos de entrada relevantes |
|---|---|---|
| 01–02 | Dependencias, controles y archivos locales | `addRangeStepper`, `bindLocalFile`, `downloadWithProgress` |
| 03–04 | Escena, recursos, volumen y orientación | `clearRoot`, `parseNrrdGeometry`, `resampleVolume`, `paint` |
| 05–07 | Referencias US, contornos y materiales | `drawUsTargetOnSlice`, `meshPlaneSegments`, `buildModelLayers` |
| 08–09 | Navegación y trayectoria | `setTool`, `togglePane`, `trajectoryAngle`, `renderTrajectory` |
| 10–11 | Configuraciones y vistas guardadas | `configData`, `validateConfig`, `restoreConfig`, `validateSavedView`, `openNamedView` |
| 12–13 | Estructuras, anotaciones y volúmenes | `updateStructureSelection`, `renderAnnotations`, `geometryVolume` |
| 14–17 | Carga publicada, edición y árbol | `loadNrrdParts`, `autoLoadCase`, `endMeasurementDrag`, `applyHierarchy`, `applyNodes` |
| 18–20 | Menús, historial y presentación | `installPaneMenus`, `installCaseHistory`, `captureSavedView`, `installCasePresentation` |
| 21–22 | Modo US | `usCutFrame`, `createUsModel`, `installUsMode` |

### Estado compartido

- `volume` y `volumeInfo`: datos del lector NRRD y geometría física del estudio.
- `model`, `modelRoot` y `layerControls`: escena GLB, agrupación y controles por estructura.
- `slices`: cortes Three.js de los ejes `x`, `y`, `z`.
- `viewStates`: zoom y desplazamiento visual de cada ventana 2D; no alteran coordenadas físicas.
- `selectedWorldPoint`: cruce de referencia en RAS.
- `trajectory`: extremos `a` = entrada y `b` = destino. **La creación pide primero el destino**, aunque se almacene como `b`.
- `usTargetPoint` / `usTargetPath`: objetivo US y, cuando procede, su posición relativa sobre la trayectoria.
- `namedViews`, `namedCaseKey`, `activeNamedView`: lista del caso, identidad de almacenamiento y selección actual.
- `structureNodes`: árbol actual de referencias; una misma segmentación puede aparecer en varios nodos.
- `batchRestore`: inhibe repintados y efectos secundarios durante la restauración agrupada.

## Coordenadas y geometría

La geometría física interna se expresa en **RAS y milímetros**: X positivo a derecha, Y positivo a anterior y Z positivo a superior. `parseNrrdGeometry` convierte LPS invirtiendo X e Y. El GLB se escala con el factor `unit`, actualmente 1000, y el selector oculto `space` está configurado en RAS.

El código admite cabeceras NRRD con direcciones diagonales alineadas con los ejes. Un NRRD oblicuo o con permutación de ejes que no cumpla esa condición se rechaza. No se ha añadido soporte DICOM/DICOMDIR ni remuestreo de entrada para orientaciones arbitrarias.

`VolumeSlice` centra sus planos; `planesRoot.position` añade el centro físico. El GLB conserva sus coordenadas absolutas. Aplicar de nuevo ese desplazamiento al GLB desalinearía la superposición.

La presentación 2D incluye inversiones y transposición por plano. Para convertir puntos se deben usar `slicePixelBasis`, `worldToPixel` y `pixelToWorld`; no se debe deducir la posición sólo a partir del índice del selector. `resampleVolume` hace interpolación trilineal del volumen para los cortes oblicuos, US y la reconstrucción longitudinal.

### Trayectorias

La distancia es euclídea en milímetros. `trajectoryAngle` calcula el ángulo respecto al plano, entre 0° y 90°. Los arcos dibujados sobre axial/sagital/coronal describen componentes proyectadas; no deben confundirse con los ángulos espaciales del panel.

Un extremo entre cortes puede mostrarse como círculo hueco sobre el corte más cercano. Durante la edición se conserva su separación respecto al plano para evitar un salto artificial al arrastrarlo. La reconstrucción longitudinal usa la entrada y el destino como eje vertical.

### Modo US

`usCutFrame` construye los ejes del plano a partir de entrada, enfoque, giro e inclinación. La sesión US se mantiene dentro de `installUsMode` y crea una copia del modelo con materiales propios para el recorte.

Cuando `session.axisEnd` existe, el modo está vinculado a una trayectoria: se bloquean cambiar entrada, cambiar enfoque, desplazamiento de enfoque e inclinación. Se permite el giro alrededor del eje. Las posiciones guardadas incorporan `usProbe` en la configuración.

Los rótulos superior/inferior de puntos proyectados se basan en la normal orientada hacia superior. En planos casi verticales esa interpretación puede resultar poco intuitiva; conviene comprobarla con casos sintéticos antes de cambiar la geometría o los rótulos.

## Contratos de archivos y persistencia

| Archivo | Identificación | Contenido / control de compatibilidad |
|---|---|---|
| Configuración de una vista | `format: mpr-viewer`, `version: 1` | Cámara, cortes, zoom, flags, capas, ventana, referencias, medidas, anotaciones y opcionales de trayectoria/US. `caseSignature` identifica tamaños, origen y estructuras. |
| Lista de vistas | `format: mpr-named-views`, `version: 1` | `caseKey` y array `views`; máximo 100 vistas, nombre de hasta 100 caracteres, notas de hasta 3000. |
| Caso completo | `format: mpr-complete-case`, `version: 1` | Estado general, vistas, vista activa y selección; requiere la misma clave del caso. |
| Árbol | `format: mpr-structure-tree`, versiones 1 o 2 | `modelHash`; formato actual `nodes`, con compatibilidad para `groups` y `relations` anteriores. |
| Volumen fragmentado | `format: nrrd-parts-v1` | `totalBytes` y lista de nombres de fragmento; se reconstruye el archivo original antes de interpretarlo. |

`currentViewCase` combina los SHA-256 del volumen y del modelo. Las vistas usan la clave `mpr-named-views-v1:<hashNRRD>:<hashGLB>` y el árbol `mpr-tree-v1:<hashGLB>`. La configuración exportada no incluye los archivos NRRD/GLB.

La persistencia local depende de `localStorage`. Si el navegador la rechaza, la lista permanece en memoria y la interfaz recomienda exportar una copia. Las vistas publicadas se incorporan respetando nombres locales ya existentes; su recuperación no implica escribirlas inmediatamente en el almacenamiento local.

### Rutas automáticas actuales

Con `?modelo=modelos/1.glb` se utilizan:

- Modelo: la ruta recibida, restringida al mismo origen y directorio raíz permitido.
- Volumen: `nrrd/1.nrrd.parts.json`; si el manifiesto devuelve 404, `nrrd/1.nrrd`.
- Estructuras: `organización_estructuras/1_estructura.json`.
- Vistas: `vistas/mpr/1_vista.json`.
- Ayuda: `manual/index.html`.

Los sufijos `_estructura` y `_vista` son los del código actual. La consulta del manifiesto utiliza HEAD; un servidor que no admita HEAD puede impedir esa detección. Las descargas usan `credentials: omit`; no constituyen una integración autenticada con OneDrive/SharePoint.

## Propiedad y liberación de recursos

`clearRoot` debe utilizarse sobre grupos que poseen los recursos que se descartan. Recorre todos sus descendientes y reúne geometrías, materiales y texturas en conjuntos para evitar dobles liberaciones dentro de ese grupo.

La copia temporal US comparte geometrías y texturas con el modelo principal. `releaseSection` libera sus materiales clonados, cancela las animaciones pendientes y retira las interacciones temporales. **No sustituir esa liberación por `clearRoot` sobre la copia US**, porque liberaría recursos compartidos con el visor principal.

Se conserva un único renderizador WebGL. El modo US cambia temporalmente tamaño, cámara y escena para dibujar sus paneles y restaura el renderizador en `finally`.

## Convenciones de mantenimiento

1. Formato uniforme de HTML, CSS y JavaScript, ancho de referencia 100 caracteres y separación de funciones y bloques. Los nombres existentes se conservan para facilitar la comparación con versiones anteriores.
2. Validar datos externos antes de modificar estado. Reutilizar `validateConfig`, `validateSavedView`, `validateNodes` y validadores de formatos anteriores.
3. Usar `textContent` para nombres y anotaciones del usuario. Reservar `innerHTML` para plantillas controladas y SVG internos.
4. Disparar los eventos `input`/`change` cuando un control se modifica programáticamente y deba activar su lógica. No confundir valor de un control con estado aplicado a la escena.
5. Mantener el orden de la cascada CSS. Hay reglas históricas que se sobrescriben y media queries posteriores; borrarlas por parecer duplicadas puede alterar el diseño.
6. Al cambiar la geometría, probar tanto RAS como LPS, espaciado anisótropo, casos con un solo corte y trayectorias paralelas a los tres ejes.
7. No reordenar inicializadores sin revisar sus dependencias. Las funciones están agrupadas mediante comentarios, pero el módulo sigue compartiendo estado global.

No se han separado CSS/JavaScript en archivos externos: así puede seguir sustituyéndose únicamente `mpr.html`. La extracción futura a módulos debería hacerse por etapas con una prueba visual automatizada que cubra cada herramienta.

## Verificación realizada

- Análisis sintáctico del módulo con Node y Espree.
- ESLint: ausencia de referencias no declaradas, código inalcanzable, argumentos/claves duplicados, reasignación de funciones, encadenamientos opcionales inseguros, usos inválidos de `typeof` y variables declaradas sin uso, según las reglas configuradas.
- **24 pruebas específicas, todas correctas** sobre la entrega final: geometría RAS/LPS, cabeceras inválidas, conservación del estado ante un fallo de análisis, liberación de recursos anidados/compartidos, selección de ramas, flechas e inhabilitación, configuración/vistas, migración de árboles, marco US, ángulos y selector de un solo corte.
- Comparación de las mismas pruebas con la base: 19 comprobaciones no se cumplían en la versión original. Algunas prueban nuevos contratos de validación; no representan 19 fallos independientes de uso normal.
- Verificación del árbol sintáctico normalizado antes y después del formateo: sin diferencias funcionales; se normaliza la asociación equivalente de operadores lógicos.
- Estructura y atributos del cuerpo HTML, identificadores, importmap y geometría de los SVG conservados.
- Cascada CSS equivalente, conservando el orden de reglas y declaraciones; sólo cambia su formato.

### Repetir las pruebas

Coloca `mpr.html`, `pruebas_mpr.cjs` y `package.json` en una carpeta de trabajo. Con Node 24 o posterior:

```bash
npm install
npm test
```

Para comparar también un original:

```bash
node pruebas_mpr.cjs mpr.html mpr_original.html
```

El script extrae funciones del HTML y las prueba con Three.js 0.180.0 y un DOM de pruebas para los controles. También ejecuta ESLint y escribe `resultado_pruebas.json`. No ejecuta toda la aplicación en un navegador ni comprueba la GPU. Las dependencias de `package.json` son sólo para desarrollo y pruebas: no hay que subirlas para usar el HTML en GitHub Pages.

## Comprobaciones pendientes antes de sustituir la versión publicada

1. Abrir un caso habitual NRRD + GLB y comprobar la superposición en axial, coronal y sagital.
2. Cargar un NRRD inválido y confirmar que las mediciones, trayectoria y referencia del caso anterior siguen disponibles.
3. Sustituir varias veces volumen y modelo; observar memoria y consola del navegador.
4. Recuperar vistas antiguas, importar/exportar un caso y probar deshacer/rehacer. Comprobar nombre, notas, cámara, cortes y ventana maximizada.
5. Editar una trayectoria en los tres cortes y en la reconstrucción longitudinal. Probar los saltos a ambos extremos.
6. Abrir US libre y desde trayectoria; probar enfoque, giro, controles bloqueados, miniaturas maximizadas y recuperación de posiciones.
7. Editar un árbol con referencias compartidas y estructuras ocultas; probar selección, visibilidad y exportación.
8. Presentar un caso y exportar el informe; comprobar escritorio, móvil vertical y móvil horizontal.

Chromium no pudo iniciarse en este entorno; por ello estas comprobaciones no se dan por realizadas. Se entrega el HTML corregido para revisión, sin desplegarlo en GitHub.

## Incongruencias y riesgos que quedan documentados

- La cascada contiene sucesivas capas de rediseño y controles heredados ocultos. Se ha preservado su semántica para evitar cambios visuales no comprobados.
- El módulo comparte mucho estado. Separar carga, geometría, persistencia e interfaz facilitaría el mantenimiento, pero requiere pruebas integrales adicionales.
- El remuestreo, la intersección de mallas y el cálculo de volúmenes se ejecutan en el hilo principal. Modelos grandes pueden bloquear temporalmente la interacción; un traslado a workers sería un proyecto de rendimiento separado.
- Las cargas de volumen y modelo tienen bloqueos por selector, no un coordinador global de tareas con cancelación. Deben probarse los cambios de caso durante descargas lentas antes de ampliar la carga online.
- El historial captura configuraciones completas con frecuencia. Puede resultar costoso con numerosas vistas y estructuras.
- La geometría de los volúmenes cerrados se comprueba, pero no se ha validado aquí la exactitud clínica de medidas, orientación o simulación US. Las limitaciones ya presentes en el visor siguen vigentes.
