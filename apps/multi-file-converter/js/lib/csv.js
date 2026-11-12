// CSV helpers: encoding detection, delimiter detection, RFC 4180 parser and writer.

/** Decode bytes to text. Handles UTF-8/UTF-16 BOMs; falls back to Windows-1252 for legacy files. */
export function decodeText(buf, forced) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (forced && forced !== 'auto') return new TextDecoder(forced).decode(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function detectDelimiter(text) {
  const sample = text.slice(0, 20000);
  const candidates = [',', ';', '\t', '|'];
  let best = ',', bestScore = -1;
  for (const d of candidates) {
    const counts = [];
    let inQ = false, c = 0, lines = 0;
    for (let i = 0; i < sample.length && lines < 25; i++) {
      const ch = sample[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch === d) c++;
      else if (!inQ && ch === '\n') { counts.push(c); c = 0; lines++; }
    }
    if (!counts.length) counts.push(c);
    const nonZero = counts.filter((n) => n > 0);
    if (!nonZero.length) continue;
    const mode = nonZero.sort((a, b) => a - b)[Math.floor(nonZero.length / 2)];
    const consistent = counts.filter((n) => n === mode).length;
    const score = consistent * 10 + mode;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export function parseCsv(text, delimiter = ',') {
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  let any = false;
  for (; i < n; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"' && field === '') { inQ = true; any = true; }
    else if (ch === delimiter) { row.push(field); field = ''; any = true; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = []; any = false;
    } else { field += ch; any = true; }
  }
  if (any || field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function toCsv(rows, { delimiter = ',', quoteAll = false, eol = '\r\n' } = {}) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (quoteAll || s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return rows.map((r) => r.map(esc).join(delimiter)).join(eol) + eol;
}

/** Convert a text cell to a number when it is unambiguous (keeps IDs/zip codes/phone numbers as text). */
export function inferValue(s) {
  const t = s.trim();
  if (t === '') return null;
  if (/^[-+]?(0|[1-9]\d{0,14})(\.\d+)?$/.test(t)) {
    const digits = t.replace(/[^0-9]/g, '');
    if (digits.length <= 15) return Number(t);
  }
  if (/^[-+]?(0|[1-9]\d{0,2}(,\d{3})+)(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^[-+]?\d+(\.\d+)?%$/.test(t)) return Number(t.slice(0, -1)) / 100;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  return s;
}
