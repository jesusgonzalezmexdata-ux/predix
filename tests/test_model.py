import numpy as np
import pytest

from predix import inventory as inv
from predix.config import WEEKDAY
from predix.model import DemandModel, seasonal_naive, wape

SATURDAY = WEEKDAY[5] / WEEKDAY[0]


def test_censored_model_recovers_the_true_effects(model):
    effects = model.effects()
    assert effects["día sáb"] == pytest.approx(SATURDAY, rel=0.03)
    assert effects["quincena · Huevo 1 kg"] == pytest.approx(1.15, rel=0.03)
    assert np.log(effects["log precio · Huevo 1 kg"]) == pytest.approx(-0.6, abs=0.1)
    assert model.alpha == pytest.approx(1 / 20, rel=0.15)


def test_treating_sales_as_demand_is_biased(split):
    naive = DemandModel(censored=False).fit(split[0])
    assert naive.effects()["día sáb"] > SATURDAY * 1.05


def test_lost_sales_estimate_is_close_to_the_truth(tables, split, model):
    test = split[1].merge(tables["demanda_real"], on=["fecha", "tienda", "producto"])
    estimated = (inv.estimated_demand(test, model) - test["ventas"]).sum()
    real = (test["demanda_real"] - test["ventas"]).sum()
    assert estimated == pytest.approx(real, rel=0.10)


def test_seasonal_naive_uses_last_week(saved):
    fc = seasonal_naive(saved, (7,))
    sku = saved[(saved["tienda"] == "Tienda A") & (saved["producto"] == "Pan de caja")]
    assert fc[sku.index[10]] == sku["ventas"].iat[3]


def test_model_beats_the_naive_forecast_out_of_sample(saved, split, model):
    fc = seasonal_naive(saved, (7,))
    test = saved[saved["fecha"] > split[0]["fecha"].max()]
    ok = test["inventario_final"] > 0
    assert wape(test.loc[ok, "ventas"], model.predict(test[ok])) < 0.8 * wape(test.loc[ok, "ventas"], fc[test.index[ok]])
