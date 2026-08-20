// Mechanism.tsx: does a Hallmark-pathway signature encode a drug's mechanism?
//
// The standard benchmark (MOASL, Jiang 2023; GPAR, Gao 2022) ranks same-MoA
// drug pairs against different-MoA pairs by signature similarity and reports
// AUROC. Sirci (2017) named the two failure modes this view makes visible:
// same-MoA drugs whose transcriptional response is too weak to match, and
// unrelated drugs pulled together by a shared toxicity programme.
//
// The honest headline here is a NEGATIVE: at 50-pathway resolution the global
// AUROC sits at chance. What is real is the per-class variation: some
// mechanisms converge tightly, others are anti-coherent. So the page leads
// with the global number and then lets you interrogate individual classes.
import { useEffect, useMemo, useState } from 'react';
import type { Annotations, Manifest, Summary } from '../types';
import { loadAnnotations } from '../data';
import { classMembers, moaBenchmark, netVectors } from '../analysis';
import { ramp } from '../colors';
import { downloadCsv } from '../export';
import { Spinner, StatTile } from '../ui';
import { setHashParams } from '../format';
import { tipBind, useTip } from '../tooltip';

const COHERENT = '#047857';   // emerald: not the red/blue that encode
const ANTI = '#b45309';       // amber    up/down regulation elsewhere

export function Mechanism({ manifest, summary, params }: {
  manifest: Manifest; summary: Summary; params: URLSearchParams;
}) {
  const tip = useTip();
  const [ann, setAnn] = useState<Annotations | null>(null);
  const [sel, setSel] = useState<string | null>(params.get('moa'));
  useEffect(() => { loadAnnotations().then(setAnn); }, []);

  const nameBySlug = useMemo(
    () => new Map(manifest.drugs.map((d) => [d.slug, d.name])), [manifest.drugs],
  );
  const vecs = useMemo(() => netVectors(summary.drugs), [summary.drugs]);

  const bm = useMemo(() => {
    if (!ann) return null;
    const label = summary.drugs.map((d) => {
      const mm = ann[d.slug]?.moa ?? [];
      return mm.length ? mm[0] : null;
    });
    return moaBenchmark(vecs, label);
  }, [ann, summary.drugs, vecs]);

  const chosen = useMemo(
    () => bm?.classes.find((c) => c.mechanism === sel) ?? bm?.classes[0] ?? null,
    [bm, sel],
  );
  const members = useMemo(
    () => (chosen ? classMembers(vecs, chosen.members) : []),
    [chosen, vecs],
  );

  if (!ann || !bm) return <Spinner label="Loading mechanism annotations…" />;

  const annotated = Object.values(ann).filter((a) => (a.moa ?? []).length > 0).length;
  const maxGap = Math.max(...bm.classes.map((c) => Math.abs(c.gap)), 0.1);
  const beatsChance = bm.p < 0.05;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Mechanism</h1>
      <p className="mt-1 max-w-3xl text-sm text-stone-500">
        Does a {manifest.pathways.length}-pathway signature encode what a drug does? Using ChEMBL
        primary mechanisms as labels, same-mechanism drug pairs are ranked against different-mechanism pairs
        by signature similarity, the standard benchmark from the MoA-prediction literature.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Benchmark AUROC" value={bm.auroc.toFixed(3)}
          sub={`vs ${bm.nullMed.toFixed(3)} under label permutation · p = ${bm.p.toFixed(3)}`}
        />
        <StatTile
          label="Labelled set" value={`${bm.nDrugs}`}
          sub={`drugs in ${bm.nClasses} mechanisms with ≥3 members (${annotated} of ${manifest.drugs.length} have any ChEMBL mechanism)`}
        />
        <StatTile
          label="Most coherent" value={bm.classes[0]?.mechanism.split(' ').slice(0, 2).join(' ') ?? 'n/a'}
          sub={bm.classes[0] ? `gap +${bm.classes[0].gap.toFixed(2)} · n = ${bm.classes[0].members.length}` : ''}
        />
        <StatTile
          label="Least coherent"
          value={bm.classes[bm.classes.length - 1]?.mechanism.split(' ').slice(0, 2).join(' ') ?? 'n/a'}
          sub={bm.classes.length ? `gap ${bm.classes[bm.classes.length - 1].gap.toFixed(2)}` : ''}
        />
      </div>

      {/* the headline finding, stated plainly */}
      <div className={`mt-4 rounded-lg border p-4 text-sm leading-relaxed ${
        beatsChance ? 'border-emerald-200 bg-emerald-50/60 text-stone-700' : 'border-amber-200 bg-amber-50/60 text-stone-700'}`}>
        {beatsChance ? (
          <>
            Across {bm.samePairs.toLocaleString()} same-mechanism and {bm.diffPairs.toLocaleString()} different-mechanism
            pairs, same-mechanism drugs are ranked more similar than chance (AUROC {bm.auroc.toFixed(3)},
            permutation p = {bm.p.toFixed(3)}).
          </>
        ) : (
          <>
            <span className="font-medium text-stone-900">Globally, mechanism is not recovered.</span> Across
            {' '}{bm.samePairs.toLocaleString()} same-mechanism and {bm.diffPairs.toLocaleString()} different-mechanism pairs the
            AUROC is {bm.auroc.toFixed(3)}, indistinguishable from the {bm.nullMed.toFixed(3)} expected when the
            mechanism labels are shuffled (p = {bm.p.toFixed(3)}). Two drugs sharing a target are, on average, no
            more alike in Hallmark-pathway space than two drugs picked at random. This matches the published
            difficulty of matching low-transcriptional-activity compounds, and is compounded here by the coarse
            resolution: {manifest.pathways.length} pathways cannot separate mechanisms that converge on the same
            broad programmes. <span className="font-medium text-stone-900">The per-class picture below is
            where the signal lives</span>. Coherence varies from strongly positive to negative.
          </>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-4 lg:flex-nowrap">
        {/* class coherence */}
        <div className="w-full rounded-lg border border-stone-200 bg-white p-4 lg:w-[30rem] lg:shrink-0">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-stone-800">Coherence by mechanism</h3>
            <button
              type="button"
              onClick={() => downloadCsv(bm.classes.map((c) => ({
                mechanism: c.mechanism, n_drugs: c.members.length,
                within_median_cosine: c.withinMed.toFixed(4),
                between_median_cosine: c.betweenMed.toFixed(4),
                coherence_gap: c.gap.toFixed(4),
                median_signature_norm: c.strengthMed.toFixed(4),
                members: c.members.map((i) => nameBySlug.get(summary.drugs[i].slug) ?? '').join('; '),
              })), 'mechanism_coherence')}
              className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] text-stone-500 hover:border-stone-500"
            >
              CSV ↓
            </button>
          </div>
          <p className="mb-2 mt-0.5 text-xs text-stone-500">
            Median cosine <em>within</em> the class minus median cosine to every drug outside it. Bars right of
            zero mean the mechanism converges; left means its members are less alike than random pairs.
          </p>
          <div className="space-y-0.5">
            {bm.classes.map((c) => {
              const active = chosen?.mechanism === c.mechanism;
              const w = (Math.abs(c.gap) / maxGap) * 50;
              const weak = c.strengthMed < 0.2;
              return (
                <button
                  key={c.mechanism} type="button"
                  onClick={() => { setSel(c.mechanism); setHashParams({ moa: c.mechanism }); }}
                  className={`grid w-full grid-cols-[1fr_5.5rem_2.5rem] items-center gap-2 rounded-md px-2 py-1 text-left ${
                    active ? 'bg-stone-100 ring-1 ring-stone-300' : 'hover:bg-stone-50'}`}
                  {...tipBind(tip, () => (
                    <div>
                      <div className="font-medium text-stone-900">{c.mechanism}</div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums">
                        within {c.withinMed.toFixed(2)} · outside {c.betweenMed.toFixed(2)} · gap {c.gap >= 0 ? '+' : ''}{c.gap.toFixed(2)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-stone-500">
                        {c.members.length} drugs · median ‖net‖ {c.strengthMed.toFixed(2)}
                        {weak && ' · weak signatures, treat with caution'}
                      </div>
                    </div>
                  ), `${c.mechanism}, coherence gap ${c.gap.toFixed(2)}, ${c.members.length} drugs`)}
                >
                  <span className="truncate text-[13px] text-stone-800">
                    {c.mechanism}
                    {weak && <span className="ml-1 text-[10px] text-amber-700">weak</span>}
                  </span>
                  <span className="relative block h-3">
                    <span className="absolute inset-y-0 left-1/2 w-px bg-stone-300" />
                    <span
                      className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[2px]"
                      style={c.gap >= 0
                        ? { left: '50%', width: `${w}%`, background: COHERENT }
                        : { right: '50%', width: `${w}%`, background: ANTI }}
                    />
                  </span>
                  <span className="text-right font-mono text-[11px] tabular-nums text-stone-500">
                    {c.members.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* class detail */}
        {chosen && (
          <div className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-stone-800">{chosen.mechanism}</h3>
            <p className="mb-3 mt-0.5 text-xs text-stone-500">
              Each member scored against the centroid of the <em>other</em> members (leave-one-out, so one
              outlier cannot drag the centroid onto itself). High = behaves like its class. Low on a
              <B> strong</B> signature is the interesting case: a candidate off-target or polypharmacology
              effect. Low on a <B>weak</B> signature more likely means the response was too small to measure.
            </p>
            <div className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-x-3 border-b border-stone-200 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
              <span>Drug</span><span className="text-right">to class</span><span className="text-right">‖net‖</span>
            </div>
            {members.map((mem) => {
              const slug = summary.drugs[mem.drug].slug;
              const weak = mem.strength < 0.2;
              const odd = mem.toCentroid < 0.1;
              return (
                <a
                  key={slug} href={`#/drug/${encodeURIComponent(slug)}`}
                  className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-x-3 border-b border-stone-100 py-1.5 hover:bg-stone-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-stone-800">{nameBySlug.get(slug) ?? slug}</span>
                    <span className="block truncate text-[11px] text-stone-500">
                      {odd && !weak && <span className="mr-1 font-medium text-amber-700">off-class</span>}
                      {weak && <span className="mr-1 text-stone-400">weak signature</span>}
                      {ann[slug]?.chembl_id ?? ''}
                    </span>
                  </span>
                  <span
                    className="rounded-[3px] px-1 text-right font-mono text-xs tabular-nums"
                    style={{
                      color: mem.toCentroid >= 0.1 ? COHERENT : ANTI,
                    }}
                  >
                    {mem.toCentroid >= 0 ? '+' : ''}{mem.toCentroid.toFixed(2)}
                  </span>
                  <span className="text-right font-mono text-xs tabular-nums text-stone-500">
                    <span
                      className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                      style={{ background: ramp('ink', 0.2 + 0.6 * Math.min(1, mem.strength / 0.4)) }}
                    />
                    {mem.strength.toFixed(2)}
                  </span>
                </a>
              );
            })}
            <p className="mt-3 text-[11px] text-stone-500">
              ‖net‖ is the length of the drug&rsquo;s {manifest.pathways.length}-dimensional net-direction
              vector: how much measurable transcriptional response it produced at all. Compare any member
              against the whole library in the{' '}
              <a className="text-emerald-700 hover:text-emerald-800" href={`#/connect?q=${encodeURIComponent(summary.drugs[members[0]?.drug ?? 0].slug)}`}>
                Connectivity view →
              </a>
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-xs leading-relaxed text-stone-700">
        <span className="font-medium text-stone-900">How to read this honestly.</span> Classes here have 3–10
        members, so a coherence gap is an estimate from very few pairs and no per-class p-value is claimed.
        The ranking is descriptive. ChEMBL&rsquo;s primary mechanism is one label for a drug that may hit many
        targets, and a class that looks incoherent may be heterogeneous in reality. A high gap on weak
        signatures can be produced by noise alone, which is why median ‖net‖ is shown beside every class.
        Finally, this measures whether mechanism is visible <em>at Hallmark-pathway resolution</em>. A negative
        result is a statement about this representation, not about the drugs.
      </div>
    </div>
  );
}

const B = ({ children }: { children: React.ReactNode }) => (
  <span className="font-medium text-stone-800">{children}</span>
);
