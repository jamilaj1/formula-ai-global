"""
LanguageDetector — quick Unicode-script heuristic for the 20 supported languages.
Good enough to route the answer; full NLP detection is overkill at this scale.
"""
import re
from typing import Optional


# (code, regex of representative characters)
SCRIPT_RULES = [
    ("ar", r"[؀-ۿݐ-ݿ]"),  # Arabic
    ("ur", r"[؀-ۿ].*[ےۓ]"),         # Urdu (Arabic script + extras) — fallback to ar
    ("fa", r"[پچژگ]"),                          # Persian distinguishing letters
    ("zh", r"[一-鿿]"),                # Chinese
    ("ja", r"[぀-ゟ゠-ヿ]"),  # Japanese hiragana/katakana
    ("ko", r"[가-힯]"),                # Korean
    ("ru", r"[Ѐ-ӿ]"),                # Cyrillic
    ("hi", r"[ऀ-ॿ]"),                # Devanagari
    ("am", r"[ሀ-፿]"),                # Ethiopic / Amharic
]

LATIN_HINT_WORDS = {
    "fr": ("le ", "la ", "et ", "est ", "pour ", "avec "),
    "es": ("el ", "la ", "y ", "es ", "para ", "con "),
    "pt": ("o ", "a ", "e ", "para ", "com ", "do "),
    "tr": ("ve ", "için ", "bir "),
    "de": ("der ", "die ", "und ", "ist "),
    "it": ("il ", "la ", "e ", "per "),
    "ms": ("dan ", "yang ", "untuk "),
    "id": ("dan ", "yang ", "untuk "),
    "sw": ("na ", "ya ", "kwa "),
    "ha": ("kuma ", "wanda ", "ko "),
}


class LanguageDetector:
    def detect(self, text: str) -> Optional[str]:
        if not text:
            return None
        sample = text[:500]
        for code, pattern in SCRIPT_RULES:
            if re.search(pattern, sample):
                return code
        lower = " " + sample.lower() + " "
        for code, hints in LATIN_HINT_WORDS.items():
            for h in hints:
                if h in lower:
                    return code
        return "en"
