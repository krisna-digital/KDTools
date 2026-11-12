// Shared PDF layout helper built on pdf-lib: fonts (embedded Liberation when fontkit is present,
// standard Helvetica otherwise), text measuring/wrapping, automatic page breaks, images, tables.

import { getPdfLib, getFontkit, getFontBytes } from '../core/loader.js';

export const PAPER = {
  a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28],
};

export function paperSize(name = 'a4', orientation = 'portrait') {
  const [w, h] = PAPER[name] || PAPER.a4;
  return orientation === 'landscape' ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)];
}

export class PdfBuilder {
  /**
   * @param {object} o  { paper, orientation, margin (pt) }
   */
  static async create(o = {}) {
    const PDFLib = await getPdfLib();
    const b = new PdfBuilder(PDFLib, o);
    await b._init();
    return b;
  }

  constructor(PDFLib, o) {
    this.L = PDFLib;
    this.opts = o;
    this.margin = o.margin ?? 54;
    [this.pw, this.ph] = paperSize(o.paper, o.orientation);
    this.fonts = {};
    this.unicode = false;
    this.page = null;
    this.y = 0;
    this.pageCount = 0;
  }

  async _init() {
    const { PDFDocument, StandardFonts } = this.L;
    this.doc = await PDFDocument.create();
    const fk = await getFontkit();
    if (fk) {
      this.doc.registerFontkit(fk);
      const f = await getFontBytes();
      const sub = { subset: true };
      this.fonts = {
        regular: await this.doc.embedFont(f.regular, sub), bold: await this.doc.embedFont(f.bold, sub),
        italic: await this.doc.embedFont(f.italic, sub), boldItalic: await this.doc.embedFont(f.boldItalic, sub),
        mono: await this.doc.embedFont(f.mono, sub), monoBold: await this.doc.embedFont(f.monoBold, sub),
      };
      this.unicode = true;
    } else {
      this.fonts = {
        regular: await this.doc.embedFont(StandardFonts.Helvetica), bold: await this.doc.embedFont(StandardFonts.HelveticaBold),
        italic: await this.doc.embedFont(StandardFonts.HelveticaOblique), boldItalic: await this.doc.embedFont(StandardFonts.HelveticaBoldOblique),
        mono: await this.doc.embedFont(StandardFonts.Courier), monoBold: await this.doc.embedFont(StandardFonts.CourierBold),
      };
    }
    this.lostChars = new Set();
  }

  font(style = {}) {
    if (style.mono) return style.bold ? this.fonts.monoBold : this.fonts.mono;
    if (style.bold && style.italic) return this.fonts.boldItalic;
    if (style.bold) return this.fonts.bold;
    if (style.italic) return this.fonts.italic;
    return this.fonts.regular;
  }

  /** Replace characters the current font cannot encode, recording what was lost. */
  clean(text, font) {
    let out = '';
    const cs = (font || this.fonts.regular).getCharacterSet?.();
    for (const ch of String(text).replace(/\t/g, '    ').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '')) {
      const cp = ch.codePointAt(0);
      const ok = cs ? cs.includes(cp) : this._winAnsi(cp);
      if (ok) out += ch;
      else {
        const rep = REPLACEMENTS[ch] ?? (/\s/.test(ch) ? ' ' : null);
        if (rep != null && (cs ? [...rep].every((c) => cs.includes(c.codePointAt(0))) : [...rep].every((c) => this._winAnsi(c.codePointAt(0))))) out += rep;
        else { out += '?'; this.lostChars.add(ch); }
      }
    }
    return out;
  }

  _winAnsi(cp) {
    if (cp >= 32 && cp < 127) return true;
    if (cp >= 160 && cp <= 255) return true;
    return WINANSI_EXTRA.has(cp);
  }

  width(text, size, style) { const f = this.font(style); return f.widthOfTextAtSize(this.clean(text, f), size); }

  newPage() {
    this.page = this.doc.addPage([this.pw, this.ph]);
    this.pageCount++;
    this.y = this.ph - this.margin;
    if (this.opts.onNewPage) this.opts.onNewPage(this);
    return this.page;
  }

  get contentWidth() { return this.pw - this.margin * 2; }
  get bottom() { return this.margin; }

  ensure(h) {
    if (!this.page) this.newPage();
    if (this.y - h < this.bottom) this.newPage();
  }

  /** Draw a single already-wrapped line at the current cursor and advance. */
  drawLine(text, { size = 11, style = {}, x = this.margin, color, lineHeight, underline = false, link } = {}) {
    const lh = lineHeight || size * 1.35;
    this.ensure(lh);
    const f = this.font(style);
    const t = this.clean(text, f);
    const { rgb } = this.L;
    const c = color ? rgb(...color) : rgb(0, 0, 0);
    this.page.drawText(t, { x, y: this.y - size, size, font: f, color: c });
    if (underline && t) {
      const w = f.widthOfTextAtSize(t, size);
      this.page.drawLine({ start: { x, y: this.y - size - 1.5 }, end: { x: x + w, y: this.y - size - 1.5 }, thickness: 0.6, color: c });
    }
    this.y -= lh;
  }

  /** Greedy word wrap for a plain string at a given width. */
  wrap(text, maxWidth, size, style = {}) {
    const f = this.font(style);
    const lines = [];
    for (const para of String(text).split(/\r\n|\r|\n/)) {
      if (para === '') { lines.push(''); continue; }
      const words = this.clean(para, f).split(/( +)/);
      let cur = '';
      for (const w of words) {
        const trial = cur + w;
        if (f.widthOfTextAtSize(trial, size) <= maxWidth || cur === '') {
          if (f.widthOfTextAtSize(trial, size) > maxWidth && cur === '') {
            // single word longer than the line: hard split
            let chunk = '';
            for (const ch of w) {
              if (f.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) { lines.push(chunk); chunk = ch; } else chunk += ch;
            }
            cur = chunk;
          } else cur = trial;
        } else {
          lines.push(cur.replace(/ +$/, ''));
          cur = w.trim() === '' ? '' : w;
        }
      }
      lines.push(cur.replace(/ +$/, ''));
    }
    return lines;
  }

  paragraph(text, { size = 11, style = {}, x = this.margin, width, color, spacingAfter = size * 0.6, lineHeight } = {}) {
    const maxW = (width ?? this.contentWidth - (x - this.margin));
    for (const l of this.wrap(text, maxW, size, style)) this.drawLine(l, { size, style, x, color, lineHeight });
    this.y -= spacingAfter;
  }

  space(h) { this.y -= h; if (this.y < this.bottom) this.newPage(); }

  async embedImage(bytes, type) {
    return type === 'png' ? this.doc.embedPng(bytes) : this.doc.embedJpg(bytes);
  }

  /** Draw an embedded image scaled to fit the available width (and the remaining page height, breaking pages if needed). */
  drawImageFit(img, { maxWidth = this.contentWidth, maxHeight = this.ph - this.margin * 2, x = this.margin } = {}) {
    let w = img.width, h = img.height;
    const s = Math.min(maxWidth / w, maxHeight / h, 1);
    w *= s; h *= s;
    this.ensure(h);
    this.page.drawImage(img, { x, y: this.y - h, width: w, height: h });
    this.y -= h + 6;
  }

  /**
   * Draw a table. rows: string[][]; header row styled bold with a fill.
   * colWidths optional (relative weights).
   */
  table(rows, { size = 9, weights, header = true, padding = 4 } = {}) {
    if (!rows.length) return;
    const cols = Math.max(...rows.map((r) => r.length));
    const total = this.contentWidth;
    let w = weights && weights.length === cols ? weights.slice() : null;
    if (!w) {
      // proportional to max content length (clamped)
      w = Array.from({ length: cols }, (_, c) => Math.min(40, Math.max(4, ...rows.slice(0, 200).map((r) => String(r[c] ?? '').length))));
    }
    const sum = w.reduce((a, b) => a + b, 0);
    const widths = w.map((x) => (x / sum) * total);
    const { rgb } = this.L;
    const lh = size * 1.25;
    const drawRow = (row, isHeader) => {
      const cells = widths.map((cw, c) => this.wrap(String(row[c] ?? ''), cw - padding * 2, size, { bold: isHeader }));
      const h = Math.max(...cells.map((l) => l.length), 1) * lh + padding * 2;
      this.ensure(h);
      let x = this.margin;
      const top = this.y;
      widths.forEach((cw, c) => {
        this.page.drawRectangle({
          x, y: top - h, width: cw, height: h, borderColor: rgb(0.75, 0.75, 0.78), borderWidth: 0.5,
          color: isHeader ? rgb(0.93, 0.94, 0.97) : undefined,
        });
        const f = this.font({ bold: isHeader });
        cells[c].forEach((line, i) => {
          this.page.drawText(line, { x: x + padding, y: top - padding - size - i * lh + 1, size, font: f, color: rgb(0.07, 0.07, 0.1) });
        });
        x += cw;
      });
      this.y -= h;
    };
    rows.forEach((r, i) => {
      const isHeader = header && i === 0;
      drawRow(r, isHeader);
    });
    this.y -= 8;
  }

  async save(meta = {}) {
    if (!this.page) this.newPage();
    if (meta.title) this.doc.setTitle(meta.title);
    this.doc.setProducer('Multi File Converter (browser)');
    this.doc.setCreator('Multi File Converter');
    return new Blob([await this.doc.save({ useObjectStreams: true })], { type: 'application/pdf' });
  }
}

const REPLACEMENTS = {
  '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"', '–': '-', '—': '-', '…': '...',
  '•': '•', '→': '->', '←': '<-', ' ': ' ', '−': '-', '✓': 'v', '✔': 'v', '­': '',
  '€': 'EUR', '™': 'TM', ' ': ' ', ' ': ' ', ' ': ' ',
};
const WINANSI_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
