"""
ChemicalSafetyEngine — advanced 6-check safety analyzer.

This is the upgraded version of safety_checker.py. It detects forbidden
chemical pairs, thermal decomposition risks, cumulative toxicity,
corrosivity, explosive potential, and recommends PPE/storage/disposal.

Data sources: OSHA 29 CFR · EPA · NFPA · IARC · GHS · UN Hazmat
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple, Set


class RiskLevel(Enum):
    SAFE = "safe"
    CAUTION = "caution"
    WARNING = "warning"
    DANGEROUS = "dangerous"
    DEADLY = "deadly"


@dataclass
class ChemicalRisk:
    level: RiskLevel
    category: str
    description: str
    arabic_description: str
    affected_components: List[str]
    recommended_action: str
    reference_source: str


@dataclass
class SafetyReport:
    is_safe: bool
    overall_risk: RiskLevel
    max_safe_temperature: float
    risks: List[ChemicalRisk]
    pH_range: Tuple[float, float]
    flash_point: Optional[float]
    incompatible_pairs: List[Tuple[str, str]]
    required_PPE: List[str]
    storage_conditions: Dict[str, str]
    disposal_method: str
    emergency_procedure: str


class ChemicalSafetyEngine:
    """6-dimensional safety analyzer with regulatory citation."""

    def __init__(self) -> None:
        self.forbidden_pairs: List[Tuple[Set[str], Set[str], RiskLevel, str, str, str]] = []
        self.thermal_limits: Dict[str, Dict] = {}
        self.toxic_data: Dict[str, Dict] = {}
        self.corrosive_data: Dict[str, Dict] = {}
        self.explosive_data: Dict[str, Dict] = {}
        self.ppe_requirements: Dict[str, List[str]] = {}
        self._load_all_data()

    # ──────────────────────────────────────────────────────────────
    # Data loaders
    # ──────────────────────────────────────────────────────────────
    def _load_all_data(self) -> None:
        self._load_forbidden_pairs()
        self._load_thermal_limits()
        self._load_toxic_data()
        self._load_corrosive_data()
        self._load_explosive_data()
        self._load_ppe_requirements()

    def _load_forbidden_pairs(self) -> None:
        self.forbidden_pairs = [
            (
                {"ammonia", "ammonium hydroxide", "nh4oh", "ammonium"},
                {"bleach", "sodium hypochlorite", "hypochlorite", "naocl", "chlorine"},
                RiskLevel.DEADLY,
                "Chloramine gas formation — causes respiratory failure and death",
                "غاز الكلورامين — يسبب فشل تنفسي وموت فوري",
                "OSHA 29 CFR 1910.1000",
            ),
            (
                {"acid", "acetic acid", "citric acid", "hydrochloric acid", "hcl", "sulfuric acid"},
                {"bleach", "sodium hypochlorite", "hypochlorite", "naocl"},
                RiskLevel.DEADLY,
                "Chlorine gas release — causes severe lung damage",
                "تحرر غاز الكلور — يسبب تلفاً رئوياً شديداً",
                "EPA Emergency Response",
            ),
            (
                {"hydrogen peroxide", "h2o2", "peroxide"},
                {"acetone", "organic solvents", "alcohols", "ketone"},
                RiskLevel.DANGEROUS,
                "Organic peroxide formation — highly explosive when concentrated",
                "تكوين بيروكسيد عضوي — متفجر جداً عند التركيز",
                "NFPA 432",
            ),
            (
                {"nitric acid"},
                {"organic compounds", "alcohols", "acetone", "ethers"},
                RiskLevel.DANGEROUS,
                "Nitration reaction — can cause spontaneous explosion",
                "تفاعل النترة — قد يسبب انفجاراً تلقائياً",
                "Chemical Safety Board",
            ),
            (
                {"sodium", "potassium", "lithium", "alkali metals"},
                {"water", "h2o", "moisture"},
                RiskLevel.DANGEROUS,
                "Violent reaction producing hydrogen gas and fire",
                "تفاعل عنيف ينتج غاز الهيدروجين وحرائق",
                "NFPA 484",
            ),
            (
                {"oxidizer", "peroxide", "nitrate", "chlorate"},
                {"flammable", "organic", "solvent", "alcohol"},
                RiskLevel.DANGEROUS,
                "Fire and explosion hazard — oxidizers accelerate combustion",
                "خطر حريق وانفجار — المؤكسدات تسرع الاحتراق",
                "DOT Hazardous Materials",
            ),
            (
                {"anionic surfactant", "sles", "sls", "sodium lauryl sulfate"},
                {"cationic surfactant", "cetrimonium", "behentrimonium"},
                RiskLevel.WARNING,
                "Formation of insoluble complex — reduces effectiveness",
                "تكوين معقد غير قابل للذوبان — يقلل الفعالية",
                "Surfactant Science Handbook",
            ),
            (
                {"formaldehyde", "formalin"},
                {"ammonia", "ammonium"},
                RiskLevel.WARNING,
                "Hexamethylenetetramine formation — potential carcinogen",
                "تكوين هيكساميثيلينتترامين — مادة مسرطنة محتملة",
                "IARC Monographs",
            ),
        ]

    def _load_thermal_limits(self) -> None:
        self.thermal_limits = {
            "hydrogen peroxide": {"decomp_temp": 60, "hazard": "explosive_decomposition"},
            "sodium hypochlorite": {"decomp_temp": 50, "hazard": "chlorine_release"},
            "ammonium nitrate": {"decomp_temp": 170, "hazard": "explosion"},
            "organic peroxides": {"decomp_temp": 40, "hazard": "explosion"},
            "nitrocellulose": {"decomp_temp": 160, "hazard": "autoignition"},
            "sulfuric acid": {"decomp_temp": 340, "hazard": "dehydration"},
            "sles": {"decomp_temp": 95, "hazard": "hydrolysis"},
            "sls": {"decomp_temp": 90, "hazard": "hydrolysis"},
            "cocamidopropyl betaine": {"decomp_temp": 100, "hazard": "degradation"},
            "glycerin": {"decomp_temp": 290, "hazard": "decomposition"},
            "citric acid": {"decomp_temp": 175, "hazard": "decomposition"},
        }

    def _load_toxic_data(self) -> None:
        self.toxic_data = {
            "formaldehyde": {"LD50_oral": 100, "carcinogen": True, "category": "1A"},
            "methanol": {"LD50_oral": 5628, "toxic_metabolite": "formaldehyde"},
            "sodium hypochlorite": {"LD50_oral": 5800, "respiratory_irritant": True},
            "ammonia": {"LC50_inhalation": 2000, "respiratory_irritant": True},
            "hydrochloric acid": {"LD50_oral": 900, "corrosive": True},
            "sles": {"LD50_oral": 1260, "skin_irritant": True, "concentration_limit": 25},
            "sls": {"LD50_oral": 1288, "skin_irritant": True, "concentration_limit": 20},
        }

    def _load_corrosive_data(self) -> None:
        self.corrosive_data = {
            "sulfuric acid": {"pH": 0.5, "GHS": "8", "skin_contact": "3rd_degree_burn"},
            "hydrochloric acid": {"pH": 0.1, "GHS": "8", "inhalation_damage": True},
            "sodium hydroxide": {"pH": 14, "GHS": "8", "skin_contact": "deep_burn"},
            "potassium hydroxide": {"pH": 14, "GHS": "8"},
            "citric acid": {"pH": 2.2, "GHS": "7", "mild_irritant": True},
        }

    def _load_explosive_data(self) -> None:
        self.explosive_data = {
            "hydrogen peroxide": {"concentration_limit": 8, "above_limit": "explosive_risk"},
            "ammonium nitrate": {"sensitizer": True, "confined_space_risk": True},
            "organic peroxides": {"self_reactive": True, "SADT": 40},
            "aluminum powder": {"water_reactive": True, "hydrogen_gas": True},
        }

    def _load_ppe_requirements(self) -> None:
        self.ppe_requirements = {
            "corrosive": ["chemical_goggles", "acid_resistant_gloves", "face_shield", "apron"],
            "toxic": ["respirator_with_organic_vapor_cartridge", "chemical_gloves", "lab_coat"],
            "flammable": ["anti_static_footwear", "cotton_clothing", "grounding_equipment"],
            "oxidizer": ["fire_resistant_clothing", "nitrile_gloves", "safety_glasses"],
            "general": ["safety_glasses", "nitrile_gloves", "lab_coat"],
        }

    # ──────────────────────────────────────────────────────────────
    # Public entry-point
    # ──────────────────────────────────────────────────────────────
    def analyze_mixture(
        self,
        components: List[Dict],
        conditions: Optional[Dict] = None,
    ) -> SafetyReport:
        if conditions is None:
            conditions = {"temperature": 25, "pH": 7.0, "pressure": 1.0}

        risks: List[ChemicalRisk] = []
        incompatible: List[Tuple[str, str]] = []

        pair_risks, pairs = self._check_forbidden_pairs(components)
        risks.extend(pair_risks)
        incompatible.extend(pairs)

        thermal_risks, max_temp = self._check_thermal_limits(components, conditions)
        risks.extend(thermal_risks)

        risks.extend(self._check_cumulative_toxicity(components))
        risks.extend(self._check_corrosivity(components, conditions))
        risks.extend(self._check_explosive_potential(components, conditions))

        ph_range = self._estimate_ph_range(components)
        flash_point = self._estimate_flash_point(components)
        ppe = self._determine_ppe(risks)
        storage = self._determine_storage(risks)
        disposal = self._determine_disposal(risks)
        emergency = self._determine_emergency(risks, ppe)

        overall = self._calculate_overall_risk(risks)
        is_safe = overall not in (RiskLevel.DANGEROUS, RiskLevel.DEADLY)

        return SafetyReport(
            is_safe=is_safe,
            overall_risk=overall,
            max_safe_temperature=max_temp,
            risks=risks,
            pH_range=ph_range,
            flash_point=flash_point,
            incompatible_pairs=incompatible,
            required_PPE=ppe,
            storage_conditions=storage,
            disposal_method=disposal,
            emergency_procedure=emergency,
        )

    # ──────────────────────────────────────────────────────────────
    # Six analysis layers
    # ──────────────────────────────────────────────────────────────
    def _check_forbidden_pairs(
        self, components: List[Dict]
    ) -> Tuple[List[ChemicalRisk], List[Tuple[str, str]]]:
        risks: List[ChemicalRisk] = []
        incompatible: List[Tuple[str, str]] = []
        names = [(c.get("name_en") or c.get("name") or "").lower() for c in components]

        for group_a, group_b, level, desc_en, desc_ar, ref in self.forbidden_pairs:
            found_a = any(any(t in n for t in group_a) for n in names if n)
            found_b = any(any(t in n for t in group_b) for n in names if n)
            if found_a and found_b:
                comp_a = next((n for n in names if any(t in n for t in group_a)), "unknown")
                comp_b = next((n for n in names if any(t in n for t in group_b)), "unknown")
                risks.append(
                    ChemicalRisk(
                        level=level,
                        category="reactive",
                        description=desc_en,
                        arabic_description=desc_ar,
                        affected_components=[comp_a, comp_b],
                        recommended_action="DO NOT MIX — separate storage required",
                        reference_source=ref,
                    )
                )
                incompatible.append((comp_a, comp_b))
        return risks, incompatible

    def _check_thermal_limits(
        self, components: List[Dict], conditions: Dict
    ) -> Tuple[List[ChemicalRisk], float]:
        risks: List[ChemicalRisk] = []
        current_temp = float(conditions.get("temperature", 25))
        max_safe = 100.0
        for comp in components:
            name = (comp.get("name_en") or comp.get("name") or "").lower()
            for chemical, data in self.thermal_limits.items():
                if chemical in name:
                    limit = float(data["decomp_temp"])
                    max_safe = min(max_safe, limit - 10)
                    if current_temp >= limit:
                        risks.append(
                            ChemicalRisk(
                                level=RiskLevel.DANGEROUS,
                                category="thermal",
                                description=f"{name} decomposes at {limit}°C — current {current_temp}°C",
                                arabic_description=f"{name} يتفكك عند {limit}°C — الحرارة الحالية {current_temp}°C",
                                affected_components=[name],
                                recommended_action=f"Reduce temperature below {limit - 15}°C",
                                reference_source="Thermal Stability Database",
                            )
                        )
                    elif current_temp >= limit - 15:
                        risks.append(
                            ChemicalRisk(
                                level=RiskLevel.WARNING,
                                category="thermal",
                                description=f"Approaching decomposition temperature for {name}",
                                arabic_description=f"الاقتراب من درجة التفكك لـ {name}",
                                affected_components=[name],
                                recommended_action=f"Monitor closely, keep below {limit - 20}°C",
                                reference_source="Thermal Stability Database",
                            )
                        )
        return risks, max_safe

    def _check_cumulative_toxicity(self, components: List[Dict]) -> List[ChemicalRisk]:
        risks: List[ChemicalRisk] = []
        total_load = 0.0
        carcinogens: List[str] = []
        for comp in components:
            name = (comp.get("name_en") or comp.get("name") or "").lower()
            pct = self._pct(comp)
            for chemical, data in self.toxic_data.items():
                if chemical in name:
                    if "LD50_oral" in data and data["LD50_oral"]:
                        total_load += (pct / 100) * (1000 / float(data["LD50_oral"]))
                    if data.get("carcinogen"):
                        carcinogens.append(name)
                    if "concentration_limit" in data and pct > float(data["concentration_limit"]):
                        risks.append(
                            ChemicalRisk(
                                level=RiskLevel.WARNING,
                                category="toxic",
                                description=f"{name} at {pct}% exceeds safe limit of {data['concentration_limit']}%",
                                arabic_description=f"{name} بنسبة {pct}% يتجاوز الحد الآمن {data['concentration_limit']}%",
                                affected_components=[name],
                                recommended_action=f"Dilute below {data['concentration_limit']}% or substitute",
                                reference_source="Cosmetic Ingredient Review",
                            )
                        )
        if total_load > 1.0:
            risks.append(
                ChemicalRisk(
                    level=RiskLevel.DANGEROUS,
                    category="toxic",
                    description=f"Cumulative toxic load: {total_load:.2f} (safe < 1.0)",
                    arabic_description=f"الحمل السمي التراكمي: {total_load:.2f} (الآمن < 1.0)",
                    affected_components=[c.get("name_en", "") for c in components],
                    recommended_action="Reformulate to reduce toxic components",
                    reference_source="EPA Mixture Toxicity Guidelines",
                )
            )
        if carcinogens:
            risks.append(
                ChemicalRisk(
                    level=RiskLevel.WARNING,
                    category="toxic",
                    description=f"Contains known/suspected carcinogens: {', '.join(carcinogens)}",
                    arabic_description=f"يحتوي على مواد مسرطنة معروفة/محتملة: {', '.join(carcinogens)}",
                    affected_components=carcinogens,
                    recommended_action="Substitute with non-carcinogenic alternatives",
                    reference_source="IARC Monographs",
                )
            )
        return risks

    def _check_corrosivity(self, components: List[Dict], conditions: Dict) -> List[ChemicalRisk]:
        risks: List[ChemicalRisk] = []
        has_acid = has_base = False
        for comp in components:
            name = (comp.get("name_en") or "").lower()
            for chemical, data in self.corrosive_data.items():
                if chemical in name:
                    ph = float(data["pH"])
                    if ph < 7:
                        has_acid = True
                    else:
                        has_base = True
                    if data.get("GHS") == "8":
                        risks.append(
                            ChemicalRisk(
                                level=RiskLevel.WARNING,
                                category="corrosive",
                                description=f"{name} is GHS Class 8 corrosive (pH {ph})",
                                arabic_description=f"{name} مادة تآكلية فئة GHS 8 (pH {ph})",
                                affected_components=[name],
                                recommended_action="Use acid-resistant equipment and full PPE",
                                reference_source="GHS Classification",
                            )
                        )
        if has_acid and has_base:
            risks.append(
                ChemicalRisk(
                    level=RiskLevel.CAUTION,
                    category="thermal",
                    description="Acid-base neutralization will generate heat — add slowly with cooling",
                    arabic_description="تعادل الحمض والقاعدة ينتج حرارة — أضف ببطء مع تبريد",
                    affected_components=["acid", "base"],
                    recommended_action="Add acid to base slowly with stirring and cooling",
                    reference_source="Standard Laboratory Practice",
                )
            )
        return risks

    def _check_explosive_potential(self, components: List[Dict], conditions: Dict) -> List[ChemicalRisk]:
        risks: List[ChemicalRisk] = []
        oxidizers: List[str] = []
        flammables: List[str] = []
        current_temp = float(conditions.get("temperature", 25))
        for comp in components:
            name = (comp.get("name_en") or "").lower()
            pct = self._pct(comp)
            for chemical, data in self.explosive_data.items():
                if chemical in name:
                    if "concentration_limit" in data and pct > float(data["concentration_limit"]):
                        risks.append(
                            ChemicalRisk(
                                level=RiskLevel.DANGEROUS,
                                category="explosive",
                                description=f"{name} at {pct}% exceeds explosive concentration limit",
                                arabic_description=f"{name} بنسبة {pct}% يتجاوز الحد الانفجاري",
                                affected_components=[name],
                                recommended_action=f"Dilute below {data['concentration_limit']}%",
                                reference_source="NFPA 432",
                            )
                        )
                    if data.get("self_reactive") and current_temp > float(data.get("SADT", 50)):
                        risks.append(
                            ChemicalRisk(
                                level=RiskLevel.DEADLY,
                                category="explosive",
                                description=f"Self-reactive material above SADT ({data['SADT']}°C)",
                                arabic_description=f"مادة ذاتية التفاعل فوق درجة الحرارة الذاتية ({data['SADT']}°C)",
                                affected_components=[name],
                                recommended_action="EMERGENCY: cool immediately, evacuate area",
                                reference_source="UN Transport of Dangerous Goods",
                            )
                        )
            if any(x in name for x in ["peroxide", "chlorate", "nitrate", "permanganate"]):
                oxidizers.append(name)
            if any(x in name for x in ["alcohol", "solvent", "organic", "oil", "fat"]):
                flammables.append(name)

        if oxidizers and flammables:
            risks.append(
                ChemicalRisk(
                    level=RiskLevel.DANGEROUS,
                    category="explosive",
                    description=f"Oxidizer ({oxidizers[0]}) + Flammable ({flammables[0]}) = fire/explosion risk",
                    arabic_description=f"مؤكسد ({oxidizers[0]}) + قابل للاشتعال ({flammables[0]}) = خطر حريق",
                    affected_components=[oxidizers[0], flammables[0]],
                    recommended_action="Separate storage, never mix concentrated forms",
                    reference_source="DOT Hazardous Materials Table",
                )
            )
        return risks

    # ──────────────────────────────────────────────────────────────
    # Estimators & decisions
    # ──────────────────────────────────────────────────────────────
    def _estimate_ph_range(self, components: List[Dict]) -> Tuple[float, float]:
        acid = base = 0.0
        for comp in components:
            name = (comp.get("name_en") or "").lower()
            pct = self._pct(comp)
            if any(x in name for x in ["acid", "citric", "acetic", "lactic"]):
                acid += pct * 0.5
            elif any(x in name for x in ["base", "hydroxide", "amine", "ammonia"]):
                base += pct * 0.3
            elif "sles" in name or "sls" in name:
                acid += pct * 0.05
        ph = 7.0 - (acid / 10) + (base / 10)
        return (max(2.0, ph - 1.5), min(12.0, ph + 1.5))

    def _estimate_flash_point(self, components: List[Dict]) -> Optional[float]:
        fp_data = {
            "ethanol": 13, "isopropyl alcohol": 12, "methanol": 11,
            "acetone": -20, "toluene": 4, "xylene": 25,
            "mineral oil": 160, "silicone oil": 200, "glycerin": 160,
        }
        flash_points: List[float] = []
        for comp in components:
            name = (comp.get("name_en") or "").lower()
            pct = self._pct(comp)
            for chem, fp in fp_data.items():
                if chem in name and fp is not None:
                    flash_points.append(fp * (pct / 100))
        return min(flash_points) if flash_points else None

    def _determine_ppe(self, risks: List[ChemicalRisk]) -> List[str]:
        ppe: Set[str] = set()
        for r in risks:
            if r.category == "corrosive":
                ppe.update(self.ppe_requirements["corrosive"])
            elif r.category == "toxic":
                ppe.update(self.ppe_requirements["toxic"])
            elif r.category == "explosive":
                ppe.update(self.ppe_requirements["flammable"])
            elif r.category == "thermal":
                ppe.update(self.ppe_requirements["general"])
        if not ppe:
            ppe.update(self.ppe_requirements["general"])
        return sorted(ppe)

    def _determine_storage(self, risks: List[ChemicalRisk]) -> Dict[str, str]:
        storage = {
            "temperature": "Room temperature (15-25°C)",
            "humidity": "< 60% RH",
            "light": "Avoid direct sunlight",
            "container": "HDPE or glass",
            "segregation": "None required",
        }
        for r in risks:
            if r.level == RiskLevel.DEADLY:
                storage["segregation"] = "CRITICAL: store incompatible materials in separate fire-rated rooms"
                storage["container"] = "Original containers only, clearly labeled"
            elif r.category == "thermal":
                storage["temperature"] = "Cool storage (2-8°C) recommended"
            elif r.category == "explosive":
                storage["temperature"] = "Refrigerated (2-8°C), away from ignition sources"
                storage["light"] = "Complete darkness"
        return storage

    def _determine_disposal(self, risks: List[ChemicalRisk]) -> str:
        has_toxic = any(
            r.category == "toxic" and r.level in (RiskLevel.DANGEROUS, RiskLevel.DEADLY)
            for r in risks
        )
        has_corrosive = any(r.category == "corrosive" for r in risks)
        if has_toxic:
            return "Hazardous waste — licensed handler required. Do NOT pour down drain."
        if has_corrosive:
            return "Neutralize to pH 6-8 before disposal, then treat as industrial waste."
        return "Standard industrial waste disposal — follow local regulations."

    def _determine_emergency(self, risks: List[ChemicalRisk], ppe: List[str]) -> str:
        deadly = [r for r in risks if r.level == RiskLevel.DEADLY]
        if deadly:
            return (
                "EMERGENCY:\n"
                "1. EVACUATE area immediately\n"
                "2. CALL local emergency services\n"
                "3. DO NOT attempt cleanup without Level A hazmat suit\n"
                "4. Isolate area 50m minimum"
            )
        dangerous = [r for r in risks if r.level == RiskLevel.DANGEROUS]
        if dangerous:
            return f"Stop operations · ventilate · use {', '.join(ppe)} · neutralize per SDS"
        return "Standard spill procedure — absorbent + chemical waste container."

    def _calculate_overall_risk(self, risks: List[ChemicalRisk]) -> RiskLevel:
        if not risks:
            return RiskLevel.SAFE
        levels = [r.level for r in risks]
        for level in (RiskLevel.DEADLY, RiskLevel.DANGEROUS, RiskLevel.WARNING, RiskLevel.CAUTION):
            if level in levels:
                return level
        return RiskLevel.SAFE

    @staticmethod
    def _pct(comp: Dict) -> float:
        try:
            value = comp.get("percentage", "0")
            if isinstance(value, str):
                return float(value.replace("%", "").strip() or 0)
            return float(value)
        except (TypeError, ValueError):
            return 0.0


# ──────────────────────────────────────────────────────────────────
# Convenience helper
# ──────────────────────────────────────────────────────────────────
def quick_safety_check(components: List[Dict], temperature: float = 25) -> Dict:
    """Run a fast safety check and return a JSON-friendly dict."""
    engine = ChemicalSafetyEngine()
    report = engine.analyze_mixture(components, {"temperature": temperature})

    emoji_map = {
        RiskLevel.DEADLY: "☠️",
        RiskLevel.DANGEROUS: "🔴",
        RiskLevel.WARNING: "🟠",
        RiskLevel.CAUTION: "🟡",
        RiskLevel.SAFE: "🟢",
    }

    return {
        "is_safe": report.is_safe,
        "risk_level": report.overall_risk.value,
        "risk_emoji": emoji_map[report.overall_risk],
        "max_safe_temperature": report.max_safe_temperature,
        "number_of_risks": len(report.risks),
        "critical_warnings": [
            {
                "level": r.level.value,
                "category": r.category,
                "description": r.arabic_description,
                "action": r.recommended_action,
                "source": r.reference_source,
            }
            for r in report.risks
            if r.level in (RiskLevel.DEADLY, RiskLevel.DANGEROUS)
        ],
        "all_risks": [
            {
                "level": r.level.value,
                "category": r.category,
                "description_en": r.description,
                "description_ar": r.arabic_description,
                "components": r.affected_components,
                "action": r.recommended_action,
                "source": r.reference_source,
            }
            for r in report.risks
        ],
        "required_ppe": report.required_PPE,
        "storage": report.storage_conditions,
        "disposal": report.disposal_method,
        "emergency": report.emergency_procedure,
        "incompatible_pairs": report.incompatible_pairs,
        "pH_range": report.pH_range,
        "flash_point_celsius": report.flash_point,
    }
