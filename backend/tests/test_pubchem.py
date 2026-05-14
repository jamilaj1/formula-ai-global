"""
Tests for the PubChem REST client (services/pubchem.py).

Network is mocked at the httpx layer — these tests run offline and verify
that we parse PubChem's JSON shapes correctly and handle 404/5xx gracefully.

For an end-to-end test against the real PubChem service, see
`test_pubchem_integration.py` (marked with @pytest.mark.integration so it's
opt-in and won't run in CI by default).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from services.pubchem import (
    PubChemError,
    cid_to_properties,
    lookup_by_cas,
    lookup_by_name,
    name_to_cid,
)


def _mock_response(status: int, json_body: dict | None = None, text: str = ""):
    """Build a stub httpx-style response object."""
    mock = AsyncMock()
    mock.status_code = status
    mock.json = lambda: json_body or {}
    mock.text = text
    return mock


@pytest.mark.asyncio
async def test_name_to_cid_returns_first_match():
    """PubChem returns a CID list — we take the first entry."""
    client = AsyncMock()
    client.get = AsyncMock(
        return_value=_mock_response(200, {"IdentifierList": {"CID": [702, 1234]}})
    )
    cid = await name_to_cid(client, "ethanol")
    assert cid == 702


@pytest.mark.asyncio
async def test_name_to_cid_404_returns_none():
    """Compound not in PubChem → None, not an exception."""
    client = AsyncMock()
    client.get = AsyncMock(return_value=_mock_response(404))
    cid = await name_to_cid(client, "made_up_chemical_xyz")
    assert cid is None


@pytest.mark.asyncio
async def test_name_to_cid_empty_input_returns_none():
    client = AsyncMock()
    assert await name_to_cid(client, "") is None
    assert await name_to_cid(client, "   ") is None


@pytest.mark.asyncio
async def test_cid_to_properties_extracts_canonical_smiles():
    client = AsyncMock()
    client.get = AsyncMock(
        return_value=_mock_response(
            200,
            {
                "PropertyTable": {
                    "Properties": [
                        {
                            "CID": 702,
                            "SMILES": "CCO",
                            "InChI": "InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3",
                            "InChIKey": "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
                            "MolecularFormula": "C2H6O",
                            "MolecularWeight": "46.07",
                            "IUPACName": "ethanol",
                        }
                    ]
                }
            },
        )
    )
    props = await cid_to_properties(client, 702)
    assert props["SMILES"] == "CCO"
    assert props["InChIKey"] == "LFQSCWFLJHTTHZ-UHFFFAOYSA-N"
    assert props["MolecularFormula"] == "C2H6O"


@pytest.mark.asyncio
async def test_lookup_by_name_success():
    client = AsyncMock()
    client.get = AsyncMock(
        side_effect=[
            _mock_response(200, {"IdentifierList": {"CID": [702]}}),
            _mock_response(
                200,
                {
                    "PropertyTable": {
                        "Properties": [
                            {
                                "SMILES": "CCO",
                                "InChIKey": "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
                                "MolecularFormula": "C2H6O",
                                "MolecularWeight": "46.07",
                                "IUPACName": "ethanol",
                            }
                        ]
                    }
                },
            ),
        ]
    )
    result = await lookup_by_name(client, "ethanol")
    assert result["found"] is True
    assert result["cid"] == 702
    assert result["smiles"] == "CCO"
    assert result["formula"] == "C2H6O"
    assert "source_url" in result


@pytest.mark.asyncio
async def test_lookup_by_name_not_in_pubchem():
    client = AsyncMock()
    client.get = AsyncMock(return_value=_mock_response(404))
    result = await lookup_by_name(client, "made_up_xyz_42")
    assert result["found"] is False
    assert result["reason"] == "not_in_pubchem"


@pytest.mark.asyncio
async def test_lookup_by_name_500_raises():
    client = AsyncMock()
    client.get = AsyncMock(return_value=_mock_response(500, text="server error"))
    with pytest.raises(PubChemError):
        await lookup_by_name(client, "ethanol")


@pytest.mark.asyncio
async def test_lookup_by_cas_rejects_empty():
    client = AsyncMock()
    result = await lookup_by_cas(client, "")
    assert result["found"] is False
    assert result["reason"] == "empty_cas"


@pytest.mark.asyncio
async def test_lookup_by_cas_success():
    client = AsyncMock()
    client.get = AsyncMock(
        side_effect=[
            _mock_response(200, {"IdentifierList": {"CID": [702]}}),
            _mock_response(
                200,
                {
                    "PropertyTable": {
                        "Properties": [
                            {
                                "SMILES": "CCO",
                                "MolecularFormula": "C2H6O",
                            }
                        ]
                    }
                },
            ),
        ]
    )
    result = await lookup_by_cas(client, "64-17-5")
    assert result["found"] is True
    assert result["cas_input"] == "64-17-5"
    assert result["smiles"] == "CCO"


# ─── Optional: real integration test (opt-in) ──────────────────────


@pytest.mark.integration
@pytest.mark.asyncio
async def test_real_pubchem_ethanol():
    """
    Hits the live PubChem API. Run with:
        pytest -m integration tests/test_pubchem.py

    Skipped by default to keep the suite hermetic.
    """
    import httpx
    async with httpx.AsyncClient(timeout=15.0) as client:
        result = await lookup_by_name(client, "ethanol")
    assert result["found"] is True
    assert result["smiles"] == "CCO"
    assert result["cid"] == 702
