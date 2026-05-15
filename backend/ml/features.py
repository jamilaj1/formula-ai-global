"""
features.py — molecular feature extraction for all ML models.

Two feature sets are exposed:

  • `descriptor_vector(smiles)` — 12 interpretable RDKit descriptors
    (MW, logP, TPSA, HBD, HBA, rotatable bonds, rings, aromatic atoms,
    heteroatoms, fraction sp3, halogens, formal charge).
    These are what humans understand and what we expose in the API.

  • `fingerprint_vector(smiles, n_bits=512)` — Morgan ECFP4 fingerprint
    as a fixed-length boolean vector. Better for blackbox models that
    need to learn substructure → property patterns.

  • `combined_vector(smiles)` — descriptors + fingerprint, used by most
    of our production models because it captures both interpretable
    "what is this molecule" signal and substructure context.

If RDKit isn't installed, every function returns None.
"""
from __future__ import annotations

from typing import Any

try:
    from rdkit import Chem
    from rdkit.Chem import (
        AllChem, Crippen, Descriptors, Lipinski, rdMolDescriptors,
    )
    _RDKIT = True
except ImportError:  # pragma: no cover
    Chem = AllChem = Crippen = Descriptors = Lipinski = rdMolDescriptors = None
    _RDKIT = False


# Canonical names matching the order produced by `descriptor_vector`.
DESCRIPTOR_NAMES = [
    "mw",                # molecular weight
    "logp",              # Crippen logP
    "tpsa",              # topological polar surface area
    "hbd",               # H-bond donors
    "hba",               # H-bond acceptors
    "rotatable_bonds",
    "rings",
    "aromatic_atoms",
    "heteroatoms",
    "fraction_sp3",
    "halogens",
    "formal_charge",
]


def _mol(smiles: str):
    if not _RDKIT or not smiles:
        return None
    return Chem.MolFromSmiles(smiles)


def descriptor_vector(smiles: str) -> list[float] | None:
    """Return a 12-element interpretable descriptor vector for `smiles`."""
    mol = _mol(smiles)
    if mol is None:
        return None
    halogens = sum(1 for a in mol.GetAtoms() if a.GetSymbol() in {"F", "Cl", "Br", "I"})
    heteroatoms = sum(1 for a in mol.GetAtoms() if a.GetSymbol() not in {"C", "H"})
    aromatic_atoms = sum(1 for a in mol.GetAtoms() if a.GetIsAromatic())
    return [
        float(Descriptors.MolWt(mol)),
        float(Crippen.MolLogP(mol)),
        float(rdMolDescriptors.CalcTPSA(mol)),
        float(Lipinski.NumHDonors(mol)),
        float(Lipinski.NumHAcceptors(mol)),
        float(Lipinski.NumRotatableBonds(mol)),
        float(rdMolDescriptors.CalcNumRings(mol)),
        float(aromatic_atoms),
        float(heteroatoms),
        float(rdMolDescriptors.CalcFractionCSP3(mol) or 0.0),
        float(halogens),
        float(Chem.GetFormalCharge(mol)),
    ]


def fingerprint_vector(smiles: str, n_bits: int = 512, radius: int = 2) -> list[int] | None:
    """Return a Morgan ECFP4 fingerprint as a list of 0/1 ints."""
    mol = _mol(smiles)
    if mol is None:
        return None
    fp = AllChem.GetMorganFingerprintAsBitVect(mol, radius=radius, nBits=n_bits)
    return list(fp)


def combined_vector(smiles: str, n_bits: int = 512) -> list[float] | None:
    """Descriptors (12) + Morgan fingerprint (n_bits). Returns None on failure."""
    desc = descriptor_vector(smiles)
    if desc is None:
        return None
    fp = fingerprint_vector(smiles, n_bits=n_bits)
    if fp is None:
        return None
    return desc + [float(x) for x in fp]


def feature_metadata(n_bits: int = 512) -> dict[str, Any]:
    """Describe the combined feature vector for model metadata."""
    return {
        "descriptor_count": len(DESCRIPTOR_NAMES),
        "descriptor_names": list(DESCRIPTOR_NAMES),
        "fingerprint_bits": n_bits,
        "fingerprint_radius": 2,
        "total_features": len(DESCRIPTOR_NAMES) + n_bits,
    }
