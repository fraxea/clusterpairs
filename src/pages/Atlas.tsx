// Atlas.tsx — the whole-screen landscape: every drug x every pathway at the
// reference cutoff, with direction or activity encoding and sortable rows.
import { useMemo, useState } from 'react';
import type { Manifest, Summary } from '../types';
import { drugActivity, pathwayActivity } from '../significance';
import { ActLegend, DirLegend, Segmented } from '../ui';
import { pathwaySlug } from '../format';
import { OverviewMatrix, type AtlasMode } from '../viz/OverviewMatrix';

type SortKind = { kind: 'activity' } | { kind: 'name' } | { kind: 'pathway'; p: number };

export function Atlas({ manifest, summary }: { manifest: Manifest; summary: Summary }) {
  const [mode, setMode] = useState<AtlasMode>('dir');
  const [sort, setSort] = useState<SortKind>({ kind: 'activity' });

  const nameBySlug = useMemo(
    () => new Map(manifest.drugs.map((d) => [d.slug, d.name])),
    [manifest.drugs],
  );

  const order = useMemo(() => {
    const idx = summary.drugs.map((_, i) => i);
    const name = (i: number) => nameBySlug.get(summary.drugs[i].slug) ?? summary.drugs[i].slug;
    if (sort.kind === 'name') return idx.sort((a, b) => name(a).localeCompare(name(b)));
    if (sort.kind === 'pathway') {
      const p = sort.p;
      return idx.sort((a, b) =>
        pathwayActivity(summary.drugs[b], p) - pathwayActivity(summary.drugs[a], p)
        || name(a).localeCompare(name(b)));
    }
    return idx.sort((a, b) =>
      drugActivity(summary.drugs[b]) - drugActivity(summary.drugs[a]) || name(a).localeCompare(name(b)));
  }, [summary.drugs, sort, nameBySlug]);

  const sortedBy = sort.kind === 'pathway' ? sort.p : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Landscape</h1>
          <p className="mt-1 text-sm text-stone-500">
            All {summary.drugs.length} drugs × {manifest.pathways.length} pathways at the reference cutoff q &lt; 0.05.
            Click a column label to sort by that pathway; click a row to open the drug.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            options={[
              { value: 'dir', label: 'Direction', title: 'Color = dominant direction, intensity = activity' },
              { value: 'act', label: 'Activity', title: 'Ink ramp of significant fraction' },
            ]}
            value={mode} onChange={setMode}
          />
          <Segmented
            options={[
              { value: 'activity', label: 'Most active' },
              { value: 'name', label: 'A–Z' },
            ]}
            value={sort.kind === 'pathway' ? 'activity' : sort.kind}
            onChange={(v) => setSort({ kind: v as 'activity' | 'name' })}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {mode === 'dir' ? <DirLegend /> : <ActLegend />}
        {sortedBy !== null && (
          <span className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] text-stone-600">
            sorted by <span className="font-medium text-stone-900">{manifest.pathways[sortedBy]}</span>
            <a className="font-medium text-emerald-700 hover:text-emerald-800" href={`#/pathway/${pathwaySlug(manifest.pathways[sortedBy])}`}>
              open pathway →
            </a>
            <button type="button" className="text-stone-400 hover:text-stone-700" onClick={() => setSort({ kind: 'activity' })}>
              ×
            </button>
          </span>
        )}
      </div>

      {/* w-fit: the border hugs the fixed-width matrix instead of the matrix
          spilling past a viewport-wide card on narrow screens (the page
          scrolls horizontally; an overflow container would break the sticky
          pathway header). */}
      <div className="mt-4 w-fit rounded-lg border border-stone-200 bg-white p-3">
        <OverviewMatrix
          manifest={manifest} summary={summary} mode={mode} order={order}
          sortedBy={sortedBy}
          onColumnClick={(p) => setSort({ kind: 'pathway', p })}
        />
      </div>
    </div>
  );
}
