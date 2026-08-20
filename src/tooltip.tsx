/* eslint-disable react-refresh/only-export-components -- provider + hook + helper */
// tooltip.tsx: one shared tooltip layer. Cells bind it with tipBind(), which
// wires hover AND keyboard focus, so the numbers the tooltip carries (q-values,
// tau, per-cluster percentages) are reachable without a mouse. The tooltip node
// is an aria-live region, so focusing a cell announces its reading.
import { createContext, useContext, useEffect, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactNode } from 'react';

/** Anchor: a pointer position, or an element to attach beside (focus). */
export type TipAnchor = { clientX: number; clientY: number } | Element;

interface TipState { x: number; y: number; content: ReactNode }
export interface TipApi {
  show: (anchor: TipAnchor, content: ReactNode) => void;
  hide: () => void;
}

const TipCtx = createContext<TipApi>({ show: () => undefined, hide: () => undefined });
export const useTip = (): TipApi => useContext(TipCtx);

const TIP_W = 300; const TIP_H = 190;

function place(anchor: TipAnchor): { x: number; y: number } {
  // element anchors sit just below-left of the element; pointer anchors follow
  // the cursor. Both are clamped into the viewport.
  let cx: number; let cy: number;
  if ('getBoundingClientRect' in anchor) {
    const r = anchor.getBoundingClientRect();
    cx = r.left; cy = r.bottom - 8;
  } else {
    cx = anchor.clientX; cy = anchor.clientY;
  }
  const x = cx + 14 + TIP_W > window.innerWidth ? cx - TIP_W - 10 : cx + 14;
  const y = cy + 16 + TIP_H > window.innerHeight ? cy - TIP_H : cy + 16;
  return { x: Math.max(6, x), y: Math.max(6, y) };
}

/**
 * Bind a cell to the tooltip for both hover and focus. `content` is a thunk so
 * the JSX is built only when the cell is read. Grids have thousands of cells
 * and must not construct tooltip nodes on every render.
 *
 * Pass `label` on non-interactive cells to give assistive tech the same reading
 * without needing the visual tooltip; it also makes the cell focusable.
 */
export function tipBind(tip: TipApi, content: () => ReactNode, label?: string) {
  return {
    onMouseMove: (e: MouseEvent) => tip.show(e, content()),
    onMouseLeave: () => tip.hide(),
    onFocus: (e: FocusEvent<Element>) => tip.show(e.currentTarget, content()),
    onBlur: () => tip.hide(),
    ...(label === undefined ? {} : { tabIndex: 0, 'aria-label': label }),
  };
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);
  // A hovered element that unmounts (route change, tab switch) never fires
  // mouseleave, which would leave its tooltip stranded on the next page.
  // Clear on any click (capture: before React swaps the tree) or navigation.
  useEffect(() => {
    const clear = () => setTip(null);
    window.addEventListener('click', clear, true);
    window.addEventListener('hashchange', clear);
    return () => {
      window.removeEventListener('click', clear, true);
      window.removeEventListener('hashchange', clear);
    };
  }, []);

  const [api] = useState<TipApi>(() => ({
    show: (anchor, content) => setTip({ ...place(anchor), content }),
    hide: () => setTip(null),
  }));
  return (
    <TipCtx.Provider value={api}>
      {children}
      {/* visual tooltip, hidden from AT: the live region below carries it */}
      {tip && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 max-w-[300px] rounded-md border border-stone-200 bg-white/98 px-3 py-2 text-xs text-stone-700 shadow-lg shadow-stone-900/10"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.content}
        </div>
      )}
      {/* permanently mounted so aria-live actually announces later changes */}
      <div role="status" aria-live="polite" className="sr-only">{tip?.content}</div>
    </TipCtx.Provider>
  );
}
