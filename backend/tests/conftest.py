"""
Shared pytest fixtures for backend tests.

We avoid hitting real Supabase / Anthropic in unit tests by providing
lightweight stubs. Integration tests (marked `@pytest.mark.integration`)
opt in to real services via env vars.
"""
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Make `backend/` importable as `app`-style root
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture
def fake_supabase():
    """A MagicMock standing in for a supabase.Client."""
    client = MagicMock()
    client.table.return_value.select.return_value.execute.return_value = MagicMock(
        count=42, data=[]
    )
    return client


@pytest.fixture
def fake_claude():
    """A MagicMock standing in for anthropic.Anthropic."""
    client = MagicMock()
    return client


@pytest.fixture(autouse=True)
def _stub_env(monkeypatch):
    """Force test-safe env vars so accidental real-API calls would fail loudly."""
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service-test-key")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-test-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-haiku-4-5")
    monkeypatch.setenv("CORS_ORIGINS", "https://jamilformula.com")
    # Sanity: never leak production keys into tests
    for k in ("STRIPE_SECRET_KEY", "PAYSTACK_SECRET_KEY"):
        if k not in os.environ:
            monkeypatch.setenv(k, "test-only")
