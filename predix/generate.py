"""Genera ventas e inventario diarios de 3 tiendas: python -m predix.generate

La demanda real no se observa: cuando un producto se agota, la venta registrada es menor que la
demanda. El inventario sigue la regla actual del dueño (pedidos lunes y jueves hasta un nivel fijo).
"""
from collections import deque

import numpy as np
import pandas as pd

from .config import (DATA, DECEMBER, EGG_SHOCK, END, MONTHLY_INFLATION, NB_SIZE, OIL_PROMO, PRODUCTS,
                     REVIEW_DAYS, SEED, START, STORES, WEEKDAY, is_quincena)


def calendar():
    return pd.date_range(START, END, freq="D")


def price_paths(dates, rng):
    months = (dates.year - dates[0].year) * 12 + dates.month - 1
    inflation = (1 + MONTHLY_INFLATION) ** np.asarray(months)
    prices = {}
    for product, spec in PRODUCTS.items():
        price = spec[1] * inflation
        if product.startswith("Huevo"):
            price = price * np.where(dates >= EGG_SHOCK[0], 1 + EGG_SHOCK[1], 1)
        if product.startswith("Aceite"):    # una semana de promoción al mes
            promo = np.zeros(len(dates), dtype=bool)
            for _, idx in pd.Series(np.arange(len(dates))).groupby([dates.year, dates.month]):
                start = rng.integers(0, len(idx) - 6)
                promo[idx.to_numpy()[start:start + 7]] = True
            price = price * np.where(promo, 1 - OIL_PROMO, 1)
        prices[product] = np.round(price, 2)
    return pd.DataFrame(prices, index=dates)


def expected_demand(dates, store, product, price):
    scale, growth, weekend = STORES[store]
    base, p0, _, _, quincena, elasticity, _ = PRODUCTS[product]
    years = (dates - dates[0]).days.to_numpy() / 365.25
    dow = np.asarray(WEEKDAY)[dates.dayofweek] * np.where(dates.dayofweek >= 5, weekend, 1)
    return (base * scale * (1 + growth) ** years * dow
            * np.where(is_quincena(dates), quincena, 1) * np.where(dates.month == 12, DECEMBER, 1)
            * (np.asarray(price) / p0) ** elasticity)


def simulate_inventory(dates, demand, shelf_life, order_up_to, initial):
    """Inventario FIFO con caducidad; order_up_to(i, stock) devuelve el nivel objetivo del día de revisión."""
    lots, pending, rows = deque([[shelf_life, initial]]), 0, []
    for i, day in enumerate(dates):
        received, pending = pending, 0
        if received:
            lots.append([i + shelf_life, received])
        waste = 0
        while lots and lots[0][0] <= i:
            waste += lots.popleft()[1]
        opening = sum(q for _, q in lots)
        sold = min(int(demand[i]), opening)
        remaining = sold
        while remaining:
            take = min(remaining, lots[0][1])
            lots[0][1] -= take
            remaining -= take
            if lots[0][1] == 0:
                lots.popleft()
        closing = opening - sold
        order = max(0, int(order_up_to(i, closing)) - closing) if day.dayofweek in REVIEW_DAYS else 0
        pending = order
        rows.append((opening, received, waste, sold, closing, order))
    return pd.DataFrame(rows, columns=["inventario_inicial", "recibido", "merma", "ventas",
                                       "inventario_final", "pedido"], index=dates)


def generate(seed=SEED):
    rng = np.random.default_rng(seed)
    dates = calendar()
    prices = price_paths(dates, rng)
    sales, truth = [], []
    for store, (scale, _, _) in STORES.items():
        for product, spec in PRODUCTS.items():
            mu = expected_demand(dates, store, product, prices[product])
            demand = rng.negative_binomial(NB_SIZE, NB_SIZE / (NB_SIZE + mu))
            level = round(spec[6] * spec[0] * scale)          # regla del dueño: días de cobertura fijos
            inv = simulate_inventory(dates, demand, spec[3], lambda i, s, lv=level: lv, level)
            sales.append(inv.assign(tienda=store, producto=product, precio_mxn=prices[product].to_numpy()))
            truth.append(pd.DataFrame({"fecha": dates, "tienda": store, "producto": product,
                                       "demanda_esperada": mu, "demanda_real": demand}))
    sales = pd.concat(sales).rename_axis("fecha").reset_index()
    sales = sales[["fecha", "tienda", "producto", "precio_mxn", "inventario_inicial", "recibido",
                   "merma", "ventas", "inventario_final", "pedido"]]
    catalog = pd.DataFrame([{"producto": p, "vida_util_dias": s[3], "costo_sobre_precio": s[2],
                             "dias_cobertura_regla_actual": s[6]} for p, s in PRODUCTS.items()])
    return {"ventas_diarias": sales, "catalogo": catalog, "demanda_real": pd.concat(truth, ignore_index=True)}


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    tables = generate()
    for name in ("ventas_diarias", "catalogo"):   # la demanda real no se observa en la práctica
        tables[name].to_csv(DATA / f"{name}.csv", index=False, date_format="%Y-%m-%d")
        print(f"{name:15s} {len(tables[name]):>6,d} filas")


if __name__ == "__main__":
    main()
