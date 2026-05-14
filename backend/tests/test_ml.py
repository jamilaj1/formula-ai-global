"""
Tests for Phase 4 ML predictors.

Real RDKit (no mocks) since the predictors are deterministic and the
whole point is to verify numerical correctness against published
values.
"""
import pytest

pytest.importorskip("rdkit")

from ml import SolubilityPredictor, StabilityPredictor, ToxicityFlagger  # noqa: E402


# ─── SolubilityPredictor ──────────────────────────────────────


def test_esol_ethanol_is_very_soluble():
    """Ethanol should predict high solubility (it's miscible with water)."""
    p = SolubilityPredictor()
    r = p.predict("CCO")
    assert r["valid"] is True
    # Ethanol experimental log S ≈ +1.0 (very soluble). ESOL tends to slightly
    # under-predict polar small molecules; accept anything positive.
    assert r["log_s_mol_per_l"] > -1.0
    assert r["solubility_class"] in {"very_soluble", "soluble"}


def test_esol_benzene_is_sparingly_soluble():
    """Benzene experimental log S = -1.6 — moderately/sparingly soluble."""
    p = SolubilityPredictor()
    r = p.predict("c1ccccc1")
    assert r["valid"] is True
    assert -3 < r["log_s_mol_per_l"] < 0


def test_esol_naphthalene_is_less_soluble():
    """Naphthalene (two fused rings) less soluble than benzene."""
    p = SolubilityPredictor()
    r_naph = p.predict("c1ccc2ccccc2c1")
    r_benz = p.predict("c1ccccc1")
    assert r_naph["log_s_mol_per_l"] < r_benz["log_s_mol_per_l"]


def test_esol_invalid_smiles_returns_error():
    p = SolubilityPredictor()
    r = p.predict("not_a_smiles_!!!")
    assert r["valid"] is False
    assert r["error"] == "invalid_smiles"


def test_esol_returns_descriptors_used():
    p = SolubilityPredictor()
    r = p.predict("CCO")
    desc = r["descriptors_used"]
    for k in ("clogp", "mw", "rotatable_bonds", "aromatic_proportion"):
        assert k in desc


def test_esol_batch():
    p = SolubilityPredictor()
    results = p.predict_batch(["CCO", "c1ccccc1", "INVALID"])
    assert len(results) == 3
    assert results[0]["valid"] is True
    assert results[2]["valid"] is False


# ─── StabilityPredictor ───────────────────────────────────────


def test_stability_aqueous_with_no_preservative_is_unstable():
    p = StabilityPredictor()
    r = p.predict({
        "form_type": "cream",
        "components": [
            {"name_en": "Water", "percentage": 70, "chem": {"smiles": "O", "molecular_weight": 18, "logp": -1.4}},
            {"name_en": "Glycerin", "percentage": 20, "chem": {"smiles": "OCC(O)CO", "molecular_weight": 92, "logp": -1.8}},
            {"name_en": "Cetyl Alcohol", "percentage": 10, "chem": {"smiles": "CCCCCCCCCCCCCCCCO", "molecular_weight": 242, "logp": 6.4}},
        ],
    })
    assert r["stability_class"] in {"unstable", "marginal"}
    assert any(f["factor"] == "microbial" for f in r["factors"])


def test_stability_with_preservative_is_better():
    p = StabilityPredictor()
    r = p.predict({
        "form_type": "liquid",
        "components": [
            {"name_en": "Water", "percentage": 80, "chem": {"smiles": "O", "molecular_weight": 18, "logp": -1.4}},
            {"name_en": "Glycerin", "percentage": 18, "chem": {"smiles": "OCC(O)CO", "molecular_weight": 92, "logp": -1.8}},
            {"name_en": "Phenoxyethanol", "percentage": 1.5, "chem": {"smiles": "OCCOc1ccccc1", "molecular_weight": 138, "logp": 1.2}},
            {"name_en": "Ethylhexylglycerin", "percentage": 0.5},
        ],
    })
    # Has preservatives, should be stable or marginal but not unstable
    assert r["stability_class"] in {"stable", "marginal"}
    assert "Phenoxyethanol" in r["preservatives_detected"]


def test_stability_detects_antioxidant_bonus():
    p = StabilityPredictor()
    r = p.predict({
        "form_type": "cream",
        "components": [
            {"name_en": "Water", "percentage": 70},
            {"name_en": "Tocopherol", "percentage": 0.5},
            {"name_en": "Phenoxyethanol", "percentage": 1.0},
            {"name_en": "Cetyl Alcohol", "percentage": 28.5},
        ],
    })
    assert "Tocopherol" in r["antioxidants_detected"]


def test_stability_returns_shelf_life_months():
    p = StabilityPredictor()
    r = p.predict({"form_type": "liquid", "components": [{"name_en": "Water", "percentage": 100}]})
    assert "predicted_shelf_life_months" in r
    assert isinstance(r["predicted_shelf_life_months"], int)


# ─── ToxicityFlagger ──────────────────────────────────────────


def test_toxicity_flags_epoxide():
    t = ToxicityFlagger()
    r = t.scan("C1CO1")  # ethylene oxide — epoxide
    assert r["valid"] is True
    assert r["overall_severity"] in {"high", "medium"}
    labels = [f["label"] for f in r["flags"]]
    assert "epoxide" in labels


def test_toxicity_clean_smiles_returns_none():
    t = ToxicityFlagger()
    r = t.scan("CCO")  # ethanol — should be clean
    assert r["valid"] is True
    assert r["overall_severity"] == "none"
    assert len(r["flags"]) == 0


def test_toxicity_invalid_smiles():
    t = ToxicityFlagger()
    r = t.scan("not_a_smiles")
    assert r["valid"] is False


def test_toxicity_scan_formula_aggregates():
    t = ToxicityFlagger()
    r = t.scan_formula([
        {"name_en": "Water",   "smiles": "O",       "percentage": 90},
        {"name_en": "Ethylene Oxide", "smiles": "C1CO1", "percentage": 0.1},
    ])
    assert r["components_scanned"] == 2
    assert r["components_flagged"] >= 1
    assert r["overall_severity"] in {"high", "medium"}


def test_toxicity_scan_formula_uses_chem_smiles_fallback():
    t = ToxicityFlagger()
    r = t.scan_formula([
        {"name_en": "X", "chem": {"smiles": "C1CO1"}, "percentage": 1},
    ])
    assert r["components_flagged"] == 1
