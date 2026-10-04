"""Demanda diaria con binomial negativa censurada: los días agotados la venta es un mínimo, no la demanda."""
import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import optimize, stats

from .config import is_quincena

WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]


def design(df, ref_price):
    """Log-demanda = nivel tienda×producto + día de la semana + fin de semana en Tienda C
    + quincena×producto + diciembre + tendencia×tienda + elasticidad precio×producto."""
    dates = pd.DatetimeIndex(df["fecha"])
    sku = df["tienda"] + " · " + df["producto"]
    cols = {f"nivel {k}": (sku == k).to_numpy(float) for k in sorted(sku.unique())}
    dow = dates.dayofweek.to_numpy()
    cols.update({f"día {WEEKDAYS[d]}": (dow == d).astype(float) for d in range(1, 7)})
    cols["fin de semana · Tienda C"] = ((dow >= 5) & (df["tienda"] == "Tienda C").to_numpy()).astype(float)
    quincena = is_quincena(dates)
    for p in sorted(df["producto"].unique()):
        is_p = (df["producto"] == p).to_numpy()
        cols[f"quincena · {p}"] = (quincena & is_p).astype(float)
        cols[f"log precio · {p}"] = np.where(is_p, np.log(df["precio_mxn"].to_numpy() / ref_price[p]), 0.0)
    cols["diciembre"] = (dates.month == 12).astype(float)
    years = (dates - pd.Timestamp("2024-01-01")).days.to_numpy() / 365.25
    for s in sorted(df["tienda"].unique()):
        cols[f"tendencia · {s}"] = years * (df["tienda"] == s).to_numpy()
    return pd.DataFrame(cols, index=df.index)


def reference_prices(df):
    return df.sort_values("fecha").groupby("producto")["precio_mxn"].first()


class DemandModel:
    """Binomial negativa (NB2). Con censored=True, los días agotados aportan P(D ≥ venta)."""

    def __init__(self, censored=True, drop_stockouts=False):
        self.censored, self.drop_stockouts = censored, drop_stockouts

    def fit(self, df):
        stockout = (df["inventario_final"] == 0).to_numpy()
        if self.drop_stockouts:
            df, stockout = df[~stockout], stockout[~stockout]
        self.ref_price = reference_prices(df)
        X = design(df, self.ref_price)
        self.columns = list(X.columns)
        X, y = X.to_numpy(), df["ventas"].to_numpy()
        cens = stockout if self.censored else np.zeros(len(y), dtype=bool)   # venta 0 agotado: no informa
        start = sm.GLM(y[~cens], X[~cens], family=sm.families.Poisson()).fit().params
        theta0 = np.append(start, np.log(0.05))
        self.opt = optimize.minimize(self._nll, theta0, args=(X, y, cens), jac=True, method="L-BFGS-B")
        self.beta, self.alpha = self.opt.x[:-1], float(np.exp(self.opt.x[-1]))
        return self

    @staticmethod
    def _nll(theta, X, y, cens):
        beta, alpha = theta[:-1], np.exp(theta[-1])
        r = 1 / alpha
        mu = np.exp(X @ beta)
        p = r / (r + mu)
        ll = np.empty(len(y))
        u = ~cens
        ll[u] = stats.nbinom.logpmf(y[u], r, p[u])
        ll[cens] = stats.nbinom.logsf(y[cens] - 1, r, p[cens])
        # gradiente: parte no censurada analítica; censurada y α por diferencias finitas
        g_eta = np.zeros(len(y))
        g_eta[u] = r * (y[u] - mu[u]) / (r + mu[u])
        if cens.any():
            eps = 1e-6
            mu_c = mu[cens] * np.exp(eps)
            ll_up = stats.nbinom.logsf(y[cens] - 1, r, r / (r + mu_c))
            g_eta[cens] = (ll_up - ll[cens]) / eps
        grad_beta = X.T @ g_eta
        h = 1e-5
        r_h = 1 / (alpha * np.exp(h))
        p_h = r_h / (r_h + mu)
        ll_h = np.where(cens, stats.nbinom.logsf(y - 1, r_h, p_h), stats.nbinom.logpmf(y, r_h, p_h))
        grad_la = (ll_h.sum() - ll.sum()) / h
        return -ll.sum(), -np.append(grad_beta, grad_la)

    def predict(self, df):
        X = design(df, self.ref_price).reindex(columns=self.columns, fill_value=0.0)
        return pd.Series(np.exp(X.to_numpy() @ self.beta), index=df.index)

    def effects(self):
        """Efectos multiplicativos (exp β) de las variables de calendario y precio."""
        b = pd.Series(self.beta, index=self.columns)
        return np.exp(b[~b.index.str.startswith("nivel")])

    def demand_given_stockout(self, df):
        """E[D | D ≥ venta] para los días agotados: la mejor estimación de la demanda real."""
        mu, r = self.predict(df).to_numpy(), 1 / self.alpha
        y = df["ventas"].to_numpy()
        out = np.empty(len(y))
        for i, (m, s) in enumerate(zip(mu, y)):
            k = np.arange(s)
            below = (k * stats.nbinom.pmf(k, r, r / (r + m))).sum()
            out[i] = (m - below) / stats.nbinom.sf(s - 1, r, r / (r + m))
        return pd.Series(np.maximum(out, y), index=df.index)


def quantile(model, mu, q):
    r = 1 / model.alpha
    return stats.nbinom.ppf(q, r, r / (r + np.asarray(mu)))


def future_frame(df, days=14):
    """Fechas siguientes al último dato, con el último precio observado de cada producto."""
    last = df[df["fecha"] == df["fecha"].max()][["tienda", "producto", "precio_mxn"]]
    dates = pd.date_range(df["fecha"].max() + pd.Timedelta(days=1), periods=days, freq="D")
    return last.merge(pd.DataFrame({"fecha": dates}), how="cross")


def seasonal_naive(df, lags=(7,)):
    """Pronóstico con la venta del mismo día de semanas anteriores (promedio de los rezagos)."""
    sales = df.sort_values("fecha").groupby(["tienda", "producto"])["ventas"]
    return (sum(sales.shift(lag) for lag in lags) / len(lags)).reindex(df.index).to_numpy()


def wape(actual, forecast):
    return float(np.abs(actual - forecast).sum() / actual.sum())
