// Create PDFs from images, plain text and HTML (text stays real, selectable text).

import { ConverterError, ERR, throwIfAborted } from '../core/errors.js';
import { baseName, mimeFor, extOf } from '../core/format.js';
import { PdfBuilder, paperSize } from '../lib/pdfWriter.js';
import { decodeText } from '../lib/csv.js';
import { getPdfLib } from '../core/loader.js';

// ---------- image -> PDF ----------

async function imageToPdfBytes(file, o) {
  // Re-encode via canvas unless the file is already a plain PNG/JPEG we can embed as-is.
  const ext = extOf(file.name);
  const raw = new Uint8Array(await file.arrayBuffer());
  const isJpg = raw[0] === 0xff && raw[1] === 0xd8;
  const isPng = raw[0] === 0x89 && raw[1] === 0x50;
  const q = (Number(o.quality) || 85) / 100;
  if (isJpg && q >= 0.95 && !o.maxImageWidth) return { bytes: raw, type: 'jpg' };
  const bm = await createImageBitmap(file).catch((e) => { throw new ConverterError(ERR.CORRUPT, 'The image could not be decoded.', { cause: e }); });
  let { width: w, height: h } = bm;
  const maxW = Number(o.maxImageWidth) || 0;
  if (maxW && w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  const keepAlpha = isPng && ext === 'png' && !o.flatten;
  if (!keepAlpha) { ctx.fillStyle = o.background || '#ffffff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bm, 0, 0, w, h);
  bm.close?.();
  const blob = keepAlpha ? await c.convertToBlob({ type: 'image/png' }) : await c.convertToBlob({ type: 'image/jpeg', quality: q });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: keepAlpha ? 'png' : 'jpg' };
}

/** Several images -> one PDF (merge) or one PDF per image. Called with all files of the tool at once when merging. */
export async function imagesToPdf({ files, options: o, signal, onProgress }) {
  const PDFLib = await getPdfLib();
  const doc = await PDFLib.PDFDocument.create();
  const [bw, bh] = paperSize(o.paper === 'fit' ? 'a4' : o.paper, o.orientation === 'landscape' ? 'landscape' : 'portrait');
  let i = 0;
  for (const f of files) {
    throwIfAborted(signal);
    const { bytes, type } = await imageToPdfBytes(f, o);
    const img = type === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    let pw, ph;
    if (o.paper === 'fit') { pw = img.width * 0.75; ph = img.height * 0.75; } // 96 dpi px -> pt
    else {
      let [w, h] = [bw, bh];
      if (o.orientation === 'auto' && img.width > img.height) [w, h] = [Math.max(bw, bh), Math.min(bw, bh)];
      pw = w; ph = h;
    }
    const page = doc.addPage([pw, ph]);
    const m = o.paper === 'fit' ? 0 : (Number(o.margin) || 0);
    const availW = pw - m * 2, availH = ph - m * 2;
    const s = o.paper === 'fit' ? 1 : (o.scaleMode === 'fill' ? Math.max(availW / img.width, availH / img.height) : Math.min(availW / img.width, availH / img.height, o.noUpscale ? 0.75 : Infinity));
    const dw = img.width * (o.paper === 'fit' ? 0.75 : s), dh = img.height * (o.paper === 'fit' ? 0.75 : s);
    page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
    onProgress?.(++i / files.length, `Page ${i} of ${files.length}`);
  }
  doc.setProducer('Multi File Converter (browser)');
  const blob = new Blob([await doc.save()], { type: 'application/pdf' });
  return blob;
}

export async function imageToPdf({ file, options, signal, onProgress }) {
  const blob = await imagesToPdf({ files: [file], options, signal, onProgress });
  return { outputs: [{ name: `${baseName(file.name)}.pdf`, blob, mime: mimeFor('pdf') }], warnings: [] };
}

// ---------- TXT -> PDF ----------

export async function txtToPdf({ file, options: o, onProgress }) {
  const text = decodeText(await file.arrayBuffer(), o.encoding);
  onProgress?.(0.2, 'Laying out text…');
  const b = await PdfBuilder.create({ paper: o.paper, orientation: o.orientation, margin: Number(o.margin) || 54 });
  const size = Number(o.fontSize) || 11;
  const style = { mono: o.font === 'mono' };
  const lh = size * (Number(o.lineHeight) || 1.4);
  b.newPage();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const total = lines.length;
  let n = 0;
  for (const line of lines) {
    const wrapped = o.wrap === false ? [line] : b.wrap(line, b.contentWidth, size, style);
    for (const w of wrapped) b.drawLine(w, { size, style, lineHeight: lh });
    if (++n % 500 === 0) onProgress?.(0.2 + 0.7 * n / total);
  }
  const warnings = [];
  if (b.lostChars.size) warnings.push(`${b.lostChars.size} character(s) could not be shown with the built-in font and were replaced by "?": ${[...b.lostChars].slice(0, 12).join(' ')}`);
  const blob = await b.save({ title: baseName(file.name) });
  onProgress?.(1);
  return { outputs: [{ name: `${baseName(file.name)}.pdf`, blob, mime: mimeFor('pdf') }], warnings };
}

// ---------- HTML -> PDF (structural renderer, not a browser print engine) ----------

const SKIP = new Set(['script', 'style', 'head', 'noscript', 'template', 'iframe', 'object', 'embed', 'canvas', 'svg', 'form', 'button', 'select', 'textarea', 'input', 'nav']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'blockquote', 'pre', 'ul', 'ol', 'li', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'address', 'details', 'summary', 'body', 'html']);
const H_SIZE = { h1: 24, h2: 19, h3: 16, h4: 13.5, h5: 12, h6: 11 };

function parseColor(s) {
  if (!s) return null;
  const el = parseColor.el ||= document.createElement('span');
  el.style.color = ''; el.style.color = s;
  if (!el.style.color) return null;
  document.body.appendChild(el);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).color);
  el.remove();
  return m ? [m[1] / 255, m[2] / 255, m[3] / 255] : null;
}

export async function htmlToPdf({ file, options: o, signal, onProgress }) {
  const html = decodeText(await file.arrayBuffer(), o.encoding);
  const doc = new DOMParser().parseFromString(html, 'text/html'); // inert: scripts never run
  const b = await PdfBuilder.create({ paper: o.paper, orientation: o.orientation, margin: Number(o.margin) || 50 });
  const base = Number(o.fontSize) || 11;
  const warnings = [];
  const unsupported = new Set();
  b.newPage();

  // Inline flattening: produce runs [{text, bold, italic, mono, color, href}]
  function runsOf(node, st = {}, out = []) {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        const t = c.textContent.replace(/\s+/g, ' ');
        if (t) out.push({ text: t, ...st });
      } else if (c.nodeType === 1) {
        const tag = c.localName;
        if (SKIP.has(tag)) { if (tag !== 'head') unsupported.add(tag); continue; }
        if (tag === 'br') { out.push({ br: true }); continue; }
        if (tag === 'img') { out.push({ img: c }); continue; }
        if (BLOCK.has(tag) && tag !== 'li') { out.push({ block: c }); continue; }
        const ns = { ...st };
        if (['b', 'strong', 'th'].includes(tag) || /^h\d$/.test(tag)) ns.bold = true;
        if (['i', 'em', 'cite', 'dfn', 'var'].includes(tag)) ns.italic = true;
        if (['code', 'kbd', 'samp', 'tt'].includes(tag)) ns.mono = true;
        if (tag === 'a' && c.getAttribute('href')) { ns.underline = true; ns.color = [0.05, 0.3, 0.8]; }
        if (c.style?.fontWeight === 'bold' || Number(c.style?.fontWeight) >= 600) ns.bold = true;
        if (c.style?.fontStyle === 'italic') ns.italic = true;
        const col = parseColor(c.style?.color); if (col) ns.color = col;
        runsOf(c, ns, out);
      }
    }
    return out;
  }

  async function drawInline(node, { size, x, width, style = {}, spacingAfter }) {
    const runs = runsOf(node, style);
    let line = []; let lineW = 0;
    const flush = () => {
      if (!line.length) return;
      b.ensure(size * 1.4);
      let cx = x;
      for (const r of line) {
        const f = b.font(r);
        const t = b.clean(r.text, f);
        if (!t) continue;
        const w = f.widthOfTextAtSize(t, size);
        b.page.drawText(t, { x: cx, y: b.y - size, size, font: f, color: b.L.rgb(...(r.color || [0.07, 0.07, 0.1])) });
        if (r.underline) b.page.drawLine({ start: { x: cx, y: b.y - size - 1.5 }, end: { x: cx + w, y: b.y - size - 1.5 }, thickness: 0.6, color: b.L.rgb(...(r.color || [0, 0, 0])) });
        cx += w;
      }
      b.y -= size * 1.4; line = []; lineW = 0;
    };
    for (const r of runs) {
      if (r.br) { flush(); continue; }
      if (r.block) { flush(); await drawBlock(r.block, { x, width, size, style }); continue; }
      if (r.img) { flush(); await drawImg(r.img, x, width); continue; }
      const tokens = r.text.split(/(\s+)/);
      for (const tk of tokens) {
        if (!tk) continue;
        if (/^\s+$/.test(tk) && !line.length) continue;
        const w = b.width(tk, size, r);
        if (lineW + w > width && line.length && tk.trim()) flush();
        if (/^\s+$/.test(tk) && !line.length) continue;
        line.push({ ...r, text: tk }); lineW += w;
      }
    }
    flush();
    b.y -= spacingAfter ?? size * 0.5;
  }

  async function drawImg(el, x, width) {
    const src = el.getAttribute('src') || '';
    if (!src.startsWith('data:image/')) { unsupported.add('external images'); return; }
    try {
      const blob = await (await fetch(src)).blob();
      const bm = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bm.width, bm.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, bm.width, bm.height); ctx.drawImage(bm, 0, 0);
      const png = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      const img = await b.embedImage(png, 'png');
      b.drawImageFit(img, { maxWidth: width, x });
    } catch { unsupported.add('undecodable images'); }
  }

  async function drawList(el, ordered, x, width, size, depth = 0) {
    let i = Number(el.getAttribute('start')) || 1;
    for (const li of el.children) {
      if (li.localName !== 'li') continue;
      const bullet = ordered ? `${i++}.` : (depth % 2 ? '–' : '•');
      b.ensure(size * 1.4);
      const startY = b.y;
      const f = b.font({});
      b.page.drawText(b.clean(bullet, f), { x: x + 4, y: startY - size, size, font: f, color: b.L.rgb(0.07, 0.07, 0.1) });
      // nested lists are handled as blocks inside inline flow
      await drawInline(li, { size, x: x + 22, width: width - 22, spacingAfter: size * 0.2 });
    }
    b.y -= size * 0.4;
  }

  function tableRows(el) {
    const rows = [];
    for (const tr of el.querySelectorAll('tr')) {
      if (tr.closest('table') !== el) continue;
      rows.push([...tr.children].filter((c) => /^(td|th)$/.test(c.localName)).map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
    }
    return rows;
  }

  async function drawBlock(el, ctx) {
    const tag = el.localName;
    if (SKIP.has(tag)) { unsupported.add(tag); return; }
    if (el.hasAttribute?.('hidden') || el.style?.display === 'none') return;
    const { x, width } = ctx;
    if (H_SIZE[tag]) { b.y -= H_SIZE[tag] * 0.4; await drawInline(el, { size: H_SIZE[tag] * (base / 11), x, width, style: { bold: true }, spacingAfter: H_SIZE[tag] * 0.3 }); return; }
    if (tag === 'hr') { b.ensure(10); b.page.drawLine({ start: { x, y: b.y - 4 }, end: { x: x + width, y: b.y - 4 }, thickness: 0.7, color: b.L.rgb(0.7, 0.7, 0.75) }); b.y -= 12; return; }
    if (tag === 'ul' || tag === 'ol') { await drawList(el, tag === 'ol', x, width, base); return; }
    if (tag === 'table') { const rows = tableRows(el); const hasTh = !!el.querySelector('th'); b.table(rows, { size: base * 0.85, header: hasTh }); return; }
    if (tag === 'pre') {
      for (const l of el.textContent.replace(/\n$/, '').split('\n')) for (const w of b.wrap(l, width - 12, base * 0.85, { mono: true })) b.drawLine(w, { size: base * 0.85, style: { mono: true }, x: x + 6 });
      b.y -= base * 0.6; return;
    }
    if (tag === 'blockquote') {
      const y0 = b.y; await drawInline(el, { size: base, x: x + 18, width: width - 18, style: { italic: true } });
      if (b.y < y0) b.page.drawLine({ start: { x: x + 6, y: y0 }, end: { x: x + 6, y: b.y + 6 }, thickness: 2, color: b.L.rgb(0.75, 0.78, 0.85) });
      return;
    }
    // generic container: if it holds block children, recurse; otherwise paragraph
    const hasBlockChild = [...el.children].some((c) => BLOCK.has(c.localName));
    if (hasBlockChild) {
      // mixed content: iterate child nodes keeping inline text together
      let buf = [];
      const flushBuf = async () => {
        if (!buf.length) return;
        const wrap = document.createElement('div'); buf.forEach((n) => wrap.appendChild(n.cloneNode(true)));
        if (wrap.textContent.trim() || wrap.querySelector('img')) await drawInline(wrap, { size: base, x, width });
        buf = [];
      };
      for (const c of el.childNodes) {
        if (c.nodeType === 1 && BLOCK.has(c.localName)) { await flushBuf(); await drawBlock(c, ctx); }
        else buf.push(c);
      }
      await flushBuf();
    } else {
      if (el.textContent.trim() || el.querySelector('img')) await drawInline(el, { size: base, x, width });
    }
  }

  if (doc.title && o.showTitle) b.paragraph(doc.title, { size: base * 1.8, style: { bold: true } });
  await drawBlock(doc.body, { x: b.margin, width: b.contentWidth, size: base });
  throwIfAborted(signal);

  if (unsupported.size) warnings.push(`Not rendered: ${[...unsupported].join(', ')}. This converter lays out the HTML structure (headings, paragraphs, lists, tables, inline images, basic emphasis) but does not run CSS layout or scripts; the result will not match a browser's rendering.`);
  else warnings.push('HTML is laid out structurally (no full CSS layout, no scripts). Complex page designs will look simpler than in a browser.');
  if (b.lostChars.size) warnings.push(`${b.lostChars.size} character(s) were replaced by "?" (not supported by the embedded font).`);
  const blob = await b.save({ title: doc.title || baseName(file.name) });
  onProgress?.(1);
  return { outputs: [{ name: `${baseName(file.name)}.pdf`, blob, mime: mimeFor('pdf') }], warnings };
}
