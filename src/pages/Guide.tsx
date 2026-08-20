// Guide.tsx — the reference manual: what the dataset is, how every number in
// the app is built, what each view shows, which statistical test sits behind
// each claim, and what must not be concluded. Static content, but the counts
// are read from the live manifest/summary so they can never drift.
import type { ReactNode } from 'react';
import type { Manifest, Summary } from '../types';
import { fmtCompact } from '../format';
import { rampGradient, NONSIG, NET_SAT, ACTIVITY_SAT } from '../colors';
import { RESPONDER_MIN } from '../analysis';
import { SIG_MAX } from '../significance';

function Section({ id, title, href, children }: {
  id: string; title: string; href: string; children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        <a href={href} className="shrink-0 text-xs font-medium text-emerald-700 hover:text-emerald-800">open →</a>
      </div>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-stone-600">{children}</div>
    </section>
  );
}

const B = ({ children }: { children: ReactNode }) => <span className="font-medium text-stone-800">{children}</span>;
const N = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[0.92em] tabular-nums text-stone-800">{children}</span>
);

function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-x-4 border-t border-stone-100 py-1.5 first:border-t-0">
      <dt className="text-stone-500">{k}</dt>
      <dd className="text-stone-700">{v}</dd>
    </div>
  );
}

export function Guide({ manifest, summary }: { manifest: Manifest; summary: Summary | null }) {
  const nRefs = manifest.drugs.map((d) => d.n_ref);
  const nQs = manifest.drugs.map((d) => d.n_query);
  const rng = (xs: number[]) => `${Math.min(...xs)}–${Math.max(...xs)}`;
  const pairs = manifest.drugs.map((d) => d.n_ref * d.n_query);
  const signed = manifest.streams.filter((s) => s[0] === 'gsea' || s[0] === 'fgsea').length;
  const unsigned = manifest.streams.length - signed;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Guide</h1>
      <p className="mt-1 max-w-3xl text-sm text-stone-500">
        What each view shows, how every number is built, and what the statistics do and do not support.
      </p>

      {/* contents */}
      <nav className="mt-5 flex flex-wrap gap-x-3 gap-y-1.5 rounded-lg border border-stone-200 bg-white px-4 py-3 text-xs">
        {[
          ['dataset', 'The dataset'], ['numbers', 'How a number is built'], ['colour', 'Colour language'],
          ['drugs', 'Drugs'], ['landscape', 'Landscape'], ['pathways', 'Pathways'], ['drugpage', 'Drug pages'],
          ['correlation', 'Correlation'], ['connectivity', 'Connectivity'], ['consensus', 'Consensus'],
          ['hetero', 'Heterogeneity'], ['rank', 'Rank'], ['figures', 'Figures'],
          ['stats', 'Statistics reference'], ['exports', 'Exports'], ['caveats', 'Caveats'],
        ].map(([id, label]) => (
          <button
            key={id} type="button"
            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="text-emerald-700 hover:text-emerald-800 hover:underline"
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ------------------------------------------------------ dataset ---- */}
      <div id="dataset" className="mt-4 scroll-mt-24 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-base font-semibold text-stone-900">The dataset</h2>
        <div className="mt-2 space-y-3 text-sm leading-relaxed text-stone-600">
          <p>
            {manifest.drugs.length} drug perturbations, each compared against a DMSO control. Cells are
            clustered on <em>both</em> sides of the comparison, and every (DMSO cluster × drug cluster)
            pair is scored against all {manifest.pathways.length} {manifest.gene_set.replace(/_/g, ' ')} gene
            sets by all {manifest.streams.length} method streams.
          </p>
          <dl className="rounded-md border border-stone-200 bg-stone-50/60 px-4 py-2 font-sans text-[13px]">
            <Row k="Drugs" v={<><N>{manifest.drugs.length}</N> — one page each</>} />
            <Row k="DMSO clusters / drug" v={<><N>{rng(nRefs)}</N> (median <N>{[...nRefs].sort((a, b) => a - b)[Math.floor(nRefs.length / 2)]}</N>) — the control-side contexts</>} />
            <Row k="Drug clusters / drug" v={<><N>{rng(nQs)}</N> (median <N>{[...nQs].sort((a, b) => a - b)[Math.floor(nQs.length / 2)]}</N>) — the treated subpopulations</>} />
            <Row k="Cluster pairs / drug" v={<><N>{rng(pairs)}</N> — every DMSO × drug combination</>} />
            <Row k="Pathways" v={<><N>{manifest.pathways.length}</N> {manifest.gene_set.replace(/_/g, ' ')} gene sets</>} />
            <Row k="Method streams" v={<><N>{manifest.streams.length}</N> — {manifest.streams.map((s) => `${s[0]}·${s[1] === 'python' ? 'py' : s[1]}`).join(', ')}</>} />
            {summary && <Row k="Total tests" v={<><N>{fmtCompact(summary.totals.records)}</N> pathway tests over <N>{fmtCompact(summary.totals.cluster_pairs)}</N> cluster pairs</>} />}
            {summary && <Row k="Significant" v={<><N>{fmtCompact(summary.totals.sig)}</N> at the reference cutoff q &lt; {summary.cutoff} (<N>{Math.round(100 * summary.totals.sig / summary.totals.records)}%</N>)</>} />}
          </dl>
          <p>
            One <B>test</B> in this app always means a single (stream × DMSO cluster × drug cluster × pathway)
            result. When a view says &ldquo;X% of tests significant&rdquo;, that is the denominator.
          </p>
        </div>
      </div>

      {/* ------------------------------------------- how a number is built -- */}
      <div id="numbers" className="mt-4 scroll-mt-24 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-base font-semibold text-stone-900">How a number is built</h2>
        <div className="mt-2 space-y-3 text-sm leading-relaxed text-stone-600">
          <p>
            <B>Significance.</B> Each test yields a Benjamini–Hochberg adjusted p-value (a <B>q-value</B>),
            corrected within its own stream. Internally the app stores <N>nlp = −log₁₀ q</N>, clipped at
            <N> 300</N>; a cell reading &ldquo;q &lt; 1e-300&rdquo; has hit that clip.
          </p>
          <p>
            <B>Direction, and why only some streams have it.</B> Of the {manifest.streams.length} streams,
            only <B>{signed}</B> are directional — GSEA·py, GSEA·R and fgsea·R — because they run on a ranked
            list and can tell enrichment at the top from enrichment at the bottom. The other <B>{unsigned}</B>
            {' '}are direction-less by construction: ORA tests over-representation of a gene set (there is no
            up or down), and CellSpectra reports no sign. <em>ORA emits a literal <N>+1</N> in the raw
            output, which is an artifact, not evidence of up-regulation</em> — the app masks it to unsigned at
            load time, so ORA never contributes an &ldquo;up&rdquo; vote anywhere.
          </p>
          <p>
            <B>The three channels.</B> Every directional read-out in the app is split the same way:
          </p>
          <dl className="rounded-md border border-stone-200 bg-stone-50/60 px-4 py-2 font-sans text-[13px]">
            <Row k={<span style={{ color: '#bc3a30' }}>up</span>} v={<>significant calls with sign <N>+1</N> — from the {signed} directional streams only</>} />
            <Row k={<span style={{ color: '#2a78d6' }}>down</span>} v={<>significant calls with sign <N>−1</N> — from the {signed} directional streams only</>} />
            <Row k={<span style={{ color: '#716b91' }}>no direction</span>} v={<>significant calls from the {unsigned} direction-less streams (ORA ×2, CellSpectra ×2)</>} />
          </dl>
          <p>
            <B>Net direction</B>, used by the Landscape, Connectivity, Consensus and Heterogeneity views, is
            {' '}<N>(up − down) / tests</N> for a drug × pathway. It runs from <N>−1</N> (every directional
            test called it down) to <N>+1</N>. <B>Activity</B> is direction-free:
            {' '}<N>(up + down + unsigned) / tests</N>.
          </p>
          <p>
            <B>Two thresholds, deliberately different.</B> The <B>reference cutoff</B> is fixed at
            {' '}<N>q &lt; {summary?.cutoff ?? 0.05}</N> and is baked into the precomputed summary files — every
            cross-drug view uses it and says so. The <B>live cutoff slider</B> appears only on Drug pages and
            Rank, the two views that read the full per-drug data and can genuinely re-threshold; it spans
            {' '}<N>q &lt; 0.1</N> down to <N>q &lt; 1e−6</N> with one tick per decade.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------- colour ---- */}
      <div id="colour" className="mt-4 scroll-mt-24 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-base font-semibold text-stone-900">Colour language</h2>
        <div className="mt-2 space-y-3 text-sm leading-relaxed text-stone-600">
          <p>Four ramps, each with exactly one job. Hue is the category; darkness is the magnitude.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-stone-600">
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-14 rounded-sm" style={{ background: rampGradient('up') }} /> up-regulated</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-14 rounded-sm" style={{ background: rampGradient('down') }} /> down-regulated</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-14 rounded-sm" style={{ background: rampGradient('uns') }} /> unsigned</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-14 rounded-sm" style={{ background: rampGradient('ink') }} /> magnitude / mixed</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NONSIG }} /> not significant</span>
          </div>
          <p>
            The unsigned ramp is deliberately low-chroma. &ldquo;Unsigned&rdquo; means the directional methods
            did not call the cell, and it is the majority of the landscape — at full saturation the
            <em> absence</em> of directional evidence visually outweighed every real result.
          </p>
          <p>
            <B>Where each ramp saturates</B> (past these values, cells stop getting darker):
          </p>
          <dl className="rounded-md border border-stone-200 bg-stone-50/60 px-4 py-2 font-sans text-[13px]">
            <Row k="Significance cells" v={<>nlp <N>{SIG_MAX}</N>, i.e. <N>q ≈ 1e−{SIG_MAX}</N> — drug-page grids</>} />
            <Row k="Net-direction cells" v={<>|net| = <N>{Math.round(NET_SAT * 100)}%</N> — Connectivity strips, Heterogeneity grid</>} />
            <Row k="Activity cells" v={<>activity = <N>{Math.round(ACTIVITY_SAT * 100)}%</N> — Landscape, signature strips</>} />
            <Row k="Count cells" v={<>all <N>n_ref</N> DMSO clusters — drug-page pathway grids</>} />
          </dl>
          <p>
            Two greys are distinct and never interchangeable: <B>n.s.</B> means the test ran and was not
            significant; a <B>hatched</B> cell means no record exists for that combination at all (ORA does
            not return every pathway). Missing data never reads as zero.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        {/* -------------------------------------------------------- views -- */}
        <Section id="drugs" title="Drugs — the index" href="#/">
          <p>
            All {manifest.drugs.length} drugs as cards. Each card carries a <B>signature strip</B>: the
            {' '}{manifest.pathways.length} pathways in fixed canonical order, coloured by that drug&rsquo;s
            dominant direction with intensity = fraction of tests significant. Hover any segment for the
            pathway name and its up/down/unsigned counts. The percentage top-right is the drug&rsquo;s overall
            <B> activity</B> (share of all its tests significant at the reference cutoff).
          </p>
          <p>
            Sort by <B>Activity</B> (strongest perturbations first), <B>Selectivity</B>
            {' '}(<N>1 − normalised entropy</N> of the pathway distribution — drugs whose signal is
            concentrated in few pathways rank first), or <B>A–Z</B>. Press
            {' '}<kbd className="rounded border border-stone-300 bg-stone-50 px-1">/</kbd> to jump to the filter.
            Hovering a card pre-fetches its data so the click is instant; the cache holds 30 drugs.
          </p>
          <p>
            The <B>&ldquo;What the atlas shows&rdquo;</B> cards above the grid are curated entry points — each
            states a finding with its statistic and deep-links to the exact configured view that demonstrates it.
          </p>
        </Section>

        <Section id="landscape" title="Landscape — everything at once" href="#/atlas">
          <p>
            The whole experiment in one canvas heatmap: {manifest.drugs.length} rows ×
            {' '}{manifest.pathways.length} columns = {fmtCompact(manifest.drugs.length * manifest.pathways.length)} cells,
            drawn on canvas and virtualised so only the visible rows are ever painted. Cell size adapts so all
            {' '}{manifest.pathways.length} columns always fit — there is no horizontal scrolling.
          </p>
          <p>
            <B>Direction</B> mode colours each cell by its dominant direction (up / down / mixed / unsigned)
            with intensity = fraction of tests significant. <B>Activity</B> mode drops direction entirely and
            uses the neutral ink ramp for magnitude only — the legend swaps to match.
          </p>
          <p>
            Row order: <B>Most active</B>, <B>A–Z</B>, or <B>Clustered</B> (first principal component of the
            drug fingerprints, so similar response profiles sit together). Ticking <B>cluster pathways</B>
            {' '}reorders the columns by average-linkage clustering on <N>1 − Pearson r</N> of their
            cross-drug activity, which is what makes the block structure appear. Clicking a column label sorts
            every drug by that pathway; the dropdown beside the controls does the same from the keyboard.
            Clicking a row opens that drug.
          </p>
        </Section>

        <Section id="pathways" title="Pathways" href="#/pathways">
          <p>
            An index of the {manifest.pathways.length} gene sets, ranked by how many drugs respond
            <B> strongly</B> — defined as ≥ <N>35%</N> of that drug&rsquo;s tests for the pathway being
            significant. (A weaker bar saturates: at ≥5% nearly every pathway is hit by nearly every drug, so
            the statistic stops discriminating.)
          </p>
          <p>
            Each pathway page is a <B>tornado plot</B>: one row per drug, red bar rightwards = fraction of
            tests calling it up, blue bar leftwards = fraction calling it down, on a shared symmetric axis.
            A drug with <em>both</em> bars long is responding heterogeneously across its own clusters. Sort by
            total, up, down, or <B>discordant</B> (<N>min(up, down)</N> — the most internally-conflicted
            drugs). Each page links out to the MSigDB entry and into the Correlation view seeded with that pathway.
          </p>
        </Section>

        <Section id="drugpage" title="Drug pages — three tabs" href="#/">
          <p>
            The only views that follow the <B>live cutoff slider</B>, because they load the drug&rsquo;s full
            record rather than the precomputed summary. Tab, stream, and selected cluster pair are all carried
            in the URL, so any state is a shareable link.
          </p>
          <p>
            <B>Pathways</B> — a pathway × drug-cluster grid where each cell counts how many of the
            {' '}<N>{rng(nRefs)}</N> DMSO reference clusters call that pathway significant for that drug
            cluster, in the chosen direction. The <B>sparkline</B> beside each row shows how many calls
            survive as the threshold tightens from q &lt; 0.1 to 1e−10, with a green rule at your current
            cutoff — a row whose line falls off a cliff is threshold-fragile. Hovering a cell breaks it down
            per individual reference cluster. The alternative <B>one-vs-rest</B> views show each cluster&rsquo;s
            signature against the other clusters of the same condition rather than against DMSO.
          </p>
          <p>
            <B>Cluster pairs</B> — one small heatmap per stream, DMSO clusters as rows against drug clusters
            as columns, each cell counting significant pathways. This localises the response: a dark
            <em> column</em> is a drug subpopulation that responds, a dark <em>row</em> is a DMSO reference
            behaving unlike the others (worth suspecting). Clicking any cell carries that pair into the next tab.
          </p>
          <p>
            <B>Method agreement</B> — for one chosen cluster pair, every pathway across all
            {' '}{manifest.streams.length} streams side by side, plus a lower-triangle <B>Jaccard concordance
            matrix</B> over each stream&rsquo;s full set of significant (cluster-pair × pathway) calls. The
            diagonal carries each stream&rsquo;s own call count; same-method Python↔R pairs are outlined,
            which is what exposes that language differences are small while method differences are large.
          </p>
        </Section>

        <Section id="correlation" title="Correlation — three modes" href="#/correlate">
          <p>
            <B>1 · Pair scatter.</B> Two pathways head-to-head with one point per drug
            ({manifest.drugs.length} points). Choose the metric: net direction, up fraction, down fraction, or
            activity. You get an OLS fit with a 95% confidence band, <B>Pearson r</B> and <B>Spearman ρ</B>
            {' '}with exact t-based p-values, a <B>sign-concordance test</B> (exact binomial on how often both
            pathways move the same way), and a <B>potency-adjusted partial correlation</B> that regresses both
            variables on each drug&rsquo;s overall activity first. Always read that last one: strongly-perturbing
            drugs move everything, which manufactures correlation.
          </p>
          <p>
            <B>2 · Lasso selection.</B> One response pathway regressed on the other
            {' '}{manifest.pathways.length - 1} with L1 regularisation, solved by coordinate descent over a
            60-point λ path with warm starts. Redundant predictors are shrunk to <em>exactly</em> zero. λ is
            chosen by <B>5-fold cross-validation</B>, standardising inside each training fold so there is no
            leakage; the default is the <B>1-SE rule</B> (the sparsest model within one standard error of the
            CV minimum) with λ-min available too. Coefficients are standardised and therefore comparable.
            An excluded pathway is <em>not</em> evidence of no association — among correlated predictors the
            lasso keeps one representative and drops the rest.
          </p>
          <p>
            <B>3 · Cluster coupling</B> — the newest view, and the only correlation that looks inside a single
            drug. The other two modes collapse each drug to one point, which averages all cluster structure
            away. Here you pick <em>one drug</em> and two pathways, and for <em>each of that drug&rsquo;s
            clusters separately</em> the {rng(nRefs)} DMSO reference clusters become the observations: pathway
            A is correlated against pathway B across them. That is done three times per cluster, once per
            channel, giving the three lines — <span style={{ color: '#bc3a30' }}>up</span>,
            {' '}<span style={{ color: '#2a78d6' }}>down</span>, and
            {' '}<span style={{ color: '#716b91' }}>no direction</span>.
          </p>
          <p>
            The statistics are chosen for the small sample: <B>Spearman ρ</B> (robust to the nlp clip at 300
            and to heavy tails), a <B>2,000-permutation two-sided p</B> (so the p-floor is
            {' '}<N>1/2001 ≈ 5e−4</N>), and <B>Benjamini–Hochberg</B> across the whole cluster × channel grid
            of the selected pair. A filled marker means BH <N>q &lt; 0.05</N>; hollow means not significant.
            The line <em>breaks</em> where a channel has no variance — for instance a pathway never called
            down in that cluster — rather than drawing a misleading zero.
          </p>
          <p>
            <B>Read the sample size honestly.</B> n is the number of DMSO clusters, so
            {' '}<N>{rng(nRefs)}</N> depending on the drug. At n = 10 a Spearman ρ must exceed roughly
            {' '}<N>0.6</N> to reach p &lt; 0.05, and the estimate is noisy. The panel states n explicitly.
            Treat this as exploratory: strong, consistent patterns across many clusters are worth believing;
            a single significant cluster among ten is not.
          </p>
          <p>
            Clicking any point focuses that cluster in the companion panel, which ranks <B>the other pathways
            enriched in that same cluster</B> (share of its tests significant at the reference cutoff), with
            the two selected pathways outlined. That answers the second half of the question — not just whether
            the pair is coupled here, but what else is happening in the clusters where it is.
          </p>
        </Section>

        <Section id="connectivity" title="Connectivity" href="#/connect">
          <p>
            Connectivity mapping in the Lamb (2006) / CMap tradition. A <B>query signature</B> — either any
            drug&rsquo;s {manifest.pathways.length}-dimensional net-direction vector, or a set you build by
            hand marking pathways up and down — is scored by <B>cosine similarity</B> against every one of the
            other {manifest.drugs.length - 1} drugs. Positive = <B>mimicker</B> (same program), negative =
            {' '}<B>reverser</B> — the classic repurposing read-out.
          </p>
          <p>
            <B>τ</B> is the specificity score, following Subramanian (2017): each hit&rsquo;s |cosine| expressed
            as a percentile of <em>that target drug&rsquo;s own</em> background distribution of connectivities
            to the whole atlas. A raw cosine of 0.8 means little if a drug correlates with everything; τ
            corrects for it. Treat <N>|τ| ≥ 95</N> as the meaningful set. Supporting statistics in every
            tooltip: a <B>1,000-permutation p</B> from shuffling the query&rsquo;s coordinates, and
            {' '}<B>BH-FDR</B> across all targets.
          </p>
          <p>
            The <B>split bar</B> on each row decomposes the cosine into a <B>generic</B> component — its
            projection onto the atlas&rsquo;s first principal component, the shared proliferation-stress axis
            that carries roughly a quarter of all variance — and the <B>specific</B> remainder. Two drugs can
            score highly simply by both being strongly cytotoxic; a mostly-grey bar is exactly that, and not
            evidence of shared pharmacology. Where a ChEMBL mechanism is known it is printed beside the hit,
            which is what makes class recovery visible: query Digitoxin and Ouabain returns first, both
            Na⁺/K⁺-ATPase inhibitors, with no drug metadata used in the scoring.
          </p>
        </Section>

        <Section id="consensus" title="Consensus" href="#/consensus">
          <p>
            Most perturbations in a tumour-line screen share a stereotyped programme; this view measures it
            and then removes it. <B>Panel A</B> is the consensus signature — per pathway, the mean net
            direction across all {manifest.drugs.length} drugs with a 95% t-interval, plus <B>sign
            consistency</B>: among drugs that actually respond (|net| &gt; <N>{RESPONDER_MIN}</N>), the share
            sharing the majority direction, tested by an <B>exact binomial</B> against 50:50 and corrected
            with BH across all {manifest.pathways.length} pathways. ★ marks q &lt; 0.05.
          </p>
          <p>
            <B>Panel B</B> scores each drug&rsquo;s <B>genericness</B>: the correlation of its own signature
            with the consensus of the other {manifest.drugs.length - 1} drugs — computed leave-one-out, so a
            drug never contributes to the baseline it is measured against. <B>Panel C</B> is the residual
            layer: the drug × pathway effects with the largest standardised departure
            {' '}(<N>z = (net − mean) / sd</N>) from that consensus, capped at three per drug so one extreme
            compound cannot fill the list. Panel C is where the specific pharmacology lives.
          </p>
        </Section>

        <Section id="hetero" title="Heterogeneity" href="#/hetero">
          <p>
            Do all of a drug&rsquo;s clusters respond the same way? <B>Dispersion</B> is the mean RMS distance
            between its per-cluster net-direction profiles, using directional streams only. Broad cytotoxics
            rank low (they hit everything uniformly); context-selective targeted agents rank high — the
            substrate of residual disease and resistance.
          </p>
          <p>
            The detail grid shows one drug&rsquo;s clusters against its most variable pathways, with cells
            sized to fit however many clusters that drug has. A <B>common</B> tag flags pathways that split
            clusters in more than <N>a third</N> of all drugs — the proliferation programmes, where cluster
            differences reflect baseline biology rather than drug selectivity, so they should be discounted.
            The <B>⇅</B> column counts pathways where clusters strictly disagree in direction, excluding the
            common ones.
          </p>
        </Section>

        <Section id="rank" title="Rank" href="#/rank">
          <p>
            Pick any set of pathways and rank drugs by how many tests reach significance across them. The
            instant ranking runs off the precomputed summary at the reference cutoff and appears immediately,
            with each bar split into its up / down / unsigned components. If you move the live cutoff away
            from the reference, an <B>exact re-rank</B> is offered — it downloads every per-drug file, so it
            is behind an explicit click with a size warning, a progress readout and a cancel button. Exact
            results are labelled with the cutoff they were computed at and never silently relabelled.
          </p>
        </Section>

        <Section id="figures" title="Figures" href="#/figures">
          <p>
            Four manuscript-ready panels regenerated live from the current data, each with a full caption
            stating its own method and correction, and one-click <B>SVG</B> (vector, for a paper) and
            {' '}<B>CSV</B> (the plotted numbers) downloads. Because they are computed rather than pasted in,
            they cannot fall out of sync with the dataset.
          </p>
        </Section>
      </div>

      {/* ------------------------------------------------------- stats ----- */}
      <div id="stats" className="mt-4 scroll-mt-24 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-base font-semibold text-stone-900">Statistics reference</h2>
        <p className="mt-2 text-sm text-stone-600">
          Every inferential claim in the app, its test, its sample size and its correction.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-stone-500">
                <th className="border-b border-stone-200 pb-1.5 pr-3">View</th>
                <th className="border-b border-stone-200 pb-1.5 pr-3">Test</th>
                <th className="border-b border-stone-200 pb-1.5 pr-3">n</th>
                <th className="border-b border-stone-200 pb-1.5">Correction</th>
              </tr>
            </thead>
            <tbody className="text-stone-700">
              {[
                ['Correlation · pair scatter', 'Pearson r and Spearman ρ, t-based p; exact binomial sign test; partial r controlling activity', `${manifest.drugs.length} drugs`, 'none — a single chosen pair'],
                ['Correlation · lasso', 'L1 coordinate descent, 60-point λ path', `${manifest.drugs.length} drugs × ${manifest.pathways.length - 1} predictors`, '5-fold CV, 1-SE rule'],
                ['Correlation · cluster coupling', 'Spearman ρ, 2,000-permutation two-sided p', `${rng(nRefs)} DMSO clusters`, 'BH across cluster × channel'],
                ['Connectivity', 'Cosine similarity; τ = percentile vs per-target background; permutation p (1,000)', `${manifest.drugs.length - 1} targets`, 'BH across targets'],
                ['Consensus · panel A', 'Exact binomial vs 50:50 sign split', `responders with |net| > ${RESPONDER_MIN}`, `BH across ${manifest.pathways.length} pathways`],
                ['Consensus · panel B', 'Leave-one-out correlation to the consensus', `${manifest.drugs.length} drugs`, 'n/a — descriptive'],
                ['Consensus · panel C', 'Standardised departure z from the consensus', `${manifest.drugs.length} drugs`, 'ranked, capped at 3 per drug'],
                ['Heterogeneity', 'RMS distance between cluster profiles', `${rng(nQs)} clusters`, 'n/a — descriptive'],
                ['Drug pages', 'BH q-values from the upstream pipeline', 'per stream', 'BH within stream'],
              ].map(([a, b, c, d]) => (
                <tr key={a}>
                  <td className="border-b border-stone-100 py-1.5 pr-3 font-medium text-stone-800">{a}</td>
                  <td className="border-b border-stone-100 py-1.5 pr-3">{b}</td>
                  <td className="border-b border-stone-100 py-1.5 pr-3 whitespace-nowrap">{c}</td>
                  <td className="border-b border-stone-100 py-1.5">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------------------------------------ exports ---- */}
      <div id="exports" className="mt-4 scroll-mt-24 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-base font-semibold text-stone-900">Exports and links</h2>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-stone-600">
          <p>
            <B>SVG ↓</B> gives a standalone vector figure with the fonts and background inlined — drop it
            straight into a manuscript. <B>CSV ↓</B> gives the numbers behind the chart, including the
            statistics: the cluster-coupling export carries ρ, permutation p, BH q and n for every
            cluster × channel row, so the starred points can be reconstructed without re-deriving them.
          </p>
          <p>
            <B>Every view&rsquo;s state lives in the URL.</B> The selected drug, pathways, mode, tab, stream,
            cluster pair, sort order and cutoff are all encoded in the address bar, so a link reproduces
            exactly what you were looking at. That is the intended way to share a finding.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------ caveats ---- */}
      <div id="caveats" className="mt-4 scroll-mt-24 rounded-lg border border-amber-200 bg-amber-50/50 p-5">
        <h2 className="text-base font-semibold text-stone-900">What this data does not support</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-stone-700">
          <li>
            <B>Correlation here is co-response, not mechanism.</B> Two pathways moving together across
            perturbations says nothing about one causing the other; they may both sit downstream of a third.
          </li>
          <li>
            <B>Connectivity is transcriptional-programme matching, not mechanism-of-action identification.</B>
            {' '}{manifest.pathways.length} Hallmark dimensions are far coarser than gene-level CMap, and there
            is no dose information, so two salts of the same compound can legitimately disagree.
          </li>
          <li>
            <B>The consensus belongs to this compendium.</B> It describes what perturbation does in these cell
            lines with this referencing and this cutoff — it is not a universal drug response.
          </li>
          <li>
            <B>Cluster indices are arbitrary labels.</B> Cluster 3 of one drug has nothing to do with cluster 3
            of another, and the numbering carries no order.
          </li>
          <li>
            <B>Cluster-coupling ρ is estimated from {rng(nRefs)} points.</B> Individual significant points are
            weak evidence; consistency across clusters is what to trust.
          </li>
          <li>
            <B>DMSO clusters are different cell contexts, not replicates.</B> Treating them as observations
            answers &ldquo;does this relationship hold across contexts&rdquo;, not &ldquo;is it reproducible&rdquo;.
          </li>
        </ul>
      </div>

      {/* paper */}
      <div className="mt-4 rounded-lg border border-dashed border-stone-300 bg-stone-50/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Cite this work</h2>
            <p className="mt-1 text-sm text-stone-500">
              Manuscript in preparation — the link will appear here.
            </p>
          </div>
          <span
            aria-disabled="true"
            className="cursor-not-allowed rounded-md border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-400"
            title="Coming soon"
          >
            Paper ↗ — coming soon
          </span>
        </div>
      </div>
    </div>
  );
}
