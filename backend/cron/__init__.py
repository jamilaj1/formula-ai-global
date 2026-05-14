"""
Scheduled / cron jobs for continuous learning.

Each module here is meant to be run on a schedule (Render Cron Jobs,
GitHub Actions cron, or any external scheduler). They are idempotent —
running twice in a day is safe; they track what's already been
ingested to avoid duplicates.

  daily_paper_scrape   — fetch new chemistry papers (arXiv + Europe PMC),
                          extract formulas, write to DB
  weekly_reindex        — re-rank formulas by recent citation activity
  daily_health_report   — email/Slack ping with stats (Phase 5.5)
"""
