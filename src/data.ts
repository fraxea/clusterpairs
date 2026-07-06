// data.ts — fetch the precomputed JSON served from public/data/.
// Run build_frontend_data.py with out_dir = <app>/public/data to populate it.

import type { Manifest, DrugData, DrugMeta } from './types';

// Vite serves public/ at BASE_URL. If you deploy under a sub-path, this still
// resolves correctly. (import.meta cast avoids needing vite/client types here.)
const BASE = (((import.meta as unknown) as { env?: { BASE_URL?: string } }).env?.BASE_URL) ?? '/';
export const DATA_BASE = `${BASE}data/`;

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(`${DATA_BASE}manifest.json`);
  if (!res.ok) throw new Error(`Could not load manifest.json (${res.status}). Did you run build_frontend_data.py into public/data?`);
  return (await res.json()) as Manifest;
}

const drugCache = new Map<string, DrugData>();

export async function loadDrug(meta: DrugMeta): Promise<DrugData> {
  const cached = drugCache.get(meta.slug);
  if (cached) return cached;
  const res = await fetch(`${DATA_BASE}${meta.file}`);
  if (!res.ok) throw new Error(`Could not load ${meta.name} (${res.status}).`);
  const data = (await res.json()) as DrugData;
  drugCache.set(meta.slug, data);
  return data;
}

export async function loadAllDrugs(
  metas: DrugMeta[],
  onProgress?: (done: number, total: number) => void,
): Promise<Array<{ meta: DrugMeta; data: DrugData }>> {
  const out: Array<{ meta: DrugMeta; data: DrugData }> = [];
  for (let i = 0; i < metas.length; i += 1) {
    const data = await loadDrug(metas[i]);
    out.push({ meta: metas[i], data });
    onProgress?.(i + 1, metas.length);
  }
  return out;
}
