// ui.tsx: shared chrome components (controls, legends, small bits).
import type { ReactNode } from 'react';
import { rampGradient, NET_SAT, NONSIG } from './colors';
import { HATCH } from './format';

export function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition ${
        active ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-200/70 hover:text-stone-900'}`}
    >
      {children}
    </a>
  );
}

const CUT_MIN = 1;   // q < 0.1
const CUT_MAX = 6;   // q < 0.000001
const CUT_TICKS = Array.from({ length: CUT_MAX - CUT_MIN + 1 }, (_, i) => i / (CUT_MAX - CUT_MIN));

/** q formatted for the readout: plain decimals down to 1e-6, never wrapping. */
function fmtCutoff(q: number): string {
  if (q >= 0.001) return q.toPrecision(2).replace(/0+$/, '').replace(/\.$/, '');
  return q.toExponential(0).replace('e-', 'e−');
}

export function CutoffSlider({ cutoff, onChange, className = '' }: {
  cutoff: number; onChange: (c: number) => void; className?: string;
}) {
  // slider in -log10 space; the emerald fill shows how strict the threshold is
  const val = Math.min(CUT_MAX, Math.max(CUT_MIN, -Math.log10(cutoff)));
  const pct = ((val - CUT_MIN) / (CUT_MAX - CUT_MIN)) * 100;
  return (
    <label
      className={`group flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3.5 py-2 shadow-sm ${className}`}
      title="Significance threshold. This view re-thresholds live; each tick is one decade of q"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-600">
        cutoff
      </span>
      <span className="relative flex h-5 w-56 items-center">
        <input
          type="range" min={CUT_MIN} max={CUT_MAX} step={0.1} value={val}
          onChange={(e) => onChange(Number(10 ** -Number(e.target.value)))}
          className="q-slider w-full"
          style={{ '--fill': `${pct}%` } as React.CSSProperties}
          aria-label="q-value significance cutoff"
        />
        {/* one tick per decade of q (0.1 … 1e-6), aligned to thumb travel */}
        {CUT_TICKS.map((f) => (
          <span
            key={f}
            className="pointer-events-none absolute top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80"
            style={{ left: `calc(8px + ${f} * (100% - 16px))` }}
          />
        ))}
      </span>
      <span className="w-[5.5rem] shrink-0 whitespace-nowrap rounded-md bg-stone-100 px-2 py-1 text-center font-mono text-xs font-semibold tabular-nums text-stone-800 transition-colors group-hover:bg-stone-200/70">
        q &lt; {fmtCutoff(cutoff)}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-stone-300 bg-white">
      {options.map((o, i) => (
        <button
          key={o.value} type="button" title={o.title} onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-xs font-medium transition ${i > 0 ? 'border-l border-stone-200' : ''} ${
            value === o.value ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-50'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tracking-tight text-stone-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-stone-600">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- legends ----
function GradientBar({ name }: { name: 'up' | 'down' | 'uns' | 'ink' }) {
  return <span className="inline-block h-2.5 w-16 rounded-sm" style={{ background: rampGradient(name) }} />;
}

/** Legend for significance-strength grids (color = q-value depth + direction). */
export function SigLegend({ unsignedOnly }: { unsignedOnly?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-stone-600">
      {!unsignedOnly && (
        <>
          <span className="flex items-center gap-1.5"><GradientBar name="up" /> up</span>
          <span className="flex items-center gap-1.5"><GradientBar name="down" /> down</span>
        </>
      )}
      <span className="flex items-center gap-1.5"><GradientBar name="uns" /> unsigned</span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NONSIG }} /> n.s.
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm border border-stone-200" style={{ background: HATCH }} /> not tested
      </span>
      <span className="text-stone-500">darker = smaller q (saturates at q ≈ 1e-30)</span>
    </div>
  );
}

/** Legend for count grids (color = fraction of DMSO clusters significant). */
export function CountLegend({ nRef, kind }: { nRef: number; kind: 'up' | 'down' | 'uns' }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-stone-600">
      <span className="flex items-center gap-1.5">
        <GradientBar name={kind} /> 1 → all {nRef} DMSO clusters
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NONSIG }} /> none
      </span>
      <span className="text-stone-500">cell = # DMSO clusters where the pathway is significant</span>
    </div>
  );
}

/**
 * Legend for net-direction encodings (Connectivity strips, Heterogeneity
 * heatmap). The saturation label is generated from the shared NET_SAT constant
 * so the key can never drift from the colours it explains.
 */
export function NetLegend({ note }: { note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-stone-600">
      <span className="flex items-center gap-1.5"><GradientBar name="up" /> net up</span>
      <span className="flex items-center gap-1.5"><GradientBar name="down" /> net down</span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NONSIG }} /> no net direction
      </span>
      <span className="text-stone-500">
        saturates at |net| = {Math.round(NET_SAT * 100)}%{note ? ` · ${note}` : ''}
      </span>
    </div>
  );
}

/** Legend for direction-free activity cells (atlas Activity mode). */
export function ActLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-stone-600">
      <span className="flex items-center gap-1.5">
        <GradientBar name="ink" /> fraction of tests significant at q &lt; 0.05
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NONSIG }} /> n.s.
      </span>
    </div>
  );
}

/** Legend for summary-derived direction cells (atlas, strips, pathway bars). */
export function DirLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-stone-600">
      <span className="flex items-center gap-1.5"><GradientBar name="up" /> up</span>
      <span className="flex items-center gap-1.5"><GradientBar name="down" /> down</span>
      <span className="flex items-center gap-1.5"><GradientBar name="ink" /> mixed</span>
      <span className="flex items-center gap-1.5"><GradientBar name="uns" /> unsigned</span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NONSIG }} /> n.s.
      </span>
      <span className="text-stone-500">intensity = fraction of tests significant at q &lt; 0.05</span>
    </div>
  );
}

// ------------------------------------------------------------- small bits ----
export function Chip({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-stone-400 hover:text-stone-700" aria-label="remove">
          &times;
        </button>
      )}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-stone-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      {label}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6">
      <div className="text-sm font-medium text-stone-800">{title}</div>
      <div className="mt-1 font-mono text-xs text-stone-500">{body}</div>
    </div>
  );
}
