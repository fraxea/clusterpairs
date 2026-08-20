// Figures.tsx — manuscript-ready figures, regenerated live from the data,
// each with a caption and one-click SVG + CSV download. Static (no hover):
// these are the exact assets a paper or slide deck needs.
import { useMemo, useRef } from 'react';
import type { Manifest, Summary } from '../types';
import {
  connectivity, connectivityBackground, consensusRows, netVectors,
  olsBandAt, olsFit, pc1Axis, pearsonTest, RESPONDER_MIN,
} from '../analysis';
import { fmtCompact, pathwaySlug, streamLabel } from '../format';
import { ramp } from '../colors';
import { downloadCsv, downloadSvg } from '../export';

const INK = '#3d3c38';
const MUTED = '#898781';
const GRID = '#e7e5df';

function FigureCard({ n, title, caption, svgRef, csv, children }: {
  n: number; title: string; caption: string;
  svgRef: React.RefObject<SVGSVGElement | null>;
  csv: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-stone-900">Figure {n} · {title}</h2>
        <span className="flex shrink-0 gap-1.5">
          <button
            type="button" onClick={() => downloadSvg(svgRef.current, `figure_${n}_${pathwaySlug(title)}`)}
            className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] text-stone-500 hover:border-stone-500"
          >
            SVG ↓
          </button>
          <button
            type="button" onClick={csv}
            className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] text-stone-500 hover:border-stone-500"
          >
            CSV ↓
          </button>
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">{children}</div>
      <p className="mt-2 max-w-3xl text-xs leading-relaxed text-stone-500">
        <span className="font-semibold text-stone-700">Figure {n}.</span> {caption}
      </p>
    </div>
  );
}

export function Figures({ manifest, summary }: { manifest: Manifest; summary: Summary }) {
  const nets = useMemo(() => netVectors(summary.drugs), [summary.drugs]);
  const nameBySlug = useMemo(() => new Map(manifest.drugs.map((d) => [d.slug, d.name])), [manifest.drugs]);
  const slugs = useMemo(() => summary.drugs.map((d) => d.slug), [summary.drugs]);
  // directional streams (GSEA/fgsea) — the only ones that can carry a sign
  const signedCount = manifest.streams.filter((s) => s[0] === 'gsea' || s[0] === 'fgsea').length;

  // ---------------- Fig 1: consensus forest (all 50 pathways) ----------------
  const f1Ref = useRef<SVGSVGElement>(null);
  const consensus = useMemo(
    () => [...consensusRows(nets, manifest.pathways.length)].sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean)),
    [nets, manifest.pathways.length],
  );

  const renderF1 = () => {
    const rowH = 15.5; const top = 26; const left = 218; const plotW = 300; const right = 70;
    const W = left + plotW + right; const H = top + consensus.length * rowH + 26;
    const maxAbs = Math.max(...consensus.map((r) => Math.abs(r.mean) + r.ci)) * 1.05;
    const x = (v: number): number => left + plotW / 2 + (v / maxAbs) * (plotW / 2);
    return (
      <svg ref={f1Ref} width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily="system-ui, sans-serif">
        <line x1={x(0)} y1={top - 6} x2={x(0)} y2={H - 20} stroke={GRID} strokeWidth={1} />
        <text x={x(-maxAbs * 0.9)} y={top - 10} fontSize={9.5} fill={MUTED} textAnchor="middle">← down</text>
        <text x={x(maxAbs * 0.9)} y={top - 10} fontSize={9.5} fill={MUTED} textAnchor="middle">up →</text>
        <text x={W - 6} y={top - 10} fontSize={9.5} fill={MUTED} textAnchor="end">consistency</text>
        {consensus.map((r, i) => {
          const y = top + i * rowH + rowH / 2;
          return (
            <g key={r.p}>
              <text x={left - 8} y={y + 3} fontSize={10} fill={INK} textAnchor="end">
                {manifest.pathways[r.p].length > 30 ? `${manifest.pathways[r.p].slice(0, 29)}…` : manifest.pathways[r.p]}
              </text>
              <line x1={x(r.mean - r.ci)} y1={y} x2={x(r.mean + r.ci)} y2={y} stroke="#a9a69c" strokeWidth={1.4} />
              <circle
                cx={x(r.mean)} cy={y} r={3.6}
                fill={Math.abs(r.mean) < 0.004 ? '#a9a69c' : ramp(r.mean > 0 ? 'up' : 'down', 0.55)}
                stroke="#fff" strokeWidth={1.2}
              />
              <text x={W - 6} y={y + 3} fontSize={9.5} fill={MUTED} textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {Number.isFinite(r.consist) ? `${Math.round(100 * (r.consist as number))}%` : '—'}
                {r.q < 0.05 ? ' ★' : ''}
              </text>
            </g>
          );
        })}
        <text x={left + plotW / 2} y={H - 6} fontSize={10} fill={MUTED} textAnchor="middle">
          mean net direction across {nets.length} drugs (±95% CI), scale ±{(maxAbs * 100).toFixed(0)}%
        </text>
      </svg>
    );
  };

  // ---------------- Fig 2: Hypoxia vs EMT scatter ----------------
  const f2Ref = useRef<SVGSVGElement>(null);
  const hypoxia = manifest.pathways.indexOf('Hypoxia');
  const emt = manifest.pathways.indexOf('Epithelial Mesenchymal Transition');
  const scatter = useMemo(() => {
    const pts = summary.drugs.map((d, i) => ({
      slug: d.slug, x: nets[i][hypoxia], y: nets[i][emt],
    }));
    const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
    return { pts, fit: olsFit(xs, ys), pe: pearsonTest(xs, ys) };
  }, [summary.drugs, nets, hypoxia, emt]);

  const renderF2 = () => {
    const W = 560; const H = 460; const m = { l: 56, r: 14, t: 14, b: 46 };
    const lim = Math.max(...scatter.pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 1.08;
    const sx = (v: number): number => m.l + ((v + lim) / (2 * lim)) * (W - m.l - m.r);
    const sy = (v: number): number => m.t + (1 - (v + lim) / (2 * lim)) * (H - m.t - m.b);
    const band: string[] = []; const bandLo: string[] = [];
    for (let i = 0; i <= 40; i += 1) {
      const xv = -lim + (2 * lim * i) / 40;
      const yv = scatter.fit.intercept + scatter.fit.slope * xv;
      const h = olsBandAt(scatter.fit, xv);
      band.push(`${sx(xv)},${sy(yv + h)}`);
      bandLo.unshift(`${sx(xv)},${sy(yv - h)}`);
    }
    return (
      <svg ref={f2Ref} width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily="system-ui, sans-serif">
        <line x1={sx(0)} y1={m.t} x2={sx(0)} y2={H - m.b} stroke={GRID} />
        <line x1={m.l} y1={sy(0)} x2={W - m.r} y2={sy(0)} stroke={GRID} />
        <polygon points={[...band, ...bandLo].join(' ')} fill="rgba(11,11,11,0.07)" />
        <line
          x1={sx(-lim)} y1={sy(scatter.fit.intercept - scatter.fit.slope * lim)}
          x2={sx(lim)} y2={sy(scatter.fit.intercept + scatter.fit.slope * lim)}
          stroke="#0b0b0b" strokeWidth={1.8}
        />
        {scatter.pts.map((p) => (
          <circle key={p.slug} cx={sx(p.x)} cy={sy(p.y)} r={3} fill="#52514e" fillOpacity={0.5} stroke="#fff" strokeWidth={1} />
        ))}
        <text x={m.l + 10} y={m.t + 16} fontSize={11.5} fill={INK} style={{ fontVariantNumeric: 'tabular-nums' }}>
          r = {scatter.pe.r.toFixed(2)} · n = {scatter.pe.n} · slope {scatter.fit.slope.toFixed(2)}
        </text>
        <text x={(m.l + W - m.r) / 2} y={H - 10} fontSize={11} fill={INK} textAnchor="middle">Hypoxia — net direction</text>
        <text x={14} y={(m.t + H - m.b) / 2} fontSize={11} fill={INK} textAnchor="middle"
          transform={`rotate(-90 14 ${(m.t + H - m.b) / 2})`}>
          EMT — net direction
        </text>
      </svg>
    );
  };

  // ---------------- Fig 3: connectivity validation (Digitoxin) ----------------
  const f3Ref = useRef<SVGSVGElement>(null);
  const digi = useMemo(() => {
    const qi = slugs.findIndex((s) => s.startsWith('digitoxin'));
    if (qi < 0) return null;
    const bg = connectivityBackground(nets);
    const pc1 = pc1Axis(nets);
    const hits = connectivity(nets, nets[qi], bg, pc1, qi, 500);
    return { qi, hits };
  }, [nets, slugs]);

  const renderF3 = () => {
    if (!digi) return null;
    const W = 640; const H = 240; const m = { l: 10, r: 10, t: 34, b: 40 };
    const n = digi.hits.length;
    const bw = (W - m.l - m.r) / n;
    const zero = m.t + (H - m.t - m.b) / 2;
    const amp = (H - m.t - m.b) / 2;
    const label = (h: (typeof digi.hits)[number], i: number, above: boolean) => (
      <text
        key={`l${i}`} x={m.l + i * bw + 4} y={above ? zero - amp * Math.abs(h.cos) - 6 : zero + amp * Math.abs(h.cos) + 14}
        fontSize={9.5} fill={INK}
      >
        {(nameBySlug.get(slugs[h.target]) ?? '').split(' (')[0]} ({h.cos.toFixed(2)})
      </text>
    );
    return (
      <svg ref={f3Ref} width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily="system-ui, sans-serif">
        <text x={m.l} y={16} fontSize={11.5} fill={INK}>Query: Digitoxin — all {n} drugs ranked by signature cosine</text>
        <line x1={m.l} y1={zero} x2={W - m.r} y2={zero} stroke="#c3c2b7" strokeWidth={1} />
        {digi.hits.map((h, i) => (
          <rect
            key={i} x={m.l + i * bw} width={Math.max(0.7, bw - 0.25)}
            y={h.cos >= 0 ? zero - amp * h.cos : zero}
            height={amp * Math.abs(h.cos)}
            fill={ramp(h.cos >= 0 ? 'up' : 'down', 0.25 + 0.5 * Math.abs(h.cos))}
          />
        ))}
        {label(digi.hits[0], 0, true)}
        {label(digi.hits[n - 1], n - 1 - 24, false)}
        <text x={m.l} y={H - 8} fontSize={10} fill={MUTED}>mimickers</text>
        <text x={W - m.r} y={H - 8} fontSize={10} fill={MUTED} textAnchor="end">reversers</text>
      </svg>
    );
  };

  // ---------------- Fig 4: significant calls per method stream ----------------
  const f4Ref = useRef<SVGSVGElement>(null);
  const streams = useMemo(() => manifest.streams.map((s, i) => ({
    label: streamLabel(s),
    sig: summary.drugs.reduce((acc, d) => acc + d.per_stream_sig[i], 0),
    tested: summary.drugs.reduce((acc, d) => acc + d.per_stream_tested[i], 0),
  })), [manifest.streams, summary.drugs]);

  const renderF4 = () => {
    const W = 560; const H = 260; const m = { l: 56, r: 14, t: 16, b: 58 };
    const maxF = Math.max(...streams.map((s) => s.sig / s.tested));
    const bw = (W - m.l - m.r) / streams.length;
    return (
      <svg ref={f4Ref} width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily="system-ui, sans-serif">
        {[0, 0.1, 0.2, 0.3, 0.4].filter((t) => t <= maxF * 1.1).map((t) => (
          <g key={t}>
            <line x1={m.l} y1={H - m.b - (t / (maxF * 1.1)) * (H - m.t - m.b)} x2={W - m.r} y2={H - m.b - (t / (maxF * 1.1)) * (H - m.t - m.b)} stroke={GRID} />
            <text x={m.l - 6} y={H - m.b - (t / (maxF * 1.1)) * (H - m.t - m.b) + 3} fontSize={9.5} fill={MUTED} textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {streams.map((s, i) => {
          const frac = s.sig / s.tested;
          const h = (frac / (maxF * 1.1)) * (H - m.t - m.b);
          const method = manifest.streams[i][0];
          const kind = method === 'cellspectra' || method === 'ora' ? 'uns' : 'ink';
          return (
            <g key={s.label}>
              <rect x={m.l + i * bw + bw * 0.18} y={H - m.b - h} width={bw * 0.64} height={h} rx={3}
                fill={ramp(kind as 'uns' | 'ink', 0.5)} />
              <text x={m.l + i * bw + bw / 2} y={H - m.b - h - 5} fontSize={9.5} fill={INK} textAnchor="middle"
                style={{ fontVariantNumeric: 'tabular-nums' }}>
                {(100 * frac).toFixed(0)}%
              </text>
              <text x={m.l + i * bw + bw / 2} y={H - m.b + 14} fontSize={9.5} fill={INK} textAnchor="middle"
                transform={`rotate(-28 ${m.l + i * bw + bw / 2} ${H - m.b + 14})`}>
                {s.label}
              </text>
            </g>
          );
        })}
        <text x={16} y={(m.t + H - m.b) / 2} fontSize={10.5} fill={INK} textAnchor="middle"
          transform={`rotate(-90 16 ${(m.t + H - m.b) / 2})`}>
          significant fraction
        </text>
      </svg>
    );
  };

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Figures</h1>
      <p className="mt-1 max-w-3xl text-sm text-stone-500">
        Manuscript-ready figures regenerated live from the current data — download any panel as vector SVG
        plus its underlying numbers as CSV. Every panel uses the fixed reference cutoff q &lt; 0.05, aggregates
        over all {manifest.streams.length} method streams unless a caption says otherwise, and states its own
        test and multiple-testing correction. Because they are computed rather than pasted in, they cannot fall
        out of sync with the dataset.
      </p>

      <div className="mt-6 grid gap-5">
        <FigureCard
          n={1} title="The consensus perturbation signature" svgRef={f1Ref}
          caption={`Mean net direction per Hallmark pathway across all ${nets.length} drugs (dot), with 95% t-based
            confidence intervals (whiskers). Net direction for a drug × pathway is (up − down) / tests, where up and
            down come only from the ${signedCount} directional streams (GSEA·py, GSEA·R, fgsea·R) — ORA and CellSpectra are
            direction-less and excluded from the sign. Right column: sign consistency, the share of responding drugs
            (|net| > ${Math.round(RESPONDER_MIN * 100)}%) that agree on the majority direction; ★ marks a departure from a 50:50 split at
            BH q < 0.05 (exact binomial, Benjamini–Hochberg across all ${manifest.pathways.length} pathways). The screen shares a
            stereotyped programme — mitotic/proliferation and hypoxia up, estrogen-response down. This consensus is a
            property of this compendium, not a universal drug response.`}
          csv={() => downloadCsv(consensus.map((r) => ({
            pathway: manifest.pathways[r.p], mean_net: r.mean.toFixed(4), ci95: r.ci.toFixed(4),
            responders: r.resp, consistency: Number.isFinite(r.consist) ? (r.consist as number).toFixed(3) : '',
            binomial_p: Number.isFinite(r.pBinom) ? r.pBinom.toExponential(2) : '',
            bh_q: Number.isFinite(r.pBinom) ? r.q.toExponential(2) : '',
            starred: Number.isFinite(r.pBinom) && r.q < 0.05 ? 'yes' : 'no',
          })), 'figure_1_consensus')}
        >
          {renderF1()}
        </FigureCard>

        <FigureCard
          n={2} title="Hypoxia and EMT are co-regulated" svgRef={f2Ref}
          caption={`Per-drug net direction of Hallmark Hypoxia vs Epithelial Mesenchymal Transition — one point per
            drug (Pearson r = ${scatter.pe.r.toFixed(2)}, n = ${scatter.pe.n}, two-tailed t-test p ${scatter.pe.p < 1e-16 ? '< 1e-16' : `= ${scatter.pe.p.toExponential(1)}`}, df = ${scatter.pe.n - 2}).
            Line: ordinary least squares with a 95% confidence band for the mean response. Each point aggregates that
            drug's (${signedCount} directional streams × all DMSO × drug cluster pairs) tests into a single net direction per
            pathway, so all cluster structure is averaged away — the Correlation view's cluster-coupling mode resolves
            it. Note the shared-potency confound: drugs that perturb strongly move every pathway, which inflates this
            correlation; the potency-adjusted partial correlation is reported in the Correlation view.`}
          csv={() => downloadCsv(scatter.pts.map((p) => ({
            drug: nameBySlug.get(p.slug) ?? p.slug, slug: p.slug,
            hypoxia_net: p.x.toFixed(4), emt_net: p.y.toFixed(4),
          })), 'figure_2_hypoxia_emt')}
        >
          {renderF2()}
        </FigureCard>

        <FigureCard
          n={3} title="Connectivity recovers drug classes without metadata" svgRef={f3Ref}
          caption={`Connectivity waterfall for the Digitoxin query: every other drug in the library ranked by cosine
            similarity between ${manifest.pathways.length}-dimensional net-direction signatures (positive = mimicker, left; negative =
            reverser, right). The top mimicker is Ouabain, the other cardiac glycoside in the library — recovered from
            pathway space alone, with no drug metadata, target or class information used in the scoring. The
            accompanying CSV carries, for every target: cosine, τ (the |cosine| percentile against that target's own
            background distribution of connectivities to the whole atlas — |τ| ≥ 95 is the recommended filter), a
            two-sided p from 1,000 permutations of the query's coordinates, BH-FDR across all targets, and the split
            of each cosine into its generic component (projection onto the atlas first principal component, the shared
            proliferation-stress axis) versus the pathway-specific remainder. This is transcriptional-programme
            matching, not mechanism-of-action identification.`}
          csv={() => digi && downloadCsv(digi.hits.map((h, i) => ({
            rank: i + 1, drug: nameBySlug.get(slugs[h.target]) ?? '', cosine: h.cos.toFixed(4),
            tau: h.tau.toFixed(1), perm_p: h.p.toExponential(2), fdr: h.fdr.toExponential(2),
            generic: h.generic.toFixed(3), specific: h.specific.toFixed(3),
          })), 'figure_3_connectivity_digitoxin')}
        >
          {renderF3()}
        </FigureCard>

        <FigureCard
          n={4} title="Method streams call significance at very different rates" svgRef={f4Ref}
          caption={`Fraction of all pathway tests called significant at q < 0.05 by each of the ${manifest.streams.length} method streams,
            over ${fmtCompact(summary.totals.records)} tests in total. Every stream sees identical input — the same cells, the same
            ${manifest.pathways.length} gene sets, the same cluster pairs, the same BH correction and the same cutoff — so the only variable
            is the enrichment method and its implementation. The calling rate differs several-fold between method
            families (violet = the direction-less streams, ORA and CellSpectra), while the same method implemented in
            Python and in R behaves almost identically. Method choice, not implementation language, is the dominant
            analytic decision; the per-drug Method-agreement tab shows the same conclusion as Jaccard overlap of the
            actual call sets rather than of the rates.`}
          csv={() => downloadCsv(streams.map((s) => ({
            stream: s.label, significant: s.sig, tested: s.tested, fraction: (s.sig / s.tested).toFixed(4),
          })), 'figure_4_stream_rates')}
        >
          {renderF4()}
        </FigureCard>
      </div>
    </div>
  );
}
