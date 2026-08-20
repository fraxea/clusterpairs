// format.ts: pure formatting/naming helpers shared across pages.
import type { Stream } from './types';

export function fmtCompact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(0)}K`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

export const fmtPct = (x: number): string =>
  x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`;

export function fmtQ(nlp: number): string {
  if (nlp >= 300) return 'q < 1e-300';
  return `q = ${(10 ** -nlp).toExponential(1)}`;
}

export function streamLabel(s: Stream): string {
  const [method, lang] = s;
  const m = method === 'fgsea' ? 'fgsea' : method === 'cellspectra' ? 'CellSpectra' : method.toUpperCase();
  return `${m}·${lang === 'python' ? 'py' : lang}`;
}

export const streamKey = (s: Stream): string =>
  `${s[0]}.${s[1] === 'python' ? 'py' : s[1]}`;

export const pathwaySlug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Names whose mechanical transform doesn't match MSigDB's registered IDs
// (plus the dataset's "Pperoxisome" typo). Verified against live MSigDB.
const MSIGDB_FIX: Record<string, string> = {
  'G2-M Checkpoint': 'G2M_CHECKPOINT',
  'TNF-alpha Signaling via NF-kB': 'TNFA_SIGNALING_VIA_NFKB',
  'IL-2/STAT5 Signaling': 'IL2_STAT5_SIGNALING',
  'IL-6/JAK/STAT3 Signaling': 'IL6_JAK_STAT3_SIGNALING',
  'Pperoxisome': 'PEROXISOME',
};

export const msigdbUrl = (name: string): string =>
  `https://www.gsea-msigdb.org/gsea/msigdb/human/geneset/HALLMARK_${
    MSIGDB_FIX[name] ?? name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}.html`;

// "not in this stream's output": hatched so missing data never reads as zero
export const HATCH = 'repeating-linear-gradient(45deg,#fafaf8 0 3px,#eceae4 3px 6px)';

/** Patch query params into the current hash route via replaceState (no rerender). */
export function setHashParams(patch: Record<string, string | null>): void {
  const h = window.location.hash.replace(/^#/, '');
  const qIdx = h.indexOf('?');
  const path = qIdx >= 0 ? h.slice(0, qIdx) : h;
  const sp = new URLSearchParams(qIdx >= 0 ? h.slice(qIdx + 1) : '');
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) sp.delete(k); else sp.set(k, v);
  }
  const qs = sp.toString();
  window.history.replaceState(null, '', `#${path}${qs ? `?${qs}` : ''}`);
}

/** p-value formatting for stats readouts. */
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return 'n/a';
  if (p < 1e-300) return 'p < 1e-300';
  if (p < 1e-4) return `p = ${p.toExponential(1)}`;
  return `p = ${p.toFixed(4)}`;
}
