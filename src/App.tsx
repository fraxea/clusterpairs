// App.tsx — shell, hash routing, and boot loading (manifest + summary).
// Data is precomputed by build_frontend_data.py (+ scripts/build_summary.py)
// and served from public/data/.
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Manifest, Summary } from './types';
import { configureUnsignedStreams, loadManifest, loadSummary } from './data';
import { EmptyState, Spinner } from './ui';
import { setHashParams } from './format';
import { TooltipProvider } from './tooltip';
import { Home } from './pages/Home';
import { Atlas } from './pages/Atlas';
import { PathwaysIndex, PathwayPage } from './pages/Pathways';
import { DrugPage } from './pages/DrugPage';
import { Rank } from './pages/Rank';
import { Correlate } from './pages/Correlate';
import { Connect } from './pages/Connect';
import { Consensus } from './pages/Consensus';
import { Guide } from './pages/Guide';
import { Heterogeneity } from './pages/Heterogeneity';
import { Figures } from './pages/Figures';

type Route =
  | { type: 'home' }
  | { type: 'atlas' }
  | { type: 'pathways' }
  | { type: 'pathway'; slug: string }
  | { type: 'drug'; slug: string }
  | { type: 'correlate' }
  | { type: 'connect' }
  | { type: 'consensus' }
  | { type: 'hetero' }
  | { type: 'figures' }
  | { type: 'guide' }
  | { type: 'rank' };

function parseRoute(hash: string): { route: Route; params: URLSearchParams } {
  const h = hash.replace(/^#\/?/, '');
  const qIdx = h.indexOf('?');
  const path = qIdx >= 0 ? h.slice(0, qIdx) : h;
  const params = new URLSearchParams(qIdx >= 0 ? h.slice(qIdx + 1) : '');
  const route: Route = (() => {
    if (path === 'atlas') return { type: 'atlas' } as const;
    if (path === 'pathways') return { type: 'pathways' } as const;
    if (path === 'correlate' || path === 'correlation') return { type: 'correlate' } as const;
    if (path === 'connect' || path === 'connectivity') return { type: 'connect' } as const;
    if (path === 'consensus') return { type: 'consensus' } as const;
    if (path === 'hetero' || path === 'heterogeneity') return { type: 'hetero' } as const;
    if (path === 'figures') return { type: 'figures' } as const;
    if (path === 'guide' || path === 'docs' || path === 'help') return { type: 'guide' } as const;
    if (path === 'rank' || path === 'search') return { type: 'rank' } as const;
    if (path.startsWith('pathway/')) {
      const slug = decodeURIComponent(path.slice('pathway/'.length));
      if (slug) return { type: 'pathway', slug } as const;
    }
    if (path.startsWith('drug/')) {
      const slug = decodeURIComponent(path.slice('drug/'.length));
      if (slug) return { type: 'drug', slug } as const;
    }
    return { type: 'home' } as const;
  })();
  return { route, params };
}

const CUTOFF_KEY = 'tahoe.cutoff';
const validCutoff = (v: number): boolean => v >= 1e-6 && v <= 0.1;
/**
 * The threshold changes every number on a drug page, so a shared link must
 * carry it: the hash wins, localStorage is only the fallback for a fresh visit.
 */
function initialCutoff(params: URLSearchParams): number {
  const fromUrl = Number(params.get('q'));
  if (validCutoff(fromUrl)) return fromUrl;
  const stored = Number(window.localStorage.getItem(CUTOFF_KEY));
  return validCutoff(stored) ? stored : 0.05;
}

// 14px stroke icons for the nav — one small geometric mark per view.
function NavIcon({ kind }: { kind: string }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const };
  switch (kind) {
    case 'drugs': return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <rect x="1.6" y="5.4" width="12.8" height="5.2" rx="2.6" transform="rotate(-32 8 8)" {...s} />
        <line x1="6" y1="4.6" x2="10" y2="11.4" {...s} />
      </svg>);
    case 'atlas': return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        {[1.5, 6.25, 11].map((x) => [1.5, 6.25, 11].map((y) => (
          <rect key={`${x}${y}`} x={x} y={y} width="3.5" height="3.5" rx="0.8" fill="currentColor" opacity={x === y ? 1 : 0.45} />
        )))}
      </svg>);
    case 'pathways': return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <line x1="8" y1="2" x2="8" y2="14" {...s} opacity={0.4} />
        <line x1="8" y1="4" x2="14" y2="4" {...s} />
        <line x1="8" y1="8" x2="3" y2="8" {...s} />
        <line x1="8" y1="12" x2="12.5" y2="12" {...s} />
      </svg>);
    case 'correlate': return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <line x1="2.5" y1="13" x2="13.5" y2="3.5" {...s} opacity={0.55} />
        <circle cx="5" cy="9.5" r="1.6" fill="currentColor" />
        <circle cx="8.5" cy="10.5" r="1.6" fill="currentColor" />
        <circle cx="10.5" cy="5.5" r="1.6" fill="currentColor" />
      </svg>);
    case 'connect': return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <line x1="1.5" y1="8" x2="14.5" y2="8" {...s} opacity={0.4} />
        {[[2.5, 4.5], [5.5, 6], [8.5, 7.2]].map(([x, y]) => (
          <line key={x} x1={x} y1={8} x2={x} y2={y} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        ))}
        {[[11.5, 10], [13.8, 11.5]].map(([x, y]) => (
          <line key={x} x1={x} y1={8} x2={x} y2={y} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity={0.6} />
        ))}
      </svg>);
    case 'consensus': return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <path d="M1.5 13 C5 13 5.5 3 8 3 C10.5 3 11 13 14.5 13" {...s} />
      </svg>);
    case 'rank': return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        {[[2, 4], [6.2, 7], [10.4, 9.5]].map(([x, y]) => (
          <rect key={x} x={x} y={y} width="3.2" height={13.5 - y} rx="0.8" fill="currentColor" opacity={x === 2 ? 1 : 0.55} />
        ))}
      </svg>);
    case 'hetero': return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <rect x="1.5" y="4" width="5" height="8" rx="1.2" fill="currentColor" opacity={0.5} />
        <rect x="9.5" y="1.5" width="5" height="6" rx="1.2" fill="currentColor" />
        <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" fill="currentColor" opacity={0.75} />
      </svg>);
    case 'figures': return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <rect x="1.8" y="2.5" width="12.4" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="5.6" cy="6.2" r="1.3" fill="currentColor" />
        <path d="M3.5 11.5 L7 8.4 L9.4 10.4 L12.5 7.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>);
    case 'guide': return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <path d="M8 3.5 C6.5 2.3 4 2.3 2 3.2 V12.8 C4 11.9 6.5 11.9 8 13.1 C9.5 11.9 12 11.9 14 12.8 V3.2 C12 2.3 9.5 2.3 8 3.5 Z" {...s} />
        <line x1="8" y1="3.8" x2="8" y2="12.8" {...s} opacity={0.5} />
      </svg>);
    default: return null;
  }
}

function NavItem({ href, active, icon, children }: {
  href: string; active: boolean; icon: string; children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition ${
        active ? 'bg-stone-900 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-200/70 hover:text-stone-900'}`}
    >
      <NavIcon kind={icon} />
      {children}
    </a>
  );
}

function Shell({ route, children }: { route: Route; children: ReactNode }) {
  // Publish the real header height as --hdr; the Landscape's sticky label band
  // reads it, so the band still lands flush when the nav wraps to two rows.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--hdr', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    // No min-w-fit here: it applied to every route and made ordinary pages
    // (headings, prose) wider than the viewport on small screens. The one
    // genuinely wide view — the Landscape matrix — owns its own scroller.
    <div className="min-h-screen bg-[#f7f7f5] text-stone-900">
      {/* signature hairline: the four data colors */}
      <div className="h-[3px] w-full" style={{
        background: 'linear-gradient(to right, #bc3a30 0 25%, #2a78d6 25% 50%, #6c55bd 50% 75%, #7b786f 75% 100%)',
      }} />
      <header ref={headerRef} className="sticky top-0 z-10 border-b border-stone-200 bg-[#f7f7f5]/92 backdrop-blur">
        <div className="mx-auto flex min-h-[3.5rem] max-w-[90rem] flex-wrap items-center gap-x-4 gap-y-1 px-5 py-1.5">
          <a href="#/" className="flex items-center gap-2.5 pr-2">
            <LogoMark />
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight text-stone-900">Tahoe</span>
              <span className="block text-[10px] leading-none text-stone-600">drug–pathway atlas</span>
            </span>
          </a>
          <nav className="flex flex-wrap items-center gap-0.5">
            <NavItem href="#/" icon="drugs" active={route.type === 'home' || route.type === 'drug'}>Drugs</NavItem>
            <NavItem href="#/atlas" icon="atlas" active={route.type === 'atlas'}>Landscape</NavItem>
            <NavItem href="#/pathways" icon="pathways" active={route.type === 'pathways' || route.type === 'pathway'}>Pathways</NavItem>
            <span className="mx-1.5 h-5 w-px bg-stone-300/80" aria-hidden />
            <NavItem href="#/correlate" icon="correlate" active={route.type === 'correlate'}>Correlate</NavItem>
            <NavItem href="#/connect" icon="connect" active={route.type === 'connect'}>Connect</NavItem>
            <NavItem href="#/consensus" icon="consensus" active={route.type === 'consensus'}>Consensus</NavItem>
            <NavItem href="#/hetero" icon="hetero" active={route.type === 'hetero'}>Heterogeneity</NavItem>
            <NavItem href="#/rank" icon="rank" active={route.type === 'rank'}>Rank</NavItem>
            <span className="mx-1.5 h-5 w-px bg-stone-300/80" aria-hidden />
            <NavItem href="#/figures" icon="figures" active={route.type === 'figures'}>Figures</NavItem>
            <NavItem href="#/guide" icon="guide" active={route.type === 'guide'}>Guide</NavItem>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-7">{children}</main>
      <footer className="mx-auto max-w-7xl px-5 pb-8 pt-2 text-[11px] text-stone-600">
        Pathway enrichment atlas · significance is BH-adjusted per stream · cross-drug views use the fixed
        reference cutoff q &lt; 0.05; drug pages and Rank carry their own live threshold ·{' '}
        <a href="#/guide" className="text-emerald-700 hover:text-emerald-800">guide</a>
      </footer>
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden>
      <rect x="1" y="1" width="8" height="8" rx="2" fill="#bc3a30" />
      <rect x="11" y="1" width="8" height="8" rx="2" fill="#2a78d6" />
      <rect x="1" y="11" width="8" height="8" rx="2" fill="#6c55bd" />
      <rect x="11" y="11" width="8" height="8" rx="2" fill="#d4d2ca" />
    </svg>
  );
}

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [{ route, params }, setRoute] = useState(() => parseRoute(window.location.hash));
  const [cutoff, setCutoffRaw] = useState(() => initialCutoff(params));
  const deferredCutoff = useDeferredValue(cutoff);

  const setCutoff = (c: number) => {
    setCutoffRaw(c);
    window.localStorage.setItem(CUTOFF_KEY, String(c));
    // only the two views that own the slider carry q in their link
    setHashParams({ q: Math.abs(c - 0.05) < 1e-9 ? null : String(c) });
  };

  useEffect(() => {
    loadManifest().then((m) => {
      // ORA's sign field is meaningless (+1 on every record) — mask it to
      // unsigned in every drug file before any view reads it.
      configureUnsignedStreams(m.streams.flatMap((s, i) => (s[0] === 'ora' ? [i] : [])));
      setManifest(m);
    }).catch((e) => setLoadErr(String(e)));
    // summary is an enhancement layer — the app degrades without it
    loadSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Start each page at the top (param-only tweaks use replaceState and don't
  // pass through here, so tab/stream changes keep their scroll position).
  const routeKey = `${route.type}:${'slug' in route ? route.slug : ''}`;
  useEffect(() => { window.scrollTo(0, 0); }, [routeKey]);

  // Route-aware document titles for history and shared tabs.
  useEffect(() => {
    const base = 'Tahoe atlas';
    const name = route.type === 'drug'
      ? manifest?.drugs.find((d) => d.slug === route.slug)?.name
      : route.type === 'pathway' ? route.slug.replace(/-/g, ' ')
        : route.type === 'atlas' ? 'landscape'
          : route.type === 'pathways' ? 'pathways'
            : route.type === 'correlate' ? 'correlation'
            : route.type === 'connect' ? 'connectivity'
            : route.type === 'consensus' ? 'consensus'
            : route.type === 'hetero' ? 'heterogeneity'
            : route.type === 'figures' ? 'figures'
            : route.type === 'guide' ? 'guide'
              : route.type === 'rank' ? 'rank' : null;
    document.title = name ? `${name} · ${base}` : base;
  }, [route, manifest]);

  if (loadErr) {
    return (
      <TooltipProvider>
        <Shell route={route}>
          <EmptyState title="No data loaded" body={loadErr} />
          <p className="mt-3 text-sm text-stone-500">
            Generate it with <span className="font-mono">python build_frontend_data.py</span> (out_dir = public/data),
            then <span className="font-mono">python scripts/build_summary.py</span>, and reload.
          </p>
        </Shell>
      </TooltipProvider>
    );
  }
  if (!manifest) {
    return (
      <TooltipProvider>
        <Shell route={route}>
          <Spinner label="Loading manifest &hellip;" />
        </Shell>
      </TooltipProvider>
    );
  }

  const needsSummary = (page: ReactNode): ReactNode =>
    summary ? page : (
      <EmptyState
        title="This view needs summary.json"
        body="Run: python scripts/build_summary.py  (writes public/data/summary.json), then reload."
      />
    );

  return (
    <TooltipProvider>
      <Shell route={route}>
        {route.type === 'atlas' ? needsSummary(summary && <Atlas manifest={manifest} summary={summary} params={params} />)
          : route.type === 'pathways' ? needsSummary(summary && <PathwaysIndex manifest={manifest} summary={summary} />)
            : route.type === 'pathway' ? needsSummary(summary && <PathwayPage manifest={manifest} summary={summary} slug={route.slug} params={params} />)
              : route.type === 'correlate' ? needsSummary(summary && <Correlate key={params.toString()} manifest={manifest} summary={summary} params={params} />)
              : route.type === 'connect' ? needsSummary(summary && <Connect key={params.toString()} manifest={manifest} summary={summary} params={params} />)
              : route.type === 'consensus' ? needsSummary(summary && <Consensus manifest={manifest} summary={summary} />)
              : route.type === 'hetero' ? <Heterogeneity manifest={manifest} params={params} />
              : route.type === 'figures' ? needsSummary(summary && <Figures manifest={manifest} summary={summary} />)
              : route.type === 'guide' ? <Guide manifest={manifest} summary={summary} />
              : route.type === 'drug' ? (
                <DrugPage key={route.slug} manifest={manifest} summary={summary} slug={route.slug} cutoff={deferredCutoff} setCutoff={setCutoff} params={params} />
              )
                : route.type === 'rank' ? <Rank manifest={manifest} summary={summary} cutoff={deferredCutoff} setCutoff={setCutoff} params={params} />
                  : <Home manifest={manifest} summary={summary} />}
      </Shell>
    </TooltipProvider>
  );
}
