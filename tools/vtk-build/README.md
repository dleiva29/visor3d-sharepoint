# Lector VTM/VTP del conversor

El conversor carga `../vtm-loader.js` y `../vendor/vtk-reader.js` únicamente al
convertir VTM/VTP. Los datos se procesan en el navegador; no se suben ni se
resuelven referencias VTM por red. Three.js sigue usando el CDN del conversor.

El bundle incorpora el lector XML PolyData de vtk.js 38.0.7 y fflate 0.8.3.
`package-lock.json` fija también sus dependencias y la herramienta de compilación.
Para regenerarlo (Node 24):

```sh
cd tools/vtk-build
npm ci
node build.cjs
```

Se genera `../vendor/vtk-reader.js` y el inventario de licencias
`../vendor/THIRD-PARTY-NOTICES.txt`. No editar el bundle directamente.

## Uso

En `tools/convertir_glb.html`, elegir **VTM / VTP**. Seleccionar un ZIP con sus
rutas originales, una carpeta raíz, o combinar un VTM suelto con su carpeta.
Los dos campos se combinan. «Limpiar selección» vacía ambos.

Se recorren todos los VTM raíz y sus bloques anidados. Los VTP no referenciados
se omiten con aviso; sin VTM se convierten todos los VTP elegidos. Una ruta que
falta, es ambigua o forma un ciclo impide la descarga de un modelo incompleto.
Seleccionar archivos sueltos pierde las rutas: se permite resolver por nombre
solo cuando es único. Es preferible una carpeta o ZIP si se repiten nombres.

Se admiten PolyData ASCII, binary y appended (raw/base64), LittleEndian y zlib.
Se triangulan polígonos y triangle strips; líneas y puntos no son superficies.
Se conservan grupos y nombres del VTM, coordenadas y escala según los selectores.
Cada pieza se exporta como una malla con nombre único. Se recalculan las normales.
Antes de descargar, el paso común de revisión permite editar el nombre y el color
de cada estructura. El nombre inicial procede del archivo VTP (con sufijo si
tiene varias piezas); el nombre original del VTM se muestra como referencia.
Se proponen colores provisionales: atributos científicos, materiales, colores y
texturas VTP no se exportan. BigEndian, LZ4/LZMA y datasets volumétricos no están
admitidos. El límite de entrada/ZIP extraído es 200 MB; la conversión requiere
memoria adicional para descomprimir VTP y generar el GLB.

Pruebas: `cd Pruebas && npm install && npm test` desde la raíz del repositorio.
Las pruebas usan superficies sintéticas; verificar también una exportación real
antes de publicar la funcionalidad.

## Coordenadas y unidades

El conversor inspecciona declaraciones explícitas, sin inferir a partir de la
geometría, nombre de archivo o programa de origen. Reconoce atributos XML de
VTKFile/PolyData/vtkMultiBlockDataSet y FieldData de cadenas ASCII con claves
CoordinateSystem, CoordinateSpace o Space; Units, LengthUnit(s) o SpatialUnits.
También reconoce comentarios OBJ explícitos como `# coordinate_system: RAS` y
`# units: mm`. Estas convenciones no son obligatorias ni universales en VTK/OBJ.
Los STL se consideran sin metadatos. Las cadenas binarias de FieldData no se
interpretan para esta detección. Se muestra el resultado por archivo.

Solo se aplican automáticamente valores reconocidos cuando todos los archivos
los declaran. Si faltan en alguno, se exige elegir LPS/RAS y mm/cm/m y confirmar
que la selección es común a todos. Las declaraciones incompatibles o no admitidas
bloquean la conversión conjunta. Una modificación manual de valores detectados
requiere confirmación. El destino predeterminado es RAS para MPR y el GLB siempre
usa metros; esta detección no comprueba alineación anatómica con un NRRD.
