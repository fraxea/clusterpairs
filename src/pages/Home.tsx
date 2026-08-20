// Home.tsx: the drug index. Hero stats plus triage-ready cards, each carrying a
// 50-pathway signature strip derived from summary.json. One CSS gradient per
// card, so there is no per-cell DOM.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Manifest, Summary, SummaryDrug } from '../types';
import { prefetchDrug } from '../data';
import { classifyCounts, drugActivity, drugSelectivity, pathwayActivity, topPathways } from '../significance';
import { dirCellColor } from '../colors';
import { DirLegend, Segmented, StatTile } from '../ui';
import { fmtCompact, fmtPct } from '../format';
import { useTip } from '../tooltip';

type SortKey = 'activity' | 'name' | 'selectivity';

export function Home({ manifest, summary }: { manifest: Manifest; summary: Summary | null }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('activity');
  const inputRef = useRef<HTMLInputElement>(null);

  // '/' focuses the filter, Escape clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (e.key === '/' && !typing) { e.preventDefault(); inputRef.current?.focus(); }
      if (e.key === 'Escape' && el === inputRef.current) { setQ(''); inputRef.current?.blur(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const bySlug = useMemo(
    () => new Map((summary?.drugs ?? []).map((d) => [d.slug, d])),
    [summary],
  );
  const scores = useMemo(() => {
    const m = new Map<string, { act: number; sel: number }>();
    for (const d of summary?.drugs ?? []) m.set(d.slug, { act: drugActivity(d), sel: drugSelectivity(d) });
    return m;
  }, [summary]);

  const drugs = useMemo(() => {
    const n = q.trim().toLowerCase();
    const filtered = n ? manifest.drugs.filter((d) => d.name.toLowerCase().includes(n)) : [...manifest.drugs];
    if (sort === 'name' || !summary) return filtered.sort((a, b) => a.name.localeCompare(b.name));
    const key = sort === 'activity' ? 'act' as const : 'sel' as const;
    return filtered.sort((a, b) =>
      (scores.get(b.slug)?.[key] ?? 0) - (scores.get(a.slug)?.[key] ?? 0) || a.name.localeCompare(b.name));
  }, [manifest.drugs, q, sort, scores, summary]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Tahoe drug–pathway atlas</h1>
          <p className="mt-1 max-w-xl text-sm text-stone-500">
            Pathway enrichment for {manifest.drugs.length} drug perturbations vs DMSO, scored per cluster pair
            by {manifest.streams.length} method streams over the {manifest.pathways.length} {manifest.gene_set.replace(/_/g, ' ')} pathways.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            options={[
              { value: 'activity', label: 'Activity', title: 'Most significant first' },
              { value: 'selectivity', label: 'Selectivity', title: 'Most pathway-focused first' },
              { value: 'name', label: 'A–Z' },
            ]}
            value={sort} onChange={setSort}
          />
          <input
            ref={inputRef}
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter drugs (press /)"
            className="w-56 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-stone-500"
          />
        </div>
      </div>

      {summary && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Drugs" value={`${manifest.drugs.length}`} sub="each vs DMSO control" />
          <StatTile label="Hallmark pathways" value={`${manifest.pathways.length}`} sub={manifest.gene_set.replace(/_/g, ' ')} />
          <StatTile label="Method streams" value={`${manifest.streams.length}`} sub="GSEA · fgsea · ORA · CellSpectra, py + R" />
          <StatTile
            label="Pathway tests" value={fmtCompact(summary.totals.records)}
            sub={`${fmtCompact(summary.totals.sig)} significant at q < 0.05 · ${fmtCompact(summary.totals.cluster_pairs)} cluster pairs`}
          />
        </div>
      )}

      {summary && <Highlights />}

      <div className="mt-5"><DirLegend /></div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {drugs.map((d) => (
          <DrugCard key={d.slug} meta={d} row={bySlug.get(d.slug)} manifest={manifest} />
        ))}
        {drugs.length === 0 && <p className="text-sm text-stone-500">No drugs match &ldquo;{q}&rdquo;.</p>}
      </div>
    </div>
  );
}

// Curated entry points. Each card is a finding the atlas demonstrates,
// deep-linked to the exact configured view that shows it.
const HIGHLIGHTS: Array<{ stat: string; title: string; desc: string; href: string; color: string }> = [
  {
    stat: 'r = 0.77',
    title: 'Hypoxia and EMT move together',
    desc: 'Across 379 drugs the two programs are co-regulated: same direction in 81% of directional calls.',
    href: '#/correlate',
    color: '#bc3a30',
  },
  {
    stat: 'τ = 100',
    title: 'Drug classes self-assemble',
    desc: 'Digitoxin’s top connectivity hit is Ouabain. Cardiac glycosides find each other from pathway space alone.',
    href: '#/connect',
    color: '#2a78d6',
  },
  {
    stat: '5 of 5',
    title: 'Steroids reverse inflammation',
    desc: 'Query an inflammatory program: the top reversers are corticosteroids, MEK and JAK inhibitors.',
    href: '#/connect?up=tnf-alpha-signaling-via-nf-kb,inflammatory-response,il-6-jak-stat3-signaling,complement&down=oxidative-phosphorylation',
    color: '#6c55bd',
  },
  {
    stat: '24%',
    title: 'One shared program dominates',
    desc: 'A quarter of the whole matrix lies on a single generic stress axis. See what remains once it is removed.',
    href: '#/consensus',
    color: '#7b786f',
  },
  {
    stat: 'J = 0.29',
    title: 'Methods disagree more than languages',
    desc: 'GSEA agrees with itself across Python and R (J ≈ 0.8), but ORA and GSEA overlap far less.',
    href: '#/drug/abemaciclib-ddf4f5?tab=methods',
    color: '#bc3a30',
  },
  {
    stat: '50 × 379',
    title: 'The whole screen in one figure',
    desc: 'Every drug × pathway call at a glance, clustered so mechanism blocks emerge.',
    href: '#/atlas',
    color: '#2a78d6',
  },
];

function Highlights() {
  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Start here: what the atlas shows</h2>
        <a href="#/guide" className="text-xs font-medium text-emerald-700 hover:text-emerald-800">how to read the views →</a>
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {HIGHLIGHTS.map((h) => (
          <a
            key={h.title} href={h.href}
            className="group rounded-lg border border-stone-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-stone-400 hover:shadow-md"
          >
            <div className="font-mono text-lg font-semibold tabular-nums" style={{ color: h.color }}>{h.stat}</div>
            <div className="mt-1 text-sm font-semibold text-stone-900 group-hover:text-stone-950">{h.title}</div>
            <div className="mt-1 text-xs leading-relaxed text-stone-500">{h.desc}</div>
            <div className="mt-2 text-xs font-medium text-emerald-700 opacity-0 transition group-hover:opacity-100">explore →</div>
          </a>
        ))}
      </div>
    </div>
  );
}

function DrugCard({ meta, row, manifest }: {
  meta: Manifest['drugs'][number];
  row: SummaryDrug | undefined;
  manifest: Manifest;
}) {
  const tip = useTip();
  const timer = useRef<number | null>(null);

  const gradient = useMemo(() => {
    if (!row) return null;
    const n = row.tested.length;
    const stops: string[] = [];
    for (let p = 0; p < n; p += 1) {
      const c = dirCellColor(classifyCounts(row.up[p], row.down[p], row.uns[p], row.tested[p]));
      stops.push(`${c} ${(p / n) * 100}% ${((p + 1) / n) * 100}%`);
    }
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [row]);

  const top = useMemo(() => (row ? topPathways(row, 2) : []), [row]);

  const onStripMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!row) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = Math.min(row.tested.length - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * row.tested.length)));
    tip.show(e, (
      <div>
        <div className="font-medium text-stone-900">{manifest.pathways[p]}</div>
        <div className="mt-0.5 font-mono text-[11px] tabular-nums">
          {fmtPct(pathwayActivity(row, p))} significant
          <span className="text-stone-400"> · </span>
          <span style={{ color: '#bc3a30' }}>▲{row.up[p]}</span>{' '}
          <span style={{ color: '#2a78d6' }}>▼{row.down[p]}</span>{' '}
          <span style={{ color: '#6c55bd' }}>◆{row.uns[p]}</span>
        </div>
      </div>
    ));
  };

  return (
    <a
      href={`#/drug/${encodeURIComponent(meta.slug)}`}
      className="group rounded-lg border border-stone-200 bg-white p-4 transition hover:border-stone-400 hover:shadow-sm"
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 130px' } as React.CSSProperties}
      onMouseEnter={() => { timer.current = window.setTimeout(() => prefetchDrug(meta), 150); }}
      onMouseLeave={() => { if (timer.current) window.clearTimeout(timer.current); }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="truncate font-medium text-stone-900 group-hover:text-stone-950">{meta.name}</div>
        {row && (
          <div className="shrink-0 font-mono text-xs tabular-nums text-stone-500" title="Fraction of all pathway tests significant at q < 0.05">
            {fmtPct(drugActivity(row))}
          </div>
        )}
      </div>
      {gradient && (
        <div
          className="mt-2.5 h-2 rounded-[3px]"
          style={{ background: gradient }}
          onMouseMove={onStripMove}
          onMouseLeave={tip.hide}
        />
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {row && top.map((p) => {
            const cell = classifyCounts(row.up[p], row.down[p], row.uns[p], row.tested[p]);
            return (
              <span key={p} className="inline-flex min-w-0 items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] text-stone-600">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dirCellColor(cell) }} />
                <span className="truncate">{manifest.pathways[p]}</span>
              </span>
            );
          })}
        </div>
        <span className="shrink-0 font-mono text-[10px] text-stone-600">
          {meta.n_ref}×{meta.n_query} · {meta.streams_present.length}s
        </span>
      </div>
    </a>
  );
}
