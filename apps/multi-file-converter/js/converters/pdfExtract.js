// PDF -> DOCX / XLSX / PPTX using text extraction (and optional OCR).
// Honest scope: text, basic styling, headings, lists and detected tables become editable content.
// Vector graphics and embedded pictures are NOT recreated (unless the user chooses page snapshots, which are images, not editable).

import { ConverterError, ERR, throwIfAborted } from '../core/errors.js';
import { baseName, mimeFor, parsePageRange } from '../core/format.js';
import { getDocx, getPptxGen, hasLib } from '../core/loader.js';
import { buildLines, buildParagraphs, detectTables, getPageText, textCharCount } from '../lib/pdfText.js';
import { writeXlsx } from '../lib/xlsxLite.js';
import { openPdf, renderPage } from './pdfRender.js';
import { ocrAvailable, ocrCanvas } from './ocr.js';

const SCANNED_THRESHOLD = 12; // fewer characters than this on a page -> treat as image-only

async function analyze(file, o, { signal, onProgress }) {
  const pdf = await openPdf(file, { signal });
  const pages = parsePageRange(o.pages, pdf.numPages);
  const out = [];
  const warnings = [];
  let scannedPages = 0, ocrPages = 0;
  const wantOcr = o.ocr && o.ocr !== 'off';
  const ocrOk = wantOcr ? await ocrAvailable() : false;
  if (wantOcr && !ocrOk) warnings.push('OCR was requested but the OCR engine is not included in this build, so scanned pages could not be recognised.');
  for (let k = 0; k < pages.length; k++) {
    throwIfAborted(signal);
    onProgress?.(0.05 + 0.5 * k / pages.length, `Reading page ${pages[k]} of ${pdf.numPages}…`);
    const page = await pdf.getPage(pages[k]);
    let { items, width, height } = await getPageText(page);
    let scanned = false, ocr = false;
    if (textCharCount(items) < SCANNED_THRESHOLD) {
      scanned = true; scannedPages++;
      if (ocrOk && (o.ocr === 'auto' || o.ocr === 'force')) {
        const scale = 2.5; // ~180 dpi
        const { canvas } = await renderPage(page, 72 * scale);
        items = await ocrCanvas(canvas, scale, o.ocrLang || 'eng');
        ocr = items.length > 0; if (ocr) ocrPages++;
      }
    } else if (ocrOk && o.ocr === 'force') {
      const scale = 2.5;
      const { canvas } = await renderPage(page, 72 * scale);
      const r = await ocrCanvas(canvas, scale, o.ocrLang || 'eng');
      if (r.length) { items = r; ocr = true; ocrPages++; }
    }
    const lines = buildLines(items);
    out.push({ n: pages[k], width, height, lines, scanned: scanned && !ocr, ocr, page });
  }
  return { pdf, pages: out, warnings, scannedPages, ocrPages };
}

function scannedWarning(a, o) {
  const w = [];
  const left = a.pages.filter((p) => p.scanned).length;
  if (left) w.push(`${left} page(s) contain no selectable text (scanned images). ${o.ocr && o.ocr !== 'off' ? 'They could not be recognised.' : 'Enable OCR to recognise them.'} ${o.snapshots ? 'These pages were inserted as images, which are NOT editable.' : 'These pages are empty in the output.'}`);
  if (a.ocrPages) w.push(`${a.ocrPages} page(s) were recognised with OCR. Check the text for recognition errors.`);
  return w;
}

async function snapshotPng(page, dpi = 110) {
  const { canvas } = await renderPage(page, dpi);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { data: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height, dpi };
}

// ================= DOCX =================

export async function pdfToDocx({ file, options: o, signal, onProgress }) {
  const D = await getDocx();
  const a = await analyze(file, o, { signal, onProgress });
  const layout = o.layout !== 'flow';
  const warnings = [...a.warnings];
  try {
    const sections = [];
    let flow = [];
    const flushFlow = () => { if (flow.length) { sections.push({ children: flow, properties: {} }); flow = []; } };

    for (let idx = 0; idx < a.pages.length; idx++) {
      throwIfAborted(signal);
      const p = a.pages[idx];
      onProgress?.(0.55 + 0.4 * idx / a.pages.length, `Building page ${p.n}…`);
      const children = [];
      const tables = o.tables === false ? [] : detectTables(p.lines);
      const inTable = new Set(tables.flatMap((t) => [...t.lineSet]));
      const rest = p.lines.filter((l) => !inTable.has(l));
      const paras = buildParagraphs(rest, p.width);
      // merge paragraphs and tables in vertical order
      const blocks = [...paras.map((x) => ({ y: x.y, para: x })), ...tables.map((t) => ({ y: t.y0, table: t }))].sort((m, n) => m.y - n.y);
      const margins = layout ? Math.min(...paras.map((q) => q.x), 72) : 72;
      for (const bl of blocks) {
        if (bl.para) {
          const q = bl.para;
          const runs = q.runs.length ? mergeRuns(q) : [];
          const size = Math.round(q.size * 2); // half-points
          const children2 = runs.map((r) => new D.TextRun({ text: r.str, bold: r.bold || undefined, italics: r.italic || undefined, size: Math.max(12, Math.round(r.size * 2)), font: r.mono ? 'Courier New' : undefined }));
          const indent = layout ? Math.max(0, Math.round((q.x - margins) * 20)) : 0;
          const heading = q.heading && !q.list ? [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3][q.heading - 1] : undefined;
          children.push(new D.Paragraph({
            children: children2.length ? children2 : [new D.TextRun({ text: q.text, size })],
            heading, indent: indent ? { left: indent } : undefined, spacing: { after: 120 },
          }));
        } else {
          const t = bl.table;
          const cols = t.cols;
          children.push(new D.Table({
            width: { size: 100, type: D.WidthType.PERCENTAGE },
            rows: t.rows.map((r, ri) => new D.TableRow({
              children: r.map((c) => new D.TableCell({
                width: { size: 100 / cols, type: D.WidthType.PERCENTAGE },
                children: [new D.Paragraph({ children: [new D.TextRun({ text: c, bold: ri === 0 && t.rows.length > 2 ? true : undefined, size: 20 })] })],
              })),
            })),
          }));
          children.push(new D.Paragraph({ text: '' }));
        }
      }
      if (p.scanned && o.snapshots) {
        const img = await snapshotPng(p.page);
        const wPt = Math.min(p.width, 500);
        children.push(new D.Paragraph({ children: [new D.ImageRun({ type: 'png', data: img.data, transformation: { width: wPt * 1.333, height: wPt * 1.333 * p.height / p.width } })] }));
      }
      if (layout) {
        sections.push({
          properties: { page: { size: { width: Math.round(p.width * 20), height: Math.round(p.height * 20) }, margin: { top: 1000, bottom: 1000, left: Math.round(margins * 20), right: 1000 } } },
          children: children.length ? children : [new D.Paragraph({ text: '' })],
        });
      } else {
        flow.push(...children);
      }
      p.page.cleanup();
    }
    flushFlow();
    if (!sections.length) throw new ConverterError(ERR.NO_TEXT, 'The selected pages contain no text. Turn on OCR (if available) or use "PDF to JPG/PNG".');
    const empty = a.pages.every((p) => !p.lines.length);
    if (empty && !o.snapshots) throw new ConverterError(ERR.NO_TEXT, 'This PDF has no selectable text (it looks scanned). Enable OCR, or enable "insert scanned pages as images".');

    const doc = new D.Document({ creator: 'Multi File Converter', sections });
    const blob = await D.Packer.toBlob(doc);
    warnings.push(...scannedWarning(a, o));
    warnings.push('Text, headings, lists and detected tables are editable. Pictures, vector graphics, columns and exact fonts are not reproduced, so the layout is approximate.');
    onProgress?.(1);
    return { outputs: [{ name: `${baseName(file.name)}.docx`, blob, mime: mimeFor('docx') }], warnings };
  } finally {
    a.pdf.destroy();
  }
}

function mergeRuns(p) {
  const out = [];
  p.lines.forEach((l, i) => {
    l.runs.forEach((r, j) => {
      let s = r.str;
      if (j === l.runs.length - 1 && i < p.lines.length - 1) {
        s = s.replace(/\s+$/, '');
        if (/[a-zà-ÿ]-$/.test(s)) s = s.slice(0, -1); else s += ' ';
      }
      const last = out[out.length - 1];
      if (last && last.bold === r.bold && last.italic === r.italic && last.mono === r.mono && Math.abs(last.size - r.size) < 0.6) last.str += s;
      else out.push({ str: s, bold: r.bold, italic: r.italic, mono: r.mono, size: r.size });
    });
  });
  return out;
}

// ================= XLSX =================

export async function pdfToXlsx({ file, options: o, signal, onProgress }) {
  const a = await analyze(file, o, { signal, onProgress });
  const warnings = [...a.warnings];
  try {
    const sheets = [];
    let found = 0;
    const textRows = [];
    for (let idx = 0; idx < a.pages.length; idx++) {
      throwIfAborted(signal);
      const p = a.pages[idx];
      onProgress?.(0.55 + 0.4 * idx / a.pages.length, `Detecting tables on page ${p.n}…`);
      const tables = detectTables(p.lines, { minRows: Number(o.minRows) || 2, minCols: Number(o.minCols) || 2 });
      tables.forEach((t, ti) => {
        found++;
        const rows = t.rows.map((r) => r.map((c) => (o.numbers !== false && /^[-+]?\d{1,3}([,.]?\d{3})*([.,]\d+)?%?$|^[-+]?\d+([.,]\d+)?$/.test(c.trim()) ? toNumber(c.trim()) : c)));
        const widths = t.rows[0].map((_, c) => Math.min(60, Math.max(8, ...t.rows.map((r) => (r[c] || '').length + 2))));
        if (o.sheetMode === 'perTable' || o.sheetMode === 'perPage') {
          sheets.push({ name: `P${p.n}-T${ti + 1}`, rows, colWidths: widths, freezeHeader: true, boldHeader: true });
        } else {
          if (textRows.length) textRows.push([]);
          if (o.sheetMode === 'single') textRows.push([`Page ${p.n}, table ${ti + 1}`]);
          textRows.push(...rows);
        }
      });
      if (o.includeText) {
        const inTable = new Set(tables.flatMap((t) => [...t.lineSet]));
        for (const l of p.lines) if (!inTable.has(l)) textRows.push([l.text]);
      }
      p.page.cleanup();
    }
    if (!sheets.length && textRows.length) sheets.push({ name: 'PDF data', rows: textRows, colWidths: [], boldHeader: o.sheetMode !== 'single' });
    if (!found) {
      throw new ConverterError(ERR.NO_TEXT, a.scannedPages && !a.ocrPages
        ? 'No tables found: the PDF has no selectable text (scanned). Enable OCR if available.'
        : 'No table structure could be detected. Tables without aligned columns cannot be reconstructed reliably.');
    }
    const blob = await writeXlsx(sheets);
    warnings.push(...scannedWarning(a, o));
    warnings.push(`${found} table(s) reconstructed from text alignment. Always verify numbers; borderless or merged-cell tables may be split or shifted.`);
    onProgress?.(1);
    return { outputs: [{ name: `${baseName(file.name)}.xlsx`, blob, mime: mimeFor('xlsx') }], warnings };
  } finally {
    a.pdf.destroy();
  }
}

function toNumber(s) {
  const pct = s.endsWith('%');
  let t = s.replace(/%$/, '');
  // decide decimal separator
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = Number(t);
  if (!Number.isFinite(n)) return s;
  return pct ? n / 100 : n;
}

// ================= PPTX =================

export async function pdfToPptx({ file, options: o, signal, onProgress }) {
  const PptxGen = await getPptxGen();
  const a = await analyze(file, o, { signal, onProgress });
  const warnings = [...a.warnings];
  try {
    const pptx = new PptxGen();
    const first = a.pages[0];
    // slide size follows the first page (inches)
    const W = first.width / 72, H = first.height / 72;
    pptx.defineLayout({ name: 'PDF', width: W, height: H });
    pptx.layout = 'PDF';
    pptx.title = baseName(file.name);
    let n = 0;
    for (const p of a.pages) {
      throwIfAborted(signal);
      onProgress?.(0.55 + 0.4 * (n++) / a.pages.length, `Building slide ${n}…`);
      const slide = pptx.addSlide();
      const sx = W / p.width, sy = H / p.height;
      if (o.background === 'snapshot') {
        const img = await snapshotPng(p.page, 96);
        slide.addImage({ data: 'data:image/png;base64,' + b64(img.data), x: 0, y: 0, w: W, h: H });
      }
      const tables = detectTables(p.lines);
      const inTable = new Set(tables.flatMap((t) => [...t.lineSet]));
      for (const t of tables) {
        const rows = t.rows.map((r, ri) => r.map((c) => ({ text: c, options: { bold: ri === 0, fontSize: 11 } })));
        slide.addTable(rows, { x: t.x0 * sx, y: (t.y0 - 12) * sy, w: Math.max(2, (p.width - t.x0 * 2) * sx), border: { type: 'solid', pt: 0.5, color: 'BBBBBB' } });
      }
      const paras = buildParagraphs(p.lines.filter((l) => !inTable.has(l)), p.width);
      for (const q of paras) {
        const x = q.x * sx;
        const top = (q.lines[0].y - q.lines[0].size) * sy;
        const right = Math.max(...q.lines.map((l) => l.right));
        const h = Math.max(q.size * 1.3 * q.lines.length * sy, 0.25);
        slide.addText(q.runs.length ? mergeRuns(q).map((r) => ({ text: r.str, options: { bold: r.bold, italic: r.italic, fontSize: Math.max(6, r.size * 0.98), fontFace: r.mono ? 'Courier New' : 'Arial', color: '111111', breakLine: false } })) : q.text,
          { x, y: top, w: Math.max(0.5, (right - q.x + 8) * sx), h, margin: 0, valign: 'top', fit: 'none', wrap: true });
      }
      if (p.scanned && o.background !== 'snapshot' && o.snapshots) {
        const img = await snapshotPng(p.page, 96);
        slide.addImage({ data: 'data:image/png;base64,' + b64(img.data), x: 0, y: 0, w: W, h: H });
      }
      p.page.cleanup();
    }
    const blob = await pptx.write({ outputType: 'blob' });
    warnings.push(...scannedWarning(a, o));
    warnings.push(o.background === 'snapshot'
      ? 'Each slide has the original page as a background IMAGE with the text laid over it as editable text boxes. The text is therefore duplicated (visible twice) until you delete the background image.'
      : 'Text blocks and detected tables are editable shapes. Pictures and vector graphics from the PDF are not reproduced.');
    onProgress?.(1);
    return { outputs: [{ name: `${baseName(file.name)}.pptx`, blob: blob instanceof Blob ? blob : new Blob([blob], { type: mimeFor('pptx') }), mime: mimeFor('pptx') }], warnings };
  } finally {
    a.pdf.destroy();
  }
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export { hasLib };
