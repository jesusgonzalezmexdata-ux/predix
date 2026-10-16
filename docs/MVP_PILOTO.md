# MVP «Pedido sugerido por ruta»: protocolo de piloto

**Para quién:** supervisor y repartidores de una ruta de preventa o reparto de perecederos (pan, bolillo, leche fresca, pan dulce, tortillas) con 20 a 40 tiendas, o un mayorista que surte tienditas.
**Qué decide:** cuántas piezas dejar de cada producto en cada tienda en la próxima visita.
**Dónde se usa:** https://jesusgonzalezmexdata-ux.github.io/predix/ruta/. En la computadora para preparar la carga; en el celular, tienda por tienda.

## 1. Datos

| Archivo | Columnas | Notas |
|---|---|---|
| Historial de visitas (CSV) | fecha, tienda, producto, entregado, devuelto, agotado; opcionales: ruta, orden | Una fila por producto en cada visita. `devuelto` = caducadas que se recogieron en esa visita. `agotado` = sí/no, si el producto estaba agotado al llegar |
| Precios (CSV, opcional) | producto, precio, costo, valor_devuelto | `valor_devuelto` = lo que se recupera de una pieza caducada (pan molido, crédito del proveedor) |

Acepta separador de coma o punto y coma, encabezados con acentos o sinónimos (cliente, artículo, dejado, merma) y fechas dd/mm/aaaa o aaaa-mm-dd. Las filas con error se excluyen y se listan con su número de fila.

**El dato que hace funcionar el modelo es la marca de agotado.** Sin ella, un día agotado se lee como si la tienda solo hubiera querido eso y el pedido se queda corto. Si el historial no la tiene, la aplicación lo avisa; desde la primera semana del piloto se captura con un toque en el celular.

## 2. Cómo decide

1. **Venta entre visitas** = piezas dejadas − caducadas recogidas en la visita siguiente. Supone que lo no vendido se retira al caducar (perecederos de rotación corta).
2. **Agotado = dato censurado:** si al llegar estaba agotado, la demanda fue *al menos* lo que se dejó. El modelo usa P(D ≥ venta) para esos intervalos.
3. **Demanda por tienda y producto:** binomial negativa con media proporcional a los días del intervalo; las visitas de hace 4 semanas pesan la mitad que la última; la variación por producto se estima con todas las tiendas.
4. **Pedido:** la menor cantidad que alcanza hasta la visita siguiente con la probabilidad elegida («Evitar agotados», 70 % por omisión), o la razón crítica margen contra costo de devolución si es mayor.
5. **En la tienda:** marcar «agotado al llegar» o contar las caducadas recalcula la sugerencia en ese momento con lo observado.

## 3. Fases

| Fase | Duración | Actividad | Entregable |
|---|---|---|---|
| 0 · Acuerdo | 1 semana | Exportación de 8–12 semanas de visitas de una ruta; precios y costos por producto | Historial en la plantilla |
| 1 · Retrospectiva | 1 semana | Revisión de errores de datos; hoja de carga sugerida contra la regla actual | Reporte con devoluciones y ventas perdidas esperadas |
| 2 · Captura | 2 semanas | El repartidor usa la app solo para marcar agotados y caducadas; sigue dejando lo de siempre | Historial con marca de agotado |
| 3 · Piloto A/B | 8 semanas | Se activa «Piloto con grupo de control»: la mitad de las tiendas, al azar, recibe el pedido sugerido | Comparación por grupo en el cierre |
| 4 · Cierre | 1 semana | Devoluciones, agotados y venta por grupo; decisión de extender | Caso de estudio con autorización |

Cada día de ruta: preparar la carga con el historial actualizado → registrar tienda por tienda → descargar «visitas de hoy» y agregarlas al historial.

## 4. Criterios definidos antes de empezar

**Éxito:**
- menos caducadas por visita en el grupo sugerido que en el de control,
- sin más agotados al llegar, y
- sin caída de la venta (piezas vendidas por tienda).

**Abandono:**
- el repartidor no marca agotado en más del 80 % de las visitas durante la fase 2;
- el historial no permite calcular la venta (no se registran las caducadas recogidas);
- tras 8 semanas, la diferencia entre grupos no es distinta de cero.

## 5. Privacidad y operación

- Todo se calcula en el navegador. Los archivos no se envían a ningún servidor; lo registrado se guarda en el teléfono hasta descargarlo.
- Funciona sin señal después de abrirla una vez con conexión.
- Basta con nombres comerciales de tienda; no se piden datos personales.

## 6. Límites

- **Sustitución:** si el cliente compra otro producto cuando uno se agota, la venta perdida real es menor que la estimada.
- **Productos de vida larga:** si lo no vendido se queda en anaquel, la venta entre visitas debe calcularse con un conteo de existencias, no solo con las caducadas.
- **Resultados esperados:** las cifras de la hoja de carga son del modelo; las confirma el piloto con grupo de control.
