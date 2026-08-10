// Guide.tsx — how to read every view in the atlas, plus dataset semantics and
// the (future) manuscript link. Static content; the reference card for a
// first-time user or a reviewer.
import type { ReactNode } from 'react';
import type { Manifest, Summary } from '../types';
import { fmtCompact } from '../format';
import { rampGradient, NONSIG } from '../colors';

function Section({ id, title, href, children }: {
  id: string; title: string; href: string; children: ReactNode;
}) {
  return (
    <section id={id} className="rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        <a href={href} className="shrink-0 text-xs font-medium text-emerald-700 hover:text-emerald-800">open →</a>
      </div>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-stone-600">{children}</div>
    </section>
  );
}

const B = ({ children }: { children: ReactNode }) => <span className="font-medium text-stone-800">{children}</span>;

export function Guide({ manifest, summary }: { manifest: Manifest; summary: Summary | null }) {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Guide</h1>
      <p className="mt-1 max-w-3xl text-sm text-stone-500">
        What each view shows, how to read it, and what the numbers mean.
      </p>

      {/* dataset */}
      <div className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="text-base font-semibold text-stone-900">The dataset</h2>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-stone-600">
          <p>
            {manifest.drugs.length} drug perturbations, each compared against DMSO control. Cells are grouped
            into clusters on both sides, and every (DMSO cluster × drug cluster) pair is scored against
            the {manifest.pathways.length} MSigDB Hallmark 2020 gene sets by {manifest.streams.length} method
            streams — GSEA, fgsea, ORA and CellSpectra, each in Python and/or R.
            {summary && <> In total {fmtCompact(summary.totals.records)} pathway tests, {fmtCompact(summary.totals.sig)} significant
            at the reference cutoff q &lt; 0.05.</>}
          </p>
          <p>
            <B>Significance</B> is BH-adjusted per stream (q-value). The header slider re-thresholds every
            per-drug view live; cross-drug views (strips, Landscape, Pathways, Correlation, Connectivity,
            Consensus, instant Rank) are precomputed at the fixed reference cutoff q &lt; 0.05 and say so.
          </p>
          <p>
            <B>Direction</B> comes only from the signed streams (GSEA/fgsea). ORA and CellSpectra are
            direction-less and count as <span className="font-medium" style={{ color: '#6c55bd' }}>unsigned</span>.
            &ldquo;Net direction&rdquo; for a drug × pathway is (up − down) / tests.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[12px] text-stone-500">
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-14 rounded-sm" style={{ background: rampGradient('up') }} /> up-regulated</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-14 rounded-sm" style={{ background: rampGradient('down') }} /> down-regulated</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-14 rounded-sm" style={{ background: rampGradient('uns') }} /> unsigned</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-14 rounded-sm" style={{ background: rampGradient('ink') }} /> magnitude / mixed</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NONSIG }} /> not significant</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        <Section id="drugs" title="Drugs" href="#/">
          <p>
            The index. Each card carries a 50-pathway <B>signature strip</B> (hover any segment for the
            pathway and counts), the drug&rsquo;s overall activity (share of all tests significant), and its
            top pathways. Sort by <B>Activity</B> (strongest first), <B>Selectivity</B> (most focused on few
            pathways first) or name; press <kbd className="rounded border border-stone-300 bg-stone-50 px-1">/</kbd> to filter.
          </p>
        </Section>

        <Section id="landscape" title="Landscape" href="#/atlas">
          <p>
            The whole experiment in one heatmap: {manifest.drugs.length} drugs × {manifest.pathways.length} pathways.
            <B> Direction</B> mode colors each cell by dominant direction with intensity = significant fraction;
            <B> Activity</B> mode is magnitude only. Sort rows by activity, name, or spectrally (<B>Clustered</B>);
            &ldquo;cluster pathways&rdquo; reorders columns by co-response similarity so blocks emerge. Click a
            column label to sort by that pathway, a row to open the drug.
          </p>
        </Section>

        <Section id="pathways" title="Pathways" href="#/pathways">
          <p>
            One page per Hallmark gene set. The <B>tornado plot</B> ranks drugs by how they move the pathway:
            red bars right = fraction of tests up, blue bars left = down. A drug with both bars long responds
            heterogeneously across its clusters. Sort by total, up, down or discordant; links out to MSigDB.
          </p>
        </Section>

        <Section id="drugpage" title="Drug pages" href="#/">
          <p>
            Three tabs. <B>Pathways</B>: pathway × drug-cluster grids — each cell counts how many DMSO
            reference clusters call the pathway significant for that drug cluster; the sparkline shows how
            calls survive as the threshold tightens; tooltips break every cell down per reference cluster.
            <B> Cluster pairs</B>: where in cluster space the response lives — a dark column is a responding
            drug subpopulation, a dark row a suspect DMSO reference. <B>Method agreement</B>: the same
            cluster pair across all streams, plus a Jaccard concordance matrix (Python↔R pairs outlined).
            Everything follows the live q slider, and the URL carries tab/stream/pair for sharing.
          </p>
        </Section>

        <Section id="correlation" title="Correlation" href="#/correlate">
          <p>
            <B>Pair scatter</B>: two pathways head-to-head, one point per drug, OLS fit with 95% band,
            Pearson &amp; Spearman with exact p-values, a sign-concordance test, and a potency-adjusted
            partial correlation (controls each drug&rsquo;s overall activity — always check it, strong drugs
            move everything). <B>Lasso selection</B>: one response pathway regressed on the other 49 with
            L1 regularization — redundant predictors are shrunk to exactly zero; λ picked by 5-fold
            cross-validation (1-SE rule by default). Coefficients are standardized; an excluded pathway is
            not evidence of no association — among correlated pathways the lasso keeps one representative.
          </p>
        </Section>

        <Section id="connectivity" title="Connectivity" href="#/connect">
          <p>
            Connectivity mapping (Lamb 2006): score a query signature — any drug&rsquo;s, or a custom up/down
            pathway set — against every atlas drug. Positive cosine = <B>mimicker</B>, negative = <B>reverser</B>
            (the drug-repurposing read-out). <B>τ</B> is the hit&rsquo;s percentile against that drug&rsquo;s own
            background connectivity; treat |τ| ≥ 95 as the meaningful set. The split bar decomposes every
            score into <B>generic</B> (the shared proliferation-stress axis) vs <B>specific</B> signal —
            mostly-gray hits connect through generic cytostatic behavior, not shared pharmacology.
          </p>
        </Section>

        <Section id="consensus" title="Consensus" href="#/consensus">
          <p>
            The generic response itself. <B>A</B>: the consensus signature — per pathway, the mean net
            direction over all drugs with 95% CI and sign consistency among responders (★ = BH q &lt; 0.05).
            <B> B</B>: each drug&rsquo;s <B>genericness</B> — leave-one-out correlation to the consensus of the
            others. <B>C</B>: the residual layer — the drug × pathway effects (in σ) the consensus cannot
            explain: the specific pharmacology worth following up.
          </p>
        </Section>

        <Section id="hetero" title="Heterogeneity" href="#/hetero">
          <p>
            Do all of a drug&rsquo;s cell clusters respond the same way? <B>Dispersion</B> is the mean RMS
            disagreement between per-cluster net-direction profiles (signed streams only). Uniform broad
            cytotoxics rank low; context-selective targeted agents rank high — the substrate of residual
            disease. The detail grid shows each cluster&rsquo;s response for the most variable pathways;
            a <B>common</B> tag flags pathways that split clusters for over a third of all drugs
            (proliferation programs — baseline biology, not drug selectivity). The <B>⇅</B> count is
            pathways where clusters strictly disagree in direction.
          </p>
        </Section>

        <Section id="figures" title="Figures" href="#/figures">
          <p>
            Manuscript-ready panels regenerated live from the current data — the consensus forest, the
            Hypoxia–EMT correlation, connectivity class-recovery, and per-stream calling rates — each with
            a paper-style caption and one-click <B>SVG</B> (vector figure) and <B>CSV</B> (underlying
            numbers) downloads. Most other views also carry SVG/CSV buttons on their main charts.
          </p>
        </Section>

        <Section id="rank" title="Rank" href="#/rank">
          <p>
            Select pathways, get drugs ranked by significant tests across them instantly (reference cutoff),
            with the up / down / unsigned split shown per bar. An exact re-rank at the live cutoff is
            available behind a click (downloads the full per-drug data).
          </p>
        </Section>
      </div>

      {/* paper */}
      <div className="mt-6 rounded-lg border border-dashed border-stone-300 bg-stone-50/60 p-5">
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
