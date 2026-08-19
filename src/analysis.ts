// analysis.ts — hand-rolled matrix analysis and statistics over summary.json.
// Pure functions, no React, no dependencies: drug fingerprints, pathway
// correlation, seriation (PC1 ordering + average-linkage clustering), exact
// inference (incomplete beta → t / sign tests), OLS, and the lasso path.
// Everything is seeded/deterministic so results are reproducible.

import type { PairwiseCells, SummaryDrug } from './types';

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

// ============================ connectivity ==================================
// CMap-style signature matching (Lamb 2006; Subramanian 2017's tau): a query
// signature (a drug's 50-dim net-direction vector, or a hand-built ±1 pathway
// set) is scored against every atlas drug by cosine. Positive = mimicker,
// negative = reverser. tau normalizes against each target's own background
// connectivity distribution; permutation p-values + BH-FDR support it.

export function cosine(a: Float64Array | number[], b: Float64Array | number[]): number {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/** 50-dim net-direction vector per drug: (up − down) / tested. */
export function netVectors(drugs: SummaryDrug[]): Float64Array[] {
  return drugs.map((d) => {
    const n = d.tested.length;
    const v = new Float64Array(n);
    for (let p = 0; p < n; p += 1) if (d.tested[p] > 0) v[p] = (d.up[p] - d.down[p]) / d.tested[p];
    return v;
  });
}

/** First principal axis (unit vector) of the drug × pathway matrix, by power iteration. */
export function pc1Axis(vecs: Float64Array[]): Float64Array {
  const n = vecs.length;
  const p = vecs[0]?.length ?? 0;
  const mean = new Float64Array(p);
  for (const v of vecs) for (let j = 0; j < p; j += 1) mean[j] += v[j] / n;
  const C = vecs.map((v) => {
    const c = new Float64Array(p);
    for (let j = 0; j < p; j += 1) c[j] = v[j] - mean[j];
    return c;
  });
  let u = new Float64Array(p).fill(1 / Math.sqrt(p));
  for (let iter = 0; iter < 120; iter += 1) {
    const w = new Float64Array(p);
    for (const c of C) {
      let dot = 0;
      for (let j = 0; j < p; j += 1) dot += c[j] * u[j];
      for (let j = 0; j < p; j += 1) w[j] += dot * c[j];
    }
    let norm = 0;
    for (let j = 0; j < p; j += 1) norm += w[j] * w[j];
    norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < p; j += 1) w[j] /= norm;
    u = w;
  }
  return u;
}

export interface ConnectivityHit {
  target: number;      // index into drugs
  cos: number;
  tau: number;         // signed percentile vs the target's atlas background
  p: number;           // two-sided permutation p
  fdr: number;         // BH across all targets
  generic: number;     // PC1-aligned share of the cosine
  specific: number;    // residual share (generic + specific = cos)
  contrib: Array<{ pathway: number; c: number }>; // top |per-pathway contributions|
}

/**
 * Background |cosine| distributions per target (each vs all other atlas
 * drugs), sorted ascending — the reference set for tau. O(n²·p), ~4M mults.
 */
export function connectivityBackground(vecs: Float64Array[]): number[][] {
  const n = vecs.length;
  const bg: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const c = Math.abs(cosine(vecs[i], vecs[j]));
      bg[i].push(c); bg[j].push(c);
    }
  }
  for (const b of bg) b.sort((a, x) => a - x);
  return bg;
}

const percentileOf = (sorted: number[], v: number): number => {
  let lo = 0; let hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  return sorted.length === 0 ? 0 : (100 * lo) / sorted.length;
};

/**
 * Score a query signature against every atlas drug. `exclude` drops the query
 * drug itself. nPerm seeded permutations of the query's coordinates give a
 * two-sided p per target; BH-FDR across targets.
 */
export function connectivity(
  vecs: Float64Array[], query: Float64Array | number[], bg: number[][],
  pc1: Float64Array, exclude = -1, nPerm = 1000, seed = 2024,
): ConnectivityHit[] {
  const n = vecs.length;
  const p = query.length;
  const obs = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) if (i !== exclude) obs[i] = cosine(query, vecs[i]);

  // permutation null: shuffle the query's coordinates (seeded Fisher–Yates)
  const rand = rng(seed);
  const perm = Array.from({ length: p }, (_, j) => j);
  const exceed = new Array<number>(n).fill(0);
  const qp = new Float64Array(p);
  for (let r = 0; r < nPerm; r += 1) {
    for (let i = p - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    for (let j = 0; j < p; j += 1) qp[j] = query[perm[j]] as number;
    for (let i = 0; i < n; i += 1) {
      if (i === exclude) continue;
      if (Math.abs(cosine(qp, vecs[i])) >= Math.abs(obs[i])) exceed[i] += 1;
    }
  }

  // exact cosine split along the atlas PC1 axis: cos = generic + specific
  const proj = (v: Float64Array | number[]): number => {
    let d = 0;
    for (let j = 0; j < p; j += 1) d += (v[j] as number) * pc1[j];
    return d;
  };
  const nrm = (v: Float64Array | number[]): number => {
    let s = 0;
    for (let j = 0; j < p; j += 1) s += (v[j] as number) ** 2;
    return Math.sqrt(s);
  };
  const qProj = proj(query); const qNorm = nrm(query);

  const hits: ConnectivityHit[] = [];
  for (let i = 0; i < n; i += 1) {
    if (i === exclude) continue;
    const tProj = proj(vecs[i]); const tNorm = nrm(vecs[i]);
    const denom = (qNorm * tNorm) || 1;
    const generic = (qProj * tProj) / denom;
    const contrib = [...vecs[i].keys()]
      .map((j) => ({ pathway: j, c: ((query[j] as number) * vecs[i][j]) / denom }))
      .sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
      .slice(0, 3);
    hits.push({
      target: i,
      cos: obs[i],
      tau: Math.sign(obs[i]) * percentileOf(bg[i], Math.abs(obs[i])),
      p: (exceed[i] + 1) / (nPerm + 1),
      fdr: 1, // filled below
      generic,
      specific: obs[i] - generic,
      contrib,
    });
  }
  // BH-FDR
  const byP = [...hits].sort((a, b) => a.p - b.p);
  let prev = 1;
  for (let k = byP.length - 1; k >= 0; k -= 1) {
    const q = Math.min(prev, (byP[k].p * byP.length) / (k + 1));
    byP[k].fdr = q; prev = q;
  }
  return hits.sort((a, b) => b.cos - a.cos);
}

// ============================ heterogeneity =================================
// Subpopulation-selective response: per-drug dispersion of per-query-cluster
// net-direction profiles (directional streams only — see hetero.json). RMS
// profile distance, NOT 1−r: flat/weak profiles decorrelate and would inflate
// a correlation-based metric.

export interface HeteroProfile {
  nets: number[][];        // [cluster][pathway] net direction
  support: number[][];     // [cluster][pathway] tested records
}

export function heteroProfile(up: number[][], down: number[][], tested: number[][]): HeteroProfile {
  const nets = up.map((row, q) => row.map((u, p) =>
    (tested[q][p] > 0 ? (u - down[q][p]) / tested[q][p] : 0)));
  return { nets, support: tested };
}

export interface HeteroStats {
  dispersion: number;       // mean pairwise RMS distance between cluster profiles
  divergent: number[];      // pathways where clusters strictly disagree in sign
  sd: number[];             // per-pathway cross-cluster standard deviation
}

const DIV_EPS = 0.15;       // |net| a cluster must reach to cast a direction vote
const DIV_SUPPORT = 6;      // min directional records behind a vote

export function heteroStats(prof: HeteroProfile): HeteroStats {
  const { nets, support } = prof;
  const nC = nets.length;
  const nP = nets[0]?.length ?? 0;
  let dispersion = 0; let pairs = 0;
  for (let i = 0; i < nC; i += 1) {
    for (let j = i + 1; j < nC; j += 1) {
      let ss = 0;
      for (let p = 0; p < nP; p += 1) ss += (nets[i][p] - nets[j][p]) ** 2;
      dispersion += Math.sqrt(ss / Math.max(1, nP));
      pairs += 1;
    }
  }
  dispersion = pairs > 0 ? dispersion / pairs : 0;

  const divergent: number[] = [];
  const sd: number[] = [];
  for (let p = 0; p < nP; p += 1) {
    let lo = Infinity; let hi = -Infinity;
    let sum = 0; let sq = 0; let n = 0;
    for (let q = 0; q < nC; q += 1) {
      const v = nets[q][p];
      sum += v; sq += v * v; n += 1;
      if (support[q][p] >= DIV_SUPPORT) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    sd.push(n > 1 ? Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) : 0);
    if (hi > DIV_EPS && lo < -DIV_EPS) divergent.push(p);
  }
  return { dispersion, divergent, sd };
}

// ============================== consensus ===================================
// The generic perturbation response: per pathway, the mean net direction across
// the library with its 95% CI, plus how consistently the responding drugs agree
// on a sign (exact binomial vs 50:50, BH-adjusted across the pathway set).
// Shared by the Consensus tab and the Figures page so a figure and its live
// view can never disagree about which pathways earn a star.

/** |net| above which a drug counts as "responding" in a pathway. */
export const RESPONDER_MIN = 0.02;

export interface ConsensusRow {
  p: number;
  mean: number;
  sd: number;
  ci: number;          // half-width of the 95% CI on the mean
  resp: number;        // drugs responding in this pathway
  consist: number;     // share of responders sharing the majority sign
  majorityUp: boolean;
  pBinom: number;      // exact two-sided binomial vs 50:50
  q: number;           // BH-adjusted pBinom across the pathway set
}

export function consensusRows(nets: Float64Array[], nP: number): ConsensusRow[] {
  const n = nets.length;
  const tCrit = tQuantile975(n - 1);
  const rows: ConsensusRow[] = Array.from({ length: nP }, (_, p) => {
    let sum = 0;
    for (const v of nets) sum += v[p];
    const mean = sum / n;
    let sq = 0; let resp = 0; let up = 0;
    for (const v of nets) {
      sq += (v[p] - mean) ** 2;
      if (Math.abs(v[p]) > RESPONDER_MIN) { resp += 1; if (v[p] > 0) up += 1; }
    }
    const sd = Math.sqrt(sq / (n - 1));
    const k = Math.max(up, resp - up);
    return {
      p, mean, sd, ci: (tCrit * sd) / Math.sqrt(n), resp,
      consist: resp > 0 ? k / resp : NaN,
      majorityUp: up * 2 >= resp,
      pBinom: resp > 0 ? signTestP(k, resp) : NaN,
      q: 1,
    };
  });
  // Benjamini–Hochberg over the pathways that were actually tested
  const byP = rows.filter((r) => Number.isFinite(r.pBinom)).sort((a, b) => a.pBinom - b.pBinom);
  let prev = 1;
  for (let i = byP.length - 1; i >= 0; i -= 1) {
    prev = Math.min(prev, (byP[i].pBinom * byP.length) / (i + 1));
    byP[i].q = prev;
  }
  return rows;
}

// ==================== per-cluster pathway coupling ==========================
// The library-wide correlation (one point per drug) averages away all cluster
// structure. This asks a narrower question: inside ONE drug, do two pathways
// move together within each drug cluster separately?
//
// For a fixed drug cluster q, the observations are that drug's DMSO reference
// clusters r = 1..n_ref. Each (r, q) cell gives pathway A and pathway B a value
// in three channels — up, down, and unsigned — and we correlate A against B
// across r, per channel.
//
// n = n_ref is only 9-12, so: Spearman (robust to the nlp clipping at 300 and
// to heavy tails) with an exact-style permutation p, and BH across the
// cluster x channel grid. Rho estimates at this n are noisy by construction —
// the UI must say so.

export type Channel = 'up' | 'down' | 'uns';
export const CHANNELS: Channel[] = ['up', 'down', 'uns'];

/**
 * Per (drug cluster, DMSO cluster, pathway) channel values for one drug.
 * up/down come from the directional streams only (a stream that called the
 * cell "down" contributes 0 to the up channel, so the mean is over all
 * directional records, not just the concordant ones). uns is the mean over the
 * direction-less streams (ORA, CellSpectra).
 */
export interface ChannelCube {
  nRef: number; nQuery: number; nP: number;
  up: Float64Array; down: Float64Array; uns: Float64Array;
}

const cubeIdx = (q: number, r: number, p: number, nRef: number, nP: number): number =>
  (q * nRef + r) * nP + p;

export function channelCube(
  pairwise: PairwiseCells, nRef: number, nQuery: number, nP: number, signedStreams: Set<number>,
): ChannelCube {
  const size = nQuery * nRef * nP;
  const up = new Float64Array(size);
  const down = new Float64Array(size);
  const uns = new Float64Array(size);
  const nSigned = new Float64Array(size);
  const nUns = new Float64Array(size);
  const c = pairwise;
  for (let k = 0; k < c.stream.length; k += 1) {
    const q = c.query[k]; const r = c.ref[k]; const p = c.pathway[k];
    if (q >= nQuery || r >= nRef || p >= nP) continue;
    const i = cubeIdx(q, r, p, nRef, nP);
    if (signedStreams.has(c.stream[k])) {
      nSigned[i] += 1;
      if (c.sign[k] > 0) up[i] += c.nlp[k];
      else if (c.sign[k] < 0) down[i] += c.nlp[k];
    } else {
      nUns[i] += 1;
      uns[i] += c.nlp[k];
    }
  }
  for (let i = 0; i < size; i += 1) {
    if (nSigned[i] > 0) { up[i] /= nSigned[i]; down[i] /= nSigned[i]; }
    if (nUns[i] > 0) uns[i] /= nUns[i];
  }
  return { nRef, nQuery, nP, up, down, uns };
}

/** Pearson on two rank vectors — the inner loop of the permutation test. */
function rhoOfRanks(rx: number[], ry: number[]): number {
  return pearson(rx, ry);
}

export interface CouplingPoint {
  cluster: number;
  channel: Channel;
  rho: number;      // NaN when a channel is constant (e.g. never down)
  p: number;        // two-sided permutation p
  q: number;        // BH across the cluster x channel grid of one pathway pair
  n: number;        // = n_ref
  degenerate: boolean; // no variance in at least one series
}

/**
 * Spearman rho + permutation p for pathways A vs B, per drug cluster and
 * channel. `perms` shuffles the rank vector; 2000 gives a p-floor of 1/2001.
 */
export function pairCoupling(
  cube: ChannelCube, a: number, b: number, perms = 2000, seed = 20260812,
): CouplingPoint[] {
  const { nRef, nQuery, nP } = cube;
  const series = (ch: Channel, q: number, p: number): number[] => {
    const src = ch === 'up' ? cube.up : ch === 'down' ? cube.down : cube.uns;
    const out = new Array<number>(nRef);
    for (let r = 0; r < nRef; r += 1) out[r] = src[cubeIdx(q, r, p, nRef, nP)];
    return out;
  };
  const rand = rng(seed);
  const pts: CouplingPoint[] = [];
  for (let q = 0; q < nQuery; q += 1) {
    for (const ch of CHANNELS) {
      const xs = series(ch, q, a); const ys = series(ch, q, b);
      const flat = (v: number[]) => v.every((x) => x === v[0]);
      if (nRef < 4 || flat(xs) || flat(ys)) {
        pts.push({ cluster: q, channel: ch, rho: NaN, p: NaN, q: NaN, n: nRef, degenerate: true });
        continue;
      }
      const rx = ranks(xs); const ry = ranks(ys);
      const rho = rhoOfRanks(rx, ry);
      // permutation null: shuffle one rank vector
      const shuf = [...ry];
      let exceed = 0;
      for (let t = 0; t < perms; t += 1) {
        for (let i = shuf.length - 1; i > 0; i -= 1) {
          const j = Math.floor(rand() * (i + 1));
          [shuf[i], shuf[j]] = [shuf[j], shuf[i]];
        }
        if (Math.abs(rhoOfRanks(rx, shuf)) >= Math.abs(rho) - 1e-12) exceed += 1;
      }
      pts.push({
        cluster: q, channel: ch, rho, n: nRef, degenerate: false,
        p: (exceed + 1) / (perms + 1), q: 1,
      });
    }
  }
  // BH over the tests that actually ran
  const live = pts.filter((x) => !x.degenerate).sort((x, y) => x.p - y.p);
  let prev = 1;
  for (let i = live.length - 1; i >= 0; i -= 1) {
    prev = Math.min(prev, (live[i].p * live.length) / (i + 1));
    live[i].q = prev;
  }
  return pts;
}

/**
 * Which pathways are most active in each drug cluster (all streams, all DMSO
 * refs, at the fixed reference cutoff) — the "what else is going on here"
 * companion to the coupling lines.
 */
export function clusterEnrichment(
  pairwise: PairwiseCells, nRef: number, nQuery: number, nP: number, thr: number,
): { frac: number[][]; tested: number[][] } {
  const frac = Array.from({ length: nQuery }, () => new Array<number>(nP).fill(0));
  const tested = Array.from({ length: nQuery }, () => new Array<number>(nP).fill(0));
  const c = pairwise;
  for (let k = 0; k < c.stream.length; k += 1) {
    const q = c.query[k]; const p = c.pathway[k];
    if (q >= nQuery || p >= nP) continue;
    tested[q][p] += 1;
    if (c.nlp[k] >= thr) frac[q][p] += 1;
  }
  for (let q = 0; q < nQuery; q += 1) {
    for (let p = 0; p < nP; p += 1) if (tested[q][p] > 0) frac[q][p] /= tested[q][p];
  }
  void nRef;
  return { frac, tested };
}
