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

// ============================== statistics ==================================
// Exact-ish inference without dependencies. The regularized incomplete beta
// function I_x(a,b) (Numerical Recipes betacf/betai) powers both the Student-t
// two-tailed p-value and the exact binomial sign test.

function lnGamma(x: number): number {
  // Lanczos approximation, |error| < 2e-10 for x > 0
  const g = [76.180091729471457, -86.505320329416776, 24.014098240830911,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j += 1) { y += 1; ser += g[j] / y; }
  return -tmp + Math.log(2.5066282746310002 * ser / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300; const EPS = 3e-12; const FPMIN = 1e-300;
  const qab = a + b; const qap = a + 1; const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-tailed p-value for a Student-t statistic with df degrees of freedom. */
export function tTwoTailedP(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  return betai(df / 2, 0.5, df / (df + t * t));
}

/** Upper 97.5% Student-t quantile (for 95% CIs), by bisection. */
export function tQuantile975(df: number): number {
  let lo = 0; let hi = 100;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (tTwoTailedP(mid, df) > 0.05) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface CorrTest { r: number; t: number; p: number; n: number }

/** Pearson correlation with a two-tailed t-test (df = n − 2). */
export function pearsonTest(xs: number[], ys: number[]): CorrTest {
  const n = xs.length;
  const r = pearson(xs, ys);
  if (n < 3 || !Number.isFinite(r)) return { r: NaN, t: NaN, p: NaN, n };
  const rc = Math.max(-0.999999999, Math.min(0.999999999, r));
  const t = rc * Math.sqrt((n - 2) / (1 - rc * rc));
  return { r, t, p: tTwoTailedP(t, n - 2), n };
}

/** Ranks with average ties. */
function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation with the t approximation (fine for n ≫ 30). */
export function spearmanTest(xs: number[], ys: number[]): CorrTest {
  const test = pearsonTest(ranks(xs), ranks(ys));
  return test;
}

export interface OlsFit {
  slope: number; intercept: number; r2: number;
  seSlope: number; ci95: number;      // slope ± ci95
  n: number; meanX: number; sxx: number; sigma: number; tCrit: number;
}

/** Ordinary least squares y = a + b·x with slope CI and confidence band. */
export function olsFit(xs: number[], ys: number[]): OlsFit {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0; let sxy = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx; const dy = ys[i] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i += 1) {
    const e = ys[i] - (intercept + slope * xs[i]);
    sse += e * e;
  }
  const sigma = Math.sqrt(sse / (n - 2));
  const seSlope = sigma / Math.sqrt(sxx);
  const tCrit = tQuantile975(n - 2);
  const r2 = syy > 0 ? 1 - sse / syy : NaN;
  return { slope, intercept, r2, seSlope, ci95: tCrit * seSlope, n, meanX: mx, sxx, sigma, tCrit };
}

/** Half-width of the 95% confidence band for the MEAN response at x. */
export function olsBandAt(f: OlsFit, x: number): number {
  return f.tCrit * f.sigma * Math.sqrt(1 / f.n + ((x - f.meanX) ** 2) / f.sxx);
}

/**
 * Exact two-sided sign test: k successes of n at null P=0.5.
 * P(X ≥ k) = I_0.5(k, n − k + 1); two-sided = 2·min(tails), capped at 1.
 */
export function signTestP(k: number, n: number): number {
  if (n === 0) return NaN;
  const pGE = k === 0 ? 1 : betai(k, n - k + 1, 0.5);
  const pLE = k === n ? 1 : 1 - betai(k + 1, n - k, 0.5);
  return Math.min(1, 2 * Math.min(pGE, pLE));
}

/**
 * Partial Pearson correlation of x and y controlling for z (residualize both
 * on z, then correlate the residuals). Used to remove the shared drug-potency
 * factor (per-drug mean activity) from pathway–pathway correlations.
 */
export function partialPearsonTest(xs: number[], ys: number[], zs: number[]): CorrTest {
  const resid = (v: number[]): number[] => {
    const f = olsFit(zs, v);
    return v.map((y, i) => y - (f.intercept + f.slope * zs[i]));
  };
  const t = pearsonTest(resid(xs), resid(ys));
  // one fewer df for the controlled variable
  const n = t.n;
  const rc = Math.max(-0.999999999, Math.min(0.999999999, t.r));
  const tt = rc * Math.sqrt((n - 3) / (1 - rc * rc));
  return { r: t.r, t: tt, p: tTwoTailedP(tt, n - 3), n };
}

// ================================ lasso =====================================
// L1-regularized least squares over the full regularization path, solved by
// cyclic coordinate descent with warm starts (the glmnet algorithm, minus the
// Fortran). Predictors are standardized per fit; coefficients are reported on
// the standardized scale so |β| is comparable across pathways. λ is chosen by
// k-fold cross-validation (λ-min and the more parsimonious λ-1SE).

const softThreshold = (z: number, g: number): number =>
  z > g ? z - g : z < -g ? z + g : 0;

interface Standardized { Z: Float64Array[]; mean: number[]; sd: number[] }

function standardizeCols(X: number[][], rows: number[]): Standardized {
  const p = X[0]?.length ?? 0;
  const n = rows.length;
  const mean = new Array<number>(p).fill(0);
  const sd = new Array<number>(p).fill(0);
  for (let j = 0; j < p; j += 1) {
    let s = 0;
    for (const i of rows) s += X[i][j];
    mean[j] = s / n;
    let v = 0;
    for (const i of rows) { const d = X[i][j] - mean[j]; v += d * d; }
    sd[j] = Math.sqrt(v / n) || 1; // constant column -> z stays 0, β stays 0
  }
  const Z = rows.map((i) => {
    const z = new Float64Array(p);
    for (let j = 0; j < p; j += 1) z[j] = (X[i][j] - mean[j]) / sd[j];
    return z;
  });
  return { Z, mean, sd };
}

/** Coordinate descent for one λ (Z standardized, resid = y − Zβ). Mutates beta/resid. */
function cdFit(Z: Float64Array[], beta: Float64Array, resid: number[], lambda: number): void {
  const n = Z.length;
  const p = beta.length;
  for (let iter = 0; iter < 300; iter += 1) {
    let maxDelta = 0;
    for (let j = 0; j < p; j += 1) {
      let rho = 0;
      for (let i = 0; i < n; i += 1) rho += Z[i][j] * resid[i];
      rho = rho / n + beta[j]; // column variance is 1 by construction
      const nb = softThreshold(rho, lambda);
      const d = nb - beta[j];
      if (d !== 0) {
        for (let i = 0; i < n; i += 1) resid[i] -= Z[i][j] * d;
        beta[j] = nb;
        const ad = Math.abs(d);
        if (ad > maxDelta) maxDelta = ad;
      }
    }
    if (maxDelta < 1e-7) break;
  }
}

export interface LassoResult {
  lambdas: number[];        // descending grid
  betas: Float64Array[];    // standardized coefficients per λ
  r2: number[];             // in-sample R² per λ
  nnz: number[];            // nonzero count per λ
  cvMse: number[];
  cvSe: number[];
  iMin: number;             // index of CV-minimum λ
  i1se: number;             // largest λ within 1 SE of the minimum
  yVar: number;             // variance of y (for CV R²)
}

/**
 * Full lasso path with k-fold CV. X is n×p in original units, y length n.
 * CV standardizes inside each training fold (no leakage) and evaluates MSE
 * in original y units.
 */
export function lassoPath(
  X: number[][], y: number[], nLambda = 60, kFold = 5, seed = 1234,
): LassoResult {
  const n = y.length;
  const p = X[0]?.length ?? 0;
  const all = Array.from({ length: n }, (_, i) => i);

  // λ grid from the full data
  const full = standardizeCols(X, all);
  const ymean = y.reduce((s, v) => s + v, 0) / n;
  const yc = y.map((v) => v - ymean);
  const yVar = yc.reduce((s, v) => s + v * v, 0) / n;
  let lmax = 0;
  for (let j = 0; j < p; j += 1) {
    let dot = 0;
    for (let i = 0; i < n; i += 1) dot += full.Z[i][j] * yc[i];
    lmax = Math.max(lmax, Math.abs(dot) / n);
  }
  lmax = lmax || 1;
  const ratio = 1e-3;
  const lambdas = Array.from({ length: nLambda }, (_, k) => lmax * ratio ** (k / (nLambda - 1)));

  // full-data path (warm starts)
  const betas: Float64Array[] = [];
  const r2: number[] = [];
  const nnz: number[] = [];
  {
    const beta = new Float64Array(p);
    const resid = [...yc];
    for (const lam of lambdas) {
      cdFit(full.Z, beta, resid, lam);
      betas.push(new Float64Array(beta));
      const sse = resid.reduce((s, v) => s + v * v, 0);
      r2.push(yVar > 0 ? 1 - sse / (yVar * n) : NaN);
      nnz.push(beta.reduce((s, v) => s + (v !== 0 ? 1 : 0), 0));
    }
  }

  // k-fold CV (seeded shuffle, per-fold standardization, warm starts)
  const order = [...all];
  const rand = rng(seed);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const foldMse: number[][] = Array.from({ length: nLambda }, () => []);
  for (let f = 0; f < kFold; f += 1) {
    const test = order.filter((_, idx) => idx % kFold === f);
    const train = order.filter((_, idx) => idx % kFold !== f);
    const st = standardizeCols(X, train);
    const tymean = train.reduce((s, i) => s + y[i], 0) / train.length;
    const tyc = train.map((i) => y[i] - tymean);
    const beta = new Float64Array(p);
    const resid = [...tyc];
    for (let k = 0; k < nLambda; k += 1) {
      cdFit(st.Z, beta, resid, lambdas[k]);
      let mse = 0;
      for (const i of test) {
        let yh = tymean;
        for (let j = 0; j < p; j += 1) {
          if (beta[j] !== 0) yh += beta[j] * ((X[i][j] - st.mean[j]) / st.sd[j]);
        }
        mse += (y[i] - yh) ** 2;
      }
      foldMse[k].push(mse / test.length);
    }
  }
  const cvMse = foldMse.map((ms) => ms.reduce((s, v) => s + v, 0) / ms.length);
  const cvSe = foldMse.map((ms, k) => {
    const m = cvMse[k];
    const v = ms.reduce((s, x) => s + (x - m) ** 2, 0) / (ms.length - 1);
    return Math.sqrt(v / ms.length);
  });
  let iMin = 0;
  for (let k = 1; k < nLambda; k += 1) if (cvMse[k] < cvMse[iMin]) iMin = k;
  let i1se = iMin;
  for (let k = 0; k <= iMin; k += 1) {
    if (cvMse[k] <= cvMse[iMin] + cvSe[iMin]) { i1se = k; break; }
  }
  return { lambdas, betas, r2, nnz, cvMse, cvSe, iMin, i1se, yVar };
}
