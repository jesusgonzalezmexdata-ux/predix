"""Gráficas estáticas (matplotlib) para el notebook y el README."""
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import numpy as np

INK, INK_2, MUTED = "#0b0b0b", "#52514e", "#898781"
GRID, BASE, SURFACE = "#e1e0d9", "#c3c2b7", "#fcfcfb"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a"]   # paleta categórica validada (CVD)
ACCENT, DIM, CRITICAL = SERIES[0], "#c9c8c1", "#d03b3b"

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "font.family": "sans-serif", "font.size": 10, "text.color": INK,
    "axes.edgecolor": BASE, "axes.labelcolor": INK_2, "axes.titlesize": 12,
    "axes.titleweight": "bold", "axes.titlelocation": "left", "axes.titlepad": 12,
    "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
    "axes.grid": True, "axes.grid.axis": "y", "axes.axisbelow": True, "grid.color": GRID,
    "grid.linewidth": 0.8, "xtick.color": MUTED, "ytick.color": MUTED, "xtick.labelcolor": INK_2,
    "ytick.labelcolor": INK_2, "ytick.left": False, "legend.frameon": False, "figure.dpi": 110,
    "savefig.dpi": 160, "savefig.bbox": "tight",
})
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def ventas_vs_demanda(by_weekday):
    """by_weekday: índice = día, columnas 'ventas' y 'demanda' (promedios diarios)."""
    fig, ax = plt.subplots(figsize=(9, 3.8))
    x = np.arange(len(by_weekday))
    ax.bar(x - 0.17, by_weekday["ventas"], 0.32, color=DIM, label="Ventas registradas")
    ax.bar(x + 0.17, by_weekday["demanda"], 0.32, color=ACCENT, label="Demanda estimada")
    gap = by_weekday["demanda"] / by_weekday["ventas"] - 1
    for xi, (d, g) in enumerate(zip(by_weekday["demanda"], gap)):
        if g > 0.05:
            ax.text(xi + 0.17, d + 0.6, f"+{g:.0%}", ha="center", fontsize=9, color=INK, fontweight="bold")
    ax.set_xticks(x, by_weekday.index)
    ax.set_ylabel("Unidades promedio por tienda y producto")
    ax.set_title("El lunes no se vende menos por falta de clientes: falta producto")
    ax.legend(loc="upper left", ncols=2, bbox_to_anchor=(0, 1.02))
    ax.set_ylim(0, by_weekday["demanda"].max() * 1.22)
    return fig


def pronostico(hist, future, title):
    """hist: fecha, ventas, agotado; future: fecha, mu, p10, p90."""
    fig, ax = plt.subplots(figsize=(10, 3.8))
    ax.fill_between(future["fecha"], future["p10"], future["p90"], color=ACCENT, alpha=0.12, lw=0,
                    label="Intervalo 80 %")
    ax.plot(future["fecha"], future["mu"], color=ACCENT, lw=2, label="Pronóstico")
    ok = ~hist["agotado"]
    ax.plot(hist["fecha"], hist["ventas"], color=INK_2, lw=1.2, label="Ventas")
    ax.scatter(hist.loc[~ok, "fecha"], hist.loc[~ok, "ventas"], s=26, color=CRITICAL, zorder=3,
               edgecolor=SURFACE, linewidth=1, label="Día agotado (venta < demanda)")
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(byweekday=0, interval=2))
    ax.xaxis.set_major_formatter(mtick.FuncFormatter(
        lambda v, _: f"{mdates.num2date(v).day} {MESES[mdates.num2date(v).month - 1]}"))
    ax.set_ylabel("Unidades por día")
    ax.set_title(title)
    ax.legend(loc="upper left", ncols=4, bbox_to_anchor=(0, 1.02), fontsize=9)
    ax.set_ylim(0, max(hist["ventas"].max(), future["p90"].max()) * 1.25)
    return fig


def utilidad_por_servicio(curves, highlight):
    """curves: índice = nivel de servicio, columnas = productos (utilidad relativa al máximo)."""
    fig, ax = plt.subplots(figsize=(9, 3.8))
    for product in curves.columns:
        focus = product in highlight
        color = SERIES[highlight.index(product)] if focus else DIM
        ax.plot(curves.index, curves[product], color=color, lw=2 if focus else 1.5, marker="o", ms=4,
                zorder=3 if focus else 2)
        if focus:
            best = curves[product].idxmax()
            ax.scatter([best], [curves.loc[best, product]], s=60, facecolor=SURFACE, edgecolor=color, lw=2, zorder=4)
            ax.text(curves.index[-1] + 0.015, curves[product].iat[-1], product, va="center", fontsize=9, color=INK)
    ax.text(curves.index[0], curves.min().min(), "En gris: los demás productos", fontsize=8, color=MUTED, va="bottom")
    ax.set_xticks([0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0])
    ax.xaxis.set_major_formatter(mtick.PercentFormatter(1, decimals=0))
    ax.yaxis.set_major_formatter(mtick.PercentFormatter(1, decimals=0))
    ax.set_xlim(curves.index[0] - 0.02, 1.1)
    ax.set_xlabel("Nivel de servicio objetivo (probabilidad de no agotarse antes de la siguiente entrega)")
    ax.set_ylabel("Utilidad vs. la mejor opción")
    ax.set_title("Pan: conviene agotarse a veces · Huevo: conviene no agotarse nunca")
    return fig


def comparacion_politicas(summary):
    """summary: índice = política (Regla actual, Propuesta); columnas = indicadores."""
    metrics = [("dias_con_quiebre", "Días con quiebre", "{:,.0f}"),
               ("merma_mxn", "Merma (MXN)", "${:,.0f}"),
               ("inventario_promedio_mxn", "Inventario promedio (MXN)", "${:,.0f}"),
               ("costo_reposicion_mxn", "Costo de reponer mal (MXN)", "${:,.0f}")]
    fig, axes = plt.subplots(1, len(metrics), figsize=(11, 3.2))
    for ax, (col, label, fmt) in zip(axes, metrics):
        vals = summary[col]
        ax.bar([0, 1], vals, 0.5, color=[DIM, ACCENT])
        for x, v in enumerate(vals):
            ax.text(x, v * 1.03, fmt.format(v), ha="center", va="bottom", fontsize=9, color=INK_2)
        change = vals.iat[1] / vals.iat[0] - 1
        ax.set_title(f"{label}\n{change:+.0%}", fontsize=10)
        ax.set_xticks([0, 1], ["Actual", "Propuesta"])
        ax.set_yticks([])
        ax.grid(False)
        ax.set_ylim(0, vals.max() * 1.25)
    fig.suptitle("Julio a diciembre 2025, simulación con la misma demanda", x=0.01, ha="left",
                 fontsize=12, fontweight="bold")
    fig.tight_layout()
    return fig
