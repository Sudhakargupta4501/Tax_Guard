import os, sys, unittest
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from scoring import score_rows, NotEnoughData


def synthetic(n=60, seed=1):
    rng = np.random.default_rng(seed)
    rows = [{"id": f"inv{i}", "amount": float(rng.normal(10000, 1500)), "tax_amount": float(rng.normal(1800, 270)),
             "item_count": 2, "customer_invoices_30d": 3, "customer_refund_count": 0,
             "deviation_from_customer_mean": float(rng.normal(0, 0.5))} for i in range(n)]
    rows.append({"id": "odd", "amount": 900000.0, "tax_amount": 162000.0, "item_count": 40,
                 "customer_invoices_30d": 25, "customer_refund_count": 9, "deviation_from_customer_mean": 12.0})
    return rows


class ScoringTests(unittest.TestCase):
    def test_flags_injected_synthetic_outlier(self):
        out = score_rows(synthetic())
        by_id = {r["id"]: r for r in out["results"]}
        self.assertTrue(by_id["odd"]["is_outlier"])
        self.assertEqual(by_id["odd"]["risk_indicator"], 100.0)
        self.assertFalse(out["model"]["evaluated"])

    def test_rejects_small_batches(self):
        with self.assertRaises(NotEnoughData):
            score_rows(synthetic(5)[:5])

    def test_deterministic(self):
        a = score_rows(synthetic()); b = score_rows(synthetic())
        self.assertEqual(a["results"], b["results"])

    def test_handles_missing_columns_and_nans(self):
        rows = [{"id": str(i), "amount": float(i)} for i in range(40)]
        rows[3]["amount"] = float("nan")
        self.assertEqual(len(score_rows(rows)["results"]), 40)


if __name__ == "__main__":
    unittest.main()
