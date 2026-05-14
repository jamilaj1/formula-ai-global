"""
similarity.py — structural similarity + substructure matching.

Built on RDKit Morgan fingerprints (Tanimoto coefficient). This is the
standard cheminformatics technique used by PubChem, ChEMBL, and every
academic similarity search.

Two compounds with Tanimoto similarity:
  > 0.9   → essentially the same molecule (different counter-ions, salts)
  0.7-0.9 → close analogs (similar function, swap-candidates)
  0.4-0.7 → loosely related family
  < 0.4   → different scaffolds

For substitution: we typically want >= 0.5 with matching `function` field
(surfactant, preservative, fragrance, etc.).
"""
from __future__ import annotations

from typing import Any

try:
    from rdkit import Chem, DataStructs
    from rdkit.Chem import AllChem
    _RDKIT_AVAILABLE = True
except ImportError:  # pragma: no cover
    Chem = None
    DataStructs = None
    AllChem = None
    _RDKIT_AVAILABLE = False


# Standard fingerprint parameters used across cheminformatics:
#   radius=2  ≈ ECFP4 (4-bond environment)
#   nBits=2048 = good balance of resolution vs memory
FP_RADIUS = 2
FP_BITS = 2048


def is_available() -> bool:
    return _RDKIT_AVAILABLE


def fingerprint(smiles: str):
    """Compute a Morgan (circular) fingerprint. Returns None on invalid input."""
    if not _RDKIT_AVAILABLE or not isinstance(smiles, str) or not smiles.strip():
        return None
    mol = Chem.MolFromSmiles(smiles.strip())
    if mol is None:
        return None
    return AllChem.GetMorganFingerprintAsBitVect(mol, FP_RADIUS, nBits=FP_BITS)


def tanimoto(smiles_a: str, smiles_b: str) -> dict[str, Any]:
    """
    Compute Tanimoto similarity between two molecules.

    Returns:
        {'similarity': 0.0-1.0, 'valid': bool, ...}
    """
    if not _RDKIT_AVAILABLE:
        return {"valid": False, "error": "rdkit_not_installed"}

    fp_a = fingerprint(smiles_a)
    fp_b = fingerprint(smiles_b)
    if fp_a is None or fp_b is None:
        return {
            "valid": False,
            "error": "invalid_smiles",
            "a_valid": fp_a is not None,
            "b_valid": fp_b is not None,
        }
    sim = float(DataStructs.TanimotoSimilarity(fp_a, fp_b))
    return {
        "valid": True,
        "similarity": round(sim, 4),
        "interpretation": _interpret_similarity(sim),
        "a": smiles_a,
        "b": smiles_b,
    }


def _interpret_similarity(s: float) -> str:
    if s >= 0.9:
        return "essentially_identical"
    if s >= 0.7:
        return "close_analog"
    if s >= 0.4:
        return "related_family"
    return "different_scaffolds"


def rank_similar(query_smiles: str, candidates: list[dict[str, Any]], *,
                 limit: int = 20, min_similarity: float = 0.3) -> list[dict[str, Any]]:
    """
    Score `candidates` (each with at least a `smiles` field) against
    `query_smiles` and return them sorted by Tanimoto descending.

    Candidates with invalid SMILES are skipped. Candidates below
    `min_similarity` are dropped.

    Returns a new list — does not mutate input.
    """
    if not _RDKIT_AVAILABLE:
        return []

    q_fp = fingerprint(query_smiles)
    if q_fp is None:
        return []

    scored: list[tuple[float, dict[str, Any]]] = []
    for c in candidates:
        smi = c.get("smiles") or (c.get("chem") or {}).get("smiles")
        if not smi:
            continue
        c_fp = fingerprint(smi)
        if c_fp is None:
            continue
        sim = float(DataStructs.TanimotoSimilarity(q_fp, c_fp))
        if sim < min_similarity:
            continue
        scored.append((sim, {**c, "similarity": round(sim, 4),
                             "interpretation": _interpret_similarity(sim)}))

    scored.sort(key=lambda t: t[0], reverse=True)
    return [row for _, row in scored[:limit]]


def substructure_match(query_smarts: str, smiles: str) -> dict[str, Any]:
    """
    Test whether `smiles` contains the SMARTS substructure pattern
    `query_smarts`. Useful for "find me all formulas containing a
    quaternary ammonium" etc.
    """
    if not _RDKIT_AVAILABLE:
        return {"valid": False, "error": "rdkit_not_installed"}

    pattern = Chem.MolFromSmarts(query_smarts)
    if pattern is None:
        return {"valid": False, "error": "invalid_smarts"}
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"valid": False, "error": "invalid_smiles"}

    matches = mol.GetSubstructMatches(pattern)
    return {
        "valid": True,
        "match": len(matches) > 0,
        "match_count": len(matches),
        "atom_indices": [list(m) for m in matches][:10],
    }
