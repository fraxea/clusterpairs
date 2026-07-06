// components.tsx — shared presentational pieces and the significance color scale.
import type { ReactNode } from 'react';
import { SIG_MAX } from './significance';
import type { Stream } from './types';

const rgba = (r: number, g: number, b: number, a: number) => `rgba(${r},${g},${b},${a})`;
const UP: [number, number, number] = [214, 69, 65];     // up-regulated
const DOWN: [number, number, number] = [45, 101, 209];  // down-regulated
const UNS: [number, number, number] = [122, 90, 196];   // unsigned (CellSpectra)
const NONSIG = '#EDF0F4';

// Color a single cell by significance strength (nlp) and direction (sign).
export function sigColor(nlp: number, sign: number, thr: number): string {
  if (nlp < thr) return NONSIG;
  const t = Math.min(1, (nlp - thr) / Math.max(1e-6, SIG_MAX - thr));
  const a = 0.28 + 0.72 * t;
  const [r, g, b] = sign > 0 ? UP : sign < 0 ? DOWN : UNS;
  return rgba(r, g, b, a);
}

// Color a "count of significant ref clusters" cell by fraction and direction.
export function countColor(count: number, nRef: number, sign: number): string {
  if (count <= 0) return NONSIG;
  const a = 0.25 + 0.7 * Math.min(1, nRef > 0 ? count / nRef : 0);
  const [r, g, b] = sign > 0 ? UP : sign < 0 ? DOWN : UNS;
  return rgba(r, g, b, a);
}

// Jaccard concordance cell: gray ramp (agreement isn't directional).
export function jaccardColor(v: number): string {
  if (Number.isNaN(v)) return '#F1F3F6';
  const a = 0.08 + 0.92 * Math.min(1, Math.max(0, v));
  return rgba(15, 23, 42, a);
}

export function streamLabel(s: Stream): string {
  const [method, lang] = s;
  if (method === 'cellspectra') return 'CellSpectra';
  const m = method === 'fgsea' ? 'fgsea' : method.toUpperCase();
  return `${m}\u00B7${lang === 'python' ? 'py' : lang}`;
}

export function streamSublabel(s: Stream): string {
  const [, lang] = s;
  return lang === 'python' ? 'Python' : lang;
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
      <span className="font-medium uppercase tracking-wide text-slate-400">Significance</span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm" style={{ background: rgba(...UP, 0.85) }} /> up
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm" style={{ background: rgba(...DOWN, 0.85) }} /> down
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm" style={{ background: rgba(...UNS, 0.85) }} /> CellSpectra
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm" style={{ background: NONSIG }} /> n.s.
      </span>
      <span className="text-slate-400">deeper = smaller q-value</span>
    </div>
  );
}

export function CutoffSlider({ cutoff, onChange }: { cutoff: number; onChange: (c: number) => void }) {
  // slider in -log10 space: 1 (q<0.1) .. 4 (q<0.0001)
  const val = -Math.log10(cutoff);
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="font-medium text-slate-600">q-value &lt;</span>
      <input
        type="range" min={1} max={4} step={0.1} value={val}
        onChange={(e) => onChange(Number(10 ** -Number(e.target.value)))}
        className="h-1 w-40 cursor-pointer accent-emerald-600"
      />
      <span className="w-16 font-mono tabular-nums text-slate-900">{cutoff.toPrecision(2)}</span>
    </label>
  );
}

export function Chip({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-slate-400 hover:text-slate-700" aria-label="remove">
          &times;
        </button>
      )}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      {label}
    </div>
  );
}

export function shortPathway(name: string): string {
  return name; // Hallmark names are already concise ("Myc Targets V1")
}
