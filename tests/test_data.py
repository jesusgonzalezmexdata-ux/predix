import pandas as pd

from predix.generate import generate


def test_saved_csv_matches_the_generator(tables, saved):
    pd.testing.assert_frame_equal(saved, tables["ventas_diarias"], check_dtype=False)


def test_generator_is_reproducible():
    a, b = generate(seed=3), generate(seed=3)
    pd.testing.assert_frame_equal(a["ventas_diarias"], b["ventas_diarias"])


def test_inventory_balances(saved):
    df = saved.sort_values(["tienda", "producto", "fecha"])
    assert (df["ventas"] <= df["inventario_inicial"]).all()
    assert (df["inventario_final"] == df["inventario_inicial"] - df["ventas"]).all()
    prev = df.groupby(["tienda", "producto"])["inventario_final"].shift()
    flow = prev + df["recibido"] - df["merma"]
    assert (flow.dropna() == df.loc[flow.notna(), "inventario_inicial"]).all()


def test_sales_never_exceed_true_demand(tables):
    merged = tables["ventas_diarias"].merge(tables["demanda_real"], on=["fecha", "tienda", "producto"])
    assert (merged["ventas"] <= merged["demanda_real"]).all()
    stockout = merged["inventario_final"] == 0
    assert (merged.loc[~stockout, "ventas"] == merged.loc[~stockout, "demanda_real"]).all()
