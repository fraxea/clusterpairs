// analysis.ts — hand-rolled graph/matrix analysis over summary.json.
// Pure functions, no React, no dependencies: drug fingerprints, kNN similarity
// graphs, label-propagation communities, a force-directed layout, pathway
// correlation, and seriation (PC1 ordering + average-linkage clustering).
// Everything is seeded/deterministic so layouts are reproducible.

import type { SummaryDrug } from './types';

// ------------------------------------------------------------ seeded rng ----
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------- fingerprints ----
/**
 * 150-dim signature per drug: per pathway the fraction of tests significant
 * up / down / unsigned (q < 0.05). Direction comes only from the signed
 * streams (GSEA/fgsea — ORA and CellSpectra are unsigned by construction).
 */
export function drugFingerprints(drugs: SummaryDrug[]): Float64Array[] {
  return drugs.map((d) => {
    const n = d.tested.length;
    const v = new Float64Array(3 * n);
    for (let p = 0; p < n; p += 1) {
      const t = d.tested[p];
      if (t > 0) {
        v[p] = d.up[p] / t;
        v[n + p] = d.down[p] / t;
        v[2 * n + p] = d.uns[p] / t;
      }
    }
    return v;
  });
}

/**
 * Center vectors on the per-dimension library mean. Raw activity fingerprints
 * are non-negative and dominated by the shared unsigned channel (~90% of the
 * norm), which compresses all cosines into [0.8, 1]; centering spreads the
 * distribution so similarity thresholds and edge weights become meaningful.
 */
export function centerVectors(vecs: Float64Array[]): Float64Array[] {
  const n = vecs.length;
  if (n === 0) return [];
  const d = vecs[0].length;
  const mean = new Float64Array(d);
  for (const v of vecs) for (let i = 0; i < d; i += 1) mean[i] += v[i];
  for (let i = 0; i < d; i += 1) mean[i] /= n;
  return vecs.map((v) => {
    const c = new Float64Array(d);
    for (let i = 0; i < d; i += 1) c[i] = v[i] - mean[i];
    return c;
  });
}

export function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

// ------------------------------------------------------------- kNN graph ----
export interface Edge { a: number; b: number; w: number }

/** Undirected union of each node's top-k cosine neighbors above minSim. */
export function knnEdges(vecs: Float64Array[], k: number, minSim: number): Edge[] {
  const n = vecs.length;
  const sim = (i: number, j: number) => cosine(vecs[i], vecs[j]);
  const seen = new Map<number, Edge>();
  for (let i = 0; i < n; i += 1) {
    const cand: Array<{ j: number; w: number }> = [];
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      const w = sim(i, j);
      if (w >= minSim) cand.push({ j, w });
    }
    cand.sort((x, y) => y.w - x.w);
    for (const { j, w } of cand.slice(0, k)) {
      const key = i < j ? i * n + j : j * n + i;
      const prev = seen.get(key);
      if (!prev || w > prev.w) seen.set(key, { a: Math.min(i, j), b: Math.max(i, j), w });
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------- label-propagation groups ----
/**
 * Weighted label propagation on an undirected graph. Labels are relabeled by
 * community size (0 = largest). Deterministic via seeded iteration order.
 */
export function communities(n: number, edges: Edge[], seed = 42): { label: number[]; count: number } {
  const adj: Array<Array<{ j: number; w: number }>> = Array.from({ length: n }, () => []);
  for (const e of edges) {
    adj[e.a].push({ j: e.b, w: e.w });
    adj[e.b].push({ j: e.a, w: e.w });
  }
  const label = Array.from({ length: n }, (_, i) => i);
  const order = Array.from({ length: n }, (_, i) => i);
  const rand = rng(seed);
  for (let iter = 0; iter < 30; iter += 1) {
    // Fisher–Yates with the seeded rng
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let changed = 0;
    for (const i of order) {
      if (adj[i].length === 0) continue;
      const votes = new Map<number, number>();
      for (const { j, w } of adj[i]) votes.set(label[j], (votes.get(label[j]) ?? 0) + w);
      let best = label[i]; let bestW = -1;
      votes.forEach((w, l) => {
        if (w > bestW || (w === bestW && l < best)) { best = l; bestW = w; }
      });
      if (best !== label[i]) { label[i] = best; changed += 1; }
    }
    if (changed === 0) break;
  }
  // relabel by size desc (stable for ties)
  const sizes = new Map<number, number>();
  for (const l of label) sizes.set(l, (sizes.get(l) ?? 0) + 1);
  const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const remap = new Map(ranked.map(([l], idx) => [l, idx]));
  return { label: label.map((l) => remap.get(l) ?? 0), count: ranked.length };
}

/**
 * Consensus communities: a single label-propagation run is a seed artifact
 * (ARI ≈ 0.6 across seeds on this data), so run it `runs` times and keep only
 * co-assignments that agree in ≥ minAgree of runs. The result is the
 * connected components of the stable edges — deterministic and conservative.
 */
export function consensusCommunities(
  n: number, edges: Edge[], runs = 24, minAgree = 0.7,
): { label: number[]; count: number } {
  const agree = new Array<number>(edges.length).fill(0);
  for (let r = 0; r < runs; r += 1) {
    const { label } = communities(n, edges, 1000 + r * 7919);
    for (let e = 0; e < edges.length; e += 1) {
      if (label[edges[e].a] === label[edges[e].b]) agree[e] += 1;
    }
  }
  // union-find over the stable edges
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx; }
    return r;
  };
  for (let e = 0; e < edges.length; e += 1) {
    if (agree[e] / runs >= minAgree) {
      const a = find(edges[e].a); const b = find(edges[e].b);
      if (a !== b) parent[a] = b;
    }
  }
  const label = Array.from({ length: n }, (_, i) => find(i));
  const sizes = new Map<number, number>();
  for (const l of label) sizes.set(l, (sizes.get(l) ?? 0) + 1);
  const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const remap = new Map(ranked.map(([l], idx) => [l, idx]));
  return { label: label.map((l) => remap.get(l) ?? 0), count: ranked.length };
}

/**
 * Per-community DIFFERENTIAL themes: the pathway signals where the community
 * mean deviates most from the whole-library mean. (Absolute tops are useless
 * here — every drug in a tumor-line screen hits the proliferation program, so
 * all communities would read "Mitotic Spindle".)
 */
export interface CommunityTheme {
  size: number;
  top: Array<{ pathway: number; kind: 'up' | 'down' | 'uns'; delta: number }>;
}
export function communityThemes(
  drugs: SummaryDrug[], label: number[], count: number, topN = 2,
): CommunityTheme[] {
  const nP = drugs[0]?.tested.length ?? 0;
  const meanOf = (members: SummaryDrug[]): Float64Array => {
    const m = new Float64Array(3 * nP);
    for (const d of members) {
      for (let p = 0; p < nP; p += 1) {
        const t = d.tested[p];
        if (t > 0) {
          m[p] += d.up[p] / t;
          m[nP + p] += d.down[p] / t;
          m[2 * nP + p] += d.uns[p] / t;
        }
      }
    }
    if (members.length > 0) for (let i = 0; i < m.length; i += 1) m[i] /= members.length;
    return m;
  };
  const global = meanOf(drugs);
  const out: CommunityTheme[] = [];
  for (let c = 0; c < count; c += 1) {
    const members = drugs.filter((_, i) => label[i] === c);
    const mean = meanOf(members);
    const scored = Array.from({ length: nP }, (_, p) => {
      const dUp = mean[p] - global[p];
      const dDown = mean[nP + p] - global[nP + p];
      const dUns = mean[2 * nP + p] - global[2 * nP + p];
      const best = Math.max(dUp, dDown, dUns);
      const kind: 'up' | 'down' | 'uns' = best === dUp ? 'up' : best === dDown ? 'down' : 'uns';
      return { pathway: p, kind, delta: best };
    }).sort((a, b) => b.delta - a.delta);
    out.push({ size: members.length, top: scored.slice(0, topN) });
  }
  return out;
}

// ----------------------------------------------------------- force layout ----
export interface ForceSim {
  x: Float64Array; y: Float64Array;
  /** advance the simulation; returns remaining alpha (0 = settled) */
  tick(iters: number): number;
}

/**
 * Basic force-directed layout: pairwise repulsion, springs on edges (rest
 * length shrinks with similarity), weak centering, velocity damping with
 * alpha decay. Positions live in an arbitrary space — normalize when drawing.
 */
export function createForceSim(n: number, edges: Edge[], seed = 7): ForceSim {
  const rand = rng(seed);
  const x = new Float64Array(n); const y = new Float64Array(n);
  const vx = new Float64Array(n); const vy = new Float64Array(n);
  const R = Math.sqrt(n) * 12;
  for (let i = 0; i < n; i += 1) {
    const a = 2 * Math.PI * rand(); const r = R * Math.sqrt(rand());
    x[i] = r * Math.cos(a); y[i] = r * Math.sin(a);
  }
  const REPULSE = 220;
  const SPRING = 0.06;
  const CENTER = 0.012;
  let alpha = 1;

  const step = () => {
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = x[i] - x[j]; let dy = y[i] - y[j];
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = (rand() - 0.5); dy = (rand() - 0.5); d2 = dx * dx + dy * dy; }
        // clamp the near field: an unbounded 1/d² impulse from one close pair
        // can fling a node across the layout and pin the fit-to-bounds scale
        d2 = Math.max(d2, 25);
        const f = (REPULSE * alpha) / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f; const fy = (dy / d) * f;
        vx[i] += fx; vy[i] += fy; vx[j] -= fx; vy[j] -= fy;
      }
    }
    for (const e of edges) {
      const dx = x[e.b] - x[e.a]; const dy = y[e.b] - y[e.a];
      const d = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
      const rest = 26 * (1.35 - e.w); // similar nodes pull closer
      const f = SPRING * alpha * (d - rest) * Math.min(1, e.w + 0.3);
      vx[e.a] += (dx / d) * f; vy[e.a] += (dy / d) * f;
      vx[e.b] -= (dx / d) * f; vy[e.b] -= (dy / d) * f;
    }
    for (let i = 0; i < n; i += 1) {
      vx[i] -= x[i] * CENTER * alpha; vy[i] -= y[i] * CENTER * alpha;
      vx[i] *= 0.6; vy[i] *= 0.6;
      x[i] += vx[i]; y[i] += vy[i];
    }
    alpha *= 0.99;
  };

  return {
    x, y,
    tick(iters: number) {
      for (let k = 0; k < iters && alpha > 0.003; k += 1) step();
      return alpha <= 0.003 ? 0 : alpha;
    },
  };
}

// ---------------------------------------------------- pathway correlation ----
/** [pathway][drug] activity fractions at the reference cutoff. */
export function pathwayActivityMatrix(drugs: SummaryDrug[]): number[][] {
  const nP = drugs[0]?.tested.length ?? 0;
  return Array.from({ length: nP }, (_, p) =>
    drugs.map((d) => (d.tested[p] > 0 ? (d.up[p] + d.down[p] + d.uns[p]) / d.tested[p] : 0)));
}

export function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n === 0) return 0;
  let ma = 0; let mb = 0;
  for (let i = 0; i < n; i += 1) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let cov = 0; let va = 0; let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - ma; const db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  const d = Math.sqrt(va * vb);
  return d === 0 ? 0 : cov / d;
}

/** Positive-correlation kNN edges between rows of `mat` (co-response). */
export function corrEdges(mat: number[][], k: number, minR: number): Edge[] {
  const n = mat.length;
  const corr: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const r = pearson(mat[i], mat[j]);
      corr[i][j] = r; corr[j][i] = r;
    }
  }
  const seen = new Map<number, Edge>();
  for (let i = 0; i < n; i += 1) {
    const cand = Array.from({ length: n }, (_, j) => ({ j, w: corr[i][j] }))
      .filter(({ j, w }) => j !== i && w >= minR)
      .sort((x, y) => y.w - x.w)
      .slice(0, k);
    for (const { j, w } of cand) {
      const key = i < j ? i * n + j : j * n + i;
      if (!seen.has(key)) seen.set(key, { a: Math.min(i, j), b: Math.max(i, j), w });
    }
  }
  return [...seen.values()];
}

// --------------------------------------------------------------- ordering ----
/** Scores along the first principal component (power iteration). */
export function pc1Scores(vecs: Float64Array[]): number[] {
  const n = vecs.length;
  if (n === 0) return [];
  const d = vecs[0].length;
  const mean = new Float64Array(d);
  for (const v of vecs) for (let i = 0; i < d; i += 1) mean[i] += v[i];
  for (let i = 0; i < d; i += 1) mean[i] /= n;

  const rand = rng(1234);
  let w = new Float64Array(d);
  for (let i = 0; i < d; i += 1) w[i] = rand() - 0.5;
  const scores = new Float64Array(n);
  for (let it = 0; it < 60; it += 1) {
    // scores = X w ; w' = Xᵀ scores (X centered)
    for (let r = 0; r < n; r += 1) {
      let s = 0;
      const v = vecs[r];
      for (let i = 0; i < d; i += 1) s += (v[i] - mean[i]) * w[i];
      scores[r] = s;
    }
    const nw = new Float64Array(d);
    for (let r = 0; r < n; r += 1) {
      const v = vecs[r]; const s = scores[r];
      for (let i = 0; i < d; i += 1) nw[i] += (v[i] - mean[i]) * s;
    }
    let norm = 0;
    for (let i = 0; i < d; i += 1) norm += nw[i] * nw[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < d; i += 1) nw[i] /= norm;
    w = nw;
  }
  for (let r = 0; r < n; r += 1) {
    let s = 0;
    const v = vecs[r];
    for (let i = 0; i < d; i += 1) s += (v[i] - mean[i]) * w[i];
    scores[r] = s;
  }
  return [...scores];
}

/**
 * Average-linkage agglomerative clustering (Lance–Williams update) over a
 * distance matrix; returns the dendrogram leaf order. O(n³) — fine for n ≤ ~400.
 */
export function averageLinkageOrder(dist: number[][]): number[] {
  const n = dist.length;
  if (n === 0) return [];
  interface Cluster { items: number[]; size: number }
  const clusters: Array<Cluster | null> = Array.from({ length: n }, (_, i) => ({ items: [i], size: 1 }));
  // working copy of distances between cluster slots
  const D = dist.map((row) => [...row]);
  let active = n;
  while (active > 1) {
    let bi = -1; let bj = -1; let best = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (!clusters[i]) continue;
      for (let j = i + 1; j < n; j += 1) {
        if (!clusters[j]) continue;
        if (D[i][j] < best) { best = D[i][j]; bi = i; bj = j; }
      }
    }
    const A = clusters[bi] as Cluster; const B = clusters[bj] as Cluster;
    // merge j into i; update distances (average linkage)
    for (let k = 0; k < n; k += 1) {
      if (!clusters[k] || k === bi || k === bj) continue;
      const dk = (A.size * D[bi][k] + B.size * D[bj][k]) / (A.size + B.size);
      D[bi][k] = dk; D[k][bi] = dk;
    }
    clusters[bi] = { items: [...A.items, ...B.items], size: A.size + B.size };
    clusters[bj] = null;
    active -= 1;
  }
  const root = clusters.find((c) => c !== null);
  return root ? root.items : [];
}
