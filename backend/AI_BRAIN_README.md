# Formula AI Brain — Engine Architecture

## What's new in v2

Six advanced engines that go far beyond a single LLM call:

| Engine | File | Purpose |
|---|---|---|
| **ChemicalSafetyEngine** | `safety_engine.py` | 6-dimensional safety check (forbidden pairs, thermal, toxicity, corrosive, explosive, PPE) |
| **SubstitutionEngine** | `substitution_engine.py` | Real economic variants with material swaps (4 grades × 7 functional categories) |
| **VirtualLaboratory** | `virtual_lab.py` | Predicts pH, viscosity, surface tension, stability, shelf life |
| **LearningEngine** | `learning_engine.py` | Cumulative rule extraction from user corrections |
| **KnowledgeGraph** | `knowledge_graph.py` | Conceptual relationships between chemicals/conditions |
| **FormulaAIBrainV2** | `brain_v2.py` | Orchestrator that wires all six engines |

## Bug fixes vs the original spec

The uploaded specification had several blocker bugs — all fixed in this implementation:

```diff
- # virtual_lab.py
- if oil_content > 20 ...        ❌ NameError: oil_content is not defined
+ if oil_components > 20 ...     ✅ properly summed before use

- # substitution_engine.py
- match = re.search(...)         ❌ NameError: re is not imported
+ import re                       ✅ added at top of module
+ match = re.search(...)

- # learning_engine.py
- # missing imports: datetime, json, hashlib, re, Tuple
+ from datetime import datetime
+ import json, hashlib, re
+ from typing import Tuple, ...
```

## Quick start

```python
from ai_brain.brain_v2 import FormulaAIBrainV2

brain = FormulaAIBrainV2()  # Supabase + Claude clients optional

result = brain.full_analysis(
    formula={
        "components": [
            {"name_en": "Sodium Laureth Sulfate", "percentage": "14%", "cas_number": "68585-34-2"},
            {"name_en": "Cocamidopropyl Betaine", "percentage": "4.5%", "cas_number": "61789-40-0"},
            {"name_en": "Glycerin", "percentage": "3%", "cas_number": "56-81-5"},
            {"name_en": "Citric Acid", "percentage": "0.3%", "cas_number": "77-92-9"},
            {"name_en": "Water", "percentage": "78.2%", "cas_number": "7732-18-5"}
        ]
    },
    region="africa_west",
    conditions={"temperature": 25, "mixing_speed": 500},
    context={"user_condition": "sensitive_skin"}
)

# result["safety"]            → 6-dimensional safety check
# result["simulation"]        → pH, viscosity, stability, shelf life
# result["economic_variants"] → 4 grades (laboratory/premium/industrial/economy)
# result["graph_suggestions"] → context-aware ingredient suggestions
```

## Database schema

Run `schema_v2.sql` after the original schema. It adds:

- `learning_rules` — accumulates rules from user feedback
- `knowledge_nodes` + `knowledge_edges` — graph storage
- `lab_simulations` — caches prediction results
- `substitution_plans` — caches generated variants
- `safety_reports` — full audit trail of every safety check

## Limitations to fix before scale

| Issue | Severity | Fix |
|---|---|---|
| Pricing data hardcoded (USD, ~2024) | Medium | Pull from supplier API quarterly |
| KnowledgeGraph has ~12 nodes | High | Auto-populate from formula corpus |
| pH model is simplified (Henderson-Hasselbalch only) | Medium | Add ionic activity coefficients |
| LearningEngine pattern matching is naive | High | Move to embeddings + similarity search |
| No async DB pool | Medium | Use `asyncpg` for high concurrency |
| No tests | Critical | pytest + 80%+ coverage before launch |

## Compatibility note

The original `brain.py` is **kept untouched** for backward compatibility. The new
engines live in `brain_v2.py` and can be wired in incrementally.
