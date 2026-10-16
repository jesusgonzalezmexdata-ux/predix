// Cálculo del plan fuera del hilo de la interfaz: la pantalla no se congela con historiales grandes.
import { planRoute } from './model.js';
import { validateCatalog, validateHistory } from './data.js';

self.onmessage = ({ data }) => {
  const { historial, catalogo, opts } = data;
  try {
    const h = validateHistory(historial);
    if (h.fatal) { self.postMessage({ fatal: h.fatal, issues: h.issues ?? [] }); return; }
    let catalog = {};
    const issues = [...h.issues];
    if (catalogo) {
      const c = validateCatalog(catalogo);
      if (c.fatal) issues.push({ nivel: 'error', fila: null, mensaje: c.fatal });
      else { catalog = c.catalog; issues.push(...c.issues.map(i => ({ ...i, archivo: 'catálogo' }))); }
    }
    const products = [...new Set(h.visits.map(v => v.producto))];
    const missing = products.filter(p => !catalog[p]);
    if (missing.length) {
      issues.push({ nivel: 'aviso', fila: null, mensaje: `Sin precio y costo para ${missing.join(', ')}: se usa el nivel mínimo contra agotados.` });
    }
    const ruta = opts.ruta && h.rutas.includes(opts.ruta) ? opts.ruta : h.rutas[0];
    const fecha = opts.fecha ? new Date(`${opts.fecha}T00:00:00Z`) : null;
    const plan = planRoute(h.visits, catalog, { ruta, fecha, servicioMinimo: opts.servicioMinimo });
    self.postMessage({ plan, issues, rutas: h.rutas, visitas: h.visits.length,
                       historia: h.visits.map(({ fecha, tienda, devuelto, agotado, entregado }) => ({ fecha, tienda, devuelto, agotado, entregado })) });
  } catch (err) {
    self.postMessage({ fatal: `No se pudo calcular el pedido: ${err.message}` });
  }
};
