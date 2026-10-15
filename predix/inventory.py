"""Políticas de inventario: la regla actual (nivel fijo) contra un nivel dinámico basado en el pronóstico."""
import numpy as np
import pandas as pd
from scipy import stats

from .config import HOLDING_RATE, REVIEW_DAYS
from .generate import simulate_inventory

SERVICE_LEVELS = [0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 0.98]


def owner_levels(df):
    """La regla actual se deduce de los pedidos: en día de revisión, inventario final + pedido = nivel objetivo."""
    review = df[pd.DatetimeIndex(df["fecha"]).dayofweek.isin(REVIEW_DAYS) & (df["pedido"] > 0)]
    return (review["inventario_final"] + review["pedido"]).groupby([review["tienda"], review["producto"]]).median()


def estimated_demand(df, model):
    """Demanda para simular: la venta si no hubo quiebre; E[D | D ≥ venta] si se agotó."""
    demand = df["ventas"].astype(float)
    out = df["inventario_final"] == 0
    demand[out] = model.demand_given_stockout(df[out])
    return demand.round()


def target_level(window_mu, alpha, service):
    """Cuantil `service` de la demanda hasta la siguiente entrega (aproximación normal de la
    suma de binomiales negativas: media Σμ, varianza Σ(μ + αμ²))."""
    window_mu = np.asarray(window_mu)
    return float(np.ceil(window_mu.sum() + stats.norm.ppf(service)
                         * np.sqrt((window_mu + alpha * window_mu ** 2).sum())))


def dynamic_levels(dates, mu, alpha, service):
    """Nivel objetivo para cada día de revisión."""
    review = np.flatnonzero(np.isin(dates.dayofweek, REVIEW_DAYS))
    levels = np.zeros(len(dates))
    for k, i in enumerate(review):
        j = review[k + 1] if k + 1 < len(review) else i + 4
        levels[i] = target_level(mu[i + 1:j + 1], alpha, service)
    return levels


def simulate(sku, demand, shelf_life, level, initial):
    """level: número (regla fija) o arreglo por día (nivel dinámico)."""
    dates = pd.DatetimeIndex(sku["fecha"])
    target = (lambda i, s: level) if np.isscalar(level) else (lambda i, s: level[i])
    sim = simulate_inventory(dates, demand, shelf_life, target, int(initial))
    sim["demanda"] = demand
    sim["precio"] = sku["precio_mxn"].to_numpy()
    sim["costo"] = sim["precio"] * sku["costo_sobre_precio"].to_numpy()
    return sim


def evaluate(sim):
    margin = sim["precio"] - sim["costo"]
    lost = sim["demanda"] - sim["ventas"]
    out = {
        "dias_con_quiebre": int((lost > 0).sum()),
        "unidades_perdidas": float(lost.sum()),
        "margen_perdido_mxn": float((lost * margin).sum()),
        "merma_mxn": float((sim["merma"] * sim["costo"]).sum()),
        "inventario_promedio_mxn": float((sim["inventario_final"] * sim["costo"]).mean()),
        "margen_bruto_mxn": float((sim["ventas"] * margin).sum()),
    }
    holding = out["inventario_promedio_mxn"] * HOLDING_RATE * len(sim) / 365
    out["costo_reposicion_mxn"] = out["margen_perdido_mxn"] + out["merma_mxn"] + holding
    out["utilidad_mxn"] = out["margen_bruto_mxn"] - out["merma_mxn"] - holding
    return out


def compare_policies(df, model, catalog, service_by_sku=None, service=None):
    """Simula la regla actual y la propuesta por tienda × producto sobre `df`."""
    shelf = catalog.set_index("producto")["vida_util_dias"]
    df = df.merge(catalog[["producto", "costo_sobre_precio"]], on="producto")
    df["demanda_estimada"] = estimated_demand(df, model)
    df["mu"] = model.predict(df)
    owner = owner_levels(df)
    rows = []
    for (store, product), sku in df.sort_values("fecha").groupby(["tienda", "producto"]):
        demand = sku["demanda_estimada"].to_numpy()
        initial = sku["inventario_inicial"].iat[0]
        lvl = service_by_sku[(store, product)] if service_by_sku is not None else service
        levels = dynamic_levels(pd.DatetimeIndex(sku["fecha"]), sku["mu"].to_numpy(), model.alpha, lvl)
        for policy, level in (("Regla actual", owner[(store, product)]), ("Propuesta", levels)):
            res = evaluate(simulate(sku, demand, shelf[product], level, initial))
            rows.append({"tienda": store, "producto": product, "politica": policy, "nivel_servicio": lvl, **res})
    return pd.DataFrame(rows)


def tune_service_levels(df, model, catalog, levels=SERVICE_LEVELS):
    """Elige por tienda × producto el nivel de servicio que maximiza la utilidad simulada."""
    results = pd.concat([compare_policies(df, model, catalog, service=s) for s in levels], ignore_index=True)
    proposed = results[results["politica"] == "Propuesta"]
    best = proposed.loc[proposed.groupby(["tienda", "producto"])["utilidad_mxn"].idxmax()]
    return best.set_index(["tienda", "producto"])["nivel_servicio"].to_dict(), proposed


def _daily_cost(sim):
    margin = sim["precio"] - sim["costo"]
    lost = sim["demanda"] - sim["ventas"]
    return lost * margin + sim["merma"] * sim["costo"] + sim["inventario_final"] * sim["costo"] * HOLDING_RATE / 365


def saving_bootstrap(df, model, catalog, service_by_sku, n=2000, seed=42):
    """Intervalo del ahorro con bootstrap por semanas (remuestrea semanas completas de todas las tiendas).

    Captura la variación semana a semana de la demanda; no captura la dependencia del inventario entre
    semanas ni la incertidumbre de los parámetros del modelo.
    """
    shelf = catalog.set_index("producto")["vida_util_dias"]
    df = df.merge(catalog[["producto", "costo_sobre_precio"]], on="producto")
    df["demanda_estimada"] = estimated_demand(df, model)
    df["mu"] = model.predict(df)
    owner = owner_levels(df)
    daily = []
    for (store, product), sku in df.sort_values("fecha").groupby(["tienda", "producto"]):
        demand = sku["demanda_estimada"].to_numpy()
        initial = sku["inventario_inicial"].iat[0]
        levels = dynamic_levels(pd.DatetimeIndex(sku["fecha"]), sku["mu"].to_numpy(), model.alpha,
                                service_by_sku[(store, product)])
        cur = _daily_cost(simulate(sku, demand, shelf[product], owner[(store, product)], initial))
        new = _daily_cost(simulate(sku, demand, shelf[product], levels, initial))
        daily.append(pd.DataFrame({"fecha": pd.DatetimeIndex(sku["fecha"]), "actual": cur.to_numpy(), "propuesta": new.to_numpy()}))
    days = pd.concat(daily).groupby("fecha").sum()
    weeks = days.groupby(days.index.to_period("W")).sum()
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(weeks), size=(n, len(weeks)))
    cur, new = weeks["actual"].to_numpy()[idx].sum(axis=1), weeks["propuesta"].to_numpy()[idx].sum(axis=1)
    reduction = 1 - new / cur
    q = lambda v: [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))]  # noqa: E731
    return {"semanas": int(len(weeks)), "ahorro_mxn": float(weeks["actual"].sum() - weeks["propuesta"].sum()),
            "ahorro_ic95_mxn": q(cur - new), "reduccion": float(1 - weeks["propuesta"].sum() / weeks["actual"].sum()),
            "reduccion_ic95": q(reduction)}
