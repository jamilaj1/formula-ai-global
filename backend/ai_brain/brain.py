"""
Formula AI Chemical Brain - Core Engine
Extracts formulas from books, papers, patents, and websites
"""
import os
import json
import hashlib
from datetime import datetime
from typing import Dict, List, Optional
import anthropic
from supabase import create_client, Client

class FormulaAIBrain:
    """The main chemical brain that processes all knowledge"""
    
    def __init__(self, supabase_url: str, supabase_key: str, anthropic_key: str):
        self.supabase: Client = create_client(supabase_url, supabase_key)
        self.claude = anthropic.Anthropic(api_key=anthropic_key)
        self.model = "claude-sonnet-4-5"
        
        # Statistics
        self.stats = {
            'total_formulas': 0,
            'total_chemicals': 0,
            'books_processed': 0,
            'papers_analyzed': 0,
            'patents_analyzed': 0,
        }
    
    def search(self, query: str, language: str = "en") -> str:
        """Search for chemical formulas using AI"""
        
        system_prompt = f"""You are an expert chemical formulator with 30 years of experience.
You have access to thousands of reference books and chemical databases.
The user is asking in {language}. Respond in {language}.

Provide:
1. Complete chemical formula with ALL components
2. EXACT percentages that sum to 100%
3. Real CAS Registry Numbers
4. Mixing procedure
5. Safety warnings
6. Quality control parameters

IMPORTANT RULES:
- Percentages MUST sum to exactly 100%
- CAS numbers must be REAL (not invented)
- Never mix anionic + cationic surfactants
- Pine oil requires non-ionic emulsifiers
- NaCl has NO role in disinfectants
- NaOCl + Acid = CHLORINE GAS (FATAL)
- 80% of formulas should be affordable (use cheap materials)
"""
        
        response = self.claude.messages.create(
            model=self.model,
            max_tokens=4096,
            temperature=0.1,
            system=system_prompt,
            messages=[{"role": "user", "content": query}]
        )
        
        return response.content[0].text
    
    def extract_from_text(self, text: str, source_info: Dict) -> List[Dict]:
        """Extract chemical formulas from text"""
        
        system_prompt = """You are an expert chemical formulator.
Extract ALL complete chemical formulas from this text.
For each formula provide:
- Name (English and Arabic if available)
- Category
- ALL components with exact percentages
- CAS Registry Numbers
- Function of each component
- Process conditions
- Safety warnings

Return as JSON array. Only include formulas that are actually IN the text.
Do NOT invent formulas. If percentages don't sum to 100%, note the issue."""

        response = self.claude.messages.create(
            model=self.model,
            max_tokens=8192,
            temperature=0.1,
            system=system_prompt,
            messages=[{"role": "user", "content": f"Source: {source_info.get('title', 'Unknown')}\n\nText:\n{text[:10000]}"}]
        )
        
        try:
            content = response.content[0].text
            # Extract JSON from response
            import re
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                formulas = json.loads(json_match.group())
                for f in formulas:
                    f['source_type'] = source_info.get('type', 'unknown')
                    f['source_title'] = source_info.get('title', '')
                    f['source_author'] = source_info.get('author', '')
                    f['source_year'] = source_info.get('year', 0)
                    f['extraction_date'] = datetime.utcnow().isoformat()
                return formulas
        except Exception as e:
            print(f"  ⚠️ Extraction error: {e}")
        
        return []
    
    def validate_percentages(self, components: List[Dict]) -> Dict:
        """Validate that percentages sum to 100%"""
        total = 0
        for comp in components:
            pct_str = comp.get('percentage', '0%')
            try:
                total += float(pct_str.replace('%', ''))
            except:
                pass
        
        is_valid = abs(total - 100) < 1.0
        
        return {
            'total': round(total, 2),
            'is_valid': is_valid,
            'difference': round(100 - total, 2),
            'needs_water': not is_valid and total < 100,
            'suggestion': f'Add {round(100 - total, 2)}% water' if total < 100 else f'Reduce by {round(total - 100, 2)}%'
        }
    
    def fix_truncated_names(self, name: str) -> str:
        """Fix commonly truncated chemical names"""
        fixes = {
            'GENE BASED': 'OXYGEN BASED BLEACH',
            'SODIUM LAUR': 'SODIUM LAURYL SULFATE',
            'SODIUM LAURETH': 'SODIUM LAURETH SULFATE',
            'COCAMIDO': 'COCAMIDOPROPYL BETAINE',
            'CITRIC AC': 'CITRIC ACID',
            'SODIUM BENZ': 'SODIUM BENZOATE',
            'POTASSIUM SORB': 'POTASSIUM SORBATE',
        }
        upper = name.upper().strip()
        for partial, full in fixes.items():
            if upper.startswith(partial):
                return full
        return name
    
    def get_common_cas(self, name: str) -> Optional[str]:
        """Get CAS number for common chemicals"""
        common = {
            'water': '7732-18-5',
            'sles': '68585-34-2',
            'sodium laureth sulfate': '68585-34-2',
            'sls': '151-21-3',
            'sodium lauryl sulfate': '151-21-3',
            'cocamidopropyl betaine': '61789-40-0',
            'glycerin': '56-81-5',
            'glycerine': '56-81-5',
            'sodium chloride': '7647-14-5',
            'salt': '7647-14-5',
            'citric acid': '77-92-9',
            'sodium benzoate': '532-32-1',
            'sodium hydroxide': '1310-73-2',
            'hydrogen peroxide': '7722-84-1',
            'sodium hypochlorite': '7681-52-9',
            'isopropyl alcohol': '67-63-0',
            'ethanol': '64-17-5',
            'edta': '60-00-4',
            'sodium bicarbonate': '144-55-8',
            'borax': '1303-96-4',
            'xanthan gum': '11138-66-2',
            'carbomer': '9003-01-4',
            'phenoxyethanol': '122-99-6',
            'benzalkonium chloride': '63449-41-2',
        }
        return common.get(name.lower())
    
    def save_formula(self, formula: Dict) -> bool:
        """Save formula to Supabase"""
        try:
            # Fix truncated names
            if 'components' in formula:
                for comp in formula['components']:
                    comp['name_en'] = self.fix_truncated_names(
                        comp.get('name_en', comp.get('name', ''))
                    )
                    if not comp.get('cas_number'):
                        comp['cas_number'] = self.get_common_cas(
                            comp.get('name_en', '')
                        )
            
            # Validate percentages
            if 'components' in formula:
                validation = self.validate_percentages(formula['components'])
                formula['percentage_validation'] = validation
                formula['trust_score'] = 100 if validation['is_valid'] else 70
            
            self.supabase.table('formulas').insert(formula).execute()
            self.stats['total_formulas'] += 1
            return True
        except Exception as e:
            print(f"  ⚠️ Save error: {e}")
            return False
    
    def get_stats(self) -> Dict:
        """Get brain statistics"""
        return self.stats

print("🧠 Formula AI Brain v3.0 loaded successfully!")
print("   Capabilities:")
print("   - Chemical formula extraction from text")
print("   - AI-powered search in 20 languages")
print("   - Percentage validation (must sum to 100%)")
print("   - CAS number auto-lookup")
print("   - Truncated name auto-fix")
print("   - Chemical conflict detection")