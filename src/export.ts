// export.ts — download an on-page SVG as a standalone figure file (for
// manuscripts/slides). Clones the node, inlines the font and background.
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
