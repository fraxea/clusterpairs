// Rank.tsx — pick pathways, rank drugs by significant cluster-pair calls.
// Instant mode runs off summary.json (reference cutoff q < 0.05). The exact
// mode downloads every drug file and re-ranks at the live cutoff.
import { useMemo, useRef, useState } from 'react';
import type { Manifest, Summary } from '../types';
import { loadAllDrugs } from '../data';
import { rankDrugs, thrFromCutoff, type DrugRank } from '../significance';
import { ramp } from '../colors';
import { Chip, Spinner } from '../ui';
import { fmtCompact, streamLabel } from '../format';
import { useTip } from '../tooltip';

export function Rank({ manifest, summary, cutoff }: {
  manifest: Manifest; summary: Summary | null; cutoff: number;
}) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<number[]>([]); // pathway indices

  // exact mode — results carry the cutoff they were computed at, so a later
  // slider move can never relabel them; the banner re-offers a re-rank instead.
  const [exact, setExact] = useState<{ rows: DrugRank[]; at: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const tip = useTip();
  const offReference = Math.abs(cutoff - 0.05) > 1e-9;
  const exactStale = exact !== null && Math.abs(exact.at - cutoff) > 1e-9;

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const suggestions = useMemo(() => {
    const n = q.trim().toLowerCase();
    return manifest.pathways
      .map((name, idx) => ({ name, idx }))
      .filter((p) => !selectedSet.has(p.idx) && (n === '' || p.name.toLowerCase().includes(n)))
      .slice(0, 12);
  }, [manifest.pathways, q, selectedSet]);

  const nameBySlug = useMemo(
    () => new Map(manifest.drugs.map((d) => [d.slug, d.name])),
    [manifest.drugs],
  );

  // Instant ranking from the summary: score = significant records across the
  // selected pathways (stream × cluster-pair × pathway), split by direction.
  const instant = useMemo(() => {
    if (!summary || selected.length === 0) return [];
    return summary.drugs
      .map((d) => {
        let up = 0; let down = 0; let uns = 0;
        for (const p of selected) { up += d.up[p]; down += d.down[p]; uns += d.uns[p]; }
        return { d, up, down, uns, total: up + down + uns };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total
        || (nameBySlug.get(a.d.slug) ?? '').localeCompare(nameBySlug.get(b.d.slug) ?? ''))
      .slice(0, 30);
  }, [summary, selected, nameBySlug]);

  const runExact = () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const at = cutoff; // snapshot the inputs this run is valid for
    const thrNow = thrFromCutoff(at);
    setLoading(true); setProgress(0); setExact(null);
    loadAllDrugs(manifest.drugs, (done, total) => setProgress(done / total), ctrl.signal)
      .then((all) => {
        if (ctrl.signal.aborted) return; // selection changed mid-load — discard
        setExact({ rows: rankDrugs(all, selected, thrNow, manifest.streams.length).slice(0, 30), at });
      })
      .catch(() => undefined) // aborted or failed — stay in instant mode
      .finally(() => setLoading(false));
  };
  const discardExact = () => { abortRef.current?.abort(); setLoading(false); setExact(null); };

  const maxInstant = Math.max(1, ...instant.map((r) => r.total));
  const maxExact = exact ? Math.max(1, ...exact.rows.map((r) => r.total)) : 1;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Rank drugs by pathway</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-500">
        Drugs are ranked by how many (stream × cluster-pair) tests reach significance across the selected
        pathways. Instant results use the reference cutoff q &lt; 0.05.
      </p>

      <div className="mt-5 rounded-lg border border-stone-200 bg-white p-4">
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add pathways&hellip;"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-stone-500"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((p) => (
            <button key={p.idx} type="button" onClick={() => { setSelected((s) => [...s, p.idx]); setQ(''); discardExact(); }}
              className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-600 hover:border-stone-500">
              {p.name}
            </button>
          ))}
        </div>
        {selected.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {selected.map((idx) => (
              <Chip key={idx} onRemove={() => { setSelected((s) => s.filter((x) => x !== idx)); discardExact(); }}>
                {manifest.pathways[idx]}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {selected.length === 0 ? (
        <p className="mt-5 text-sm text-stone-500">Add one or more pathways to rank drugs.</p>
      ) : (
        <>
          {!loading && (exact ? exactStale : offReference) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {exact
                ? <>The slider moved to q &lt; {cutoff.toPrecision(2)}, but the exact results below were computed at q &lt; {exact.at.toPrecision(2)}.</>
                : <>The cutoff slider is at q &lt; {cutoff.toPrecision(2)}, but instant rankings use the reference cutoff q &lt; 0.05.</>}
              <button type="button" onClick={runExact}
                className="rounded-md border border-amber-300 bg-white px-2 py-1 font-medium text-amber-900 hover:border-amber-500">
                Re-rank exactly at q &lt; {cutoff.toPrecision(2)} (downloads ~240 MB)
              </button>
            </div>
          )}
          {loading && (
            <div className="mt-4 flex items-center gap-4">
              <Spinner label={`Loading all drugs… ${Math.round(progress * 100)}%`} />
              <button type="button" onClick={discardExact}
                className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-600 hover:border-stone-500">
                Cancel
              </button>
            </div>
          )}

          {exact ? (
            <div className="mt-5 space-y-2.5">
              <p className="text-xs text-stone-400">Exact ranking at q &lt; {exact.at.toPrecision(2)}, per stream:</p>
              {exact.rows.map((r, i) => (
                <div key={r.meta.slug} className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <a href={`#/drug/${encodeURIComponent(r.meta.slug)}`} className="text-sm font-medium text-stone-900 hover:underline">
                      <span className="mr-2 font-mono text-stone-400">{i + 1}</span>{r.meta.name}
                    </a>
                    <span className="font-mono text-sm tabular-nums text-stone-700">{fmtCompact(r.total)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-1">
                    {manifest.streams.map((s, si) => (
                      <StreamRow key={si} label={streamLabel(s)} value={r.perStream[si]} max={maxExact} />
                    ))}
                  </div>
                </div>
              ))}
              {exact.rows.length === 0 && (
                <p className="text-sm text-stone-500">No drug reaches significance for these pathways at q &lt; {exact.at.toPrecision(2)}.</p>
              )}
            </div>
          ) : instant.length > 0 ? (
            <div className="mt-5 space-y-2">
              {instant.map((r, i) => {
                const name = nameBySlug.get(r.d.slug) ?? r.d.slug;
                return (
                  <a
                    key={r.d.slug} href={`#/drug/${encodeURIComponent(r.d.slug)}`}
                    className="block rounded-lg border border-stone-200 bg-white px-3 py-2 hover:border-stone-400"
                    onMouseMove={(e) => tip.show(e, (
                      <div>
                        <div className="font-medium text-stone-900">{name}</div>
                        <div className="mt-0.5 font-mono text-[11px] tabular-nums">
                          <span style={{ color: '#bc3a30' }}>▲{r.up}</span>{' '}
                          <span style={{ color: '#2a78d6' }}>▼{r.down}</span>{' '}
                          <span style={{ color: '#6c55bd' }}>◆{r.uns}</span> significant tests
                        </div>
                      </div>
                    ))}
                    onMouseLeave={tip.hide}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-stone-900">
                        <span className="mr-2 font-mono text-stone-400">{i + 1}</span>{name}
                      </span>
                      <span className="font-mono text-sm tabular-nums text-stone-700">{fmtCompact(r.total)}</span>
                    </div>
                    <div className="mt-1.5 flex h-2 w-full gap-[2px] overflow-hidden rounded-[3px]">
                      <span style={{ width: `${(r.up / maxInstant) * 100}%`, background: ramp('up', 0.55) }} />
                      <span style={{ width: `${(r.down / maxInstant) * 100}%`, background: ramp('down', 0.55) }} />
                      <span style={{ width: `${(r.uns / maxInstant) * 100}%`, background: ramp('uns', 0.55) }} />
                    </div>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="mt-5 text-sm text-stone-500">
              {summary ? 'No drug reaches significance for these pathways at q < 0.05.' : 'summary.json missing — run scripts/build_summary.py.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function StreamRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <>
      <span className="font-mono text-xs text-stone-500">{label}</span>
      <div className="flex items-center gap-2">
        <div className="h-2.5 flex-1 rounded-[3px] bg-stone-100">
          <div className="h-full rounded-[3px] bg-stone-700" style={{ width: `${(value / max) * 100}%`, minWidth: value > 0 ? 2 : 0 }} />
        </div>
        <span className="w-10 text-right font-mono text-xs tabular-nums text-stone-500">{value}</span>
      </div>
    </>
  );
}
