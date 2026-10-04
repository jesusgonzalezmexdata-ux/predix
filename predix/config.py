"""Supuestos de la cadena ficticia de abarrotes (datos sintéticos)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
FIGURES = ROOT / "reports" / "figures"

SEED = 2024
START, END = "2024-01-01", "2025-12-31"
TRAIN_END = "2025-06-30"            # se entrena con ene 2024 – jun 2025 y se evalúa jul – dic 2025

STORES = {  # escala de demanda, crecimiento anual, refuerzo de fin de semana
    "Tienda A": (1.00, 0.00, 1.00),
    "Tienda B": (0.80, 0.15, 1.00),
    "Tienda C": (1.20, 0.03, 1.15),
}

# producto: (demanda base diaria, precio ene-2024 MXN, costo/precio, vida útil en días,
#            efecto quincena, elasticidad precio, días de cobertura de la regla actual)
PRODUCTS = {
    "Leche 1 L":   (55, 28.0, 0.80, 6, 1.08, -0.3, 4.9),
    "Pan de caja": (30, 48.0, 0.70, 5, 1.08, -0.3, 5.2),
    "Huevo 1 kg":  (38, 46.0, 0.82, 21, 1.15, -0.6, 5.0),
    "Arroz 1 kg":  (16, 32.0, 0.75, 365, 1.30, -0.3, 10.0),
    "Aceite 1 L":  (12, 44.0, 0.78, 365, 1.30, -1.2, 10.0),
}

WEEKDAY = [0.88, 0.90, 0.94, 0.97, 1.08, 1.25, 1.10]   # lunes a domingo
DECEMBER = 1.12
NB_SIZE = 20                     # dispersión de la demanda (binomial negativa)
MONTHLY_INFLATION = 0.0035
EGG_SHOCK = ("2025-03-01", 0.18)  # alza del huevo
OIL_PROMO = 0.12                  # descuento de la semana de promoción del aceite

REVIEW_DAYS = (0, 3)             # pedidos lunes y jueves; llegan al día siguiente
LEAD_TIME = 1
HOLDING_RATE = 0.25              # costo anual de mantener inventario (% del costo)


def is_quincena(dates):
    """Días de pago: 15, 16, último del mes, 1 y 2."""
    return dates.day.isin([1, 2, 15, 16]) | dates.is_month_end
