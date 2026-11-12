// PDF -> JPG / PNG (page rendering with PDF.js) plus shared PDF loading helpers.

import { ConverterError, ERR, throwIfAborted } from '../core/errors.js';
import { baseName, pad, parsePageRange, mimeFor } from '../core/format.js';
import { getPdfjs, vendorUrl } from '../core/loader.js';

export async function openPdf(file, { signal, password } = {}) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data, password,
    cMapUrl: vendorUrl('pdfjs/cmaps/'), cMapPacked: true,
    standardFontDataUrl: vendorUrl('pdfjs/standard_fonts/'),
    wasmUrl: vendorUrl('pdfjs/wasm/'), iccUrl: vendorUrl('pdfjs/iccs/'),
    isEvalSupported: false, // never eval PDF-supplied code
    enableXfa: false,
  });
  signal?.addEventListener('abort', () => task.destroy(), { once: true });
  try {
    const doc = await task.promise;
    // Some pdf.js builds only expose destroy() on the loading task: normalise so callers can always use doc.destroy().
    if (typeof doc.destroy !== 'function') doc.destroy = () => task.destroy();
    return doc;
  } catch (e) {
    if (signal?.aborted) throw new ConverterError(ERR.CANCELLED);
    throw e;
  }
}

/** Largest canvas side that is safe on most browsers/devices. */
const MAX_SIDE = 16384;
const MAX_AREA = 120e6;

export function safeScale(page, dpi) {
  let scale = dpi / 72;
  const vp = page.getViewport({ scale: 1 });
  const w = vp.width * scale, h = vp.height * scale;
  const k = Math.min(1, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
  return { scale: scale * k, reduced: k < 1 };
}

export async function renderPage(page, dpi, { background = '#ffffff', transparent = false } = {}) {
  const { scale, reduced } = safeScale(page, dpi);
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!transparent) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return { canvas, reduced };
}

export async function pdfToImages({ file, tool, options: o, signal, onProgress }) {
  const target = tool.to === 'jpeg' ? 'jpg' : tool.to;
  onProgress?.(0.02, 'Opening PDF…');
  const pdf = await openPdf(file, { signal });
  const warnings = [];
  try {
    let pages;
    try { pages = parsePageRange(o.pages, pdf.numPages); } catch (e) { throw new ConverterError(ERR.FAILED, e.message, { retryable: false }); }
    const dpi = Number(o.dpi) || 150;
    const outputs = [];
    let reducedAny = false;
    const width = String(pdf.numPages).length;
    for (let i = 0; i < pages.length; i++) {
      throwIfAborted(signal);
      const n = pages[i];
      onProgress?.(0.05 + 0.9 * i / pages.length, `Rendering page ${n} of ${pdf.numPages}…`);
      const page = await pdf.getPage(n);
      const { canvas, reduced } = await renderPage(page, dpi, { background: o.background || '#ffffff', transparent: target === 'png' && o.transparent });
      reducedAny ||= reduced;
      const q = (Number(o.quality) || 90) / 100;
      const blob = await canvas.convertToBlob(target === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: q });
      page.cleanup();
      const name = pages.length === 1 && pdf.numPages === 1 ? `${baseName(file.name)}.${target}` : `${baseName(file.name)}-page-${pad(n, width)}.${target}`;
      outputs.push({ name, blob, mime: mimeFor(target), kind: 'image' });
    }
    if (reducedAny) warnings.push('Some pages were rendered at a lower DPI than requested because the image would exceed browser canvas limits.');
    onProgress?.(1);
    return { outputs, warnings };
  } finally {
    pdf.destroy();
  }
}
