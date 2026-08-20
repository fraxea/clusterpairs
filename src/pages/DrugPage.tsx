// DrugPage.tsx: per-drug deep dive. Three tabs:
//   Pathways: pathway × drug-cluster grids (pairwise counts / OVR strength)
//   Clusters: ref × query matrices per stream (where in cluster space?)
//   Methods:  pathway × stream agreement for one pair + Jaccard concordance
// Tab/stream/pair state is mirrored into the URL hash (shareable links).
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Annotations, DrugData, Manifest, Stream, Summary } from '../types';
import { loadAnnotations, loadDrug } from '../data';
import {
  BASE_THR, concordance, explorerByPathway, ovrByPathway,
  pairMatrix, pairwiseAt, survival, thrFromCutoff, topPathways,
  type PathwayCell, type PathwayRow,
} from '../significance';
import { countColor, countColorT, jaccardColor, NONSIG, ramp, sigColor, textOn } from '../colors';
import { CountLegend, CutoffSlider, EmptyState, Segmented, SigLegend } from '../ui';
import { fmtPct, fmtQ, HATCH, pathwaySlug, setHashParams, streamKey, streamLabel } from '../format';
import { tipBind, useTip } from '../tooltip';

type Tab = 'pathways' | 'clusters' | 'methods';
type View = 'pairwise' | 'ovr_drug' | 'ovr_dmso';
type Dir = 'up' | 'down';

// The `params` prop is frozen at the last real navigation (setHashParams uses
// replaceState, which fires no hashchange). Read the live hash when local
// state must reflect edits made since then (e.g. after a tab remount).
function liveParams(): URLSearchParams {
  const h = window.location.hash;
  const q = h.indexOf('?');
  return new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');
}

export function DrugPage({ manifest, summary, slug, cutoff, setCutoff, params }: {
  manifest: Manifest; summary: Summary | null; slug: string;
  cutoff: number; setCutoff: (c: number) => void; params: URLSearchParams;
}) {
  const meta = manifest.drugs.find((d) => d.slug === slug);
  const summaryRow = summary?.drugs.find((d) => d.slug === slug) ?? null;
  const [data, setData] = useState<DrugData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ann, setAnn] = useState<Annotations>({});
  useEffect(() => { loadAnnotations().then(setAnn); }, []);

  const initTab = params.get('tab');
  const [tab, setTabRaw] = useState<Tab>(
    initTab === 'clusters' || initTab === 'methods' ? initTab : 'pathways');
  const setTab = (t: Tab) => { setTabRaw(t); setHashParams({ tab: t === 'pathways' ? null : t }); };


  const present = useMemo(() => {
    if (!meta) return [];
    const keys = new Set(meta.streams_present.map(streamKey));
    return manifest.streams.map((s, i) => ({ s, i })).filter(({ s }) => keys.has(streamKey(s)));
  }, [meta, manifest.streams]);

  const initStream = manifest.streams.findIndex((s) => streamKey(s) === params.get('stream'));
  const [streamIdx, setStreamRaw] = useState<number>(initStream >= 0 ? initStream : (present[0]?.i ?? 0));
  const setStream = (i: number) => { setStreamRaw(i); setHashParams({ stream: streamKey(manifest.streams[i]) }); };

  const [refIdx, setRefRaw] = useState(0);
  const [queryIdx, setQueryRaw] = useState(0);
  const setPair = (r: number, q: number) => {
    setRefRaw(r); setQueryRaw(q);
    if (data) setHashParams({ ref: data.ref_clusters[r] ?? null, qry: data.query_clusters[q] ?? null });
  };

  // External hash navigation (a link carrying ?tab=…&stream=…&ref=…) must win
  // over local state, following the render-phase adjustment pattern from react.dev.
  // Only a REAL navigation (new params object) may re-derive tab/stream:
  // data arrival alone must not clobber clicks made while the file loaded.
  const [synced, setSynced] = useState<{ p: URLSearchParams; d: DrugData | null }>({ p: params, d: null });
  if (synced.p !== params || synced.d !== data) {
    const navigated = synced.p !== params;
    setSynced({ p: params, d: data });
    if (navigated) {
      const t = params.get('tab');
      setTabRaw(t === 'clusters' || t === 'methods' ? t : 'pathways');
      const si = manifest.streams.findIndex((s) => streamKey(s) === params.get('stream'));
      if (si >= 0) setStreamRaw(si);
    }
    if (data) {
      const live = navigated ? params : liveParams();
      const r = data.ref_clusters.indexOf(live.get('ref') ?? '');
      const q = data.query_clusters.indexOf(live.get('qry') ?? '');
      if (r >= 0) setRefRaw(r);
      if (q >= 0) setQueryRaw(q);
    }
  }

  // App keys this component by slug, so a drug change remounts it and
  // data/err start fresh. No reset needed here.
  useEffect(() => {
    if (!meta) return;
    const ctrl = new AbortController();
    loadDrug(meta, ctrl.signal)
      .then(setData) // ref/qry URL params resolve in the sync block above
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setErr(String(e));
      });
    return () => ctrl.abort();
  }, [meta]);

  if (!meta) {
    return (
      <div>
        <a href="#/" className="text-sm text-stone-500 hover:text-stone-800">&larr; All drugs</a>
        <div className="mt-3">
          <EmptyState title="Drug not found" body="This drug isn't in the manifest. It may not have finished processing yet." />
        </div>
      </div>
    );
  }

  const topUp = summaryRow ? topPathways(summaryRow, 1, 'up') : [];
  const topDown = summaryRow ? topPathways(summaryRow, 1, 'down') : [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a href="#/" className="text-sm text-stone-500 hover:text-stone-800">&larr; All drugs</a>
        <CutoffSlider cutoff={cutoff} onChange={setCutoff} />
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{meta.name}</h1>
          <p className="mt-1 font-mono text-xs text-stone-500">
            {meta.n_ref} DMSO clusters &times; {meta.n_query} drug clusters · {present.length} method streams
          </p>
        </div>
        {summaryRow && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 font-mono tabular-nums text-stone-600"
              title="Fraction of all pathway tests significant at q < 0.05">
              activity {fmtPct(summaryRow.sig / Math.max(1, summaryRow.records))}
            </span>
            {ann[slug]?.moa?.[0] && (
              <span
                className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-stone-600"
                title={`ChEMBL ${ann[slug].chembl_id ?? ''}: ${ann[slug].moa.join('; ')}`}
              >
                {ann[slug].moa[0]}
              </span>
            )}
            <a
              href={`#/connect?q=${encodeURIComponent(slug)}`}
              className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-emerald-700 hover:border-stone-400 hover:text-emerald-800"
              title="Find drugs that mimic or reverse this signature"
            >
              connectivity →
            </a>
            {topUp.map((p) => (
              <a key={p} href={`#/pathway/${pathwaySlug(manifest.pathways[p])}`}
                className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-stone-600 hover:border-stone-400">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: ramp('up', 0.6) }} />
                top up: {manifest.pathways[p]}
              </a>
            ))}
            {topDown.map((p) => (
              <a key={p} href={`#/pathway/${pathwaySlug(manifest.pathways[p])}`}
                className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-stone-600 hover:border-stone-400">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: ramp('down', 0.6) }} />
                top down: {manifest.pathways[p]}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex gap-1 border-b border-stone-200">
        {([['pathways', 'Pathways'], ['clusters', 'Cluster pairs'], ['methods', 'Method agreement']] as Array<[Tab, string]>).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {err && <EmptyState title="Could not load this drug" body={err} />}
        {!data && !err && <GridSkeleton nCols={meta.n_query} />}
        {data && tab === 'pathways' && (
          <PathwaysTab manifest={manifest} data={data} cutoff={cutoff}
            present={present} streamIdx={streamIdx} setStream={setStream} params={params} />
        )}
        {data && tab === 'clusters' && (
          <ClustersTab manifest={manifest} data={data} cutoff={cutoff} present={present}
            onSelectPair={(r, q) => { setPair(r, q); setTab('methods'); }} />
        )}
        {data && tab === 'methods' && (
          <MethodsTab manifest={manifest} data={data} cutoff={cutoff}
            refIdx={refIdx} queryIdx={queryIdx} setPair={setPair} />
        )}
      </div>
    </div>
  );
}

function GridSkeleton({ nCols }: { nCols: number }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="animate-pulse space-y-1.5">
        {Array.from({ length: 10 }, (_, r) => (
          <div key={r} className="flex items-center gap-1.5">
            <div className="h-5 w-56 rounded bg-stone-100" />
            {Array.from({ length: Math.min(nCols, 12) }, (_, c) => (
              <div key={c} className="h-5 w-9 rounded bg-stone-100" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ pathways tab ----
function PathwaysTab({ manifest, data, cutoff, present, streamIdx, setStream, params }: {
  manifest: Manifest; data: DrugData; cutoff: number;
  present: Array<{ s: Stream; i: number }>;
  streamIdx: number; setStream: (i: number) => void;
  params: URLSearchParams;
}) {
  // Initialize from the LIVE hash (this component remounts on tab
  // round-trips, when the params prop may be stale; see liveParams).
  const initView = liveParams().get('view');
  const [view, setViewRaw] = useState<View>(
    initView === 'ovr_drug' || initView === 'ovr_dmso' ? initView : 'pairwise');
  const setView = (v: View) => { setViewRaw(v); setHashParams({ view: v === 'pairwise' ? null : v }); };
  const initDir = liveParams().get('dir');
  const [dir, setDirRaw] = useState<Dir>(initDir === 'down' ? 'down' : 'up');
  const setDir = (d: Dir) => { setDirRaw(d); setHashParams({ dir: d === 'up' ? null : d }); };
  // render-phase sync with external hash navigation (see DrugPage)
  const [prevParams, setPrevParams] = useState(params);
  if (prevParams !== params) {
    setPrevParams(params);
    const v = params.get('view');
    setViewRaw(v === 'ovr_drug' || v === 'ovr_dmso' ? v : 'pairwise');
    setDirRaw(params.get('dir') === 'down' ? 'down' : 'up');
  }
  const thr = thrFromCutoff(cutoff);

  // Direction and OVR availability differ per method: CellSpectra is unsigned
  // AND has no OVR rows; ORA is unsigned (sign masked at load) but HAS OVR.
  const method = manifest.streams[streamIdx]?.[0];
  const hasDir = method !== 'cellspectra' && method !== 'ora';
  const hasOvr = method !== 'cellspectra';
  const effView: View = hasOvr ? view : 'pairwise';

  const pairwiseRows = useMemo(() => explorerByPathway(data, streamIdx, thr), [data, streamIdx, thr]);
  const ovrCond = effView === 'ovr_dmso' ? 0 : 1;
  const ovrRows = useMemo(
    () => (effView === 'pairwise' ? [] : ovrByPathway(data, streamIdx, ovrCond, thr)),
    [data, streamIdx, ovrCond, thr, effView],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {present.map(({ s, i }) => (
            <button key={i} type="button" onClick={() => setStream(i)}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs ${
                streamIdx === i ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-600 hover:border-stone-500'}`}>
              {streamLabel(s)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {effView === 'pairwise' && hasDir && (
            <Segmented
              options={[{ value: 'up', label: 'Up-regulated' }, { value: 'down', label: 'Down-regulated' }]}
              value={dir} onChange={setDir}
            />
          )}
          {hasOvr && (
            <select value={effView} onChange={(e) => setView(e.target.value as View)}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-700">
              <option value="pairwise">Drug vs DMSO (per cluster pair)</option>
              <option value="ovr_drug">Drug cluster signature (vs rest)</option>
              <option value="ovr_dmso">DMSO cluster signature (vs rest)</option>
            </select>
          )}
        </div>
      </div>

      <div className="mt-3">
        {effView === 'pairwise'
          ? <CountLegend nRef={data.ref_clusters.length} kind={hasDir ? dir : 'uns'} />
          : <SigLegend unsignedOnly={!hasDir} />}
      </div>

      <div className="mt-3 max-h-[74vh] overflow-auto rounded-lg border border-stone-200 bg-white">
        {effView === 'pairwise'
          ? <PairwiseGrid manifest={manifest} data={data} rows={pairwiseRows} dir={dir} isSigned={hasDir} thr={thr} />
          : <OvrGrid manifest={manifest} data={data} rows={ovrRows} cond={ovrCond} thr={thr} />}
      </div>
    </div>
  );
}

const SPARK_XS = Array.from({ length: 19 }, (_, i) => 1 + i * 0.5);

function Sparkline({ nlps, thr }: { nlps: number[]; thr: number }) {
  const tip = useTip();
  const ys = useMemo(() => survival(nlps, SPARK_XS), [nlps]);
  const max = Math.max(1, ys[0]);
  const W = 60; const H = 16;
  const pts = SPARK_XS.map((x, i) => `${((x - 1) / 9) * W},${H - (ys[i] / max) * (H - 2) - 1}`).join(' ');
  const tx = ((Math.min(10, Math.max(1, thr)) - 1) / 9) * W;
  const q05 = ys[SPARK_XS.findIndex((x) => x >= BASE_THR)] ?? 0;
  const q3 = ys[SPARK_XS.findIndex((x) => x >= 3)] ?? 0;
  const q6 = ys[SPARK_XS.findIndex((x) => x >= 6)] ?? 0;
  return (
    <svg
      width={W} height={H} className="block"
      {...tipBind(tip, () => ((
        <div className="font-mono text-[11px] tabular-nums">
          significant pairs: {q05} at q&lt;0.05 · {q3} at 1e-3 · {q6} at 1e-6
        </div>
      )))}
    >
      <line x1={tx} y1={0} x2={tx} y2={H} stroke="#047857" strokeWidth={1} />
      <polyline points={pts} fill="none" stroke="#a9a69c" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function RefStrip({ cell, data, thr }: { cell: PathwayCell; data: DrugData; thr: number }) {
  return (
    <div className="mt-1.5 flex gap-[2px]">
      {cell.refs.map((r, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5">
          <span
            className="h-3.5 w-3 rounded-[2px]"
            style={{ background: r ? sigColor(r.nlp, r.sign, thr) : HATCH }}
          />
          <span className="font-mono text-[8px] leading-none text-stone-400">{data.ref_clusters[i]}</span>
        </div>
      ))}
    </div>
  );
}

function PairwiseGrid({ manifest, data, rows, dir, isSigned, thr }: {
  manifest: Manifest; data: DrugData; rows: PathwayRow[];
  dir: Dir; isSigned: boolean; thr: number;
}) {
  const tip = useTip();
  if (rows.length === 0) {
    return <p className="px-4 py-8 text-sm text-stone-500">No pathway reaches significance for this stream at the current q-value.</p>;
  }
  const nRef = data.ref_clusters.length;
  const kind = isSigned ? dir : ('uns' as const);
  const countOf = (cell: PathwayCell): number =>
    isSigned ? (dir === 'up' ? cell.countUp : cell.countDown) : cell.count;
  const colTotals = data.query_clusters.map((_, qi) =>
    rows.reduce((s, r) => s + countOf(r.perQuery[qi]), 0));

  const cellTip = (row: PathwayRow, cell: PathwayCell, qi: number): ReactNode => (
    <div>
      <div className="font-medium text-stone-900">{manifest.pathways[row.pathway]}</div>
      <div className="text-stone-500">drug cluster {data.query_clusters[qi]}</div>
      <div className="mt-1 font-mono text-[11px] tabular-nums">
        {cell.count}/{nRef} DMSO clusters significant
        {isSigned && <> · <span style={{ color: '#bc3a30' }}>▲{cell.countUp}</span> <span style={{ color: '#2a78d6' }}>▼{cell.countDown}</span></>}
      </div>
      <RefStrip cell={cell} data={data} thr={thr} />
      <div className="mt-1 text-[10px] text-stone-600">per-DMSO-cluster strength at the current cutoff</div>
    </div>
  );

  return (
    <table className="min-w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr>
          <th className="sticky left-0 top-0 z-[3] w-64 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-400 shadow-[1px_0_0_#e7e5e4,0_1px_0_#e7e5e4]">
            Pathway
          </th>
          <th className="sticky top-0 z-[2] bg-white px-2 py-2 text-left text-[10px] font-medium text-stone-600 shadow-[0_1px_0_#e7e5e4]">
            n vs threshold
          </th>
          {data.query_clusters.map((c) => (
            <th key={c} className="sticky top-0 z-[2] bg-white px-2 py-2 text-center font-mono text-xs text-stone-500 shadow-[0_1px_0_#e7e5e4]">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.pathway}>
            <th className="sticky left-0 z-[1] w-64 bg-white px-3 py-1 text-left font-normal shadow-[1px_0_0_#f5f5f4]">
              <a
                href={`#/pathway/${pathwaySlug(manifest.pathways[row.pathway])}`}
                className="block max-w-64 truncate text-stone-700 hover:text-emerald-800 hover:underline"
                title={manifest.pathways[row.pathway]}
              >
                {manifest.pathways[row.pathway]}
              </a>
            </th>
            <td className="px-2 py-1"><Sparkline nlps={row.nlps} thr={thr} /></td>
            {row.perQuery.map((cell, qi) => {
              const count = countOf(cell);
              const t = countColorT(count, nRef);
              return (
                <td key={qi} className="p-[2px] text-center">
                  <div
                    className="mx-auto flex h-6 w-9 items-center justify-center rounded-[2px] font-mono text-xs tabular-nums"
                    style={{ background: countColor(count, nRef, kind), color: textOn(kind, t) }}
                    {...tipBind(tip, () => (cellTip(row, cell, qi)))}
                  >
                    {count > 0 ? count : ''}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th className="sticky left-0 z-[1] bg-white px-3 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-stone-600 shadow-[1px_0_0_#f5f5f4]">
            column total
          </th>
          <td />
          {colTotals.map((t, qi) => (
            <td key={qi} className="px-1 py-1.5 text-center font-mono text-[10px] tabular-nums text-stone-500">{t}</td>
          ))}
        </tr>
        <tr>
          <td colSpan={data.query_clusters.length + 2} className="px-3 py-2 text-xs text-stone-400">
            {rows.length} of {manifest.pathways.length} pathways significant somewhere ·
            cell = # DMSO clusters (of {nRef}) where the pathway is significant{isSigned ? ` and ${dir}-regulated` : ''} ·
            sparkline = significant pairs as the threshold tightens (q 0.1 → 1e-10), green rule = current cutoff
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function OvrGrid({ manifest, data, rows, cond, thr }: {
  manifest: Manifest; data: DrugData; rows: ReturnType<typeof ovrByPathway>; cond: number; thr: number;
}) {
  const tip = useTip();
  const clusters = cond === 0 ? data.ref_clusters : data.query_clusters;
  if (rows.length === 0) {
    return <p className="px-4 py-8 text-sm text-stone-500">No one-vs-rest results for this stream, or nothing significant.</p>;
  }
  return (
    <table className="min-w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr>
          <th className="sticky left-0 top-0 z-[3] w-64 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-400 shadow-[1px_0_0_#e7e5e4,0_1px_0_#e7e5e4]">Pathway</th>
          {clusters.map((c) => (
            <th key={c} className="sticky top-0 z-[2] bg-white px-2 py-2 text-center font-mono text-xs text-stone-500 shadow-[0_1px_0_#e7e5e4]">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.pathway}>
            <th className="sticky left-0 z-[1] w-64 bg-white px-3 py-1 text-left font-normal shadow-[1px_0_0_#f5f5f4]">
              <a
                href={`#/pathway/${pathwaySlug(manifest.pathways[row.pathway])}`}
                className="block max-w-64 truncate text-stone-700 hover:text-emerald-800 hover:underline"
                title={manifest.pathways[row.pathway]}
              >
                {manifest.pathways[row.pathway]}
              </a>
            </th>
            {row.perCluster.map((cell, ci) => (
              <td
                key={ci} className="p-[2px]"
                /* the fill is the only visual encoding, so name it for AT and
                   table navigation reads the value instead of "blank" */
                aria-label={`${manifest.pathways[row.pathway]}, cluster ${clusters[ci]}: ${
                  cell ? `${fmtQ(cell.nlp)}${cell.sign > 0 ? ', up' : cell.sign < 0 ? ', down' : ''}` : 'not tested'}`}
              >
                <div
                  className="mx-auto h-6 w-9 rounded-[2px]"
                  style={{ background: cell ? sigColor(cell.nlp, cell.sign, thr) : HATCH }}
                  {...tipBind(tip, () => (cell ? (
                    <div>
                      <div className="font-medium text-stone-900">{manifest.pathways[row.pathway]}</div>
                      <div className="text-stone-500">cluster {clusters[ci]} vs rest</div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums">
                        {fmtQ(cell.nlp)} {cell.sign > 0 ? '▲ up' : cell.sign < 0 ? '▼ down' : ''}
                      </div>
                    </div>
                  ) : (
                    <div className="text-stone-500">not in this stream&rsquo;s output</div>
                  )))}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------ clusters tab ----
function ClustersTab({ manifest, data, cutoff, present, onSelectPair }: {
  manifest: Manifest; data: DrugData; cutoff: number;
  present: Array<{ s: Stream; i: number }>;
  onSelectPair: (r: number, q: number) => void;
}) {
  const tip = useTip();
  const thr = thrFromCutoff(cutoff);
  const nP = manifest.pathways.length;
  const matrices = useMemo(
    () => present.map(({ s, i }) => ({ s, i, m: pairMatrix(data, i, thr) })),
    [data, present, thr],
  );

  return (
    <div>
      <p className="text-sm text-stone-500">
        Where in cluster space does the response live? Each panel is one method stream: rows are DMSO reference
        clusters, columns drug clusters, a cell counts significant pathways (of {nP}) for that pair.
        A dark column = one drug subpopulation responds; a dark row = one DMSO reference is an outlier.
        Click a cell to inspect that pair&rsquo;s method agreement.
      </p>
      <div className="mt-4 flex flex-wrap gap-4">
        {matrices.map(({ s, i, m }) => (
          <div key={i} className="rounded-lg border border-stone-200 bg-white p-3">
            <div className="mb-2 font-mono text-xs text-stone-700">{streamLabel(s)}</div>
            <table className="border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="pr-1 text-right font-mono text-[9px] font-normal text-stone-600">r\q</th>
                  {data.query_clusters.map((c) => (
                    <th key={c} className="px-0.5 pb-0.5 text-center font-mono text-[9px] font-normal text-stone-600">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.counts.map((rowArr, r) => (
                  <tr key={r}>
                    <th className="pr-1 text-right font-mono text-[9px] font-normal text-stone-600">{data.ref_clusters[r]}</th>
                    {rowArr.map((n, q) => {
                      const t = n <= 0 ? 0 : 0.08 + 0.92 * Math.min(1, n / nP);
                      const untested = m.tested[r][q] === 0;
                      return (
                        <td key={q} className="p-[1px]">
                          <button
                            type="button"
                            className="flex h-[22px] w-7 items-center justify-center rounded-[2px] font-mono text-[9px] tabular-nums"
                            style={untested
                              ? { background: HATCH }
                              : { background: n > 0 ? ramp('ink', t) : NONSIG, color: textOn('ink', t) }}
                            {...tipBind(tip, () => ((
                              <div>
                                <div className="font-medium text-stone-900">{streamLabel(s)}</div>
                                <div className="text-stone-500">DMSO {data.ref_clusters[r]} vs drug {data.query_clusters[q]}</div>
                                <div className="mt-0.5 font-mono text-[11px] tabular-nums">
                                  {untested ? 'not in output' : `${n}/${nP} pathways significant`}
                                </div>
                                <div className="mt-0.5 text-[10px] text-stone-600">click → method agreement</div>
                              </div>
                            )))}
                            onClick={() => onSelectPair(r, q)}
                          >
                            {n > 0 ? n : ''}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- methods tab ----
function MethodsTab({ manifest, data, cutoff, refIdx, queryIdx, setPair }: {
  manifest: Manifest; data: DrugData; cutoff: number;
  refIdx: number; queryIdx: number; setPair: (r: number, q: number) => void;
}) {
  const tip = useTip();
  const thr = thrFromCutoff(cutoff);
  const nStreams = manifest.streams.length;

  const grid = useMemo(() => pairwiseAt(data, refIdx, queryIdx, nStreams), [data, refIdx, queryIdx, nStreams]);
  const conc = useMemo(() => concordance(data, thr, nStreams), [data, thr, nStreams]);

  const gridRows = useMemo(() => {
    return [...grid.entries()]
      .map(([pathway, cells]) => {
        const maxNlp = cells.reduce((m, c) => (c && c.nlp > m ? c.nlp : m), 0);
        const anySig = cells.some((c) => c && c.nlp >= thr);
        return { pathway, cells, maxNlp, anySig };
      })
      .filter((r) => r.anySig)
      .sort((a, b) => b.maxNlp - a.maxNlp);
  }, [grid, thr]);

  // same-method, cross-language pairs to highlight (e.g. GSEA py vs R)
  const crossLang = (i: number, j: number) =>
    manifest.streams[i][0] === manifest.streams[j][0] && manifest.streams[i][1] !== manifest.streams[j][1];
  const maxSize = Math.max(1, ...conc.sizes);

  const step = (which: 'ref' | 'query', delta: number) => {
    if (which === 'ref') setPair((refIdx + delta + data.ref_clusters.length) % data.ref_clusters.length, queryIdx);
    else setPair(refIdx, (queryIdx + delta + data.query_clusters.length) % data.query_clusters.length);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-stone-500">Cluster pair</span>
        <span className="inline-flex items-center gap-1">
          <button type="button" onClick={() => step('ref', -1)} className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-xs text-stone-500 hover:border-stone-500">‹</button>
          <select value={refIdx} onChange={(e) => setPair(Number(e.target.value), queryIdx)}
            className="rounded-md border border-stone-300 bg-white px-2 py-1 font-mono text-xs">
            {data.ref_clusters.map((c, i) => <option key={c} value={i}>DMSO {c}</option>)}
          </select>
          <button type="button" onClick={() => step('ref', 1)} className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-xs text-stone-500 hover:border-stone-500">›</button>
        </span>
        <span className="text-stone-300">vs</span>
        <span className="inline-flex items-center gap-1">
          <button type="button" onClick={() => step('query', -1)} className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-xs text-stone-500 hover:border-stone-500">‹</button>
          <select value={queryIdx} onChange={(e) => setPair(refIdx, Number(e.target.value))}
            className="rounded-md border border-stone-300 bg-white px-2 py-1 font-mono text-xs">
            {data.query_clusters.map((c, i) => <option key={c} value={i}>drug {c}</option>)}
          </select>
          <button type="button" onClick={() => step('query', 1)} className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-xs text-stone-500 hover:border-stone-500">›</button>
        </span>
        <SigLegend />
      </div>

      <section>
        <h3 className="text-sm font-semibold text-stone-800">Significance by stream</h3>
        <p className="mb-2 text-xs text-stone-500">Each significant pathway in this cluster pair, across all method streams.</p>
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-stone-200 bg-white">
          {gridRows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-stone-500">No pathway is significant in this cluster pair at the current q-value.</p>
          ) : (
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-[3] w-64 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-400 shadow-[1px_0_0_#e7e5e4,0_1px_0_#e7e5e4]">Pathway</th>
                  {manifest.streams.map((s, i) => (
                    <th key={i} className="sticky top-0 z-[2] bg-white px-2 py-2 text-center shadow-[0_1px_0_#e7e5e4]">
                      <div className="font-mono text-xs text-stone-700">{streamLabel(s)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridRows.map((row) => (
                  <tr key={row.pathway}>
                    <th className="sticky left-0 z-[1] w-64 bg-white px-3 py-1 text-left font-normal shadow-[1px_0_0_#f5f5f4]">
                      <a
                        href={`#/pathway/${pathwaySlug(manifest.pathways[row.pathway])}`}
                        className="block max-w-64 truncate text-stone-700 hover:text-emerald-800 hover:underline"
                        title={manifest.pathways[row.pathway]}
                      >
                        {manifest.pathways[row.pathway]}
                      </a>
                    </th>
                    {row.cells.map((cell, si) => (
                      <td
                        key={si} className="p-[2px]"
                        aria-label={`${manifest.pathways[row.pathway]}, ${streamLabel(manifest.streams[si])}: ${
                          cell ? `${fmtQ(cell.nlp)}${cell.sign > 0 ? ', up' : cell.sign < 0 ? ', down' : ''}` : 'not in output'}`}
                      >
                        <div
                          className="mx-auto h-6 w-14 rounded-[2px]"
                          style={{ background: cell ? sigColor(cell.nlp, cell.sign, thr) : HATCH }}
                          {...tipBind(tip, () => (cell ? (
                            <div>
                              <div className="font-medium text-stone-900">{manifest.pathways[row.pathway]}</div>
                              <div className="text-stone-500">{streamLabel(manifest.streams[si])}</div>
                              <div className="mt-0.5 font-mono text-[11px] tabular-nums">
                                {fmtQ(cell.nlp)} {cell.sign > 0 ? '▲ up' : cell.sign < 0 ? '▼ down' : ''}
                              </div>
                            </div>
                          ) : (
                            <div className="text-stone-500">not in this stream&rsquo;s output</div>
                          )))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-stone-800">Stream concordance</h3>
        <p className="mb-2 text-xs text-stone-500">
          Jaccard overlap of significant (cluster-pair × pathway) calls over the whole drug at q &lt; {cutoff.toPrecision(2)}.
          Diagonal = each stream&rsquo;s significant-call count. Outlined cells compare the same method across Python and R.
        </p>
        <div className="inline-block rounded-lg border border-stone-200 bg-white p-3">
          <table className="border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th />
                {manifest.streams.map((s, i) => (
                  <th key={i} className="px-1 pb-1 text-center font-mono text-[10px] font-normal text-stone-500">{streamLabel(s)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {manifest.streams.map((s, i) => (
                <tr key={i}>
                  <th className="pr-2 text-right font-mono text-[10px] font-normal text-stone-500">{streamLabel(s)}</th>
                  {manifest.streams.map((s2, j) => {
                    if (j > i) return <td key={j} />;
                    if (j === i) {
                      const t = 0.08 + 0.5 * (conc.sizes[i] / maxSize);
                      return (
                        <td key={j} className="p-0.5">
                          <div
                            className="flex h-9 w-14 items-center justify-center rounded-[2px] font-mono text-[10px] tabular-nums"
                            style={{ background: ramp('ink', conc.sizes[i] > 0 ? t : 0), color: textOn('ink', t) }}
                            {...tipBind(tip, () => ((
                              <div className="font-mono text-[11px] tabular-nums">{streamLabel(s)}: {conc.sizes[i]} significant calls</div>
                            )))}
                          >
                            {conc.sizes[i]}
                          </div>
                        </td>
                      );
                    }
                    const v = conc.jaccard[i][j];
                    const nan = Number.isNaN(v);
                    return (
                      <td key={j} className="p-0.5">
                        <div
                          className="flex h-9 w-14 items-center justify-center rounded-[2px] font-mono text-[10px] tabular-nums"
                          style={{
                            background: nan ? HATCH : jaccardColor(v),
                            color: nan ? '#a9a69c' : textOn('ink', 0.06 + 0.94 * v),
                            boxShadow: crossLang(i, j) ? 'inset 0 0 0 1.5px #047857' : undefined,
                          }}
                          {...tipBind(tip, () => ((
                            <div>
                              <div className="font-medium text-stone-900">{streamLabel(s)} ∩ {streamLabel(s2)}</div>
                              <div className="mt-0.5 font-mono text-[11px] tabular-nums">
                                {nan ? 'no significant calls in either stream'
                                  : `${conc.inter[i][j]} shared / ${conc.union[i][j]} union · J = ${v.toFixed(2)}`}
                              </div>
                            </div>
                          )))}
                        >
                          {nan ? 'n/a' : v.toFixed(2)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
