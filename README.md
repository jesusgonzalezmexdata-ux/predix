# Predix: demand and inventory for small grocery stores

*English · [Español](README.es.md)*

**How much to order every Monday and Thursday in a corner grocery store, based on real demand and not only on what the store managed to sell.**

Python (pandas, statsmodels, SciPy) · censored negative binomial · inventory simulation · Streamlit

> **Synthetic data.** Three fictitious stores, five staple products, 2024–2025. `predix/generate.py` simulates demand (day of week, payday fortnight, December, price and growth) and the operation under the owner's current ordering rule, including expiry and stock-outs. The figures do not belong to any real business.

## Executive summary

**With the current rule ("top up to X units on Mondays and Thursdays"), on 6 Mondays out of 10 each store runs out of milk, bread or eggs before closing, while it throws away 3 % of the bread. An order computed from the demand forecast cuts the cost of poor replenishment by 46 % and frees 30 % of the capital tied up in inventory.**

| Indicator, July–December 2025 (simulation with the same demand) | Current rule | Predix | Change |
|---|---|---|---|
| Units not sold (lost sales) | 2,195 | 831 | −62 % |
| Stock-out days (store × product) | 104 | 74 | −29 % |
| Waste (MXN at cost) | 17,109 | 8,171 | −52 % |
| Average inventory (MXN at cost) | 49,756 | 34,959 | −30 % |
| **Cost of poor replenishment** (lost margin + waste + holding cost) | **42,119** | **22,826** | **−46 %** |

![Recorded sales versus estimated demand](reports/figures/ventas_vs_demanda.png)

## What makes this analysis different

1. **It treats stock-outs as censoring.** A sold-out day does not say "demand was 40" but "demand was *at least* 40". The demand model (negative binomial) uses P(D ≥ sales) on those days, a Tobit-style censored likelihood for counts. Because the data are simulated, the bias of each method can be measured:

   | Effect | True value | Sales as demand | Excluding sold-out days | **Censored** |
   |---|---|---|---|---|
   | Saturday vs Monday | 1.42 | 1.57 | 1.46 | **1.41** |
   | Price elasticity of eggs | −0.60 | −0.50 | −0.60 | **−0.60** |
   | December | 1.12 | 1.10 | 1.11 | **1.12** |

2. **It validates out of sample.** Trained on January 2024 to June 2025, evaluated on July to December 2025:

   | Daily forecast | WAPE | Bias |
   |---|---|---|
   | Same weekday last week | 31.7 % | −0.7 % |
   | 4-week average | 25.4 % | −1.6 % |
   | Negative binomial (sales as demand) | 22.3 % | −2.3 % |
   | **Censored negative binomial** | **22.1 %** | **−0.3 %** |

   Estimated lost sales come within 6 % of the true ones, which are only known because the data are simulated.

3. **It does not use a single service level.** Each order's target level is the forecast demand until the next delivery plus a buffer from the model's variance. Each product's service level is chosen by simulation (the *newsvendor* problem):
   - bread, which expires in 5 days: ≈ 70 %;
   - milk: 90–95 %;
   - eggs, rice and oil: 98 %.

<p>
  <img src="reports/figures/utilidad_por_nivel_de_servicio.png" width="49%" alt="Profit by service level">
  <img src="reports/figures/pronostico_leche_tienda_c.png" width="49%" alt="Forecast with an 80 % interval">
</p>

![Policy comparison](reports/figures/comparacion_politicas.png)

The full analysis is in [`notebooks/analisis_predix.ipynb`](notebooks/analisis_predix.ipynb) (Spanish).

## Dashboard

`streamlit_app.py` has four tabs:
- **Suggested order:** for each ordering day, closing inventory, expected demand until the next delivery, target level and suggested order against the current rule's. Downloadable as CSV.
- **Forecast:** 14 days ahead with an 80 % interval, by store and product.
- **Patterns:** day of week, payday fortnight and all model effects.
- **Inventory policy:** simulation of both rules, with a control to change each product's service level.

![Dashboard: inventory policy](reports/figures/tablero.png)

## How to run it

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows · macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt

python -m predix.generate          # optional: regenerate data/ (fixed seed)
pytest                             # 13 tests: data, model and inventory
streamlit run streamlit_app.py
jupyter lab notebooks/analisis_predix.ipynb
```

## Structure

```
├── predix/
│   ├── config.py      # stores, products, calendar and assumptions
│   ├── generate.py    # simulated demand + FIFO inventory with expiry
│   ├── model.py       # censored negative binomial, forecast and reference methods
│   ├── inventory.py   # current rule, dynamic target level, simulation and service-level tuning
│   └── plots.py
├── data/              # ventas_diarias.csv (10,965 rows) and catalogo.csv
├── notebooks/
├── reports/figures/
├── tests/
└── streamlit_app.py
```

`ventas_diarias.csv` has one row per store, product and day (column names in Spanish):
- `precio_mxn`: price
- `inventario_inicial`: opening stock, after receiving and removing expired units
- `recibido`: received
- `merma`: waste
- `ventas`: sales
- `inventario_final`: closing stock; if 0, the product sold out and sales are a lower bound of demand
- `pedido`: order, delivered the next day

## Assumptions and limitations

- **Orders and deliveries:** orders on Mondays and Thursdays, delivered the next day; holding cost is 25 % a year.
- **Lost sales:** assumed lost, with no substitution by the customer. If customers substitute, the real benefit is smaller.
- **Scope:** a real store has hundreds of products and cross promotions. The method scales, but the parameters must be estimated from the store's own data.
- **Data worth starting to record:** the time each product sells out. With it, censored demand is estimated even better.

## License

Code under [MIT](LICENSE).

---

**Jesús R. L. González** · Data Analyst and Data Scientist · Operations and quality · [LinkedIn](https://www.linkedin.com/in/jesus-r-l-gonzalez)
