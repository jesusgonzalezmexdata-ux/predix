import numpy as np
import pandas as pd

from predix import inventory as inv


def test_target_level_grows_with_service_level():
    mu = [30, 35, 40]
    levels = [inv.target_level(mu, 0.05, s) for s in (0.5, 0.9, 0.98)]
    assert levels[0] >= sum(mu) and levels == sorted(levels)


def test_owner_rule_is_recovered_from_orders(saved):
    levels = inv.owner_levels(saved)
    assert levels[("Tienda A", "Arroz 1 kg")] == 160          # 10 días × 16 piezas
    assert len(levels) == 15


def test_fifo_discards_expired_stock():
    dates = pd.date_range("2025-01-06", periods=8)            # empieza en lunes
    sim = inv.simulate_inventory(dates, np.full(8, 5), shelf_life=3, order_up_to=lambda i, s: 0, initial=30)
    assert sim["merma"].sum() == 30 - 15                     # vendió 3 días × 5 y caducó el resto


def test_proposed_policy_beats_the_current_rule(tables, split, model):
    best, _ = inv.tune_service_levels(split[0], model, tables["catalogo"], levels=[0.7, 0.9, 0.98])
    res = inv.compare_policies(split[1], model, tables["catalogo"], service_by_sku=best)
    total = res.groupby("politica")[["costo_reposicion_mxn", "merma_mxn", "unidades_perdidas"]].sum()
    assert (total.loc["Propuesta"] < total.loc["Regla actual"]).all()


def test_saving_interval_is_consistent_and_excludes_zero(tables, split, model):
    best, _ = inv.tune_service_levels(split[0], model, tables["catalogo"], levels=[0.7, 0.9, 0.98])
    res = inv.compare_policies(split[1], model, tables["catalogo"], service_by_sku=best)
    total = res.groupby("politica")["costo_reposicion_mxn"].sum()
    boot = inv.saving_bootstrap(split[1], model, tables["catalogo"], best, n=500)
    assert abs(boot["ahorro_mxn"] - (total["Regla actual"] - total["Propuesta"])) < 1e-6 * total.sum()
    low, high = boot["ahorro_ic95_mxn"]
    assert 0 < low <= boot["ahorro_mxn"] <= high
