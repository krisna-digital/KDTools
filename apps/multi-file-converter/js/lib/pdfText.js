// Extract positioned text from PDF pages and rebuild lines, paragraphs and tables.

/** @returns {{items:Array, width:number, height:number}} items in top-left origin coordinates (pt) */
export async function getPageText(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent({ includeMarkedContent: false });
  const styles = tc.styles || {};
  const items = [];
  for (const it of tc.items) {
    if (!('str' in it) || it.str.trim() === '') continue; // whitespace-only items carry spacing only; gaps are recomputed from positions
    const [a, b, , d, e, f] = it.transform;
    const size = Math.hypot(a, b) || Math.abs(d) || 10;
    const st = styles[it.fontName] || {};
    const fam = (st.fontFamily || '').toLowerCase();
    const real = (it.fontName || '').toLowerCase();
    items.push({
      str: it.str.replace(/[\uf0b7\uf0a7\uf076\uf0d8\uf0fc]/g, (c) => (c === '\uf0fc' ? '✓' : '•')), // Symbol/Wingdings bullets
      x: e, y: vp.height - f, // baseline from top
      w: it.width, h: it.height || size, size,
      bold: /bold|black|heavy|semibold/.test(real + fam),
      italic: /italic|oblique/.test(real + fam),
      mono: /mono|courier|consolas/.test(real + fam) || fam === 'monospace',
      vertical: Math.abs(b) > Math.abs(a) * 0.5,
      eol: !!it.hasEOL,
    });
  }
  return { items, width: vp.width, height: vp.height };
}

/** Group items into lines (same baseline) sorted left->right, top->bottom. */
export function buildLines(items) {
  const horiz = items.filter((i) => !i.vertical);
  const sorted = horiz.slice().sort((p, q) => p.y - q.y || p.x - q.x);
  const lines = [];
  for (const it of sorted) {
    const tol = Math.max(2, it.size * 0.4);
    let line = lines.find((l) => Math.abs(l.y - it.y) <= tol && it.x >= l.minX - 1 && Math.abs(l.size - it.size) / l.size < 0.5);
    if (!line) { line = { y: it.y, items: [], size: it.size, minX: it.x }; lines.push(line); }
    line.items.push(it);
    line.minX = Math.min(line.minX, it.x);
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    // merge items into runs, inserting spaces when there is a gap
    const runs = [];
    for (const it of l.items) {
      const last = runs[runs.length - 1];
      if (last) {
        const gap = it.x - (last.x + last.w);
        const spaceW = Math.max(0.8, it.size * 0.15);
        if (gap > spaceW && !last.str.endsWith(' ') && !it.str.startsWith(' ')) last.str += ' ';
        if (gap < it.size * 0.8 && last.bold === it.bold && last.italic === it.italic && last.mono === it.mono && Math.abs(last.size - it.size) < 0.6) {
          last.str += it.str; last.w = it.x + it.w - last.x; continue;
        }
      }
      runs.push({ ...it });
    }
    l.runs = runs;
    l.x = runs[0].x;
    l.right = Math.max(...runs.map((r) => r.x + r.w));
    l.text = runs.map((r) => r.str).join('');
    l.size = Math.max(...runs.map((r) => r.size));
    l.bold = runs.every((r) => r.bold);
  }
  return lines.sort((a, b) => a.y - b.y);
}

/** Group lines into paragraphs using vertical gap, indentation and font size changes. */
export function buildParagraphs(lines, pageWidth) {
  const paras = [];
  let cur = null;
  const bodySize = median(lines.map((l) => l.size)) || 11;
  for (const l of lines) {
    if (!l.text.trim()) continue;
    const prev = cur?.lines[cur.lines.length - 1];
    const lead = prev ? l.y - prev.y : Infinity;
    const sameStyle = prev && Math.abs(prev.size - l.size) < 0.8 && prev.bold === l.bold;
    const bulletStart = /^\s*([•●▪◦\-–*]|\d{1,3}[.)])\s+/.test(l.text);
    const newPara = !cur || !sameStyle || lead > l.size * 1.75 || lead < 0 || bulletStart;
    // a short previous line that ends a sentence also ends a paragraph
    const prevShort = prev && (prev.right < pageWidth * 0.7) && /[.!?:]\s*$/.test(prev.text) && lead > l.size * 1.1;
    if (newPara || prevShort) {
      cur = { lines: [l] }; paras.push(cur);
    } else cur.lines.push(l);
  }
  for (const p of paras) {
    const first = p.lines[0];
    p.size = Math.max(...p.lines.map((l) => l.size));
    p.bold = p.lines.every((l) => l.bold);
    p.x = Math.min(...p.lines.map((l) => l.x));
    p.y = first.y;
    p.heading = p.size >= bodySize * 1.25 && p.lines.length <= 3 ? (p.size >= bodySize * 1.7 ? 1 : p.size >= bodySize * 1.45 ? 2 : 3) : 0;
    // join with hyphenation handling
    let text = '';
    for (const l of p.lines) {
      const t = l.text.replace(/\s+$/, '');
      if (!text) text = t;
      else if (/[a-zà-ÿ]-$/.test(text) && /^[a-zà-ÿ]/.test(t)) text = text.slice(0, -1) + t;
      else text += ' ' + t;
    }
    p.text = text.replace(/\s{2,}/g, ' ').trim();
    p.runs = p.lines.flatMap((l) => l.runs);
    p.list = /^\s*([•●▪◦]|[-–*]\s|\d{1,3}[.)]\s)/.test(p.text) ? p.text.match(/^\s*([•●▪◦]|[-–*]|\d{1,3}[.)])/)[1] : null;
  }
  return paras;
}

function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

/**
 * Heuristic table detection. Looks for runs of >=2 consecutive lines whose text starts align in >=2 shared columns.
 * @returns {{tables:Array<{rows:string[][], y0:number, y1:number, lineSet:Set}>}}
 */
export function detectTables(lines, { minRows = 2, minCols = 2 } = {}) {
  // split every line into cells by large horizontal gaps
  const cellLines = lines.map((l) => {
    const cells = [];
    let cur = null;
    const thresh = Math.max(l.size * 0.9, 6);
    for (const r of l.runs) {
      if (cur && r.x - (cur.x + cur.w) <= thresh) { cur.text += (r.x - (cur.x + cur.w) > l.size * 0.2 ? ' ' : '') + r.str; cur.w = r.x + r.w - cur.x; }
      else { cur = { x: r.x, w: r.w, text: r.str }; cells.push(cur); }
    }
    // a list marker must not become its own table column: glue it to the following cell
    if (cells.length > 1 && /^([•●▪◦‣\-–*]|\d{1,3}[.)]|[a-z][.)])\s*$/i.test(cells[0].text.trim())) {
      const [m, nx] = cells.splice(0, 2); cells.unshift({ x: m.x, w: nx.x + nx.w - m.x, text: m.text.trim() + ' ' + nx.text });
    }
    return { line: l, cells };
  });
  const tables = [];
  let i = 0;
  while (i < cellLines.length) {
    if (cellLines[i].cells.length < minCols) { i++; continue; }
    let j = i;
    const block = [];
    while (j < cellLines.length && cellLines[j].cells.length >= 1) {
      const cl = cellLines[j];
      const prev = block[block.length - 1];
      if (prev && cl.line.y - prev.line.y > Math.max(prev.line.size, cl.line.size) * 2.6) break;
      if (cl.cells.length < minCols && !(cl.cells.length === 1 && block.length && false)) break;
      block.push(cl); j++;
    }
    if (block.length >= minRows) {
      // Column bands = union of overlapping horizontal extents of cells (works for left, right and centre aligned columns).
      const spans = block.slice(1).flatMap((b2) => b2.cells.map((c) => [c.x, c.x + c.w])).sort((p, q) => p[0] - q[0]);
      const bands = [];
      for (const [x0, x1] of spans) {
        const last = bands[bands.length - 1];
        if (last && x0 <= last.x1 + 2) { last.x1 = Math.max(last.x1, x1); last.n++; } else bands.push({ x0, x1, n: 1 });
      }
      const usable = bands.filter((c) => c.n >= Math.max(2, Math.floor((block.length - 1) * 0.4)));
      if (usable.length >= minCols) {
        const rows = block.map((b2, ri) => {
          const row = Array(usable.length).fill('');
          const seq = ri === 0 && b2.cells.length === usable.length; // header row: left-aligned titles over right-aligned numbers
          for (const [ci, c] of b2.cells.entries()) {
            if (seq) { row[ci] = c.text.trim(); continue; }
            const mid = c.x + c.w / 2;
            let k = usable.findIndex((u) => mid >= u.x0 - 2 && mid <= u.x1 + 2);
            if (k < 0) k = usable.reduce((best, u, i) => (Math.abs(mid - (u.x0 + u.x1) / 2) < Math.abs(mid - (usable[best].x0 + usable[best].x1) / 2) ? i : best), 0);
            row[k] = (row[k] ? row[k] + ' ' : '') + c.text.trim();
          }
          return row;
        });
        const isList = usable.length === 2 && rows.every((r) => /^([•●▪◦‣\-–*]|\d{1,3}[.)]|[a-z][.)])$/i.test(r[0].trim()));
        const filled = isList ? 0 : rows.filter((r) => r.filter(Boolean).length >= 2).length;
        if (filled >= Math.max(2, Math.ceil(rows.length * 0.6))) {
          tables.push({ rows, y0: block[0].line.y, y1: block[block.length - 1].line.y, lineSet: new Set(block.map((b) => b.line)), x0: usable[0].x0, cols: usable.length });
          i = j; continue;
        }
      }
    }
    i++;
  }
  return tables;
}

export function textCharCount(items) { return items.reduce((n, i) => n + i.str.trim().length, 0); }
