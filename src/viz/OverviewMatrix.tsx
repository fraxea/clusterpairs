// OverviewMatrix.tsx — the full drug x pathway landscape as a virtualized
// canvas heatmap (19k cells; only the viewport slice is ever drawn). Rows are
// drugs, columns the 50 Hallmark pathways (in any display order); a sticky
// header canvas keeps the rotated pathway labels while the page scrolls.
import { useEffect, useMemo, useRef } from 'react';
import type { Manifest, Summary } from '../types';
import { classifyCounts, pathwayActivity } from '../significance';
import { activityColor, dirCellColor } from '../colors';
import { fmtPct } from '../format';
import { useTip } from '../tooltip';

export const GUTTER = 200;
// Extra canvas width past the last column so its rotated label isn't clipped.
export const OVERHANG = 96;
const ROW_H = 14;
// Label geometry: ~65° rotation; 26-char labels at 10px need ≈132px of height.
const HEADER_H = 150;
const ANGLE = -1.134; // radians (~65°)
const INK = '#52514e';

export type AtlasMode = 'dir' | 'act';

export function OverviewMatrix({ manifest, summary, mode, order, colOrder, cellW, sortedBy, onColumnClick }: {
  manifest: Manifest;
  summary: Summary;
  mode: AtlasMode;
  order: number[];               // indices into summary.drugs, display order
  colOrder: number[];            // display column position -> pathway index
  cellW: number;                 // responsive column width
  sortedBy: number | null;       // pathway column currently driving the sort
  onColumnClick: (p: number) => void;
}) {
  const tip = useTip();
  const nP = manifest.pathways.length;
  // The matrix itself ends at the last column; only the HEADER canvas gets the
  // extra overhang so the final rotated labels have room — it overflows the
  // matrix width invisibly (transparent canvas) instead of widening the layout.
  const matrixW = GUTTER + nP * cellW;
  const headerW = matrixW + OVERHANG;
  const bodyH = order.length * ROW_H;

  const nameBySlug = useMemo(
    () => new Map(manifest.drugs.map((d) => [d.slug, d.name])),
    [manifest.drugs],
  );

  const headerRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverRowRef = useRef(-1);

  // ---- header canvas (sticky) ----
  useEffect(() => {
    const cv = headerRef.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = headerW * dpr; cv.height = HEADER_H * dpr;
    cv.style.width = `${headerW}px`; cv.style.height = `${HEADER_H}px`;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, headerW, HEADER_H);
    for (let c = 0; c < nP; c += 1) {
      const p = colOrder[c];
      const x = GUTTER + c * cellW + cellW / 2;
      const name = manifest.pathways[p];
      const label = name.length > 26 ? `${name.slice(0, 25)}…` : name;
      ctx.save();
      ctx.translate(x + 3, HEADER_H - 8);
      ctx.rotate(ANGLE);
      ctx.fillStyle = p === sortedBy ? '#0b0b0b' : INK;
      ctx.font = p === sortedBy ? '600 10px system-ui, sans-serif' : '10px system-ui, sans-serif';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    // axis caption, bottom-left corner of the label band
    ctx.fillStyle = '#3d3c38';
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillText('drugs ↓', 8, HEADER_H - 26);
    ctx.fillText('pathways →', 8, HEADER_H - 9);
  }, [manifest.pathways, nP, headerW, cellW, colOrder, sortedBy]);

  // ---- body canvas (virtualized to the window viewport) ----
  useEffect(() => {
    const cv = bodyRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // viewH tracks the live window height — a height-only resize must re-size
    // the canvas, not just redraw into a stale one.
    let viewH = 0;
    const size = () => {
      viewH = Math.min(bodyH, Math.max(400, window.innerHeight));
      cv.width = matrixW * dpr; cv.height = viewH * dpr;
      cv.style.width = `${matrixW}px`; cv.style.height = `${viewH}px`;
    };
    size();

    let raf = 0;
    const draw = () => {
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const wrapTop = wrap.getBoundingClientRect().top + window.scrollY;
      const offset = Math.min(Math.max(0, window.scrollY - wrapTop), Math.max(0, bodyH - viewH));
      cv.style.transform = `translateY(${offset}px)`;
      const rowStart = Math.max(0, Math.floor(offset / ROW_H) - 2);
      const rowEnd = Math.min(order.length, Math.ceil((offset + viewH) / ROW_H) + 2);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, matrixW, viewH);
      ctx.font = '10.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (let r = rowStart; r < rowEnd; r += 1) {
        const d = summary.drugs[order[r]];
        const y = r * ROW_H - offset;
        if (r === hoverRowRef.current) {
          ctx.fillStyle = 'rgba(11,11,11,0.05)';
          ctx.fillRect(0, y, matrixW, ROW_H);
        }
        const name = nameBySlug.get(d.slug) ?? d.slug;
        ctx.fillStyle = INK;
        ctx.fillText(name.length > 28 ? `${name.slice(0, 27)}…` : name, 8, y + ROW_H / 2 + 0.5);
        for (let c = 0; c < nP; c += 1) {
          const p = colOrder[c];
          const a = pathwayActivity(d, p);
          ctx.fillStyle = mode === 'act'
            ? activityColor(a)
            : dirCellColor(classifyCounts(d.up[p], d.down[p], d.uns[p], d.tested[p]));
          ctx.fillRect(GUTTER + c * cellW, y + 0.5, cellW - 1, ROW_H - 1);
        }
      }
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    const onResize = () => { size(); onScroll(); };
    draw();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [summary, order, colOrder, mode, matrixW, cellW, bodyH, nP, nameBySlug]);

  // ---- interaction ----
  // Rows are laid out in wrap-content coordinates (row * ROW_H), so hit-testing
  // maps the pointer through the wrap element, not the (translated) canvas.
  const colAt = (x: number): number => {
    if (x < GUTTER) return -1;
    const c = Math.floor((x - GUTTER) / cellW);
    return c >= 0 && c < nP ? c : -1;
  };
  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const wrap = wrapRef.current;
    if (!wrap) return { row: -1, c: -1 };
    const wrapY = e.clientY - wrap.getBoundingClientRect().top;
    const row = Math.floor(wrapY / ROW_H);
    if (row < 0 || row >= order.length) return { row: -1, c: -1 };
    return { row, c: colAt(x) };
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { row, c } = cellAt(e);
    if (row < 0) { tip.hide(); return; }
    if (hoverRowRef.current !== row) {
      hoverRowRef.current = row;
      window.dispatchEvent(new Event('scroll')); // trigger a redraw for the row highlight
    }
    const d = summary.drugs[order[row]];
    const name = nameBySlug.get(d.slug) ?? d.slug;
    if (c < 0) {
      tip.show(e, <div className="font-medium text-stone-900">{name}</div>);
      return;
    }
    const p = colOrder[c];
    const a = pathwayActivity(d, p);
    tip.show(e, (
      <div>
        <div className="font-medium text-stone-900">{name}</div>
        <div className="text-stone-500">{manifest.pathways[p]}</div>
        <div className="mt-1 font-mono text-[11px] tabular-nums">
          {fmtPct(a)} of {d.tested[p]} tests significant
          <span className="text-stone-400"> · </span>
          <span style={{ color: '#bc3a30' }}>▲{d.up[p]}</span>{' '}
          <span style={{ color: '#2a78d6' }}>▼{d.down[p]}</span>{' '}
          <span style={{ color: '#6c55bd' }}>◆{d.uns[p]}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-stone-600">click → drug page</div>
      </div>
    ));
  };

  const onLeave = () => {
    tip.hide();
    hoverRowRef.current = -1;
    window.dispatchEvent(new Event('scroll'));
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { row } = cellAt(e);
    if (row < 0) return;
    const d = summary.drugs[order[row]];
    window.location.hash = `#/drug/${encodeURIComponent(d.slug)}`;
  };

  const onHeaderMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const c = colAt(e.clientX - rect.left);
    if (c < 0) { tip.hide(); return; }
    tip.show(e, (
      <div>
        <div className="font-medium text-stone-900">{manifest.pathways[colOrder[c]]}</div>
        <div className="mt-0.5 text-[10px] text-stone-600">click to sort drugs by this pathway</div>
      </div>
    ));
  };
  const onHeaderClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const c = colAt(e.clientX - rect.left);
    if (c >= 0) onColumnClick(colOrder[c]);
  };

  return (
    // The layout is exactly as wide as the matrix; the header canvas alone
    // overflows to the right so the last rotated labels have room.
    <div style={{ width: matrixW }}>
      <div className="sticky top-[var(--hdr,57px)] z-[5] border-b border-stone-200 bg-[#f7f7f5]" style={{ width: matrixW }}>
        <canvas
          ref={headerRef}
          className="max-w-none"
          style={{ cursor: 'pointer' }}
          onMouseMove={onHeaderMove}
          onMouseLeave={() => tip.hide()}
          onClick={onHeaderClick}
        />
      </div>
      <div ref={wrapRef} className="relative" style={{ height: bodyH }}>
        <canvas
          ref={bodyRef}
          role="img"
          aria-label={`Heatmap: ${order.length} drugs by ${nP} pathways, coloured by ${
            mode === 'dir' ? 'dominant direction and activity' : 'significant fraction'
          }, at q < 0.05. The drug list below carries the same rows as links.`}
          className="absolute left-0 top-0 cursor-pointer"
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          onClick={onClick}
        />
        {/* The canvas cannot be focused or read. This mirrors its row order as
            real links so keyboard and screen-reader users can still identify
            and open every drug in the current ordering. */}
        <ul className="sr-only">
          {order.map((oi, r) => {
            const d = summary.drugs[oi];
            return (
              <li key={d.slug}>
                <a href={`#/drug/${encodeURIComponent(d.slug)}`}>
                  {r + 1}. {nameBySlug.get(d.slug) ?? d.slug}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
