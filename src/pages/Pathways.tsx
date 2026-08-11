// Pathways.tsx — index of the 50 Hallmark pathways with breadth-of-effect
// stats, plus the per-pathway detail page ranking drugs by direction (tornado).
import { useMemo, useState } from 'react';
import type { Manifest, Summary, SummaryDrug } from '../types';
import { pathwayActivity } from '../significance';
import { dirCellColor, ramp } from '../colors';
import { Segmented, StatTile } from '../ui';
import { fmtCompact, fmtPct, msigdbUrl, pathwaySlug, setHashParams } from '../format';
import { tipBind, useTip } from '../tooltip';

// A drug "responds strongly" in a pathway when ≥35% of its (stream ×
// cluster-pair) tests are significant — chosen from the empirical distribution
// so the stat actually discriminates (at 5% every pathway saturates at 379).
const ACTIVE_MIN = 0.35;

// ------------------------------------------------------------------ index ----
export function PathwaysIndex({ manifest, summary }: { manifest: Manifest; summary: Summary }) {
  const rows = useMemo(() => {
    return manifest.pathways.map((name, p) => {
      let active = 0;
      for (const d of summary.drugs) if (pathwayActivity(d, p) >= ACTIVE_MIN) active += 1;
      const up = summary.pathways.up[p];
      const down = summary.pathways.down[p];
      const uns = summary.pathways.uns[p];
      return { name, p, active, up, down, uns };
    }).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
  }, [manifest.pathways, summary]);

  const maxActive = Math.max(1, ...rows.map((r) => r.active));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Pathways</h1>
      <p className="mt-1 text-sm text-stone-500">
        The {manifest.pathways.length} {manifest.gene_set.replace(/_/g, ' ')} gene sets, ranked by how many of
        the {summary.drugs.length} drugs respond strongly (≥{Math.round(ACTIVE_MIN * 100)}% of tests significant at q &lt; 0.05).
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const signed = r.up + r.down;
          const upFrac = signed > 0 ? r.up / signed : 0.5;
          return (
            <a
              key={r.p} href={`#/pathway/${pathwaySlug(r.name)}`}
              className="group rounded-lg border border-stone-200 bg-white p-4 transition hover:border-stone-400 hover:shadow-sm"
            >
              <div className="truncate font-medium text-stone-900">{r.name}</div>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-2 flex-1 rounded-[3px] bg-stone-100">
                  <div className="h-full rounded-[3px] bg-stone-700" style={{ width: `${(r.active / maxActive) * 100}%` }} />
                </div>
                <span className="w-16 text-right font-mono text-xs tabular-nums text-stone-500">{r.active} drugs</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-stone-600">
                <span className="inline-flex h-1.5 w-24 overflow-hidden rounded-full bg-stone-100" title="Balance of up vs down calls across all drugs">
                  <span style={{ width: `${upFrac * 100}%`, background: ramp('up', 0.55) }} />
                  <span style={{ width: `${(1 - upFrac) * 100}%`, background: ramp('down', 0.55) }} />
                </span>
                <span className="font-mono tabular-nums">
                  ▲{fmtCompact(r.up)} ▼{fmtCompact(r.down)} ◆{fmtCompact(r.uns)}
                </span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------- distribution ----
/** How the whole library responds to one pathway — drug count per activity bin. */
function ActivityHistogram({ values, total }: { values: number[]; total: number }) {
  const tip = useTip();
  const BINS = 30;
  const hi = Math.max(0.2, Math.ceil(Math.max(0, ...values) * 10) / 10);
  const counts = new Array<number>(BINS).fill(0);
  for (const v of values) counts[Math.min(BINS - 1, Math.floor((v / hi) * BINS))] += 1;
  const peak = Math.max(1, ...counts);
  const W = 600; const H = 84;
  const bw = W / BINS;
  return (
    <div className="mt-3 rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="text-xs text-stone-500">
        Distribution of drug activity — {values.length} of {total} drugs with ≥1 significant test
      </div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="mt-2 block w-full max-w-2xl">
        {counts.map((n, i) => {
          const h = (n / peak) * (H - 4);
          return (
            <rect
              key={i}
              x={i * bw + 1} y={H - h} width={bw - 2} height={Math.max(n > 0 ? 1.5 : 0, h)}
              rx={1.5} fill="#514f49"
              {...tipBind(tip, () => ((
                <div className="font-mono text-[11px] tabular-nums">
                  {n} drugs at {Math.round((i / BINS) * hi * 100)}–{Math.round(((i + 1) / BINS) * hi * 100)}% activity
                </div>
              )))}
            />
          );
        })}
        <line x1={0} y1={H} x2={W} y2={H} stroke="#c3c2b7" strokeWidth={1} />
        <text x={0} y={H + 12} fontSize={9} fill="#898781">0</text>
        <text x={W} y={H + 12} fontSize={9} fill="#898781" textAnchor="end">{Math.round(hi * 100)}%</text>
      </svg>
    </div>
  );
}

// ----------------------------------------------------------------- detail ----
type PwSort = 'total' | 'up' | 'down' | 'mixed';

export function PathwayPage({ manifest, summary, slug, params }: {
  manifest: Manifest; summary: Summary; slug: string; params: URLSearchParams;
}) {
  const p = useMemo(() => manifest.pathways.findIndex((n) => pathwaySlug(n) === slug), [manifest.pathways, slug]);
  const initSort = params.get('sort');
  const [sort, setSortRaw] = useState<PwSort>(
    initSort === 'up' || initSort === 'down' || initSort === 'mixed' ? initSort : 'total');
  const setSort = (v: PwSort) => { setSortRaw(v); setHashParams({ sort: v === 'total' ? null : v }); };
  const [showAll, setShowAll] = useState(false);
  const tip = useTip();

  const nameBySlug = useMemo(
    () => new Map(manifest.drugs.map((d) => [d.slug, d.name])),
    [manifest.drugs],
  );

  const rows = useMemo(() => {
    if (p < 0) return [];
    const score = (d: SummaryDrug): number => {
      const t = d.tested[p]; if (t <= 0) return 0;
      if (sort === 'up') return d.up[p] / t;
      if (sort === 'down') return d.down[p] / t;
      if (sort === 'mixed') return Math.min(d.up[p], d.down[p]) / t;
      return (d.up[p] + d.down[p] + d.uns[p]) / t;
    };
    return summary.drugs
      .map((d) => ({ d, s: score(d) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || (nameBySlug.get(a.d.slug) ?? '').localeCompare(nameBySlug.get(b.d.slug) ?? ''));
  }, [summary.drugs, p, sort, nameBySlug]);

  if (p < 0) {
    return (
      <div>
        <a href="#/pathways" className="text-sm text-stone-500 hover:text-stone-800">&larr; All pathways</a>
        <p className="mt-4 text-sm text-stone-500">Unknown pathway.</p>
      </div>
    );
  }

  const name = manifest.pathways[p];
  const active = summary.drugs.filter((d) => pathwayActivity(d, p) >= ACTIVE_MIN).length;
  const shown = showAll ? rows : rows.slice(0, 60);
  // Symmetric axis: max directional fraction, rounded up to a clean step.
  const rawMax = Math.max(0.1, ...rows.map(({ d }) => Math.max(d.up[p], d.down[p]) / Math.max(1, d.tested[p])));
  const axisMax = Math.ceil(rawMax * 10) / 10;

  return (
    <div>
      <a href="#/pathways" className="text-sm text-stone-500 hover:text-stone-800">&larr; All pathways</a>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{name}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {active} of {summary.drugs.length} drugs respond strongly at q &lt; 0.05 ·{' '}
            <a className="text-emerald-700 hover:text-emerald-800" href={msigdbUrl(name)} target="_blank" rel="noreferrer">
              MSigDB ↗
            </a>
            {' '}·{' '}
            <a className="text-emerald-700 hover:text-emerald-800" href={`#/correlate?x=${pathwaySlug(name)}`}>
              correlate →
            </a>
          </p>
        </div>
        <Segmented
          options={[
            { value: 'total', label: 'Total' },
            { value: 'up', label: 'Up' },
            { value: 'down', label: 'Down' },
            { value: 'mixed', label: 'Discordant', title: 'Both directions called — heterogeneous response' },
          ]}
          value={sort} onChange={setSort}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Strong responders" value={`${active}`} sub={`≥${Math.round(ACTIVE_MIN * 100)}% of tests significant`} />
        <StatTile label="Up calls" value={fmtCompact(summary.pathways.up[p])} sub="across all drugs and streams" />
        <StatTile label="Down calls" value={fmtCompact(summary.pathways.down[p])} sub="across all drugs and streams" />
        <StatTile label="Unsigned calls" value={fmtCompact(summary.pathways.uns[p])} sub="unsigned methods (ORA · CellSpectra)" />
      </div>

      <ActivityHistogram
        values={summary.drugs.map((d) => pathwayActivity(d, p)).filter((a) => a > 0)}
        total={summary.drugs.length}
      />


      {/* axis header */}
      <div className="mt-6 grid grid-cols-[13rem_1fr_7rem] items-center gap-x-4 px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-400">Drug</span>
        <div className="relative h-5 font-mono text-[10px] tabular-nums text-stone-600">
          <span className="absolute left-0">▼ {fmtPct(axisMax)} down</span>
          <span className="absolute left-1/2 -translate-x-1/2">0</span>
          <span className="absolute right-0">up {fmtPct(axisMax)} ▲</span>
        </div>
        <span className="text-right text-xs font-semibold uppercase tracking-wide text-stone-400">▲ / ▼ / ◆</span>
      </div>

      <div className="mt-1 rounded-lg border border-stone-200 bg-white">
        {shown.map(({ d }, i) => {
          const t = Math.max(1, d.tested[p]);
          const upF = d.up[p] / t; const downF = d.down[p] / t;
          const drugName = nameBySlug.get(d.slug) ?? d.slug;
          return (
            <a
              key={d.slug}
              href={`#/drug/${encodeURIComponent(d.slug)}`}
              className={`grid grid-cols-[13rem_1fr_7rem] items-center gap-x-4 px-3 py-1 hover:bg-stone-50 ${i > 0 ? 'border-t border-stone-100' : ''}`}
              {...tipBind(tip, () => ((
                <div>
                  <div className="font-medium text-stone-900">{drugName}</div>
                  <div className="mt-0.5 font-mono text-[11px] tabular-nums">
                    {d.up[p]} up · {d.down[p]} down · {d.uns[p]} unsigned of {d.tested[p]} tests
                  </div>
                  <div className="mt-0.5 text-[10px] text-stone-600">{d.n_ref}×{d.n_query} cluster pairs · q &lt; 0.05</div>
                </div>
              )))}
            >
              <span className="truncate text-sm text-stone-800">
                <span className="mr-2 inline-block w-6 text-right font-mono text-[10px] text-stone-600">{i + 1}</span>
                {drugName}
              </span>
              <span className="relative block h-[18px]">
                <span className="absolute inset-y-0 left-1/2 w-px bg-stone-200" />
                <span
                  className="absolute right-1/2 top-1/2 h-[14px] -translate-y-1/2 rounded-l-[4px] mr-px"
                  style={{ width: `${Math.min(50, (downF / axisMax) * 50)}%`, background: ramp('down', 0.55) }}
                />
                <span
                  className="absolute left-1/2 top-1/2 h-[14px] -translate-y-1/2 rounded-r-[4px] ml-px"
                  style={{ width: `${Math.min(50, (upF / axisMax) * 50)}%`, background: ramp('up', 0.55) }}
                />
              </span>
              <span className="text-right font-mono text-[11px] tabular-nums text-stone-500">
                {d.up[p]} / {d.down[p]} / {d.uns[p]}
              </span>
            </a>
          );
        })}
        {rows.length === 0 && (
          <p className="px-4 py-8 text-sm text-stone-500">No drug reaches significance for this pathway at q &lt; 0.05.</p>
        )}
      </div>

      {rows.length > 60 && !showAll && (
        <button
          type="button" onClick={() => setShowAll(true)}
          className="mt-3 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-600 hover:border-stone-500"
        >
          Show all {rows.length} drugs
        </button>
      )}

      <p className="mt-3 text-[11px] text-stone-600">
        Bars are the fraction of a drug&rsquo;s (stream × cluster-pair) tests calling this pathway significantly
        up (<span style={{ color: dirCellColor({ a: 1, kind: 'up' }) }}>red</span>) or down
        (<span style={{ color: dirCellColor({ a: 1, kind: 'down' }) }}>blue</span>) at q &lt; 0.05.
        A drug with both bars long responds heterogeneously across clusters. ◆ = unsigned CellSpectra calls.
      </p>
    </div>
  );
}
