// PRINTLAY — calculator.js
// Konversi satuan, normalisasi input, statistik, info pesanan, dan helper kualitas artwork.
// Modul ini murni (tanpa DOM) sehingga dapat diuji dengan Node.

export const EPS = 1e-6;

export const UNIT_TO_MM = { mm: 1, cm: 10, in: 25.4 };

export const PAPER_PRESETS = [
  { id: 'A4', name: 'A4', w: 210, h: 297 },
  { id: 'A3', name: 'A3', w: 297, h: 420 },
  { id: 'A5', name: 'A5', w: 148, h: 210 },
  { id: 'A6', name: 'A6', w: 105, h: 148 },
  { id: 'F4', name: 'F4', w: 215, h: 330 },
  { id: 'Folio', name: 'Folio', w: 216, h: 330 },
  { id: 'A3+', name: 'A3+', w: 329, h: 483 },
  { id: 'Custom', name: 'Custom', w: 210, h: 297 },
];

const MAX_MM = 100000;

export function toMm(value, unit) {
  const f = UNIT_TO_MM[unit];
  if (!f) throw new Error(`Satuan tidak dikenal: ${unit}`);
  return value * f;
}

export function fromMm(value, unit) {
  const f = UNIT_TO_MM[unit];
  if (!f) throw new Error(`Satuan tidak dikenal: ${unit}`);
  return value / f;
}

export function parseNumber(s) {
  if (typeof s === 'number') return s;
  if (s === null || s === undefined) return NaN;
  const t = String(s).trim().replace(',', '.');
  if (t === '') return NaN;
  return Number(t);
}

export function formatMm(v, digits = 2) {
  return String(Number(Number(v).toFixed(digits)));
}

/** floor yang toleran terhadap error floating-point */
export function floorTol(v) {
  return Math.floor(v + 1e-9);
}

/** Jumlah grid sederhana (kolom × baris) pada ruang yang sudah "diperluas gap". */
export function gridCount(boxW, boxH, itemW, itemH) {
  if (itemW <= 0 || itemH <= 0) return 0;
  return floorTol(boxW / itemW) * floorTol(boxH / itemH);
}

/**
 * Grid sederhana terbaik (normal atau rotasi) — dipakai sebagai pembanding
 * dan sebagai validasi independen terhadap optimizer.
 */
export function simpleGridBest(cfg) {
  const { designW: w, designH: h, paperW, paperH, gapX: gx, gapY: gy, margins: m } = cfg;
  const bx = paperW - m.left - m.right + gx;
  const by = paperH - m.top - m.bottom + gy;
  const normal = gridCount(bx, by, w + gx, h + gy);
  const rotated = cfg.allowRotation === false ? 0 : gridCount(bx, by, h + gx, w + gy);
  return Math.max(normal, rotated);
}

export function orientPaper(w, h, orientation) {
  const lo = Math.min(w, h);
  const hi = Math.max(w, h);
  return orientation === 'landscape' ? [hi, lo] : [lo, hi];
}

/**
 * Validasi + normalisasi input mentah (string dari form) menjadi config dalam mm.
 * Mengembalikan { ok, errors, config }.
 */
export function normalizeInputs(raw) {
  const errors = [];
  const unit = raw.unit || 'mm';
  if (!UNIT_TO_MM[unit]) errors.push('Satuan ukuran tidak valid.');

  const pos = (val, label) => {
    const n = parseNumber(val);
    if (!Number.isFinite(n)) { errors.push(`${label} kosong atau bukan angka.`); return NaN; }
    if (n <= 0) { errors.push(`${label} harus lebih besar dari 0.`); return NaN; }
    return n;
  };
  const nonNeg = (val, label) => {
    const n = parseNumber(val);
    if (!Number.isFinite(n)) { errors.push(`${label} kosong atau bukan angka.`); return NaN; }
    if (n < 0) { errors.push(`${label} tidak boleh negatif.`); return NaN; }
    return n;
  };

  const dwIn = pos(raw.designW, 'Lebar desain');
  const dhIn = pos(raw.designH, 'Tinggi desain');
  const pwIn = pos(raw.paperW, 'Lebar kertas');
  const phIn = pos(raw.paperH, 'Tinggi kertas');
  const gapX = nonNeg(raw.gapX, 'Gap horizontal');
  const gapY = nonNeg(raw.gapY, 'Gap vertikal');
  const mTop = nonNeg(raw.mTop, 'Margin atas');
  const mRight = nonNeg(raw.mRight, 'Margin kanan');
  const mBottom = nonNeg(raw.mBottom, 'Margin bawah');
  const mLeft = nonNeg(raw.mLeft, 'Margin kiri');

  let qty = null;
  if (raw.qty !== undefined && String(raw.qty).trim() !== '') {
    const q = parseNumber(raw.qty);
    if (!Number.isFinite(q) || q <= 0 || !Number.isInteger(q)) {
      errors.push('Jumlah pesanan harus bilangan bulat lebih besar dari 0.');
    } else {
      qty = q;
    }
  }

  if (errors.length) return { ok: false, errors, config: null };

  const designW = toMm(dwIn, unit);
  const designH = toMm(dhIn, unit);
  const [paperW, paperH] = orientPaper(pwIn, phIn, raw.orientation);
  const margins = { top: mTop, right: mRight, bottom: mBottom, left: mLeft };

  for (const [label, v] of [['Ukuran desain', Math.max(designW, designH)], ['Ukuran kertas', Math.max(paperW, paperH)]]) {
    if (v > MAX_MM) errors.push(`${label} terlalu besar.`);
  }
  const usableW = paperW - margins.left - margins.right;
  const usableH = paperH - margins.top - margins.bottom;
  if (usableW <= EPS || usableH <= EPS) errors.push('Margin terlalu besar: tidak ada area cetak yang tersisa.');
  if (errors.length) return { ok: false, errors, config: null };

  return {
    ok: true,
    errors: [],
    config: {
      designW, designH, unit,
      paperW, paperH, paperName: raw.paperName || 'Custom', orientation: raw.orientation || 'portrait',
      gapX, gapY, margins,
      allowRotation: raw.allowRotation !== false,
      extendedSearch: raw.extendedSearch !== false,
      qty,
    },
  };
}

/** Statistik hasil layout. */
export function computeStats(cfg, layout) {
  const count = layout.placements.length;
  const rotated = layout.placements.filter((p) => p.rotated).length;
  const designArea = cfg.designW * cfg.designH;
  const paperArea = cfg.paperW * cfg.paperH;
  const usableArea = (cfg.paperW - cfg.margins.left - cfg.margins.right) * (cfg.paperH - cfg.margins.top - cfg.margins.bottom);
  const used = count * designArea;
  return {
    count,
    normal: count - rotated,
    rotated,
    usedArea: used,
    paperArea,
    usableArea,
    utilizationPaper: paperArea > 0 ? (used / paperArea) * 100 : 0,
    utilizationUsable: usableArea > 0 ? (used / usableArea) * 100 : 0,
    wasteArea: paperArea - used,
    wastePercent: paperArea > 0 ? ((paperArea - used) / paperArea) * 100 : 0,
  };
}

/** Kebutuhan lembar untuk jumlah pesanan. Kapasitas per lembar dibedakan dari kebutuhan. */
export function orderInfo(qty, perSheet) {
  if (!qty || !perSheet || perSheet <= 0) return null;
  const sheets = Math.ceil(qty / perSheet);
  const totalPrinted = sheets * perSheet;
  const lastSheetUsed = qty - (sheets - 1) * perSheet;
  return {
    qty,
    perSheet,
    sheets,
    totalPrinted,
    surplus: totalPrinted - qty,
    lastSheetUsed,
    lastSheetFree: perSheet - lastSheetUsed,
  };
}

/** Posisi gambar di dalam bingkai desain (contain / cover) dengan rasio asli dipertahankan. */
export function computeFit(frameW, frameH, imgW, imgH, mode = 'contain') {
  const sx = frameW / imgW;
  const sy = frameH / imgH;
  const s = mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const w = imgW * s;
  const h = imgH * s;
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h, scale: s };
}

/**
 * Evaluasi kualitas artwork terhadap ukuran cetak.
 * Tidak mengubah apa pun pada artwork; hanya mengembalikan informasi dan peringatan.
 */
export function imageQuality({ pxW, pxH, frameW, frameH, fit = 'contain', vector = false, size = 0, format = '' }) {
  const ratioImg = pxW / pxH;
  const ratioFrame = frameW / frameH;
  const ratioDiffPct = (Math.abs(ratioImg - ratioFrame) / ratioFrame) * 100;
  const ratioMismatch = ratioDiffPct > 1;
  const f = computeFit(frameW, frameH, pxW, pxH, fit);
  const dpi = vector ? null : pxW / (f.w / 25.4);
  const warnings = [];
  let level = 'good';

  if (ratioMismatch) {
    warnings.push(
      `Rasio gambar (${ratioImg.toFixed(3)}) berbeda dari rasio desain (${ratioFrame.toFixed(3)}). ` +
      (fit === 'cover'
        ? 'Mode Cover akan memotong bagian gambar yang berlebih.'
        : 'Mode Contain akan menyisakan area kosong di dalam desain.')
    );
    level = 'warn';
  }
  if (!vector) {
    if (dpi < 150) {
      warnings.push(`Resolusi rendah: ±${Math.round(dpi)} DPI pada ukuran cetak. Hasil cetak kemungkinan terlihat pecah (disarankan ≥ 300 DPI). Gambar tidak diperbesar otomatis.`);
      level = 'low';
    } else if (dpi < 300) {
      warnings.push(`Resolusi cukup: ±${Math.round(dpi)} DPI. Disarankan ≥ 300 DPI untuk hasil tajam.`);
      if (level === 'good') level = 'warn';
    }
  }
  return { dpi, ratioImg, ratioFrame, ratioDiffPct, ratioMismatch, level, warnings, format, size };
}
