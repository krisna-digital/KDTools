// PRINTLAY — validator.js
// Validator INDEPENDEN dari optimizer: hanya membaca koordinat hasil akhir dan memeriksa aturan.
// Aturan gap: untuk setiap pasang desain, jarak horizontal >= gapX ATAU jarak vertikal >= gapY.
// (Ini ekuivalen dengan "kotak yang diperluas gap tidak saling menimpa".)

import { EPS } from './calculator.js';

const TOL = 1e-6; // mm
const MAX_ERRORS = 25;

/**
 * @param layout {placements:[{x,y,w,h,rotated}], count?}
 * @param cfg    config dari normalizeInputs (satuan mm)
 * @returns {valid, errors:[string], checks:{inside,overlap,gap,rotation,count}, count}
 */
export function validateLayout(layout, cfg) {
  const errors = [];
  const bad = { inside: false, overlap: false, gap: false, rotation: false, count: false };
  const push = (kind, msg) => {
    bad[kind] = true;
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };

  const list = layout && Array.isArray(layout.placements) ? layout.placements : null;
  if (!list) {
    return { valid: false, errors: ['Layout tidak memiliki daftar penempatan.'], checks: { inside: false, overlap: false, gap: false, rotation: false, count: false }, count: 0 };
  }

  const { designW: dw, designH: dh, paperW, paperH, gapX: gx, gapY: gy, margins: m } = cfg;
  const x0 = m.left;
  const y0 = m.top;
  const x1 = paperW - m.right;
  const y1 = paperH - m.bottom;

  if (layout.count !== undefined && layout.count !== list.length) {
    push('count', `Jumlah yang dilaporkan (${layout.count}) tidak sama dengan jumlah objek (${list.length}).`);
  }

  list.forEach((p, i) => {
    const id = `#${i + 1}`;
    if (![p.x, p.y, p.w, p.h].every(Number.isFinite)) {
      push('inside', `Desain ${id}: koordinat tidak valid.`);
      return;
    }
    if (p.x < x0 - TOL || p.y < y0 - TOL || p.x + p.w > x1 + TOL || p.y + p.h > y1 + TOL) {
      push('inside', `Desain ${id} keluar dari area cetak (batas kertas/margin).`);
    }
    const expW = p.rotated ? dh : dw;
    const expH = p.rotated ? dw : dh;
    if (Math.abs(p.w - expW) > TOL || Math.abs(p.h - expH) > TOL) {
      push('rotation', `Desain ${id}: ukuran ${p.w}×${p.h} tidak sesuai orientasi ${p.rotated ? 'rotasi' : 'normal'} (${expW}×${expH}).`);
    }
    if (p.rotated && cfg.allowRotation === false) {
      push('rotation', `Desain ${id} dirotasi padahal rotasi dinonaktifkan.`);
    }
  });

  // Cek pasangan dengan sweep sumbu-x: urutkan berdasarkan x.
  const sorted = list
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => [p.x, p.y, p.w, p.h].every(Number.isFinite))
    .sort((a, b) => a.p.x - b.p.x);

  for (let a = 0; a < sorted.length; a++) {
    const A = sorted[a].p;
    for (let b = a + 1; b < sorted.length; b++) {
      const B = sorted[b].p;
      const dxRight = B.x - (A.x + A.w);
      if (dxRight >= gx - TOL) break; // semua yang lebih kanan sudah memenuhi gap horizontal
      const dx = Math.max(dxRight, A.x - (B.x + B.w));
      const dy = Math.max(B.y - (A.y + A.h), A.y - (B.y + B.h));
      if (dx >= gx - TOL || dy >= gy - TOL) continue;
      const ida = sorted[a].i + 1;
      const idb = sorted[b].i + 1;
      if (dx < -TOL && dy < -TOL) push('overlap', `Desain #${ida} dan #${idb} saling bertumpang tindih.`);
      else push('gap', `Gap desain #${ida} dan #${idb} kurang dari yang diminta (gap H=${gx} mm, V=${gy} mm).`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    checks: {
      inside: !bad.inside,
      overlap: !bad.overlap,
      gap: !bad.gap,
      rotation: !bad.rotation,
      count: !bad.count,
    },
    count: list.length,
  };
}

export { EPS };
