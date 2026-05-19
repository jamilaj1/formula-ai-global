"""Phase 3 deploy builder.
1. Bump every ?v=8 -> ?v=9 in all root *.html (cache-bust; supabase-client.js
   and chem-client.js are site-wide deps that changed).
2. Build DEPLOY_PHASE3.zip with forward-slash entries only.
"""
import glob
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- 1. cache-bust ---
bumped = 0
for path in glob.glob(os.path.join(ROOT, "*.html")):
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    if "?v=8" in src:
        with open(path, "w", encoding="utf-8") as f:
            f.write(src.replace("?v=8", "?v=9"))
        bumped += 1
print(f"cache-bust: {bumped} html files bumped ?v=8 -> ?v=9")

# --- 2. build zip ---
ASSETS = [
    "assets/styles.css",
    "assets/app.js",
    "assets/supabase-client.js",
    "assets/search-live.js",
    "assets/chem-client.js",
    "assets/formula-detail-live.js",  # changed in Phase 3, loaded by formulas.html
]
zip_path = os.path.join(ROOT, "DEPLOY_PHASE3.zip")
entries = []
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for path in sorted(glob.glob(os.path.join(ROOT, "*.html"))):
        arc = os.path.basename(path)
        z.write(path, arc)
        entries.append(arc)
    z.write(os.path.join(ROOT, "sw.js"), "sw.js")
    entries.append("sw.js")
    for rel in ASSETS:
        z.write(os.path.join(ROOT, rel), rel)
        entries.append(rel)

backslash = [e for e in entries if "\\" in e]
print(f"zip: {zip_path}")
print(f"entries: {len(entries)}  backslash entries: {len(backslash)}")
print(f"size: {os.path.getsize(zip_path)} bytes")
assert not backslash, "FAIL: backslash entries present"
print("OK: 0 backslash entries")
