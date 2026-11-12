// ID Card Studio — geometry.js
// Fungsi geometri murni (tanpa DOM) untuk menempatkan foto: cover tanpa distorsi, zoom, dan geser.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Menempatkan gambar di dalam bingkai (contain / cover), terpusat. */
export function computeFit(frameW, frameH, imgW, imgH, mode = 'contain') {
  const sx = frameW / imgW;
  const sy = frameH / imgH;
  const s = mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const w = imgW * s;
  const h = imgH * s;
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h, scale: s };
}

/**
 * Posisi & ukuran foto di dalam kotak (mode cover + penyesuaian manual).
 * zoom = 1 → tepat cover (kotak terisi penuh); zoom > 1 → diperbesar. ox/oy ∈ [0,1] = posisi geser (0,5 = tengah).
 * Rasio foto selalu dipertahankan: w/h = pxW/pxH, jadi tidak pernah gepeng atau lonjong.
 */
export function placePhoto(win, pxW, pxH, zoom = 1, ox = 0.5, oy = 0.5) {
  const z = clamp(Number.isFinite(zoom) ? zoom : 1, MIN_ZOOM, MAX_ZOOM);
  const s = Math.max(win.w / pxW, win.h / pxH) * z;
  const w = pxW * s;
  const h = pxH * s;
  const cx = clamp(Number.isFinite(ox) ? ox : 0.5, 0, 1);
  const cy = clamp(Number.isFinite(oy) ? oy : 0.5, 0, 1);
  return { x: win.x - (w - win.w) * cx, y: win.y - (h - win.h) * cy, w, h, scale: s, zoom: z, ox: cx, oy: cy };
}
