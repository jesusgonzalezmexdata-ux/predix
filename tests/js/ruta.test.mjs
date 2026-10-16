// Pruebas del pedido sugerido por ruta (node --test tests/js).
import assert from 'node:assert/strict';
import test from 'node:test';
import * as D from '../../site/ruta/data.js';
import * as M from '../../site/ruta/model.js';

const ex = D.exampleData();
const csv = D.exampleCSV();
const hist = D.validateHistory(csv.historial);
const cat = D.validateCatalog(csv.catalogo);
const plan = M.planRoute(hist.visits, cat.catalog, { servicioMinimo: 0.7 });

test('binomial negativa: probabilidades suman 1 y la cola coincide', () => {
  let s = 0;
  for (let y = 0; y < 400; y++) s += Math.exp(M.nbLogPmf(y, 12, 4));
  assert.ok(Math.abs(s - 1) < 1e-9);
  assert.ok(Math.abs(Math.exp(M.nbLogSurvival(10, 12, 4)) - (1 - M.nbCdf(9, 12, 4))) < 1e-12);
  assert.ok(Math.abs(M.lgamma(10) - Math.log(362880)) < 1e-9);
});

test('la censura corrige el sesgo de tratar la venta como demanda', () => {
  const byKey = new Map();
  for (const r of hist.visits) { const k = `${r.tienda}|${r.producto}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
  let naive = 0, cens = 0, n = 0, under = 0;
  for (const [k, list] of byKey) {
    const iv = M.buildIntervals(list), t = ex.truth[k];
    const rc = M.fitRate(iv, 6), rn = M.fitRate(iv, 6, null, false);
    naive += Math.abs(rn / t - 1); cens += Math.abs(rc / t - 1); under += rn < t ? 1 : 0; n++;
  }
  assert.ok(cens / n < 0.12, `error con censura ${cens / n}`);
  assert.ok(naive / n > 1.5 * (cens / n), 'sin censura el error debe ser claramente mayor');
  assert.ok(under / n > 0.8, 'sin censura la demanda se subestima casi siempre');
});

test('la dispersión estimada con censura queda cerca de la simulada (5 a 8)', () => {
  const ks = new Set(plan.stores.flatMap(s => s.productos.map(it => it.k)));
  for (const k of ks) assert.ok(k >= 3 && k <= 13, `k = ${k}`);
});

test('el plan sigue el calendario lunes/jueves y cubre hasta la siguiente visita', () => {
  assert.equal(plan.fecha.toISOString().slice(0, 10), '2026-10-12');
  assert.equal(plan.stores.length, 23);
  const it = plan.stores[0].productos[0];
  assert.equal(it.diasCubrir, 3);
  assert.equal(it.diasDesdeUltima, 4);
});

test('con el mismo nivel de agotados, el pedido sugerido devuelve menos', () => {
  const r = plan.resumen;
  assert.ok(r.sugerido.sobrantes < 0.85 * r.regla.sobrantes);
  assert.ok(r.sugerido.perdidas < 1.1 * r.regla.perdidas);
  const cost = x => x.costoSobrantes + x.margenPerdido;
  assert.ok(cost(r.sugerido) < cost(r.regla));
});

test('subir el nivel contra agotados reduce las ventas perdidas esperadas', () => {
  const lo = M.planRoute(hist.visits, cat.catalog, { servicioMinimo: 0.5 }).resumen.sugerido;
  const hi = M.planRoute(hist.visits, cat.catalog, { servicioMinimo: 0.9 }).resumen.sugerido;
  assert.ok(hi.perdidas < lo.perdidas && hi.sobrantes > lo.sobrantes);
});

test('marcar agotado hoy nunca baja la sugerencia; recoger caducadas nunca la sube', () => {
  for (const s of plan.stores) for (const it of s.productos) {
    const agot = M.suggest(it, { agotado: true }).sugerido;
    const dev = M.suggest(it, { agotado: false, devuelto: it.ultimaEntrega }).sugerido;
    const none = M.suggest(it, { agotado: false, devuelto: 0 }).sugerido;
    assert.ok(agot >= none, `${s.tienda} ${it.producto}`);
    assert.ok(dev <= none, `${s.tienda} ${it.producto}`);
  }
});

test('nivel de servicio: razón crítica con mínimo y tope', () => {
  assert.equal(M.serviceLevel({ precio: 10, costo: 5, valor_devuelto: 0 }, 0.3), 0.5);
  assert.equal(M.serviceLevel({ precio: 10, costo: 9, valor_devuelto: 0 }, 0.7), 0.7);
  assert.equal(M.serviceLevel({ precio: 100, costo: 1, valor_devuelto: 0 }, 0.5), 0.98);
  assert.equal(M.serviceLevel({ precio: 0, costo: 0 }, 0.75), 0.75);
});

test('el CSV sucio se reporta por fila y con alias de columnas', () => {
  const text = [
    'Fecha;Cliente;Artículo;Dejado;Merma;Agotado al llegar',
    '20/07/2026;Tienda A;Pan;10;0;no',
    '31/02/2026;Tienda A;Pan;10;0;no',
    '23/07/2026;Tienda A;Pan;-3;2;sí',
    '23/07/2026;Tienda A;Pan;8;2;quizá',
    '27/07/2026;Tienda A;Pan;9;"1";SI',
    '27/07/2026;Tienda A;Pan;9;1;si',
  ].join('\n');
  const r = D.validateHistory(text);
  const errs = Object.fromEntries(r.issues.filter(i => i.nivel === 'error').map(i => [i.fila, i.mensaje]));
  assert.deepEqual(Object.keys(errs).map(Number), [3, 4, 5]);
  assert.match(errs[3], /fecha no reconocida/);
  assert.match(errs[4], /entregado/);
  assert.match(errs[5], /agotado/);
  assert.ok(r.issues.some(i => i.fila === 7 && /repetida/.test(i.mensaje)));
  assert.equal(r.visits.length, 2);
  assert.equal(r.visits[1].agotado, true);
});

test('faltan columnas obligatorias: mensaje claro', () => {
  assert.match(D.validateHistory('fecha,tienda,producto\n01/01/2026,A,B').fatal, /entregado, devuelto/);
  assert.match(D.validateCatalog('producto,precio\nA,1').fatal, /costo/);
});

test('sin columna de agotado avisa que la demanda puede estar subestimada', () => {
  const r = D.validateHistory('fecha,tienda,producto,entregado,devuelto\n01/07/2026,A,B,5,0\n04/07/2026,A,B,5,1');
  assert.ok(r.issues.some(i => /sin la marca de agotado/.test(i.mensaje)));
});

test('grupo del piloto: estable y balanceado', () => {
  const stores = [...new Set(hist.visits.map(v => v.tienda))];
  const control = stores.filter(s => M.pilotGroup(s) === 'control').length;
  assert.ok(control >= 7 && control <= 16);
  assert.equal(M.pilotGroup('Abarrotes Doña Lupe'), M.pilotGroup('Abarrotes Doña Lupe'));
});

test('CSV: comillas, separador y redondeo de ida y vuelta', () => {
  const out = D.toCSV([{ a: 'x, "y"', b: 3 }], ['a', 'b']);
  const back = D.parseCSV(out);
  assert.equal(back.records[0].a, 'x, "y"');
  assert.equal(D.validateHistory(csv.historial).visits.length, ex.visits.length);
});
