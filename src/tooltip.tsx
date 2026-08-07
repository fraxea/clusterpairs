/* eslint-disable react-refresh/only-export-components -- provider + hook pair */
// tooltip.tsx — one shared cursor-following tooltip layer. Cells call
// useTip().show(event, content) on mousemove; only the tooltip node re-renders.
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

interface TipState { x: number; y: number; content: ReactNode }
export interface TipApi {
  show: (e: { clientX: number; clientY: number }, content: ReactNode) => void;
  hide: () => void;
}

const TipCtx = createContext<TipApi>({ show: () => undefined, hide: () => undefined });
export const useTip = (): TipApi => useContext(TipCtx);

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);
  // A hovered element that unmounts (route change, tab switch) never fires
  // mouseleave, which would leave its tooltip stranded on the next page —
  // clear on any click (capture: before React swaps the tree) or navigation.
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
    show: (e, content) => {
      const W = 300; const H = 190;
      const x = e.clientX + 14 + W > window.innerWidth ? e.clientX - W - 10 : e.clientX + 14;
      const y = e.clientY + 16 + H > window.innerHeight ? e.clientY - H : e.clientY + 16;
      setTip({ x: Math.max(6, x), y: Math.max(6, y), content });
    },
    hide: () => setTip(null),
  }));
  return (
    <TipCtx.Provider value={api}>
      {children}
      {tip && (
        <div
          className="pointer-events-none fixed z-50 max-w-[300px] rounded-md border border-stone-200 bg-white/98 px-3 py-2 text-xs text-stone-700 shadow-lg shadow-stone-900/10"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.content}
        </div>
      )}
    </TipCtx.Provider>
  );
}
