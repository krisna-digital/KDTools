// ID Card Studio — engine.js
// Mesin render ID Card. SATU sumber kebenaran posisi: layoutCard() menghitung semua elemen dalam milimeter
// (titik (0,0) di kiri-atas, X ke kanan, Y ke bawah). Preview, PNG, dan PDF semuanya memakai hasil layoutCard()
// lalu drawLayout() — tidak ada perhitungan posisi lain. Konversi mm → pixel hanya terjadi di drawLayout().
//
// Modul ini tidak menyentuh DOM (pengukuran teks disuntikkan lewat `measure`), sehingga dapat diuji di Node.

import { placePhoto, computeFit } from './geometry.js';

export const PT_TO_MM = 25.4 / 72;
export const ASPECT_TOLERANCE = 0.005; // selisih rasio template yang masih dianggap wajar (0,5%)
export const CARD_MM = { widthMm: 55, heightMm: 85 };
export const FIELD_SOURCES = {
  nama: 'Nama Lengkap', nip: 'NIP', jabatan: 'Jabatan', gol_darah: 'Golongan Darah', foto: 'Foto',
};
const REF_PX = 200; // ukuran font acuan untuk pengukuran (lebar dihitung dalam satuan em)

export const DEFAULT_TEXT_FIELD = Object.freeze({
  type: 'text', enabled: true, prefix: '', fontFamily: '"Arial", "Liberation Sans", Helvetica, sans-serif',
  fontSize: 8, minFontSize: 5, maxFontSize: 8, fontWeight: 'bold', fontStyle: 'normal', color: '#000000',
  textAlign: 'left', verticalAlign: 'middle', autoFit: true, letterSpacing: 0, scaleX: 1, maxLines: 1, lineHeight: 1.15, strokeWidth: 0,
});

/** Ambil nilai font dari field untuk pengukuran/penggambaran. */
export const fontSpec = (f) => ({ family: f.fontFamily, weight: f.fontWeight || 'normal', style: f.fontStyle || 'normal' });
export const fontString = (spec, px) => `${spec.style || 'normal'} ${spec.weight || 'normal'} ${px}px ${spec.family}`;

// ---------------------------------------------------------------- validasi

/** Rasio gambar template vs ukuran fisik. Tidak pernah meregangkan; hanya memberi peringatan. */
export function checkTemplateAspect(cfg) {
  const { pxWidth, pxHeight } = cfg.background || {};
  const target = cfg.size.widthMm / cfg.size.heightMm;
  if (!(pxWidth > 0 && pxHeight > 0)) return { ok: false, ratio: NaN, target, deviation: NaN, message: 'Ukuran piksel template tidak diketahui.' };
  const ratio = pxWidth / pxHeight;
  const deviation = (ratio - target) / target;
  const ok = Math.abs(deviation) <= ASPECT_TOLERANCE;
  return {
    ok, ratio, target, deviation,
    message: ok
      ? `Rasio template ${ratio.toFixed(4)} (target ${target.toFixed(4)}), selisih ${(deviation * 100).toFixed(2)}% — dalam toleransi.`
      : `Rasio template ${ratio.toFixed(4)} tidak sesuai ${cfg.size.widthMm}:${cfg.size.heightMm} (${target.toFixed(4)}), selisih ${(deviation * 100).toFixed(2)}%. Sesuaikan gambar template agar tidak terdistorsi.`,
  };
}

/** @returns {{ok:boolean, errors:string[], warnings:string[]}} */
export function validateConfig(cfg) {
  const errors = [];
  const warnings = [];
  if (!cfg || typeof cfg !== 'object') return { ok: false, errors: ['Konfigurasi kosong.'], warnings };
  const s = cfg.size || {};
  if (!(s.widthMm > 0 && s.heightMm > 0)) errors.push('Ukuran fisik template tidak valid.');
  else if (s.widthMm !== CARD_MM.widthMm || s.heightMm !== CARD_MM.heightMm) warnings.push(`Ukuran template ${s.widthMm}×${s.heightMm} mm berbeda dari standar ${CARD_MM.widthMm}×${CARD_MM.heightMm} mm.`);
  if (!Array.isArray(cfg.fields)) errors.push('Daftar field tidak ada.');
  else {
    const seen = new Set();
    for (const f of cfg.fields) {
      if (!f.id) { errors.push('Ada field tanpa ID.'); continue; }
      if (seen.has(f.id)) errors.push(`ID field ganda: ${f.id}`);
      seen.add(f.id);
      if (!['text', 'photo', 'mask'].includes(f.type)) errors.push(`Jenis field tidak dikenal (${f.id}): ${f.type}`);
      for (const k of ['x', 'y', 'width', 'height']) if (!Number.isFinite(f[k])) errors.push(`Field ${f.id}: ${k} bukan angka.`);
      if (f.width <= 0 || f.height <= 0) errors.push(`Field ${f.id}: lebar/tinggi harus > 0.`);
      if (s.widthMm && (f.x < 0 || f.y < 0 || f.x + f.width > s.widthMm + 1e-6 || f.y + f.height > s.heightMm + 1e-6)) warnings.push(`Field ${f.id} keluar dari area kartu.`);
    }
  }
  const a = cfg.background ? checkTemplateAspect(cfg) : null;
  if (a && !a.ok) warnings.push(a.message);
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------- layout

const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * @param measure {width(text, fontSpec) → lebar dalam em, metrics(fontSpec) → {capEm, descEm}}
 */
function layoutText(f, raw, measure) {
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return { state: 'empty', message: 'Belum diisi' };
  const text = `${f.prefix || ''}${value}`;
  const spec = fontSpec(f);
  const sx = f.scaleX > 0 ? f.scaleX : 1;
  const ls = (Number(f.letterSpacing) || 0) * PT_TO_MM; // mm antar karakter
  const { capEm, descEm } = measure.metrics(spec);
  const maxPt = f.autoFit ? Math.min(f.fontSize, f.maxFontSize || f.fontSize) : f.fontSize;
  const minPt = f.autoFit ? Math.min(f.minFontSize || 1, maxPt) : f.fontSize;
  const maxLines = Math.max(1, f.maxLines | 0 || 1);
  const lh = f.lineHeight || 1.15;
  const boxW = f.width;

  const widthMm = (t, sizeMm) => measure.width(t, spec) * sizeMm * sx + ls * Math.max(0, [...t].length - 1);
  const wrap = (sizeMm) => {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (!cur || widthMm(trial, sizeMm) <= boxW + 1e-9) cur = trial;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  let sizeMm = maxPt * PT_TO_MM;
  let lines = [text];
  let overflow = false;
  if (maxLines === 1) {
    if (f.autoFit) {
      const perEm = measure.width(text, spec) * sx;
      const fixed = ls * Math.max(0, [...text].length - 1);
      const fit = perEm > 0 ? (boxW - fixed) / perEm : sizeMm;
      sizeMm = Math.min(sizeMm, fit);
      if (sizeMm < minPt * PT_TO_MM - 1e-9) { sizeMm = minPt * PT_TO_MM; overflow = true; }
    } else overflow = widthMm(text, sizeMm) > boxW + 1e-9;
  } else {
    let chosen = null;
    const step = 0.25 * PT_TO_MM;
    for (let s = maxPt * PT_TO_MM; s >= minPt * PT_TO_MM - 1e-9; s -= step) {
      const ls2 = wrap(s);
      const blockH = (ls2.length - 1) * lh * s + capEm * s;
      if (ls2.length <= maxLines && blockH <= f.height + 1e-9 && ls2.every((l) => widthMm(l, s) <= boxW + 1e-9)) { chosen = { s, ls2 }; break; }
      if (!f.autoFit) break;
    }
    if (chosen) { sizeMm = chosen.s; lines = chosen.ls2; }
    else { sizeMm = minPt * PT_TO_MM; lines = wrap(sizeMm).slice(0, maxLines); overflow = true; }
  }

  const n = lines.length;
  const blockH = (n - 1) * lh * sizeMm + capEm * sizeMm;
  let firstBase;
  if (f.verticalAlign === 'top') firstBase = f.y + capEm * sizeMm;
  else if (f.verticalAlign === 'bottom') firstBase = f.y + f.height - descEm * sizeMm - (n - 1) * lh * sizeMm;
  else firstBase = f.y + f.height / 2 - blockH / 2 + capEm * sizeMm; // tengah = tengah tinggi huruf kapital
  if (capEm * sizeMm > f.height + 1e-9) overflow = true;

  const ax = f.textAlign === 'center' ? f.x + f.width / 2 : f.textAlign === 'right' ? f.x + f.width : f.x;
  const out = lines.map((t, i) => ({ text: t, x: ax, y: firstBase + i * lh * sizeMm, widthMm: widthMm(t, sizeMm) }));
  const fontPt = sizeMm / PT_TO_MM;
  const shrunk = f.autoFit && fontPt < maxPt - 0.01;
  return {
    state: overflow ? 'overflow' : shrunk ? 'shrunk' : 'ok',
    message: overflow ? `Teks terlalu panjang untuk area (font minimum ${minPt} pt tetap tidak muat); teks dipotong di batas area.`
      : shrunk ? `Font diperkecil dari ${maxPt.toFixed(1)} pt menjadi ${fontPt.toFixed(1)} pt agar muat.` : 'Sesuai',
    op: {
      kind: 'text', id: f.id, lines: out, sizeMm, fontPt, spec, color: f.color || '#000', align: f.textAlign || 'left', scaleX: sx,
      letterSpacingMm: ls, strokeMm: Math.max(0, Number(f.strokeWidth) || 0), box: { x: f.x, y: f.y, w: f.width, h: f.height }, clip: overflow,
    },
  };
}

function layoutPhoto(f, photo) {
  const box = { x: f.x, y: f.y, w: f.width, h: f.height };
  if (!photo || !(photo.pxW > 0 && photo.pxH > 0)) return { state: 'empty', message: 'Foto belum diunggah', op: { kind: 'photo', id: f.id, box, img: null, missing: true } };
  let img;
  if (f.cropMode === 'contain') {
    const c = computeFit(box.w, box.h, photo.pxW, photo.pxH, 'contain');
    img = { x: box.x + c.x, y: box.y + c.y, w: c.w, h: c.h };
  } else {
    const g = placePhoto(box, photo.pxW, photo.pxH, photo.zoom ?? 1, photo.ox ?? f.defaultOx ?? 0.5, photo.oy ?? f.defaultOy ?? 0.5);
    img = { x: g.x, y: g.y, w: g.w, h: g.h };
  }
  return {
    state: 'ok', message: 'Sesuai',
    op: { kind: 'photo', id: f.id, box, img, missing: false, border: f.borderWidth > 0 ? { width: f.borderWidth, color: f.borderColor || '#000' } : null },
  };
}

/**
 * @param cfg   konfigurasi satu sisi
 * @param data  {nama, nip, jabatan, gol_darah}
 * @param opts  {measure, photo:{pxW,pxH,zoom,ox,oy}|null}
 * @returns {{widthMm, heightMm, ops, status, warnings}}
 */
export function layoutCard(cfg, data, { measure, photo = null }) {
  const ops = { mask: [], photo: [], text: [] };
  const status = {};
  const warnings = [];
  for (const f of cfg.fields) {
    if (f.enabled === false) { status[f.id] = { state: 'off', message: 'Nonaktif', label: f.label || f.id }; continue; }
    if (f.type === 'mask') {
      ops.mask.push({ kind: 'mask', id: f.id, box: { x: f.x, y: f.y, w: f.width, h: f.height }, color: f.color || '#fff', radius: Math.max(0, Number(f.radius) || 0) });
      continue;
    }
    const r = f.type === 'photo' ? layoutPhoto(f, photo) : layoutText(f, data[f.source], measure);
    status[f.id] = { state: r.state, message: r.message, label: f.label || f.id, source: f.source };
    if (r.op) ops[f.type === 'photo' ? 'photo' : 'text'].push(r.op);
    if (r.state === 'overflow') warnings.push(`${f.label || f.id}: ${r.message}`);
  }
  return { widthMm: cfg.size.widthMm, heightMm: cfg.size.heightMm, ops: [...ops.mask, ...ops.photo, ...ops.text], status, warnings };
}

// ---------------------------------------------------------------- gambar (canvas)

/** Pengukur teks berbasis canvas (browser). Lebar dalam em, jadi tidak bergantung pada DPI. */
export function createCanvasMeasure(doc = document) {
  const ctx = doc.createElement('canvas').getContext('2d');
  const metricCache = new Map();
  return {
    width(text, spec) { ctx.font = fontString(spec, REF_PX); return ctx.measureText(text).width / REF_PX; },
    metrics(spec) {
      const k = fontString(spec, REF_PX);
      if (!metricCache.has(k)) {
        ctx.font = k;
        const h = ctx.measureText('H');
        const d = ctx.measureText('Hg');
        metricCache.set(k, {
          capEm: (h.actualBoundingBoxAscent || 0.716 * REF_PX) / REF_PX,
          descEm: (d.fontBoundingBoxDescent ?? 0.212 * REF_PX) / REF_PX,
        });
      }
      return metricCache.get(k);
    },
  };
}

/**
 * Menggambar hasil layoutCard() ke canvas. Satu-satunya tempat mm dikonversi ke pixel.
 * @param assets {bg: CanvasImageSource, photo: CanvasImageSource|null}
 */
export function drawLayout(ctx, layout, { bg, photo }) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const sx = cw / layout.widthMm;
  const sy = ch / layout.heightMm;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  if (bg) ctx.drawImage(bg, 0, 0, cw, ch);

  for (const op of layout.ops) {
    if (op.kind === 'mask') {
      ctx.fillStyle = op.color;
      const bx = op.box.x * sx; const by = op.box.y * sy; const bw = op.box.w * sx; const bh = op.box.h * sy;
      const r = Math.min(op.radius * sx, bw / 2, bh / 2);
      if (r > 0) {
        ctx.beginPath();
        ctx.moveTo(bx + r, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
        ctx.arcTo(bx, by + bh, bx, by, r);
        ctx.arcTo(bx, by, bx + bw, by, r);
        ctx.closePath();
        ctx.fill();
      } else ctx.fillRect(bx, by, bw, bh);
    } else if (op.kind === 'photo') {
      if (op.missing || !photo) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(op.box.x * sx, op.box.y * sy, op.box.w * sx, op.box.h * sy);
      ctx.clip();
      ctx.drawImage(photo, op.img.x * sx, op.img.y * sy, op.img.w * sx, op.img.h * sy);
      ctx.restore();
      if (op.border) {
        const bw = op.border.width * sx;
        ctx.strokeStyle = op.border.color;
        ctx.lineWidth = bw;
        ctx.strokeRect(op.box.x * sx + bw / 2, op.box.y * sy + bw / 2, op.box.w * sx - bw, op.box.h * sy - bw);
      }
    } else if (op.kind === 'text') {
      ctx.save();
      if (op.clip) {
        ctx.beginPath();
        ctx.rect(op.box.x * sx, op.box.y * sy, op.box.w * sx, op.box.h * sy);
        ctx.clip();
      }
      ctx.fillStyle = op.color;
      ctx.textBaseline = 'alphabetic';
      ctx.font = fontString(op.spec, op.sizeMm * sx);
      for (const ln of op.lines) {
        ctx.save();
        ctx.translate(ln.x * sx, ln.y * sy);
        ctx.scale(op.scaleX, 1);
        if (op.strokeMm > 0) { // tebal tambahan (outline searah warna teks) untuk huruf "ekstra bold"
          ctx.strokeStyle = op.color;
          ctx.lineWidth = op.strokeMm * sx;
          ctx.lineJoin = 'round';
        }
        if (!op.letterSpacingMm) {
          ctx.textAlign = op.align;
          ctx.fillText(ln.text, 0, 0);
          if (op.strokeMm > 0) ctx.strokeText(ln.text, 0, 0);
        } else {
          // Jarak karakter manual agar identik di semua browser.
          ctx.textAlign = 'left';
          const chars = [...ln.text];
          const adv = chars.map((c) => ctx.measureText(c).width);
          const total = adv.reduce((a, b) => a + b, 0) + (op.letterSpacingMm * sx / op.scaleX) * (chars.length - 1);
          let x = op.align === 'center' ? -total / 2 : op.align === 'right' ? -total : 0;
          chars.forEach((c, i) => { ctx.fillText(c, x, 0); if (op.strokeMm > 0) ctx.strokeText(c, x, 0); x += adv[i] + (op.letterSpacingMm * sx) / op.scaleX; });
        }
        ctx.restore();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

export const mmToPx = (mm, dpi) => (mm / 25.4) * dpi;
