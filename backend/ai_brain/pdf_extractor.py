"""
PDF Book Extractor - Extracts chemical formulas from PDF books
"""
import os
import pdfplumber
from typing import Dict, List
from datetime import datetime

class PDFBookExtractor:
    """Extracts formulas from PDF chemical books"""
    
    def __init__(self, brain):
        self.brain = brain
        
    def extract_from_pdf(self, pdf_path: str) -> Dict:
        """Extract all formulas from a PDF book"""
        print(f"📖 Processing: {os.path.basename(pdf_path)}")
        
        # Step 1: Extract all text
        text = self._read_pdf(pdf_path)
        print(f"   📝 Extracted {len(text)} characters")
        
        # Step 2: Split into chunks
        chunks = self._split_into_chunks(text)
        print(f"   📦 Split into {len(chunks)} chunks")
        
        # Step 3: Extract formulas from each chunk
        all_formulas = []
        for i, chunk in enumerate(chunks):
            formulas = self.brain.extract_from_text(
                chunk,
                source_info={
                    'type': 'pdf_book',
                    'title': os.path.basename(pdf_path),
                    'page': i + 1
                }
            )
            all_formulas.extend(formulas)
            if formulas:
                print(f"   ✅ Chunk {i+1}: Found {len(formulas)} formulas")
        
        # Step 4: Save to database
        saved = 0
        for formula in all_formulas:
            if self.brain.save_formula(formula):
                saved += 1
        
        return {
            'book': os.path.basename(pdf_path),
            'total_chunks': len(chunks),
            'formulas_found': len(all_formulas),
            'formulas_saved': saved
        }
    
    def _read_pdf(self, pdf_path: str) -> str:
        """Read all text from PDF"""
        text = ""
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
        except Exception as e:
            print(f"   ⚠️ Error reading PDF: {e}")
        return text
    
    def _split_into_chunks(self, text: str, chunk_size: int = 8000) -> List[str]:
        """Split text into manageable chunks"""
        words = text.split()
        chunks = []
        current_chunk = []
        current_size = 0
        
        for word in words:
            if current_size + len(word) > chunk_size:
                chunks.append(' '.join(current_chunk))
                current_chunk = [word]
                current_size = len(word)
            else:
                current_chunk.append(word)
                current_size += len(word) + 1
        
        if current_chunk:
            chunks.append(' '.join(current_chunk))
        
        return chunks

print("📄 PDF Extractor loaded!")