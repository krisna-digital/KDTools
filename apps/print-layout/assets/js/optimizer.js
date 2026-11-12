// PRINTLAY — optimizer.js
// Optimasi tata letak: MaxRects (5 heuristik × beberapa mode orientasi) + pencarian blok guillotine.
// Model gap: setiap item diperluas (w+gapX, h+gapY) dan area diperluas (W+gapX, H+gapY).
// Dengan begitu jarak antar tepi desain >= gap, dan tidak ada gap di tepi luar kertas.
// Heuristik: hasil BUKAN klaim optimum global, kecuali jumlahnya sama dengan batas atas luas.

import { EPS, floorTol as fl, gridCount, simpleGridBest } from './calculator.js';

export const MAX_PIECES = 20000;
const MAXRECTS_LIMIT = 4000; // di atas ini MaxRects dilewati (terlalu lambat), pakai blok saja
const CP_LIMIT = 400;        // Contact Point O(n²) → hanya untuk jumlah kecil

const HEURISTICS = ['BSSF', 'BLSF', 'BAF', 'BL', 'CP'];
const HEURISTIC_LABEL = {
  BSSF: 'Best Short Side Fit',
  BLSF: 'Best Long Side Fit',
  BAF: 'Best Area Fit',
  BL: 'Bottom Left',
  CP: 'Contact Point',
};

function overlap1d(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

class MaxRectsBin {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.free = [{ x: 0, y: 0, w, h }];
    this.used = [];
  }

  contact(x, y, w, h) {
    let s = 0;
    if (x < EPS || Math.abs(x + w - this.w) < EPS) s += h;
    if (y < EPS || Math.abs(y + h - this.h) < EPS) s += w;
    for (const u of this.used) {
      if (Math.abs(u.x + u.w - x) < EPS || Math.abs(u.x - (x + w)) < EPS) s += overlap1d(y, y + h, u.y, u.y + u.h);
      if (Math.abs(u.y + u.h - y) < EPS || Math.abs(u.y - (y + h)) < EPS) s += overlap1d(x, x + w, u.x, u.x + u.w);
    }
    return s;
  }

  score(fr, o, heur) {
    const lw = fr.w - o.w;
    const lh = fr.h - o.h;
    switch (heur) {
      case 'BSSF': return [Math.min(lw, lh), Math.max(lw, lh)];
      case 'BLSF': return [Math.max(lw, lh), Math.min(lw, lh)];
      case 'BAF': return [fr.w * fr.h - o.w * o.h, Math.min(lw, lh)];
      case 'BL': return [fr.y + o.h, fr.x];
      case 'CP': return [-this.contact(fr.x, fr.y, o.w, o.h), Math.min(lw, lh)];
      default: throw new Error(`Heuristik tidak dikenal: ${heur}`);
    }
  }

  findBest(orients, heur) {
    let best = null;
    for (const fr of this.free) {
      for (const o of orients) {
        if (o.w > fr.w + EPS || o.h > fr.h + EPS) continue;
        const [s1, s2] = this.score(fr, o, heur);
        let better = false;
        if (!best) better = true;
        else if (s1 < best.s1 - EPS) better = true;
        else if (Math.abs(s1 - best.s1) <= EPS) {
          if (s2 < best.s2 - EPS) better = true;
          else if (Math.abs(s2 - best.s2) <= EPS && o.pref < best.pref) better = true;
        }
        if (better) best = { x: fr.x, y: fr.y, w: o.w, h: o.h, rot: o.rot, s1, s2, pref: o.pref };
      }
    }
    return best;
  }

  place(x, y, w, h) {
    const r = { x, y, w, h };
    const next = [];
    for (const f of this.free) {
      const hit = r.x < f.x + f.w - EPS && r.x + r.w > f.x + EPS && r.y < f.y + f.h - EPS && r.y + r.h > f.y + EPS;
      if (!hit) { next.push(f); continue; }
      if (r.x < f.x + f.w - EPS && r.x + r.w > f.x + EPS) {
        if (r.y > f.y + EPS && r.y < f.y + f.h - EPS) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
        if (r.y + r.h < f.y + f.h - EPS) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
      }
      if (r.y < f.y + f.h - EPS && r.y + r.h > f.y + EPS) {
        if (r.x > f.x + EPS && r.x < f.x + f.w - EPS) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
        if (r.x + r.w < f.x + f.w - EPS) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
      }
    }
    this.free = prune(next.filter((f) => f.w > EPS && f.h > EPS));
    this.used.push(r);
  }
}

function contains(a, b) {
  // a berada sepenuhnya di dalam b
  return a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;
}

function prune(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    let redundant = false;
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      if (contains(list[i], list[j]) && (!contains(list[j], list[i]) || j < i)) { redundant = true; break; }
    }
    if (!redundant) out.push(list[i]);
  }
  return out;
}

function packMaxRects(bx, by, orients, heur, preferRot, limit) {
  const bin = new MaxRectsBin(bx, by);
  const ors = orients.map((o) => ({ ...o, pref: o.rot === preferRot ? 0 : 1 }));
  const out = [];
  while (out.length < limit) {
    const b = bin.findBest(ors, heur);
    if (!b) break;
    bin.place(b.x, b.y, b.w, b.h);
    out.push({ x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot });
  }
  return out;
}

function gridPlacements(x0, y0, cols, rows, o) {
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) out.push({ x: x0 + i * o.w, y: y0 + j * o.h, w: o.w, h: o.h, rot: o.rot });
  }
  return out;
}

/** Kandidat grid murni dan grid dua blok (guillotine) — murah & deterministik. */
function blockCandidates(bx, by, orients) {
  const cands = [];
  for (const o of orients) {
    const cols = fl(bx / o.w);
    const rows = fl(by / o.h);
    cands.push({
      strategy: `Grid sederhana (${o.rot ? 'dirotasi 90°' : 'orientasi normal'})`,
      count: cols * rows,
      make: () => gridPlacements(0, 0, cols, rows, o),
    });
  }
  if (orients.length === 2) {
    let bestV = null;
    let bestH = null;
    for (const A of orients) {
      for (const B of orients) {
        if (A === B) continue;
        const rowsA = fl(by / A.h);
        const rowsB = fl(by / B.h);
        for (let c = 0; c <= fl(bx / A.w); c++) {
          const rem = bx - c * A.w;
          const colsB = fl(rem / B.w);
          const count = c * rowsA + colsB * rowsB;
          if (!bestV || count > bestV.count) bestV = { count, A, B, c, colsB, rowsA, rowsB };
        }
        const colsA = fl(bx / A.w);
        const colsB2 = fl(bx / B.w);
        for (let r = 0; r <= fl(by / A.h); r++) {
          const rem = by - r * A.h;
          const rowsB2 = fl(rem / B.h);
          const count = colsA * r + colsB2 * rowsB2;
          if (!bestH || count > bestH.count) bestH = { count, A, B, r, colsA, colsB2, rowsB2 };
        }
      }
    }
    if (bestV) {
      cands.push({
        strategy: 'Blok guillotine vertikal (campuran orientasi)',
        count: bestV.count,
        make: () => [
          ...gridPlacements(0, 0, bestV.c, bestV.rowsA, bestV.A),
          ...gridPlacements(bestV.c * bestV.A.w, 0, bestV.colsB, bestV.rowsB, bestV.B),
        ],
      });
    }
    if (bestH) {
      cands.push({
        strategy: 'Blok guillotine horizontal (campuran orientasi)',
        count: bestH.count,
        make: () => [
          ...gridPlacements(0, 0, bestH.colsA, bestH.r, bestH.A),
          ...gridPlacements(0, bestH.r * bestH.A.h, bestH.colsB2, bestH.rowsB2, bestH.B),
        ],
      });
    }
  }
  return cands;
}

function cutScore(placements) {
  const xs = new Set();
  const ys = new Set();
  for (const p of placements) {
    xs.add(Math.round(p.x * 1e4));
    xs.add(Math.round((p.x + p.w) * 1e4));
    ys.add(Math.round(p.y * 1e4));
    ys.add(Math.round((p.y + p.h) * 1e4));
  }
  return xs.size + ys.size;
}

function better(a, b) {
  // true jika a lebih baik dari b. Urutan: jumlah, kemudahan potong, lebih sedikit rotasi.
  if (!b) return true;
  if (a.placements.length !== b.placements.length) return a.placements.length > b.placements.length;
  if (a.cut !== b.cut) return a.cut < b.cut;
  return a.rotCount < b.rotCount;
}

/**
 * @param cfg {designW, designH, paperW, paperH, gapX, gapY, margins:{top,right,bottom,left}, allowRotation, extendedSearch}
 * @returns {placements:[{x,y,w,h,rotated}], count, strategy, upperBound, provenOptimal, baselineGrid, candidates, note, tooMany}
 *  Koordinat placements: mm dari pojok kiri-atas kertas; w/h = ukuran desain sebenarnya (tanpa gap).
 */
export function optimizeLayout(cfg) {
  const { designW: dw, designH: dh, paperW, paperH, gapX: gx, gapY: gy, margins: m } = cfg;
  const allowRotation = cfg.allowRotation !== false;
  const extended = cfg.extendedSearch !== false;

  const ux = paperW - m.left - m.right;
  const uy = paperH - m.top - m.bottom;
  const bx = ux + gx;
  const by = uy + gy;

  const all = [{ w: dw + gx, h: dh + gy, rot: false }];
  if (allowRotation && Math.abs(dw - dh) > EPS) all.push({ w: dh + gx, h: dw + gy, rot: true });
  const orients = all.filter((o) => o.w <= bx + EPS && o.h <= by + EPS);

  const base = {
    placements: [], count: 0, strategy: 'Tidak ada', upperBound: 0, provenOptimal: false,
    baselineGrid: 0, candidates: [], note: '', tooMany: false,
  };

  if (!orients.length) {
    return { ...base, provenOptimal: true, note: 'Desain tidak dapat dimuat pada area cetak kertas (dengan atau tanpa rotasi).' };
  }

  const upperBound = fl((bx * by) / ((dw + gx) * (dh + gy)));
  if (upperBound > MAX_PIECES) {
    return { ...base, upperBound, tooMany: true, note: `Estimasi lebih dari ${MAX_PIECES} desain per lembar — terlalu banyak untuk diproses. Perbesar ukuran desain.` };
  }

  const baselineGrid = simpleGridBest(cfg);
  const toReal = (list) => list.map((p) => ({
    x: p.x + m.left,
    y: p.y + m.top,
    w: p.rot ? dh : dw,
    h: p.rot ? dw : dh,
    rotated: p.rot,
  }));

  let best = null;
  const candidates = [];
  const consider = (strategy, expanded) => {
    const placements = toReal(expanded);
    candidates.push({ strategy, count: placements.length });
    const cand = { strategy, placements, cut: cutScore(placements), rotCount: placements.filter((p) => p.rotated).length };
    if (better(cand, best)) best = cand;
  };

  // 1) kandidat blok (cepat) — hanya bangun yang berpotensi terbaik
  const blocks = blockCandidates(bx, by, orients);
  const maxBlock = Math.max(...blocks.map((c) => c.count));
  for (const c of blocks) {
    candidates.push({ strategy: c.strategy, count: c.count });
    if (c.count >= maxBlock) {
      const placements = toReal(c.make());
      const cand = { strategy: c.strategy, placements, cut: cutScore(placements), rotCount: placements.filter((p) => p.rotated).length };
      if (better(cand, best)) best = cand;
    }
  }

  // 2) MaxRects — beberapa heuristik × mode orientasi
  let skippedMaxRects = false;
  if (best.placements.length < upperBound && extended) {
    if (upperBound > MAXRECTS_LIMIT) {
      skippedMaxRects = true;
    } else {
      const heurs = upperBound <= CP_LIMIT ? HEURISTICS : HEURISTICS.filter((h) => h !== 'CP');
      const modes = [];
      const normalOnly = orients.filter((o) => !o.rot);
      const rotOnly = orients.filter((o) => o.rot);
      if (normalOnly.length) modes.push({ label: 'orientasi normal', set: normalOnly, prefer: false });
      if (rotOnly.length) modes.push({ label: 'dirotasi 90°', set: rotOnly, prefer: true });
      if (orients.length === 2) {
        modes.push({ label: 'campuran, prioritas normal', set: orients, prefer: false });
        modes.push({ label: 'campuran, prioritas rotasi', set: orients, prefer: true });
      }
      outer: for (const h of heurs) {
        for (const mode of modes) {
          const packed = packMaxRects(bx, by, mode.set, h, mode.prefer, upperBound + 1);
          consider(`MaxRects ${HEURISTIC_LABEL[h]} (${mode.label})`, packed);
          if (best.placements.length >= upperBound) break outer;
        }
      }
    }
  }

  const count = best.placements.length;
  const provenOptimal = count === upperBound;
  let note;
  if (provenOptimal) {
    note = 'Jumlah ini sama dengan batas atas berdasarkan luas area, sehingga terbukti maksimum.';
  } else {
    note = `Hasil terbaik yang ditemukan secara heuristik. Batas atas teoretis berdasarkan luas: ${upperBound} pcs (belum tentu dapat dicapai). Ini bukan klaim optimum global.`;
  }
  if (skippedMaxRects) note += ' Pencarian MaxRects dilewati karena jumlah desain sangat banyak; digunakan pencarian blok.';

  return {
    placements: best.placements,
    count,
    strategy: best.strategy,
    upperBound,
    provenOptimal,
    baselineGrid,
    candidates,
    note,
    tooMany: false,
  };
}

export { gridCount };
