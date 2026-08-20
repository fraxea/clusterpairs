// Consensus.tsx: the generic response and what remains. Most perturbations in
// a tumor-line screen share a stereotyped program (cf. the "differential
// expression prototype", Crow et al. PNAS 2019; frequent-hitter/generic-
// response literature). This tab quantifies it: (A) the consensus signature
// across all drugs, (B) how generic each drug is (leave-one-out correlation),
// and (C) the residual layer: drug × pathway effects the consensus does NOT
// explain, i.e. the specific pharmacology.
import { useMemo, useState } from 'react';
import type { Manifest, Summary } from '../types';
import { consensusRows, netVectors, pearson, RESPONDER_MIN } from '../analysis';
import { drugActivity } from '../significance';
import { fmtPct, pathwaySlug } from '../format';
import { ramp } from '../colors';
import { StatTile } from '../ui';
import { tipBind, useTip } from '../tooltip';

const SD_FLOOR = 0.01;      // z-score guard for near-silent pathways

export function Consensus({ manifest, summary }: { manifest: Manifest; summary: Summary }) {
  const tip = useTip();
  const [showAll, setShowAll] = useState(false);
  const nameBySlug = useMemo(() => new Map(manifest.drugs.map((d) => [d.slug, d.name])), [manifest.drugs]);

  const model = useMemo(() => {
    const nets = netVectors(summary.drugs);
    const n = nets.length;
    const nP = manifest.pathways.length;

    const rows = consensusRows(nets, nP);

    // Energy captured by the consensus DIRECTION: project each drug onto the
    // unit consensus vector û = mean/‖mean‖ and compare squared projections to
    // total squared signal ("how much of the matrix lies along the shared axis").
    const sums = new Float64Array(nP);
    for (const v of nets) for (let p = 0; p < nP; p += 1) sums[p] += v[p];
    let meanNorm = 0;
    for (let p = 0; p < nP; p += 1) meanNorm += (sums[p] / n) ** 2;
    meanNorm = Math.sqrt(meanNorm) || 1;
    let total = 0; let along = 0;
    for (const v of nets) {
      let dot = 0;
      for (let p = 0; p < nP; p += 1) {
        total += v[p] ** 2;
        dot += v[p] * (sums[p] / n / meanNorm);
      }
      along += dot * dot;
    }
    const energy = along / (total || 1);

    const loo = summary.drugs.map((d, i) => {
      const looMean = Array.from({ length: nP }, (_, p) => (sums[p] - nets[i][p]) / (n - 1));
      return { slug: d.slug, r: pearson([...nets[i]], looMean), act: drugActivity(d) };
    });
    const looSorted = [...loo].sort((a, b) => b.r - a.r);
    const rMedian = looSorted[Math.floor(looSorted.length / 2)].r;

    // residual layer: standardized surprises, capped at 3 per drug
    const surprises: Array<{ slug: string; p: number; net: number; z: number }> = [];
    for (let i = 0; i < n; i += 1) {
      for (let p = 0; p < nP; p += 1) {
        const z = (nets[i][p] - rows[p].mean) / Math.max(SD_FLOOR, rows[p].sd);
        surprises.push({ slug: summary.drugs[i].slug, p, net: nets[i][p], z });
      }
    }
    surprises.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    const perDrug = new Map<string, number>();
    const topSurprises = surprises.filter((s) => {
      const c = perDrug.get(s.slug) ?? 0;
      if (c >= 3) return false;
      perDrug.set(s.slug, c + 1);
      return true;
    }).slice(0, 18);

    return {
      rows: [...rows].sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean)),
      energy, loo: looSorted, rMedian, topSurprises, n,
    };
  }, [summary.drugs, manifest.pathways.length]);

  const shown = showAll ? model.rows : model.rows.slice(0, 18);
  const maxAbs = Math.max(0.02, ...model.rows.map((r) => Math.abs(r.mean) + r.ci));

  // ---- forest plot geometry ----
  const FW = 300; const ROW_H = 24;
  const fx = (v: number): number => (FW / 2) + (v / maxAbs) * (FW / 2 - 8);

  // ---- genericness histogram ----
  const HB = 26; const HW = 380; const HH = 120;
  const hist = useMemo(() => {
    const lo = Math.min(...model.loo.map((l) => l.r));
    const hi = Math.max(...model.loo.map((l) => l.r));
    const bins = new Array<number>(HB).fill(0);
    for (const l of model.loo) {
      const k = Math.min(HB - 1, Math.max(0, Math.floor(((l.r - lo) / (hi - lo || 1)) * HB)));
      bins[k] += 1;
    }
    return { bins, lo, hi, max: Math.max(...bins) };
  }, [model.loo]);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Consensus</h1>
      <p className="mt-1 max-w-3xl text-sm text-stone-500">
        Most drugs in a tumor-line screen share a stereotyped program, the generic perturbation response.
        Panel A is that consensus; Panel B scores how generic each drug is; Panel C lists the drug × pathway
        effects the consensus does <span className="font-medium text-stone-700">not</span> explain: the
        specific pharmacology.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Consensus energy" value={fmtPct(model.energy)} sub="share of matrix variance carried by the shared program" />
        <StatTile label="Median genericness" value={model.rMedian.toFixed(2)} sub="leave-one-out correlation to the consensus" />
        <StatTile
          label="Most generic" value={(nameBySlug.get(model.loo[0].slug) ?? '').slice(0, 14)}
          sub={`r = ${model.loo[0].r.toFixed(2)} at ${fmtPct(model.loo[0].act)} activity`}
        />
        <StatTile
          label="Most distinctive" value={(nameBySlug.get(model.loo[model.loo.length - 1].slug) ?? '').slice(0, 14)}
          sub={`r = ${model.loo[model.loo.length - 1].r.toFixed(2)}`}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-4">
        {/* Panel A: consensus signature forest */}
        <div className="min-w-[30rem] flex-1 rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-stone-800">A · Consensus signature</h3>
          <p className="mb-2 mt-0.5 text-xs text-stone-500">
            Mean net direction across all {model.n} drugs, 95% CI; consistency = share of responding drugs
            (|net| &gt; {RESPONDER_MIN}) with the majority sign, ★ = BH q &lt; 0.05 (exact binomial vs 50:50).
          </p>
          <div className="grid grid-cols-[13rem_1fr_5.5rem] items-center gap-x-3 text-[11px] text-stone-600">
            <span>pathway</span>
            <div className="relative h-4 font-mono tabular-nums">
              <span className="absolute left-0">−{(maxAbs * 100).toFixed(0)}%</span>
              <span className="absolute left-1/2 -translate-x-1/2">0</span>
              <span className="absolute right-0">+{(maxAbs * 100).toFixed(0)}%</span>
            </div>
            <span className="text-right">consistency</span>
          </div>
          {shown.map((r) => (
            <a
              key={r.p} href={`#/pathway/${pathwaySlug(manifest.pathways[r.p])}`}
              className="grid grid-cols-[13rem_1fr_5.5rem] items-center gap-x-3 rounded px-1 py-0.5 hover:bg-stone-50"
              {...tipBind(tip, () => ((
                <div>
                  <div className="font-medium text-stone-900">{manifest.pathways[r.p]}</div>
                  <div className="mt-0.5 font-mono text-[11px] tabular-nums">
                    mean net {(100 * r.mean).toFixed(1)}% ± {(100 * r.ci).toFixed(1)} · sd {(100 * r.sd).toFixed(1)}%<br />
                    {r.resp} responders · {Number.isFinite(r.consist) ? `${Math.round(100 * r.consist)}% ${r.majorityUp ? 'up' : 'down'}` : 'n/a'}
                  </div>
                </div>
              )))}
            >
              <span className="truncate text-sm text-stone-700">{manifest.pathways[r.p]}</span>
              <svg width={FW} height={ROW_H} viewBox={`0 0 ${FW} ${ROW_H}`} className="max-w-full">
                <line x1={FW / 2} y1={0} x2={FW / 2} y2={ROW_H} stroke="#e1e0d9" strokeWidth={1} />
                <line
                  x1={fx(r.mean - r.ci)} y1={ROW_H / 2} x2={fx(r.mean + r.ci)} y2={ROW_H / 2}
                  stroke="#a9a69c" strokeWidth={1.5}
                />
                <circle
                  cx={fx(r.mean)} cy={ROW_H / 2} r={4.5}
                  fill={Math.abs(r.mean) < 0.005 ? '#a9a69c' : ramp(r.mean > 0 ? 'up' : 'down', 0.55)}
                  stroke="#fff" strokeWidth={1.5}
                />
              </svg>
              <span className="text-right font-mono text-xs tabular-nums text-stone-600">
                {Number.isFinite(r.consist) ? `${Math.round(100 * r.consist)}%` : 'n/a'}
                <span className="text-amber-500">{r.q < 0.05 ? ' ★' : ''}</span>
              </span>
            </a>
          ))}
          {!showAll && model.rows.length > 18 && (
            <button
              type="button" onClick={() => setShowAll(true)}
              className="mt-2 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-600 hover:border-stone-500"
            >
              Show all {model.rows.length} pathways
            </button>
          )}
        </div>

        {/* Panel B: genericness */}
        <div className="w-[26rem] shrink-0 rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-stone-800">B · How generic is each drug?</h3>
          <p className="mb-2 mt-0.5 text-xs text-stone-500">
            Correlation of each drug&rsquo;s signature with the consensus of the other {model.n - 1}.
          </p>
          <svg width={HW} height={HH} viewBox={`0 0 ${HW} ${HH}`} className="max-w-full">
            {hist.bins.map((b, k) => {
              const bw = HW / HB;
              const h = (b / hist.max) * (HH - 24);
              return (
                <rect
                  key={k} x={k * bw + 1} y={HH - 18 - h} width={bw - 2} height={h}
                  fill={ramp('ink', 0.25 + 0.4 * (b / hist.max))}
                />
              );
            })}
            <text x={2} y={HH - 4} fontSize={10} fill="#898781" style={{ fontVariantNumeric: 'tabular-nums' }}>
              r = {hist.lo.toFixed(2)}
            </text>
            <text x={HW - 2} y={HH - 4} fontSize={10} fill="#898781" textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {hist.hi.toFixed(2)}
            </text>
          </svg>
          {([['Most generic', model.loo.slice(0, 6)], ['Most distinctive', [...model.loo].reverse().slice(0, 6)]] as const).map(([label, list]) => (
            <div key={label} className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-600">{label}</div>
              <div className="mt-1 space-y-0.5">
                {list.map((l) => (
                  <a
                    key={l.slug} href={`#/drug/${encodeURIComponent(l.slug)}`}
                    className="flex items-center justify-between rounded px-1.5 py-0.5 text-sm text-stone-700 hover:bg-stone-50"
                  >
                    <span className="truncate">{nameBySlug.get(l.slug)}</span>
                    <span className="font-mono text-xs tabular-nums text-stone-500">r {l.r.toFixed(2)}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Panel C: residual surprises */}
      <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-stone-800">C · Beyond the consensus: the specific effects</h3>
        <p className="mb-2 mt-0.5 text-xs text-stone-500">
          Largest standardized departures from the consensus (z = (net − mean) / sd, ≤3 per drug).
          These are the drug-specific calls the shared program cannot explain.
        </p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {model.topSurprises.map((s, i) => (
            <a
              key={`${s.slug}:${s.p}`} href={`#/drug/${encodeURIComponent(s.slug)}`}
              className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-stone-50"
            >
              <span className="w-5 shrink-0 text-right font-mono text-[10px] text-stone-600">{i + 1}</span>
              <span
                className="w-12 shrink-0 rounded-[3px] px-1 text-center font-mono text-[11px] tabular-nums"
                style={{ background: ramp(s.z > 0 ? 'up' : 'down', 0.55), color: '#fff' }}
              >
                {s.z > 0 ? '+' : ''}{s.z.toFixed(1)}σ
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-stone-800">{nameBySlug.get(s.slug)}</span>
                <span className="block truncate text-[11px] text-stone-500">
                  {manifest.pathways[s.p]} · net {(100 * s.net).toFixed(0)}%
                </span>
              </span>
            </a>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-stone-600">
          The consensus is a property of this compendium (these cell lines, DMSO-cluster referencing,
          q &lt; 0.05). It describes what perturbation does here, not a universal drug response.
        </p>
      </div>
    </div>
  );
}
