"""
ToxicityFlagger — rule-based scan for concerning structural motifs.

Lists curated from:
  - PAINS (Pan-Assay INterference compounds) filters
  - Brenk filter (Brenk et al, 2008)
  - EPA + ECHA priority lists
  - Common cosmetics-banned moieties

This is a FAST pre-screen — not a substitute for full toxicology
evaluation. A flag here means "human review required", not "definitely
toxic". A miss here means "no obvious red flags", not "definitely safe".

For real toxicity prediction, integrate ToxCast or train a model on
ChEMBL toxicity assays (Phase 4.5).
"""
from __future__ import annotations

from typing import Any

try:
    from rdkit import Chem
    _RDKIT = True
except ImportError:  # pragma: no cover
    Chem = None
    _RDKIT = False


# Each motif: (label, SMARTS pattern, severity, note)
TOXICITY_FILTERS: list[tuple[str, str, str, str]] = [
    # Reactive electrophiles
    ("alpha-haloketone", "[CX3](=O)[CH2;X4][F,Cl,Br,I]", "high",
     "α-haloketone — highly reactive alkylating agent."),
    ("epoxide", "[O;R1][C;R1][C;R1]", "high",
     "Epoxide — protein-reactive, often genotoxic."),
    ("aziridine", "[N;R1][C;R1][C;R1]", "high",
     "Aziridine — protein-reactive, sensitizer."),
    ("isocyanate", "N=C=O", "high",
     "Isocyanate — respiratory + skin sensitizer."),
    ("aldehyde", "[CX3H1](=O)[#6]", "medium",
     "Aldehyde — potential sensitizer (esp. formaldehyde-releasers)."),
    # Heavy-metal containing
    ("mercury_atom", "[Hg]", "high",
     "Mercury-containing — banned in cosmetics in most jurisdictions."),
    ("lead_atom", "[Pb]", "high",
     "Lead-containing — toxic, banned in cosmetics."),
    ("arsenic_atom", "[As]", "high",
     "Arsenic-containing — toxic, banned in cosmetics."),
    # Suspected hormone disruptors
    ("phthalate", "c1ccc(C(=O)OC)c(C(=O)OC)c1", "medium",
     "Phthalate diester — suspected endocrine disruptor; restricted in EU cosmetics."),
    # Quaternary ammoniums — ok in many products, flagged for review
    ("quaternary_ammonium_charged", "[N+;R0](C)(C)(C)C", "low",
     "Quaternary ammonium — generally safe but consider eye/skin irritation profile."),
    # Polycyclic aromatics
    ("polycyclic_aromatic", "c1ccc2ccccc2c1", "low",
     "Polycyclic aromatic — potential PAH; review combustion/contamination origin."),
]


class ToxicityFlagger:
    """Scan SMILES for known concerning substructures."""

    name = "toxicity_motif_scan"

    def __init__(self):
        if _RDKIT:
            self._compiled: list[tuple[str, "Chem.Mol", str, str]] = []
            for label, smarts, severity, note in TOXICITY_FILTERS:
                pat = Chem.MolFromSmarts(smarts)
                if pat is not None:
                    self._compiled.append((label, pat, severity, note))
        else:
            self._compiled = []

    def scan(self, smiles: str) -> dict[str, Any]:
        """
        Scan one SMILES for toxic motifs.

        Returns:
            {
              "valid": True,
              "smiles": "...",
              "flags": [{label, severity, note}, ...],
              "overall_severity": "high|medium|low|none",
              "method": "motif-scan"
            }
        """
        if not _RDKIT:
            return {"valid": False, "error": "rdkit_not_installed"}

        mol = Chem.MolFromSmiles(smiles) if isinstance(smiles, str) else None
        if mol is None:
            return {"valid": False, "error": "invalid_smiles", "smiles": smiles}

        flags = []
        for label, pat, severity, note in self._compiled:
            if mol.HasSubstructMatch(pat):
                flags.append({"label": label, "severity": severity, "note": note})

        if any(f["severity"] == "high" for f in flags):
            overall = "high"
        elif any(f["severity"] == "medium" for f in flags):
            overall = "medium"
        elif flags:
            overall = "low"
        else:
            overall = "none"

        return {
            "valid": True,
            "smiles": smiles,
            "flags": flags,
            "overall_severity": overall,
            "method": "motif-scan v1",
        }

    def scan_batch(self, smiles_list: list[str]) -> list[dict[str, Any]]:
        return [self.scan(s) for s in smiles_list]

    def scan_formula(self, components: list[dict]) -> dict[str, Any]:
        """
        Scan every component of a formula. Returns aggregated result.
        """
        flagged = []
        for c in components:
            smi = c.get("smiles") or (c.get("chem") or {}).get("smiles")
            if not smi:
                continue
            result = self.scan(smi)
            if result.get("flags"):
                flagged.append({
                    "ingredient": c.get("name_en"),
                    "percentage": c.get("percentage"),
                    **result,
                })
        worst = "none"
        for f in flagged:
            sev = f.get("overall_severity")
            if sev == "high":
                worst = "high"
                break
            if sev == "medium" and worst != "high":
                worst = "medium"
            elif sev == "low" and worst == "none":
                worst = "low"
        return {
            "components_scanned": len(components),
            "components_flagged": len(flagged),
            "overall_severity": worst,
            "flagged_ingredients": flagged,
        }
