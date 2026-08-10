#!/usr/bin/env python3
"""fetch_annotations.py — mechanism-of-action annotations from ChEMBL.

For each drug in manifest.json, search ChEMBL by (salt-stripped) name and pull
its mechanism records. Writes public/data/annotations.json:

  { "<slug>": { "chembl_id", "matched_name", "max_phase",
                "moa": ["Cyclin-dependent kinase 4 inhibitor", ...],
                "match": "exact" | "fuzzy" } }

Progressive: the JSON is rewritten after every drug, so the script can be
interrupted and rerun (already-annotated slugs are skipped). Be nice to the
API: one search + one mechanism call per drug, short sleep between drugs.

Usage: python3 scripts/fetch_annotations.py
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
OUT = DATA / "annotations.json"
BASE = "https://www.ebi.ac.uk/chembl/api/data"
SLEEP = 0.25
UA = {"User-Agent": "tahoe-atlas-annotator/1.0 (research use)"}


def get_json(url: str, retries: int = 3) -> dict | None:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001 — network fetch, retry then skip
            if attempt == retries - 1:
                print(f"    !! {e} for {url}")
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def clean_name(name: str) -> str:
    """Strip salt/hydrate parentheticals: 'Edoxaban (tosylate monohydrate)' -> 'Edoxaban'."""
    base = re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()
    return base or name


def annotate(name: str) -> dict | None:
    base = clean_name(name)
    q = urllib.parse.quote(base)
    res = get_json(f"{BASE}/molecule/search.json?q={q}&limit=5")
    if not res or not res.get("molecules"):
        return None
    mols = res["molecules"]
    # prefer an exact (case-insensitive) pref_name match, else the top hit
    exact = next((m for m in mols if (m.get("pref_name") or "").lower() == base.lower()), None)
    mol = exact or mols[0]
    chembl_id = mol["molecule_chembl_id"]
    mech = get_json(f"{BASE}/mechanism.json?molecule_chembl_id={chembl_id}&limit=10")
    moa = []
    if mech:
        for m in mech.get("mechanisms", []):
            s = m.get("mechanism_of_action")
            if s and s not in moa:
                moa.append(s)
    return {
        "chembl_id": chembl_id,
        "matched_name": mol.get("pref_name") or base,
        "max_phase": mol.get("max_phase"),
        "moa": moa,
        "match": "exact" if exact else "fuzzy",
    }


def main() -> int:
    manifest = json.loads((DATA / "manifest.json").read_text())
    out: dict = json.loads(OUT.read_text()) if OUT.exists() else {}
    todo = [d for d in manifest["drugs"] if d["slug"] not in out]
    print(f"{len(out)} cached, {len(todo)} to fetch")
    for i, d in enumerate(todo):
        ann = annotate(d["name"])
        out[d["slug"]] = ann or {"match": "none", "moa": []}
        OUT.write_text(json.dumps(out, separators=(",", ":")))
        tag = ann["match"] if ann else "none"
        moa0 = (ann or {}).get("moa") or []
        print(f"  [{i + 1}/{len(todo)}] {d['name'][:40]:42s} {tag:6s} {moa0[0][:50] if moa0 else ''}")
        time.sleep(SLEEP)
    n_moa = sum(1 for v in out.values() if v.get("moa"))
    print(f"done: {len(out)} drugs, {n_moa} with mechanisms -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
