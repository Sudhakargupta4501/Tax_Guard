"""TaxGuard AI - optional anomaly-detection microservice (FastAPI + scikit-learn).

Run:  uvicorn app:app --port 8000
The Express backend works without this service; it calls POST /score when an
authorised reviewer requests ML analysis and ML_SERVICE_URL is configured.
"""
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from scoring import MODEL_VERSION, NotEnoughData, score_rows

app = FastAPI(title="TaxGuard AI ML Service", version=MODEL_VERSION)


class Row(BaseModel):
    id: str
    amount: float = 0
    tax_amount: float = 0
    item_count: float = 0
    customer_invoices_30d: float = 0
    customer_refund_count: float = 0
    deviation_from_customer_mean: float = 0


class ScoreRequest(BaseModel):
    rows: List[Row] = Field(..., max_length=50000)


@app.get("/health")
def health():
    return {"status": "ok", "model_version": MODEL_VERSION}


@app.post("/score")
def score(req: ScoreRequest):
    try:
        return score_rows([r.model_dump() for r in req.rows])
    except NotEnoughData as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
