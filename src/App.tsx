// App.tsx — shell, hash routing, and boot loading (manifest + summary).
// Data is precomputed by build_frontend_data.py (+ scripts/build_summary.py)
// and served from public/data/.
import { useDeferredValue, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Manifest, Summary } from './types';
import { configureUnsignedStreams, loadManifest, loadSummary } from './data';
import { CutoffSlider, EmptyState, NavLink, Spinner } from './ui';
import { TooltipProvider } from './tooltip';
import { Home } from './pages/Home';
import { Atlas } from './pages/Atlas';
import { PathwaysIndex, PathwayPage } from './pages/Pathways';
import { DrugPage } from './pages/DrugPage';
import { Rank } from './pages/Rank';

type Route =
  | { type: 'home' }
  | { type: 'atlas' }
  | { type: 'pathways' }
  | { type: 'pathway'; slug: string }
  | { type: 'drug'; slug: string }
  | { type: 'rank' };

function parseRoute(hash: string): { route: Route; params: URLSearchParams } {
  const h = hash.replace(/^#\/?/, '');
  const qIdx = h.indexOf('?');
  const path = qIdx >= 0 ? h.slice(0, qIdx) : h;
  const params = new URLSearchParams(qIdx >= 0 ? h.slice(qIdx + 1) : '');
  const route: Route = (() => {
    if (path === 'atlas') return { type: 'atlas' } as const;
    if (path === 'pathways') return { type: 'pathways' } as const;
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
function initialCutoff(): number {
  const v = Number(window.localStorage.getItem(CUTOFF_KEY));
  return v >= 1e-4 && v <= 0.1 ? v : 0.05;
}

function Shell({ route, cutoff, setCutoff, children }: {
  route: Route; cutoff: number; setCutoff: (c: number) => void; children: ReactNode;
}) {
  return (
    // min-w-fit: when a wide view (the atlas matrix) forces horizontal page
    // scroll, the background and header still span the full content width.
    <div className="min-h-screen min-w-fit bg-[#f7f7f5] text-stone-900">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-[#f7f7f5]/90 backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-x-4 py-1.5 px-5">
          <div className="flex items-center gap-5">
            <a href="#/" className="flex items-center gap-2.5">
              <LogoMark />
              <span className="flex items-baseline gap-2">
                <span className="text-sm font-semibold tracking-tight text-stone-900">Tahoe</span>
                <span className="hidden text-xs text-stone-400 md:inline">drug · pathway · cluster</span>
              </span>
            </a>
            <nav className="flex items-center gap-1">
              <NavLink href="#/" active={route.type === 'home' || route.type === 'drug'}>Drugs</NavLink>
              <NavLink href="#/atlas" active={route.type === 'atlas'}>Landscape</NavLink>
              <NavLink href="#/pathways" active={route.type === 'pathways' || route.type === 'pathway'}>Pathways</NavLink>
              <NavLink href="#/rank" active={route.type === 'rank'}>Rank</NavLink>
            </nav>
          </div>
          <CutoffSlider cutoff={cutoff} onChange={setCutoff} />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-7">{children}</main>
      <footer className="mx-auto max-w-7xl px-5 pb-8 pt-2 text-[11px] text-stone-400">
        Pathway enrichment atlas · significance is BH-adjusted per stream · global views use the fixed
        reference cutoff q &lt; 0.05; per-drug views follow the live slider.
      </footer>
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
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
  const [cutoff, setCutoffRaw] = useState(initialCutoff);
  const deferredCutoff = useDeferredValue(cutoff);

  const setCutoff = (c: number) => {
    setCutoffRaw(c);
    window.localStorage.setItem(CUTOFF_KEY, String(c));
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
            : route.type === 'rank' ? 'rank' : null;
    document.title = name ? `${name} · ${base}` : base;
  }, [route, manifest]);

  if (loadErr) {
    return (
      <TooltipProvider>
        <Shell route={route} cutoff={cutoff} setCutoff={setCutoff}>
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
        <Shell route={route} cutoff={cutoff} setCutoff={setCutoff}>
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
      <Shell route={route} cutoff={cutoff} setCutoff={setCutoff}>
        {route.type === 'atlas' ? needsSummary(summary && <Atlas manifest={manifest} summary={summary} />)
          : route.type === 'pathways' ? needsSummary(summary && <PathwaysIndex manifest={manifest} summary={summary} />)
            : route.type === 'pathway' ? needsSummary(summary && <PathwayPage manifest={manifest} summary={summary} slug={route.slug} />)
              : route.type === 'drug' ? (
                <DrugPage key={route.slug} manifest={manifest} summary={summary} slug={route.slug} cutoff={deferredCutoff} params={params} />
              )
                : route.type === 'rank' ? <Rank manifest={manifest} summary={summary} cutoff={deferredCutoff} />
                  : <Home manifest={manifest} summary={summary} />}
      </Shell>
    </TooltipProvider>
  );
}
