"""Unsupervised anomaly scoring for invoice-level features (Isolation Forest).

Important honesty notes
-----------------------
* The model is fitted on the batch it is asked to score (no labelled fraud data
  exists in this project), so it only says "this invoice is statistically unusual
  relative to the other invoices in this batch".
* `risk_indicator` is a 0-100 *relative rank* inside the batch. It is NOT a
  probability of fraud and no accuracy / precision / recall is claimed.
"""
from __future__ import annotations

import os
from typing import Iterable

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import RobustScaler

MODEL_VERSION = "isolation-forest-v1.0.0"
FEATURES = [
    "amount",
    "tax_amount",
    "item_count",
    "customer_invoices_30d",
    "customer_refund_count",
    "deviation_from_customer_mean",
]
MIN_ROWS = int(os.getenv("ML_MIN_ROWS", "30"))
CONTAMINATION = float(os.getenv("ML_CONTAMINATION", "0.05"))
N_ESTIMATORS = int(os.getenv("ML_N_ESTIMATORS", "200"))
RANDOM_STATE = 42


class NotEnoughData(ValueError):
    pass


def score_rows(rows: Iterable[dict]) -> dict:
    df = pd.DataFrame(list(rows))
    if df.empty or len(df) < MIN_ROWS:
        raise NotEnoughData(f"At least {MIN_ROWS} rows are required to fit an Isolation Forest (received {len(df)}).")
    if "id" not in df.columns:
        raise ValueError("Each row must contain an 'id'.")

    for col in FEATURES:
        if col not in df.columns:
            df[col] = 0.0
    X = df[FEATURES].apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(0.0)

    # Robust scaling limits the influence of the very outliers we are trying to find.
    Xs = RobustScaler().fit_transform(X.values)
    Xs = np.nan_to_num(Xs, nan=0.0, posinf=0.0, neginf=0.0)

    model = IsolationForest(
        n_estimators=N_ESTIMATORS,
        contamination=CONTAMINATION,
        random_state=RANDOM_STATE,
    )
    model.fit(Xs)
    raw = -model.score_samples(Xs)  # higher = more anomalous
    lo, hi = float(raw.min()), float(raw.max())
    indicator = np.zeros_like(raw) if hi - lo < 1e-12 else (raw - lo) / (hi - lo) * 100.0
    outlier = model.predict(Xs) == -1

    results = [
        {
            "id": str(i),
            "is_outlier": bool(o),
            "risk_indicator": round(float(r), 2),
            "anomaly_score": round(float(a), 6),
        }
        for i, o, r, a in zip(df["id"], outlier, indicator, raw)
    ]
    return {
        "results": results,
        "model": {
            "version": MODEL_VERSION,
            "algorithm": "IsolationForest",
            "n_rows": int(len(df)),
            "features": FEATURES,
            "contamination": CONTAMINATION,
            "n_estimators": N_ESTIMATORS,
            "evaluated": False,
            "note": "Unsupervised; fitted on the submitted batch. No accuracy metrics are available because no labelled data exists.",
        },
    }
