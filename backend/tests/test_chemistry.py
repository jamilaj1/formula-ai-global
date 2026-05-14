"""
Tests for the RDKit-powered chemistry service.

These are real RDKit tests (not mocked) — they verify computed values
against published physical-chemistry references. If RDKit isn't installed
in the environment, the entire module is skipped so the rest of the
suite still passes.

Why no mocks: the whole point of this layer is that it produces values
matching published literature. Mocking RDKit defeats the purpose.
"""
import pytest

# Skip the whole module if RDKit isn't installed.
pytest.importorskip("rdkit")

from services.chemistry import (  # noqa: E402  (deliberate order: skip-first)
    is_available,
    compute_properties,
    compute_properties_batch,
    canonicalize,
    lipinski_check,
    parse_smiles,
)


# ─── is_available ─────────────────────────────────────────────────


def test_rdkit_is_available_when_installed():
    assert is_available() is True


# ─── parse_smiles ─────────────────────────────────────────────────


def test_parse_valid_smiles():
    mol = parse_smiles("CCO")
    assert mol is not None


def test_parse_invalid_smiles_returns_none():
    assert parse_smiles("!!!_not_a_smiles") is None


def test_parse_empty_returns_none():
    assert parse_smiles("") is None
    assert parse_smiles("   ") is None
    assert parse_smiles(None) is None  # type: ignore[arg-type]


# ─── compute_properties: ethanol (CCO) ────────────────────────────
# Reference: PubChem CID 702. MW=46.07, logP=-0.31, HBD=1, HBA=1.


def test_ethanol_basic_properties():
    r = compute_properties("CCO")
    assert r["valid"] is True
    assert r["formula"] == "C2H6O"
    assert 45.0 < r["molecular_weight"] < 47.0
    assert r["heavy_atom_count"] == 3


def test_ethanol_hbond_counts():
    r = compute_properties("CCO")
    assert r["h_bond_donors"] == 1
    assert r["h_bond_acceptors"] == 1


def test_ethanol_is_drug_like():
    r = compute_properties("CCO")
    assert r["lipinski_violations"] == 0


# ─── compute_properties: benzene (c1ccccc1) ───────────────────────


def test_benzene_aromatic_ring_detection():
    r = compute_properties("c1ccccc1")
    assert r["valid"] is True
    assert r["formula"] == "C6H6"
    assert r["aromatic_rings"] == 1
    assert r["rings"] == 1
    assert r["h_bond_donors"] == 0


# ─── compute_properties: aspirin (CC(=O)Oc1ccccc1C(=O)O) ──────────
# Reference: PubChem CID 2244. MW=180.16.


def test_aspirin_properties():
    r = compute_properties("CC(=O)Oc1ccccc1C(=O)O")
    assert r["valid"] is True
    assert r["formula"] == "C9H8O4"
    assert 179.0 < r["molecular_weight"] < 181.0
    assert r["aromatic_rings"] == 1


# ─── compute_properties: invalid inputs ────────────────────────────


def test_invalid_smiles_returns_error_dict():
    r = compute_properties("NOT_A_SMILES_!!!")
    assert r["valid"] is False
    assert r["error"] == "invalid_smiles"
    assert r["smiles_input"] == "NOT_A_SMILES_!!!"


def test_empty_smiles_returns_error():
    r = compute_properties("")
    assert r["valid"] is False
    assert "error" in r


# ─── canonicalize ─────────────────────────────────────────────────


def test_canonicalize_normalizes_smiles():
    """OCC and CCO are the same molecule — both should canonicalize to CCO."""
    r1 = canonicalize("OCC")
    r2 = canonicalize("CCO")
    assert r1["valid"] is True
    assert r2["valid"] is True
    assert r1["canonical"] == r2["canonical"]


def test_canonicalize_returns_inchi_key():
    r = canonicalize("CCO")
    assert r["inchi_key"] is not None
    assert len(r["inchi_key"]) == 27  # InChI keys are always 27 chars


def test_canonicalize_invalid():
    r = canonicalize("garbage_!@#")
    assert r["valid"] is False


# ─── lipinski_check ───────────────────────────────────────────────


def test_lipinski_ethanol_is_drug_like():
    r = lipinski_check("CCO")
    assert r["valid"] is True
    assert r["drug_like"] is True
    assert r["violations"] == 0
    assert all(rule["pass"] for rule in r["rules"].values())


def test_lipinski_returns_each_rule():
    r = lipinski_check("CCO")
    expected_rules = {
        "molecular_weight_le_500",
        "logp_le_5",
        "h_bond_donors_le_5",
        "h_bond_acceptors_le_10",
    }
    assert set(r["rules"].keys()) == expected_rules


def test_lipinski_invalid_smiles():
    r = lipinski_check("xyz_not_a_compound")
    assert r["valid"] is False


# ─── compute_properties_batch ──────────────────────────────────────


def test_batch_handles_mix_of_valid_and_invalid():
    results = compute_properties_batch(["CCO", "c1ccccc1", "INVALID_!!!"])
    assert len(results) == 3
    assert results[0]["valid"] is True
    assert results[1]["valid"] is True
    assert results[2]["valid"] is False


def test_batch_preserves_order():
    inputs = ["CCO", "CC(=O)O", "CCCC"]
    results = compute_properties_batch(inputs)
    for i, r in enumerate(results):
        assert r["smiles_input"] == inputs[i]


def test_batch_empty_list():
    assert compute_properties_batch([]) == []


# ─── Determinism (same input → same output) ────────────────────────


def test_same_smiles_produces_same_canonical_form():
    r1 = compute_properties("CCO")
    r2 = compute_properties("CCO")
    assert r1["smiles_canonical"] == r2["smiles_canonical"]
    assert r1["inchi_key"] == r2["inchi_key"]
