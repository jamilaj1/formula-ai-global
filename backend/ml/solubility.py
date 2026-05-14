"""
ESOL solubility predictor (Delaney 2004, J. Chem. Inf. Comput. Sci.
44:1000-1005).

The ESOL closed-form equation predicts aqueous solubility (logS, mol/L)
from four RDKit-computable descriptors:

  logS = 0.16 - 0.63 * cLogP - 0.0062 * MW + 0.066 * RB - 0.74 * AP

where:
  cLogP = computed octanol-water partition (RDKit Crippen)
  MW    = molecular weight
  RB    = rotatable bonds
  AP    = aromatic proportion (aromatic atoms / heavy atoms)

This is a 20-year-old equation but still the standard baseline for
"how soluble is this compound" — used in industrial cosmetics, drug
discovery, and environmental modelling. Mean absolute error ≈ 0.83 log
units against experiments.

Why no neural net? The Delaney equation is closed-form, deterministic,
auditable, and trains on no proprietary data. For Phase 4 we'd rather
ship an explainable baseline than a black-box neural model.
"""
from __future__ import annotations

from typing import Any

try:
    from rdkit import Chem
    from rdkit.Chem import Crippen, Descriptors, Lipinski
    _RDKIT = True
except ImportError:  # pragma: no cover
    Chem = None
    Crippen = None
    Descriptors = None
    Lipinski = None
    _RDKIT = False


class SolubilityPredictor:
    """ESOL solubility predictor."""

    name = "esol"

    def __init__(self):
        # Delaney 2004 coefficients
        self.intercept = 0.16
        self.coef_clogp = -0.63
        self.coef_mw = -0.0062
        self.coef_rb = 0.066
        self.coef_ap = -0.74

    def predict(self, smiles: str) -> dict[str, Any]:
        """
        Predict aqueous solubility for a single molecule.

        Returns:
            {
              "valid": True,
              "smiles": "...",
              "log_s_mol_per_l": -2.3,
              "solubility_mg_per_l": 1500.0,
              "solubility_class": "soluble|moderately_soluble|sparingly_soluble|insoluble",
              "descriptors_used": {clogp, mw, rotatable_bonds, aromatic_proportion},
              "method": "ESOL (Delaney 2004)",
              "expected_mae_log_units": 0.83
            }
        """
        if not _RDKIT:
            return {"valid": False, "error": "rdkit_not_installed"}

        mol = Chem.MolFromSmiles(smiles) if isinstance(smiles, str) else None
        if mol is None:
            return {"valid": False, "error": "invalid_smiles", "smiles": smiles}

        clogp = Crippen.MolLogP(mol)
        mw = Descriptors.MolWt(mol)
        rb = Lipinski.NumRotatableBonds(mol)
        heavy = max(mol.GetNumHeavyAtoms(), 1)
        aromatic_atoms = sum(1 for a in mol.GetAtoms() if a.GetIsAromatic())
        ap = aromatic_atoms / heavy

        log_s = (
            self.intercept
            + self.coef_clogp * clogp
            + self.coef_mw * mw
            + self.coef_rb * rb
            + self.coef_ap * ap
        )
        # logS = log10(mol/L); convert to mg/L
        mol_per_l = 10 ** log_s
        mg_per_l = mol_per_l * mw * 1000  # mol/L * g/mol = g/L * 1000 = mg/L

        return {
            "valid": True,
            "smiles": smiles,
            "log_s_mol_per_l": round(log_s, 3),
            "solubility_mg_per_l": round(mg_per_l, 2),
            "solubility_class": _classify(log_s),
            "descriptors_used": {
                "clogp": round(clogp, 3),
                "mw": round(mw, 3),
                "rotatable_bonds": int(rb),
                "aromatic_proportion": round(ap, 3),
            },
            "method": "ESOL (Delaney 2004)",
            "expected_mae_log_units": 0.83,
        }

    def predict_batch(self, smiles_list: list[str]) -> list[dict[str, Any]]:
        return [self.predict(s) for s in smiles_list]


def _classify(log_s: float) -> str:
    # FDA/USP solubility tiers
    if log_s > 0:
        return "very_soluble"
    if log_s > -2:
        return "soluble"
    if log_s > -4:
        return "moderately_soluble"
    if log_s > -6:
        return "sparingly_soluble"
    return "practically_insoluble"
