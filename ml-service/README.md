# TaxGuard AI — optional ML service

An **optional** FastAPI microservice that scores invoices with scikit-learn's **Isolation Forest**.
The main application is fully functional without it (rule-based detection is always available).

## What it does / does not do
- Receives per-invoice features (amount, tax amount, item count, customer invoices in 30 days, customer refund count, deviation from the customer's mean) at `POST /score`.
- Fits an Isolation Forest on the submitted batch and returns, per invoice, `is_outlier`, `anomaly_score` and `risk_indicator`.
- `risk_indicator` (0-100) is a **relative rank inside the batch**, not a probability of fraud.
- **No accuracy, precision or recall is reported or claimed**: there is no labelled fraud data in this project, so the model cannot be evaluated. Treat results as leads for human review only.
- Needs at least `ML_MIN_ROWS` (default 30) invoices.

## Run
```bash
cd ml-service
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --port 8000
```
Then set `ML_SERVICE_URL=http://localhost:8000` in `server/.env` and restart the API.
Tuning (env vars): `ML_MIN_ROWS`, `ML_CONTAMINATION` (default 0.05), `ML_N_ESTIMATORS` (default 200).

## Test
```bash
python tests/test_scoring.py
```
These tests use synthetic data to check the plumbing (an injected extreme row is ranked top, small batches are rejected, results are deterministic). They are **not** a measure of fraud-detection quality.
