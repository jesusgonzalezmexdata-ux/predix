// Interfaz del pedido sugerido por ruta. Sin dependencias; los datos viven en este dispositivo.
import { pilotGroup, suggest } from './model.js';
import { exampleCSV, toCSV } from './data.js';

const STORE_KEY = 'predix-ruta-v1';
const nf = new Intl.NumberFormat('es-MX');
const n0 = x => nf.format(Math.round(x));
const mxn = x => `$${n0(x)}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const longDate = d => new Date(d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const isoDate = d => new Date(d).toISOString().slice(0, 10);
const dmy = d => { const x = new Date(d); return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`; };
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const S = {
  historial: null, historialNombre: null, catalogo: null, catalogoNombre: null,
  settings: { servicioMinimo: 0.7, piloto: false, inicioPiloto: null, fecha: null, ruta: null },
  plan: null, issues: [], fatal: null, rutas: [], visitas: 0, historia: [], busy: false,
  draft: {}, registros: {}, borrarArmado: false,
};

// ------------------------------------------------------------------ persistencia (solo comodidad local)
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      historial: S.historial, historialNombre: S.historialNombre, catalogo: S.catalogo, catalogoNombre: S.catalogoNombre,
      settings: S.settings, draft: S.draft, registros: S.registros,
    }));
  } catch { /* almacenamiento no disponible o lleno: la sesión sigue funcionando */ }
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    Object.assign(S, { historial: d.historial ?? null, historialNombre: d.historialNombre ?? null, catalogo: d.catalogo ?? null,
                       catalogoNombre: d.catalogoNombre ?? null, draft: d.draft ?? {}, registros: d.registros ?? {} });
    Object.assign(S.settings, d.settings ?? {});
  } catch { /* datos dañados: se empieza de cero */ }
}

// ------------------------------------------------------------------ cálculo del plan
let worker = null;
function compute() {
  if (!S.historial) return;
  S.busy = true; S.fatal = null; render();
  worker ??= new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    S.busy = false;
    S.fatal = data.fatal ?? null;
    S.issues = data.issues ?? [];
    if (!data.fatal) {
      S.plan = data.plan; S.rutas = data.rutas; S.visitas = data.visitas; S.historia = data.historia;
      S.settings.fecha = isoDate(S.plan.fecha); S.settings.ruta = S.plan.ruta;
      if (S.settings.piloto && !S.settings.inicioPiloto) S.settings.inicioPiloto = S.settings.fecha;
      save();
    } else S.plan = null;
    render();
  };
  worker.onerror = () => { S.busy = false; S.fatal = 'Este navegador no pudo iniciar el cálculo. Prueba con una versión reciente de Chrome, Edge, Safari o Firefox.'; render(); };
  worker.postMessage({ historial: S.historial, catalogo: S.catalogo,
                       opts: { servicioMinimo: S.settings.servicioMinimo, fecha: S.settings.fecha, ruta: S.settings.ruta } });
}

const isControl = store => S.settings.piloto && store.grupo === 'control';
function draftOf(store, item) {
  const d = (S.draft[store.tienda] ??= {});
  return (d[item.producto] ??= { agotado: false, devuelto: 0, dejar: null });
}
/** Cantidad base: regla actual en el grupo de control del piloto; si no, la sugerencia con lo visto al llegar. */
function baseQty(store, item) {
  if (isControl(store)) return item.regla;
  const d = draftOf(store, item);
  if (!d.agotado && !d.devuelto) return item.sugerido;
  return suggest(item, { agotado: d.agotado, devuelto: d.devuelto }).sugerido;
}
const qtyOf = (store, item) => { const d = draftOf(store, item); return d.dejar ?? baseQty(store, item); };
const storeTotal = store => store.productos.reduce((s, it) => s + (S.registros[store.tienda]?.items?.[it.producto]?.entregado ?? qtyOf(store, it)), 0);
const plannedQty = (store, item) => (isControl(store) ? item.regla : item.sugerido);

// ------------------------------------------------------------------ descargas
function download(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function loadSheetCSV() {
  const rows = [];
  for (const s of S.plan.stores) for (const it of s.productos) {
    rows.push({ tienda: s.tienda, producto: it.producto, dejar: plannedQty(s, it), regla_actual: it.regla, grupo: S.settings.piloto ? s.grupo : '' });
  }
  for (const c of loadTotals()) rows.push({ tienda: 'TOTAL A CARGAR', producto: c.producto, dejar: c.cargar, regla_actual: c.regla, grupo: '' });
  return toCSV(rows, ['tienda', 'producto', 'dejar', 'regla_actual', 'grupo']);
}
function loadTotals() {
  const t = {};
  for (const s of S.plan.stores) for (const it of s.productos) {
    const c = (t[it.producto] ??= { producto: it.producto, cargar: 0, regla: 0 });
    c.cargar += plannedQty(s, it); c.regla += it.regla;
  }
  return Object.values(t);
}
function visitsCSV() {
  const rows = [];
  S.plan.stores.forEach((s, i) => {
    const reg = S.registros[s.tienda];
    if (!reg) return;
    for (const it of s.productos) {
      const r = reg.items[it.producto];
      if (r) rows.push({ fecha: dmy(S.plan.fecha), ruta: S.plan.ruta ?? '', tienda: s.tienda, producto: it.producto, entregado: r.entregado,
                         devuelto: r.devuelto, agotado: r.agotado ? 'sí' : 'no', orden: i + 1 });
    }
  });
  return toCSV(rows, ['fecha', 'ruta', 'tienda', 'producto', 'entregado', 'devuelto', 'agotado', 'orden']);
}

// ------------------------------------------------------------------ vistas
const main = () => document.getElementById('main');

function issuesHTML() {
  if (!S.issues.length) return '';
  const shown = S.issues.slice(0, 12);
  return `<ul class="issues" aria-label="Revisión de los datos">${shown.map(i => `<li class="${i.nivel}">${i.fila ? `<span class="row-ref">${i.archivo ? 'Catálogo, fila' : 'Fila'} ${i.fila}:</span> ` : ''}${esc(i.mensaje)}</li>`).join('')}</ul>
    ${S.issues.length > shown.length ? `<p class="hint">Y ${S.issues.length - shown.length} avisos más con el mismo formato.</p>` : ''}`;
}

function viewPreparar() {
  const p = S.plan, st = S.settings;
  const sl = Math.round(st.servicioMinimo * 100);
  let result;
  if (S.busy) result = `<section class="panel" aria-busy="true"><h2>Calculando el pedido</h2><p class="hint">Estimando la demanda de cada tienda y producto…</p></section>`;
  else if (S.fatal) result = `<section class="panel"><p class="fatal">${esc(S.fatal)}</p>${issuesHTML()}</section>`;
  else if (!p) result = `<section class="panel"><h2>Todavía no hay ruta</h2><p>Sube el historial de visitas o prueba con la ruta de ejemplo: 23 tiendas, 5 productos y 12 semanas de visitas los lunes y jueves.</p></section>`;
  else {
    const r = p.resumen, totals = loadTotals();
    const cargar = totals.reduce((s, c) => s + c.cargar, 0), regla = totals.reduce((s, c) => s + c.regla, 0);
    const cost = x => x.costoSobrantes + x.margenPerdido;
    const cls = (a, b) => (a < b ? 'good' : a > b ? 'bad' : '');
    result = `<section class="panel">
      <h2>Hoja de carga para el ${esc(longDate(p.fecha))}</h2>
      <div class="load-head"><span class="big">${n0(cargar)}<small>pz</small></span><span class="versus">La regla actual cargaría ${n0(regla)}</span></div>
      <div class="table-wrap"><table class="compare">
        <thead><tr><th scope="col">Esperado en la ruta</th><th scope="col">Pedido sugerido</th><th scope="col">Regla actual</th></tr></thead>
        <tbody>
          <tr><td>Devoluciones por caducidad</td><td class="${cls(r.sugerido.sobrantes, r.regla.sobrantes)}">${n0(r.sugerido.sobrantes)} pz</td><td>${n0(r.regla.sobrantes)} pz</td></tr>
          <tr><td>Costo de esas devoluciones</td><td class="${cls(r.sugerido.costoSobrantes, r.regla.costoSobrantes)}">${mxn(r.sugerido.costoSobrantes)}</td><td>${mxn(r.regla.costoSobrantes)}</td></tr>
          <tr><td>Ventas perdidas por agotados</td><td class="${cls(r.sugerido.perdidas, r.regla.perdidas)}">${n0(r.sugerido.perdidas)} pz</td><td>${n0(r.regla.perdidas)} pz</td></tr>
          <tr><td>Margen perdido</td><td class="${cls(r.sugerido.margenPerdido, r.regla.margenPerdido)}">${mxn(r.sugerido.margenPerdido)}</td><td>${mxn(r.regla.margenPerdido)}</td></tr>
        </tbody>
        <tfoot><tr><td>Costo de reabastecer mal</td><td class="${cls(cost(r.sugerido), cost(r.regla))}">${mxn(cost(r.sugerido))}</td><td>${mxn(cost(r.regla))}</td></tr></tfoot>
      </table></div>
      <p class="model-note">Es lo que espera el modelo con la demanda estimada de cada tienda, no un resultado medido. Lo confirma el piloto con grupo de control.</p>
      <div class="table-wrap"><table class="compare">
        <thead><tr><th scope="col">Producto</th><th scope="col">Cargar</th><th scope="col">Regla actual</th><th scope="col">Diferencia</th></tr></thead>
        <tbody>${totals.map(c => `<tr><td>${esc(c.producto)}</td><td><b>${n0(c.cargar)}</b></td><td>${n0(c.regla)}</td><td>${c.cargar - c.regla > 0 ? '+' : ''}${n0(c.cargar - c.regla)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="btn-row no-print" style="margin-top:16px">
        <a class="btn btn-primary" href="#/ruta">Empezar la ruta</a>
        <button class="btn" data-act="sheet">Descargar hoja de carga</button>
        <button class="btn" data-act="print">Imprimir</button>
      </div>
    </section>
    ${S.issues.length ? `<section class="panel no-print"><h2>Revisión de los datos</h2>${issuesHTML()}</section>` : ''}`;
  }
  return `<div class="page">
    <h1>Prepara la ruta</h1>
    <p class="lede">Cuánto dejar de cada producto en cada tienda, separando lo que se vendió de lo que se habría vendido cuando se agota. Se calcula en este dispositivo; tus archivos no salen de aquí.</p>
    <div class="grid">
      <div class="stack no-print">
        <section class="panel">
          <h2>Historial de visitas</h2>
          <p class="hint">Un CSV con una fila por producto en cada visita: fecha, tienda, producto, piezas entregadas, piezas caducadas que se recogieron y si estaba agotado al llegar.</p>
          <div class="btn-row" style="margin-top:12px">
            <label class="btn btn-file">Elegir archivo<input type="file" accept=".csv,text/csv,text/plain" data-file="historial"></label>
            <button class="btn" data-act="example">Usar la ruta de ejemplo</button>
          </div>
          ${S.historialNombre ? `<p class="hint" style="margin-top:10px">En uso: <b>${esc(S.historialNombre)}</b>${S.visitas ? `, ${n0(S.visitas)} visitas válidas` : ''}.</p>` : ''}
          <p style="margin-top:8px"><button class="linkish" data-act="tpl-hist">Descargar plantilla del historial</button></p>
        </section>
        <section class="panel">
          <h2>Precios y costos</h2>
          <p class="hint">Opcional. Con ellos el pedido compara lo que cuesta una pieza que regresa contra el margen de una venta que no se hizo.</p>
          <div class="btn-row" style="margin-top:12px"><label class="btn btn-file">Elegir archivo<input type="file" accept=".csv,text/csv,text/plain" data-file="catalogo"></label></div>
          ${S.catalogoNombre ? `<p class="hint" style="margin-top:10px">En uso: <b>${esc(S.catalogoNombre)}</b>.</p>` : ''}
          <p style="margin-top:8px"><button class="linkish" data-act="tpl-cat">Descargar plantilla de precios</button></p>
        </section>
        <section class="panel stack">
          <h2>Ajustes</h2>
          <div class="field"><label for="fecha">Fecha de la visita</label><input id="fecha" type="date" value="${esc(st.fecha ?? '')}" data-set="fecha"></div>
          ${S.rutas.length > 1 ? `<div class="field"><label for="ruta">Ruta</label><select id="ruta" data-set="ruta">${S.rutas.map(r => `<option ${r === st.ruta ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>` : ''}
          <div class="field">
            <label for="sl">Evitar agotados</label>
            <div class="range-row"><input id="sl" type="range" min="50" max="95" step="5" value="${sl}" data-set="sl" aria-describedby="sl-hint"><output for="sl" id="sl-out">${sl}%</output></div>
            <p class="hint" id="sl-hint">Probabilidad mínima de que lo que dejas alcance hasta la siguiente visita. Más alto: menos agotados y más devoluciones.</p>
          </div>
          <label class="check"><input type="checkbox" data-set="piloto" ${st.piloto ? 'checked' : ''}><span><b>Piloto con grupo de control</b><br><span class="hint">La mitad de las tiendas, elegida al azar, recibe la regla actual. Al acumular semanas, el cierre compara los dos grupos.</span></span></label>
        </section>
      </div>
      <div class="stack">${result}
        <section class="panel no-print method">
          <h2>Cómo calcula</h2>
          <ol>
            <li>Entre dos visitas se vendió lo que se dejó menos lo caducado que se recogió.</li>
            <li>Si al llegar el producto estaba agotado, esa venta es solo un mínimo: la demanda pudo ser mayor. El modelo lo trata como dato censurado en lugar de creer que la tienda vendió justo eso.</li>
            <li>Con eso estima la demanda diaria de cada tienda y producto (binomial negativa, con más peso a las últimas semanas).</li>
            <li>El pedido es la menor cantidad que alcanza hasta la siguiente visita con la probabilidad elegida, o la que equilibra margen y costo de devolución si es mayor.</li>
          </ol>
          <p style="margin-top:12px"><a class="linkish" href="#/diseno">Ver el sistema de diseño</a></p>
        </section>
      </div>
    </div>
  </div>`;
}

const shortDate = d => new Date(d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '').replace('.', '');
const lowerFirst = t => t.charAt(0).toLowerCase() + t.slice(1);

function routeBar(right) {
  const p = S.plan, done = p.stores.filter(s => S.registros[s.tienda]).length;
  return `<div class="route-bar"><div class="row"><span class="route-name">${esc(p.ruta ?? 'Ruta')} · ${esc(shortDate(p.fecha))}</span><span class="count">${right}</span></div>
    <div class="progress" role="progressbar" aria-label="Tiendas entregadas" aria-valuemin="0" aria-valuemax="${p.stores.length}" aria-valuenow="${done}"><span style="width:${(100 * done) / p.stores.length}%"></span></div></div>`;
}

function viewRuta(sel = null) {
  const p = S.plan;
  if (!p) return `<div class="page"><h1>Ruta</h1><p class="lede">Todavía no hay ruta. Prepárala con el historial de visitas.</p><p style="margin-top:16px"><a class="btn btn-primary" href="#/preparar">Preparar la ruta</a></p></div>`;
  const done = p.stores.filter(s => S.registros[s.tienda]).length;
  const list = p.stores.map((s, i) => {
    const alerts = s.productos.filter(it => it.nota.tono === 'alerta').length;
    const meta = [`${s.productos.length} productos`];
    if (alerts) meta.push(`${alerts} con agotados recientes`);
    if (S.settings.piloto) meta.push(s.grupo === 'control' ? 'control' : 'pedido sugerido');
    return `<li class="${S.registros[s.tienda] ? 'done' : ''}"><a href="#/tienda/${i}" ${i === sel ? 'aria-current="true"' : ''}>
      <span class="num">${S.registros[s.tienda] ? '✓' : i + 1}</span><span><span class="name">${esc(s.tienda)}</span><span class="meta">${esc(meta.join(' · '))}</span></span>
      <span class="qty-cell">${n0(storeTotal(s))}<small>pz</small></span></a></li>`;
  }).join('');
  return `<div class="route-layout ${sel != null ? 'has-store' : ''}">
    <div class="route-list">${routeBar(`${done} de ${p.stores.length} entregadas`)}<ol class="stores">${list}</ol></div>
    <div class="store-pane">${sel != null ? viewStore(sel) : '<div class="store-empty">Elige una tienda para ver qué dejar.</div>'}</div>
  </div>`;
}

function detailHTML(item) {
  return `Regla actual ${n0(item.regla)} · <span class="${item.nota.tono === 'alerta' ? 'alerta' : ''}">${esc(lowerFirst(item.nota.texto))}</span>`;
}

function viewStore(i) {
  const p = S.plan, s = p.stores[i];
  if (!s) return '<div class="store-empty">Esa tienda no está en la ruta.</div>';
  const reg = S.registros[s.tienda];
  if (reg) for (const it of s.productos) {
    const r = reg.items[it.producto];
    if (!r) continue;
    const d = Object.assign(draftOf(s, it), { agotado: r.agotado, devuelto: r.devuelto, dejar: null });
    if (r.entregado !== baseQty(s, it)) d.dejar = r.entregado;
  }
  const top = s.productos.find(it => it.nota.tono === 'alerta');
  const items = s.productos.map((it, j) => {
    const d = draftOf(s, it), q = qtyOf(s, it);
    return `<li class="item" data-j="${j}">
      <div class="item-row">
        <div><div class="item-name">${esc(it.producto)}</div><div class="item-detail">${detailHTML(it)}</div></div>
        <div><div class="qty"><span class="qty-num" data-qty aria-live="polite" aria-label="Dejar ${q} piezas">${q}</span><span class="qty-unit">pz</span></div><div class="qty-was" data-was></div></div>
      </div>
      <div class="item-actions">
        <button class="chip" type="button" aria-pressed="${d.agotado}" data-act="agotado">${d.agotado ? 'Agotado al llegar' : '¿Agotado al llegar?'}</button>
        <button class="adjust-toggle" type="button" data-act="adjust" aria-expanded="false" aria-controls="adj-${j}">Ajustar</button>
      </div>
      <div class="adjust-panel" id="adj-${j}"><div><div class="adjust-inner">
        <span class="stepper-field returns" ${d.agotado ? 'hidden' : ''}><span class="stepper-label" id="dev-${j}">Caducadas recogidas</span>
          <span class="stepper" role="group" aria-labelledby="dev-${j}"><button type="button" data-act="dev-" aria-label="Una caducada menos">−</button><output data-dev>${d.devuelto}</output><button type="button" data-act="dev+" aria-label="Una caducada más">+</button></span></span>
        <span class="stepper-field"><span class="stepper-label" id="q-${j}">Piezas a dejar</span>
          <span class="stepper" role="group" aria-labelledby="q-${j}"><button type="button" data-act="q-" aria-label="Dejar una pieza menos">−</button><output data-q>${q}</output><button type="button" data-act="q+" aria-label="Dejar una pieza más">+</button></span></span>
      </div></div></div>
    </li>`;
  }).join('');
  const sub = [`<span>${s.productos.length} productos · visita del ${esc(longDate(p.fecha))}</span>`];
  if (S.settings.piloto) sub.push(`<span class="badge ${s.grupo}">${s.grupo === 'control' ? 'Control: regla actual' : 'Pedido sugerido'}</span>`);
  if (reg) sub.push('<span class="badge">Entregada</span>');
  const note = top && !isControl(s)
    ? `<p class="note">${esc(top.producto)}: ${esc(lowerFirst(top.nota.texto))}. ${top.sugerido > top.regla ? `Se ${top.sugerido - top.regla === 1 ? 'sugiere 1 pieza' : `sugieren ${top.sugerido - top.regla} piezas`} más que la regla para cubrir la demanda que no se vio.` : 'El pedido ya cuenta la demanda que no se vio.'}</p>` : '';
  return `<article class="store enter" data-i="${i}">
    ${routeBar(`Tienda ${i + 1} de ${p.stores.length}`)}
    <div class="store-head"><a class="back" href="#/ruta">‹ Tiendas</a><h1 class="store-title">${esc(s.tienda)}</h1><div class="store-sub">${sub.join('')}</div>${note}</div>
    <ul class="items" aria-label="Pedido sugerido">${items}</ul>
    <div class="store-foot"><div class="row"><span>Dejar en esta tienda</span><span class="total" data-total>${n0(storeTotal(s))} pz</span></div>
      <button class="btn btn-primary btn-block" type="button" data-act="confirm">${reg ? 'Actualizar entrega' : 'Confirmar entrega'}</button></div>
  </article>`;
}

function viewCierre() {
  const p = S.plan;
  if (!p) return viewRuta();
  const regs = p.stores.filter(s => S.registros[s.tienda]);
  let dejadas = 0, recogidas = 0, agotados = 0;
  for (const s of regs) for (const r of Object.values(S.registros[s.tienda].items)) { dejadas += r.entregado; recogidas += r.devuelto; agotados += r.agotado ? 1 : 0; }
  const rows = regs.map(s => {
    const items = Object.values(S.registros[s.tienda].items);
    return `<tr><td>${esc(s.tienda)}</td><td>${n0(items.reduce((a, r) => a + r.entregado, 0))}</td><td>${n0(items.reduce((a, r) => a + r.devuelto, 0))}</td><td>${items.filter(r => r.agotado).length}</td></tr>`;
  }).join('');
  return `<div class="page stack">
    <h1>Cierre de la ruta</h1>
    <p class="lede">Lo registrado en este dispositivo para el ${esc(longDate(p.fecha))}. Descárgalo y agrégalo al historial: la próxima ruta lo usa, incluidas las marcas de agotado.</p>
    <div class="kpis">
      <div class="kpi"><b>${regs.length} de ${p.stores.length}</b><span>tiendas entregadas</span></div>
      <div class="kpi"><b>${n0(dejadas)}</b><span>piezas dejadas</span></div>
      <div class="kpi"><b>${n0(recogidas)}</b><span>caducadas recogidas</span></div>
      <div class="kpi"><b>${agotados}</b><span>productos agotados al llegar</span></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" data-act="export" ${regs.length ? '' : 'disabled'}>Descargar visitas de hoy</button>
      <button class="btn" data-act="reset">${S.borrarArmado ? 'Toca otra vez para borrar lo registrado' : 'Empezar otra ruta'}</button>
    </div>
    ${pilotHTML()}
    ${regs.length ? `<div class="table-wrap"><table class="compare"><thead><tr><th scope="col">Tienda</th><th scope="col">Dejadas</th><th scope="col">Caducadas</th><th scope="col">Agotados</th></tr></thead><tbody>${rows}</tbody></table></div>`
                  : '<p>Todavía no hay entregas confirmadas. Abre una tienda en la ruta y confirma lo que dejaste.</p>'}
  </div>`;
}

const PALETTE = [['Blanco', '#FFFFFF', 'Fondo de las pantallas'], ['Negro señal', '#0E0F11', 'Texto y barra de ruta'], ['Amarillo vial', '#FFD21F', 'Única acción principal y avance'],
  ['Agotado', '#D7261E', 'Marca de agotado y alertas'], ['A favor', '#1F7A3D', 'Mejoras frente a la regla'], ['Gris texto', '#4A4E54', 'Texto secundario y trazos']];
const SUPPORT = [['Línea', '#C9CDD1'], ['Fondo de escritorio', '#E9EBE7'], ['Aviso', '#FFF4C2'], ['Texto de aviso', '#2B2A1F'], ['Pista de avance', '#3A3D42']];

function viewDiseno() {
  const sw = ([name, hex, use]) => `<div class="swatch"><i style="background:${hex}"></i><b>${name}</b><code>${hex}</code>${use ? `<span class="hint">${use}</span>` : ''}</div>`;
  return `<div class="page stack">
    <h1>Señal de campo</h1>
    <p class="lede">Sistema visual de Predix, inspirado en la señalización vial y los chalecos de alta visibilidad: fondo blanco, negro y un solo amarillo para la acción. Es el que mejor se lee a pleno sol y con una mano; el texto principal tiene contraste de 19:1. Fuente: archivo de Figma «Predix · MVP 3 Pedido sugerido por ruta», propuesta B.</p>
    <section class="panel"><h2 class="section-title">Paleta</h2><div class="swatches">${PALETTE.map(sw).join('')}</div>
      <h2 class="section-title" style="margin-top:20px">Apoyo</h2><div class="swatches">${SUPPORT.map(sw).join('')}</div></section>
    <section class="panel"><h2 class="section-title">Tipografía</h2>
      <div class="specimen"><span class="store-name">Abarrotes Doña Lupe</span><span class="num-row"><b>18</b><span>pz</span></span>
      <p class="hint">Barlow Condensed, derivada de los rótulos de carretera, para títulos y cantidades: caben cifras de tres dígitos sin achicar. Barlow normal para el texto.</p></div></section>
    <section class="panel"><h2 class="section-title">Componentes</h2>
      <div class="btn-row" style="margin-top:12px"><button class="chip" type="button" aria-pressed="false" data-demo>¿Agotado al llegar?</button><button class="chip" type="button" aria-pressed="true" data-demo>Agotado al llegar</button></div>
      <div class="ds-components"><div class="item"><div class="item-row"><div><div class="item-name">Pan blanco grande</div><div class="item-detail">Regla actual 24 · caduca en 5 días</div></div>
        <div class="qty"><span class="qty-num">18</span><span class="qty-unit">pz</span></div></div><div class="item-actions"><button class="chip" type="button" aria-pressed="false" data-demo>¿Agotado al llegar?</button></div></div>
        <button class="btn btn-primary btn-block" type="button" data-demo>Confirmar entrega</button></div></section>
    <section class="panel"><h2 class="section-title">Movimiento</h2><ul class="hint" style="margin:8px 0 0;padding-left:18px">
      <li>Marcar agotado: el chip cambia de color en 150 ms y la cantidad cuenta hacia el nuevo valor en 250 ms.</li>
      <li>Cambiar de tienda: la pantalla entra desde la derecha en 200 ms.</li>
      <li>Nada se mueve sin una acción; con «reducir movimiento» activado, todo cambia al instante.</li></ul></section>
  </div>`;
}

function pilotHTML() {
  if (!S.settings.piloto) return '';
  const since = S.settings.inicioPiloto ? new Date(`${S.settings.inicioPiloto}T00:00:00Z`) : null;
  const rows = since ? S.historia.filter(v => new Date(v.fecha) >= since) : [];
  const g = { sugerido: { visitas: 0, devuelto: 0, agotados: 0 }, control: { visitas: 0, devuelto: 0, agotados: 0 } };
  for (const v of rows) { const t = g[pilotGroup(v.tienda)]; t.visitas++; t.devuelto += v.devuelto; t.agotados += v.agotado ? 1 : 0; }
  if (g.sugerido.visitas < 20 || g.control.visitas < 20) {
    return `<section class="panel"><h2>Piloto</h2><p>Comparación de grupos desde el ${since ? esc(dmy(since)) : 'inicio'}: todavía no hay suficientes visitas en el historial. Agrega cada semana las visitas descargadas y aquí aparecerá la diferencia en devoluciones y agotados.</p></section>`;
  }
  const line = (k, t) => `<tr><td>${k}</td><td>${n0(t.visitas)}</td><td>${(t.devuelto / t.visitas).toFixed(1)}</td><td>${Math.round((100 * t.agotados) / t.visitas)}%</td></tr>`;
  return `<section class="panel"><h2>Piloto desde el ${esc(dmy(since))}</h2><div class="table-wrap"><table class="compare">
    <thead><tr><th scope="col">Grupo</th><th scope="col">Visitas</th><th scope="col">Caducadas por visita</th><th scope="col">Agotado al llegar</th></tr></thead>
    <tbody>${line('Pedido sugerido', g.sugerido)}${line('Regla actual (control)', g.control)}</tbody></table></div>
    <p class="model-note">Los grupos se asignaron al azar por tienda. Para concluir, espera al menos 8 semanas y compara también la venta.</p></section>`;
}

// ------------------------------------------------------------------ enrutado y eventos
function route() {
  const h = location.hash || '#/preparar';
  const m = h.match(/^#\/tienda\/(\d+)/);
  return m ? { tab: 'ruta', store: +m[1] } : { tab: (h.slice(2) || 'preparar').split('/')[0] };
}
function render() {
  const r = route();
  document.body.classList.toggle('in-store', r.store != null);
  document.querySelectorAll('.tabs a').forEach(a => { if (a.dataset.tab === r.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.getElementById('band-route').textContent = S.plan ? `${S.plan.ruta ?? ''}, ${longDate(S.plan.fecha)}` : '';
  const html = r.tab === 'ruta' ? viewRuta(r.store ?? null) : r.tab === 'cierre' ? viewCierre() : r.tab === 'diseno' ? viewDiseno() : viewPreparar();
  main().innerHTML = html;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function animateNumber(el, from, to) {
  if (from === to) return;
  el.setAttribute('aria-label', `Dejar ${to} piezas`);
  if (reduceMotion()) { el.textContent = to; return; }
  const t0 = performance.now(), dur = 250;
  const step = now => {
    const k = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}

function updateItem(article, j) {
  const s = S.plan.stores[+article.dataset.i], it = s.productos[j], d = draftOf(s, it);
  const li = article.querySelector(`.item[data-j="${j}"]`);
  const num = li.querySelector('[data-qty]');
  const before = Number(num.textContent), now = qtyOf(s, it);
  animateNumber(num, before, now);
  const was = li.querySelector('[data-was]');
  const base = plannedQty(s, it);
  was.innerHTML = now !== base ? `antes <s>${base}</s>` : '';
  const chip = li.querySelector('.chip');
  chip.setAttribute('aria-pressed', d.agotado); chip.textContent = d.agotado ? 'Agotado al llegar' : '¿Agotado al llegar?';
  li.querySelector('.returns').hidden = d.agotado;
  li.querySelector('[data-dev]').textContent = d.devuelto;
  li.querySelector('[data-q]').textContent = now;
  article.querySelector('[data-total]').textContent = `${n0(s.productos.reduce((a, x) => a + qtyOf(s, x), 0))} pz`;
}

function confirmStore(article) {
  const i = +article.dataset.i, s = S.plan.stores[i];
  const items = {};
  for (const it of s.productos) {
    const d = draftOf(s, it);
    items[it.producto] = { entregado: qtyOf(s, it), devuelto: d.agotado ? 0 : d.devuelto, agotado: d.agotado, sugerido: it.sugerido, regla: it.regla };
  }
  S.registros[s.tienda] = { items, hora: new Date().toISOString() };
  save();
  const btn = article.querySelector('[data-act="confirm"]');
  btn.textContent = 'Entregado'; btn.classList.add('is-done');
  toast(`Entrega guardada: ${s.tienda}`);
  const next = S.plan.stores.findIndex((x, k) => k > i && !S.registros[x.tienda]);
  const any = next >= 0 ? next : S.plan.stores.findIndex(x => !S.registros[x.tienda]);
  setTimeout(() => { location.hash = any >= 0 ? `#/tienda/${any}` : '#/cierre'; if (any < 0) toast('Ruta completa: descarga las visitas de hoy'); }, reduceMotion() ? 0 : 450);
}

async function readFile(input) { const f = input.files?.[0]; return f ? { name: f.name, text: await f.text() } : null; }

document.addEventListener('click', e => {
  const demo = e.target.closest('[data-demo].chip');
  if (demo) { demo.setAttribute('aria-pressed', demo.getAttribute('aria-pressed') !== 'true'); demo.textContent = demo.getAttribute('aria-pressed') === 'true' ? 'Agotado al llegar' : '¿Agotado al llegar?'; return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const article = b.closest('.store');
  if (article && S.plan) {
    const li = b.closest('.item');
    const s = S.plan.stores[+article.dataset.i];
    if (li) {
      const j = +li.dataset.j, it = s.productos[j], d = draftOf(s, it);
      if (act === 'adjust') { const open = li.classList.toggle('open'); b.setAttribute('aria-expanded', open); return; }
      if (act === 'agotado') { d.agotado = !d.agotado; if (d.agotado) d.devuelto = 0; }
      if (act === 'dev+') d.devuelto = Math.min(d.devuelto + 1, it.ultimaEntrega ?? 999);
      if (act === 'dev-') d.devuelto = Math.max(d.devuelto - 1, 0);
      if (act === 'q+' || act === 'q-') { const q = qtyOf(s, it) + (act === 'q+' ? 1 : -1); d.dejar = Math.max(q, 0); if (d.dejar === baseQty(s, it)) d.dejar = null; }
      save(); updateItem(article, j); return;
    }
    if (act === 'confirm') { confirmStore(article); return; }
  }
  if (act === 'example') {
    const { historial, catalogo } = exampleCSV();
    Object.assign(S, { historial, historialNombre: 'Ruta 07 de ejemplo (simulada)', catalogo, catalogoNombre: 'Precios de ejemplo', draft: {}, registros: {} });
    S.settings.fecha = null; S.settings.ruta = null; compute();
  }
  if (act === 'tpl-hist') download('plantilla_historial_visitas.csv', exampleCSV().historial);
  if (act === 'tpl-cat') download('plantilla_precios.csv', exampleCSV().catalogo);
  if (act === 'sheet') download(`hoja_de_carga_${S.settings.fecha}.csv`, loadSheetCSV());
  if (act === 'print') window.print();
  if (act === 'export') download(`visitas_${S.settings.fecha}.csv`, visitsCSV());
  if (act === 'reset') {
    if (!S.borrarArmado) { S.borrarArmado = true; render(); setTimeout(() => { S.borrarArmado = false; if (route().tab === 'cierre') render(); }, 4000); return; }
    S.borrarArmado = false; S.draft = {}; S.registros = {}; S.settings.fecha = null; save(); location.hash = '#/preparar'; compute();
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.file) {
    const f = await readFile(t);
    if (!f) return;
    if (t.dataset.file === 'historial') Object.assign(S, { historial: f.text, historialNombre: f.name, draft: {}, registros: {} });
    else Object.assign(S, { catalogo: f.text, catalogoNombre: f.name });
    S.settings.fecha = t.dataset.file === 'historial' ? null : S.settings.fecha;
    compute(); return;
  }
  const k = t.dataset.set;
  if (!k) return;
  if (k === 'fecha') S.settings.fecha = t.value || null;
  if (k === 'ruta') { S.settings.ruta = t.value; S.settings.fecha = null; }
  if (k === 'sl') S.settings.servicioMinimo = Number(t.value) / 100;
  if (k === 'piloto') { S.settings.piloto = t.checked; S.settings.inicioPiloto = t.checked ? (S.settings.fecha ?? null) : null; save(); render(); return; }
  S.draft = {}; save(); compute();
});
document.addEventListener('input', e => { if (e.target.dataset.set === 'sl') document.getElementById('sl-out').textContent = `${e.target.value}%`; });

window.addEventListener('hashchange', () => { render(); if (!route().store) main().focus({ preventScroll: true }); window.scrollTo(0, 0); });

load();
if (!location.hash) history.replaceState(null, '', S.historial ? '#/ruta' : '#/preparar');
render();
compute();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
