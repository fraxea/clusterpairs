// Connect.tsx — CMap-style connectivity (Lamb 2006; Subramanian 2017's tau):
// query a drug's pathway signature (or a hand-built up/down set) against the
// whole atlas. Positive cosine = mimicker, negative = reverser (the classic
// repurposing read-out). tau is the headline specificity score; each hit's
// cosine is decomposed into the generic proliferation-stress axis (atlas PC1)
// vs pathway-specific signal, so generic-toxicity matches are visible.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Annotations, Manifest, Summary } from '../types';
import {
  connectivity, connectivityBackground, netVectors, pc1Axis, type ConnectivityHit,
} from '../analysis';
import { fmtP, pathwaySlug, setHashParams } from '../format';
import { loadAnnotations } from '../data';
import { netColor, ramp } from '../colors';
import { downloadSvg } from '../export';
import { NetLegend, Segmented, StatTile } from '../ui';
import { tipBind, useTip } from '../tooltip';

type Mode = 'drug' | 'custom';

const shortName = (n: string): string => (n.length > 13 ? `${n.slice(0, 12)}…` : n);

const PRESETS: Array<{ name: string; up: string[]; down: string[] }> = [
  {
    name: 'Inflammatory program',
    up: ['TNF-alpha Signaling via NF-kB', 'Inflammatory Response', 'IL-6/JAK/STAT3 Signaling', 'Complement'],
    down: ['Oxidative Phosphorylation'],
  },
  {
    name: 'Proliferation arrest',
    up: [],
    down: ['E2F Targets', 'G2-M Checkpoint', 'Myc Targets V1', 'Mitotic Spindle'],
  },
];

export function Connect({ manifest, summary, params }: {
  manifest: Manifest; summary: Summary; params: URLSearchParams;
}) {
  const tip = useTip();
  const wfRef = useRef<SVGSVGElement>(null);
  const [ann, setAnn] = useState<Annotations>({});
  useEffect(() => { loadAnnotations().then(setAnn); }, []);
  const slugs = useMemo(() => summary.drugs.map((d) => d.slug), [summary.drugs]);
  const nameBySlug = useMemo(() => new Map(manifest.drugs.map((d) => [d.slug, d.name])), [manifest.drugs]);
  const pwBySlug = useMemo(
    () => new Map(manifest.pathways.map((n, i) => [pathwaySlug(n), i])),
    [manifest.pathways],
  );

  const parseSet = (key: string): number[] =>
    (params.get(key) ?? '').split(',').map((s) => pwBySlug.get(s)).filter((i): i is number => i !== undefined);

  const [mode, setMode] = useState<Mode>(params.get('up') || params.get('down') ? 'custom' : 'drug');
  const [queryIdx, setQueryIdx] = useState<number>(() => {
    const i = slugs.indexOf(params.get('q') ?? '');
    return i >= 0 ? i : slugs.findIndex((s) => s.startsWith('digitoxin'));
  });
  const [upSet, setUpSet] = useState<number[]>(() => parseSet('up'));
  const [downSet, setDownSet] = useState<number[]>(() => parseSet('down'));
  const [drugFilter, setDrugFilter] = useState('');

  const writeCustom = (up: number[], down: number[]) => setHashParams({
    q: null,
    up: up.length ? up.map((i) => pathwaySlug(manifest.pathways[i])).join(',') : null,
    down: down.length ? down.map((i) => pathwaySlug(manifest.pathways[i])).join(',') : null,
  });

  // ---- atlas machinery (computed once per summary) ----
  const vecs = useMemo(() => netVectors(summary.drugs), [summary.drugs]);
  const bg = useMemo(() => connectivityBackground(vecs), [vecs]);
  const pc1 = useMemo(() => pc1Axis(vecs), [vecs]);
  const pc1Top = useMemo(() => [...pc1.keys()]
    .sort((a, b) => Math.abs(pc1[b]) - Math.abs(pc1[a])).slice(0, 3)
    .map((j) => manifest.pathways[j]), [pc1, manifest.pathways]);

  // ---- the query vector ----
  const query = useMemo(() => {
    if (mode === 'drug') return vecs[queryIdx] ?? new Float64Array(manifest.pathways.length);
    const q = new Float64Array(manifest.pathways.length);
    for (const i of upSet) q[i] = 1;
    for (const i of downSet) q[i] = -1;
    return q;
  }, [mode, vecs, queryIdx, upSet, downSet, manifest.pathways.length]);

  const qNorm = useMemo(() => Math.sqrt(query.reduce((s, v) => s + v * v, 0)), [query]);
  const qStrong = useMemo(() => query.reduce((s, v) => s + (Math.abs(v) > 0.05 ? 1 : 0), 0), [query]);
  const empty = qNorm === 0;

  const hits = useMemo(
    () => (empty ? [] : connectivity(vecs, query, bg, pc1, mode === 'drug' ? queryIdx : -1)),
    [vecs, query, bg, pc1, mode, queryIdx, empty],
  );

  // pathway display order: by |query| descending, so comparisons read left-to-right
  const order = useMemo(() => [...query.keys()].sort((a, b) => Math.abs(query[b]) - Math.abs(query[a])), [query]);

  const mimickers = hits.filter((h) => h.cos > 0).slice(0, 12);
  const reversers = [...hits].reverse().filter((h) => h.cos < 0).slice(0, 12);
  const nTau95 = hits.filter((h) => Math.abs(h.tau) >= 95).length;

  const drugSuggestions = useMemo(() => {
    const n = drugFilter.trim().toLowerCase();
    if (!n) return [];
    return slugs
      .map((s, i) => ({ i, name: nameBySlug.get(s) ?? s }))
      .filter(({ name, i }) => i !== queryIdx && name.toLowerCase().includes(n))
      .slice(0, 8);
  }, [drugFilter, slugs, nameBySlug, queryIdx]);

  // ---- strip with per-cell tooltip (single gradient div + hit math) ----
  const renderStrip = (vec: Float64Array | number[], h: string) => {
    const n = order.length;
    const stops: string[] = [];
    for (let k = 0; k < n; k += 1) {
      const c = netColor(vec[order[k]] as number);
      stops.push(`${c} ${(k / n) * 100}% ${((k + 1) / n) * 100}%`);
    }
    return (
      <div
        className={`${h} w-full rounded-[3px]`}
        style={{ background: `linear-gradient(to right, ${stops.join(', ')})` }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const k = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
          const p = order[k];
          tip.show(e, (
            <div>
              <div className="font-medium text-stone-900">{manifest.pathways[p]}</div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums">net {(100 * (vec[p] as number)).toFixed(1)}%</div>
            </div>
          ));
        }}
        onMouseLeave={tip.hide}
      />
    );
  };

  // ---- ranked table ----
  const renderHitTable = (title: string, rows: ConnectivityHit[], tone: 'up' | 'down') => (
    <div className="min-w-[26rem] flex-1 rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
        <span className="text-[11px] text-stone-600">τ in bold when |τ| ≥ 95</span>
      </div>
      {rows.length === 0 && <p className="mt-3 text-sm text-stone-500">None on this side.</p>}
      <div className="mt-2 space-y-1">
        {rows.map((h, i) => {
          const slug = slugs[h.target];
          const strong = Math.abs(h.tau) >= 95;
          return (
            <a
              key={slug} href={`#/drug/${encodeURIComponent(slug)}`}
              className="block rounded-md px-2 py-1.5 hover:bg-stone-50"
              {...tipBind(tip, () => ((
                <div>
                  <div className="font-medium text-stone-900">{nameBySlug.get(slug)}</div>
                  <div className="mt-0.5 font-mono text-[11px] tabular-nums">
                    cos {h.cos.toFixed(3)} · τ {h.tau.toFixed(1)} · {fmtP(h.p)} · FDR {h.fdr < 0.001 ? '<0.001' : h.fdr.toFixed(3)}
                  </div>
                  <div className="mt-0.5 text-[11px]">
                    generic axis {h.generic.toFixed(2)} · specific {h.specific.toFixed(2)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-stone-600">
                    driven by {h.contrib.map((c) => manifest.pathways[c.pathway]).join(' · ')}
                  </div>
                </div>
              )))}
            >
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right font-mono text-[10px] text-stone-600">{i + 1}</span>
                <span className="w-40 shrink-0">
                  <span className="block truncate text-sm text-stone-800">{nameBySlug.get(slug)}</span>
                  {ann[slug]?.moa?.[0] && (
                    <span className="block truncate text-[10px] leading-tight text-stone-600">{ann[slug].moa[0]}</span>
                  )}
                </span>
                <span className="w-44 shrink-0">{renderStrip(vecs[h.target], 'h-2')}</span>
                {/* cosine split: generic (ink) + specific (tone) share of |cos| */}
                <span className="flex h-2 w-24 shrink-0 overflow-hidden rounded-[2px] bg-stone-100" title="generic vs specific share">
                  <span style={{
                    width: `${Math.min(100, 100 * Math.max(0, (tone === 'up' ? h.generic : -h.generic)))}%`,
                    background: ramp('ink', 0.35),
                  }} />
                  <span style={{
                    width: `${Math.min(100, 100 * Math.max(0, (tone === 'up' ? h.specific : -h.specific)))}%`,
                    background: ramp(tone, 0.55),
                  }} />
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-stone-700">{h.cos.toFixed(2)}</span>
                <span className={`w-10 shrink-0 text-right font-mono text-xs tabular-nums ${strong ? 'font-bold text-stone-900' : 'text-stone-400'}`}>
                  {Math.round(h.tau)}
                </span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );

  // ---- waterfall ----
  const WF_W = 720; const WF_H = 150;
  const renderWaterfall = () => {
    const n = hits.length;
    if (n === 0) return null;
    const bw = WF_W / n;
    const zero = WF_H / 2;
    return (
      <svg
        ref={wfRef}
        width={WF_W} height={WF_H} viewBox={`0 0 ${WF_W} ${WF_H}`} className="max-w-full"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const k = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
          const h = hits[k];
          tip.show(e, (
            <div>
              <div className="font-medium text-stone-900">{nameBySlug.get(slugs[h.target])}</div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums">cos {h.cos.toFixed(3)} · τ {h.tau.toFixed(1)}</div>
            </div>
          ));
        }}
        onMouseLeave={tip.hide}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const k = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
          window.location.hash = `#/drug/${encodeURIComponent(slugs[hits[k].target])}`;
        }}
        style={{ cursor: 'pointer' }}
      >
        <line x1={0} y1={zero} x2={WF_W} y2={zero} stroke="#c3c2b7" strokeWidth={1} />
        {hits.map((h, k) => (
          <rect
            key={k}
            x={k * bw} width={Math.max(0.8, bw - 0.3)}
            y={h.cos >= 0 ? zero - (h.cos * (zero - 4)) : zero}
            height={Math.abs(h.cos) * (zero - 4)}
            fill={ramp(h.cos >= 0 ? 'up' : 'down', 0.25 + 0.5 * Math.abs(h.cos))}
          />
        ))}
        <text x={6} y={14} fontSize={10.5} fill="#898781">mimickers →</text>
        <text x={WF_W - 6} y={WF_H - 6} fontSize={10.5} fill="#898781" textAnchor="end">← reversers</text>
      </svg>
    );
  };

  const togglePathway = (i: number, set: 'up' | 'down') => {
    const [cur, other, setCur, setOther] = set === 'up'
      ? [upSet, downSet, setUpSet, setDownSet]
      : [downSet, upSet, setDownSet, setUpSet];
    const nextCur = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i];
    const nextOther = other.filter((x) => x !== i);
    setCur(nextCur); setOther(nextOther);
    writeCustom(set === 'up' ? nextCur : nextOther, set === 'up' ? nextOther : nextCur);
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Connectivity</h1>
      <p className="mt-1 max-w-3xl text-sm text-stone-500">
        Connectivity mapping over pathway space: score a query signature against every drug in the atlas.
        Positive cosine = the drug <span className="font-medium text-stone-700">mimics</span> the query program;
        negative = it <span className="font-medium text-stone-700">reverses</span> it — the classic drug-repurposing
        read-out. τ is each hit&rsquo;s percentile against that drug&rsquo;s own background connectivity.
      </p>

      {/* query builder */}
      <div className="mt-5 rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            options={[
              { value: 'drug', label: 'Drug signature' },
              { value: 'custom', label: 'Custom pathway set' },
            ]}
            value={mode}
            onChange={(v) => { setMode(v); if (v === 'drug') setHashParams({ up: null, down: null, q: slugs[queryIdx] }); else writeCustom(upSet, downSet); }}
          />
          {mode === 'drug' && (
            <>
              <span className="rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-sm font-medium text-stone-800">
                {nameBySlug.get(slugs[queryIdx]) ?? '—'}
              </span>
              <div className="relative">
                <input
                  value={drugFilter} onChange={(e) => setDrugFilter(e.target.value)}
                  placeholder="Change query drug…"
                  className="w-56 rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-500"
                />
                {drugSuggestions.length > 0 && (
                  <div className="absolute left-0 top-9 z-10 w-72 rounded-md border border-stone-200 bg-white py-1 shadow-lg">
                    {drugSuggestions.map(({ i, name }) => (
                      <button
                        key={i} type="button"
                        className="block w-full truncate px-3 py-1.5 text-left text-sm text-stone-700 hover:bg-stone-50"
                        onClick={() => { setQueryIdx(i); setDrugFilter(''); setHashParams({ q: slugs[i], up: null, down: null }); }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {mode === 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((pr) => (
                <button
                  key={pr.name} type="button"
                  className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-600 hover:border-stone-500"
                  onClick={() => {
                    const up = pr.up.map((n) => manifest.pathways.indexOf(n)).filter((i) => i >= 0);
                    const down = pr.down.map((n) => manifest.pathways.indexOf(n)).filter((i) => i >= 0);
                    setUpSet(up); setDownSet(down); writeCustom(up, down);
                  }}
                >
                  {pr.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === 'custom' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(['up', 'down'] as const).map((side) => (
              <div key={side}>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-stone-500">
                  <span className="h-2 w-2 rounded-full" style={{ background: ramp(side, 0.55) }} />
                  {side === 'up' ? 'Query up' : 'Query down'}
                </div>
                <div className="flex max-h-28 flex-wrap gap-1 overflow-auto rounded-md border border-stone-200 p-2">
                  {manifest.pathways.map((n, i) => {
                    const active = (side === 'up' ? upSet : downSet).includes(i);
                    return (
                      <button
                        key={i} type="button" onClick={() => togglePathway(i, side)}
                        className={`rounded-full border px-2 py-0.5 text-[10.5px] ${
                          active
                            ? 'border-stone-900 bg-stone-900 text-white'
                            : 'border-stone-200 bg-white text-stone-500 hover:border-stone-400'}`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {!empty && (
          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between text-[11px] text-stone-600">
              <span>query signature — pathways ordered by |net|, hover for names</span>
              <span className="font-mono tabular-nums">
                ‖q‖ = {qNorm.toFixed(2)} · {qStrong} pathways with |net| &gt; 0.05
              </span>
            </div>
            {renderStrip(query, 'h-2.5')}
            <div className="mt-2"><NetLegend note="strips below share this scale" /></div>
          </div>
        )}
        {!empty && mode === 'drug' && qNorm < 0.2 && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Weak signature (‖q‖ &lt; 0.2, {qStrong} responsive pathways) — rankings from queries this faint are
            unstable; even same-class drugs may not surface.
          </p>
        )}
      </div>

      {empty ? (
        <p className="mt-5 text-sm text-stone-500">Pick a query drug or add pathways to the custom set.</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Atlas drugs scored" value={`${hits.length}`} sub="cosine on 50-dim net-direction signatures" />
            <StatTile label="|τ| ≥ 95" value={`${nTau95}`} sub="connect above the 95th pct of their background" />
            <StatTile
              label="Strongest mimic" value={hits[0] ? shortName(nameBySlug.get(slugs[hits[0].target]) ?? '') : '—'}
              sub={hits[0] ? `cos ${hits[0].cos.toFixed(2)} · τ ${Math.round(hits[0].tau)}` : ''}
            />
            <StatTile
              label="Strongest reverser"
              value={hits.length ? shortName(nameBySlug.get(slugs[hits[hits.length - 1].target]) ?? '') : '—'}
              sub={hits.length ? `cos ${hits[hits.length - 1].cos.toFixed(2)} · τ ${Math.round(hits[hits.length - 1].tau)}` : ''}
            />
          </div>

          <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
            {renderWaterfall()}
            <div className="mt-1 flex items-center justify-between">
              <p className="text-[11px] text-stone-600">
                All {hits.length} drugs ranked by connectivity to the query · click a bar to open the drug.
              </p>
              <button
                type="button"
                onClick={() => downloadSvg(wfRef.current, 'connectivity_waterfall')}
                className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] text-stone-500 hover:border-stone-500"
                title="Download this figure as SVG"
              >
                SVG ↓
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-4">
            {renderHitTable('Top mimickers', mimickers, 'up')}
            {renderHitTable('Top reversers', reversers, 'down')}
          </div>

          <p className="mt-4 max-w-3xl text-xs text-stone-500">
            The split bar decomposes each cosine into the <span className="font-medium">generic axis</span> (gray —
            alignment with the atlas&rsquo;s first principal component: {pc1Top.join(', ')} — the shared
            proliferation-stress response) and <span className="font-medium">specific</span> signal (colored).
            Hits that are mostly gray connect through generic cytostatic behavior, not shared pharmacology.
            Signatures are net directions from the signed streams only; this is transcriptional-program matching,
            not mechanism-of-action identification. Permutation p (1000 coordinate shuffles) and BH-FDR are in
            the tooltips; τ ≥ 95 is the recommended filter.
          </p>
        </>
      )}
    </div>
  );
}
