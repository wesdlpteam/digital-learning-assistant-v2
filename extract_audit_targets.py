"""Extract distinct (ca, yl, th) tuples from audit_findings.json for the server-side regen."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
src = json.loads((ROOT / "audit_findings.json").read_text(encoding="utf-8"))

seen = set()
tuples = []
for f in src["findings"]:
    if f["check"] == "OVER_SUGGEST":
        continue
    key = (f.get("ca", ""), f.get("yl", ""), f.get("th", ""))
    if not all(key):
        continue
    if key in seen:
        continue
    seen.add(key)
    tuples.append(key)

js_array = "var SERVER_REGEN_AUDIT_TARGETS = [\n"
for ca, yl, th in tuples:
    th_js = th.replace("\\", "\\\\").replace("'", "\\'")
    js_array += f"  {{ ca: '{ca}', yl: '{yl}', th: '{th_js}' }},\n"
js_array += "];\n"

(ROOT / "_audit_targets.js.snippet").write_text(js_array, encoding="utf-8")
print(f"{len(tuples)} distinct units extracted.")
print(f"Snippet written to _audit_targets.js.snippet")
