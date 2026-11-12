// ID Card Studio — render.js
// Jembatan browser: memuat gambar, menyiapkan canvas, memanggil layoutCard() + drawLayout().
// Dipakai IDENTIK oleh preview, PNG, dan PDF.

import { layoutCard, drawLayout, createCanvasMeasure, mmToPx, fontSpec, fontString } from './engine.js';

let measure = null;
export const getMeasure = () => (measure ||= createCanvasMeasure());

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => { try { await img.decode(); } catch { /* sudah termuat */ } resolve(img); };
    img.onerror = () => reject(new Error('Gambar gagal dimuat.'));
    img.src = src;
  });
}

/** Pastikan font yang dipakai field sudah siap sebelum mengukur/menggambar. */
export async function ensureFonts(cfg) {
  if (!document.fonts || !document.fonts.load) return;
  const specs = new Map();
  for (const f of cfg.fields) if (f.type === 'text') specs.set(fontString(fontSpec(f), 16), true);
  await Promise.all([...specs.keys()].map((k) => document.fonts.load(k, 'AaBb0123').catch(() => {})));
}

/**
 * @param photo {img, pxW, pxH, zoom, ox, oy} | null
 * @returns layout (untuk indikator & hit-test)
 */
export function renderSide(canvas, { cfg, bg, data, photo }) {
  const layout = layoutCard(cfg, data, {
    measure: getMeasure(),
    photo: photo ? { pxW: photo.pxW, pxH: photo.pxH, zoom: photo.zoom, ox: photo.ox, oy: photo.oy } : null,
  });
  drawLayout(canvas.getContext('2d'), layout, { bg, photo: photo ? photo.img : null });
  return layout;
}

export function makeCanvas(cfg, { dpi = null, cssWidthPx = null, dpr = 1 } = {}) {
  const c = document.createElement('canvas');
  sizeCanvas(c, cfg, { dpi, cssWidthPx, dpr });
  return c;
}

export function sizeCanvas(c, cfg, { dpi = null, cssWidthPx = null, dpr = 1 } = {}) {
  const w = dpi ? mmToPx(cfg.size.widthMm, dpi) : cssWidthPx * dpr;
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(w * (cfg.size.heightMm / cfg.size.widthMm)));
  return c;
}
