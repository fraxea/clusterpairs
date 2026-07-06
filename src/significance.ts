// significance.ts — pure functions over the columnar cells. No React here, so
// this module is unit-tested directly in Node. All thresholding uses nlp >= thr
// where thr = -log10(cutoff), keeping the cutoff a live UI control.

import type { DrugData, DrugMeta } from './types';

export const thrFromCutoff = (cutoff: number): number => -Math.log10(cutoff);

// nlp at which the color scale saturates (very-significant cells look the same).
export const SIG_MAX = 30;

const PATHWAY_STRIDE = 100000; // > number of pathways; used to encode cell keys

// ---- explorer: pairwise pathway x query-cluster ----------------------------
// For one stream, per pathway, count how many reference clusters are significant
// in each query cluster (the old app's idea, now re-thresholdable). `sign` is the
// summed direction of the significant refs (use its sign for coloring).
export interface PathwayRow {
  pathway: number;
  total: number;
  // count/sign is the old combined tally (kept for CellSpectra, where sign is
  // always 0 and there's no up/down to split). countUp/countDown split the
  // significant ref clusters by direction for signed methods.
  perQuery: Array<{ count: number; sign: number; countUp: number; countDown: number }>;
}

export function explorerByPathway(d: DrugData, streamIdx: number, thr: number): PathwayRow[] {
  const nQuery = d.query_clusters.length;
  const rows = new Map<number, PathwayRow>();
  const c = d.pairwise;
  for (let k = 0; k < c.stream.length; k += 1) {
    if (c.stream[k] !== streamIdx || c.nlp[k] < thr) continue;
    const p = c.pathway[k];
    let row = rows.get(p);
    if (!row) {
      row = {
        pathway: p,
        total: 0,
        perQuery: Array.from({ length: nQuery }, () => ({ count: 0, sign: 0, countUp: 0, countDown: 0 })),
      };
      rows.set(p, row);
    }
    const cell = row.perQuery[c.query[k]];
    cell.count += 1;
    cell.sign += c.sign[k];
    if (c.sign[k] > 0) cell.countUp += 1;
    else if (c.sign[k] < 0) cell.countDown += 1;
    row.total += 1;
  }
  return [...rows.values()].sort((a, b) => b.total - a.total);
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
export interface Concordance { jaccard: number[][]; sizes: number[]; }

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
  const jaccard: number[][] = Array.from({ length: nStreams }, () => Array(nStreams).fill(0));
  for (let i = 0; i < nStreams; i += 1) {
    for (let j = 0; j < nStreams; j += 1) {
      if (i === j) { jaccard[i][j] = sets[i].size === 0 ? NaN : 1; continue; }
      const a = sets[i]; const b = sets[j];
      const [small, large] = a.size <= b.size ? [a, b] : [b, a];
      let inter = 0;
      small.forEach((x) => { if (large.has(x)) inter += 1; });
      const union = a.size + b.size - inter;
      jaccard[i][j] = union === 0 ? NaN : inter / union;
    }
  }
  return { jaccard, sizes };
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
