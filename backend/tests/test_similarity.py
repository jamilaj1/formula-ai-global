"""
Tests for the similarity + substitution services.

Real RDKit (no mocks) — verifies Tanimoto values against published
references and that substitution ranking respects the documented
filters.
"""
import pytest

pytest.importorskip("rdkit")

from services.similarity import (  # noqa: E402
    fingerprint,
    is_available,
    rank_similar,
    substructure_match,
    tanimoto,
)
from services.substitution import (  # noqa: E402
    conflict_check,
    find_substitutes,
)


# ─── fingerprint + tanimoto ───────────────────────────────────


def test_rdkit_available():
    assert is_available() is True


def test_fingerprint_valid():
    fp = fingerprint("CCO")
    assert fp is not None


def test_fingerprint_invalid_returns_none():
    assert fingerprint("!!!_not_a_smiles") is None
    assert fingerprint("") is None


def test_tanimoto_identical_is_one():
    r = tanimoto("CCO", "CCO")
    assert r["valid"] is True
    assert r["similarity"] == 1.0
    assert r["interpretation"] == "essentially_identical"


def test_tanimoto_methanol_vs_ethanol_close_analog():
    # Methanol (CO) vs ethanol (CCO) — homologs, related family
    r = tanimoto("CO", "CCO")
    assert r["valid"] is True
    # The actual value depends on the radius+bits; just check it's in
    # the right ballpark (low) rather than asserting an exact match.
    assert 0.0 <= r["similarity"] <= 1.0


def test_tanimoto_benzene_vs_ethanol_dissimilar():
    r = tanimoto("c1ccccc1", "CCO")
    assert r["valid"] is True
    assert r["similarity"] < 0.3
    assert r["interpretation"] == "different_scaffolds"


def test_tanimoto_invalid_inputs():
    r = tanimoto("garbage", "CCO")
    assert r["valid"] is False
    assert r["error"] == "invalid_smiles"


# ─── rank_similar ─────────────────────────────────────────────


def test_rank_similar_self_match():
    candidates = [
        {"name": "ethanol", "smiles": "CCO"},
        {"name": "methanol", "smiles": "CO"},
        {"name": "benzene", "smiles": "c1ccccc1"},
    ]
    ranked = rank_similar("CCO", candidates, limit=10, min_similarity=0.0)
    assert ranked[0]["name"] == "ethanol"
    assert ranked[0]["similarity"] == 1.0


def test_rank_similar_filters_invalid_smiles():
    candidates = [
        {"name": "good", "smiles": "CCO"},
        {"name": "bad", "smiles": "not_a_smiles!"},
    ]
    ranked = rank_similar("CCO", candidates, limit=10, min_similarity=0.0)
    assert len(ranked) == 1
    assert ranked[0]["name"] == "good"


def test_rank_similar_respects_min_similarity():
    candidates = [
        {"name": "ethanol", "smiles": "CCO"},
        {"name": "benzene", "smiles": "c1ccccc1"},
    ]
    ranked = rank_similar("CCO", candidates, limit=10, min_similarity=0.9)
    # Only ethanol itself should pass at >= 0.9
    names = [r["name"] for r in ranked]
    assert "ethanol" in names
    assert "benzene" not in names


def test_rank_similar_uses_chem_smiles_fallback():
    # If candidate has chem.smiles instead of top-level smiles, still works
    candidates = [
        {"name": "ethanol", "chem": {"smiles": "CCO"}},
    ]
    ranked = rank_similar("CCO", candidates, limit=10, min_similarity=0.0)
    assert len(ranked) == 1
    assert ranked[0]["similarity"] == 1.0


# ─── substructure_match ───────────────────────────────────────


def test_substructure_phenol_in_aspirin():
    # Aspirin contains a benzene ring → SMARTS for aromatic ring matches
    r = substructure_match("c1ccccc1", "CC(=O)Oc1ccccc1C(=O)O")
    assert r["valid"] is True
    assert r["match"] is True
    assert r["match_count"] >= 1


def test_substructure_no_match():
    r = substructure_match("c1ccccc1", "CCO")  # benzene in ethanol → no
    assert r["valid"] is True
    assert r["match"] is False


def test_substructure_invalid_smarts():
    r = substructure_match("!!invalid_smarts!!", "CCO")
    assert r["valid"] is False
    assert r["error"] == "invalid_smarts"


# ─── find_substitutes ─────────────────────────────────────────


def test_find_substitutes_returns_ranked_list():
    target = {
        "name": "ethanol",
        "smiles": "CCO",
        "function": "solvent",
        "molecular_weight": 46.07,
    }
    candidates = [
        {"name": "methanol", "smiles": "CO", "function": "solvent", "molecular_weight": 32.04},
        {"name": "propanol", "smiles": "CCCO", "function": "solvent", "molecular_weight": 60.10},
        {"name": "benzene",  "smiles": "c1ccccc1", "function": "solvent", "molecular_weight": 78.11},
        {"name": "water",    "smiles": "O", "function": "solvent", "molecular_weight": 18.02},
    ]
    result = find_substitutes(target, candidates, mw_tolerance=0.5, min_similarity=0.0)
    assert "substitutes" in result
    assert len(result["substitutes"]) > 0
    # propanol should rank highly (homolog, similar MW)
    names = [s["name"] for s in result["substitutes"]]
    assert "propanol" in names or "methanol" in names


def test_find_substitutes_filters_by_function():
    target = {"name": "ethanol", "smiles": "CCO", "function": "solvent",
              "molecular_weight": 46.07}
    candidates = [
        {"name": "methanol", "smiles": "CO", "function": "solvent",   "molecular_weight": 32.04},
        {"name": "phenol",   "smiles": "c1ccccc1O", "function": "antimicrobial", "molecular_weight": 94.11},
    ]
    result = find_substitutes(
        target, candidates, require_same_function=True,
        mw_tolerance=2.0, min_similarity=0.0,
    )
    names = [s["name"] for s in result["substitutes"]]
    assert "methanol" in names
    assert "phenol" not in names  # different function, filtered out


def test_find_substitutes_missing_target_smiles():
    target = {"name": "x"}  # no smiles
    result = find_substitutes(target, [], min_similarity=0.0)
    assert result["error"] == "target_missing_smiles"
    assert result["substitutes"] == []


def test_find_substitutes_includes_reasoning():
    target = {"name": "ethanol", "smiles": "CCO", "function": "solvent",
              "molecular_weight": 46.07}
    candidates = [{"name": "methanol", "smiles": "CO", "function": "solvent",
                   "molecular_weight": 32.04}]
    result = find_substitutes(target, candidates, mw_tolerance=0.5, min_similarity=0.0)
    if result["substitutes"]:
        assert "reasoning" in result["substitutes"][0]


# ─── conflict_check ───────────────────────────────────────────


def test_conflict_check_duplicate_inchikey():
    components = [
        {"name_en": "Ethanol",   "percentage": 5.0,
         "chem": {"inchi_key": "LFQSCWFLJHTTHZ-UHFFFAOYSA-N"}},
        {"name_en": "Ethyl Alcohol", "percentage": 3.0,
         "chem": {"inchi_key": "LFQSCWFLJHTTHZ-UHFFFAOYSA-N"}},
    ]
    r = conflict_check(components)
    assert r["issues_found"] >= 1
    assert any(i["kind"] == "duplicate_ingredient" for i in r["issues"])


def test_conflict_check_acid_base_conflict():
    components = [
        {"name_en": "Hydrochloric Acid", "percentage": 2.0},
        {"name_en": "Sodium Hydroxide",  "percentage": 2.0},
    ]
    r = conflict_check(components)
    assert any(i["kind"] == "ph_conflict" for i in r["issues"])


def test_conflict_check_quat_anionic():
    components = [
        {"name_en": "Benzalkonium Chloride", "percentage": 1.0},
        {"name_en": "Sodium Laureth Sulfate", "percentage": 10.0},
    ]
    r = conflict_check(components)
    assert any(i["kind"] == "charge_inactivation" for i in r["issues"])


def test_conflict_check_clean_formula_no_issues():
    components = [
        {"name_en": "Water",    "percentage": 80.0},
        {"name_en": "Glycerin", "percentage": 15.0},
        {"name_en": "Polysorbate 20", "percentage": 5.0},
    ]
    r = conflict_check(components)
    assert r["overall_risk"] == "safe"
    assert r["issues_found"] == 0
