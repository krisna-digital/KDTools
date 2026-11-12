// Lazy loading of third-party libraries from ./vendor (same origin, relative paths -> GitHub Pages friendly).
// Nothing heavy is loaded until a converter that needs it actually runs.

import { ConverterError, ERR } from './errors.js';

export const VENDOR_URL = new URL('../../vendor/', import.meta.url);
export const ASSETS_URL = new URL('../../assets/', import.meta.url);
export const vendorUrl = (p) => new URL(p, VENDOR_URL).href;
export const assetUrl = (p) => new URL(p, ASSETS_URL).href;

const LIB_LABELS = {
  pdfjs: 'PDF.js', pdflib: 'pdf-lib', fontkit: 'fontkit', jszip: 'JSZip', pptxgen: 'PptxGenJS', docx: 'docx',
  pako: 'pako', utif: 'UTIF (TIFF decoder)', heic: 'heic2any (HEIC decoder)', ffmpeg: 'FFmpeg.wasm', tesseract: 'Tesseract.js (OCR)',
};
export const libLabel = (id) => LIB_LABELS[id] || id;

let manifestPromise = null;
export function getManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(vendorUrl('manifest.json'), { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : { libs: {} }))
      .catch(() => ({ libs: {} }));
  }
  return manifestPromise;
}

export async function hasLib(id) {
  const m = await getManifest();
  return !!m.libs?.[id];
}

export async function missingLibs(ids = []) {
  const m = await getManifest();
  return ids.filter((id) => !m.libs?.[id]);
}

async function requireLib(id) {
  if (!(await hasLib(id))) {
    throw new ConverterError(ERR.LIB_MISSING,
      `${libLabel(id)} is not included in this build. Run "npm install && npm run vendor" and redeploy.`, { retryable: false });
  }
}

const scriptCache = new Map();
function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptCache.delete(src); reject(new ConverterError(ERR.FAILED, `Could not load ${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return scriptCache.get(src);
}

const cache = new Map();
function once(id, fn) {
  if (!cache.has(id)) {
    cache.set(id, (async () => { await requireLib(id); return fn(); })().catch((e) => { cache.delete(id); throw e; }));
  }
  return cache.get(id);
}

export const getPdfjs = () => once('pdfjs', async () => {
  const lib = await import(/* @vite-ignore */ vendorUrl('pdfjs/pdf.min.mjs'));
  lib.GlobalWorkerOptions.workerSrc = vendorUrl('pdfjs/pdf.worker.min.mjs');
  return lib;
});

export const getPdfLib = () => once('pdflib', () => import(/* @vite-ignore */ vendorUrl('pdf-lib/pdf-lib.esm.min.js')));

/** fontkit is optional: without it only the 14 standard PDF fonts (Latin-1) can be used. */
export async function getFontkit() {
  if (!(await hasLib('fontkit'))) return null;
  return once('fontkit', async () => { await loadScript(vendorUrl('fontkit/fontkit.umd.min.js')); return globalThis.fontkit; });
}

export const getJSZip = () => once('jszip', async () => { await loadScript(vendorUrl('jszip/jszip.min.js')); return globalThis.JSZip; });
export const getPptxGen = () => once('pptxgen', async () => { await loadScript(vendorUrl('pptxgenjs/pptxgen.bundle.js')); return globalThis.PptxGenJS; });
export const getDocx = () => once('docx', async () => { await loadScript(vendorUrl('docx/docx.iife.js')); return globalThis.docx; });
export const getPako = () => once('pako', async () => { await loadScript(vendorUrl('pako/pako.min.js')); return globalThis.pako; });
export const getHeic = () => once('heic', async () => { await loadScript(vendorUrl('heic2any/heic2any.min.js')); return globalThis.heic2any; });
export const getUTIF = () => once('utif', async () => {
  if (await hasLib('pako')) await getPako();
  await loadScript(vendorUrl('utif/UTIF.js'));
  return globalThis.UTIF;
});
export const getTesseract = () => once('tesseract', async () => { await loadScript(vendorUrl('tesseract/tesseract.min.js')); return globalThis.Tesseract; });

let fontBytesCache = null;
/** Bundled Liberation fonts (SIL OFL). Returns bytes for regular/bold/italic/boldItalic/mono/monoBold. */
export async function getFontBytes() {
  if (!fontBytesCache) {
    const files = {
      regular: 'LiberationSans-Regular.ttf', bold: 'LiberationSans-Bold.ttf',
      italic: 'LiberationSans-Italic.ttf', boldItalic: 'LiberationSans-BoldItalic.ttf',
      mono: 'LiberationMono-Regular.ttf', monoBold: 'LiberationMono-Bold.ttf',
    };
    fontBytesCache = (async () => {
      const out = {};
      await Promise.all(Object.entries(files).map(async ([k, f]) => {
        const r = await fetch(assetUrl(`fonts/${f}`));
        if (!r.ok) throw new ConverterError(ERR.FAILED, `Missing bundled font ${f}`);
        out[k] = new Uint8Array(await r.arrayBuffer());
      }));
      return out;
    })().catch((e) => { fontBytesCache = null; throw e; });
  }
  return fontBytesCache;
}
