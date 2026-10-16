import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import main


class CityPulseApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_db = main.DB_PATH
        main.DB_PATH = Path(self.temp.name) / "test.sqlite3"
        main.init_db()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        main.DB_PATH = self.previous_db
        self.temp.cleanup()

    def test_dataset_quality_and_join_coverage(self):
        report = self.client.get("/api/v1/datasets")
        self.assertEqual(report.status_code, 200)
        data = report.json()
        self.assertEqual([x["rows"] for x in data["reports"]], [10000, 8000, 1000])
        self.assertEqual(data["join_coverage"], {"incidents": 10000, "complaints": 8000})

    def test_complaint_review_is_persisted_and_audited(self):
        response = self.client.post("/api/v1/complaints/C000001/review", json={"state": "NEEDS REVIEW", "note": "Check location"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/v1/complaints?limit=1").json()["items"][0]["review_state"], "NEEDS REVIEW")
        self.assertEqual(self.client.get("/api/v1/ledger").json()["items"][0]["entity"], "complaint")

    def test_emergency_lifecycle_requires_order_and_records_audit(self):
        case = self.client.post("/api/v1/emergencies", json={"incident_id": "I000001"}).json()
        case_id = case["case_id"]
        self.assertTrue(case["simulated"])
        self.assertEqual(self.client.post(f"/api/v1/emergencies/{case_id}/escalate", json={}).status_code, 409)
        actions = ["mark-unacknowledged", "escalate", "acknowledge", "dispatch", "resolve"]
        for action in actions:
            response = self.client.post(f"/api/v1/emergencies/{case_id}/{action}", json={"actor": "Test operator"})
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/api/v1/emergencies").json()["items"][0]["state"], "RESOLVED")
        events = [x for x in self.client.get("/api/v1/ledger").json()["items"] if x["case_id"] == case_id]
        self.assertEqual(len(events), 6)
        actions_in_order = [x["action"] for x in reversed(events)]
        self.assertEqual(actions_in_order[0], "SIMULATED alert submitted; no message sent")
        self.assertEqual(actions_in_order[-1], "Case resolved")
        self.assertTrue(all(x["actor"] == "Test operator" for x in events[:-1]))
        self.assertEqual(events[-1]["actor"], "Demo operator")

    def test_model_status_does_not_claim_a_trained_model(self):
        model = self.client.get("/api/v1/models/status").json()
        self.assertFalse(model["trained"])
        self.assertFalse(model["training_available"])
        self.assertEqual(model["observed_months"], 12)

    def test_priority_map_can_load_all_ranked_locations(self):
        response = self.client.get("/api/v1/priorities?limit=1000")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["items"]), 1000)
        self.assertTrue(response.json()["items"][0]["explanation"])


if __name__ == "__main__":
    unittest.main()
