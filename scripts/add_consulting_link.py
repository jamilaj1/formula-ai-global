"""Add the "Consulting" nav link to every root HTML file.

The navbar markup is duplicated inline in every page (no shared
template). After Phase 2.1 introduced consulting.html, every page's
<ul class="nav-links"> needs the new entry inserted right before the
Pricing link so the order stays consistent across the site.

This is a one-shot script — once every page has the link, re-running
it is a no-op (it skips files that already contain the link).
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The exact line we want present in every navbar. Matches the entry
# already in consulting.html and pricing.html footer Tools list.
CONSULTING_LI = (
    '        <li><a href="./consulting.html" data-i18n-ar="الاستشارات">Consulting</a></li>\n'
)

# We insert it right before the existing Pricing link. The regex
# tolerates either the plain Pricing link or the active variant
# (`class="active"`), and either order of attributes.
PRICING_RE = re.compile(
    r'(^[ \t]*<li><a href="\./pricing\.html"[^>]*data-i18n-ar="الأسعار">Pricing</a></li>\s*\n)',
    re.MULTILINE,
)

# Also patch the footer Tools list so visitors can find the page from
# the bottom of any page too. The footer is a single long line in
# every file; this regex inserts the Consulting <li> right before the
# Pricing one inside the footer ul as well.
FOOTER_RE = re.compile(
    r'(<li><a href="\./pricing\.html" data-i18n-ar="الأسعار">Pricing</a></li>)'
)
FOOTER_INSERT = (
    '<li><a href="./consulting.html" data-i18n-ar="الاستشارات">Consulting</a></li>'
    '<li><a href="./pricing.html" data-i18n-ar="الأسعار">Pricing</a></li>'
)


def patch_file(path):
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()

    # Skip if already patched.
    if 'href="./consulting.html"' in src:
        return "skip"

    new_src, navbar_count = PRICING_RE.subn(CONSULTING_LI + r'\1', src, count=1)
    new_src = FOOTER_RE.sub(FOOTER_INSERT, new_src, count=1)

    if new_src == src:
        return "nomatch"

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_src)
    return "patched"


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "*.html")))
    # consulting.html itself already has the link — don't re-patch it.
    files = [p for p in files if os.path.basename(p) != "consulting.html"]

    summary = {"patched": 0, "skip": 0, "nomatch": 0}
    for path in files:
        result = patch_file(path)
        summary[result] += 1
        if result == "nomatch":
            print(f"  [WARN] no navbar pattern matched in {os.path.basename(path)}")

    print(f"\nConsulting link added to {summary['patched']} files")
    print(f"Already had it: {summary['skip']}")
    print(f"Did not match expected pattern: {summary['nomatch']}")


if __name__ == "__main__":
    main()
