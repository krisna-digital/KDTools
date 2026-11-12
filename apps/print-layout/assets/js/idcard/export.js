// PRINTLAY — idcard/export.js
// PNG dan PDF. Keduanya memanggil renderSide() yang SAMA dengan preview; yang berbeda hanya resolusi canvas.

import { renderSide, makeCanvas, ensureFonts } from './render.js';

export const DPI_OPTIONS = [300, 600, 1200];

const blobOf = (canvas) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Gagal membuat PNG.'))), 'image/png'));

export function slug(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'tanpa-nama';
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function renderHi(side, ctx, dpi) {
  const cfg = ctx.sides[side];
  await ensureFonts(cfg);
  const canvas = makeCanvas(cfg, { dpi });
  const layout = renderSide(canvas, { cfg, bg: ctx.bg[side], data: ctx.data, photo: ctx.photo });
  return { canvas, layout, cfg };
}

/** PNG satu sisi. Ukuran piksel = ukuran fisik × dpi, rasio sama persis dengan 55:85. */
export async function exportPng(side, ctx, { dpi = 600, name = '' } = {}) {
  const { canvas, layout } = await renderHi(side, ctx, dpi);
  const blob = await blobOf(canvas);
  const label = side === 'front' ? 'depan' : 'belakang';
  download(blob, `idcard-${ctx.typeId}-${slug(name)}-${label}.png`);
  return { width: canvas.width, height: canvas.height, warnings: layout.warnings };
}

/**
 * PDF. mode 'two' = 2 halaman, tiap halaman tepat 55×85 mm (skala 1:1, tanpa margin, bukan A4).
 * mode 'one' = 1 halaman 110×85 mm, depan di kiri & belakang di kanan, tanpa jarak.
 * Halaman berisi gambar beresolusi tinggi (teks sudah menjadi piksel → tampilan font terjamin).
 */
export async function exportPdf(mode, ctx, { dpi = 600, name = '' } = {}) {
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) throw new Error('Library jsPDF belum termuat.');
  const front = await renderHi('front', ctx, dpi);
  const back = await renderHi('back', ctx, dpi);
  const W = front.cfg.size.widthMm;
  const H = front.cfg.size.heightMm;
  const img = (c) => c.toDataURL('image/png');
  let doc;
  if (mode === 'one') {
    doc = new JsPDF({ unit: 'mm', format: [W * 2, H], orientation: 'landscape', compress: true });
    doc.addImage(img(front.canvas), 'PNG', 0, 0, W, H, 'depan', 'NONE');
    doc.addImage(img(back.canvas), 'PNG', W, 0, W, H, 'belakang', 'NONE');
  } else {
    doc = new JsPDF({ unit: 'mm', format: [W, H], orientation: 'portrait', compress: true });
    doc.addImage(img(front.canvas), 'PNG', 0, 0, W, H, 'depan', 'NONE');
    doc.addPage([W, H], 'portrait');
    doc.addImage(img(back.canvas), 'PNG', 0, 0, W, H, 'belakang', 'NONE');
  }
  doc.setProperties({ title: `ID Card ${name || ''}`.trim(), creator: 'PRINTLAY' });
  doc.save(`idcard-${ctx.typeId}-${slug(name)}-${mode === 'one' ? '1-halaman' : '2-halaman'}.pdf`);
  return { warnings: [...front.layout.warnings, ...back.layout.warnings] };
}
