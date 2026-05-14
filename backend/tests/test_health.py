"""
Smoke tests for the FastAPI app's health + stats endpoints.

We patch the supabase and anthropic clients before importing main
so the module-level instantiation doesn't try to call real services.
"""
import sys
from unittest.mock import MagicMock, patch


def _import_main_with_stubs():
    """Import backend.main with all external clients mocked."""
    # Reset module if it's been imported in a prior test
    sys.modules.pop("main", None)

    with patch("supabase.create_client") as create_client, patch(
        "anthropic.Anthropic"
    ) as anthropic_cls:
        fake_supabase = MagicMock()
        fake_supabase.table.return_value.select.return_value.execute.return_value = MagicMock(
            count=3381, data=[]
        )
        create_client.return_value = fake_supabase
        anthropic_cls.return_value = MagicMock()

        # The brain + collector imports also touch the clients; patch them too
        with patch.dict("sys.modules", {
            "ai_brain.brain": MagicMock(FormulaAIBrain=MagicMock),
            "knowledge_collector.collector": MagicMock(UniversalKnowledgeCollector=MagicMock),
        }):
            import main  # noqa: WPS433  (intentional dynamic import for test isolation)
            return main


def test_health_endpoint_returns_ok():
    main = _import_main_with_stubs()
    from fastapi.testclient import TestClient

    with TestClient(main.app) as client:
        r = client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert "version" in body


def test_stats_endpoint_shape():
    main = _import_main_with_stubs()
    from fastapi.testclient import TestClient

    with TestClient(main.app) as client:
        r = client.get("/api/stats")
        assert r.status_code == 200
        body = r.json()
        # The shape is the contract — we don't care about exact counts
        for key in ("total_formulas", "total_chemicals", "industries", "countries"):
            assert key in body
        assert body["industries"] == 40
        assert body["countries"] == 195
