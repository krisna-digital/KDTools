// PRINTLAY — renderer.js
// Membangun SVG dari koordinat hasil optimizer. Tidak ada geometri lain: preview, SVG export,
// dan print semuanya dihasilkan dari fungsi ini dengan layout yang sama.

import { computeFit, formatMm } from './calculator.js';
import { windowOnPaper, mapRect, placePhoto } from './templates.js';

export const PLACEHOLDER_COLOR = '#ADD8E6';
const CUT_COLOR = '#222222';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => Number(v.toFixed(4));

/**
 * @param layout {placements:[{x,y,w,h,rotated}]}
 * @param cfg    config (mm)
 * @param opts   {mode:'preview'|'export', showNumbers, showMargin, showDims, artwork:{pxW,pxH}, href, fit,
 *                photos, interactive, selected, numberOffset}
 *   photos (khusus template): array sejajar dengan placements; tiap elemen {pxW,pxH,href,tpl,zoom,ox,oy} atau
 *   kosong (slot tak terisi). Tiap foto memakai template (orientasi) sendiri dan posisi/zoom sendiri.
 */
export function buildSvg(layout, cfg, opts = {}) {
  const { mode = 'preview', showNumbers = false, showMargin = false, showDims = false, artwork = null, href = null, fit = 'contain', numberOffset = 0 } = opts;
  const exportMode = mode === 'export';
  const W = cfg.paperW;
  const H = cfg.paperH;
  const m = cfg.margins;
  const dw = cfg.designW;
  const dh = cfg.designH;
  const hasArt = !!(artwork && href);
  // Template berbingkai (mis. Polaroid): foto mengisi jendela dengan COVER — rasio asli tidak diubah.
  const tpl = cfg.template || null;
  const isBatchTemplate = !!(tpl && tpl.id === 'photo-batch');
  const photos = tpl && Array.isArray(opts.photos) && opts.photos.length ? opts.photos : null;
  const interactive = !!photos && !!opts.interactive && !exportMode;
  const isRot = (p, ph) => Math.abs(p.w - ph.tpl.cardW) > 1e-6; // kartu foto ini harus diputar agar muat di slot
  const slotTr = (p, r) => (r ? `translate(${n(p.x + p.w)} ${n(p.y)}) rotate(90)` : `translate(${n(p.x)} ${n(p.y)})`);
  const vec = exportMode ? '' : ' vector-effect="non-scaling-stroke"';
  const cutW = exportMode ? 0.1 : 1;
  const sizeAttrs = exportMode ? ` width="${n(W)}mm" height="${n(H)}mm"` : ' preserveAspectRatio="xMidYMid meet"';

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${n(W)} ${n(H)}"${sizeAttrs} role="img" aria-label="${esc(`Layout ${layout.placements.length} desain pada kertas ${formatMm(W)}×${formatMm(H)} mm`)}">`);

  out.push('<defs>');
  // Area isi: seluruh desain (standar) atau jendela foto (template).
  const box = tpl ? tpl.window : { x: 0, y: 0, w: dw, h: dh };
  out.push(`<clipPath id="pl-frame"><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}"/></clipPath>`);
  if (hasArt) {
    const f = computeFit(box.w, box.h, artwork.pxW, artwork.pxH, tpl ? 'cover' : fit);
    out.push(`<image id="pl-art" x="${n(box.x + f.x)}" y="${n(box.y + f.y)}" width="${n(f.w)}" height="${n(f.h)}" preserveAspectRatio="none" xlink:href="${esc(href)}"/>`);
  }
  if (photos) {
    layout.placements.forEach((p, i) => {
      const ph = photos[i];
      if (!ph) return;
      const w = ph.tpl.window;
      out.push(`<clipPath id="pl-c${i}"><rect x="${n(w.x)}" y="${n(w.y)}" width="${n(w.w)}" height="${n(w.h)}"/></clipPath>`);
    });
  }
  out.push('</defs>');

  out.push(`<rect x="0" y="0" width="${n(W)}" height="${n(H)}" fill="#ffffff"${exportMode ? '' : ` stroke="#9aa4b2" stroke-width="1"${vec}`}/>`);

  if (showMargin && !exportMode) {
    out.push(`<rect x="${n(m.left)}" y="${n(m.top)}" width="${n(W - m.left - m.right)}" height="${n(H - m.top - m.bottom)}" fill="none" stroke="#3b82f6" stroke-width="1" stroke-dasharray="6 4"${vec}/>`);
  }

  // Isi desain (artwork atau placeholder)
  layout.placements.forEach((p, i) => {
    if (photos) {
      const ph = photos[i];
      if (ph) {
        const g = placePhoto(ph.tpl.window, ph.pxW, ph.pxH, ph.zoom, ph.ox, ph.oy);
        const slotAttr = interactive ? ` data-slot="${i}"` : '';
        out.push(`<g transform="${slotTr(p, isRot(p, ph))}"><g clip-path="url(#pl-c${i})"><image${slotAttr} x="${n(g.x)}" y="${n(g.y)}" width="${n(g.w)}" height="${n(g.h)}" preserveAspectRatio="none" xlink:href="${esc(ph.href)}"/></g></g>`);
      } else if (!exportMode && !isBatchTemplate) {
        const wp = windowOnPaper(p, tpl.window);
        out.push(`<rect x="${n(wp.x)}" y="${n(wp.y)}" width="${n(wp.w)}" height="${n(wp.h)}" fill="${PLACEHOLDER_COLOR}" fill-opacity="0.45"/>`);
      }
      return;
    }
    if (hasArt) {
      // Bingkai desain berukuran dw×dh; desain yang dirotasi diputar 90° searah jarum jam.
      const tr = p.rotated ? `translate(${n(p.x + p.w)} ${n(p.y)}) rotate(90)` : `translate(${n(p.x)} ${n(p.y)})`;
      out.push(`<g transform="${tr}"><g clip-path="url(#pl-frame)"><use xlink:href="#pl-art"/></g></g>`);
    } else if (tpl) {
      const wp = windowOnPaper(p, tpl.window);
      out.push(`<rect x="${n(wp.x)}" y="${n(wp.y)}" width="${n(wp.w)}" height="${n(wp.h)}" fill="${PLACEHOLDER_COLOR}"/>`);
    } else {
      out.push(`<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${PLACEHOLDER_COLOR}"/>`);
    }
  });

  // Garis potong tepat pada batas fisik desain
  layout.placements.forEach((p, i) => {
    if (photos && exportMode && !photos[i]) return; // slot kosong tidak dicetak
    out.push(`<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="none" stroke="${CUT_COLOR}" stroke-width="${cutW}"${vec}/>`);
  });

  if (showNumbers || showDims) {
    layout.placements.forEach((p, i) => {
      if (photos && !photos[i]) return;
      const no = i + 1 + numberOffset;
      const size = Math.min(6, Math.min(p.w, p.h) * 0.28);
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const halo = `fill="#0b2a4a" stroke="#ffffff" stroke-width="${n(size * 0.15)}" paint-order="stroke" stroke-linejoin="round" font-family="Arial, Helvetica, sans-serif" text-anchor="middle"`;
      if (showNumbers) {
        out.push(`<text x="${n(cx)}" y="${n(showDims ? cy - size * 0.1 : cy)}" font-size="${n(size)}" ${halo} dominant-baseline="central" pointer-events="none">${no}</text>`);
      }
      if (showDims) {
        const s2 = size * 0.5;
        out.push(`<text x="${n(cx)}" y="${n(cy + size * (showNumbers ? 0.8 : 0))}" font-size="${n(s2)}" ${halo} dominant-baseline="central" pointer-events="none">${formatMm(dw)}×${formatMm(dh)}</text>`);
      }
    });
  }

  if (interactive) {
    // Lapisan interaksi: sorotan foto terpilih + area sentuh (jendela foto) per slot terisi.
    layout.placements.forEach((p, i) => {
      const ph = photos[i];
      if (!ph) return;
      const w = mapRect(p, ph.tpl.window, isRot(p, ph));
      const box = `x="${n(w.x)}" y="${n(w.y)}" width="${n(w.w)}" height="${n(w.h)}"`;
      out.push(`<rect class="pl-sel" data-slot="${i}" ${box} fill="none" stroke="${i === opts.selected ? '#f59e0b' : 'none'}" stroke-width="3"${vec} pointer-events="none"/>`);
      out.push(`<rect class="pl-hit" data-slot="${i}" ${box} fill="#000" fill-opacity="0" style="cursor:grab"/>`);
    });
  }

  out.push('</svg>');
  return out.join('\n');
}
