#!/usr/bin/env python3
"""build_summary.py — derive public/data/summary.json from the per-drug files.

The app's global views (home signatures, overview heatmap, pathway pages) need
cross-drug aggregates without downloading all 379 drug files (~240 MB). This
script reads every drugs/<slug>.json once and emits a compact summary:

  per drug, per pathway (indices follow manifest.pathways):
    tested — pairwise records for that pathway across all streams
    up / down / uns — records significant at q < CUTOFF, split by sign
  per drug: per-stream significant counts + totals.

Counts are integers so the frontend can derive fractions exactly. The summary
is computed at the fixed default cutoff (the live slider still re-thresholds
the per-drug views; global views state the fixed cutoff in their legend).

Usage: python3 scripts/build_summary.py   (from the repo root)
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

CUTOFF = 0.05
THR = -math.log10(CUTOFF)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"


def summarize_drug(path: Path, n_pathways: int, n_streams: int, unsigned_streams: set[int]) -> dict:
    d = json.loads(path.read_text())
    c = d["pairwise"]
    stream, pathway, nlp, sign = c["stream"], c["pathway"], c["nlp"], c["sign"]

    tested = [0] * n_pathways
    up = [0] * n_pathways
    down = [0] * n_pathways
    uns = [0] * n_pathways
    per_stream_sig = [0] * n_streams
    per_stream_tested = [0] * n_streams

    for k in range(len(stream)):
        p = pathway[k]
        s = stream[k]
        tested[p] += 1
        per_stream_tested[s] += 1
        if nlp[k] >= THR:
            per_stream_sig[s] += 1
            sg = sign[k]
            # ORA emits sign=+1 for every record but is direction-less
            # enrichment — count it as unsigned, never as an up vote.
            if s in unsigned_streams:
                uns[p] += 1
            elif sg > 0:
                up[p] += 1
            elif sg < 0:
                down[p] += 1
            else:
                uns[p] += 1

    return {
        "slug": d["slug"],
        "n_ref": len(d["ref_clusters"]),
        "n_query": len(d["query_clusters"]),
        "records": len(stream),
        "sig": sum(per_stream_sig),
        "per_stream_sig": per_stream_sig,
        "per_stream_tested": per_stream_tested,
        "tested": tested,
        "up": up,
        "down": down,
        "uns": uns,
    }


def main() -> int:
    manifest = json.loads((DATA / "manifest.json").read_text())
    n_pathways = len(manifest["pathways"])
    n_streams = len(manifest["streams"])
    unsigned_streams = {
        i for i, (method, _lang) in enumerate(manifest["streams"]) if method == "ora"
    }

    drugs = []
    for i, meta in enumerate(manifest["drugs"]):
        path = DATA / meta["file"]
        if not path.exists():
            print(f"  !! missing {meta['file']}", file=sys.stderr)
            continue
        row = summarize_drug(path, n_pathways, n_streams, unsigned_streams)
        if row["slug"] != meta["slug"]:
            print(f"  !! slug mismatch: {row['slug']} vs {meta['slug']}", file=sys.stderr)
        drugs.append(row)
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(manifest['drugs'])}")

    # Global per-pathway rollup: how many drugs show any activity, and the
    # summed significant counts (for ranking pathways by breadth of effect).
    pw_drugs_hit = [0] * n_pathways
    pw_up = [0] * n_pathways
    pw_down = [0] * n_pathways
    pw_uns = [0] * n_pathways
    for row in drugs:
        for p in range(n_pathways):
            n_sig = row["up"][p] + row["down"][p] + row["uns"][p]
            if n_sig > 0:
                pw_drugs_hit[p] += 1
            pw_up[p] += row["up"][p]
            pw_down[p] += row["down"][p]
            pw_uns[p] += row["uns"][p]

    out = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cutoff": CUTOFF,
        "n_pathways": n_pathways,
        "n_streams": n_streams,
        "totals": {
            "records": sum(r["records"] for r in drugs),
            "sig": sum(r["sig"] for r in drugs),
            "cluster_pairs": sum(r["n_ref"] * r["n_query"] for r in drugs),
        },
        "pathways": {
            "drugs_hit": pw_drugs_hit,
            "up": pw_up,
            "down": pw_down,
            "uns": pw_uns,
        },
        "drugs": drugs,
    }

    dest = DATA / "summary.json"
    dest.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {dest} ({dest.stat().st_size / 1024:.0f} KB, {len(drugs)} drugs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
