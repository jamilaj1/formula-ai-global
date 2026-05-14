"""
chemistry.py — RDKit-powered molecular property calculations.

This module is the foundation of "real chemistry AI" — replacing LLM guesses
with computed values from the same algorithms PhD chemists use daily.

Every function is pure:
  - Input: a SMILES string (or list of them)
  - Output: a dict of properties OR {'valid': False, 'error': ...}
  - No I/O, no database, no FastAPI dependencies

This makes the module trivially testable and re-usable from any context
(API endpoint, background job, ETL pipeline).

Typical properties computed:
  - molecular_weight, exact_mass         — mass
  - formula                              — Hill-system chemical formula
  - logp                                 — Wildman-Crippen octanol/water partition
  - tpsa                                 — topological polar surface area (Å²)
  - h_bond_donors, h_bond_acceptors      — Lipinski H-bond counts
  - rotatable_bonds                      — flexibility
  - rings, aromatic_rings                — ring system summary
  - inchi, inchi_key                     — universal identifiers
  - lipinski_violations                  — Rule of Five (0 = drug-like)
  - smiles_canonical                     — normalized SMILES for indexing
"""
from typing import Any

try:
    from rdkit import Chem
    from rdkit.Chem import Descriptors, Lipinski, Crippen, rdMolDescriptors
    from rdkit.Chem.inchi import InchiToInchiKey, MolToInchi
    _RDKIT_AVAILABLE = True
except ImportError:  # pragma: no cover - environment-dependent
    Chem = None
    Descriptors = None
    Lipinski = None
    Crippen = None
    rdMolDescriptors = None
    InchiToInchiKey = None
    MolToInchi = None
    _RDKIT_AVAILABLE = False


def is_available() -> bool:
    """True iff RDKit imported successfully. Useful for /health checks."""
    return _RDKIT_AVAILABLE


def parse_smiles(smiles: str):
    """
    Parse a SMILES string to an RDKit Mol. Returns None on invalid input.
    """
    if not _RDKIT_AVAILABLE or not isinstance(smiles, str):
        return None
    s = smiles.strip()
    if not s:
        return None
    try:
        return Chem.MolFromSmiles(s)
    except Exception:
        return None


def _lipinski_violations(mol) -> int:
    """Lipinski's Rule of Five — number of violations (0 = drug-like)."""
    violations = 0
    if Descriptors.MolWt(mol) > 500:
        violations += 1
    if Crippen.MolLogP(mol) > 5:
        violations += 1
    if Lipinski.NumHDonors(mol) > 5:
        violations += 1
    if Lipinski.NumHAcceptors(mol) > 10:
        violations += 1
    return violations


def compute_properties(smiles: str) -> dict[str, Any]:
    """
    Compute molecular descriptors via RDKit.

    Returns a dict with:
      - valid: True | False
      - error: present iff valid=False
      - smiles_input, smiles_canonical, inchi, inchi_key
      - formula, molecular_weight, exact_mass
      - heavy_atom_count, h_bond_donors, h_bond_acceptors
      - rotatable_bonds, rings, aromatic_rings
      - tpsa, logp, fraction_csp3, lipinski_violations
    """
    if not _RDKIT_AVAILABLE:
        return {"valid": False, "error": "rdkit_not_installed"}

    mol = parse_smiles(smiles)
    if mol is None:
        return {"valid": False, "error": "invalid_smiles", "smiles_input": smiles}

    try:
        canonical = Chem.MolToSmiles(mol, canonical=True)
        inchi = MolToInchi(mol)
        inchi_key = InchiToInchiKey(inchi) if inchi else None
        formula = rdMolDescriptors.CalcMolFormula(mol)

        return {
            "valid": True,
            "smiles_input": smiles,
            "smiles_canonical": canonical,
            "inchi": inchi or None,
            "inchi_key": inchi_key,
            "formula": formula,
            "molecular_weight": round(Descriptors.MolWt(mol), 3),
            "exact_mass": round(Descriptors.ExactMolWt(mol), 4),
            "heavy_atom_count": Lipinski.HeavyAtomCount(mol),
            "h_bond_donors": Lipinski.NumHDonors(mol),
            "h_bond_acceptors": Lipinski.NumHAcceptors(mol),
            "rotatable_bonds": Lipinski.NumRotatableBonds(mol),
            "rings": mol.GetRingInfo().NumRings(),
            "aromatic_rings": Lipinski.NumAromaticRings(mol),
            "tpsa": round(Descriptors.TPSA(mol), 2),
            "logp": round(Crippen.MolLogP(mol), 3),
            "fraction_csp3": round(Lipinski.FractionCSP3(mol), 3),
            "lipinski_violations": _lipinski_violations(mol),
        }
    except Exception as e:  # pragma: no cover - defensive
        return {
            "valid": False,
            "error": f"computation_failed: {str(e)[:200]}",
            "smiles_input": smiles,
        }


def canonicalize(smiles: str) -> dict[str, Any]:
    """Validate + canonicalize a SMILES string. Lightweight."""
    if not _RDKIT_AVAILABLE:
        return {"valid": False, "error": "rdkit_not_installed"}

    mol = parse_smiles(smiles)
    if mol is None:
        return {"valid": False, "error": "invalid_smiles", "input": smiles}

    try:
        canonical = Chem.MolToSmiles(mol, canonical=True)
        inchi = MolToInchi(mol)
        return {
            "valid": True,
            "input": smiles,
            "canonical": canonical,
            "inchi_key": InchiToInchiKey(inchi) if inchi else None,
        }
    except Exception as e:  # pragma: no cover
        return {"valid": False, "error": f"computation_failed: {str(e)[:200]}"}


def compute_properties_batch(smiles_list: list[str]) -> list[dict[str, Any]]:
    """
    Batch version of compute_properties. Up to ~1000 items is fine; the
    HTTP layer caps it at 100 to keep request latency bounded.
    """
    return [compute_properties(s) for s in smiles_list]


def lipinski_check(smiles: str) -> dict[str, Any]:
    """
    Detailed Lipinski Rule of Five evaluation.

    Returns each of the four rules with its measured value and pass/fail,
    plus a `drug_like` boolean (true iff 0 violations).
    """
    if not _RDKIT_AVAILABLE:
        return {"valid": False, "error": "rdkit_not_installed"}

    mol = parse_smiles(smiles)
    if mol is None:
        return {"valid": False, "error": "invalid_smiles"}

    mw = Descriptors.MolWt(mol)
    logp = Crippen.MolLogP(mol)
    hbd = Lipinski.NumHDonors(mol)
    hba = Lipinski.NumHAcceptors(mol)

    rules = {
        "molecular_weight_le_500": {"value": round(mw, 2), "pass": mw <= 500},
        "logp_le_5": {"value": round(logp, 2), "pass": logp <= 5},
        "h_bond_donors_le_5": {"value": hbd, "pass": hbd <= 5},
        "h_bond_acceptors_le_10": {"value": hba, "pass": hba <= 10},
    }
    violations = sum(1 for r in rules.values() if not r["pass"])

    return {
        "valid": True,
        "drug_like": violations == 0,
        "violations": violations,
        "rules": rules,
    }
