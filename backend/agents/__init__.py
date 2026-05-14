"""
Multi-agent reasoning layer.

Six specialised agents coordinated by an orchestrator. Each agent owns a
narrow domain and uses Claude with a focused system prompt + the right
tools from `services/`. The orchestrator decides which agents to consult
for a given request and weaves their outputs into a single answer with
a transparent reasoning chain.

Agent roster:
  - FormulatorAgent  — proposes ingredient lists balanced to 100%
  - SafetyAgent      — GHS classifications + interaction warnings
  - CostAgent        — batch-level cost from ingredient_prices
  - StabilityAgent   — shelf-life prediction from chem properties
  - RegulatoryAgent  — region-specific compliance (FDA/REACH/SFDA/GSO)
  - Orchestrator     — ties them together
"""
from .orchestrator import Orchestrator
from .formulator import FormulatorAgent
from .safety import SafetyAgent
from .cost import CostAgent
from .stability import StabilityAgent
from .regulatory import RegulatoryAgent

__all__ = [
    "Orchestrator",
    "FormulatorAgent",
    "SafetyAgent",
    "CostAgent",
    "StabilityAgent",
    "RegulatoryAgent",
]
