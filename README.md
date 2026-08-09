# Tahoe · drug–pathway atlas

React + TypeScript + Vite app for exploring pathway-enrichment results across
379 drug perturbations: per drug, every DMSO reference cluster × drug cluster
pair is scored against the 50 MSigDB Hallmark 2020 pathways by 7 method
streams (GSEA·py, GSEA·R, fgsea·R, ORA·py, ORA·R, CellSpectra·py, CellSpectra·R).

## Views

- **Drugs** (`#/`) — hero stats + card index with a 50-pathway signature strip
  per drug (red = up, blue = down, violet = unsigned CellSpectra, ink = mixed),
  sortable by activity / selectivity / name. `/` focuses the filter.
- **Landscape** (`#/atlas`) — the full 379 × 50 matrix as a virtualized canvas
  heatmap that sizes itself to the viewport. Click a column label to sort by
  that pathway, click a row to open the drug. Direction and activity encodings,
  plus seriation: "Clustered" row order (first principal component of the drug
  fingerprints) and a "cluster pathways" column order (average-linkage on
  1 − Pearson r) that surface the block structure.
- **Pathways** (`#/pathways`, `#/pathway/<slug>`) — per-pathway drug ranking as
  diverging (tornado) bars: fraction of a drug's tests calling the pathway up
  vs down, with unsigned counts alongside. Links out to MSigDB.
- **Drug page** (`#/drug/<slug>`) — three tabs:
  *Pathways* (pathway × drug-cluster count grids with per-DMSO-cluster tooltip
  breakdowns and threshold-survival sparklines; OVR signatures),
  *Cluster pairs* (ref × query small multiples per stream — where in cluster
  space the response lives; click through to method agreement),
  *Method agreement* (pathway × stream grid for one pair + lower-triangle
  Jaccard concordance with same-method py↔R pairs outlined).
  Tab/stream/pair state is mirrored into the URL for shareable links.
- **Networks** (`#/network`) — graph-theory views, hand-rolled (no deps):
  a drug similarity network (each drug → its 6 nearest cosine neighbors over a
  150-dim up/down/unsigned fingerprint; label-propagation communities with
  differential theme labels; force-directed layout) and a pathway co-response
  network (edges = Pearson correlation of activity across drugs → co-regulated
  modules). All math in `src/analysis.ts`.
- **Correlation** (`#/correlate`) — does pathway A move with pathway B across
  the library? One point per drug, OLS fit with 95% confidence band, and
  hand-rolled inference: Pearson & Spearman with exact t-based p-values, slope
  CI, an exact binomial sign test on direction concordance, and a
  potency-adjusted partial correlation (controls per-drug mean activity).
  Metrics: net direction (up − down)/tests or activity fraction. Defaults to
  Hypoxia vs Epithelial Mesenchymal Transition. A second view, **Lasso
  selection**, regresses a response pathway on the other 49 with L1
  regularization (cyclic coordinate descent over a 60-λ path, 5-fold CV,
  λ-min / λ-1SE rules, verified against scikit-learn): redundant predictors are
  clipped to exactly zero, and the surviving standardized coefficients are
  shown as a diverging bar chart with the CV error curve and a λ slider.
- **Rank** (`#/rank`) — pick pathways, rank drugs instantly from the summary;
  optional exact re-rank at the live cutoff (downloads all drug files).

The global **q-value slider** re-thresholds per-drug views live. Cross-drug
views (home strips, landscape, pathway pages, instant rank) use the fixed
reference cutoff q < 0.05 baked into `summary.json` and say so in their legends.

## Data

`public/data/` is produced by two scripts:

1. `build_frontend_data.py` (upstream pipeline, not in this repo) writes
   `manifest.json` + `drugs/<slug>.json` — columnar significance records.
2. `scripts/build_summary.py` (this repo) derives `public/data/summary.json`
   — compact per-drug per-pathway significant-call counts at q < 0.05 that
   power all cross-drug views without downloading the ~240 MB of drug files:

```bash
python3 scripts/build_summary.py
```

Re-run it whenever the drug files are regenerated.

## Run locally

```bash
npm install
npm run dev
```

## Build & checks

```bash
npm run build   # tsc -b && vite build
npm run lint
```

## Deploy to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on push to `main`/`master`
(Settings → Pages → Source: GitHub Actions). The production base path is
`/clusterpairs/` in `vite.config.ts` — update it if the repo name differs.
