"""
UniversalKnowledgeCollector — runs forever in the background, ingesting new
formulas from books, patents, journals, supplier sites, and chemical databases.

Each pass:
  1. Pulls a queue of pending sources from `sources_queue`
  2. Downloads / parses each source
  3. Hands the raw text to FormulaAIBrain.process_text()
  4. Stores validated formulas back into `formulas`
  5. Logs the run so we can show the user "X new formulas today"
"""
import asyncio
from datetime import datetime
from typing import Dict, List

from supabase import Client


class UniversalKnowledgeCollector:
    POLL_INTERVAL_SECONDS = 60 * 30  # twice an hour

    def __init__(self, brain, supabase: Client):
        self.brain = brain
        self.supabase = supabase
        self._stopped = False

    async def start(self):
        """Long-running loop. Cancel via FastAPI lifespan."""
        print("📚 Knowledge collector loop started")
        while not self._stopped:
            try:
                await self._tick()
            except asyncio.CancelledError:
                break
            except Exception as exc:  # noqa: BLE001
                print(f"⚠️  collector error: {exc}")
            await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

    async def _tick(self) -> None:
        sources = self._fetch_pending_sources(limit=5)
        if not sources:
            return
        for src in sources:
            text = await self._download(src)
            if not text:
                continue
            formulas = await self.brain.process_text(text, source_info=src)
            self._persist(formulas)
            self._mark_processed(src)

    # ---------- DB helpers (sync supabase client) -----------
    def _fetch_pending_sources(self, limit: int) -> List[Dict]:
        try:
            res = (
                self.supabase.table("sources_queue")
                .select("*")
                .eq("processed", False)
                .limit(limit)
                .execute()
            )
            return res.data or []
        except Exception:
            return []

    def _mark_processed(self, src: Dict) -> None:
        try:
            self.supabase.table("sources_queue").update(
                {"processed": True, "processed_at": datetime.utcnow().isoformat()}
            ).eq("id", src["id"]).execute()
        except Exception:
            pass

    def _persist(self, formulas: List[Dict]) -> None:
        if not formulas:
            return
        rows = []
        for f in formulas:
            rows.append(
                {
                    "name": f.get("name") or "Untitled",
                    "name_en": f.get("name_en") or f.get("name"),
                    "components": f.get("components", []),
                    "trust_score": f.get("trust_score", 0),
                    "completeness_score": f.get("completeness_score", 0),
                    "source_type": (f.get("source_info") or {}).get("type"),
                    "source_title": (f.get("source_info") or {}).get("title"),
                }
            )
        try:
            self.supabase.table("formulas").insert(rows).execute()
        except Exception:
            pass

    # ---------- Network ----------------------------------------
    async def _download(self, src: Dict) -> str:
        """
        Stub: in production, dispatch on src['type']:
          - 'book'    → fetch PDF, run pypdf
          - 'patent'  → query Google Patents API
          - 'journal' → arXiv / ChemRxiv / PubMed
          - 'site'    → httpx + BeautifulSoup
        For now we just return the inline text payload, if any.
        """
        return src.get("raw_text", "") or ""
