// Heterogeneity.tsx — subpopulation-selective response. Tahoe's drug clusters
// are distinct cellular contexts; a drug whose clusters disagree is acting
// selectively (the substrate of residual disease and resistance in the
// intratumor-heterogeneity literature). Uniform killers sit at the other end.
// All numbers from hetero.json: per-query-cluster net directions, signed
// streams only, fixed reference cutoff.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Hetero, Manifest } from '../types';
import { loadHetero } from '../data';
import { heteroProfile, heteroStats } from '../analysis';
import { fmtPct, pathwaySlug } from '../format';
import { NONSIG, ramp, textOn } from '../colors';
import { Spinner, StatTile } from '../ui';
import { downloadCsv } from '../export';
import { useTip } from '../tooltip';

const NET_SAT = 0.4;
const netColor = (v: number): string =>
  Math.abs(v) < 0.01 ? NONSIG : ramp(v > 0 ? 'up' : 'down', 0.12 + 0.88 * Math.min(1, Math.abs(v) / NET_SAT));

// A pathway divergent in more than a third of drugs is "commonly divergent" —
// proliferation programs split clusters for half the library, so flag them.
const COMMON_DIV = 1 / 3;

export function Heterogeneity({ manifest }: { manifest: Manifest }) {
  const tip = useTip();
  const [hetero, setHetero] = useState<Hetero | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    loadHetero().then(setHetero).catch((e) => setErr(String(e)));
  }, []);

  const nameBySlug = useMemo(() => new Map(manifest.drugs.map((d) => [d.slug, d.name])), [manifest.drugs]);

  const model = useMemo(() => {
    if (!hetero) return null;
    const rows = hetero.drugs.map((d) => {
      const prof = heteroProfile(d.up, d.down, d.tested);
      const st = heteroStats(prof);
      return { slug: d.slug, clusters: d.clusters, prof, ...st };
    });
    const divCount = new Array<number>(manifest.pathways.length).fill(0);
    for (const r of rows) for (const p of r.divergent) divCount[p] += 1;
    const common = new Set(divCount.flatMap((c, p) => (c / rows.length >= COMMON_DIV ? [p] : [])));
    const ranked = [...rows].sort((a, b) => b.dispersion - a.dispersion);
    const median = ranked[Math.floor(ranked.length / 2)].dispersion;
    return { ranked, common, median, divCount };
  }, [hetero, manifest.pathways.length]);

  const sel = useMemo(
    () => model?.ranked.find((r) => r.slug === selected) ?? model?.ranked[0] ?? null,
    [model, selected],
  );

  // The two panels always sit side by side; the heatmap measures its card and
  // shrinks cells (48px -> 30px floor) so every cluster fits without scrolling.
  const measureRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    setAvailW(el.clientWidth);
    const ro = new ResizeObserver((es) => setAvailW(es[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hetero]);

  if (err) return <p className="text-sm text-stone-500">hetero.json missing — rerun scripts/build_summary.py. ({err})</p>;
  if (!hetero || !model) return <Spinner label="Loading cluster profiles…" />;

  const shown = showAll ? model.ranked : model.ranked.slice(0, 30);
  const maxDisp = Math.max(...model.ranked.map((r) => r.dispersion));

  // detail: pathways ordered by cross-cluster sd
  const detailPaths = sel
    ? [...sel.sd.keys()].sort((a, b) => sel.sd[b] - sel.sd[a]).slice(0, 14)
    : [];

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Heterogeneity</h1>
      <p className="mt-1 max-w-3xl text-sm text-stone-500">
        Do all of a drug&rsquo;s cell clusters respond the same way? Dispersion is the mean disagreement
        between per-cluster response profiles (signed streams, q &lt; 0.05). Uniform killers sit low;
        context-selective drugs — the substrate of resistance — sit high. A{' '}
        <span className="rounded bg-amber-100 px-1 text-amber-800">common</span> tag marks pathways that
        split clusters for over a third of all drugs (the proliferation programs) — cluster differences
        there are baseline biology, not drug selectivity.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Median dispersion" value={model.median.toFixed(3)} sub="RMS distance between cluster profiles" />
        <StatTile
          label="Most heterogeneous" value={(nameBySlug.get(model.ranked[0].slug) ?? '').slice(0, 14)}
          sub={`dispersion ${model.ranked[0].dispersion.toFixed(3)}`}
        />
        <StatTile
          label="Most uniform" value={(nameBySlug.get(model.ranked[model.ranked.length - 1].slug) ?? '').slice(0, 14)}
          sub={`dispersion ${model.ranked[model.ranked.length - 1].dispersion.toFixed(3)}`}
        />
        <StatTile label="Commonly divergent" value={`${model.common.size}`} sub="pathways that split clusters in >⅓ of drugs" />
      </div>

      {/* Same width as the stat tiles above (the page container): fixed-width
          ranking on the left, the heatmap taking the rest and sizing its cells
          to fit — see the availW measurement. */}
      <div className="mt-5 flex flex-wrap gap-4 lg:flex-nowrap">
        {/* ranking — fixed column so the heatmap gets the rest */}
        <div className="w-full rounded-lg border border-stone-200 bg-white p-4 lg:w-[24rem] lg:shrink-0 lg:grow-0">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-stone-800">Drugs by cluster disagreement</h3>
            <button
              type="button"
              onClick={() => downloadCsv(model.ranked.map((r, i) => ({
                rank: i + 1, drug: nameBySlug.get(r.slug) ?? r.slug, slug: r.slug,
                dispersion: r.dispersion.toFixed(4), n_clusters: r.clusters.length,
                divergent_pathways: r.divergent.map((p) => manifest.pathways[p]).join('; '),
              })), 'heterogeneity_ranking')}
              className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] text-stone-500 hover:border-stone-500"
              title="Download the full ranking as CSV"
            >
              CSV ↓
            </button>
          </div>
          <div className="mt-2 space-y-0.5">
            {shown.map((r, i) => {
              const active = sel?.slug === r.slug;
              const strictDiv = r.divergent.filter((p) => !model.common.has(p));
              return (
                <button
                  key={r.slug} type="button" onClick={() => setSelected(r.slug)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left ${
                    active ? 'bg-stone-100 ring-1 ring-stone-300' : 'hover:bg-stone-50'}`}
                >
                  <span className="w-6 shrink-0 text-right font-mono text-[10px] text-stone-400">{i + 1}</span>
                  <span className="w-44 shrink-0 truncate text-sm text-stone-800">{nameBySlug.get(r.slug)}</span>
                  <span className="h-2 flex-1 rounded-[3px] bg-stone-100">
                    <span
                      className="block h-full rounded-[3px]"
                      style={{ width: `${(r.dispersion / maxDisp) * 100}%`, background: ramp('ink', 0.3 + 0.4 * (r.dispersion / maxDisp)) }}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-stone-600">{r.dispersion.toFixed(3)}</span>
                  <span
                    className={`w-8 shrink-0 text-right font-mono text-[10px] tabular-nums ${strictDiv.length > 0 ? 'text-stone-700' : 'text-stone-300'}`}
                    title="pathways where clusters disagree in direction (excluding commonly-divergent ones)"
                  >
                    {strictDiv.length > 0 ? `${strictDiv.length}⇅` : '—'}
                  </span>
                </button>
              );
            })}
          </div>
          {!showAll && model.ranked.length > 30 && (
            <button
              type="button" onClick={() => setShowAll(true)}
              className="mt-2 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-600 hover:border-stone-500"
            >
              Show all {model.ranked.length} drugs
            </button>
          )}
        </div>

        {/* detail */}
        {sel && (() => {
          // pathway column ~264px incl. padding; 3px per-cell gap; 30px floor
          const nC = sel.clusters.length;
          const cellW = availW > 0
            ? Math.max(30, Math.min(48, Math.floor((availW - 264) / nC) - 3))
            : 48;
          const cellH = cellW >= 42 ? 28 : 24;
          const cellFont = cellW >= 40 ? 11 : 10;
          return (
          <div className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="truncate text-sm font-semibold text-stone-800">
                {nameBySlug.get(sel.slug)} — cluster × pathway response
              </h3>
              <a href={`#/drug/${encodeURIComponent(sel.slug)}`} className="shrink-0 text-xs font-medium text-emerald-700 hover:text-emerald-800">
                drug page →
              </a>
            </div>
            <p className="mb-3 mt-0.5 text-xs text-stone-500">
              Net direction per cluster, pathways ordered by cross-cluster variability.
              Red = that subpopulation shifts the pathway up, blue = down.
            </p>
            {/* many-cluster drugs scroll horizontally inside the card; the
                pathway column stays pinned so rows remain readable */}
            <div ref={measureRef} className="overflow-x-auto pb-1.5">
              <table className="border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-[1] bg-white pr-3 text-left text-[11px] font-medium text-stone-400">pathway \ cluster</th>
                    {sel.clusters.map((c) => (
                      <th key={c} className="px-0.5 pb-1.5 text-center font-mono text-[11px] font-normal text-stone-500" style={{ minWidth: cellW }}>{c}</th>
                    ))}
                  </tr>
                </thead>
              <tbody>
                {detailPaths.map((p) => (
                  <tr key={p}>
                    <th className="sticky left-0 z-[1] max-w-60 truncate bg-white py-0.5 pr-3 text-left text-[13px] font-normal text-stone-700 shadow-[1px_0_0_#f5f5f4]">
                      <a href={`#/pathway/${pathwaySlug(manifest.pathways[p])}`} className="hover:text-emerald-800 hover:underline">
                        {manifest.pathways[p]}
                      </a>
                      {model.common.has(p) && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 text-[9px] text-amber-800" title="divergent in >⅓ of all drugs — cluster baseline biology, not drug selectivity">
                          common
                        </span>
                      )}
                    </th>
                    {sel.prof.nets.map((row, q) => {
                      const v = row[p];
                      const t = Math.min(1, Math.abs(v) / NET_SAT);
                      return (
                        <td key={q} className="p-[1.5px]">
                          <div
                            className="flex items-center justify-center rounded-[3px] font-mono tabular-nums"
                            style={{
                              width: cellW, height: cellH, fontSize: cellFont,
                              background: netColor(v),
                              color: Math.abs(v) < 0.01 ? '#a9a69c' : textOn(v > 0 ? 'up' : 'down', 0.12 + 0.88 * t),
                            }}
                            onMouseMove={(e) => tip.show(e, (
                              <div>
                                <div className="font-medium text-stone-900">{manifest.pathways[p]}</div>
                                <div className="text-stone-500">drug cluster {sel.clusters[q]}</div>
                                <div className="mt-0.5 font-mono text-[11px] tabular-nums">
                                  net {(100 * v).toFixed(0)}% · {sel.prof.support[q][p]} directional tests
                                </div>
                              </div>
                            ))}
                            onMouseLeave={tip.hide}
                          >
                            {Math.abs(v) >= 0.05 ? `${v > 0 ? '+' : ''}${Math.round(v * 100)}` : ''}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-stone-400">
              Caveat: clusters can differ in baseline composition (cell line / state), so divergence reads as
              context-dependent response — genotype-selective pharmacology — rather than induced heterogeneity.
              {' '}{fmtPct(sel.divergent.length / manifest.pathways.length)} of pathways split this drug&rsquo;s clusters.
            </p>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
