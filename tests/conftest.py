import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from predix.config import TRAIN_END  # noqa: E402
from predix.generate import generate  # noqa: E402
from predix.model import DemandModel  # noqa: E402


@pytest.fixture(scope="session")
def tables():
    return generate()


@pytest.fixture(scope="session")
def split(tables):
    df = tables["ventas_diarias"]
    return (df[df["fecha"] <= TRAIN_END].reset_index(drop=True),
            df[df["fecha"] > TRAIN_END].reset_index(drop=True))


@pytest.fixture(scope="session")
def model(split):
    return DemandModel().fit(split[0])


@pytest.fixture(scope="session")
def saved():
    root = Path(__file__).resolve().parents[1] / "data"
    return pd.read_csv(root / "ventas_diarias.csv", parse_dates=["fecha"])
