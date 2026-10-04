"""Predix · pedido sugerido y pronóstico de demanda: streamlit run streamlit_app.py"""
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from predix import inventory as inv
from predix.config import DATA, REVIEW_DAYS, TRAIN_END
from predix.model import WEEKDAYS, DemandModel, future_frame, quantile

st.set_page_config(page_title="Predix · abarrotes", page_icon="🛒", layout="wide")

SERIES = ["#2a78d6", "#eb6834", "#1baf7a"]
ACCENT, DIM, CRITICAL = SERIES[0], "#c9c8c1", "#d03b3b"
INK, INK_2, MUTED, GRID, BASE, SURFACE = "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7", "#fcfcfb"
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def style(fig, title, height=380, **layout):
    fig.update_layout(
        title=dict(text=title, x=0, font=dict(size=16, color=INK)), height=height,
        font=dict(family="system-ui, -apple-system, 'Segoe UI', sans-serif", size=13, color=INK_2),
        paper_bgcolor=SURFACE, plot_bgcolor=SURFACE, margin=dict(l=10, r=10, t=64, b=10),
        legend=dict(orientation="h", yanchor="bottom", y=1.0, x=0, title=None, traceorder="normal"),
        hoverlabel=dict(bgcolor="white", font_color=INK), barcornerradius=4, **layout)
    fig.update_xaxes(showgrid=False, linecolor=BASE, ticks="", automargin=True)
    fig.update_yaxes(gridcolor=GRID, zeroline=False, linecolor=BASE, automargin=True)
    return fig


def fecha_es(d):
    return f"{WEEKDAYS[d.dayofweek]} {d.day} {MESES[d.month - 1]}"


@st.cache_data
def get_data():
    df = pd.read_csv(DATA / "ventas_diarias.csv", parse_dates=["fecha"])
    return df.assign(agotado=df["inventario_final"] == 0), pd.read_csv(DATA / "catalogo.csv")


@st.cache_resource
def get_model():
    return DemandModel().fit(get_data()[0])


@st.cache_resource
def get_evaluation():
    df, catalog = get_data()
    train = df[df["fecha"] <= TRAIN_END].reset_index(drop=True)
    model = DemandModel().fit(train)
    best, _ = inv.tune_service_levels(train, model, catalog)
    return model, best


@st.cache_data
def policy_results(overrides):
    df, catalog = get_data()
    model, best = get_evaluation()
    levels = {**best, **dict(overrides)}
    test = df[df["fecha"] > TRAIN_END].reset_index(drop=True)
    return inv.compare_policies(test, model, catalog, service_by_sku=levels)


df, catalog = get_data()
model = get_model()
stores, products = sorted(df["tienda"].unique()), list(catalog["producto"])

st.title("Predix · pedidos y demanda para abarrotes")
st.caption("3 tiendas · 5 productos básicos · 2024–2025 · **datos sintéticos** generados con `predix/generate.py`. "
           "Análisis completo en `notebooks/analisis_predix.ipynb`.")

tab_order, tab_fc, tab_patterns, tab_policy = st.tabs(["Pedido sugerido", "Pronóstico", "Patrones", "Política de inventario"])

with tab_order:
    _, best = get_evaluation()
    review_days = sorted(df.loc[df["fecha"].dt.dayofweek.isin(REVIEW_DAYS), "fecha"].unique())[-12:]
    day = st.selectbox("Día de pedido", review_days[::-1], format_func=lambda d: fecha_es(pd.Timestamp(d)))
    day = pd.Timestamp(day)
    nxt = day + pd.Timedelta(days=3 if day.dayofweek == 0 else 4)
    window = pd.date_range(day + pd.Timedelta(days=1), nxt)
    today = df[df["fecha"] == day].set_index(["tienda", "producto"])
    last_price = df.sort_values("fecha").groupby(["tienda", "producto"])["precio_mxn"].last()
    frame = last_price.reset_index().merge(pd.DataFrame({"fecha": window}), how="cross")   # precios vigentes
    frame["mu"] = model.predict(frame).to_numpy()
    rows = []
    for (store, product), g in frame.groupby(["tienda", "producto"]):
        level = inv.target_level(g["mu"], model.alpha, best[(store, product)])
        stock = int(today.loc[(store, product), "inventario_final"])
        rows.append({"Tienda": store, "Producto": product, "Inventario al cierre": stock,
                     "Demanda esperada hasta la entrega": round(g["mu"].sum()),
                     "Nivel de servicio": f"{best[(store, product)]:.0%}", "Nivel objetivo": int(level),
                     "Pedido sugerido": max(0, int(level) - stock),
                     "Pedido con la regla actual": int(today.loc[(store, product), "pedido"])})
    order = pd.DataFrame(rows)
    st.markdown(f"Pedido del **{fecha_es(day)}**: llega el {fecha_es(day + pd.Timedelta(days=1))} y debe "
                f"cubrir hasta el {fecha_es(nxt)}, cuando llega la siguiente entrega.")
    st.dataframe(order, hide_index=True, height=36 * (len(order) + 1) + 4)
    st.download_button("Descargar pedido (CSV)", order.to_csv(index=False).encode("utf-8-sig"),
                       file_name=f"pedido_{day:%Y-%m-%d}.csv", mime="text/csv")

with tab_fc:
    c1, c2 = st.columns(2)
    store = c1.selectbox("Tienda", stores, index=2)
    product = c2.selectbox("Producto", products)
    hist = df[(df["tienda"] == store) & (df["producto"] == product)].tail(56)
    future = future_frame(df, 14)
    future = future[(future["tienda"] == store) & (future["producto"] == product)].reset_index(drop=True)
    future["mu"] = model.predict(future).to_numpy()
    future["p10"], future["p90"] = quantile(model, future["mu"], 0.10), quantile(model, future["mu"], 0.90)
    fig = go.Figure()
    fig.add_scatter(x=future["fecha"], y=future["p90"], mode="lines", line=dict(width=0), hoverinfo="skip",
                    showlegend=False)
    fig.add_scatter(x=future["fecha"], y=future["p10"], mode="lines", fill="tonexty", fillcolor="rgba(42,120,214,0.12)",
                    line=dict(width=0), name="Intervalo 80 %", hoverinfo="skip")
    fig.add_scatter(x=future["fecha"], y=future["mu"], mode="lines", name="Pronóstico", line=dict(color=ACCENT, width=2),
                    customdata=list(zip([fecha_es(d) for d in future["fecha"]], future["p10"], future["p90"])),
                    hovertemplate="%{customdata[0]}: %{y:.0f} (80 %: %{customdata[1]:.0f}–%{customdata[2]:.0f})<extra></extra>")
    fig.add_scatter(x=hist["fecha"], y=hist["ventas"], mode="lines", name="Ventas", line=dict(color=INK_2, width=1.5),
                    customdata=[fecha_es(d) for d in hist["fecha"]], hovertemplate="%{customdata}: %{y} vendidas<extra></extra>")
    out = hist[hist["agotado"]]
    fig.add_scatter(x=out["fecha"], y=out["ventas"], mode="markers", name="Día agotado",
                    marker=dict(color=CRITICAL, size=9, line=dict(color=SURFACE, width=2)),
                    customdata=[fecha_es(d) for d in out["fecha"]],
                    hovertemplate="%{customdata}: agotado con %{y} vendidas<extra></extra>")
    ticks = pd.date_range(hist["fecha"].min(), future["fecha"].max(), freq="W-MON")[::2]
    fig.update_xaxes(tickvals=ticks, ticktext=[f"{d.day} {MESES[d.month - 1]}" for d in ticks])
    st.plotly_chart(style(fig, f"{product} · {store}: últimas 8 semanas y próximos 14 días", yaxis=dict(rangemode="tozero")),
                    theme=None)
    st.caption(f"En las últimas 8 semanas, {product} se agotó {len(out)} días en {store}. "
               "En esos días la venta registrada es menor que la demanda; el modelo lo toma en cuenta.")

with tab_patterns:
    left, right = st.columns(2)
    est = df.assign(demanda=inv.estimated_demand(df, model))
    by_day = est.groupby(est["fecha"].dt.dayofweek)[["ventas", "demanda"]].mean()
    fig = go.Figure()
    fig.add_bar(x=[WEEKDAYS[d] for d in by_day.index], y=by_day["ventas"], name="Ventas registradas", marker_color=DIM,
                hovertemplate="%{x}: %{y:.1f} vendidas<extra></extra>")
    fig.add_bar(x=[WEEKDAYS[d] for d in by_day.index], y=by_day["demanda"], name="Demanda estimada", marker_color=ACCENT,
                hovertemplate="%{x}: %{y:.1f} demandadas<extra></extra>")
    left.plotly_chart(style(fig, "Promedio diario por tienda y producto", height=360, barmode="group", bargap=0.35),
                      theme=None)
    effects = model.effects()
    q = effects[effects.index.str.startswith("quincena")].sort_values()
    fig = go.Figure(go.Bar(x=(q - 1) * 100, y=q.index.str.replace("quincena · ", ""), orientation="h",
                           marker_color=ACCENT, hovertemplate="%{y}: +%{x:.0f} %<extra></extra>"))
    right.plotly_chart(style(fig, "Venta adicional en días de quincena", height=360, bargap=0.55,
                             xaxis=dict(ticksuffix=" %", showgrid=True, gridcolor=GRID)), theme=None)
    table = pd.DataFrame({"Efecto": effects}).rename_axis("Variable")
    with st.expander("Todos los efectos del modelo (multiplicativos: 1.25 = +25 %)"):
        st.dataframe(table.style.format("{:.3f}"))

with tab_policy:
    _, best = get_evaluation()
    st.markdown("Simulación de **julio a diciembre de 2025** con la misma demanda para las dos políticas. "
                "El nivel de servicio de cada producto se eligió con datos de 2024 a junio de 2025.")
    c1, c2 = st.columns([1, 2])
    product = c1.selectbox("Cambiar el nivel de servicio de", products, index=1)
    current = best[(stores[0], product)]
    level = c2.select_slider("Nivel de servicio", options=inv.SERVICE_LEVELS, value=current, format_func="{:.0%}".format)
    overrides = tuple(((s, product), level) for s in stores)
    res = policy_results(overrides)
    total = res.groupby("politica")[["dias_con_quiebre", "merma_mxn", "inventario_promedio_mxn",
                                     "costo_reposicion_mxn"]].sum()
    labels = {"dias_con_quiebre": "Días con faltante", "merma_mxn": "Merma (MXN)",
              "inventario_promedio_mxn": "Inventario promedio (MXN)", "costo_reposicion_mxn": "Costo de reponer mal (MXN)"}
    cols = st.columns(4)
    for col, (key, label) in zip(cols, labels.items()):
        new, old = total.loc["Propuesta", key], total.loc["Regla actual", key]
        value = f"{new:,.0f}" if key == "dias_con_quiebre" else f"${new:,.0f}"
        col.metric(label, value, f"{new / old - 1:+.0%} vs. regla actual" if old else None,
                   delta_color="inverse", border=True)
    by_product = res.pivot_table(index="producto", columns="politica", values=list(labels), aggfunc="sum")
    by_product = by_product.rename_axis("Producto")
    by_product = by_product[[(k, p) for k in labels for p in ("Regla actual", "Propuesta")]]
    by_product.columns = [f"{labels[a]} · {b}" for a, b in by_product.columns]
    st.dataframe(by_product.style.format("{:,.0f}"))
    st.caption("Costo de reponer mal = margen perdido por faltantes + merma + costo de mantener inventario (25 % anual).")
