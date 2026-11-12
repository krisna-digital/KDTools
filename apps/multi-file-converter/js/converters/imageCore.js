// Pixel pipeline shared by the main thread and the image worker (no DOM access here).
// decoded image -> resize -> background -> encode (+ DPI metadata)

import { ConverterError, ERR } from '../core/errors.js';

export const MAX_PIXELS = 120e6; // ~11k x 11k. Larger canvases fail in most browsers.

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function computeSize(w, h, o = {}) {
  const mode = o.resizeMode || 'none';
  let tw = w, th = h;
  if (mode === 'percent') {
    const f = Math.max(1, Number(o.percent) || 100) / 100;
    tw = w * f; th = h * f;
  } else if (mode === 'fit') {
    // fit inside a width x height box, keep aspect ratio
    const bw = Number(o.width) || 0, bh = Number(o.height) || 0;
    if (bw || bh) {
      const f = Math.min(bw ? bw / w : Infinity, bh ? bh / h : Infinity);
      tw = w * f; th = h * f;
    }
  } else if (mode === 'exact') {
    const bw = Number(o.width) || 0, bh = Number(o.height) || 0;
    if (o.keepAspect !== false) {
      if (bw && !bh) { tw = bw; th = h * (bw / w); }
      else if (bh && !bw) { th = bh; tw = w * (bh / h); }
      else if (bw && bh) { tw = bw; th = bh; }
    } else {
      tw = bw || w; th = bh || h;
    }
  }
  if (o.noUpscale && (tw > w || th > h)) { tw = w; th = h; }
  return { width: Math.max(1, Math.round(tw)), height: Math.max(1, Math.round(th)) };
}

/**
 * @param {ImageBitmap|ImageData-like} source ImageBitmap (has width/height)
 * @param {string} target  'jpg' | 'png' | 'webp'
 * @param {object} o       conversion options
 * @returns {Promise<Blob>}
 */
export async function encodeBitmap(source, target, o = {}) {
  const type = TYPES[target];
  if (!type) throw new ConverterError(ERR.UNSUPPORTED, `Cannot encode ${target}`);
  const { width, height } = computeSize(source.width, source.height, o);
  if (width * height > MAX_PIXELS) {
    throw new ConverterError(ERR.MEMORY, `The output would be ${width}×${height} px. Use a smaller size (resize) to stay under ${Math.round(MAX_PIXELS / 1e6)} megapixels.`);
  }
  let canvas;
  try {
    canvas = new OffscreenCanvas(width, height);
  } catch (e) {
    throw new ConverterError(ERR.MEMORY, 'Could not allocate an image of that size.', { cause: e });
  }
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new ConverterError(ERR.BROWSER, 'Canvas 2D is not available.');
  const needBackground = target === 'jpg' || target === 'jpeg' || o.flatten;
  if (needBackground) {
    ctx.fillStyle = o.background || '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);

  const quality = Math.min(1, Math.max(0.01, (Number(o.quality) || 90) / 100));
  let blob;
  try {
    blob = await canvas.convertToBlob(type === 'image/png' ? { type } : { type, quality });
  } catch (e) {
    throw new ConverterError(ERR.FAILED, `Encoding failed: ${e.message}`, { cause: e });
  }
  if (blob.type !== type) {
    throw new ConverterError(ERR.BROWSER, `This browser cannot encode ${target.toUpperCase()} images (it produced ${blob.type || 'an unknown type'}). Try Chrome, Edge or Firefox.`);
  }
  const dpi = Number(o.dpi) || 0;
  if (dpi > 0 && (type === 'image/png' || type === 'image/jpeg')) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const out = type === 'image/png' ? setPngDpi(bytes, dpi) : setJpegDpi(bytes, dpi);
    return new Blob([out], { type });
  }
  return blob;
}

// ---- DPI metadata ----

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Insert/replace the pHYs chunk of a PNG. */
export function setPngDpi(png, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21); // len(4) + type(4) + data(9) + crc(4)
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // strip existing pHYs, insert after IHDR (8 sig + 25 IHDR)
  const parts = [png.subarray(0, 33), chunk];
  let p = 33;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (p + 12 <= png.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    if (type !== 'pHYs') parts.push(png.subarray(p, p + 12 + len));
    p += 12 + len;
  }
  return concat(parts);
}

/** Set the pixel density in the JFIF header of a JPEG (adds one if missing). */
export function setJpegDpi(jpg, dpi) {
  const d = Math.min(65535, Math.round(dpi));
  if (jpg[0] !== 0xff || jpg[1] !== 0xd8) return jpg;
  if (jpg[2] === 0xff && jpg[3] === 0xe0 && String.fromCharCode(...jpg.subarray(6, 10)) === 'JFIF') {
    const out = jpg.slice();
    out[13] = 1; out[14] = d >> 8; out[15] = d & 255; out[16] = d >> 8; out[17] = d & 255;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
  return concat([jpg.subarray(0, 2), app0, jpg.subarray(2)]);
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
