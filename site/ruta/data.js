// Lectura y validación de los CSV de la ruta, y datos de ejemplo simulados.

export const HISTORY_COLUMNS = ['fecha', 'ruta', 'tienda', 'producto', 'entregado', 'devuelto', 'agotado'];
const REQUIRED = ['fecha', 'tienda', 'producto', 'entregado', 'devuelto'];
const ALIASES = {
  dia: 'fecha', fecha_visita: 'fecha', cliente: 'tienda', punto_de_venta: 'tienda', sku: 'producto', articulo: 'producto',
  dejado: 'entregado', entrega: 'entregado', piezas_entregadas: 'entregado', cantidad: 'entregado',
  devolucion: 'devuelto', caducado: 'devuelto', merma: 'devuelto', retirado: 'devuelto',
  agotado_al_llegar: 'agotado', se_agoto: 'agotado', ruta_id: 'ruta', valor_devolucion: 'valor_devuelto',
};

const key = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [';', ',', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(c => c.trim() !== ''));
  if (!nonEmpty.length) return { header: [], records: [] };
  const header = nonEmpty[0].map(h => ALIASES[key(h)] ?? key(h));
  const records = nonEmpty.slice(1).map((r, i) => {
    const o = { _fila: i + 2 };
    header.forEach((h, j) => { o[h] = (r[j] ?? '').trim(); });
    return o;
  });
  return { header, records };
}

export function parseDate(s) {
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return mk(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}
function mk(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

export function parseFlag(s) {
  const k = key(s ?? '');
  if (k === '') return null;
  if (['si', 's', '1', 'x', 'true', 'verdadero', 'agotado', 'yes', 'y'].includes(k)) return true;
  if (['no', 'n', '0', 'false', 'falso'].includes(k)) return false;
  return undefined;
}

const num = s => {
  const t = String(s).trim().replace(/\s/g, '');
  if (t === '') return NaN;
  return Number(t.replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, ''));
};

/** Historial de visitas → filas limpias y avisos con número de fila del archivo. */
export function validateHistory(text) {
  const { header, records } = parseCSV(text);
  const missing = REQUIRED.filter(c => !header.includes(c));
  if (missing.length) {
    return { fatal: `Al historial le faltan columnas obligatorias: ${missing.join(', ')}. Descarga la plantilla para ver el formato.` };
  }
  const issues = [], visits = [], seen = new Set();
  let noFlag = 0;
  for (const r of records) {
    const errs = [];
    const fecha = parseDate(r.fecha);
    if (!fecha) errs.push(`fecha no reconocida «${r.fecha}»`);
    if (!r.tienda) errs.push('tienda vacía');
    if (!r.producto) errs.push('producto vacío');
    const entregado = num(r.entregado), devuelto = num(r.devuelto === '' ? '0' : r.devuelto);
    if (!(entregado >= 0) || !Number.isInteger(entregado)) errs.push(`«entregado» debe ser un entero ≥ 0 (valor: «${r.entregado}»)`);
    if (!(devuelto >= 0) || !Number.isInteger(devuelto)) errs.push(`«devuelto» debe ser un entero ≥ 0 (valor: «${r.devuelto}»)`);
    const agotado = header.includes('agotado') ? parseFlag(r.agotado) : null;
    if (agotado === undefined) errs.push(`«agotado» debe ser sí o no (valor: «${r.agotado}»)`);
    if (errs.length) { issues.push({ nivel: 'error', fila: r._fila, mensaje: errs.join('; ') }); continue; }
    const id = `${+fecha}|${r.tienda}|${r.producto}`;
    if (seen.has(id)) { issues.push({ nivel: 'aviso', fila: r._fila, mensaje: 'Visita repetida (misma fecha, tienda y producto); se usa la primera' }); continue; }
    seen.add(id);
    if (agotado === null) noFlag++;
    visits.push({ fecha, ruta: r.ruta || 'Ruta', tienda: r.tienda.replace(/\s+/g, ' '), producto: r.producto.replace(/\s+/g, ' '),
                  entregado, devuelto, agotado, orden: r.orden ? num(r.orden) : undefined, fila: r._fila });
  }
  if (!visits.length) return { fatal: 'Ninguna fila del historial es válida. Revisa los errores por fila.', issues };
  if (noFlag) issues.unshift({ nivel: 'aviso', fila: null,
    mensaje: `${noFlag} visitas sin la marca de agotado: en esos intervalos la demanda puede estar subestimada. Empieza a marcarla en cada visita.` });
  const days = (Math.max(...visits.map(v => v.fecha)) - Math.min(...visits.map(v => v.fecha))) / 86400000;
  if (days < 28) issues.unshift({ nivel: 'aviso', fila: null, mensaje: `Solo ${Math.round(days)} días de historial; con menos de 4 semanas las sugerencias son orientativas.` });
  return { visits, issues, rutas: [...new Set(visits.map(v => v.ruta))] };
}

/** Catálogo opcional: precio, costo y valor que se recupera de lo devuelto, por producto. */
export function validateCatalog(text) {
  const { header, records } = parseCSV(text);
  if (!['producto', 'precio', 'costo'].every(c => header.includes(c))) {
    return { fatal: 'El catálogo necesita las columnas producto, precio y costo (valor_devuelto es opcional).' };
  }
  const catalog = {}, issues = [];
  for (const r of records) {
    const precio = num(r.precio), costo = num(r.costo), vd = r.valor_devuelto ? num(r.valor_devuelto) : 0;
    if (!r.producto || !(precio > 0) || !(costo >= 0) || !(vd >= 0)) {
      issues.push({ nivel: 'error', fila: r._fila, mensaje: 'Producto sin nombre o con precio, costo o valor devuelto inválido' });
      continue;
    }
    if (costo >= precio) issues.push({ nivel: 'aviso', fila: r._fila, mensaje: `«${r.producto}»: el costo no es menor que el precio` });
    catalog[r.producto.replace(/\s+/g, ' ')] = { precio, costo, valor_devuelto: vd };
  }
  return { catalog, issues };
}

export function toCSV(rows, columns) {
  const esc = v => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.join(','), ...rows.map(r => columns.map(c => esc(r[c])).join(','))].join('\n') + '\n';
}

export const fmtDate = d => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

// ------------------------------------------------------------------ datos de ejemplo
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gamma(shape, rand) {
  if (shape < 1) return gamma(shape + 1, rand) * Math.pow(rand(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { const u1 = rand(), u2 = rand(); x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rand();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function poisson(lam, rand) {
  if (lam > 60) return Math.max(0, Math.round(lam + Math.sqrt(lam) * Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand())));
  const L = Math.exp(-lam); let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

export const EXAMPLE_PRODUCTS = [
  { producto: 'Pan blanco grande', precio: 42, costo: 28, valor_devuelto: 6, base: 3.2, k: 6 },
  { producto: 'Bolillo', precio: 3, costo: 1.6, valor_devuelto: 0.3, base: 9, k: 5 },
  { producto: 'Leche entera 1 L', precio: 29, costo: 23, valor_devuelto: 0, base: 4.5, k: 8 },
  { producto: 'Concha', precio: 12, costo: 6.5, valor_devuelto: 1, base: 3.5, k: 5 },
  { producto: 'Tortillinas', precio: 34, costo: 24, valor_devuelto: 4, base: 1.8, k: 6 },
];
const STORES = ['Abarrotes Doña Lupe', 'Miscelánea El Güero', 'Tienda La Esperanza', 'Abarrotes San Judas', 'Mini súper Los Pinos',
  'Tienda Don Chava', 'Abarrotes La Guadalupana', 'Miscelánea Rosita', 'Tienda El Paisano', 'Abarrotes Mary', 'La Tiendita de Toño',
  'Abarrotes Los Compadres', 'Miscelánea La Fe', 'Tienda Doña Mago', 'Abarrotes El Puente', 'Mini súper Santa Cruz',
  'Tienda La Palma', 'Abarrotes Hermanos Pérez', 'Miscelánea El Sol', 'Tienda La Bendición', 'Abarrotes Doña Tere',
  'Tienda El Nopal', 'Abarrotes La Escondida'];

/** 23 tiendas, 5 productos, visitas lunes y jueves durante 12 semanas. La regla actual del repartidor deja una
 *  cantidad fija por tienda y producto: en unas sobra (devoluciones), en otras se queda corta (agotados). */
export function exampleData(seed = 7) {
  const rand = rng(seed);
  const start = Date.UTC(2026, 6, 20); // lunes 20/07/2026
  const dates = [];
  for (let w = 0; w < 12; w++) { dates.push(new Date(start + (w * 7) * 86400000)); dates.push(new Date(start + (w * 7 + 3) * 86400000)); }
  const rows = [];
  STORES.forEach((tienda, si) => {
    const size = Math.exp((rand() - 0.5) * 1.2);
    for (const p of EXAMPLE_PRODUCTS) {
      if (p.producto === 'Tortillinas' && si % 4 === 3) continue;
      const rate = p.base * size * Math.exp((rand() - 0.5) * 0.6);
      const factor = rand() < 0.45 ? 0.8 + rand() * 0.15 : 1.15 + rand() * 0.35;
      let prevLeft = 0;
      dates.forEach((fecha, i) => {
        const gap = i + 1 < dates.length ? Math.round((dates[i + 1] - fecha) / 86400000) : 3;
        const rule = Math.max(1, Math.round(rate * 3.5 * factor));
        rows.push({ fecha, ruta: 'Ruta 07', tienda, producto: p.producto, entregado: rule, devuelto: prevLeft, agotado: null, orden: si + 1, _gap: gap, _rate: rate, _k: p.k });
      });
    }
  });
  // Demanda real entre visitas y resultado al llegar a la siguiente.
  const byKey = new Map();
  for (const r of rows) { const k = `${r.tienda}|${r.producto}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
  for (const list of byKey.values()) {
    list[0].agotado = false; list[0].devuelto = 0;
    for (let i = 0; i + 1 < list.length; i++) {
      const r = list[i], mu = r._rate * r._gap;
      const demand = poisson(gamma(r._k, rand) * (mu / r._k), rand);
      const sold = Math.min(demand, r.entregado);
      list[i + 1].devuelto = r.entregado - sold;
      list[i + 1].agotado = demand >= r.entregado;
    }
  }
  const visits = rows.map(({ _gap, _rate, _k, ...r }) => r);
  const truth = {};
  for (const r of rows) truth[`${r.tienda}|${r.producto}`] = r._rate;
  return { visits, truth, catalog: Object.fromEntries(EXAMPLE_PRODUCTS.map(p => [p.producto, { precio: p.precio, costo: p.costo, valor_devuelto: p.valor_devuelto }])) };
}

export function exampleCSV(seed = 7) {
  const { visits, catalog } = exampleData(seed);
  const hist = toCSV(visits.map(v => ({ ...v, fecha: fmtDate(v.fecha), agotado: v.agotado ? 'sí' : 'no' })), [...HISTORY_COLUMNS, 'orden']);
  const cat = toCSV(Object.entries(catalog).map(([producto, c]) => ({ producto, ...c })), ['producto', 'precio', 'costo', 'valor_devuelto']);
  return { historial: hist, catalogo: cat };
}
