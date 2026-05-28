"""Add the "Calculators" nav link to every root HTML file.

Inserted right after the Workspace link so the nav order is:
  Home → AI Chat → Smart Search → Workspace → Calculators → Consulting …

Skips calculators.html itself and any file where the pattern doesn't
match. Re-running is a no-op.
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CALC_LI = (
    '        <li><a href="./calculators.html" data-i18n-ar="الحاسبات">Calculators</a></li>\n'
)

WORKSPACE_RE = re.compile(
    r'(^[ \t]*<li><a href="\./workspace\.html"[^>]*data-i18n-ar="[^"]*">Workspace</a></li>\s*\n)',
    re.MULTILINE,
)


def patch_file(path):
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    if 'href="./calculators.html"' in src:
        return "skip"
    new_src, _ = WORKSPACE_RE.subn(r'\1' + CALC_LI, src, count=1)
    if new_src == src:
        return "nomatch"
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_src)
    return "patched"


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "*.html")))
    files = [p for p in files if os.path.basename(p) != "calculators.html"]
    summary = {"patched": 0, "skip": 0, "nomatch": 0}
    for path in files:
        result = patch_file(path)
        summary[result] += 1
        if result == "nomatch":
            print(f"  [WARN] no Workspace link in {os.path.basename(path)}")
    print(f"\nCalculators link added to {summary['patched']} files")
    print(f"Already had it: {summary['skip']}")
    print(f"Did not match expected pattern: {summary['nomatch']}")


if __name__ == "__main__":
    main()
