"""Sync the <ul class="nav-links">…</ul> block across every root HTML file
to one canonical template.

Why this exists
---------------
Each root .html file holds its own inlined navbar (no shared template),
which is good for SEO + no flash-of-unstyled-content but bad for upkeep
— for months we had 12-14 mismatched items per page with chaotic order
and the occasional duplicate (`Consulting · Consulting`, `Enterprise ·
Enterprise`). This script makes the inlined-navbar pattern maintainable
by giving us ONE place to define the menu and a one-command sync to
push it out.

Result is a compact 6-item primary nav plus a `Tools ▾` dropdown that
holds the 17 secondary features. The nav stays inline in every HTML
file (so SEO + first-paint still work), but every page is now identical
and adding/removing/renaming a link is a one-script change here, not 33
hand-edits.

Operationally
-------------
1. Edit PRIMARY / TOOLS below.
2. Run `python scripts/sync_navbar.py` from anywhere.
3. Commit the modified .html files alongside this script. Push.
4. The CI deploy + cache-bust handles the rest.

Idempotent: re-running with no template change leaves the files alone.
"""
from __future__ import annotations

import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Canonical navbar ─────────────────────────────────────────────────
#
# Each entry is (href-basename, English label, Arabic label). For the
# special "__TOOLS__" entry we render the dropdown instead of a normal
# link.
#
# Keep this ORDER stable — it's the order users will see, top-to-bottom
# on mobile and left-to-right on desktop.

PRIMARY: list[tuple[str, str, str]] = [
    ("index.html",       "Home",       "الرئيسية"),
    ("__TOOLS__",        "Tools",      "الأدوات"),
    ("consulting.html",  "Consulting", "الاستشارات"),
    ("enterprise.html",  "Enterprise", "المؤسسات"),
    ("pricing.html",     "Pricing",    "الأسعار"),
    ("about.html",       "About",      "من نحن"),
]

# Tools dropdown — every secondary feature lives here. Order is a
# rough "how often will a chemist hit this on a daily basis" descending.
TOOLS: list[tuple[str, str, str]] = [
    ("chat.html",         "AI Chat",            "الدردشة الذكية"),
    ("search.html",       "Smart Search",       "البحث الذكي"),
    ("workspace.html",    "Workspace",          "مساحتي"),
    ("calculators.html",  "Calculators",        "الحاسبات"),
    ("substitute.html",   "Find Substitute",    "إيجاد بديل"),
    ("scan.html",         "Vision Scan",        "مسح بصري"),
    ("safety.html",       "Safety",             "السلامة"),
    ("lab.html",          "Lab",                "المختبر"),
    ("predict.html",      "Predict Properties", "تنبّؤ خواص"),
    ("similarity.html",   "Similarity",         "تشابه جزيئي"),
    ("agent.html",        "AI Formulator",      "مُصمِّم AI"),
    ("compliance.html",   "Compliance",         "الامتثال"),
    ("encyclopedia.html", "Encyclopedia",       "الموسوعة"),
    ("industries.html",   "Industries",         "الصناعات"),
    ("programs.html",     "Programs",           "البرامج"),
    ("contribute.html",   "Contribute",         "أضف فورمولا"),
    ("learn.html",        "Teach AI",           "علّم الذكاء"),
]

# Pages where the navbar should NOT be touched. login.html, register.html
# and a few standalone pages may use custom shells later; for now we keep
# them in sync too unless they show up here. admin.html historically uses
# a different navbar (handoff §4) — leave it alone.
SKIP = {"admin.html"}

# Pattern to FIND the start of the inlined navbar — leading whitespace
# captured for indent.
NAV_START_RE = re.compile(
    r'(?P<indent>[ \t]*)<ul class="nav-links">',
)
# We also want to swallow any orphan `</li>` + extra `<li>...</li>` +
# stray `</ul>` left behind from earlier broken sync runs (the dropdown
# regression). Stop only when the navbar is followed by the next REAL
# element in the navbar shell — nav-tools or nav-cta or the hamburger.
NAV_TAIL_STOP_RE = re.compile(
    r'<div class="nav-(?:tools|cta)"|<button class="nav-toggle"',
)


def render_nav(current_file: str, base_indent: str = "      ") -> str:
    """Build the canonical <ul class="nav-links">…</ul> block for one page.

    `base_indent` is the whitespace prefix of the `<ul>` line itself,
    inherited from the file being rewritten so the result drops in
    cleanly without disturbing surrounding indentation.
    """
    in_tools = any(t[0] == current_file for t in TOOLS)
    inner = base_indent + "  "       # one level deeper than <ul>
    inner_dropdown = inner + "  "    # menu items inside the dropdown

    # Build the Tools dropdown block.
    tool_lis = []
    for href, en, ar in TOOLS:
        active = ' class="active"' if href == current_file else ""
        tool_lis.append(
            f'{inner_dropdown}  <li><a href="./{href}"{active} data-i18n-ar="{ar}">{en}</a></li>'
        )

    tools_dropdown_block = "\n".join([
        f'{inner}<li class="nav-dropdown">',
        f'{inner}  <button type="button" class="nav-dropdown-toggle{" active" if in_tools else ""}" aria-expanded="false" aria-haspopup="true">',
        f'{inner}    <span data-i18n-ar="الأدوات">Tools</span>',
        f'{inner}    <svg class="nav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
        f'{inner}  </button>',
        f'{inner}  <ul class="nav-dropdown-menu">',
        *tool_lis,
        f'{inner}  </ul>',
        f'{inner}</li>',
    ])

    # Build the primary list.
    parts: list[str] = [f'{base_indent}<ul class="nav-links">']
    for href, en, ar in PRIMARY:
        if href == "__TOOLS__":
            parts.append(tools_dropdown_block)
            continue
        active = ' class="active"' if href == current_file else ""
        parts.append(f'{inner}<li><a href="./{href}"{active} data-i18n-ar="{ar}">{en}</a></li>')
    parts.append(f'{base_indent}</ul>')
    return "\n".join(parts)


def patch_file(path: str) -> str:
    basename = os.path.basename(path)
    if basename in SKIP:
        return "skip"

    with open(path, "r", encoding="utf-8") as f:
        src = f.read()

    start_m = NAV_START_RE.search(src)
    if not start_m:
        return "nomatch"
    start = start_m.start()
    indent = start_m.group("indent")

    # Find where the nav-links block ends — i.e. the next real navbar
    # sibling (nav-tools, nav-cta, or the mobile-menu button). Any
    # stray `</li>` / `<li>...</li>` / `</ul>` between the inner
    # dropdown closer and that boundary is the corruption we want to
    # swallow on this re-sync.
    tail_m = NAV_TAIL_STOP_RE.search(src, start_m.end())
    if not tail_m:
        return "nomatch"
    # Roll back from the tail anchor to the end of the previous line so
    # the existing indentation of the next sibling is preserved.
    cut = tail_m.start()
    # Step back over whitespace so the replacement ends right after the
    # outer </ul>.
    while cut > 0 and src[cut - 1] in (" ", "\t"):
        cut -= 1
    if cut > 0 and src[cut - 1] == "\n":
        # Keep the newline — we'll re-emit it inside the new block.
        pass

    new_block = render_nav(basename, indent) + "\n" + indent
    new_src = src[:start] + new_block + src[cut:]

    if new_src == src:
        return "noop"

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_src)
    return "patched"


def main() -> None:
    files = sorted(glob.glob(os.path.join(ROOT, "*.html")))

    summary: dict[str, int] = {"patched": 0, "noop": 0, "skip": 0, "nomatch": 0}
    nomatch_names: list[str] = []
    for path in files:
        result = patch_file(path)
        summary[result] += 1
        if result == "nomatch":
            nomatch_names.append(os.path.basename(path))

    print(f"Sync complete:")
    print(f"  {summary['patched']:>3}  files updated")
    print(f"  {summary['noop']:>3}  files already in sync")
    print(f"  {summary['skip']:>3}  files explicitly skipped (admin etc.)")
    print(f"  {summary['nomatch']:>3}  files had no <ul class=\"nav-links\"> (probably no navbar)")
    if nomatch_names:
        print("    " + ", ".join(nomatch_names))


if __name__ == "__main__":
    main()
