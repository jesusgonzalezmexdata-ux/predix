# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-10-16

### Added
- Route order app (`site/ruta/`, published at `/ruta/` on the project page): visit-history CSV intake with row-level Spanish messages, load sheet, store-by-store phone screen with a one-tap stock-out mark and expired-units stepper, close-of-route CSV export and an optional pilot with a random control group. No dependencies; works offline (service worker); data stay on the device.
- Route model (`site/ruta/model.js`): censored negative binomial per store and product with recency weights, dispersion by censored profile likelihood, coverage until the following visit and a minimum service level; live update when a stock-out is marked.
- Thirteen Node tests (`tests/js/`) run in CI, and a pilot protocol (`docs/MVP_PILOTO.md`).

## [1.1.0] - 2026-10-16

### Added
- Weekly bootstrap interval of the replenishment saving: −46 % with a 95 % interval of −32 % to −58 %.
- English README with the Spanish version kept as `README.es.md`.
- Project page on GitHub Pages and a live demo on Hugging Face Spaces, published automatically from `main`.
- Release workflow: notes from this changelog and an evidence bundle attached to every tag.

## [1.0.0] - 2026-10-04

### Added
- Simulated grocery stores with day-of-week, payday, December and price effects.
- Censored negative-binomial demand model validated out of sample.
- Forecast-based order policy with per-product service levels; Streamlit dashboard.
