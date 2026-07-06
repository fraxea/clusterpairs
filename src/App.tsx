// App.tsx — Drug Pathway Explorer with built-in method/language comparison.
// Data is precomputed by build_frontend_data.py and served from public/data/.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { DrugData, DrugMeta, Manifest } from './types';
import { loadManifest, loadDrug, loadAllDrugs } from './data';
import {
  thrFromCutoff, explorerByPathway, ovrByPathway, pairwiseAt, concordance, rankDrugs,
  type DrugRank,
} from './significance';
import {
  sigColor, countColor, countColorFixed, jaccardColor, streamLabel, streamSublabel,
  Legend, CutoffSlider, Chip, Spinner,
} from './components';

type Route = { type: 'home' } | { type: 'search' } | { type: 'drug'; slug: string };

function parseHash(hash: string): Route {
  const r = hash.replace(/^#\/?/, '');
  if (r === 'search') return { type: 'search' };
  if (r.startsWith('drug/')) {
    const slug = decodeURIComponent(r.slice('drug/'.length));
    if (slug) return { type: 'drug', slug };
  }
  return { type: 'home' };
}

// ---------------------------------------------------------------- shell ----
function Shell({ cutoff, setCutoff, children }: {
  cutoff: number; setCutoff: (c: number) => void; children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F6F8FA] text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-[#F6F8FA]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-3">
          <a href="#/" className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-semibold tracking-tight text-slate-900">pathways</span>
            <span className="text-xs text-slate-400">drug · cluster · method</span>
          </a>
          <div className="flex items-center gap-6">
            <CutoffSlider cutoff={cutoff} onChange={setCutoff} />
            <a href="#/search" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">
              Search pathways &rarr;
            </a>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-7">{children}</main>
    </div>
  );
}

// ----------------------------------------------------------------- home ----
function Home({ manifest }: { manifest: Manifest }) {
  const [q, setQ] = useState('');
  const drugs = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? manifest.drugs.filter((d) => d.name.toLowerCase().includes(n)) : manifest.drugs;
  }, [manifest.drugs, q]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Drug pathway explorer</h1>
          <p className="mt-1 text-sm text-slate-500">
            {manifest.drugs.length} drugs · {manifest.pathways.length} {manifest.gene_set} pathways ·
            {' '}{manifest.streams.length} method streams
          </p>
        </div>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter drugs"
          className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {drugs.map((d) => (
          <a key={d.slug} href={`#/drug/${encodeURIComponent(d.slug)}`}
            className="group rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-400 hover:shadow-sm">
            <div className="font-medium text-slate-900 group-hover:text-slate-950">{d.name}</div>
            <div className="mt-2 flex items-center gap-3 font-mono text-xs text-slate-500">
              <span>{d.n_ref}&times;{d.n_query} pairs</span>
              <span className="text-slate-300">|</span>
              <span>{d.streams_present.length} streams</span>
            </div>
          </a>
        ))}
        {drugs.length === 0 && <p className="text-sm text-slate-500">No drugs match &ldquo;{q}&rdquo;.</p>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- search ----
function Search({ manifest, cutoff }: { manifest: Manifest; cutoff: number }) {
  const [all, setAll] = useState<Array<{ meta: DrugMeta; data: DrugData }> | null>(null);
  const [progress, setProgress] = useState(0);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<number[]>([]); // pathway indices

  useEffect(() => {
    let alive = true;
    loadAllDrugs(manifest.drugs, (done, total) => { if (alive) setProgress(done / total); })
      .then((res) => { if (alive) setAll(res); })
      .catch(() => { if (alive) setAll([]); });
    return () => { alive = false; };
  }, [manifest.drugs]);

  const thr = thrFromCutoff(cutoff);
  const selectedSet = new Set(selected);
  const suggestions = useMemo(() => {
    const n = q.trim().toLowerCase();
    return manifest.pathways
      .map((name, idx) => ({ name, idx }))
      .filter((p) => !selectedSet.has(p.idx) && (n === '' || p.name.toLowerCase().includes(n)))
      .slice(0, 12);
  }, [manifest.pathways, q, selected]);

  const ranked: DrugRank[] = useMemo(() => {
    if (!all || selected.length === 0) return [];
    return rankDrugs(all, selected, thr, manifest.streams.length).slice(0, 25);
  }, [all, selected, thr, manifest.streams.length]);

  const maxTotal = Math.max(1, ...ranked.map((r) => r.total));

  return (
    <div>
      <a href="#/" className="text-sm text-slate-500 hover:text-slate-800">&larr; All drugs</a>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Rank drugs by pathway significance</h1>
      <p className="mt-1 text-sm text-slate-500">
        Drugs are ranked by how many cluster-pairs reach significance across the selected pathways, summed over all method streams.
      </p>

      <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add pathways&hellip;"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((p) => (
            <button key={p.idx} type="button" onClick={() => { setSelected((s) => [...s, p.idx]); setQ(''); }}
              className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-slate-500">
              {p.name}
            </button>
          ))}
        </div>
        {selected.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {selected.map((idx) => (
              <Chip key={idx} onRemove={() => setSelected((s) => s.filter((x) => x !== idx))}>
                {manifest.pathways[idx]}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5">
        {!all ? (
          <Spinner label={`Loading drugs… ${Math.round(progress * 100)}%`} />
        ) : selected.length === 0 ? (
          <p className="text-sm text-slate-500">Add one or more pathways to rank drugs.</p>
        ) : ranked.length === 0 ? (
          <p className="text-sm text-slate-500">No drug reaches significance for these pathways at q &lt; {cutoff.toPrecision(2)}.</p>
        ) : (
          <div className="space-y-2.5">
            {ranked.map((r, i) => (
              <div key={r.meta.slug} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <a href={`#/drug/${encodeURIComponent(r.meta.slug)}`} className="text-sm font-medium text-slate-900 hover:underline">
                    <span className="mr-2 font-mono text-slate-400">{i + 1}</span>{r.meta.name}
                  </a>
                  <span className="font-mono text-sm tabular-nums text-slate-700">{r.total}</span>
                </div>
                <div className="mt-2 grid grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-1">
                  {manifest.streams.map((s, si) => (
                    <ProgressRow key={si} label={streamLabel(s)} value={r.perStream[si]} max={maxTotal} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <>
      <span className="font-mono text-xs text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        <div className="h-2.5 flex-1 rounded bg-slate-100">
          <div className="h-full rounded bg-slate-700" style={{ width: `${(value / max) * 100}%`, minWidth: value > 0 ? 2 : 0 }} />
        </div>
        <span className="w-8 text-right font-mono text-xs tabular-nums text-slate-500">{value}</span>
      </div>
    </>
  );
}

// ----------------------------------------------------------- drug page ----
function DrugPage({ manifest, slug, cutoff }: { manifest: Manifest; slug: string; cutoff: number }) {
  const meta = manifest.drugs.find((d) => d.slug === slug);
  const [data, setData] = useState<DrugData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'pathways' | 'methods'>('pathways');

  useEffect(() => {
    if (!meta) return;
    let alive = true;
    setData(null); setErr(null);
    loadDrug(meta).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, [meta]);

  if (!meta) return <NotFound />;
  return (
    <div>
      <a href="#/" className="text-sm text-slate-500 hover:text-slate-800">&larr; All drugs</a>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{meta.name}</h1>
      <p className="mt-1 font-mono text-xs text-slate-500">
        {meta.n_ref} DMSO clusters &times; {meta.n_query} drug clusters · {meta.streams_present.length} streams
      </p>

      <div className="mt-5 flex gap-1 border-b border-slate-200">
        {(['pathways', 'methods'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t === 'pathways' ? 'Pathways' : 'Method agreement'}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {err && <EmptyState title="Could not load this drug" body={err} />}
        {!data && !err && <Spinner label="Loading results &hellip;" />}
        {data && tab === 'pathways' && <PathwaysTab manifest={manifest} data={data} cutoff={cutoff} />}
        {data && tab === 'methods' && <MethodsTab manifest={manifest} data={data} cutoff={cutoff} />}
      </div>
    </div>
  );
}

// ---- Pathways tab ----------------------------------------------------------
function PathwaysTab({ manifest, data, cutoff }: { manifest: Manifest; data: DrugData; cutoff: number }) {
  const present = data.pairwise.stream.length ? manifest.streams
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => data.pairwise.stream.includes(i) || data.ovr.stream.includes(i)) : [];
  const [streamIdx, setStreamIdx] = useState<number>(present[0]?.i ?? 0);
  const [view, setView] = useState<'pairwise' | 'ovr_drug' | 'ovr_dmso'>('pairwise');
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const thr = thrFromCutoff(cutoff);

  // CellSpectra has no direction (sign is always 0), so the up/down toggle
  // only makes sense for the other, signed methods.
  const isSigned = manifest.streams[streamIdx]?.[0] !== 'cellspectra';

  const pairwiseRows = useMemo(() => explorerByPathway(data, streamIdx, thr), [data, streamIdx, thr]);
  const ovrCond = view === 'ovr_dmso' ? 0 : 1;
  const ovrRows = useMemo(() => ovrByPathway(data, streamIdx, ovrCond, thr), [data, streamIdx, ovrCond, thr]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {present.map(({ s, i }) => (
            <button key={i} type="button" onClick={() => setStreamIdx(i)}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs ${
                streamIdx === i ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'}`}>
              {streamLabel(s)}
            </button>
          ))}
        </div>
        <select value={view} onChange={(e) => setView(e.target.value as typeof view)}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700">
          <option value="pairwise">Drug vs DMSO (per cluster pair)</option>
          <option value="ovr_drug">Drug cluster signature (vs rest)</option>
          <option value="ovr_dmso">DMSO cluster signature (vs rest)</option>
        </select>
      </div>

      {view === 'pairwise' && isSigned && (
        <div className="mt-3 inline-flex overflow-hidden rounded-md border border-slate-300">
          <button type="button" onClick={() => setDirection('up')}
            className={`px-3 py-1 text-xs font-medium ${
              direction === 'up' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            Up-regulated
          </button>
          <button type="button" onClick={() => setDirection('down')}
            className={`border-l border-slate-300 px-3 py-1 text-xs font-medium ${
              direction === 'down' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            Down-regulated
          </button>
        </div>
      )}

      <div className="mt-3"><Legend /></div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        {view === 'pairwise'
          ? <PairwiseGrid manifest={manifest} data={data} rows={pairwiseRows} direction={direction} isSigned={isSigned} />
          : <OvrGrid manifest={manifest} data={data} rows={ovrRows} cond={ovrCond} thr={thr} />}
      </div>
    </div>
  );
}

function PairwiseGrid({ manifest, data, rows, direction, isSigned }: {
  manifest: Manifest; data: DrugData; rows: ReturnType<typeof explorerByPathway>;
  direction: 'up' | 'down'; isSigned: boolean;
}) {
  if (rows.length === 0) return <Pad>No pathway reaches significance for this stream at the current q-value.</Pad>;
  const nRef = data.ref_clusters.length;
  return (
    <table className="min-w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr>
          <th className="sticky left-0 z-[1] w-64 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
            Pathway
          </th>
          {data.query_clusters.map((c) => (
            <th key={c} className="border-l border-slate-100 px-2 py-2 text-center font-mono text-xs text-slate-500">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.pathway} className="border-t border-slate-100">
            <th className="sticky left-0 z-[1] w-64 truncate bg-white px-3 py-1.5 text-left font-normal text-slate-700"
              title={manifest.pathways[row.pathway]}>
              {manifest.pathways[row.pathway]}
            </th>
            {row.perQuery.map((cell, qi) => {
              // For signed methods, show the count for the chosen direction only
              // (always red for up, always blue for down). For CellSpectra
              // (unsigned), fall back to the old combined count/color.
              const count = isSigned ? (direction === 'up' ? cell.countUp : cell.countDown) : cell.count;
              const bg = isSigned
                ? countColorFixed(count, nRef, direction)
                : countColor(cell.count, nRef, Math.sign(cell.sign));
              return (
                <td key={qi} className="border-l border-slate-100 px-1 py-1 text-center">
                  <div className="mx-auto flex h-6 w-9 items-center justify-center rounded font-mono text-xs"
                    style={{ background: bg }}
                    title={`${count}/${nRef} DMSO clusters significant${isSigned ? ` (${direction})` : ''}`}>
                    {count > 0 ? count : ''}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr><td colSpan={data.query_clusters.length + 1} className="px-3 py-2 text-xs text-slate-400">
          Cell = number of DMSO clusters (of {nRef}) where the pathway is significant{isSigned ? ` and ${direction}-regulated` : ''} for that drug cluster.
        </td></tr>
      </tfoot>
    </table>
  );
}

function OvrGrid({ manifest, data, rows, cond, thr }: {
  manifest: Manifest; data: DrugData; rows: ReturnType<typeof ovrByPathway>; cond: number; thr: number;
}) {
  const clusters = cond === 0 ? data.ref_clusters : data.query_clusters;
  if (rows.length === 0) return <Pad>No one-vs-rest results for this stream (CellSpectra has none), or nothing significant.</Pad>;
  return (
    <table className="min-w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr>
          <th className="sticky left-0 z-[1] w-64 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Pathway</th>
          {clusters.map((c) => (
            <th key={c} className="border-l border-slate-100 px-2 py-2 text-center font-mono text-xs text-slate-500">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.pathway} className="border-t border-slate-100">
            <th className="sticky left-0 z-[1] w-64 truncate bg-white px-3 py-1.5 text-left font-normal text-slate-700"
              title={manifest.pathways[row.pathway]}>{manifest.pathways[row.pathway]}</th>
            {row.perCluster.map((cell, ci) => (
              <td key={ci} className="border-l border-slate-100 px-1 py-1">
                <div className="mx-auto h-6 w-9 rounded"
                  style={{ background: cell ? sigColor(cell.nlp, cell.sign, thr) : '#F8FAFC' }}
                  title={cell ? `q = ${(10 ** -cell.nlp).toExponential(2)}` : 'not tested'} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Method agreement tab --------------------------------------------------
function MethodsTab({ manifest, data, cutoff }: { manifest: Manifest; data: DrugData; cutoff: number }) {
  const [refIdx, setRefIdx] = useState(0);
  const [queryIdx, setQueryIdx] = useState(0);
  const thr = thrFromCutoff(cutoff);
  const nStreams = manifest.streams.length;

  const grid = useMemo(() => pairwiseAt(data, refIdx, queryIdx, nStreams), [data, refIdx, queryIdx, nStreams]);
  const conc = useMemo(() => concordance(data, thr, nStreams), [data, thr, nStreams]);

  const gridRows = useMemo(() => {
    const arr = [...grid.entries()]
      .map(([pathway, cells]) => {
        const maxNlp = cells.reduce((m, c) => (c && c.nlp > m ? c.nlp : m), 0);
        const anySig = cells.some((c) => c && c.nlp >= thr);
        return { pathway, cells, maxNlp, anySig };
      })
      .filter((r) => r.anySig)
      .sort((a, b) => b.maxNlp - a.maxNlp);
    return arr;
  }, [grid, thr]);

  // same-method, cross-language pairs to highlight (e.g. GSEA py vs R)
  const crossLang = (i: number, j: number) =>
    manifest.streams[i][0] === manifest.streams[j][0] && manifest.streams[i][1] !== manifest.streams[j][1];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-500">Cluster pair</span>
        <select value={refIdx} onChange={(e) => setRefIdx(Number(e.target.value))}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs">
          {data.ref_clusters.map((c, i) => <option key={c} value={i}>DMSO {c}</option>)}
        </select>
        <span className="text-slate-300">vs</span>
        <select value={queryIdx} onChange={(e) => setQueryIdx(Number(e.target.value))}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs">
          {data.query_clusters.map((c, i) => <option key={c} value={i}>drug {c}</option>)}
        </select>
      </div>

      <section>
        <h3 className="text-sm font-semibold text-slate-800">Significance by stream</h3>
        <p className="mb-2 text-xs text-slate-500">Each significant pathway in this cluster pair, across the six method streams.</p>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          {gridRows.length === 0 ? <Pad>No pathway is significant in this cluster pair at the current q-value.</Pad> : (
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-[1] w-64 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Pathway</th>
                  {manifest.streams.map((s, i) => (
                    <th key={i} className="border-l border-slate-100 px-2 py-2 text-center">
                      <div className="font-mono text-xs text-slate-700">{streamLabel(s)}</div>
                      <div className="text-[10px] text-slate-400">{streamSublabel(s)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridRows.map((row) => (
                  <tr key={row.pathway} className="border-t border-slate-100">
                    <th className="sticky left-0 z-[1] w-64 truncate bg-white px-3 py-1.5 text-left font-normal text-slate-700"
                      title={manifest.pathways[row.pathway]}>{manifest.pathways[row.pathway]}</th>
                    {row.cells.map((cell, si) => (
                      <td key={si} className="border-l border-slate-100 px-1 py-1">
                        <div className="mx-auto h-6 w-12 rounded"
                          style={{ background: cell ? sigColor(cell.nlp, cell.sign, thr) : '#F8FAFC' }}
                          title={cell ? `q = ${(10 ** -cell.nlp).toExponential(2)}` : 'not in output'} />
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
        <h3 className="text-sm font-semibold text-slate-800">Stream concordance</h3>
        <p className="mb-2 text-xs text-slate-500">
          Jaccard overlap of significant (cluster-pair &times; pathway) calls across this whole drug. Bordered cells are the same method in Python vs R.
        </p>
        <div className="inline-block overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
          <table className="border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th />
                {manifest.streams.map((s, i) => (
                  <th key={i} className="px-1 pb-1 text-center font-mono text-[10px] text-slate-500">{streamLabel(s)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {manifest.streams.map((s, i) => (
                <tr key={i}>
                  <th className="pr-2 text-right font-mono text-[10px] text-slate-500">{streamLabel(s)}</th>
                  {manifest.streams.map((_, j) => {
                    const v = conc.jaccard[i][j];
                    return (
                      <td key={j} className="p-0.5">
                        <div className={`flex h-9 w-12 items-center justify-center rounded font-mono text-[10px] ${
                          crossLang(i, j) ? 'ring-2 ring-emerald-500' : ''}`}
                          style={{ background: jaccardColor(v), color: Number.isNaN(v) || v < 0.5 ? '#334155' : '#fff' }}
                          title={`${streamLabel(s)} vs ${streamLabel(manifest.streams[j])}: ${Number.isNaN(v) ? 'n/a' : v.toFixed(2)}`}>
                          {Number.isNaN(v) ? '—' : v.toFixed(2)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 px-1 font-mono text-[10px] text-slate-400">
            significant calls per stream: {conc.sizes.map((n, i) => `${streamLabel(manifest.streams[i])}=${n}`).join('  ')}
          </div>
        </div>
      </section>
    </div>
  );
}

// ---- small bits -----------------------------------------------------------
function Pad({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-sm text-slate-500">{children}</div>;
}
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="text-sm font-medium text-slate-800">{title}</div>
      <div className="mt-1 font-mono text-xs text-slate-500">{body}</div>
    </div>
  );
}
function NotFound() {
  return (
    <div>
      <a href="#/" className="text-sm text-slate-500 hover:text-slate-800">&larr; All drugs</a>
      <EmptyState title="Drug not found" body="This drug isn't in the manifest. It may not have finished processing yet." />
    </div>
  );
}

// ------------------------------------------------------------------ app ----
export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [cutoff, setCutoff] = useState(0.05);

  useEffect(() => {
    loadManifest().then((m) => { setManifest(m); setCutoff(m.cutoff_default ?? 0.05); }).catch((e) => setLoadErr(String(e)));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (loadErr) {
    return (
      <Shell cutoff={cutoff} setCutoff={setCutoff}>
        <EmptyState title="No data loaded" body={loadErr} />
        <p className="mt-3 text-sm text-slate-500">
          Generate it with <span className="font-mono">python build_frontend_data.py</span> (out_dir = public/data), then reload.
        </p>
      </Shell>
    );
  }
  if (!manifest) {
    return <Shell cutoff={cutoff} setCutoff={setCutoff}><Spinner label="Loading manifest &hellip;" /></Shell>;
  }

  return (
    <Shell cutoff={cutoff} setCutoff={setCutoff}>
      {route.type === 'search' ? <Search manifest={manifest} cutoff={cutoff} />
        : route.type === 'drug' ? <DrugPage manifest={manifest} slug={route.slug} cutoff={cutoff} />
        : <Home manifest={manifest} />}
    </Shell>
  );
}
