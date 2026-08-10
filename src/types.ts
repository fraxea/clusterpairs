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

// ---- summary.json — emitted by scripts/build_summary.py --------------------
// Compact cross-drug aggregates at the fixed reference cutoff (q < 0.05),
// so global views never have to download the 240 MB of per-drug files.

export interface SummaryDrug {
  slug: string;
  n_ref: number;
  n_query: number;
  records: number;            // pairwise records across all streams
  sig: number;                // significant records at the reference cutoff
  per_stream_sig: number[];   // -> manifest.streams
  per_stream_tested: number[];
  tested: number[];           // per pathway (-> manifest.pathways)
  up: number[];               // significant, sign > 0
  down: number[];             // significant, sign < 0
  uns: number[];              // significant, unsigned (CellSpectra)
}

export interface Summary {
  generated: string;
  cutoff: number;             // the fixed reference cutoff (0.05)
  n_pathways: number;
  n_streams: number;
  totals: { records: number; sig: number; cluster_pairs: number };
  pathways: {
    drugs_hit: number[];
    up: number[];
    down: number[];
    uns: number[];
  };
  drugs: SummaryDrug[];
}

// ---- hetero.json — per-query-cluster tallies (scripts/build_summary.py) ----
export interface HeteroDrug {
  slug: string;
  clusters: string[];       // query cluster labels
  up: number[][];           // [cluster][pathway] significant-up counts
  down: number[][];
  tested: number[][];       // directional-stream records per cluster×pathway
}

export interface Hetero {
  generated: string;
  cutoff: number;
  streams_used: number[];   // manifest.streams indices (the signed streams)
  drugs: HeteroDrug[];
}

// ---- annotations.json — ChEMBL mechanisms (scripts/fetch_annotations.py) ----
export interface DrugAnnotation {
  chembl_id?: string;
  matched_name?: string;
  max_phase?: number | string | null;
  moa: string[];
  match: 'exact' | 'fuzzy' | 'none';
}
export type Annotations = Record<string, DrugAnnotation>;
