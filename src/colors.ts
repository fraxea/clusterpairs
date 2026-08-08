// colors.ts — the app's visual encoding layer.
//
// Every data color does exactly one job:
//   sequential RED   = up-regulated strength
//   sequential BLUE  = down-regulated strength
//   sequential VIOLET= unsigned significance (CellSpectra has no direction)
//   sequential INK   = direction-free magnitude (agreement, overall activity)
//   NONSIG           = neutral "nothing here" (reads as the surface, not a value)
//
// Ramps are sampled by perceptual interpolation in OKLab, so equal value steps
// look like equal color steps — replacing the old alpha-over-white blending.

import type { DirCell } from './significance';

// ---------------------------------------------------------------- OKLab ----
type Lab = [number, number, number];

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function hexToLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToRgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b2 = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const to255 = (c: number) => Math.round(255 * Math.min(1, Math.max(0, linearToSrgb(c))));
  return [to255(r), to255(g), to255(b2)];
}

// ----------------------------------------------------------------- ramps ----
// Anchor stops, light -> dark, sampled piecewise in OKLab.
const STOPS = {
  up: ['#fbe3e0', '#f0a99f', '#dd6a5c', '#bc3a30', '#8c1f18', '#5f120e'],
  down: ['#dcebfc', '#9ec5f4', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'],
  uns: ['#e9e4f9', '#c0b3ec', '#957fd8', '#6c55bd', '#4a3aa7', '#2f2371'],
  ink: ['#f1f0ec', '#d4d2ca', '#a9a69c', '#7b786f', '#514f49', '#26251f'],
} as const;
export type RampName = keyof typeof STOPS;

export const NONSIG = '#f0efec'; // neutral — deliberately off any ramp
export const UNTESTED = '#fafaf8'; // near-surface: "no record", quieter than n.s.

const LABS: Record<RampName, Lab[]> = Object.fromEntries(
  (Object.keys(STOPS) as RampName[]).map((k) => [k, STOPS[k].map(hexToLab)]),
) as Record<RampName, Lab[]>;

// Cache sampled colors — canvas draws hit this hard.
const cache = new Map<string, string>();

/** Sample ramp `name` at t in [0,1] (0 = lightest). */
export function ramp(name: RampName, t: number): string {
  const tc = Math.min(1, Math.max(0, t));
  const key = `${name}:${Math.round(tc * 200)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const labs = LABS[name];
  const x = (Math.round(tc * 200) / 200) * (labs.length - 1);
  const i = Math.min(labs.length - 2, Math.floor(x));
  const f = x - i;
  const A = labs[i]; const B = labs[i + 1];
  const [r, g, b] = labToRgb([
    A[0] + (B[0] - A[0]) * f,
    A[1] + (B[1] - A[1]) * f,
    A[2] + (B[2] - A[2]) * f,
  ]);
  const out = `rgb(${r},${g},${b})`;
  cache.set(key, out);
  return out;
}

/** CSS gradient of a ramp, for legends. */
export const rampGradient = (name: RampName): string =>
  `linear-gradient(to right, ${STOPS[name].join(', ')})`;

/** Ink or white, whichever reads on top of ramp(name, t). */
export function textOn(_name: RampName, t: number): string {
  return t >= 0.45 ? '#ffffff' : '#3d3c38';
}

// -------------------------------------------------- domain-specific scales ----
// nlp at which significance color saturates (matches SIG_MAX in significance.ts)
const SIG_SAT = 30;

/** One significance cell: strength = nlp, direction = sign. */
export function sigColor(nlp: number, sign: number, thr: number): string {
  if (nlp < thr) return NONSIG;
  const t = 0.14 + 0.86 * Math.min(1, (nlp - thr) / Math.max(1e-6, SIG_SAT - thr));
  return ramp(sign > 0 ? 'up' : sign < 0 ? 'down' : 'uns', t);
}

/** Count-of-significant-refs cell for a fixed direction (or unsigned). */
export function countColor(count: number, nRef: number, kind: 'up' | 'down' | 'uns'): string {
  if (count <= 0) return NONSIG;
  return ramp(kind, 0.14 + 0.86 * Math.min(1, nRef > 0 ? count / nRef : 0));
}
export function countColorT(count: number, nRef: number): number {
  return count <= 0 ? 0 : 0.14 + 0.86 * Math.min(1, nRef > 0 ? count / nRef : 0);
}

/** Jaccard / agreement: direction-free ink ramp. */
export function jaccardColor(v: number): string {
  if (Number.isNaN(v)) return UNTESTED;
  return ramp('ink', 0.06 + 0.94 * Math.min(1, Math.max(0, v)));
}

// Activity fraction where the summary-based cells saturate. Empirically the
// per-pathway significant fraction tops out around 0.9; 0.6 keeps mid-range
// differences visible without flattening the top.
export const ACTIVITY_SAT = 0.6;
export const activityT = (a: number): number =>
  a <= 0 ? 0 : 0.1 + 0.9 * Math.min(1, a / ACTIVITY_SAT);

/** Direction-classified summary cell (overview matrix, signature strips). */
export function dirCellColor(cell: DirCell): string {
  if (cell.kind === 'ns') return NONSIG;
  const t = activityT(cell.a);
  if (cell.kind === 'mixed') return ramp('ink', t);
  return ramp(cell.kind, t);
}

/** Direction-free activity cell. */
export const activityColor = (a: number): string =>
  a <= 0 ? NONSIG : ramp('ink', activityT(a));

// ------------------------------------------------------ categorical slots ----
// Fixed 8-hue order (validated palette; identity job only — e.g. network
// communities). Communities beyond the 8th fold into OTHER_CAT gray, and
// community identity is never color-alone (legend chips carry labels).
export const CATEGORICAL = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948',
] as const;
export const OTHER_CAT = '#a9a69c';

export const communityColor = (c: number): string =>
  c >= 0 && c < CATEGORICAL.length ? CATEGORICAL[c] : OTHER_CAT;
