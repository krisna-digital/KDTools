// DOCX / XLSX / PPTX -> PDF. Own OOXML readers (JSZip + DOMParser) + pdf-lib layout.
// This is a *structural* renderer: it keeps text, basic styling, lists, tables and embedded pictures,
// but it is not Microsoft Office's layout engine (no exact fonts, headers/footers, text boxes, charts, SmartArt, equations).

import { ConverterError, ERR, throwIfAborted } from '../core/errors.js';
import { baseName, mimeFor, parsePageRange } from '../core/format.js';
import { getJSZip, getPdfLib } from '../core/loader.js';
import { PdfBuilder } from '../lib/pdfWriter.js';
import { readXlsx } from '../lib/xlsxLite.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

async function openZip(file, requiredPath, label) {
  const JSZip = await getJSZip();
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch (e) { throw new ConverterError(ERR.CORRUPT, `Not a valid ${label} file (cannot open the ZIP package).`, { cause: e }); }
  if (!zip.file(requiredPath)) throw new ConverterError(ERR.CORRUPT, `Not a valid ${label} file (${requiredPath} missing). Legacy binary formats (.doc, .xls, .ppt) are not supported – save as ${label} first.`);
  return zip;
}
async function xml(zip, path) {
  const f = zip.file(path);
  if (!f) return null;
  const d = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  if (d.getElementsByTagName('parsererror').length) throw new ConverterError(ERR.CORRUPT, `Invalid XML in ${path}.`);
  return d;
}
const q = (el, ns, name) => [...el.getElementsByTagNameNS(ns, name)];
const child = (el, ns, name) => (el ? [...el.children].find((c) => c.localName === name && c.namespaceURI === ns) : undefined);
const kids = (el, ns, name) => [...el.children].filter((c) => c.localName === name && c.namespaceURI === ns);
const attr = (el, ns, name) => el?.getAttributeNS(ns, name) ?? el?.getAttribute(`w:${name}`) ?? null;

async function relMap(zip, relPath, baseDir) {
  const d = await xml(zip, relPath);
  const m = new Map();
  if (!d) return m;
  for (const r of d.getElementsByTagName('Relationship')) {
    let t = r.getAttribute('Target');
    if (r.getAttribute('TargetMode') === 'External') { m.set(r.getAttribute('Id'), { external: t }); continue; }
    t = t.startsWith('/') ? t.slice(1) : normalize(baseDir + t);
    m.set(r.getAttribute('Id'), { path: t, type: r.getAttribute('Type') });
  }
  return m;
}
function normalize(p) {
  const out = [];
  for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
}

async function imageBytes(zip, path) {
  const f = zip.file(path);
  if (!f) return null;
  const raw = await f.async('uint8array');
  const isPng = raw[0] === 0x89 && raw[1] === 0x50, isJpg = raw[0] === 0xff && raw[1] === 0xd8;
  if (isPng) return { bytes: raw, type: 'png' };
  if (isJpg) return { bytes: raw, type: 'jpg' };
  try { // gif/bmp/webp/tiff... -> png through the browser decoder
    const bm = await createImageBitmap(new Blob([raw]));
    const c = new OffscreenCanvas(bm.width, bm.height);
    c.getContext('2d').drawImage(bm, 0, 0);
    const b = await c.convertToBlob({ type: 'image/png' });
    return { bytes: new Uint8Array(await b.arrayBuffer()), type: 'png' };
  } catch { return null; }
}

// ---------------------------------------------------------------- DOCX

function runStyle(rPr, base = {}) {
  const s = { ...base };
  if (!rPr) return s;
  const on = (name) => { const e = child(rPr, W, name); if (!e) return undefined; const v = attr(e, W, 'val'); return !(v === '0' || v === 'false' || v === 'none'); };
  const b = on('b'); if (b !== undefined) s.bold = b;
  const i = on('i'); if (i !== undefined) s.italic = i;
  const u = on('u'); if (u !== undefined) s.underline = u;
  const sz = child(rPr, W, 'sz'); if (sz) s.size = Number(attr(sz, W, 'val')) / 2;
  const col = child(rPr, W, 'color'); const cv = attr(col, W, 'val');
  if (cv && /^[0-9a-f]{6}$/i.test(cv)) s.color = [0, 2, 4].map((k) => parseInt(cv.slice(k, k + 2), 16) / 255);
  const f = child(rPr, W, 'rFonts'); const fn = (attr(f, W, 'ascii') || '').toLowerCase();
  if (/courier|consolas|mono/.test(fn)) s.mono = true;
  if (child(rPr, W, 'vertAlign') && attr(child(rPr, W, 'vertAlign'), W, 'val') === 'superscript') s.size = (s.size || 11) * 0.7;
  return s;
}

export async function docxToPdf({ file, options: o, signal, onProgress }) {
  const zip = await openZip(file, 'word/document.xml', '.docx');
  const doc = await xml(zip, 'word/document.xml');
  const rels = await relMap(zip, 'word/_rels/document.xml.rels', 'word/');
  const styles = await xml(zip, 'word/styles.xml');
  const numbering = await xml(zip, 'word/numbering.xml');
  const warnings = [];
  const unsupported = new Set();

  // styles: id -> {rPr, pPr, basedOn, name}
  const styleMap = new Map();
  if (styles) for (const s of q(styles, W, 'style')) styleMap.set(attr(s, W, 'styleId'), s);
  const dflt = styles && q(styles, W, 'docDefaults')[0];
  const defaultSize = Number(attr(dflt && q(dflt, W, 'sz')[0], W, 'val')) / 2 || 11;
  function styleRun(id, depth = 0) {
    const s = styleMap.get(id); if (!s || depth > 8) return {};
    const base = child(s, W, 'basedOn') ? styleRun(attr(child(s, W, 'basedOn'), W, 'val'), depth + 1) : {};
    return runStyle(child(s, W, 'rPr'), base);
  }
  function styleName(id) { const s = styleMap.get(id); return s ? (attr(child(s, W, 'name'), W, 'val') || '').toLowerCase() : ''; }

  // numbering: numId -> ilvl -> {fmt}
  const nums = new Map();
  if (numbering) {
    const abs = new Map();
    for (const a of q(numbering, W, 'abstractNum')) {
      const lv = new Map();
      for (const l of kids(a, W, 'lvl')) lv.set(Number(attr(l, W, 'ilvl')), attr(child(l, W, 'numFmt'), W, 'val'));
      abs.set(attr(a, W, 'abstractNumId'), lv);
    }
    for (const n of q(numbering, W, 'num')) nums.set(attr(n, W, 'numId'), abs.get(attr(child(n, W, 'abstractNumId'), W, 'val')));
  }
  const counters = new Map();

  // page setup
  const sect = q(doc, W, 'sectPr').pop();
  const pgSz = sect && child(sect, W, 'pgSz'), pgMar = sect && child(sect, W, 'pgMar');
  const pageW = pgSz ? Number(attr(pgSz, W, 'w')) / 20 : null, pageH = pgSz ? Number(attr(pgSz, W, 'h')) / 20 : null;
  const ml = pgMar ? Number(attr(pgMar, W, 'left')) / 20 : 72;
  const b = await PdfBuilder.create({ paper: o.paper, orientation: o.orientation, margin: o.paper === 'auto' ? Math.max(36, ml) : Number(o.margin) || 60 });
  if (o.paper === 'auto' && pageW && pageH) { b.pw = pageW; b.ph = pageH; }
  b.newPage();

  async function paraRuns(p, st) {
    const runs = [];
    const walk = async (node, rs) => {
      for (const c of node.children) {
        if (c.namespaceURI !== W) { if (c.localName === 'AlternateContent') await walk(c, rs); continue; }
        if (c.localName === 'r') {
          const s = runStyle(child(c, W, 'rPr'), { ...rs, ...styleRun(attr(child(child(c, W, 'rPr') || c, W, 'rStyle'), W, 'val')) });
          for (const t of c.children) {
            if (t.namespaceURI !== W) { if (t.localName === 'AlternateContent' || t.localName === 'drawing' || t.localName === 'pict') { const img = await drawingImage(t); if (img) runs.push({ img }); else unsupported.add('drawings/shapes'); } continue; }
            if (t.localName === 't') runs.push({ text: t.textContent, ...s });
            else if (t.localName === 'tab') runs.push({ text: '    ', ...s });
            else if (t.localName === 'br') runs.push(attr(t, W, 'type') === 'page' ? { pageBreak: true } : { br: true });
            else if (t.localName === 'drawing' || t.localName === 'pict') { const img = await drawingImage(t); if (img) runs.push({ img }); else unsupported.add('drawings/shapes'); }
            else if (t.localName === 'sym') runs.push({ text: '•', ...s });
          }
        } else if (c.localName === 'hyperlink' || c.localName === 'smartTag' || c.localName === 'sdt' || c.localName === 'sdtContent' || c.localName === 'ins') {
          await walk(c, c.localName === 'hyperlink' ? { ...rs, color: [0.05, 0.3, 0.8], underline: true } : rs);
        }
      }
    };
    await walk(p, st);
    return runs;
  }

  async function drawingImage(node) {
    const blip = node.getElementsByTagNameNS(A, 'blip')[0];
    const rid = blip?.getAttributeNS(R, 'embed');
    const ext = node.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0];
    const target = rid && rels.get(rid)?.path;
    if (!target) return null;
    const im = await imageBytes(zip, target);
    if (!im) return null;
    return { ...im, w: ext ? Number(ext.getAttribute('cx')) / 12700 : null, h: ext ? Number(ext.getAttribute('cy')) / 12700 : null };
  }

  async function drawParagraph(p, { x = b.margin, width = b.contentWidth, inCell = false } = {}) {
    const pPr = child(p, W, 'pPr');
    const sid = attr(pPr && child(pPr, W, 'pStyle'), W, 'val');
    const sname = styleName(sid);
    let base = { size: defaultSize, ...styleRun(sid) };
    const hm = /heading\s*(\d)|^title$/.exec(sname);
    if (hm) { const lvl = hm[1] ? Number(hm[1]) : 0; base = { bold: true, size: [26, 20, 16, 14, 12, 11][lvl] ?? 12, ...base }; if (base.size === defaultSize) base.size = [26, 20, 16, 14, 12, 11][lvl] ?? 12; }
    const pRun = runStyle(pPr && child(pPr, W, 'rPr'), base);
    const runs = await paraRuns(p, pRun);
    const ind = pPr && child(pPr, W, 'ind');
    let left = ind ? Number(attr(ind, W, 'left') || attr(ind, W, 'start') || 0) / 20 : 0;
    const jc = attr(pPr && child(pPr, W, 'jc'), W, 'val');
    const spacing = pPr && child(pPr, W, 'spacing');
    const after = spacing && attr(spacing, W, 'after') != null ? Number(attr(spacing, W, 'after')) / 20 : 6;
    const before = spacing && attr(spacing, W, 'before') != null ? Number(attr(spacing, W, 'before')) / 20 : 0;

    // list marker
    let numPr = pPr && child(pPr, W, 'numPr');
    if (!numPr && sid) { // list defined by the paragraph style (e.g. "List Bullet")
      for (let cur = sid, d = 0; cur && !numPr && d < 6; d++) { const st = styleMap.get(cur); numPr = st && child(child(st, W, 'pPr'), W, 'numPr'); cur = st && attr(child(st, W, 'basedOn'), W, 'val'); }
    }
    let marker = null;
    if (numPr) {
      const nid = attr(child(numPr, W, 'numId'), W, 'val'), lvl = Number(attr(child(numPr, W, 'ilvl'), W, 'val') || 0);
      if (nid && nid !== '0') {
        const fmt = nums.get(nid)?.get(lvl) || 'bullet';
        const key = `${nid}:${lvl}`;
        const n = (counters.get(key) || 0) + 1; counters.set(key, n);
        for (const k of [...counters.keys()]) if (k.startsWith(nid + ':') && Number(k.split(':')[1]) > lvl) counters.delete(k);
        marker = fmt === 'bullet' ? (lvl % 2 ? '–' : '•') : fmt === 'lowerLetter' ? `${String.fromCharCode(96 + ((n - 1) % 26) + 1)}.` : fmt === 'upperLetter' ? `${String.fromCharCode(64 + ((n - 1) % 26) + 1)}.` : fmt === 'lowerRoman' || fmt === 'upperRoman' ? roman(n, fmt === 'upperRoman') : `${n}.`;
        left = Math.max(left, 18 + lvl * 18);
      }
    }
    if (before && !inCell) b.space(before);
    await layoutRuns(b, runs, { x: x + left, width: width - left, align: jc, marker, markerX: x + Math.max(0, left - 16), baseSize: base.size, pageBreakHandler: () => b.newPage() });
    if (!inCell) b.space(after); else b.y -= 2;
  }

  async function drawTable(tbl, { x = b.margin, width = b.contentWidth } = {}) {
    const rows = kids(tbl, W, 'tr');
    const grid = kids(child(tbl, W, 'tblGrid') || tbl, W, 'gridCol').map((g) => Number(attr(g, W, 'w')) / 20);
    const total = grid.reduce((a, c) => a + c, 0) || 1;
    const rowData = [];
    for (const tr of rows) {
      const cells = [];
      for (const tc of kids(tr, W, 'tc')) {
        const tcPr = child(tc, W, 'tcPr');
        const span = Number(attr(tcPr && child(tcPr, W, 'gridSpan'), W, 'val') || 1);
        cells.push({ tc, span, vmerge: attr(tcPr && child(tcPr, W, 'vMerge'), W, 'val') });
      }
      rowData.push(cells);
    }
    const pad = 3;
    for (const cells of rowData) {
      // measure: render into a scratch builder to know height
      let col = 0;
      const placed = cells.map((c) => {
        const w = (grid.slice(col, col + c.span).reduce((a, g) => a + g, 0) / total) * width || width / cells.length;
        const px = x + (grid.slice(0, col).reduce((a, g) => a + g, 0) / total) * width;
        col += c.span; return { ...c, w, px };
      });
      const heights = [];
      for (const pc of placed) {
        let h = 0;
        for (const p of kids(pc.tc, W, 'p')) h += (await layoutParagraphHeight(p, pc.w - pad * 2)) + 2;
        heights.push(h + pad * 2);
      }
      const rh = Math.max(16, ...heights);
      b.ensure(rh);
      const top = b.y;
      for (const pc of placed) {
        b.page.drawRectangle({ x: pc.px, y: top - rh, width: pc.w, height: rh, borderColor: b.L.rgb(0.6, 0.6, 0.65), borderWidth: 0.5 });
        b.y = top - pad;
        for (const p of kids(pc.tc, W, 'p')) await drawParagraph(p, { x: pc.px + pad, width: pc.w - pad * 2, inCell: true });
      }
      b.y = top - rh;
    }
    b.y -= 8;
  }

  async function layoutParagraphHeight(p, wd) {
    // approximate height using the same wrapping logic without drawing
    const pPr = child(p, W, 'pPr');
    const sid = attr(pPr && child(pPr, W, 'pStyle'), W, 'val');
    const base = { size: defaultSize, ...styleRun(sid) };
    const runs = await paraRuns(p, runStyle(pPr && child(pPr, W, 'rPr'), base));
    return measureRuns(b, runs, wd, base.size);
  }

  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const nodes = [...body.children];
  let i = 0;
  for (const n of nodes) {
    throwIfAborted(signal);
    if (n.namespaceURI !== W) continue;
    if (n.localName === 'p') await drawParagraph(n);
    else if (n.localName === 'tbl') await drawTable(n);
    else if (n.localName === 'sdt') for (const p of q(n, W, 'p')) await drawParagraph(p);
    if (++i % 25 === 0) onProgress?.(0.1 + 0.85 * i / nodes.length, `Laying out… ${i}/${nodes.length}`);
  }
  if (q(doc, W, 'footnoteReference').length) unsupported.add('footnotes');
  if (q(doc, W, 'txbxContent').length) unsupported.add('text boxes');
  if (q(doc, W, 'oMath').length) unsupported.add('equations');
  if (unsupported.size) warnings.push(`Not reproduced: ${[...unsupported].join(', ')}.`);
  warnings.push('Layout is approximate: fonts are substituted (Liberation Sans/Mono or Helvetica), and headers, footers and page numbers are not reproduced.');
  if (b.lostChars.size) warnings.push(`${b.lostChars.size} character(s) replaced by "?" (not available in the embedded font).`);
  const blob = await b.save({ title: baseName(file.name) });
  onProgress?.(1);
  return { outputs: [{ name: `${baseName(file.name)}.pdf`, blob, mime: mimeFor('pdf') }], warnings };
}

function roman(n, upper) {
  const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return (upper ? s.toUpperCase() : s) + '.';
}

/** Word-wrap a list of styled runs and draw them. */
async function layoutRuns(b, runs, { x, width, align, marker, markerX, baseSize = 11, pageBreakHandler }) {
  let line = [], lineW = 0, firstLine = true;
  const lineSize = () => Math.max(baseSize * 0.6, ...line.map((r) => r.img ? 0 : (r.size || baseSize)));
  const flush = (last) => {
    if (!line.length) return;
    const size = lineSize();
    const imgH = Math.max(0, ...line.map((r) => r.img ? r.img.drawH : 0));
    const lh = Math.max(size * 1.3, imgH + 2);
    b.ensure(lh);
    let cx = x;
    const trimmed = line.slice(); while (trimmed.length && trimmed[trimmed.length - 1].text && !trimmed[trimmed.length - 1].text.trim()) trimmed.pop();
    const used = trimmed.reduce((s, r) => s + r.w, 0);
    if (align === 'center') cx = x + (width - used) / 2; else if (align === 'right' || align === 'end') cx = x + width - used;
    const justify = align === 'both' && !last && trimmed.length > 1;
    let extra = 0;
    if (justify) { const spaces = trimmed.reduce((n, r) => n + (r.text ? (r.text.match(/ /g) || []).length : 0), 0); if (spaces) extra = (width - used) / spaces; }
    if (firstLine && marker) {
      const f = b.font({}); b.page.drawText(b.clean(marker, f), { x: markerX, y: b.y - size, size, font: f, color: b.L.rgb(0, 0, 0) });
    }
    for (const r of trimmed) {
      if (r.img) { b.page.drawImage(r.img.pdfImg, { x: cx, y: b.y - r.img.drawH, width: r.img.drawW, height: r.img.drawH }); cx += r.w; continue; }
      const f = b.font(r), t = b.clean(r.text, f);
      const sz = r.size || baseSize;
      const col = r.color ? b.L.rgb(...r.color) : b.L.rgb(0, 0, 0);
      if (extra && t.includes(' ')) {
        // draw word by word for justification
        for (const w of t.split(/( )/)) { b.page.drawText(w, { x: cx, y: b.y - size, size: sz, font: f, color: col }); cx += f.widthOfTextAtSize(w, sz) + (w === ' ' ? extra : 0); }
      } else {
        b.page.drawText(t, { x: cx, y: b.y - size, size: sz, font: f, color: col });
        if (r.underline) b.page.drawLine({ start: { x: cx, y: b.y - size - 1.5 }, end: { x: cx + r.w, y: b.y - size - 1.5 }, thickness: 0.6, color: col });
        cx += r.w;
      }
    }
    b.y -= lh; line = []; lineW = 0; firstLine = false;
  };
  for (const r of runs) {
    if (r.pageBreak) { flush(true); pageBreakHandler?.(); continue; }
    if (r.br) { flush(true); if (!line.length) b.y -= baseSize * 0.6; continue; }
    if (r.img) {
      let w = r.img.w || 200, h = r.img.h || 150;
      const s = Math.min(1, width / w, (b.ph - b.margin * 2) / h); w *= s; h *= s;
      const pdfImg = await b.embedImage(r.img.bytes, r.img.type);
      if (lineW + w > width) flush(false);
      line.push({ img: { pdfImg, drawW: w, drawH: h }, w }); lineW += w; continue;
    }
    for (const tk of r.text.split(/( +)/)) {
      if (!tk) continue;
      const w = b.width(tk, r.size || baseSize, r);
      if (lineW + w > width && line.length && tk.trim()) flush(false);
      if (!line.length && !tk.trim()) continue;
      if (w > width) { // very long token
        for (const ch of tk) { const cw = b.width(ch, r.size || baseSize, r); if (lineW + cw > width && line.length) flush(false); line.push({ ...r, text: ch, w: cw }); lineW += cw; }
      } else { line.push({ ...r, text: tk, w }); lineW += w; }
    }
  }
  if (line.length) flush(true); else if (!runs.length) { b.ensure(baseSize * 1.3); b.y -= baseSize * 1.3; }
}

async function measureRuns(b, runs, width, baseSize) {
  let lines = 1, w = 0, imgH = 0;
  for (const r of runs) {
    if (r.br || r.pageBreak) { lines++; w = 0; continue; }
    if (r.img) { imgH += Math.min(r.img.h || 100, 300); continue; }
    for (const tk of r.text.split(/( +)/)) { const tw = b.width(tk, r.size || baseSize, r); if (w + tw > width && w > 0 && tk.trim()) { lines++; w = 0; } w += tw; }
  }
  return lines * baseSize * 1.3 + imgH;
}

// ---------------------------------------------------------------- XLSX

export async function xlsxToPdf({ file, options: o, signal, onProgress }) {
  const wb = await readXlsx(file);
  const sheets = wb.sheets.filter((s) => (o.hiddenSheets || !s.hidden) && s.rows.some((r) => r.some(Boolean)));
  if (!sheets.length) throw new ConverterError(ERR.CORRUPT, 'The workbook has no visible data to print.');
  const warnings = [];
  const b = await PdfBuilder.create({ paper: o.paper, orientation: o.orientation, margin: Number(o.margin) || 36 });
  const size = Number(o.fontSize) || 9;
  let sn = 0;
  for (const s of sheets) {
    throwIfAborted(signal);
    onProgress?.(0.1 + 0.85 * sn++ / sheets.length, `Sheet "${s.name}"…`);
    if (b.page) b.newPage(); else b.newPage();
    if (o.sheetTitles) b.drawLine(s.name, { size: size + 4, style: { bold: true }, lineHeight: (size + 4) * 1.6 });
    const cols = Math.max(...s.rows.map((r) => r.length));
    // trim trailing empty columns/rows
    const rows = s.rows.map((r) => Array.from({ length: cols }, (_, c) => r[c]?.text ?? ''));
    while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
    const used = [];
    for (let c = 0; c < cols; c++) if (rows.some((r) => r[c] !== '')) used.push(c);
    const data = rows.map((r) => used.map((c) => r[c]));
    const weights = used.map((c) => Math.min(40, Math.max(4, s.colWidths[c] || Math.max(...data.map((r) => (r[used.indexOf(c)] || '').length), 4))));
    if (o.fit === 'width' || weights.reduce((a, w) => a + w, 0) * size * 0.55 > b.contentWidth * 3) {
      // very wide sheet: split columns into chunks that fit
    }
    const maxChars = Math.floor(b.contentWidth / (size * 0.5));
    let chunk = [], sum = 0; const chunks = [];
    for (let i = 0; i < used.length; i++) {
      if (sum + weights[i] > maxChars && chunk.length && o.fit === 'split') { chunks.push(chunk); chunk = []; sum = 0; }
      chunk.push(i); sum += weights[i];
    }
    if (chunk.length) chunks.push(chunk);
    chunks.forEach((idx, ci) => {
      if (ci > 0) { b.newPage(); b.drawLine(`${s.name} (continued, columns ${ci + 1}/${chunks.length})`, { size: size + 1, style: { bold: true } }); }
      b.table(data.map((r) => idx.map((i) => r[i])), { size, weights: idx.map((i) => weights[i]), header: !!o.headerRow });
    });
    if (wb.sheets.length > 1 && s.merges.length) warnings.push(`Sheet "${s.name}": merged cells are shown unmerged.`);
  }
  if (chunksNote(o)) warnings.push(chunksNote(o));
  warnings.push('Printed as plain tables: charts, images, conditional formatting and cell colours are not reproduced.');
  if (b.lostChars.size) warnings.push(`${b.lostChars.size} character(s) replaced by "?".`);
  const blob = await b.save({ title: baseName(file.name) });
  onProgress?.(1);
  return { outputs: [{ name: `${baseName(file.name)}.pdf`, blob, mime: mimeFor('pdf') }], warnings };
}
const chunksNote = (o) => (o.fit === 'split' ? 'Wide sheets are split across several pages by columns.' : '');

// ---------------------------------------------------------------- PPTX

export async function pptxToPdf({ file, options: o, signal, onProgress }) {
  const zip = await openZip(file, 'ppt/presentation.xml', '.pptx');
  const pres = await xml(zip, 'ppt/presentation.xml');
  const presRels = await relMap(zip, 'ppt/_rels/presentation.xml.rels', 'ppt/');
  const sz = pres.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldSz')[0];
  const SW = Number(sz?.getAttribute('cx') || 9144000) / 12700, SH = Number(sz?.getAttribute('cy') || 5143500) / 12700;
  const ids = [...pres.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId')].map((e) => e.getAttributeNS(R, 'id'));
  const slidePaths = ids.map((id) => presRels.get(id)?.path).filter(Boolean);
  if (!slidePaths.length) throw new ConverterError(ERR.CORRUPT, 'The presentation has no slides.');
  const pages = parsePageRange(o.slides, slidePaths.length);

  const PDFLib = await getPdfLib();
  const b = await PdfBuilder.create({ margin: 0 });
  b.pw = SW; b.ph = SH;
  const warnings = [];
  const unsupported = new Set();
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

  const hex = (el) => { const c = el && (el.getElementsByTagNameNS(A, 'srgbClr')[0]); const v = c?.getAttribute('val'); return v && /^[0-9a-f]{6}$/i.test(v) ? [0, 2, 4].map((k) => parseInt(v.slice(k, k + 2), 16) / 255) : null; };
  const xf = (spPr) => {
    const x = spPr && spPr.getElementsByTagNameNS(A, 'xfrm')[0];
    const off = x?.getElementsByTagNameNS(A, 'off')[0], ext = x?.getElementsByTagNameNS(A, 'ext')[0];
    if (!off || !ext) return null;
    return { x: Number(off.getAttribute('x')) / 12700, y: Number(off.getAttribute('y')) / 12700, w: Number(ext.getAttribute('cx')) / 12700, h: Number(ext.getAttribute('cy')) / 12700 };
  };

  // Find the position of a placeholder in the layout, then in the master (matching by idx, else by type).
  function inheritedBox(sh, layoutDoc, masterDoc) {
    const ph = sh.getElementsByTagNameNS(P, 'ph')[0];
    if (!ph) return null;
    const idx = ph.getAttribute('idx'), type = ph.getAttribute('type') || (idx ? null : 'body');
    for (const d of [layoutDoc, masterDoc]) {
      if (!d) continue;
      for (const cand of d.getElementsByTagNameNS(P, 'sp')) {
        const cp = cand.getElementsByTagNameNS(P, 'ph')[0];
        if (!cp) continue;
        const match = (idx && cp.getAttribute('idx') === idx) || (type && cp.getAttribute('type') === type) || (type === 'ctrTitle' && cp.getAttribute('type') === 'title');
        if (!match) continue;
        const bx = xf([...cand.children].find((c) => c.localName === 'spPr'));
        if (bx) return bx;
      }
    }
    return null;
  }

  let k = 0;
  for (const n of pages) {
    throwIfAborted(signal);
    onProgress?.(0.05 + 0.9 * k++ / pages.length, `Slide ${n} of ${slidePaths.length}…`);
    const path = slidePaths[n - 1];
    const sd = await xml(zip, path);
    const srels = await relMap(zip, path.replace(/([^/]+)$/, '_rels/$1.rels'), path.replace(/[^/]+$/, ''));
    const layoutRel = [...srels.values()].find((r) => /slideLayout$/.test(r.type || ''));
    const layoutDoc = layoutRel ? await xml(zip, layoutRel.path) : null;
    const lrels = layoutRel ? await relMap(zip, layoutRel.path.replace(/([^/]+)$/, '_rels/$1.rels'), layoutRel.path.replace(/[^/]+$/, '')) : new Map();
    const masterRel = [...lrels.values()].find((r) => /slideMaster$/.test(r.type || ''));
    const masterDoc = masterRel ? await xml(zip, masterRel.path) : null;
    const page = b.doc.addPage([SW, SH]);
    b.page = page; b.pageCount++;
    // background
    const bg = sd.getElementsByTagNameNS(P, 'bg')[0];
    const bgc = bg && hex(bg);
    if (bgc) page.drawRectangle({ x: 0, y: 0, width: SW, height: SH, color: PDFLib.rgb(...bgc) });
    const tree = sd.getElementsByTagNameNS(P, 'spTree')[0];
    const shapes = tree ? [...tree.children] : [];
    for (const sh of shapes) {
      const ln = sh.localName;
      if (ln === 'sp') {
        const spPr = [...sh.children].find((c) => c.localName === 'spPr');
        const box = xf(spPr) || inheritedBox(sh, layoutDoc, masterDoc);
        if (!box) { unsupported.add('shapes without a resolvable position'); continue; }
        const fill = spPr && [...spPr.children].find((c) => c.localName === 'solidFill');
        const fc = fill && hex(fill);
        if (fc) page.drawRectangle({ x: box.x, y: SH - box.y - box.h, width: box.w, height: box.h, color: PDFLib.rgb(...fc) });
        const tb = [...sh.children].find((c) => c.localName === 'txBody');
        if (tb) drawText(tb, box);
      } else if (ln === 'pic') {
        const box = xf([...sh.children].find((c) => c.localName === 'spPr'));
        const rid = sh.getElementsByTagNameNS(A, 'blip')[0]?.getAttributeNS(R, 'embed');
        const target = rid && srels.get(rid)?.path;
        const im = target && await imageBytes(zip, target);
        if (box && im) { const img = await b.embedImage(im.bytes, im.type); page.drawImage(img, { x: box.x, y: SH - box.y - box.h, width: box.w, height: box.h }); } else unsupported.add('some pictures');
      } else if (ln === 'graphicFrame') {
        const tbl = sh.getElementsByTagNameNS(A, 'tbl')[0];
        const xfe = [...sh.children].find((c) => c.localName === 'xfrm');
        const off = xfe?.getElementsByTagNameNS(A, 'off')[0], ext = xfe?.getElementsByTagNameNS(A, 'ext')[0];
        if (tbl && off && ext) {
          const box = { x: Number(off.getAttribute('x')) / 12700, y: Number(off.getAttribute('y')) / 12700, w: Number(ext.getAttribute('cx')) / 12700, h: Number(ext.getAttribute('cy')) / 12700 };
          const rows = [...tbl.getElementsByTagNameNS(A, 'tr')].map((tr) => [...tr.getElementsByTagNameNS(A, 'tc')].map((tc) => tc.textContent.trim()));
          const cols = Math.max(...rows.map((r) => r.length)); const cw = box.w / cols, rh = box.h / rows.length;
          rows.forEach((r, ri) => r.forEach((t, ci) => { const x0 = box.x + ci * cw, y0 = SH - box.y - (ri + 1) * rh; page.drawRectangle({ x: x0, y: y0, width: cw, height: rh, borderColor: PDFLib.rgb(0.6, 0.6, 0.65), borderWidth: 0.5 }); const sz2 = Math.min(12, rh * 0.45); const lines = b.wrap(t, cw - 6, sz2); lines.slice(0, Math.max(1, Math.floor(rh / (sz2 * 1.2)))).forEach((l, li) => page.drawText(l, { x: x0 + 3, y: y0 + rh - 3 - sz2 - li * sz2 * 1.2, size: sz2, font: b.font({}), color: PDFLib.rgb(0, 0, 0) })); }));
        } else unsupported.add('charts/SmartArt/embedded objects');
      } else if (ln === 'grpSp') unsupported.add('grouped shapes');
    }
    // notes are not exported
    function drawText(tb, box) {
      let y = SH - box.y - 4;
      for (const p of tb.getElementsByTagNameNS(A, 'p')) {
        const pPr = [...p.children].find((c) => c.localName === 'pPr');
        const algn = pPr?.getAttribute('algn');
        const runs = [];
        for (const r of p.children) {
          if (r.localName !== 'r' && r.localName !== 'fld') continue;
          const rPr = [...r.children].find((c) => c.localName === 'rPr');
          const t = [...r.children].find((c) => c.localName === 't')?.textContent || '';
          runs.push({ text: t, size: rPr?.getAttribute('sz') ? Number(rPr.getAttribute('sz')) / 100 : 18, bold: rPr?.getAttribute('b') === '1', italic: rPr?.getAttribute('i') === '1', color: hex(rPr) });
        }
        const text = runs.map((r) => r.text).join('');
        const size = Math.max(...runs.map((r) => r.size), 12);
        const eff = Math.min(size, 60);
        const lines = b.wrap(text, box.w - 8, eff, { bold: runs[0]?.bold });
        for (const l of lines) {
          if (y - eff < SH - box.y - box.h - 4) break; // clip to the box
          const f = b.font({ bold: runs[0]?.bold, italic: runs[0]?.italic });
          const t = b.clean(l, f); const w = f.widthOfTextAtSize(t, eff);
          const x = algn === 'ctr' ? box.x + (box.w - w) / 2 : algn === 'r' ? box.x + box.w - w - 4 : box.x + 4;
          page.drawText(t, { x, y: y - eff, size: eff, font: f, color: PDFLib.rgb(...(runs[0]?.color || [0, 0, 0])) });
          y -= eff * 1.2;
        }
      }
    }
  }
  if (unsupported.size) warnings.push(`Not reproduced: ${[...unsupported].join(', ')}.`);
  warnings.push('Slides are rebuilt from shape positions and text. Positions of placeholders are taken from layouts/masters, but inherited text sizes, theme fonts, gradients, animations, charts and WordArt are not reproduced – compare the result with the original.');
  if (b.lostChars.size) warnings.push(`${b.lostChars.size} character(s) replaced by "?".`);
  const blob = await b.save({ title: baseName(file.name) });
  onProgress?.(1);
  return { outputs: [{ name: `${baseName(file.name)}.pdf`, blob, mime: mimeFor('pdf') }], warnings };
}
