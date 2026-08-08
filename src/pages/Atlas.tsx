// Atlas.tsx — the whole-screen landscape: every drug x every pathway at the
// reference cutoff, with direction or activity encoding, sortable rows, and
// clustered (seriated) orderings that surface the block/community structure.
import { useEffect, useMemo, useState } from 'react';
import type { Manifest, Summary } from '../types';
import { drugActivity, pathwayActivity } from '../significance';
import {
  averageLinkageOrder, drugFingerprints, pathwayActivityMatrix, pc1Scores, pearson,
} from '../analysis';
import { ActLegend, DirLegend, Segmented } from '../ui';
import { pathwaySlug } from '../format';
import { GUTTER, OVERHANG, OverviewMatrix, type AtlasMode } from '../viz/OverviewMatrix';

type SortKind = { kind: 'activity' } | { kind: 'name' } | { kind: 'cluster' } | { kind: 'pathway'; p: number };

function useCellW(nP: number): number {
  const compute = () => {
    const avail = Math.min(window.innerWidth, 1700) - 40 /* main padding */ - 26 /* card */ - GUTTER - OVERHANG;
    return Math.max(12, Math.min(22, Math.floor(avail / nP)));
  };
  const [w, setW] = useState(compute);
  useEffect(() => {
    const onResize = () => setW(compute());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nP]);
  return w;
}

export function Atlas({ manifest, summary }: { manifest: Manifest; summary: Summary }) {
  const [mode, setMode] = useState<AtlasMode>('dir');
  const [sort, setSort] = useState<SortKind>({ kind: 'activity' });
  const [clusterCols, setClusterCols] = useState(false);
  const nP = manifest.pathways.length;
  const cellW = useCellW(nP);

  const nameBySlug = useMemo(
    () => new Map(manifest.drugs.map((d) => [d.slug, d.name])),
    [manifest.drugs],
  );

  // Spectral (PC1) scores over drug fingerprints — computed once, used by the
  // "Clustered" row ordering so similar drugs sit adjacently.
  const pcScores = useMemo(
    () => (sort.kind === 'cluster' ? pc1Scores(drugFingerprints(summary.drugs)) : null),
    [summary.drugs, sort.kind],
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
    if (sort.kind === 'cluster' && pcScores) {
      return idx.sort((a, b) => pcScores[a] - pcScores[b] || name(a).localeCompare(name(b)));
    }
    return idx.sort((a, b) =>
      drugActivity(summary.drugs[b]) - drugActivity(summary.drugs[a]) || name(a).localeCompare(name(b)));
  }, [summary.drugs, sort, nameBySlug, pcScores]);

  // Column order: canonical, or average-linkage clustering on pathway
  // co-response (distance = 1 - Pearson r of activity across drugs).
  const colOrder = useMemo(() => {
    if (!clusterCols) return Array.from({ length: nP }, (_, p) => p);
    const mat = pathwayActivityMatrix(summary.drugs);
    const dist = Array.from({ length: nP }, (_, i) =>
      Array.from({ length: nP }, (_, j) => (i === j ? 0 : 1 - pearson(mat[i], mat[j]))));
    return averageLinkageOrder(dist);
  }, [clusterCols, summary.drugs, nP]);

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
        <div className="flex flex-wrap items-center gap-3">
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
              { value: 'cluster', label: 'Clustered', title: 'Rows ordered along the first principal component of the drug fingerprints — similar drugs sit together' },
              { value: 'name', label: 'A–Z' },
            ]}
            value={sort.kind === 'pathway' ? 'activity' : sort.kind}
            onChange={(v) => setSort({ kind: v as 'activity' | 'name' | 'cluster' })}
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-stone-600" title="Order pathway columns by co-response clustering (average linkage on 1 − r)">
            <input
              type="checkbox" checked={clusterCols}
              onChange={(e) => setClusterCols(e.target.checked)}
              className="accent-emerald-700"
            />
            cluster pathways
          </label>
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

      {/* w-fit: the border hugs the matrix (which now sizes itself to the
          viewport); if the window is narrower than the 12px-cell minimum the
          page scrolls horizontally rather than clipping. */}
      <div className="mt-4 w-fit rounded-lg border border-stone-200 bg-white p-3">
        <OverviewMatrix
          manifest={manifest} summary={summary} mode={mode} order={order}
          colOrder={colOrder} cellW={cellW}
          sortedBy={sortedBy}
          onColumnClick={(p) => setSort({ kind: 'pathway', p })}
        />
      </div>
    </div>
  );
}
