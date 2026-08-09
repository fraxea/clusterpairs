// Correlate.tsx — is pathway A regulated in the same direction as pathway B
// across the drug library? Scatter (one point per drug) + OLS fit with 95%
// confidence band + Pearson / Spearman / sign-concordance / potency-adjusted
// statistics. Defaults to Hypoxia vs Epithelial Mesenchymal Transition.
import { useEffect, useMemo, useState } from 'react';
import type { Manifest, Summary, SummaryDrug } from '../types';
import {
  lassoPath, olsBandAt, olsFit, partialPearsonTest, pearsonTest, signTestP, spearmanTest,
  type LassoResult,
} from '../analysis';
import { drugActivity, pathwayActivity } from '../significance';
import { fmtP, pathwaySlug, setHashParams } from '../format';
import { ramp } from '../colors';
import { Segmented, Spinner, StatTile } from '../ui';
import { useTip } from '../tooltip';

type Metric = 'net' | 'act';
type View = 'pair' | 'lasso';

const metricValue = (metric: Metric) => (d: SummaryDrug, p: number): number => {
  if (d.tested[p] <= 0) return NaN;
  if (metric === 'act') return pathwayActivity(d, p);
  return (d.up[p] - d.down[p]) / d.tested[p];
};

const W = 680; const H = 540;
const M = { l: 64, r: 18, t: 18, b: 56 };
const PW = W - M.l - M.r; const PH = H - M.t - M.b;

const INK = '#3d3c38';
const DOT = '#52514e';
const GRID = '#eceae4';
const AXIS = '#c3c2b7';

function findPathway(manifest: Manifest, slug: string | null, fallback: string): number {
  const bySlug = slug ? manifest.pathways.findIndex((n) => pathwaySlug(n) === slug) : -1;
  if (bySlug >= 0) return bySlug;
  const byName = manifest.pathways.findIndex((n) => n === fallback);
  return byName >= 0 ? byName : 0;
}

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}
function ticksFor(min: number, max: number): number[] {
  const step = niceStep(max - min || 1, 5);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-12; v += step) {
    out.push(Math.abs(v) < 1e-12 ? 0 : v);
  }
  return out;
}

function strengthWord(r: number): string {
  const a = Math.abs(r);
  if (a < 0.1) return 'negligible';
  if (a < 0.3) return 'weak';
  if (a < 0.5) return 'moderate';
  if (a < 0.7) return 'strong';
  return 'very strong';
}

export function Correlate({ manifest, summary, params }: {
  manifest: Manifest; summary: Summary; params: URLSearchParams;
}) {
  const tip = useTip();
  const [view, setViewRaw] = useState<View>(params.get('v') === 'lasso' ? 'lasso' : 'pair');
  const [xIdx, setXIdx] = useState(() => findPathway(manifest, params.get('x'), 'Hypoxia'));
  const [yIdx, setYIdx] = useState(() => findPathway(manifest, params.get('y'), 'Epithelial Mesenchymal Transition'));
  const [metric, setMetric] = useState<Metric>(params.get('m') === 'act' ? 'act' : 'net');
  const [hover, setHover] = useState<number | null>(null);

  const setView = (v: View) => { setViewRaw(v); setHashParams({ v: v === 'pair' ? null : v }); };
  const setX = (i: number) => { setXIdx(i); setHashParams({ x: pathwaySlug(manifest.pathways[i]) }); };
  const setY = (i: number) => { setYIdx(i); setHashParams({ y: pathwaySlug(manifest.pathways[i]) }); };
  const setM = (m: Metric) => { setMetric(m); setHashParams({ m: m === 'net' ? null : m }); };
  // from the lasso coefficient chart: inspect one predictor as a pair scatter
  const inspectPair = (p: number) => { setXIdx(p); setHashParams({ x: pathwaySlug(manifest.pathways[p]) }); setView('pair'); };

  const nameBySlug = useMemo(
    () => new Map(manifest.drugs.map((d) => [d.slug, d.name])),
    [manifest.drugs],
  );

  // one point per drug, at the fixed reference cutoff q < 0.05
  const points = useMemo(() => {
    const value = metricValue(metric);
    return summary.drugs
      .map((d) => ({ slug: d.slug, x: value(d, xIdx), y: value(d, yIdx), act: drugActivity(d) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }, [summary.drugs, xIdx, yIdx, metric]);

  const xs = useMemo(() => points.map((p) => p.x), [points]);
  const ys = useMemo(() => points.map((p) => p.y), [points]);

  const stats = useMemo(() => {
    if (points.length < 3) return null;
    const pe = pearsonTest(xs, ys);
    const sp = spearmanTest(xs, ys);
    const fit = olsFit(xs, ys);
    const partial = partialPearsonTest(xs, ys, points.map((p) => p.act));
    // direction concordance (net metric): among drugs with a nonzero call on both
    let same = 0; let nonzero = 0;
    for (const p of points) {
      if (p.x !== 0 && p.y !== 0) {
        nonzero += 1;
        if (Math.sign(p.x) === Math.sign(p.y)) same += 1;
      }
    }
    return { pe, sp, fit, partial, same, nonzero, signP: signTestP(same, nonzero) };
  }, [points, xs, ys]);

  // ---- scales ----
  const domain = useMemo(() => {
    if (points.length === 0) return { x: [-1, 1] as const, y: [-1, 1] as const };
    const pad = (vs: number[]): readonly [number, number] => {
      const lo = Math.min(...vs); const hi = Math.max(...vs);
      if (metric === 'net') {
        const m = Math.max(0.1, Math.max(Math.abs(lo), Math.abs(hi)) * 1.08);
        return [-m, m];
      }
      const span = Math.max(0.05, hi - lo);
      return [Math.max(0, lo - span * 0.06), hi + span * 0.06];
    };
    return { x: pad(xs), y: pad(ys) };
  }, [points, xs, ys, metric]);

  const sx = (v: number): number => M.l + ((v - domain.x[0]) / (domain.x[1] - domain.x[0])) * PW;
  const sy = (v: number): number => M.t + PH - ((v - domain.y[0]) / (domain.y[1] - domain.y[0])) * PH;

  const xTicks = ticksFor(domain.x[0], domain.x[1]);
  const yTicks = ticksFor(domain.y[0], domain.y[1]);
  const fmtTick = (v: number): string => `${Math.round(v * 100)}%`;

  // regression line + confidence band paths (clipped to the x-domain)
  const band = useMemo(() => {
    if (!stats) return null;
    const n = 48;
    const upper: string[] = []; const lower: string[] = [];
    let lineA = ''; let lineB = '';
    for (let i = 0; i <= n; i += 1) {
      const x = domain.x[0] + ((domain.x[1] - domain.x[0]) * i) / n;
      const yv = stats.fit.intercept + stats.fit.slope * x;
      const h = olsBandAt(stats.fit, x);
      upper.push(`${sx(x)},${sy(yv + h)}`);
      lower.unshift(`${sx(x)},${sy(yv - h)}`);
      if (i === 0) lineA = `${sx(x)},${sy(yv)}`;
      if (i === n) lineB = `${sx(x)},${sy(yv)}`;
    }
    return { poly: [...upper, ...lower].join(' '), lineA, lineB };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, domain]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const my = ((e.clientY - rect.top) / rect.height) * H;
    let best = -1; let bestD = 20 * 20;
    for (let i = 0; i < points.length; i += 1) {
      const dx = sx(points[i].x) - mx; const dy = sy(points[i].y) - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover(best >= 0 ? best : null);
    if (best >= 0) {
      const p = points[best];
      tip.show(e, (
        <div>
          <div className="font-medium text-stone-900">{nameBySlug.get(p.slug) ?? p.slug}</div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums">
            {manifest.pathways[xIdx]}: {(p.x * 100).toFixed(1)}%<br />
            {manifest.pathways[yIdx]}: {(p.y * 100).toFixed(1)}%
          </div>
          <div className="mt-0.5 text-[10px] text-stone-400">click → drug page</div>
        </div>
      ));
    } else tip.hide();
  };

  const onClick = () => {
    if (hover !== null) window.location.hash = `#/drug/${encodeURIComponent(points[hover].slug)}`;
  };

  const metricLabel = metric === 'net'
    ? 'net direction = (up − down) / tests, per drug'
    : 'activity = significant fraction of tests, per drug';

  const same = xIdx === yIdx;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Pathway correlation</h1>
          <p className="mt-1 max-w-3xl text-sm text-stone-500">
            {view === 'pair'
              ? <>Each point is one drug ({points.length} of {summary.drugs.length}); axes are how that drug regulates the
                two chosen pathways across all its (stream × cluster-pair) tests at q &lt; 0.05.
                Line = least-squares fit with 95% confidence band.</>
              : <>Which pathways jointly predict the response pathway across the {summary.drugs.length} drugs?
                Lasso (L1) regression shrinks redundant predictors to exactly zero — only the pathways that
                carry independent signal keep a coefficient. λ chosen by 5-fold cross-validation.</>}
          </p>
        </div>
        <Segmented
          options={[
            { value: 'pair', label: 'Pair scatter' },
            { value: 'lasso', label: 'Lasso selection' },
          ]}
          value={view} onChange={setView}
        />
      </div>

      {/* form row */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white p-3">
        {view === 'pair' && (
          <>
            <label className="flex items-center gap-2 text-sm text-stone-600">
              <span className="font-medium">x</span>
              <select value={xIdx} onChange={(e) => setX(Number(e.target.value))}
                className="max-w-72 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm">
                {manifest.pathways.map((n, i) => <option key={i} value={i}>{n}</option>)}
              </select>
            </label>
            <button
              type="button" title="Swap axes"
              onClick={() => { const t = xIdx; setXIdx(yIdx); setYIdx(t); setHashParams({ x: pathwaySlug(manifest.pathways[yIdx]), y: pathwaySlug(manifest.pathways[t]) }); }}
              className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-stone-500 hover:border-stone-500"
            >
              ⇄
            </button>
          </>
        )}
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <span className="font-medium">{view === 'pair' ? 'y' : 'response y'}</span>
          <select value={yIdx} onChange={(e) => setY(Number(e.target.value))}
            className="max-w-72 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm">
            {manifest.pathways.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Segmented
            options={[
              { value: 'net', label: 'Net direction', title: '(up − down) / tests — signed regulation' },
              { value: 'act', label: 'Activity', title: 'significant fraction — magnitude only' },
            ]}
            value={metric} onChange={setM}
          />
        </div>
      </div>

      {view === 'lasso' && (
        <LassoView
          manifest={manifest} summary={summary} yIdx={yIdx} metric={metric} onInspect={inspectPair}
        />
      )}

      {view === 'pair' && same && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Both axes are the same pathway — the correlation is trivially 1. Pick two different pathways.
        </p>
      )}

      {view === 'pair' && (
      <div className="mt-5 flex flex-wrap gap-6">
        {/* scatter */}
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <svg
            width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="max-w-full"
            style={{ cursor: hover !== null ? 'pointer' : 'default' }}
            onMouseMove={onMove} onMouseLeave={() => { setHover(null); tip.hide(); }} onClick={onClick}
          >
            {/* grid */}
            {xTicks.map((t) => (
              <line key={`gx${t}`} x1={sx(t)} y1={M.t} x2={sx(t)} y2={M.t + PH}
                stroke={t === 0 && metric === 'net' ? AXIS : GRID} strokeWidth={1} />
            ))}
            {yTicks.map((t) => (
              <line key={`gy${t}`} x1={M.l} y1={sy(t)} x2={M.l + PW} y2={sy(t)}
                stroke={t === 0 && metric === 'net' ? AXIS : GRID} strokeWidth={1} />
            ))}
            {/* confidence band + fit */}
            {band && !same && (
              <>
                <polygon points={band.poly} fill="rgba(11,11,11,0.07)" />
                <line
                  x1={Number(band.lineA.split(',')[0])} y1={Number(band.lineA.split(',')[1])}
                  x2={Number(band.lineB.split(',')[0])} y2={Number(band.lineB.split(',')[1])}
                  stroke="#0b0b0b" strokeWidth={2} strokeLinecap="round"
                />
              </>
            )}
            {/* points */}
            {points.map((p, i) => (
              <circle
                key={p.slug}
                cx={sx(p.x)} cy={sy(p.y)} r={i === hover ? 5 : 3.5}
                fill={DOT} fillOpacity={i === hover ? 1 : 0.5}
                stroke={i === hover ? '#047857' : '#ffffff'} strokeWidth={1.5}
              />
            ))}
            {/* axis ticks + labels */}
            {xTicks.map((t) => (
              <text key={`tx${t}`} x={sx(t)} y={M.t + PH + 18} textAnchor="middle"
                fontSize={11} fill={INK} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmtTick(t)}
              </text>
            ))}
            {yTicks.map((t) => (
              <text key={`ty${t}`} x={M.l - 8} y={sy(t) + 3.5} textAnchor="end"
                fontSize={11} fill={INK} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmtTick(t)}
              </text>
            ))}
            <text x={M.l + PW / 2} y={H - 12} textAnchor="middle" fontSize={13} fontWeight={500} fill={INK}>
              {manifest.pathways[xIdx]}
            </text>
            <text x={16} y={M.t + PH / 2} textAnchor="middle" fontSize={13} fontWeight={500} fill={INK}
              transform={`rotate(-90 16 ${M.t + PH / 2})`}>
              {manifest.pathways[yIdx]}
            </text>
            {/* in-plot annotation */}
            {stats && !same && (
              <text x={M.l + 12} y={M.t + 18} fontSize={12} fill={INK} style={{ fontVariantNumeric: 'tabular-nums' }}>
                r = {stats.pe.r.toFixed(2)} · n = {stats.pe.n}
              </text>
            )}
          </svg>
          <p className="mt-1 px-1 text-[11px] text-stone-400">{metricLabel} · reference cutoff q &lt; 0.05</p>
        </div>

        {/* stats column */}
        {stats && !same && (
          <div className="min-w-64 max-w-sm flex-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatTile
                label="Pearson r" value={stats.pe.r.toFixed(3)}
                sub={`t(${stats.pe.n - 2}) = ${stats.pe.t.toFixed(1)} · ${fmtP(stats.pe.p)}`}
              />
              <StatTile
                label="Spearman ρ" value={stats.sp.r.toFixed(3)}
                sub={`rank-based · ${fmtP(stats.sp.p)}`}
              />
              <StatTile
                label="OLS slope" value={stats.fit.slope.toFixed(2)}
                sub={`± ${stats.fit.ci95.toFixed(2)} (95% CI) · R² = ${stats.fit.r2.toFixed(2)}`}
              />
              {metric === 'net' ? (
                <StatTile
                  label="Same direction" value={`${Math.round((stats.same / Math.max(1, stats.nonzero)) * 100)}%`}
                  sub={`${stats.same}/${stats.nonzero} drugs · sign test ${fmtP(stats.signP)}`}
                />
              ) : (
                <StatTile
                  label="Potency-adjusted r" value={stats.partial.r.toFixed(3)}
                  sub={`controls mean activity · ${fmtP(stats.partial.p)}`}
                />
              )}
            </div>

            <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-700">
              <p>
                <span className="font-medium">{manifest.pathways[xIdx]}</span> and{' '}
                <span className="font-medium">{manifest.pathways[yIdx]}</span> show a{' '}
                <span className="font-medium">
                  {strengthWord(stats.pe.r)} {stats.pe.r >= 0 ? 'positive' : 'negative'}
                </span>{' '}
                correlation across the library
                {stats.pe.p < 0.001 ? ' (highly significant)' : stats.pe.p < 0.05 ? ' (significant)' : ' (not significant)'}.
                {metric === 'net' && stats.nonzero > 0 && (
                  <> In {Math.round((stats.same / stats.nonzero) * 100)}% of drugs with a directional
                  call on both, the two pathways move in the same direction.</>
                )}
              </p>
              <p className="mt-2 text-xs text-stone-500">
                Potency-adjusted r = {stats.partial.r.toFixed(3)} ({fmtP(stats.partial.p)}) — Pearson on
                residuals after regressing both variables on each drug&rsquo;s overall activity, so shared
                &ldquo;strong drugs move everything&rdquo; signal is removed.
                {' '}Correlation across perturbations is co-response, not a causal link.
              </p>
            </div>

            <div className="mt-3 flex gap-2 text-xs">
              <a className="text-emerald-700 hover:text-emerald-800"
                href={`#/pathway/${pathwaySlug(manifest.pathways[xIdx])}`}>
                {manifest.pathways[xIdx]} →
              </a>
              <span className="text-stone-300">·</span>
              <a className="text-emerald-700 hover:text-emerald-800"
                href={`#/pathway/${pathwaySlug(manifest.pathways[yIdx])}`}>
                {manifest.pathways[yIdx]} →
              </a>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- lasso view ----
const CV_W = 420; const CV_H = 170;
const CVM = { l: 54, r: 14, t: 12, b: 34 };

function LassoView({ manifest, summary, yIdx, metric, onInspect }: {
  manifest: Manifest; summary: Summary; yIdx: number; metric: Metric;
  onInspect: (p: number) => void;
}) {
  const tip = useTip();
  const inputsKey = `${yIdx}:${metric}`;
  const [fitted, setFitted] = useState<{ key: string; res: LassoResult } | null>(null);
  const [rule, setRule] = useState<'1se' | 'min' | 'custom'>('1se');
  const [customIdx, setCustomIdx] = useState(0);

  // render-phase reset of the λ rule when the response/metric changes
  const [prevKey, setPrevKey] = useState(inputsKey);
  if (prevKey !== inputsKey) { setPrevKey(inputsKey); setRule('1se'); }

  const preds = useMemo(
    () => manifest.pathways.map((_, i) => i).filter((i) => i !== yIdx),
    [manifest.pathways, yIdx],
  );

  // ~0.9 s of matrix math — the timeout lets the spinner paint first; results
  // for stale inputs are ignored via the key rather than reset synchronously.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const value = metricValue(metric);
      const X = summary.drugs.map((d) => preds.map((p) => value(d, p)));
      const y = summary.drugs.map((d) => value(d, yIdx));
      setFitted({ key: `${yIdx}:${metric}`, res: lassoPath(X, y) });
    }, 30);
    return () => window.clearTimeout(t);
  }, [summary.drugs, preds, yIdx, metric]);

  const res = fitted && fitted.key === inputsKey ? fitted.res : null;

  if (!res) {
    return (
      <div className="mt-6">
        <Spinner label="Fitting the lasso path (60 λ values × 5-fold cross-validation)…" />
      </div>
    );
  }

  const idx = rule === 'min' ? res.iMin : rule === '1se' ? res.i1se : customIdx;
  const beta = res.betas[idx];
  // The solver centers y but keeps its scale (β = y-units per SD of x);
  // divide by SD(y) so displayed coefficients are fully standardized.
  const sdY = Math.sqrt(res.yVar) || 1;
  const selected = preds
    .map((p, j) => ({ p, b: beta[j] / sdY }))
    .filter((s) => s.b !== 0)
    .sort((a, b) => Math.abs(b.b) - Math.abs(a.b));
  const cvR2 = res.yVar > 0 ? 1 - res.cvMse[idx] / res.yVar : NaN;

  // ---- CV curve scales ----
  const lx = (k: number): number =>
    CVM.l + ((Math.log10(res.lambdas[0]) - Math.log10(res.lambdas[k]))
      / (Math.log10(res.lambdas[0]) - Math.log10(res.lambdas[res.lambdas.length - 1]))) * (CV_W - CVM.l - CVM.r);
  const mseMax = Math.max(...res.cvMse.map((m, k) => m + res.cvSe[k]));
  const mseMin = Math.min(...res.cvMse.map((m, k) => m - res.cvSe[k]));
  const ly = (m: number): number =>
    CVM.t + (1 - (m - mseMin) / (mseMax - mseMin || 1)) * (CV_H - CVM.t - CVM.b);
  const cvLine = res.cvMse.map((m, k) => `${lx(k)},${ly(m)}`).join(' ');
  const cvBand = [
    ...res.cvMse.map((m, k) => `${lx(k)},${ly(m + res.cvSe[k])}`),
    ...[...res.cvMse.keys()].reverse().map((k) => `${lx(k)},${ly(res.cvMse[k] - res.cvSe[k])}`),
  ].join(' ');

  // ---- coefficient chart scales ----
  const NAME_W = 230; const BAR_W = 380; const ROW_H = 24;
  const bMax = Math.max(0.01, ...selected.map((s) => Math.abs(s.b)));
  const cx = NAME_W + BAR_W / 2;
  const bw = (b: number): number => (Math.abs(b) / bMax) * (BAR_W / 2 - 46);

  return (
    <div className="mt-6 flex flex-wrap gap-6">
      <div className="min-w-80 max-w-md flex-1">
        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label="Selected pathways" value={`${selected.length}`}
            sub={`of ${preds.length} predictors · nonzero lasso coefficients`}
          />
          <StatTile
            label="Cross-validated R²" value={Number.isFinite(cvR2) ? cvR2.toFixed(2) : '—'}
            sub={`in-sample R² = ${res.r2[idx].toFixed(2)} · n = ${summary.drugs.length}`}
          />
        </div>

        <div className="mt-3 rounded-lg border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-400">Regularization λ</span>
            <Segmented
              options={[
                { value: '1se', label: 'λ 1-SE', title: 'Most parsimonious model within one SE of the CV minimum' },
                { value: 'min', label: 'λ min', title: 'CV-minimum error' },
              ]}
              value={rule === 'custom' ? '1se' : rule}
              onChange={(v) => setRule(v)}
            />
          </div>
          <svg width={CV_W} height={CV_H} viewBox={`0 0 ${CV_W} ${CV_H}`} className="mt-2 max-w-full">
            <polygon points={cvBand} fill="rgba(11,11,11,0.07)" />
            <polyline points={cvLine} fill="none" stroke="#7b786f" strokeWidth={1.5} />
            <line x1={lx(res.iMin)} y1={CVM.t} x2={lx(res.iMin)} y2={CV_H - CVM.b} stroke="#c3c2b7" strokeWidth={1} />
            <line x1={lx(res.i1se)} y1={CVM.t} x2={lx(res.i1se)} y2={CV_H - CVM.b} stroke="#c3c2b7" strokeWidth={1} />
            <line x1={lx(idx)} y1={CVM.t} x2={lx(idx)} y2={CV_H - CVM.b} stroke="#047857" strokeWidth={1.5} />
            <text x={lx(res.iMin)} y={CV_H - CVM.b + 14} textAnchor="middle" fontSize={10} fill="#898781">min</text>
            <text x={lx(res.i1se)} y={CV_H - CVM.b + 14} textAnchor="middle" fontSize={10} fill="#898781">1-SE</text>
            <text x={CVM.l - 8} y={CVM.t + 8} textAnchor="end" fontSize={10} fill="#898781"
              transform={`rotate(-90 ${CVM.l - 8} ${CVM.t + 8})`}>CV MSE</text>
            <text x={(CVM.l + CV_W - CVM.r) / 2} y={CV_H - 4} textAnchor="middle" fontSize={10} fill="#898781">
              ← more regularization · log λ · less →
            </text>
          </svg>
          <input
            type="range" min={0} max={res.lambdas.length - 1} value={idx}
            onChange={(e) => { setRule('custom'); setCustomIdx(Number(e.target.value)); }}
            className="mt-1 h-1 w-full cursor-pointer accent-emerald-700"
          />
          <div className="mt-1 font-mono text-[11px] tabular-nums text-stone-500">
            λ = {res.lambdas[idx].toExponential(2)} · {res.nnz[idx]} nonzero
          </div>
        </div>

        <p className="mt-3 max-w-md text-xs text-stone-500">
          Standardized coefficients: expected change (in SD of the response) per SD of the predictor,
          holding the other selected pathways fixed. Lasso zeroes redundant predictors — among strongly
          correlated pathways it keeps one representative, so an excluded pathway is not evidence of
          no association. Metric: {metric === 'net' ? 'net direction (up − down)/tests' : 'activity fraction'} at q &lt; 0.05.
        </p>
      </div>

      {/* coefficient chart */}
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-stone-400">
          Predictors of {manifest.pathways[yIdx]}
        </div>
        {selected.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            No pathway survives this much regularization — move the λ slider right.
          </p>
        ) : (
          <svg
            width={NAME_W + BAR_W} height={selected.length * ROW_H + 26}
            viewBox={`0 0 ${NAME_W + BAR_W} ${selected.length * ROW_H + 26}`} className="mt-2 max-w-full"
          >
            <line x1={cx} y1={2} x2={cx} y2={selected.length * ROW_H + 4} stroke="#e1e0d9" strokeWidth={1} />
            {selected.map((s, i) => {
              const y = i * ROW_H + ROW_H / 2 + 2;
              const w = bw(s.b);
              const pos = s.b > 0;
              return (
                <g
                  key={s.p} className="cursor-pointer"
                  onMouseMove={(e) => tip.show(e, (
                    <div>
                      <div className="font-medium text-stone-900">{manifest.pathways[s.p]}</div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums">β = {s.b.toFixed(3)} (standardized)</div>
                      <div className="mt-0.5 text-[10px] text-stone-400">click → pair scatter vs {manifest.pathways[yIdx]}</div>
                    </div>
                  ))}
                  onMouseLeave={tip.hide}
                  onClick={() => onInspect(s.p)}
                >
                  <rect x={0} y={y - ROW_H / 2} width={NAME_W + BAR_W} height={ROW_H} fill="transparent" />
                  <text x={NAME_W - 10} y={y + 3.5} textAnchor="end" fontSize={11.5} fill="#3d3c38">
                    {manifest.pathways[s.p].length > 30 ? `${manifest.pathways[s.p].slice(0, 29)}…` : manifest.pathways[s.p]}
                  </text>
                  <rect
                    x={pos ? cx + 1 : cx - 1 - w} y={y - 7} width={w} height={14}
                    rx={0} fill={ramp(pos ? 'up' : 'down', 0.55)}
                  />
                  <text
                    x={pos ? cx + w + 6 : cx - w - 6} y={y + 3.5}
                    textAnchor={pos ? 'start' : 'end'} fontSize={10.5} fill="#52514e"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {s.b.toFixed(2)}
                  </text>
                </g>
              );
            })}
            <text x={cx} y={selected.length * ROW_H + 20} textAnchor="middle" fontSize={10} fill="#898781">
              standardized coefficient (red = positive, blue = negative)
            </text>
          </svg>
        )}
      </div>
    </div>
  );
}
