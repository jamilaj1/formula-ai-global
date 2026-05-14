"""
Machine-learning predictors for chemistry properties.

Phase 4 ships with **pre-trained / closed-form** predictors so the
backend runs immediately without a training step:

  - SolubilityPredictor (ESOL, Delaney 2004 equation — no GPU needed)
  - StabilityPredictor  (RDKit-based heuristic on aggregate descriptors)
  - ToxicityFlagger     (rule-based scanner of known concerning motifs)

These are intentionally **transparent** (each prediction has a clear
formula or rule trace) so users and regulators can audit. Later phases
can swap in true ML models (e.g. ChemBERTa, GraphConv) behind the same
interface.
"""
from .solubility import SolubilityPredictor
from .stability import StabilityPredictor
from .toxicity import ToxicityFlagger

__all__ = ["SolubilityPredictor", "StabilityPredictor", "ToxicityFlagger"]
