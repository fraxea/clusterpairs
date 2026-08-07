// data.ts — fetch the precomputed JSON served from public/data/.
// Run build_frontend_data.py with out_dir = <app>/public/data, then
// scripts/build_summary.py, to populate it.

import type { Manifest, DrugData, DrugMeta, Summary } from './types';

// Vite serves public/ at BASE_URL. If you deploy under a sub-path, this still
// resolves correctly. (import.meta cast avoids needing vite/client types here.)
const BASE = (((import.meta as unknown) as { env?: { BASE_URL?: string } }).env?.BASE_URL) ?? '/';
export const DATA_BASE = `${BASE}data/`;

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(`${DATA_BASE}manifest.json`);
  if (!res.ok) throw new Error(`Could not load manifest.json (${res.status}). Did you run build_frontend_data.py into public/data?`);
  return (await res.json()) as Manifest;
}

export async function loadSummary(): Promise<Summary> {
  const res = await fetch(`${DATA_BASE}summary.json`);
  if (!res.ok) throw new Error(`Could not load summary.json (${res.status}). Run scripts/build_summary.py to generate it.`);
  return (await res.json()) as Summary;
}

// Streams whose `sign` field is meaningless (ORA emits +1 for every record
// even though over-representation has no direction). App.tsx configures this
// from the manifest before any drug file loads; loadDrug masks their signs to
// 0 so every downstream view treats them as unsigned.
let unsignedStreams = new Set<number>();
export function configureUnsignedStreams(streamIdx: number[]): void {
  unsignedStreams = new Set(streamIdx);
}

function maskUnsignedStreams(d: DrugData): DrugData {
  if (unsignedStreams.size === 0) return d;
  for (const cells of [d.pairwise, d.ovr]) {
    const { stream, sign } = cells;
    for (let k = 0; k < stream.length; k += 1) {
      if (sign[k] !== 0 && unsignedStreams.has(stream[k])) sign[k] = 0;
    }
  }
  return d;
}

// LRU cache of per-drug files (~600 KB each) so hover-prefetch and browsing
// can't accumulate toward the full 240 MB.
const CACHE_MAX = 30;
const drugCache = new Map<string, DrugData>();

export async function loadDrug(meta: DrugMeta, signal?: AbortSignal): Promise<DrugData> {
  const cached = drugCache.get(meta.slug);
  if (cached) {
    drugCache.delete(meta.slug); // refresh recency
    drugCache.set(meta.slug, cached);
    return cached;
  }
  const res = await fetch(`${DATA_BASE}${meta.file}`, { signal });
  if (!res.ok) throw new Error(`Could not load ${meta.name} (${res.status}).`);
  const data = maskUnsignedStreams((await res.json()) as DrugData);
  drugCache.set(meta.slug, data);
  if (drugCache.size > CACHE_MAX) {
    const oldest = drugCache.keys().next().value;
    if (oldest !== undefined) drugCache.delete(oldest);
  }
  return data;
}

/** Fire-and-forget warmup (hover prefetch). Swallows failures. */
export function prefetchDrug(meta: DrugMeta): void {
  void loadDrug(meta).catch(() => undefined);
}

/** Load every drug with bounded concurrency (results in manifest order). */
export async function loadAllDrugs(
  metas: DrugMeta[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Array<{ meta: DrugMeta; data: DrugData }>> {
  const out = new Array<{ meta: DrugMeta; data: DrugData }>(metas.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next; next += 1;
      if (i >= metas.length) return;
      out[i] = { meta: metas[i], data: await loadDrug(metas[i], signal) };
      done += 1;
      onProgress?.(done, metas.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, metas.length) }, worker));
  return out;
}
