// Image converter: decode (native / SVG / HEIC / TIFF) -> worker (resize + encode).

import { ConverterError, ERR, throwIfAborted } from '../core/errors.js';
import { baseName, extOf, mimeFor } from '../core/format.js';
import { getHeic, getUTIF } from '../core/loader.js';
import { killWorker, trackWorker } from '../core/cleanup.js';
import { encodeBitmap } from './imageCore.js';

let worker = null;
let nextId = 1;
const pending = new Map();
let idleTimer = null;

function getWorker() {
  clearTimeout(idleTimer);
  if (worker) return worker;
  worker = trackWorker(new Worker(new URL('../workers/image.worker.js', import.meta.url), { type: 'module' }));
  worker.onmessage = (ev) => {
    const m = ev.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') { p.onProgress?.(m.value); return; }
    pending.delete(m.id);
    if (m.type === 'done') p.resolve(new Blob([m.buffer], { type: m.mime }));
    else p.reject(new ConverterError(m.code || ERR.FAILED, m.message));
    scheduleIdle();
  };
  worker.onerror = (e) => {
    for (const [, p] of pending) p.reject(new ConverterError(ERR.FAILED, e.message || 'Image worker crashed'));
    pending.clear();
    killWorker(worker); worker = null;
  };
  return worker;
}

function scheduleIdle() {
  clearTimeout(idleTimer);
  if (pending.size === 0) {
    idleTimer = setTimeout(() => { if (worker && pending.size === 0) { killWorker(worker); worker = null; } }, 4000);
  }
}

function workerEncode(payload, transfer, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const w = getWorker();
    const onAbort = () => {
      pending.delete(id);
      killWorker(w); if (worker === w) worker = null;
      reject(new ConverterError(ERR.CANCELLED));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      resolve: (b) => { signal?.removeEventListener('abort', onAbort); resolve(b); },
      reject: (e) => { signal?.removeEventListener('abort', onAbort); reject(e); },
      onProgress,
    });
    w.postMessage({ id, ...payload }, transfer);
  });
}

const canUseWorker = () => typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';

// ---------- decoders that must run on the main thread ----------

async function decodeSvg(file, options) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    throw new ConverterError(ERR.CORRUPT, 'The SVG is not valid XML.');
  }
  let w = parseFloat(root.getAttribute('width')) || 0;
  let h = parseFloat(root.getAttribute('height')) || 0;
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if ((!w || !h) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (w) h = w * vb[3] / vb[2]; else if (h) w = h * vb[2] / vb[3]; else { w = vb[2]; h = vb[3]; }
  }
  if (!w || !h) { w = 1024; h = 1024; }
  // make sure the browser has explicit dimensions to rasterize
  root.setAttribute('width', String(w)); root.setAttribute('height', String(h));
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const fixed = new XMLSerializer().serializeToString(root);

  const targetW = Math.max(1, Math.round(Number(options.svgWidth) || Math.max(w, 1024)));
  const targetH = Math.max(1, Math.round(h * targetW / w));
  const url = URL.createObjectURL(new Blob([fixed], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode().catch(() => { throw new ConverterError(ERR.CORRUPT, 'The browser could not render this SVG.'); });
    const c = new OffscreenCanvas(targetW, targetH);
    c.getContext('2d').drawImage(img, 0, 0, targetW, targetH);
    return await createImageBitmap(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeHeic(file) {
  const heic2any = await getHeic();
  let out;
  try {
    out = await heic2any({ blob: file, toType: 'image/png' });
  } catch (e) {
    throw new ConverterError(ERR.CORRUPT, `HEIC decoding failed (${e?.message || e?.code || 'unsupported variant'}).`, { cause: e });
  }
  const blob = Array.isArray(out) ? out[0] : out;
  return createImageBitmap(blob);
}

async function decodeTiff(file) {
  const UTIF = await getUTIF();
  const buf = await file.arrayBuffer();
  let ifds;
  try { ifds = UTIF.decode(buf); } catch (e) { throw new ConverterError(ERR.CORRUPT, 'The TIFF could not be parsed.', { cause: e }); }
  if (!ifds?.length) throw new ConverterError(ERR.CORRUPT, 'The TIFF contains no images.');
  UTIF.decodeImage(buf, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const { width, height } = ifds[0];
  if (!width || !height) throw new ConverterError(ERR.CODEC, 'This TIFF uses a compression/colour mode the decoder does not support.');
  return createImageBitmap(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4), width, height));
}

async function decodeMain(file, ext, options) {
  if (ext === 'svg') return decodeSvg(file, options);
  if (ext === 'heic') return decodeHeic(file);
  if (ext === 'tif' || ext === 'tiff') return decodeTiff(file);
  return null;
}

/** Convert one image file. Returns {outputs, warnings}. */
export async function convertImage({ file, tool, options, signal, onProgress }) {
  const ext = extOf(file.name);
  let target = typeof tool.resolveTarget === 'function' ? tool.resolveTarget(options, ext) : tool.to;
  if (target === 'jpeg') target = 'jpg';
  const warnings = [];
  throwIfAborted(signal);
  onProgress?.(0.05, 'Reading image…');

  let bitmap = null;
  try {
    bitmap = await decodeMain(file, ext, options);
  } catch (e) {
    if (e instanceof ConverterError) throw e;
    throw new ConverterError(ERR.CORRUPT, e.message, { cause: e });
  }
  throwIfAborted(signal);
  onProgress?.(0.3, 'Converting…');

  let blob;
  try {
    if (!bitmap) {
      if (canUseWorker()) {
        blob = await workerEncode({ file, target, options }, [], signal, (v) => onProgress?.(0.3 + v * 0.5));
      } else {
        const bm = await createImageBitmap(file);
        blob = await encodeBitmap(bm, target, options);
        bm.close?.();
      }
    } else if (canUseWorker()) {
      blob = await workerEncode({ bitmap, target, options }, [bitmap], signal, (v) => onProgress?.(0.3 + v * 0.5));
    } else {
      blob = await encodeBitmap(bitmap, target, options);
      bitmap.close?.();
    }
  } catch (e) {
    if (e instanceof ConverterError) throw e;
    if (e?.name === 'InvalidStateError' || /decode|source image/i.test(e?.message || '')) {
      throw new ConverterError(ERR.CORRUPT, 'The image could not be decoded (damaged file or format not supported by this browser).', { cause: e });
    }
    throw e;
  }

  if (target === 'jpg' && ['png', 'webp', 'gif', 'svg', 'heic', 'tif', 'tiff', 'bmp'].includes(ext)) {
    warnings.push('JPG has no transparency: transparent areas were filled with the background color.');
  }
  if (ext === 'gif') warnings.push('Animated GIFs: only the first frame is converted.');
  if (ext === 'tif' || ext === 'tiff') warnings.push('Multi-page TIFF: only the first page is converted.');

  onProgress?.(1, 'Done');
  return {
    outputs: [{ name: `${baseName(file.name)}.${target}`, blob, mime: mimeFor(target), kind: 'image' }],
    warnings,
  };
}

/** Small preview image for the file list. Returns a Blob or null. */
export async function makeThumbnail(file, size = 112) {
  const ext = extOf(file.name);
  try {
    if (['tif', 'tiff', 'heic'].includes(ext)) return null;
    if (ext === 'svg') return file;
    const bm = await createImageBitmap(file, { resizeWidth: size, resizeQuality: 'medium' });
    const c = new OffscreenCanvas(bm.width, bm.height);
    c.getContext('2d').drawImage(bm, 0, 0);
    bm.close?.();
    return await c.convertToBlob({ type: 'image/png' });
  } catch {
    return null;
  }
}
