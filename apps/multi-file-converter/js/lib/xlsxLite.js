// Minimal, dependency-free (except JSZip) XLSX reader and writer.
// Reader: sheets, shared strings, cached formula values, number/date formatting, column widths.
// Writer: values, bold header, freeze panes, column widths, dates.
// Limits: no charts, images, pivot tables, conditional formatting; formulas are read as their cached values.

import { getJSZip } from '../core/loader.js';
import { ConverterError, ERR } from '../core/errors.js';

const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function parseXml(text, what) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ConverterError(ERR.CORRUPT, `Invalid XML in ${what}.`);
  return doc;
}
const kids = (el, name) => [...el.children].filter((c) => c.localName === name);

export function colToIndex(ref) {
  let n = 0;
  for (const ch of ref.toUpperCase()) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); }
  return n - 1;
}
export function indexToCol(i) {
  let s = ''; i++;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// ---------------- number / date formatting ----------------

const BUILTIN_FMT = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00',
  14: 'yyyy-mm-dd', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'yyyy-mm-dd h:mm',
  37: '#,##0;(#,##0)', 38: '#,##0;(#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;(#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 49: '@',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function stripFmt(code) {
  // remove colors/conditions/locale; keep currency symbol from [$€-407]
  return code
    .replace(/\[(Red|Black|Blue|Green|Cyan|Magenta|White|Yellow|Color\d+)\]/gi, '')
    .replace(/\[[<>=][^\]]*\]/g, '')
    .replace(/\[\$([^\]-]*)(-[^\]]*)?\]/g, '"$1"');
}

function isDateFormat(code) {
  const c = stripFmt(code).replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, (m) => (/^\[(h+|m+|s+)\]$/i.test(m) ? 'h' : ''));
  return /[ymdhs]/i.test(c) && !/^General$/i.test(c.trim());
}

function serialToDate(serial, date1904) {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(serial * 86400000));
}

function formatDate(serial, code, date1904) {
  const d = serialToDate(serial, date1904);
  const src = stripFmt(code);
  const tokens = [];
  const re = /"([^"]*)"|\\(.)|\[(h+|m+|s+)\]|(AM\/PM|A\/P|yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|\.0+)|(.)/gi;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] != null) tokens.push({ lit: m[1] });
    else if (m[2] != null) tokens.push({ lit: m[2] });
    else if (m[3]) tokens.push({ t: m[3][0].toLowerCase(), elapsed: true, n: m[3].length });
    else if (m[4]) tokens.push({ t: m[4].toLowerCase() });
    else tokens.push({ lit: m[5] });
  }
  const hasAmPm = tokens.some((t) => t.t === 'am/pm' || t.t === 'a/p');
  // m after h or before s means minutes
  tokens.forEach((t, i) => {
    if (t.t && /^m+$/.test(t.t) && t.t.length <= 2) {
      const prev = tokens.slice(0, i).reverse().find((x) => x.t);
      const next = tokens.slice(i + 1).find((x) => x.t);
      if ((prev && /^h/.test(prev.t)) || (next && /^s/.test(next.t))) t.minute = true;
    }
  });
  const p2 = (n) => String(n).padStart(2, '0');
  const H = d.getUTCHours(), Mi = d.getUTCMinutes(), S = d.getUTCSeconds();
  return tokens.map((t) => {
    if (t.lit != null) return t.lit;
    if (t.elapsed) {
      const total = serial * 24;
      const v = t.t === 'h' ? Math.floor(total) : t.t === 'm' ? Math.floor(total * 60) : Math.floor(total * 3600);
      return String(v).padStart(t.n, '0');
    }
    switch (t.t) {
      case 'yyyy': return String(d.getUTCFullYear());
      case 'yy': return p2(d.getUTCFullYear() % 100);
      case 'mmmmm': return MONTHS[d.getUTCMonth()][0];
      case 'mmmm': return MONTHS[d.getUTCMonth()];
      case 'mmm': return MONTHS[d.getUTCMonth()].slice(0, 3);
      case 'mm': return t.minute ? p2(Mi) : p2(d.getUTCMonth() + 1);
      case 'm': return t.minute ? String(Mi) : String(d.getUTCMonth() + 1);
      case 'dddd': return DAYS[d.getUTCDay()];
      case 'ddd': return DAYS[d.getUTCDay()].slice(0, 3);
      case 'dd': return p2(d.getUTCDate());
      case 'd': return String(d.getUTCDate());
      case 'hh': return p2(hasAmPm ? (H % 12 || 12) : H);
      case 'h': return String(hasAmPm ? (H % 12 || 12) : H);
      case 'ss': return p2(S);
      case 's': return String(S);
      case 'am/pm': return H < 12 ? 'AM' : 'PM';
      case 'a/p': return H < 12 ? 'A' : 'P';
      default:
        if (t.t?.startsWith('.')) return '.' + String(d.getUTCMilliseconds()).padStart(3, '0').slice(0, t.t.length - 1);
        return '';
    }
  }).join('');
}

function groupThousands(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function formatNumberCode(value, code) {
  let sections = stripFmt(code).split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  let sec = sections[0];
  let neg = value < 0;
  if (sections.length > 1) {
    if (value === 0 && sections[2] != null) sec = sections[2];
    else if (neg) { sec = sections[1]; neg = false; value = Math.abs(value); /* section supplies its own sign style */ sec = sections[1]; }
  }
  const abs = Math.abs(value);
  // locate the numeric placeholder run
  const m = /([#0?,]*\.?[#0?]*(?:E[+-]0+)?%?)/.exec(sec.replace(/"[^"]*"/g, (s) => '\u0001'.repeat(s.length)));
  // fall back to general
  if (!m || !/[#0?]/.test(m[0])) return null;
  const start = m.index, end = start + m[0].length;
  const prefix = sec.slice(0, start), suffix = sec.slice(end);
  let ph = m[0];
  const pct = ph.includes('%') || suffix.includes('%');
  ph = ph.replace('%', '');
  let num = pct ? abs * 100 : abs;
  let body;
  if (/E[+-]0+/i.test(ph)) {
    const decimals = (/\.([#0]*)/.exec(ph)?.[1] || '').length;
    const expDigits = /E[+-](0+)/i.exec(ph)[1].length;
    const [mant, exp] = num.toExponential(decimals).split('e');
    body = `${mant}E${exp[0]}${exp.slice(1).padStart(expDigits, '0')}`;
  } else {
    const decimals = (/\.([#0?]*)/.exec(ph)?.[1] || '').length;
    const minDecimals = (/\.([#0?]*)/.exec(ph)?.[1] || '').replace(/#/g, '').length;
    let s = num.toFixed(decimals);
    if (decimals > minDecimals && s.includes('.')) {
      s = s.replace(/0+$/, '');
      const have = s.split('.')[1]?.length || 0;
      if (have < minDecimals) s += '0'.repeat(minDecimals - have);
      if (s.endsWith('.')) s = s.slice(0, -1);
    }
    let [ip, dp] = s.split('.');
    const intPlaceholder = (ph.split('.')[0] || '');
    const minInt = (intPlaceholder.match(/0/g) || []).length;
    if (ip === '0' && minInt === 0 && !/0/.test(intPlaceholder) && /#/.test(intPlaceholder) && dp) ip = '';
    ip = ip.padStart(minInt, '0');
    if (ph.includes(',')) ip = groupThousands(ip);
    body = dp ? `${ip}.${dp}` : ip;
  }
  const lit = (t) => t.replace(/\u0001+/g, '').replace(/\\(.)/g, '$1').replace(/_./g, ' ').replace(/\*./g, '').replace(/"/g, '');
  // restore literals (quoted text was masked: re-read from original)
  const restore = (part, offset) => {
    const orig = sec.slice(offset, offset + part.length);
    return orig.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1').replace(/_./g, ' ').replace(/\*./g, '');
  };
  void lit;
  const sign = neg && !(sections.length > 1) ? '-' : (value < 0 && sections.length > 1 && sections[1] && !/[()]/.test(sections[1]) ? '-' : '');
  return sign + restore(prefix, 0) + body + restore(suffix, end);
}

export function formatCell(value, code, date1904) {
  if (typeof value !== 'number') return String(value ?? '');
  if (!code || code === 'General') {
    if (Number.isInteger(value)) return String(value);
    return String(Number(value.toPrecision(11)));
  }
  if (code === '@') return String(value);
  if (isDateFormat(code)) {
    try { return formatDate(value, code, date1904); } catch { /* fall through */ }
  }
  try {
    const f = formatNumberCode(value, code);
    if (f != null) return f;
  } catch { /* fall through */ }
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(11)));
}

// ---------------- reader ----------------

/**
 * @returns {Promise<{sheets:{name:string, hidden:boolean, rows:Array<Array<{v:any,t:string,text:string}|null>>, colWidths:number[], merges:string[]}[], date1904:boolean}>}
 */
export async function readXlsx(data) {
  const JSZip = await getJSZip();
  let zip;
  try { zip = await JSZip.loadAsync(data); } catch (e) { throw new ConverterError(ERR.CORRUPT, 'Not a valid XLSX (ZIP) package.', { cause: e }); }
  const wbFile = zip.file('xl/workbook.xml');
  if (!wbFile) throw new ConverterError(ERR.CORRUPT, 'xl/workbook.xml is missing – this is not an .xlsx workbook (legacy .xls is not supported).');
  const wb = parseXml(await wbFile.async('string'), 'workbook.xml');
  const date1904 = wb.getElementsByTagName('workbookPr')[0]?.getAttribute('date1904') === '1';

  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  const rels = new Map();
  if (relsFile) {
    const rd = parseXml(await relsFile.async('string'), 'workbook rels');
    for (const r of rd.getElementsByTagName('Relationship')) {
      let t = r.getAttribute('Target');
      t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      rels.set(r.getAttribute('Id'), t);
    }
  }

  // shared strings
  const shared = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const sd = parseXml(await ssFile.async('string'), 'sharedStrings.xml');
    for (const si of sd.getElementsByTagName('si')) {
      let s = '';
      const collect = (el) => {
        for (const c of el.children) {
          if (c.localName === 't') s += c.textContent;
          else if (c.localName === 'r') collect(c);
        }
      };
      collect(si);
      shared.push(s);
    }
  }

  // styles -> number format code per cell style index
  const xfFormats = [];
  const stFile = zip.file('xl/styles.xml');
  if (stFile) {
    const sd = parseXml(await stFile.async('string'), 'styles.xml');
    const custom = new Map();
    for (const nf of sd.getElementsByTagName('numFmt')) custom.set(Number(nf.getAttribute('numFmtId')), nf.getAttribute('formatCode'));
    const cellXfs = sd.getElementsByTagName('cellXfs')[0];
    if (cellXfs) for (const xf of kids(cellXfs, 'xf')) {
      const id = Number(xf.getAttribute('numFmtId') || 0);
      xfFormats.push(custom.get(id) ?? BUILTIN_FMT[id] ?? 'General');
    }
  }

  const sheets = [];
  const sheetEls = [...wb.getElementsByTagName('sheet')];
  for (const sh of sheetEls) {
    const name = sh.getAttribute('name');
    const hidden = (sh.getAttribute('state') || 'visible') !== 'visible';
    const rid = sh.getAttributeNS(NS_REL, 'id') || sh.getAttribute('r:id');
    const path = rels.get(rid);
    const f = path && zip.file(path);
    if (!f) continue;
    const sd = parseXml(await f.async('string'), `sheet "${name}"`);
    const rows = [];
    let maxCol = 0;
    for (const c of sd.getElementsByTagName('c')) {
      const ref = c.getAttribute('r');
      const mm = /^([A-Z]+)(\d+)$/.exec(ref || '');
      if (!mm) continue;
      const ci = colToIndex(mm[1]), ri = Number(mm[2]) - 1;
      const t = c.getAttribute('t') || 'n';
      const vEl = kids(c, 'v')[0];
      let raw = vEl?.textContent ?? '';
      let value, type;
      if (t === 's') { value = shared[Number(raw)] ?? ''; type = 's'; }
      else if (t === 'inlineStr') { value = [...c.getElementsByTagName('t')].map((x) => x.textContent).join(''); type = 's'; }
      else if (t === 'str') { value = raw; type = 's'; }
      else if (t === 'b') { value = raw === '1'; type = 'b'; }
      else if (t === 'e') { value = raw; type = 'e'; }
      else if (t === 'd') { value = raw; type = 's'; }
      else { if (raw === '') continue; value = Number(raw); type = 'n'; }
      if (type === 's' && value === '') continue;
      const code = xfFormats[Number(c.getAttribute('s') || 0)] || 'General';
      let text;
      if (type === 'n') text = formatCell(value, code, date1904);
      else if (type === 'b') text = value ? 'TRUE' : 'FALSE';
      else text = String(value);
      const isDate = type === 'n' && isDateFormat(code);
      (rows[ri] ||= [])[ci] = { v: value, t: isDate ? 'd' : type, text, fmt: code };
      if (ci + 1 > maxCol) maxCol = ci + 1;
    }
    for (let i = 0; i < rows.length; i++) rows[i] ||= [];
    const colWidths = [];
    for (const col of sd.getElementsByTagName('col')) {
      const min = Number(col.getAttribute('min')), max = Math.min(Number(col.getAttribute('max')), 200);
      const w = Number(col.getAttribute('width'));
      if (col.getAttribute('hidden') === '1') continue;
      for (let i = min - 1; i < max; i++) colWidths[i] = w;
    }
    const merges = [...sd.getElementsByTagName('mergeCell')].map((m) => m.getAttribute('ref'));
    sheets.push({ name, hidden, rows, colWidths, merges, maxCol });
  }
  if (!sheets.length) throw new ConverterError(ERR.CORRUPT, 'The workbook contains no readable sheets.');
  return { sheets, date1904 };
}

// ---------------- writer ----------------

const ILLEGAL_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
const xmlEsc = (s) => String(s).replace(ILLEGAL_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function safeSheetName(name, used) {
  let n = String(name || 'Sheet').replace(/[\[\]:*?/\\]/g, '_').replace(/^'+|'+$/g, '').slice(0, 31) || 'Sheet';
  let base = n, i = 2;
  while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  used.add(n.toLowerCase());
  return n;
}

function dateToSerial(d) { return (d.getTime() - Date.UTC(1899, 11, 30)) / 86400000; }

/**
 * @param {{name:string, rows:any[][], colWidths?:number[], freezeHeader?:boolean, boldHeader?:boolean}[]} sheets
 *   cell values: string | number | boolean | Date | null
 * @returns {Promise<Blob>}
 */
export async function writeXlsx(sheets) {
  const JSZip = await getJSZip();
  const zip = new JSZip();
  const used = new Set();
  const names = sheets.map((s) => safeSheetName(s.name, used));

  const sst = new Map();
  const sstList = [];
  let sstCount = 0;
  const si = (s) => {
    sstCount++;
    let i = sst.get(s);
    if (i == null) { i = sstList.length; sst.set(s, i); sstList.push(s); }
    return i;
  };

  const sheetXml = sheets.map((s) => {
    const rows = s.rows;
    let maxCol = 0;
    const out = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.length) continue;
      const cells = [];
      for (let c = 0; c < row.length; c++) {
        let v = row[c];
        if (v == null || v === '') continue;
        const ref = indexToCol(c) + (r + 1);
        const bold = s.boldHeader && r === 0;
        if (v instanceof Date && !isNaN(v)) {
          const serial = dateToSerial(v);
          cells.push(`<c r="${ref}" s="${Number.isInteger(serial) ? 2 : 3}"><v>${serial}</v></c>`);
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          cells.push(`<c r="${ref}"${bold ? ' s="1"' : ''}><v>${v}</v></c>`);
        } else if (typeof v === 'boolean') {
          cells.push(`<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`);
        } else {
          let str = String(v);
          if (str.length > 32767) str = str.slice(0, 32767);
          cells.push(`<c r="${ref}" t="s"${bold ? ' s="1"' : ''}><v>${si(str)}</v></c>`);
        }
        if (c + 1 > maxCol) maxCol = c + 1;
      }
      if (cells.length) out.push(`<row r="${r + 1}">${cells.join('')}</row>`);
    }
    const cols = (s.colWidths || []).map((w, i) => (w ? `<col min="${i + 1}" max="${i + 1}" width="${Math.min(255, Math.max(4, w)).toFixed(2)}" customWidth="1"/>` : '')).join('');
    const pane = s.freezeHeader && rows.length > 1
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${out.join('')}</sheetData></worksheet>`;
  });

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sstCount}" uniqueCount="${sstList.length}">${sstList.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`);
  sheetXml.forEach((x, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, x));

  return zip.generateAsync({
    type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 },
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
