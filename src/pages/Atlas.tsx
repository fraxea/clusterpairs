// Atlas.tsx — the whole-screen landscape: every drug x every pathway at the
// reference cutoff, with direction or activity encoding, sortable rows, and
// clustered (seriated) orderings that surface the block/community structure.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Manifest, Summary } from '../types';
import { drugActivity, pathwayActivity } from '../significance';
import {
  averageLinkageOrder, drugFingerprints, pathwayActivityMatrix, pc1Scores, pearson,
} from '../analysis';
import { ActLegend, DirLegend, Segmented } from '../ui';
import { pathwaySlug, setHashParams } from '../format';
import { GUTTER, OVERHANG, OverviewMatrix, type AtlasMode } from '../viz/OverviewMatrix';

type SortKind = { kind: 'activity' } | { kind: 'name' } | { kind: 'cluster' } | { kind: 'pathway'; p: number };

/**
 * Size the cells so the whole matrix FITS its container — 50 columns is little
 * enough that horizontal scrolling is never necessary. Measures the real
 * container (previously it guessed from window.innerWidth, which ignores the
 * page's max-width and overshot by ~60px, forcing a scrollbar). The measured
 * element is w-full so its width never depends on the matrix — no feedback loop.
 */
function useFitCellW(nP: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(18);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const avail = el.clientWidth - GUTTER - OVERHANG;
      setW(Math.max(9, Math.min(24, Math.floor(avail / nP))));
    };
    // Re-measure after layout settles: a resize fires repeatedly while the nav
    // re-wraps, and reading mid-sequence latches a stale container width.
    let raf = 0; let timer = 0;
    const schedule = () => {
      cancelAnimationFrame(raf); window.clearTimeout(timer);
      raf = requestAnimationFrame(measure);
      timer = window.setTimeout(measure, 200);
    };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf); window.clearTimeout(timer);
      ro.disconnect(); window.removeEventListener('resize', schedule);
    };
  }, [nP]);
  return [ref, w];
}

export function Atlas({ manifest, summary, params }: {
  manifest: Manifest; summary: Summary; params: URLSearchParams;
}) {
  const nP = manifest.pathways.length;
  const pwIdx = (slug: string | null): number =>
    slug ? manifest.pathways.findIndex((n) => pathwaySlug(n) === slug) : -1;

  // view state is mirrored into the hash so a configured Landscape is shareable
  const [mode, setModeRaw] = useState<AtlasMode>(params.get('mode') === 'act' ? 'act' : 'dir');
  const [sort, setSortRaw] = useState<SortKind>(() => {
    const p = pwIdx(params.get('p'));
    if (p >= 0) return { kind: 'pathway', p };
    const k = params.get('sort');
    return k === 'name' || k === 'cluster' ? { kind: k } : { kind: 'activity' };
  });
  const [clusterCols, setClusterColsRaw] = useState(params.get('cols') === '1');

  const setMode = (m: AtlasMode) => { setModeRaw(m); setHashParams({ mode: m === 'dir' ? null : m }); };
  const setClusterCols = (v: boolean) => { setClusterColsRaw(v); setHashParams({ cols: v ? '1' : null }); };
  const setSort = (v: SortKind) => {
    setSortRaw(v);
    setHashParams({
      sort: v.kind === 'activity' || v.kind === 'pathway' ? null : v.kind,
      p: v.kind === 'pathway' ? pathwaySlug(manifest.pathways[v.p]) : null,
    });
  };

  const [fitRef, cellW] = useFitCellW(nP);

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
          {/* the rotated column labels are canvas-only; this select is the
              keyboard/screen-reader route to the same sort */}
          <label className="flex items-center gap-1.5 text-xs text-stone-600">
            <span className="sr-only">Sort rows by pathway</span>
            <select
              value={sort.kind === 'pathway' ? sort.p : ''}
              onChange={(e) => setSort(e.target.value === '' ? { kind: 'activity' } : { kind: 'pathway', p: Number(e.target.value) })}
              className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-700"
              aria-label="Sort rows by pathway"
            >
              <option value="">Sort by pathway…</option>
              {manifest.pathways.map((n, i) => <option key={i} value={i}>{n}</option>)}
            </select>
          </label>
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

      {/* The outer div is the measuring reference (w-full, so its width never
          depends on the matrix). The inner is w-fit — NOT a scroll container,
          which would become the sticky band's scrollport and stop the pathway
          labels sticking (overflow-x:auto coerces overflow-y to auto). */}
      <div ref={fitRef} className="mt-4 w-full">
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
