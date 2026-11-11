# Distancia mínima entre superficies

`minimum-distance-worker.js` ejecuta el cálculo fuera del hilo de interfaz.
`structure-surface.js` obtiene todos los triángulos de las mallas de cada estructura
 en coordenadas mundiales (mm), aplicando matrices completas, índices y jerarquía.
No usa visibilidad ni clipping visual. Rechaza deformaciones skinned/morph,
coordenadas no finitas y estructuras sin triángulos no degenerados. Límite:
un millón de triángulos por estructura. La preparación cede periódicamente el
control y comprueba cancelación; Cancelar/Esc termina el worker.

El motor usa BVH por ambas superficies y distancia triángulo-triángulo, sin
muestreo ni decimación. Las posiciones de entrada son Float64. Las matrices de
comparación son identidad porque las transformaciones se aplican antes. Se
corrige el punto devuelto por la biblioteca para contactos coplanares mediante
recorte de polígonos en el plano dominante. Se verifica que el punto pertenezca
a ambos triángulos. Una estructura contenida en otra sin contacto tiene distancia
positiva entre superficies: no se calcula intersección entre volúmenes sólidos.

## Dependencias y regeneración

Bundle ESM local de `three@0.180.0` y `three-mesh-bvh@0.9.18`, ambos MIT;
licencias en `../vendor/`. `package-lock.json` fija todas las versiones.

```sh
cd tools/distance-build
npm ci
node build.cjs
```

Se genera `../vendor/distance-bvh.js`. No hace falta instalar paquetes para usar
el visor. Deben desplegarse `mpr.html` y sus módulos `tools/` juntos.

## Estado y persistencia

La vista previa es transitoria. Guardar crea una medida 3D ordinaria con nombre,
puntos y `precision: 3`, compatible con edición, visibilidad, vistas guardadas,
configuración y caso portátil. No se recalcula automáticamente una medida
 guardada. Cambiar la pareja, modelo o unidades invalida el cálculo y la vista
previa. Las medidas anteriores mantienen sus coordenadas y formato de un decimal.

Pruebas: `cd Pruebas && npm install && npm test`. Fixtures analíticas cubren
cara-interior, aristas, contacto, cruce, coplanaridad, contención, escala y
transformaciones. Chromium prueba el worker real, cancelación, invalidación y
persistencia mediante caso portátil. Falta validación visual por el usuario.
