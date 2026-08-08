// Network.tsx — graph-theoretic views of the screen, all from summary.json:
//   1. Drug similarity network — nodes are drugs, edges join each drug to its
//      most similar neighbors (cosine over per-pathway significance
//      fingerprints), communities from label propagation.
//   2. Pathway co-response network — nodes are the 50 Hallmark pathways,
//      edges join pathways whose activity correlates across the 379 drugs
//      (Pearson), revealing pathway modules.
// Layouts are force-directed, animated live, and deterministic (seeded).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Manifest, Summary } from '../types';
import {
  centerVectors, communityThemes, consensusCommunities, corrEdges, createForceSim,
  drugFingerprints, knnEdges, pathwayActivityMatrix, type Edge,
} from '../analysis';
import { drugActivity } from '../significance';
import { CATEGORICAL, communityColor, ramp } from '../colors';
import { fmtPct } from '../format';
import { pathwaySlug } from '../format';
import { useTip } from '../tooltip';

interface NetNode {
  id: number;
  label: string;
  r: number;
  community: number;
  href: string;
  tip: ReactNode;
  showLabel: boolean;
}

/** Rescale edge weights to [0,1] so width/rest-length encodings use the full range. */
function normalizeWeights(edges: Edge[]): Edge[] {
  if (edges.length === 0) return edges;
  let min = Infinity; let max = -Infinity;
  for (const e of edges) { min = Math.min(min, e.w); max = Math.max(max, e.w); }
  const span = max - min;
  return edges.map((e) => ({ ...e, w: span > 1e-9 ? (e.w - min) / span : 0.5 }));
}

// ---------------------------------------------------------- force canvas ----
function ForceGraph({ nodes, edges, height, focus, seed }: {
  nodes: NetNode[];
  edges: Edge[];
  height: number;
  focus: number | null; // community to highlight (others dimmed)
  seed: number;
}) {
  const tip = useTip();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef<Array<{ x: number; y: number }>>([]);
  const hoverRef = useRef(-1);
  const [width, setWidth] = useState(() => Math.min(1210, Math.max(640, window.innerWidth - 106)));

  useEffect(() => {
    const onResize = () => setWidth(Math.min(1210, Math.max(640, window.innerWidth - 106)));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // focus only affects painting — route it through a ref so a chip click
  // repaints instead of tearing down and replaying the whole simulation.
  const focusRef = useRef(focus);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = width * dpr; cv.height = height * dpr;
    cv.style.width = `${width}px`; cv.style.height = `${height}px`;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const sim = createForceSim(nodes.length, edges, seed);
    let raf = 0;

    const draw = () => {
      // fit sim coords into the canvas with padding
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      for (let i = 0; i < nodes.length; i += 1) {
        minX = Math.min(minX, sim.x[i]); maxX = Math.max(maxX, sim.x[i]);
        minY = Math.min(minY, sim.y[i]); maxY = Math.max(maxY, sim.y[i]);
      }
      const pad = 34;
      const sx = (width - 2 * pad) / Math.max(1e-6, maxX - minX);
      const sy = (height - 2 * pad) / Math.max(1e-6, maxY - minY);
      const s = Math.min(sx, sy);
      const ox = (width - s * (maxX - minX)) / 2;
      const oy = (height - s * (maxY - minY)) / 2;
      const pos = nodes.map((_, i) => ({
        x: ox + s * (sim.x[i] - minX),
        y: oy + s * (sim.y[i] - minY),
      }));
      posRef.current = pos;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // edges
      const fc = focusRef.current;
      for (const e of edges) {
        const dimmed = fc !== null
          && !(nodes[e.a].community === fc && nodes[e.b].community === fc);
        ctx.strokeStyle = dimmed ? 'rgba(82,81,78,0.05)' : 'rgba(82,81,78,0.16)';
        ctx.lineWidth = 0.6 + 1.6 * Math.max(0, Math.min(1, e.w));
        ctx.beginPath();
        ctx.moveTo(pos[e.a].x, pos[e.a].y);
        ctx.lineTo(pos[e.b].x, pos[e.b].y);
        ctx.stroke();
      }
      // nodes
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        const dimmed = fc !== null && n.community !== fc;
        ctx.globalAlpha = dimmed ? 0.15 : 1;
        ctx.beginPath();
        ctx.arc(pos[i].x, pos[i].y, n.r, 0, 2 * Math.PI);
        ctx.fillStyle = communityColor(n.community);
        ctx.fill();
        // 2px surface ring so overlapping nodes stay legible
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // labels (selective)
      ctx.font = '10px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        const show = i === hoverRef.current
          || (n.showLabel && (fc === null || n.community === fc));
        if (!show) continue;
        const x = pos[i].x + n.r + 4;
        const y = pos[i].y;
        const w = ctx.measureText(n.label).width;
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.fillRect(x - 2, y - 7, w + 4, 14);
        ctx.fillStyle = '#3d3c38';
        ctx.fillText(n.label, x, y + 0.5);
      }
    };

    const loop = () => {
      const alpha = sim.tick(4);
      draw();
      if (alpha > 0) raf = requestAnimationFrame(loop);
    };
    loop();

    // repaint on hover/focus changes (an extra draw mid-animation is harmless)
    const redraw = () => draw();
    cv.addEventListener('redraw', redraw);
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener('redraw', redraw);
    };
  }, [nodes, edges, width, height, seed]);

  useEffect(() => {
    focusRef.current = focus;
    canvasRef.current?.dispatchEvent(new Event('redraw'));
  }, [focus]);

  const nodeAt = (e: React.MouseEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    let best = -1; let bestD = Infinity;
    const pos = posRef.current;
    for (let i = 0; i < pos.length; i += 1) {
      const dx = pos[i].x - x; const dy = pos[i].y - y;
      const d = dx * dx + dy * dy;
      const hit = Math.max(12, nodes[i].r + 4);
      if (d < hit * hit && d < bestD) { best = i; bestD = d; }
    }
    return best;
  };

  return (
    <canvas
      ref={canvasRef}
      className="block"
      style={{ cursor: 'pointer' }}
      onMouseMove={(e) => {
        const i = nodeAt(e);
        if (i !== hoverRef.current) {
          hoverRef.current = i;
          e.currentTarget.dispatchEvent(new Event('redraw'));
        }
        if (i < 0) { tip.hide(); return; }
        tip.show(e, nodes[i].tip);
      }}
      onMouseLeave={(e) => {
        hoverRef.current = -1;
        e.currentTarget.dispatchEvent(new Event('redraw'));
        tip.hide();
      }}
      onClick={(e) => {
        const i = nodeAt(e);
        if (i >= 0) window.location.hash = nodes[i].href;
      }}
    />
  );
}

// ------------------------------------------------------------------- page ----
export function NetworkPage({ manifest, summary }: { manifest: Manifest; summary: Summary }) {
  const drugs = summary.drugs;
  const nameBySlug = useMemo(
    () => new Map(manifest.drugs.map((d) => [d.slug, d.name])),
    [manifest.drugs],
  );
  const [focus, setFocus] = useState<number | null>(null);

  // ---- drug graph ----
  // Similarity uses MEAN-CENTERED fingerprints: raw activity vectors share a
  // dominant unsigned component, which squashes every cosine into [0.8, 1].
  const fps = useMemo(() => drugFingerprints(drugs), [drugs]);
  const drugEdges = useMemo(
    () => normalizeWeights(knnEdges(centerVectors(fps), 6, 0.3)),
    [fps],
  );
  const drugComm = useMemo(
    () => consensusCommunities(drugs.length, drugEdges),
    [drugs.length, drugEdges],
  );
  const themes = useMemo(
    () => communityThemes(drugs, drugComm.label, drugComm.count, 2),
    [drugs, drugComm],
  );

  const activityRank = useMemo(() => {
    const acts = drugs.map((d, i) => ({ i, a: drugActivity(d) }));
    acts.sort((x, y) => y.a - x.a);
    const rank = new Array<number>(drugs.length);
    acts.forEach(({ i }, r) => { rank[i] = r; });
    return rank;
  }, [drugs]);

  const drugNodes: NetNode[] = useMemo(() => drugs.map((d, i) => {
    const name = nameBySlug.get(d.slug) ?? d.slug;
    const a = drugActivity(d);
    const c = drugComm.label[i];
    return {
      id: i,
      label: name.length > 22 ? `${name.slice(0, 21)}…` : name,
      r: 3.5 + 9 * Math.min(1, a / 0.5),
      community: c,
      href: `#/drug/${encodeURIComponent(d.slug)}`,
      showLabel: activityRank[i] < 14,
      tip: (
        <div>
          <div className="font-medium text-stone-900">{name}</div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums">
            community {c + 1} · activity {fmtPct(a)}
          </div>
          <div className="mt-0.5 text-[10px] text-stone-400">click → drug page</div>
        </div>
      ),
    };
  }), [drugs, drugComm, nameBySlug, activityRank]);

  // ---- pathway graph ----
  const pwMat = useMemo(() => pathwayActivityMatrix(drugs), [drugs]);
  const pwEdges = useMemo(() => normalizeWeights(corrEdges(pwMat, 3, 0.45)), [pwMat]);
  const pwComm = useMemo(
    () => consensusCommunities(pwMat.length, pwEdges),
    [pwMat.length, pwEdges],
  );

  const pwNodes: NetNode[] = useMemo(() => manifest.pathways.map((name, p) => {
    const mean = pwMat[p].reduce((s, v) => s + v, 0) / Math.max(1, pwMat[p].length);
    const c = pwComm.label[p];
    return {
      id: p,
      label: name.length > 24 ? `${name.slice(0, 23)}…` : name,
      r: 4 + 10 * Math.min(1, mean / 0.5),
      community: c,
      href: `#/pathway/${pathwaySlug(name)}`,
      showLabel: true,
      tip: (
        <div>
          <div className="font-medium text-stone-900">{name}</div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums">
            module {c + 1} · mean activity {fmtPct(mean)}
          </div>
          <div className="mt-0.5 text-[10px] text-stone-400">click → pathway page</div>
        </div>
      ),
    };
  }), [manifest.pathways, pwMat, pwComm]);

  const shownCommunities = Math.min(drugComm.count, CATEGORICAL.length);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Networks</h1>
      <p className="mt-1 max-w-3xl text-sm text-stone-500">
        Graph views of the screen at the reference cutoff q &lt; 0.05. Communities are consensus groups
        over 24 seeded label-propagation runs — two drugs are grouped only when ≥70% of runs agree —
        data-driven groupings, not curated classes.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold tracking-tight text-stone-900">Drug similarity network</h2>
        <p className="mt-1 max-w-3xl text-xs text-stone-500">
          Each drug links to its 6 nearest neighbors by cosine similarity of its mean-centered 150-dim
          significance fingerprint (up / down / unsigned fraction per pathway, relative to the library
          average). Edge thickness = similarity (rescaled over the drawn edges). Node size = overall
          activity. Community labels show where a community deviates most from the library mean.
          Click a community chip to isolate it; click a node to open the drug.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {themes.slice(0, shownCommunities).map((t, c) => (
            <button
              key={c} type="button"
              onClick={() => setFocus(focus === c ? null : c)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
                focus === c ? 'border-stone-900 bg-stone-900 text-white'
                  : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400'}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: communityColor(c) }} />
              C{c + 1} · {t.size}
              <span className={focus === c ? 'text-stone-300' : 'text-stone-400'}>
                {t.top.map((x) => `${manifest.pathways[x.pathway]}${x.kind === 'up' ? ' ▲' : x.kind === 'down' ? ' ▼' : ' ◆'}`).join(' · ')}
              </span>
            </button>
          ))}
          {focus !== null && (
            <button type="button" onClick={() => setFocus(null)}
              className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] text-stone-500 hover:border-stone-500">
              show all ×
            </button>
          )}
        </div>
        <div className="mt-3 w-fit rounded-lg border border-stone-200 bg-white p-2">
          <ForceGraph nodes={drugNodes} edges={drugEdges} height={640} focus={focus} seed={7} />
        </div>
        <p className="mt-2 text-[11px] text-stone-400">
          {drugs.length} drugs · {drugEdges.length} edges · {drugComm.count} consensus communities
          (top {shownCommunities} colored, rest gray) · community label = its strongest differential
          pathway signals vs the library mean (▲ up · ▼ down · ◆ unsigned)
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight text-stone-900">Pathway co-response network</h2>
        <p className="mt-1 max-w-3xl text-xs text-stone-500">
          Each pathway links to its 3 most correlated partners across all {drugs.length} drugs
          (Pearson r ≥ 0.45 minimum — the top-3 cap is the selective step). Modules are pathways that
          tend to respond in the same drugs; the correlations partly reflect overall drug potency, so
          read them as co-response, not mechanism. Node size = mean activity. Click a node to open the pathway.
        </p>
        <div className="mt-3 w-fit rounded-lg border border-stone-200 bg-white p-2">
          <ForceGraph nodes={pwNodes} edges={pwEdges} height={560} focus={null} seed={11} />
        </div>
        <p className="mt-2 text-[11px] text-stone-400">
          {manifest.pathways.length} pathways · {pwEdges.length} edges · {pwComm.count} consensus modules ·
          edge thickness = Pearson r (rescaled over drawn edges)
          · <span className="inline-block h-2 w-8 rounded-sm align-middle" style={{ background: ramp('ink', 0.35) }} /> weak
          → <span className="inline-block h-2 w-8 rounded-sm align-middle" style={{ background: ramp('ink', 0.8) }} /> strong
        </p>
      </section>
    </div>
  );
}
