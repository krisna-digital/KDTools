// PRINTLAY — templates.js
// Template kartu berbingkai (saat ini: Polaroid 2R). Modul murni tanpa DOM, dapat diuji dengan Node.
//
// Konsep: template menentukan ukuran kartu (= "desain" yang disusun optimizer) dan sebuah "jendela foto"
// di dalam kartu. Foto selalu diisikan ke jendela dengan mode COVER (zoom-in lalu dipotong), sehingga
// rasio asli foto tidak pernah diubah (tidak gepeng / lonjong).

import { parseNumber } from './calculator.js';

/** Kertas foto 2R = 2,5 × 3,5 inch. */
export const CARD_2R = { w: 63.5, h: 88.9 };

/** Border bawaan (mm). Bawah lebih tebal, khas Polaroid. */
export const POLAROID_DEFAULTS = { side: 4, top: 4, bottom: 14 };

/** Ukuran minimum jendela foto (mm) agar template masih masuk akal. */
export const MIN_WINDOW_MM = 10;

/**
 * Orientasi kartu: 'portrait' / 'landscape' dipaksa; 'auto' mengikuti foto.
 * Foto persegi atau belum ada foto → potret.
 */
export function resolveCardOrientation(mode, art) {
  if (mode === 'portrait' || mode === 'landscape') return mode;
  return art && art.pxW > art.pxH ? 'landscape' : 'portrait';
}

/**
 * @param opts {orientation:'portrait'|'landscape', side, top, bottom} dalam mm (angka atau string)
 * @returns {ok, errors, template}
 *   template = {id, name, orientation, cardW, cardH, window:{x,y,w,h}, border:{side,top,bottom}}
 *   Koordinat window relatif terhadap pojok kiri-atas kartu (tidak dirotasi), border bawah tetap di bawah.
 */
export function buildPolaroid2R({ orientation = 'portrait', side, top, bottom } = {}) {
  const errors = [];
  const nonNeg = (v, label) => {
    const n = parseNumber(v);
    if (!Number.isFinite(n)) { errors.push(`${label} kosong atau bukan angka.`); return NaN; }
    if (n < 0) { errors.push(`${label} tidak boleh negatif.`); return NaN; }
    return n;
  };
  const s = nonNeg(side, 'Border samping');
  const t = nonNeg(top, 'Border atas');
  const b = nonNeg(bottom, 'Border bawah');
  if (errors.length) return { ok: false, errors, template: null };

  const landscape = orientation === 'landscape';
  const cardW = landscape ? CARD_2R.h : CARD_2R.w;
  const cardH = landscape ? CARD_2R.w : CARD_2R.h;
  const win = { x: s, y: t, w: cardW - 2 * s, h: cardH - t - b };
  if (win.w < MIN_WINDOW_MM || win.h < MIN_WINDOW_MM) {
    return {
      ok: false,
      errors: [`Border terlalu tebal: jendela foto hanya ${Math.max(0, win.w).toFixed(1)} × ${Math.max(0, win.h).toFixed(1)} mm (minimal ${MIN_WINDOW_MM} mm).`],
      template: null,
    };
  }
  return {
    ok: true,
    errors: [],
    template: {
      id: 'polaroid-2r',
      name: 'Polaroid 2R',
      orientation: landscape ? 'landscape' : 'portrait',
      cardW, cardH,
      window: win,
      border: { side: s, top: t, bottom: b },
    },
  };
}

/** Ukuran minimum sisi kotak pada mode Foto Kustom (mm). */
export const MIN_BATCH_MM = 5;

/**
 * Template "Foto Kustom": tiap foto mengisi satu kotak berukuran bebas, tanpa tepi putih
 * (jendela foto = seluruh kotak). Sama seperti Polaroid, orientasi kotak dapat mengikuti foto:
 * kotak lanskap hanyalah kotak potret yang diputar 90°.
 * @param opts {w, h (mm, urutan bebas), orientation}
 */
export function buildBatchTemplate({ w, h, orientation = 'portrait' } = {}) {
  const errors = [];
  if (!Number.isFinite(w) || !Number.isFinite(h)) errors.push('Ukuran kotak foto kosong atau bukan angka.');
  else if (w < MIN_BATCH_MM || h < MIN_BATCH_MM) errors.push(`Ukuran kotak foto minimal ${MIN_BATCH_MM} mm per sisi.`);
  if (errors.length) return { ok: false, errors, template: null };
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  const landscape = orientation === 'landscape';
  const cardW = landscape ? long : short;
  const cardH = landscape ? short : long;
  return {
    ok: true,
    errors: [],
    template: {
      id: 'photo-batch', name: 'Foto Kustom', orientation: landscape ? 'landscape' : 'portrait',
      cardW, cardH, short, long,
      window: { x: 0, y: 0, w: cardW, h: cardH },
      border: { side: 0, top: 0, bottom: 0 },
    },
  };
}

/** Varian template dasar untuk orientasi tertentu (dipakai per foto). */
export function variantFor(base, orientation) {
  if (!base) return null;
  if (base.id === 'photo-batch') return buildBatchTemplate({ w: base.short, h: base.long, orientation }).template;
  return buildPolaroid2R({ orientation, ...base.border }).template;
}

/**
 * Memetakan persegi dari bingkai lokal kartu ke kertas.
 * Penempatan yang dirotasi diputar 90° searah jarum jam (sama dengan transform SVG
 * translate(x + w, y) rotate(90)): titik lokal (u, v) → kertas (x + w − v, y + u).
 * @param slot  {x,y,w,h} persegi penempatan pada kertas
 */
export function mapRect(slot, rect, rotated) {
  if (!rotated) return { x: slot.x + rect.x, y: slot.y + rect.y, w: rect.w, h: rect.h };
  return { x: slot.x + slot.w - (rect.y + rect.h), y: slot.y + rect.x, w: rect.h, h: rect.w };
}

/** Posisi jendela foto pada kertas untuk satu penempatan (memakai p.rotated). */
export function windowOnPaper(p, win) {
  return mapRect(p, win, !!p.rotated);
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Posisi & ukuran foto di dalam jendela (koordinat lokal kartu), mode cover + penyesuaian manual.
 * zoom = 1 → tepat cover (jendela terisi penuh); zoom > 1 → diperbesar (tidak pernah di bawah cover,
 * sehingga tidak ada area kosong). ox/oy ∈ [0,1] = posisi geser (0,5 = tengah).
 * Rasio foto selalu dipertahankan: w/h = pxW/pxH.
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
