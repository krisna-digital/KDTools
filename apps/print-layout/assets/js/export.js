// PRINTLAY — export.js
// Export PDF (jsPDF), SVG, dan print. Semua memakai koordinat layout yang sama dengan preview.

import { computeFit } from './calculator.js';
import { validateLayout } from './validator.js';
import { buildSvg } from './renderer.js';
import { getPdfSources, loadImage } from './artwork.js';
import { windowOnPaper, mapRect, placePhoto } from './templates.js';

function assertValid(layout, cfg) {
  const v = validateLayout(layout, cfg);
  if (!v.valid) throw new Error(`Layout tidak valid, export dibatalkan: ${v.errors[0]}`);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const isRot = (p, tpl) => Math.abs(p.w - tpl.cardW) > 1e-6;

/** Jumlah lembar untuk daftar foto (kapasitas = jumlah slot per lembar). */
export function sheetsFor(layout, photos) {
  const cap = layout.placements.length;
  return cap && photos && photos.length ? Math.ceil(photos.length / cap) : 1;
}

/** Ubah foto {art,zoom,ox,oy,tpl} menjadi masukan renderer (dengan data URL). */
async function renderPhotos(list) {
  return Promise.all(list.map(async (ph) => ({
    pxW: ph.art.pxW, pxH: ph.art.pxH, href: await ph.art.getDataUrl(), tpl: ph.tpl, zoom: ph.zoom, ox: ph.ox, oy: ph.oy,
  })));
}

async function sheetSvg(layout, cfg, photos, sheet, showNumbers) {
  const cap = layout.placements.length;
  const slice = photos.slice(sheet * cap, sheet * cap + cap);
  return buildSvg(layout, cfg, { mode: 'export', showNumbers, photos: await renderPhotos(slice), numberOffset: sheet * cap });
}

export async function exportSvg(layout, cfg, { artwork = null, fit = 'contain', showNumbers = false, filename = 'printlay-layout.svg', photos = null, sheet = 0 } = {}) {
  assertValid(layout, cfg);
  if (cfg.template && photos && photos.length) {
    const total = sheetsFor(layout, photos);
    const svg = await sheetSvg(layout, cfg, photos, sheet, showNumbers);
    download(new Blob([svg], { type: 'image/svg+xml' }), total > 1 ? `printlay-layout-lembar-${sheet + 1}.svg` : filename);
    return { notes: total > 1 ? [`Lembar ${sheet + 1} dari ${total} (sesuai yang tampil di preview).`] : [] };
  }
  const href = artwork ? await artwork.getDataUrl() : null;
  const svg = buildSvg(layout, cfg, { mode: 'export', showNumbers, artwork, href, fit });
  download(new Blob([svg], { type: 'image/svg+xml' }), filename);
}

export async function exportPdf(layout, cfg, { artwork = null, fit = 'contain', showNumbers = false, filename = 'printlay-layout.pdf', photos = null, onProgress = null } = {}) {
  assertValid(layout, cfg);
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) throw new Error('Library jsPDF belum termuat.');

  const W = cfg.paperW;
  const H = cfg.paperH;
  const doc = new JsPDF({ orientation: W > H ? 'landscape' : 'portrait', unit: 'mm', format: [W, H], compress: true });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  if (Math.abs(pw - W) > 0.01 || Math.abs(ph - H) > 0.01) {
    throw new Error(`Ukuran halaman PDF (${pw.toFixed(2)}×${ph.toFixed(2)}) tidak sama dengan kertas (${W}×${H}).`);
  }
  doc.setProperties({ title: 'PRINTLAY layout', creator: 'PRINTLAY' });

  const notes = [];
  if (cfg.template && photos && photos.length) {
    await drawPhotoSheets(doc, layout, cfg, photos, { showNumbers, notes, onProgress });
    doc.save(filename);
    return { notes: [...new Set(notes)], placeholder: false };
  }
  let src = null;
  if (artwork) {
    const needRotated = layout.placements.some((p) => p.rotated);
    // Lebar gambar pada kertas (dipakai untuk rasterisasi SVG): untuk template = lebar hasil cover di jendela foto.
    const rasterW = cfg.template
      ? computeFit(cfg.template.window.w, cfg.template.window.h, artwork.pxW, artwork.pxH, 'cover').w
      : cfg.designW;
    src = await getPdfSources(artwork, { designW: rasterW, designH: cfg.designH, needRotated });
    notes.push(...src.notes);
  }

  const tpl = cfg.template || null;
  const effFit = tpl ? 'cover' : fit; // template: selalu zoom-in (cover), tidak pernah diregangkan
  for (const p of layout.placements) {
    // Area isi pada kertas: seluruh desain, atau jendela foto bila memakai template.
    const box = tpl ? windowOnPaper(p, tpl.window) : { x: p.x, y: p.y, w: p.w, h: p.h };
    if (!src) {
      doc.setFillColor(173, 216, 230); // #ADD8E6
      doc.rect(box.x, box.y, box.w, box.h, 'F');
      continue;
    }
    const s = p.rotated ? src.rotated : src.normal;
    // Untuk desain yang dirotasi, gambar sudah diputar sehingga bingkai = rect pada kertas.
    const f = computeFit(box.w, box.h, s.w, s.h, effFit);
    if (effFit === 'cover') {
      doc.saveGraphicsState();
      doc.rect(box.x, box.y, box.w, box.h, null);
      doc.clip();
      doc.discardPath();
    }
    doc.addImage(s.dataUrl, s.format, box.x + f.x, box.y + f.y, f.w, f.h, p.rotated ? 'art-rot' : 'art-normal', 'FAST');
    if (effFit === 'cover') doc.restoreGraphicsState();
  }

  // Garis potong pada batas fisik desain
  doc.setDrawColor(34, 34, 34);
  doc.setLineWidth(0.1);
  for (const p of layout.placements) doc.rect(p.x, p.y, p.w, p.h, 'S');

  if (showNumbers) {
    doc.setTextColor(11, 42, 74);
    layout.placements.forEach((p, i) => {
      const mm = Math.min(6, Math.min(p.w, p.h) * 0.28);
      doc.setFontSize(mm * 2.8346);
      doc.text(String(i + 1), p.x + p.w / 2, p.y + p.h / 2, { align: 'center', baseline: 'middle' });
    });
  }

  doc.save(filename);
  return { notes, placeholder: !artwork };
}

/**
 * Template + banyak foto: tiap lembar = satu halaman PDF. Foto ke-k masuk slot (k mod kapasitas) pada lembar ⌊k / kapasitas⌋.
 * Tiap foto memakai orientasi kartu & posisi/zoom sendiri; rasio foto tidak pernah diubah (cover + clip jendela).
 * Foto diproses satu per satu agar memori tidak membengkak.
 */
async function drawPhotoSheets(doc, layout, cfg, photos, { showNumbers, notes, onProgress }) {
  const W = cfg.paperW;
  const H = cfg.paperH;
  const cap = layout.placements.length;
  const sheets = sheetsFor(layout, photos);
  for (let sh = 0; sh < sheets; sh++) {
    if (sh > 0) doc.addPage([W, H], W > H ? 'landscape' : 'portrait');
    const filled = [];
    for (let i = 0; i < cap; i++) {
      const idx = sh * cap + i;
      const ph = photos[idx];
      if (!ph) continue;
      if (onProgress) onProgress(idx + 1, photos.length);
      const p = layout.placements[i];
      const r = isRot(p, ph.tpl);
      const win = mapRect(p, ph.tpl.window, r);
      const loc = placePhoto(ph.tpl.window, ph.art.pxW, ph.art.pxH, ph.zoom, ph.ox, ph.oy);
      const src = await getPdfSources(ph.art, { designW: loc.w, designH: loc.h, needRotated: r });
      notes.push(...src.notes);
      const s = r ? src.rotated : src.normal;
      const img = mapRect(p, loc, r); // sumber sudah diputar (bila r) → rasio sama dengan persegi ini
      doc.saveGraphicsState();
      doc.rect(win.x, win.y, win.w, win.h, null);
      doc.clip();
      doc.discardPath();
      doc.addImage(s.dataUrl, s.format, img.x, img.y, img.w, img.h, `ph${idx}${r ? 'r' : 'n'}`, 'FAST');
      doc.restoreGraphicsState();
      filled.push(i);
    }
    doc.setDrawColor(34, 34, 34);
    doc.setLineWidth(0.1);
    for (const i of filled) {
      const p = layout.placements[i];
      doc.rect(p.x, p.y, p.w, p.h, 'S');
    }
    if (showNumbers) {
      doc.setTextColor(11, 42, 74);
      for (const i of filled) {
        const p = layout.placements[i];
        const mm = Math.min(6, Math.min(p.w, p.h) * 0.28);
        doc.setFontSize(mm * 2.8346);
        doc.text(String(sh * cap + i + 1), p.x + p.w / 2, p.y + p.h / 2, { align: 'center', baseline: 'middle' });
      }
    }
  }
}

/** Print langsung dari browser: SVG berukuran fisik (mm) + @page sesuai kertas. */
export async function printLayout(layout, cfg, { artwork = null, fit = 'contain', showNumbers = false, photos = null } = {}) {
  assertValid(layout, cfg);
  let svg;
  if (cfg.template && photos && photos.length) {
    const parts = [];
    const total = sheetsFor(layout, photos);
    for (let sh = 0; sh < total; sh++) {
      const one = await sheetSvg(layout, cfg, photos, sh, showNumbers);
      parts.push(`<div class="print-sheet">${one}</div>`);
    }
    svg = parts.join('');
    const urls = [...svg.matchAll(/xlink:href="(data:[^"]+)"/g)].map((m) => m[1]);
    await Promise.all(urls.map((u) => loadImage(u).catch(() => {})));
  } else {
    const href = artwork ? await artwork.getDataUrl() : null;
    if (href) await loadImage(href).catch(() => {});
    svg = buildSvg(layout, cfg, { mode: 'export', showNumbers, artwork, href, fit });
  }

  let root = document.getElementById('printRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'printRoot';
    document.body.appendChild(root);
  }
  root.innerHTML = svg;

  let style = document.getElementById('printPageStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'printPageStyle';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${cfg.paperW}mm ${cfg.paperH}mm; margin: 0; }`;

  const cleanup = () => { root.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
