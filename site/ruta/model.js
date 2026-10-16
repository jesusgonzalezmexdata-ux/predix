// Modelo del pedido sugerido por ruta (sin dependencias; corre en el navegador y en Node).
//
// Cada visita a una tienda deja `entregado` piezas y retira `devuelto` piezas caducadas de la entrega anterior.
// Entre dos visitas se vendió  entregado(anterior) − devuelto(actual).  Si al llegar el producto estaba agotado,
// esa venta es solo un mínimo de la demanda (dato censurado): la demanda real pudo ser mayor.
// La demanda por intervalo se modela como binomial negativa con media λ·días; λ se estima por máxima
// verosimilitud usando P(D = y) en intervalos normales y P(D ≥ y) en los agotados.

const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log P(Y = y) de una binomial negativa con media mu y tamaño k (var = mu + mu²/k). */
export function nbLogPmf(y, mu, k) {
  mu = Math.max(mu, 1e-9);
  return lgamma(y + k) - lgamma(k) - lgamma(y + 1) + k * Math.log(k / (k + mu)) + y * Math.log(mu / (k + mu));
}

/** P(Y ≤ q) para q entero ≥ 0. */
export function nbCdf(q, mu, k) {
  if (q < 0) return 0;
  let s = 0;
  for (let y = 0; y <= q; y++) s += Math.exp(nbLogPmf(y, mu, k));
  return Math.min(s, 1);
}

/** log P(Y ≥ y): verosimilitud de un intervalo agotado. */
export function nbLogSurvival(y, mu, k) {
  if (y <= 0) return 0;
  const tail = 1 - nbCdf(Math.ceil(y) - 1, mu, k);
  return Math.log(Math.max(tail, 1e-300));
}

function logLik(rate, obs, k) {
  let ll = 0;
  for (const o of obs) {
    const mu = rate * o.d;
    ll += (o.w ?? 1) * (o.cens ? nbLogSurvival(o.y, mu, k) : nbLogPmf(o.y, mu, k));
  }
  return ll;
}

/**
 * Tasa diaria λ por máxima verosimilitud con censura.
 * `prior` = {rate, weight}: `weight` intervalos ficticios a la tasa del producto en toda la ruta, para que una
 * tienda con pocas visitas no quede con una estimación extrema.
 */
export function fitRate(obs, k, prior = null, censored = true, iterations = 80) {
  const used = obs.map(o => (censored ? o : { ...o, cens: false }));
  const pseudo = [];
  if (prior && prior.weight > 0 && prior.rate > 0) {
    const d = used.length ? used.reduce((s, o) => s + o.d, 0) / used.length : 3.5;
    for (let i = 0; i < prior.weight; i++) pseudo.push({ y: prior.rate * d, d, cens: false });
  }
  const all = used.concat(pseudo);
  if (!all.length) return prior?.rate ?? 0;
  const maxRate = Math.max(...all.map(o => (o.y + 1) / o.d)) * 6 + 1;
  let lo = Math.log(1e-3), hi = Math.log(maxRate);
  const g = (Math.sqrt(5) - 1) / 2;
  let a = hi - g * (hi - lo), b = lo + g * (hi - lo);
  let fa = logLik(Math.exp(a), all, k), fb = logLik(Math.exp(b), all, k);
  for (let i = 0; i < iterations; i++) {
    if (fa > fb) { hi = b; b = a; fb = fa; a = hi - g * (hi - lo); fa = logLik(Math.exp(a), all, k); }
    else { lo = a; a = b; fa = fb; b = lo + g * (hi - lo); fb = logLik(Math.exp(b), all, k); }
  }
  return Math.exp((lo + hi) / 2);
}

/**
 * Tamaño k de la binomial negativa de un producto, por verosimilitud perfilada con censura: para cada k de la
 * rejilla se ajusta λ de cada tienda y se suma la verosimilitud. Usar solo los intervalos no agotados
 * subestimaría la variación (son justo los de demanda baja).
 */
export const K_GRID = [1.5, 3, 5, 8, 13, 25, 60];
export function estimateDispersion(series) {
  const usable = series.filter(obs => obs.length >= 3);
  if (usable.reduce((n, obs) => n + obs.length, 0) < 15) return 25;
  let best = K_GRID[0], bestLL = -Infinity;
  for (const k of K_GRID) {
    let ll = 0;
    for (const obs of usable) ll += logLik(fitRate(obs, k, null, true, 40), obs, k);
    if (ll > bestLL) { bestLL = ll; best = k; }
  }
  return best;
}

/** Nivel de servicio óptimo (vendedor de periódicos): margen perdido contra costo de lo que regresa. */
export function serviceLevel({ precio, costo, valor_devuelto = 0 }, minimo = 0.5) {
  const under = precio - costo;
  const over = costo - valor_devuelto;
  const ratio = under > 0 && over > 0 ? under / (under + over) : minimo;
  return Math.min(Math.max(ratio, minimo), 0.98);
}

/** Menor cantidad cuya probabilidad de cubrir la demanda alcanza el nivel de servicio. */
export function orderQuantity(mu, k, sl) {
  let s = 0;
  for (let q = 0; q < 10000; q++) {
    s += Math.exp(nbLogPmf(q, mu, k));
    if (s >= sl) return q;
  }
  return Math.ceil(mu * 3);
}

/** Piezas esperadas vendidas, sobrantes (regresan) y ventas perdidas si se dejan q piezas. */
export function expectedOutcomes(mu, k, q) {
  const top = Math.ceil(mu + 12 * Math.sqrt(mu + (mu * mu) / k) + 20);
  let sold = 0, left = 0, lost = 0;
  for (let y = 0; y <= top; y++) {
    const p = Math.exp(nbLogPmf(y, mu, k));
    sold += p * Math.min(y, q);
    left += p * Math.max(q - y, 0);
    lost += p * Math.max(y - q, 0);
  }
  return { vendidas: sold, sobrantes: left, perdidas: lost };
}

const DAY = 86400000;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };

/** Intervalos entre visitas consecutivas de una tienda y producto. */
export function buildIntervals(visits) {
  const v = [...visits].sort((a, b) => a.fecha - b.fecha);
  const out = [];
  for (let i = 0; i + 1 < v.length; i++) {
    const d = Math.round((v[i + 1].fecha - v[i].fecha) / DAY);
    const y = v[i].entregado - v[i + 1].devuelto;
    if (d <= 0 || y < 0) continue;
    out.push({ y, d, cens: v[i + 1].agotado === true, fecha: v[i + 1].fecha });
  }
  return out;
}

export function pilotGroup(tienda) {
  let h = 2166136261;
  for (const ch of String(tienda)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2 === 0 ? 'sugerido' : 'control';
}

function describe(intervals, last) {
  const recent = intervals.slice(-3);
  const soldOut = recent.filter(o => o.cens).length;
  if (soldOut >= 2) return { tono: 'alerta', texto: `Se agotó en ${soldOut} de las últimas ${recent.length} visitas` };
  if (soldOut === 1) return { tono: 'alerta', texto: 'Se agotó en la visita anterior' };
  if (last && last.devuelto > 0) return { tono: 'neutro', texto: `Regresaron ${last.devuelto} caducadas la última visita` };
  return { tono: 'neutro', texto: 'Sin agotados ni devoluciones recientes' };
}

/** Vida media del peso de una visita: las de hace 8 intervalos (≈ 4 semanas con dos visitas) pesan la mitad. */
export const HALF_LIFE = 8;
const weighted = obs => obs.map((o, i) => ({ ...o, w: Math.pow(0.5, (obs.length - 1 - i) / HALF_LIFE) }));

/** Recalcula la sugerencia de un producto, opcionalmente con lo observado al llegar hoy. */
export function suggest(item, today = null) {
  let obs = item.intervalos;
  if (today && item.ultimaEntrega != null && item.diasDesdeUltima > 0) {
    const devuelto = today.agotado ? 0 : Math.min(today.devuelto ?? 0, item.ultimaEntrega);
    obs = obs.concat([{ y: item.ultimaEntrega - devuelto, d: item.diasDesdeUltima, cens: !!today.agotado }]);
  }
  const rate = fitRate(weighted(obs), item.k, item.prior);
  const mu = rate * item.diasCubrir;
  const sugerido = orderQuantity(mu, item.k, item.sl);
  return { rate, mu, sugerido };
}

/**
 * Plan de la ruta para una fecha: por tienda y producto, cantidad sugerida, regla actual y resultados esperados.
 * history: [{fecha: Date, ruta, tienda, producto, entregado, devuelto, agotado: true|false|null, orden?}]
 * catalog: {producto: {precio, costo, valor_devuelto}}
 */
export function planRoute(history, catalog, { fecha = null, ruta = null, servicioMinimo = 0.5 } = {}) {
  const rows = ruta ? history.filter(r => r.ruta === ruta) : history;
  // Calendario de la ruta: con visitas lunes y jueves los intervalos alternan 3 y 4 días; la próxima visita repite
  // el penúltimo intervalo y el pedido debe cubrir hasta la siguiente, que repite el último.
  const days = [...new Set(rows.map(r => +r.fecha))].sort((a, b) => a - b);
  const g = days.slice(1).map((d, i) => Math.round((d - days[i]) / DAY)).filter(x => x > 0);
  const nextGap = g.length >= 2 ? g[g.length - 2] : median(g.length ? g : [3]);
  const coverGap = g.length ? g[g.length - 1] : 3;
  const planDate = fecha ?? new Date(days[days.length - 1] + nextGap * DAY);
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.tienda}\u0000${r.producto}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  const products = [...new Set(rows.map(r => r.producto))];
  const kByProduct = {}, priorByProduct = {};
  for (const p of products) {
    const series = [...byKey.entries()].filter(([key]) => key.endsWith(`\u0000${p}`)).map(([, v]) => buildIntervals(v));
    kByProduct[p] = estimateDispersion(series);
    const flat = series.flat();
    priorByProduct[p] = { rate: fitRate(flat, kByProduct[p], null), weight: 2 };
  }
  const order = storeOrder(rows);
  const stores = order.map(tienda => {
    const productos = [];
    for (const p of products) {
      const visits = byKey.get(`${tienda}\u0000${p}`);
      if (!visits) continue;
      const sorted = [...visits].sort((a, b) => a.fecha - b.fecha);
      const last = sorted[sorted.length - 1];
      const cat = catalog[p] ?? {};
      const intervals = buildIntervals(sorted);
      const item = {
        producto: p, intervalos: intervals, k: kByProduct[p], prior: priorByProduct[p],
        sl: serviceLevel({ precio: cat.precio ?? 0, costo: cat.costo ?? 0, valor_devuelto: cat.valor_devuelto ?? 0 }, servicioMinimo),
        diasCubrir: coverGap, ultimaEntrega: last.entregado,
        diasDesdeUltima: Math.max(Math.round((planDate - last.fecha) / DAY), 0),
        regla: last.entregado, costo: cat.costo ?? 0, precio: cat.precio ?? 0, valorDevuelto: cat.valor_devuelto ?? 0,
        nota: describe(intervals, last), sinDatoAgotado: sorted.some(v => v.agotado === null),
      };
      Object.assign(item, suggest(item));
      item.esperado = { sugerido: expectedOutcomes(item.mu, item.k, item.sugerido), regla: expectedOutcomes(item.mu, item.k, item.regla) };
      productos.push(item);
    }
    return { tienda, grupo: pilotGroup(tienda), productos };
  });
  const carga = {};
  for (const s of stores) for (const it of s.productos) {
    const c = (carga[it.producto] ??= { producto: it.producto, sugerido: 0, regla: 0 });
    c.sugerido += it.sugerido; c.regla += it.regla;
  }
  return { fecha: planDate, ruta, servicioMinimo, stores, carga: Object.values(carga), resumen: summarize(stores) };
}

function storeOrder(rows) {
  const last = new Date(Math.max(...rows.map(r => r.fecha)));
  const seen = [];
  const pick = rs => { for (const r of [...rs].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))) if (!seen.includes(r.tienda)) seen.push(r.tienda); };
  pick(rows.filter(r => +r.fecha === +last));
  pick([...rows].sort((a, b) => b.fecha - a.fecha));
  return seen;
}

/** Resultados esperados de toda la ruta según el modelo: devoluciones y ventas perdidas, en piezas y pesos. */
export function summarize(stores) {
  const tot = { sugerido: { sobrantes: 0, perdidas: 0, costoSobrantes: 0, margenPerdido: 0, piezas: 0 },
                regla: { sobrantes: 0, perdidas: 0, costoSobrantes: 0, margenPerdido: 0, piezas: 0 } };
  for (const s of stores) for (const it of s.productos) for (const pol of ['sugerido', 'regla']) {
    const e = it.esperado[pol];
    const t = tot[pol];
    t.piezas += it[pol];
    t.sobrantes += e.sobrantes; t.perdidas += e.perdidas;
    t.costoSobrantes += e.sobrantes * (it.costo - it.valorDevuelto);
    t.margenPerdido += e.perdidas * (it.precio - it.costo);
  }
  return tot;
}
