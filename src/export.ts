// export.ts: download on-page SVGs as standalone figure files and data
// tables as CSV (for manuscripts, slides, and supplementary material).

/** RFC-4180-ish CSV download. Rows share the keys of the first row. */
export function downloadCsv(rows: Array<Record<string, string | number | null | undefined>>, filename: string): void {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: string | number | null | undefined): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const blob = new Blob(['\ufeff', body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
export function downloadSvg(el: SVGSVGElement | null, filename: string): void {
  if (!el) return;
  const clone = el.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('style', 'background:#ffffff;font-family:system-ui,-apple-system,sans-serif');
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}
