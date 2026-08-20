// significance.ts: pure functions over the columnar cells. No React here, so
// this module is unit-tested directly in Node. All thresholding uses nlp >= thr
// where thr = -log10(cutoff), keeping the cutoff a live UI control.

import type { DrugData, DrugMeta, SummaryDrug } from './types';

export const thrFromCutoff = (cutoff: number): number => -Math.log10(cutoff);

// nlp at which the color scale saturates (very-significant cells look the same).
export const SIG_MAX = 30;

// The fixed reference threshold (q = 0.05). Row ordering and color anchoring
// use it so rows don't jump and colors stay comparable while the live slider
// moves; membership filtering always uses the live thr.
export const BASE_THR = thrFromCutoff(0.05);

const PATHWAY_STRIDE = 100000; // > number of pathways; used to encode cell keys

// ---- explorer: pairwise pathway x query-cluster ----------------------------
// For one stream, per pathway, count how many reference clusters are significant
// in each query cluster. `refs` keeps the full per-reference breakdown for the
// hover tooltip; `nlps` keeps every record's strength for the survival sparkline.
export interface PathwayCell {
  count: number;
  countUp: number;
  countDown: number;
  refs: Array<{ nlp: number; sign: number } | null>; // by ref index; null = not in output
}
export interface PathwayRow {
  pathway: number;
  total: number;      // significant cells at the live thr
  baseTotal: number;  // significant cells at BASE_THR (stable sort key)
  nlps: number[];     // every record's nlp for this (stream, pathway)
  perQuery: PathwayCell[];
}

export function explorerByPathway(d: DrugData, streamIdx: number, thr: number): PathwayRow[] {
  const nQuery = d.query_clusters.length;
  const nRef = d.ref_clusters.length;
  const rows = new Map<number, PathwayRow>();
  const c = d.pairwise;
  for (let k = 0; k < c.stream.length; k += 1) {
    if (c.stream[k] !== streamIdx) continue;
    const p = c.pathway[k];
    let row = rows.get(p);
    if (!row) {
      row = {
        pathway: p,
        total: 0,
        baseTotal: 0,
        nlps: [],
        perQuery: Array.from({ length: nQuery }, () => ({
          count: 0, countUp: 0, countDown: 0,
          refs: Array.from({ length: nRef }, () => null),
        })),
      };
      rows.set(p, row);
    }
    row.nlps.push(c.nlp[k]);
    const cell = row.perQuery[c.query[k]];
    cell.refs[c.ref[k]] = { nlp: c.nlp[k], sign: c.sign[k] };
    if (c.nlp[k] >= BASE_THR) row.baseTotal += 1;
    if (c.nlp[k] < thr) continue;
    cell.count += 1;
    if (c.sign[k] > 0) cell.countUp += 1;
    else if (c.sign[k] < 0) cell.countDown += 1;
    row.total += 1;
  }
  return [...rows.values()]
    .filter((r) => r.total > 0)
    .sort((a, b) => b.baseTotal - a.baseTotal || b.total - a.total || a.pathway - b.pathway);
}

/** Reverse-cumulative significance counts for a sparkline: N records with nlp >= x. */
export function survival(nlps: number[], xs: number[]): number[] {
  return xs.map((x) => {
    let n = 0;
    for (let i = 0; i < nlps.length; i += 1) if (nlps[i] >= x) n += 1;
    return n;
  });
}

// ---- explorer: one-vs-rest signature (per cluster, no ref axis) -------------
export interface OvrRow {
  pathway: number;
  perCluster: Array<{ nlp: number; sign: number } | null>;
  nSig: number;
}

export function ovrByPathway(d: DrugData, streamIdx: number, cond: number, thr: number): OvrRow[] {
  const clusters = cond === 0 ? d.ref_clusters : d.query_clusters;
  const nC = clusters.length;
  const rows = new Map<number, OvrRow>();
  const c = d.ovr;
  for (let k = 0; k < c.stream.length; k += 1) {
    if (c.stream[k] !== streamIdx || c.cond[k] !== cond) continue;
    const p = c.pathway[k];
    let row = rows.get(p);
    if (!row) {
      row = { pathway: p, perCluster: Array.from({ length: nC }, () => null), nSig: 0 };
      rows.set(p, row);
    }
    row.perCluster[c.cluster[k]] = { nlp: c.nlp[k], sign: c.sign[k] };
    if (c.nlp[k] >= thr) row.nSig += 1;
  }
  return [...rows.values()].sort((a, b) => b.nSig - a.nSig);
}

// ---- cluster pairs: ref x query matrix of significant-pathway counts --------
export interface PairMatrix { counts: number[][]; max: number; tested: number[][]; }

export function pairMatrix(d: DrugData, streamIdx: number, thr: number): PairMatrix {
  const nRef = d.ref_clusters.length;
  const nQuery = d.query_clusters.length;
  const counts = Array.from({ length: nRef }, () => new Array<number>(nQuery).fill(0));
  const tested = Array.from({ length: nRef }, () => new Array<number>(nQuery).fill(0));
  const c = d.pairwise;
  let max = 0;
  for (let k = 0; k < c.stream.length; k += 1) {
    if (c.stream[k] !== streamIdx) continue;
    tested[c.ref[k]][c.query[k]] += 1;
    if (c.nlp[k] < thr) continue;
    const v = (counts[c.ref[k]][c.query[k]] += 1);
    if (v > max) max = v;
  }
  return { counts, max, tested };
}

// ---- method agreement: one cluster pair, pathway x stream ------------------
export interface CellVal { nlp: number; sign: number; }

export function pairwiseAt(
  d: DrugData, refIdx: number, queryIdx: number, nStreams: number,
): Map<number, Array<CellVal | null>> {
  const rows = new Map<number, Array<CellVal | null>>();
  const c = d.pairwise;
  for (let k = 0; k < c.stream.length; k += 1) {
    if (c.ref[k] !== refIdx || c.query[k] !== queryIdx) continue;
    const p = c.pathway[k];
    let row = rows.get(p);
    if (!row) { row = Array.from({ length: nStreams }, () => null); rows.set(p, row); }
    row[c.stream[k]] = { nlp: c.nlp[k], sign: c.sign[k] };
  }
  return rows;
}

// ---- method agreement: stream x stream concordance over all cells ----------
// Jaccard of the sets of significant (ref, query, pathway) cells. NaN when both
// streams have zero significant cells (undefined overlap).
export interface Concordance {
  jaccard: number[][];
  inter: number[][];
  union: number[][];
  sizes: number[];
}

export function concordance(d: DrugData, thr: number, nStreams: number): Concordance {
  const nQuery = d.query_clusters.length;
  const sets: Array<Set<number>> = Array.from({ length: nStreams }, () => new Set<number>());
  const c = d.pairwise;
  for (let k = 0; k < c.stream.length; k += 1) {
    if (c.nlp[k] < thr) continue;
    const key = (c.ref[k] * nQuery + c.query[k]) * PATHWAY_STRIDE + c.pathway[k];
    sets[c.stream[k]].add(key);
  }
  const sizes = sets.map((s) => s.size);
  const mk = () => Array.from({ length: nStreams }, () => new Array<number>(nStreams).fill(0));
  const jaccard = mk(); const inter = mk(); const union = mk();
  for (let i = 0; i < nStreams; i += 1) {
    for (let j = 0; j < nStreams; j += 1) {
      if (i === j) {
        inter[i][j] = sizes[i]; union[i][j] = sizes[i];
        jaccard[i][j] = sizes[i] === 0 ? NaN : 1;
        continue;
      }
      const a = sets[i]; const b = sets[j];
      const [small, large] = a.size <= b.size ? [a, b] : [b, a];
      let n = 0;
      small.forEach((x) => { if (large.has(x)) n += 1; });
      const u = a.size + b.size - n;
      inter[i][j] = n; union[i][j] = u;
      jaccard[i][j] = u === 0 ? NaN : n / u;
    }
  }
  return { jaccard, inter, union, sizes };
}

// ---- cross-drug ranking by significant cluster-pairs over chosen pathways ---
export interface DrugRank { meta: DrugMeta; total: number; perStream: number[]; }

export function rankDrugs(
  all: Array<{ meta: DrugMeta; data: DrugData }>,
  selectedPathways: number[],
  thr: number,
  nStreams: number,
): DrugRank[] {
  const sel = new Set(selectedPathways);
  const ranked = all.map(({ meta, data }) => {
    const perStream = new Array<number>(nStreams).fill(0);
    const c = data.pairwise;
    for (let k = 0; k < c.stream.length; k += 1) {
      if (c.nlp[k] < thr || !sel.has(c.pathway[k])) continue;
      perStream[c.stream[k]] += 1;
    }
    const total = perStream.reduce((s, v) => s + v, 0);
    return { meta, total, perStream };
  });
  return ranked
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.meta.name.localeCompare(b.meta.name));
}

// ---- summary-derived helpers (fixed reference cutoff) -----------------------
// Direction classification of an aggregated (up, down, uns, tested) cell.
// CellSpectra's unsigned calls never vote on direction: a cell only reads
// up/down when signed calls dominate, and 'mixed' when they split.
export interface DirCell { a: number; kind: 'up' | 'down' | 'mixed' | 'uns' | 'ns'; }

export function classifyCounts(up: number, down: number, uns: number, tested: number): DirCell {
  const sig = up + down + uns;
  if (tested <= 0 || sig === 0) return { a: 0, kind: 'ns' };
  const a = sig / tested;
  const signed = up + down;
  if (signed < sig * 0.25) return { a, kind: 'uns' };
  const dir = (up - down) / signed;
  if (dir > 0.2) return { a, kind: 'up' };
  if (dir < -0.2) return { a, kind: 'down' };
  return { a, kind: 'mixed' };
}

/** Overall significant fraction for a summary drug. */
export const drugActivity = (d: SummaryDrug): number =>
  d.records > 0 ? d.sig / d.records : 0;

/** Per-pathway activity fraction. */
export const pathwayActivity = (d: SummaryDrug, p: number): number =>
  d.tested[p] > 0 ? (d.up[p] + d.down[p] + d.uns[p]) / d.tested[p] : 0;

/**
 * Selectivity: 1 - normalized entropy of the pathway activity distribution.
 * 1 ~ all significance concentrated in one pathway; 0 ~ spread evenly.
 */
export function drugSelectivity(d: SummaryDrug): number {
  const n = d.tested.length;
  let sum = 0;
  const acts = new Array<number>(n);
  for (let p = 0; p < n; p += 1) { acts[p] = pathwayActivity(d, p); sum += acts[p]; }
  if (sum <= 0) return 0;
  let h = 0;
  for (let p = 0; p < n; p += 1) {
    const q = acts[p] / sum;
    if (q > 0) h -= q * Math.log(q);
  }
  return 1 - h / Math.log(n);
}

/** Top pathway indices for a summary drug, by activity, optionally by direction. */
export function topPathways(d: SummaryDrug, n: number, kind?: 'up' | 'down'): number[] {
  const score = (p: number): number => {
    if (d.tested[p] <= 0) return 0;
    if (kind === 'up') return d.up[p] / d.tested[p];
    if (kind === 'down') return d.down[p] / d.tested[p];
    return pathwayActivity(d, p);
  };
  return d.tested
    .map((_, p) => p)
    .filter((p) => score(p) > 0)
    .sort((a, b) => score(b) - score(a))
    .slice(0, n);
}
