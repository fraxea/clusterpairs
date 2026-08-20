// ClusterCoupling.tsx: per-cluster pathway-pair coupling for ONE drug.
//
// The library-wide scatter (one point per drug) averages cluster structure
// away. Here, for each drug cluster separately, the drug's DMSO reference
// clusters are the observations and we correlate pathway A against pathway B
// across them, in three channels (up / down / unsigned). The line plot shows
// whether the two programs are coupled everywhere, or only in some
// subpopulations.
//
// n = n_ref (9-12), so this is Spearman with a permutation p and BH across the
// cluster x channel grid. The UI states the n and the caveat on every view.
import { useEffect, useMemo, useState } from 'react';
import type { DrugData, Manifest } from '../types';
import { loadDrug } from '../data';
import {
  CHANNELS, channelCube, clusterEnrichment, pairCoupling,
  type Channel, type CouplingPoint,
} from '../analysis';
import { BASE_THR } from '../significance';
import { ramp } from '../colors';
import { fmtP, fmtPct, pathwaySlug } from '../format';
import { Spinner, StatTile } from '../ui';
import { downloadCsv, downloadSvg } from '../export';
import { tipBind, useTip } from '../tooltip';
import { useRef } from 'react';

const CH_LABEL: Record<Channel, string> = { up: 'up-regulation', down: 'down-regulation', uns: 'no direction' };
const CH_COLOR: Record<Channel, string> = { up: ramp('up', 0.62), down: ramp('down', 0.62), uns: ramp('uns', 0.62) };

const W = 720; const H = 340;
const M = { l: 54, r: 130, t: 18, b: 44 };
const PW = W - M.l - M.r; const PH = H - M.t - M.b;

export function ClusterCoupling({ manifest, slug, aIdx, bIdx, onPickDrug }: {
  manifest: Manifest; slug: string | null; aIdx: number; bIdx: number;
  onPickDrug: (slug: string) => void;
}) {
  const tip = useTip();
  const svgRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<DrugData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selCluster, setSelCluster] = useState<number | null>(null);

  const meta = manifest.drugs.find((d) => d.slug === slug) ?? null;

  // Correlate keys this component by slug, so a drug change remounts it and
  // data/err/selection start fresh. No reset needed here.
  useEffect(() => {
    if (!meta) return;
    const ctrl = new AbortController();
    loadDrug(meta, ctrl.signal)
      .then(setData)
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setErr(String(e));
      });
    return () => ctrl.abort();
  }, [meta]);

  // directional streams only feed up/down; ORA + CellSpectra feed "no direction"
  const signedStreams = useMemo(
    () => new Set(manifest.streams.flatMap((s, i) => (s[0] === 'gsea' || s[0] === 'fgsea' ? [i] : []))),
    [manifest.streams],
  );

  const model = useMemo(() => {
    if (!data || aIdx === bIdx) return null;
    const nP = manifest.pathways.length;
    const nRef = data.ref_clusters.length;
    const nQuery = data.query_clusters.length;
    const cube = channelCube(data.pairwise, nRef, nQuery, nP, signedStreams);
    const pts = pairCoupling(cube, aIdx, bIdx);
    const enrich = clusterEnrichment(data.pairwise, nRef, nQuery, nP, BASE_THR);
    return { pts, enrich, nRef, nQuery, nP };
  }, [data, aIdx, bIdx, manifest.pathways.length, signedStreams]);

  const suggestions = useMemo(() => {
    const n = filter.trim().toLowerCase();
    if (!n) return [];
    return manifest.drugs.filter((d) => d.name.toLowerCase().includes(n)).slice(0, 8);
  }, [filter, manifest.drugs]);

  const byChannel = (ch: Channel): CouplingPoint[] =>
    (model?.pts ?? []).filter((p) => p.channel === ch).sort((a, b) => a.cluster - b.cluster);

  const nSig = model?.pts.filter((p) => !p.degenerate && p.q < 0.05).length ?? 0;
  const nLive = model?.pts.filter((p) => !p.degenerate).length ?? 0;

  // ---- plot geometry ----
  const nQ = model?.nQuery ?? 0;
  const x = (c: number): number => (nQ <= 1 ? M.l + PW / 2 : M.l + (c / (nQ - 1)) * PW);
  const y = (rho: number): number => M.t + PH / 2 - (rho * PH) / 2;

  return (
    <div className="mt-5">
      {/* drug picker */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white p-3">
        <span className="text-sm font-medium text-stone-600">drug</span>
        <span className="rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-sm font-medium text-stone-800">
          {meta ? meta.name : 'none selected'}
        </span>
        <div className="relative">
          <input
            value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder={meta ? 'Change drug…' : 'Search a drug…'}
            className="w-60 rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-500"
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 top-9 z-10 w-72 rounded-md border border-stone-200 bg-white py-1 shadow-lg">
              {suggestions.map((d) => (
                <button
                  key={d.slug} type="button"
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-stone-700 hover:bg-stone-50"
                  onClick={() => { onPickDrug(d.slug); setFilter(''); }}
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {meta && (
          <span className="ml-auto font-mono text-[11px] text-stone-500">
            {meta.n_ref} DMSO × {meta.n_query} drug clusters
          </span>
        )}
      </div>

      {!meta && <p className="mt-4 text-sm text-stone-600">Pick a drug to compute per-cluster coupling.</p>}
      {err && <p className="mt-4 text-sm text-stone-600">Could not load this drug. {err}</p>}
      {meta && !data && !err && <div className="mt-4"><Spinner label="Loading cluster-level results…" /></div>}

      {aIdx === bIdx && meta && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Both pathways are the same, so the correlation is trivially 1. Pick two different pathways above.
        </p>
      )}

      {model && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Observations per point" value={`n = ${model.nRef}`} sub="DMSO reference clusters" />
            <StatTile label="Drug clusters" value={`${model.nQuery}`} sub="one x-position each" />
            <StatTile label="Coupled points" value={`${nSig}`} sub={`of ${nLive} tested · BH q < 0.05`} />
            <StatTile
              label="Clusters fully coupled"
              value={`${Array.from({ length: model.nQuery }, (_, c) =>
                model.pts.filter((p) => p.cluster === c && !p.degenerate && p.q < 0.05).length).filter((k) => k === 3).length}`}
              sub="significant in all three channels"
            />
          </div>

          {/* line plot */}
          <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-stone-800">
                {manifest.pathways[aIdx]} × {manifest.pathways[bIdx]}: coupling per drug cluster
              </h3>
              <span className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => downloadSvg(svgRef.current, `coupling_${pathwaySlug(manifest.pathways[aIdx])}_${pathwaySlug(manifest.pathways[bIdx])}`)}
                  className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] text-stone-600 hover:border-stone-500"
                >
                  SVG ↓
                </button>
                <button
                  type="button"
                  onClick={() => downloadCsv(model.pts.map((p) => ({
                    drug: meta?.name ?? '', cluster: data?.query_clusters[p.cluster] ?? p.cluster,
                    channel: p.channel, n: p.n,
                    spearman_rho: p.degenerate ? '' : p.rho.toFixed(4),
                    perm_p: p.degenerate ? '' : p.p.toFixed(5),
                    bh_q: p.degenerate ? '' : p.q.toFixed(5),
                    note: p.degenerate ? 'no variance in channel' : '',
                  })), 'cluster_coupling')}
                  className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] text-stone-600 hover:border-stone-500"
                >
                  CSV ↓
                </button>
              </span>
            </div>

            <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mt-2 max-w-full" fontFamily="system-ui, sans-serif">
              {/* y grid */}
              {[-1, -0.5, 0, 0.5, 1].map((v) => (
                <g key={v}>
                  <line x1={M.l} y1={y(v)} x2={M.l + PW} y2={y(v)} stroke={v === 0 ? '#c3c2b7' : '#eceae4'} strokeWidth={1} />
                  <text x={M.l - 8} y={y(v) + 3.5} fontSize={10.5} fill="#52514e" textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {v.toFixed(1)}
                  </text>
                </g>
              ))}
              {/* x labels */}
              {Array.from({ length: nQ }, (_, c) => (
                <text key={c} x={x(c)} y={M.t + PH + 18} fontSize={10.5} fill="#52514e" textAnchor="middle">
                  {data?.query_clusters[c] ?? c}
                </text>
              ))}
              <text x={M.l + PW / 2} y={H - 8} fontSize={11.5} fill="#3d3c38" textAnchor="middle">drug cluster</text>
              <text x={14} y={M.t + PH / 2} fontSize={11.5} fill="#3d3c38" textAnchor="middle"
                transform={`rotate(-90 14 ${M.t + PH / 2})`}>
                Spearman ρ
              </text>

              {/* one line per channel; gaps where a channel has no variance */}
              {CHANNELS.map((ch) => {
                const row = byChannel(ch);
                const segs: string[] = [];
                let cur: string[] = [];
                for (const p of row) {
                  if (p.degenerate) { if (cur.length > 1) segs.push(cur.join(' ')); cur = []; }
                  else cur.push(`${x(p.cluster)},${y(p.rho)}`);
                }
                if (cur.length > 1) segs.push(cur.join(' '));
                return (
                  <g key={ch}>
                    {segs.map((s, i) => (
                      <polyline key={i} points={s} fill="none" stroke={CH_COLOR[ch]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    ))}
                    {row.filter((p) => !p.degenerate).map((p) => {
                      const sig = p.q < 0.05;
                      return (
                        <circle
                          key={p.cluster}
                          cx={x(p.cluster)} cy={y(p.rho)} r={sig ? 5 : 3.6}
                          fill={sig ? CH_COLOR[ch] : '#ffffff'}
                          stroke={CH_COLOR[ch]} strokeWidth={2}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelCluster(p.cluster)}
                          {...tipBind(tip, () => (
                            <div>
                              <div className="font-medium text-stone-900">
                                cluster {data?.query_clusters[p.cluster]} · {CH_LABEL[ch]}
                              </div>
                              <div className="mt-0.5 font-mono text-[11px] tabular-nums">
                                ρ = {p.rho.toFixed(3)} · n = {p.n}<br />
                                {fmtP(p.p)} (permutation) · BH q = {p.q < 0.001 ? '<0.001' : p.q.toFixed(3)}
                              </div>
                              <div className="mt-0.5 text-[10px] text-stone-500">
                                {sig ? 'coupled in this cluster' : 'not distinguishable from noise'} · click for cluster detail
                              </div>
                            </div>
                          ), `cluster ${data?.query_clusters[p.cluster]} ${CH_LABEL[ch]}: rho ${p.rho.toFixed(2)}, ${p.q < 0.05 ? 'significant' : 'not significant'}`)}
                        />
                      );
                    })}
                  </g>
                );
              })}

              {/* legend */}
              {CHANNELS.map((ch, i) => (
                <g key={ch} transform={`translate(${M.l + PW + 16}, ${M.t + 10 + i * 20})`}>
                  <line x1={0} y1={0} x2={18} y2={0} stroke={CH_COLOR[ch]} strokeWidth={2} />
                  <circle cx={9} cy={0} r={4} fill={CH_COLOR[ch]} />
                  <text x={24} y={3.5} fontSize={10.5} fill="#52514e">{CH_LABEL[ch]}</text>
                </g>
              ))}
              <g transform={`translate(${M.l + PW + 16}, ${M.t + 82})`}>
                <circle cx={9} cy={0} r={4} fill="#7b786f" />
                <text x={24} y={3.5} fontSize={10} fill="#52514e">q &lt; 0.05</text>
                <circle cx={9} cy={18} r={3.6} fill="#fff" stroke="#7b786f" strokeWidth={2} />
                <text x={24} y={21.5} fontSize={10} fill="#52514e">not sig.</text>
              </g>
            </svg>

            <p className="mt-1 text-[11px] leading-relaxed text-stone-600">
              Each point is a Spearman correlation of the two pathways across this drug&rsquo;s {model.nRef} DMSO
              reference clusters, computed separately per drug cluster and channel. Filled = BH q &lt; 0.05
              across the {nLive} tests shown; p from 2,000 permutations. Gaps = the channel has no variance
              in that cluster (e.g. the pathway is never called down).
              <strong className="font-medium text-stone-700"> With n = {model.nRef}, ρ must exceed roughly 0.6
              to reach significance, and individual estimates are noisy. Read this as exploratory.</strong>
            </p>
          </div>

          {/* cluster detail: what else is enriched here */}
          <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-stone-800">
                What else is enriched in {selCluster === null ? 'each cluster' : `cluster ${data?.query_clusters[selCluster]}`}
              </h3>
              {selCluster !== null && (
                <button type="button" onClick={() => setSelCluster(null)}
                  className="text-xs font-medium text-emerald-700 hover:text-emerald-800">
                  show all clusters
                </button>
              )}
            </div>
            <p className="mb-3 mt-0.5 text-xs text-stone-600">
              Share of that cluster&rsquo;s tests (all streams × all DMSO refs) reaching q &lt; 0.05.
              The two selected pathways are outlined. Click a point on the plot above to focus one cluster.
            </p>
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: model.nQuery }, (_, c) => c)
                .filter((c) => selCluster === null || c === selCluster)
                .map((c) => {
                  const top = model.enrich.frac[c]
                    .map((f, p) => ({ f, p }))
                    .sort((u, v) => v.f - u.f)
                    .slice(0, selCluster === null ? 5 : 12);
                  const coupled = model.pts.filter((p) => p.cluster === c && !p.degenerate && p.q < 0.05).length;
                  return (
                    <div key={c} className="min-w-56 flex-1 rounded-md border border-stone-200 p-3">
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono text-xs font-semibold text-stone-800">
                          cluster {data?.query_clusters[c]}
                        </span>
                        <span className="text-[10px] text-stone-500">{coupled}/3 channels coupled</span>
                      </div>
                      <div className="mt-1.5 space-y-1">
                        {top.map(({ f, p }) => {
                          const isPair = p === aIdx || p === bIdx;
                          return (
                            <a
                              key={p} href={`#/pathway/${pathwaySlug(manifest.pathways[p])}`}
                              className={`flex items-center gap-2 rounded px-1 py-0.5 hover:bg-stone-50 ${
                                isPair ? 'ring-1 ring-emerald-500' : ''}`}
                            >
                              <span className="min-w-0 flex-1 truncate text-[12px] text-stone-700">
                                {manifest.pathways[p]}
                              </span>
                              <span className="h-1.5 w-12 shrink-0 rounded-full bg-stone-100">
                                <span className="block h-full rounded-full" style={{ width: `${f * 100}%`, background: ramp('ink', 0.3 + 0.5 * f) }} />
                              </span>
                              <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-stone-600">
                                {fmtPct(f)}
                              </span>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
