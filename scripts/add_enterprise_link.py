"""Add the "Enterprise" nav link to every root HTML file.

Inserts the new entry right after the existing "Consulting" link so the
nav order across the site stays: Home → Chat → Search → Contribute →
Find Substitute → Vision Scan → Teach AI → Consulting → Enterprise →
Pricing. Skips enterprise.html itself (already has the active link)
and any file where the pattern doesn't match (e.g. admin.html which
uses a different navbar).

Re-running is a no-op — files that already contain
`href="./enterprise.html"` are skipped.
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ENTERPRISE_LI = (
    '        <li><a href="./enterprise.html" data-i18n-ar="المؤسسات">Enterprise</a></li>\n'
)

# Insert right BEFORE the existing Pricing link so order is
# Consulting → Enterprise → Pricing.
PRICING_RE = re.compile(
    r'(^[ \t]*<li><a href="\./pricing\.html"[^>]*data-i18n-ar="الأسعار">Pricing</a></li>\s*\n)',
    re.MULTILINE,
)

# Footer Tools list — also add Enterprise right before Pricing there.
FOOTER_RE = re.compile(
    r'(<li><a href="\./pricing\.html" data-i18n-ar="الأسعار">Pricing</a></li>)'
)
FOOTER_INSERT = (
    '<li><a href="./enterprise.html" data-i18n-ar="المؤسسات">Enterprise</a></li>'
    '<li><a href="./pricing.html" data-i18n-ar="الأسعار">Pricing</a></li>'
)


def patch_file(path):
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()

    if 'href="./enterprise.html"' in src:
        return "skip"

    new_src, _ = PRICING_RE.subn(ENTERPRISE_LI + r'\1', src, count=1)
    new_src = FOOTER_RE.sub(FOOTER_INSERT, new_src, count=1)

    if new_src == src:
        return "nomatch"

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_src)
    return "patched"


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "*.html")))
    files = [p for p in files if os.path.basename(p) != "enterprise.html"]

    summary = {"patched": 0, "skip": 0, "nomatch": 0}
    for path in files:
        result = patch_file(path)
        summary[result] += 1
        if result == "nomatch":
            print(f"  [WARN] no navbar pattern matched in {os.path.basename(path)}")

    print(f"\nEnterprise link added to {summary['patched']} files")
    print(f"Already had it: {summary['skip']}")
    print(f"Did not match expected pattern: {summary['nomatch']}")


if __name__ == "__main__":
    main()
