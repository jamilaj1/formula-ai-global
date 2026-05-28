"""Add the "Workspace" nav link to every root HTML file.

Inserted right after Smart Search so the nav order across the site
becomes: Home → AI Chat → Smart Search → Workspace → … → Pricing.
This positions Workspace as a core user feature (not a marketing page).

Skips workspace.html itself and any file where the pattern doesn't
match (admin.html, library.html — different navbars).

Re-running is a no-op.
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

WORKSPACE_LI = (
    '        <li><a href="./workspace.html" data-i18n-ar="مساحتي">Workspace</a></li>\n'
)

# Insert right AFTER the existing Smart Search link.
SEARCH_RE = re.compile(
    r'(^[ \t]*<li><a href="\./search\.html"[^>]*data-i18n-ar="[^"]*">Smart Search</a></li>\s*\n)',
    re.MULTILINE,
)

# Footer Tools list — add Workspace after Smart Search there too.
FOOTER_RE = re.compile(
    r'(<li><a href="\./search\.html" data-i18n-ar="بحث ذكي">Smart Search</a></li>)'
)
FOOTER_INSERT = (
    '<li><a href="./search.html" data-i18n-ar="بحث ذكي">Smart Search</a></li>'
    '<li><a href="./workspace.html" data-i18n-ar="مساحتي">Workspace</a></li>'
)


def patch_file(path):
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()

    if 'href="./workspace.html"' in src:
        return "skip"

    new_src, _ = SEARCH_RE.subn(r'\1' + WORKSPACE_LI, src, count=1)
    new_src = FOOTER_RE.sub(FOOTER_INSERT, new_src, count=1)

    if new_src == src:
        return "nomatch"

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_src)
    return "patched"


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "*.html")))
    files = [p for p in files if os.path.basename(p) != "workspace.html"]

    summary = {"patched": 0, "skip": 0, "nomatch": 0}
    for path in files:
        result = patch_file(path)
        summary[result] += 1
        if result == "nomatch":
            print(f"  [WARN] no navbar pattern matched in {os.path.basename(path)}")

    print(f"\nWorkspace link added to {summary['patched']} files")
    print(f"Already had it: {summary['skip']}")
    print(f"Did not match expected pattern: {summary['nomatch']}")


if __name__ == "__main__":
    main()
