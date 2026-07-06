// types.ts — mirrors the contract emitted by build_frontend_data.py
// manifest.json + drugs/<slug>.json. Indices in Cells reference the global
// manifest.pathways / manifest.streams and the drug's own cluster lists.

export type Stream = [string, string]; // [method, language]

export interface DrugMeta {
  name: string;
  slug: string;
  file: string;          // "drugs/<slug>.json"
  n_ref: number;
  n_query: number;
  streams_present: Stream[];
}

export interface Manifest {
  gene_set: string;
  pathways: string[];     // global pathway names; cell.pathway indexes this
  streams: Stream[];      // global stream order; cell.stream indexes this
  cutoff_default: number;
  generated: string;
  drugs: DrugMeta[];
}

// Columnar cell arrays (all the same length). Each i is one record.
export interface PairwiseCells {
  stream: number[];   // -> manifest.streams
  ref: number[];      // -> drug.ref_clusters
  query: number[];    // -> drug.query_clusters
  pathway: number[];  // -> manifest.pathways
  nlp: number[];      // -log10(padj), clipped
  sign: number[];     // +1 up / -1 down / 0 unsigned (CellSpectra)
}

export interface OvrCells {
  stream: number[];
  cond: number[];     // 0 = dmso (cluster -> ref_clusters), 1 = drug (-> query_clusters)
  cluster: number[];
  pathway: number[];
  nlp: number[];
  sign: number[];
}

export interface DrugData {
  drug: string;
  slug: string;
  ref_clusters: string[];
  query_clusters: string[];
  pairwise: PairwiseCells;
  ovr: OvrCells;
}
