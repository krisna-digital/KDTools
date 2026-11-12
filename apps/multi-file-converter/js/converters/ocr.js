// Optional client-side OCR (Tesseract.js, loaded only when needed and only if bundled in vendor/).
// Output uses the same item shape as getPageText() so the rest of the pipeline is identical.

import { getTesseract, hasLib, vendorUrl } from '../core/loader.js';
import { ConverterError, ERR } from '../core/errors.js';
import { onDispose } from '../core/cleanup.js';

let workerPromise = null;
let currentLang = null;

export async function ocrAvailable() { return hasLib('tesseract'); }

export async function ocrLanguages() {
  const m = await (await import('../core/loader.js')).getManifest();
  return m.languages?.length ? m.languages : [];
}

async function getWorker(lang) {
  if (workerPromise && currentLang === lang) return workerPromise;
  await disposeOcr();
  const T = await getTesseract();
  currentLang = lang;
  workerPromise = T.createWorker(lang, 1, {
    workerPath: vendorUrl('tesseract/worker.min.js'),
    corePath: vendorUrl('tesseract/core/'),
    langPath: vendorUrl('tesseract/lang/'),
    workerBlobURL: false,
    gzip: true,
  }).catch((e) => { workerPromise = null; throw new ConverterError(ERR.FAILED, `OCR engine could not start: ${e?.message || e}`, { cause: e }); });
  return workerPromise;
}

export async function disposeOcr() {
  if (!workerPromise) return;
  try { (await workerPromise).terminate(); } catch { /* ignore */ }
  workerPromise = null; currentLang = null;
}
onDispose(disposeOcr);

/**
 * @param {OffscreenCanvas} canvas  page rendered at ocrScale x 72 dpi
 * @param {number} scale            canvas pixels per PDF point
 * @param {number} pageHeight       page height in points
 */
export async function ocrCanvas(canvas, scale, lang = 'eng') {
  const worker = await getWorker(lang);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const { data } = await worker.recognize(blob, {}, { blocks: true });
  const items = [];
  for (const block of data.blocks || []) for (const para of block.paragraphs || []) for (const line of para.lines || []) {
    for (const w of line.words || []) {
      const { x0, y0, x1, y1 } = w.bbox;
      if (!w.text?.trim() || w.confidence < 30) continue;
      const hPt = (y1 - y0) / scale;
      items.push({
        str: w.text + ' ', x: x0 / scale, y: y1 / scale - hPt * 0.2, w: (x1 - x0) / scale, h: hPt, size: hPt * 0.85,
        bold: !!w.is_bold, italic: !!w.is_italic, mono: false, vertical: false, eol: false,
      });
    }
  }
  return items;
}
