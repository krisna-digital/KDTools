/**
 * layout-engine.js — Mesin tata letak otomatis (rectangle bin packing MaxRects).
 *
 * Prinsip:
 *  - Semua satuan MILIMETER. Foto tidak pernah diperkecil / dipotong / diubah rasionya.
 *  - Setiap foto menempati "footprint" = ukuran + 2×bleed + spasi. Bin = area cetak + spasi,
 *    sehingga jarak antar foto tepat = spasi dan tidak ada spasi sisa di tepi.
 *  - Rotasi 90° boleh (opsional) bila membuat lebih muat.
 *  - Modul ini murni (tanpa DOM) agar mudah diuji.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const PPS = (root.PPS = root.PPS || {});
  const EPS = 1e-6;
  const uid = () => 'it_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

  // ------------------------------------------------------------------ MaxRects
  class MaxRects {
    constructor(w, h) { this.binW = w; this.binH = h; this.free = [{ x: 0, y: 0, w, h }]; }

    /** Cari posisi terbaik untuk persegi w×h. heur: BSSF | BAF | BL. */
    find(w, h, rotate, heur) {
      let best = null;
      const consider = (f, ww, hh, rot) => {
        let s1, s2;
        const lw = f.w - ww, lh = f.h - hh;
        if (heur === 'BAF') { s1 = f.w * f.h - ww * hh; s2 = Math.min(lw, lh); }
        else if (heur === 'BL') { s1 = f.y + hh; s2 = f.x; }
        else { s1 = Math.min(lw, lh); s2 = Math.max(lw, lh); } // BSSF
        if (!best || s1 < best.s1 - EPS || (Math.abs(s1 - best.s1) <= EPS && s2 < best.s2 - EPS)) best = { x: f.x, y: f.y, w: ww, h: hh, rotated: rot, s1, s2 };
      };
      for (const f of this.free) {
        if (w <= f.w + EPS && h <= f.h + EPS) consider(f, w, h, false);
        if (rotate && Math.abs(w - h) > EPS && h <= f.w + EPS && w <= f.h + EPS) consider(f, h, w, true);
      }
      return best;
    }

    /** Tandai persegi sebagai terpakai & pecah ruang bebas. */
    place(n) {
      const out = [];
      for (const f of this.free) {
        if (n.x >= f.x + f.w - EPS || n.x + n.w <= f.x + EPS || n.y >= f.y + f.h - EPS || n.y + n.h <= f.y + EPS) { out.push(f); continue; }
        if (n.x > f.x + EPS) out.push({ x: f.x, y: f.y, w: n.x - f.x, h: f.h });
        if (n.x + n.w < f.x + f.w - EPS) out.push({ x: n.x + n.w, y: f.y, w: f.x + f.w - (n.x + n.w), h: f.h });
        if (n.y > f.y + EPS) out.push({ x: f.x, y: f.y, w: f.w, h: n.y - f.y });
        if (n.y + n.h < f.y + f.h - EPS) out.push({ x: f.x, y: n.y + n.h, w: f.w, h: f.y + f.h - (n.y + n.h) });
      }
      // buang ruang yang terkandung ruang lain
      const keep = [];
      for (let i = 0; i < out.length; i++) {
        let contained = false;
        for (let j = 0; j < out.length && !contained; j++) {
          if (i === j) continue;
          const a = out[i], b = out[j];
          if (a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS) {
            if (!(Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS && Math.abs(a.w - b.w) < EPS && Math.abs(a.h - b.h) < EPS && j > i)) contained = true;
          }
        }
        if (!contained) keep.push(out[i]);
      }
      this.free = keep;
    }
  }

  /**
   * Inti packing multi-halaman.
   * entries: [{ref, w, h, newPage?}]  bin: {w,h}
   * o: {rotate, heur, strict, fixed:[{page,x,y,w,h}]}
   */
  function packCore(entries, bin, o) {
    const pages = [];
    const addPage = () => { const p = { mr: new MaxRects(bin.w, bin.h), placed: [] }; pages.push(p); return p; };
    (o.fixed || []).forEach((f) => { while (pages.length <= f.page) addPage(); pages[f.page].mr.place(f); });
    const unplaced = [];
    let cur = 0; // halaman aktif (mode strict)
    for (const e of entries) {
      const fitsEmpty = (e.w <= bin.w + EPS && e.h <= bin.h + EPS) || (o.rotate && e.h <= bin.w + EPS && e.w <= bin.h + EPS);
      if (!fitsEmpty) { unplaced.push(e); continue; }
      if (e.newPage && o.strict) { // mulai halaman baru: lewati halaman yang sudah berisi
        const dirty = (i) => i < pages.length && (pages[i].placed.length > 0 || hasFixed(o, i));
        if (dirty(cur)) { cur++; while (dirty(cur)) cur++; if (cur >= pages.length) addPage(); }
      }
      let done = false;
      const tryPage = (i) => {
        const pos = pages[i].mr.find(e.w, e.h, o.rotate, o.heur);
        if (!pos) return false;
        pages[i].mr.place(pos); pages[i].placed.push({ ref: e.ref, x: pos.x, y: pos.y, w: pos.w, h: pos.h, rotated: pos.rotated });
        return true;
      };
      if (o.strict) {
        if (!pages.length) addPage();
        while (!done) { if (tryPage(cur)) done = true; else { cur++; if (cur >= pages.length) addPage(); } }
      } else {
        for (let i = 0; i < pages.length && !done; i++) done = tryPage(i);
        if (!done) { addPage(); tryPage(pages.length - 1); }
      }
    }
    while (pages.length && !pages[pages.length - 1].placed.length && !hasFixed(o, pages.length - 1)) pages.pop(); // halaman kosong di ujung
    return { pages, unplaced };
  }
  const hasFixed = (o, i) => (o.fixed || []).some((f) => f.page === i);

  /** Nilai solusi: semakin kecil semakin baik (jumlah halaman, lalu tinggi terpakai di halaman terakhir). */
  function score(res) {
    const n = res.pages.length; if (!n) return [0, 0];
    const last = res.pages[n - 1]; let maxY = 0, area = 0;
    last.placed.forEach((p) => { maxY = Math.max(maxY, p.y + p.h); area += p.w * p.h; });
    return [n, maxY * 1000 + area / 1000];
  }
  const better = (a, b) => !b || a[0] < b[0] || (a[0] === b[0] && a[1] < b[1] - 1e-9);

  function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  /** Mode Maximum Efficiency: coba banyak urutan & heuristik, pilih terbaik. */
  function packBest(entries, bin, o, budgetMs = 450) {
    const orders = {
      area: (a, b) => b.w * b.h - a.w * a.h,
      height: (a, b) => b.h - a.h || b.w - a.w,
      width: (a, b) => b.w - a.w || b.h - a.h,
      side: (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
      perim: (a, b) => b.w + b.h - (a.w + a.h),
    };
    let best = null; const t0 = Date.now();
    const run = (list, heur) => {
      const r = packCore(list, bin, Object.assign({}, o, { heur, strict: false }));
      if (r.unplaced.length) return; const sc = score(r);
      if (better(sc, best && best.sc)) best = { r, sc };
    };
    for (const k of Object.keys(orders)) for (const heur of ['BSSF', 'BAF', 'BL']) run(entries.slice().sort(orders[k]), heur);
    // perturbasi acak berwaktu terbatas
    const rnd = seeded(12345); let tries = 0;
    while (Date.now() - t0 < budgetMs && tries < 60 && entries.length > 1) {
      tries++;
      const base = entries.slice().sort(orders.area);
      const noisy = base.map((e) => ({ e, k: e.w * e.h * (0.75 + rnd() * 0.5) })).sort((a, b) => b.k - a.k).map((x) => x.e);
      run(noisy, ['BSSF', 'BAF', 'BL'][tries % 3]);
    }
    return best ? best.r : packCore(entries.slice().sort(orders.area), bin, Object.assign({}, o, { heur: 'BSSF', strict: false }));
  }

  /** Susunan sederhana baris demi baris (mode Manual: titik awal untuk diedit). */
  function shelfPack(entries, bin, o) {
    const pages = []; const unplaced = [];
    let page = null, x = 0, y = 0, rowH = 0;
    const newPage = () => { page = { placed: [] }; pages.push(page); x = 0; y = 0; rowH = 0; };
    for (const e of entries) {
      let w = e.w, h = e.h, rotated = false;
      if (w > bin.w + EPS || h > bin.h + EPS) {
        if (o.rotate && h <= bin.w + EPS && w <= bin.h + EPS) { w = e.h; h = e.w; rotated = true; } else { unplaced.push(e); continue; }
      }
      if (!page) newPage();
      if (x + w > bin.w + EPS) { x = 0; y += rowH; rowH = 0; }
      if (y + h > bin.h + EPS) { newPage(); }
      page.placed.push({ ref: e.ref, x, y, w, h, rotated });
      x += w; rowH = Math.max(rowH, h);
    }
    return { pages, unplaced };
  }

  // ------------------------------------------------------------------ Public API
  const Layout = {
    MaxRects, packCore, packBest, shelfPack, EPS,

    /** Area cetak (mm) dalam koordinat halaman. */
    usable(settings) {
      const pg = PPS.Config ? PPS.Config.pageSize(settings) : { w: settings.media.w, h: settings.media.h };
      const m = settings.margins;
      return { W: pg.w, H: pg.h, x0: m.left, y0: m.top, pw: pg.w - m.left - m.right, ph: pg.h - m.top - m.bottom };
    },
    signature(settings) {
      const u = Layout.usable(settings);
      return [u.W, u.H, u.x0, u.y0, u.pw, u.ph, settings.spacing.h, settings.spacing.v, settings.bleed].join('|');
    },

    /** Daftar foto yang harus dicetak (satu entri per lembar). */
    buildItems(project) {
      const items = [];
      project.persons.forEach((per, pi) => {
        if (!per.photoId) return;
        per.variants.forEach((v, vi) => {
          for (let c = 1; c <= v.qty; c++) items.push({ personId: per.id, variantId: v.id, copy: c, w: v.w, h: v.h, pi, vi, name: per.name, size: v.name });
        });
      });
      return items;
    },

    /**
     * Buat layout dari proyek.
     * opts: {keepLocked:boolean, mode?:string}
     * Mengembalikan { layout, issues:[{level,msg}], unplaced:[...] } atau { error }
     */
    generate(project, opts = {}) {
      const s = project.settings; const L = s.layout; const mode = opts.mode || L.mode;
      const items = Layout.buildItems(project);
      if (!items.length) return { error: 'Tidak ada foto untuk disusun. Tambahkan orang, unggah foto, dan pilih minimal satu ukuran.' };
      const u = Layout.usable(s); const b = s.bleed || 0; const sx = s.spacing.h, sy = s.spacing.v;
      if (u.pw <= 0 || u.ph <= 0) return { error: 'Margin terlalu besar: area cetak tidak tersisa. Kecilkan margin atau gunakan media lebih besar.' };
      const bin = { w: u.pw + sx, h: u.ph + sy };
      const issues = [];

      // item terkunci dipertahankan pada posisinya (Auto Arrange)
      const fixed = []; const fixedItems = [];
      let remaining = items;
      if (opts.keepLocked && project.layout && project.layout.pages) {
        const want = new Set(items.map((i) => i.variantId + '#' + i.copy));
        const taken = new Set();
        project.layout.pages.forEach((pg, pi) => pg.items.forEach((it) => {
          const key = it.variantId + '#' + it.copy;
          if (!it.locked || !want.has(key) || taken.has(key)) return;
          const inB = it.x >= u.x0 - EPS && it.y >= u.y0 - EPS && it.x + it.w <= u.x0 + u.pw + EPS && it.y + it.h <= u.y0 + u.ph + EPS;
          if (!inB) return;
          taken.add(key); fixedItems.push({ page: pi, item: it });
          fixed.push({ page: pi, x: it.x - u.x0 - b, y: it.y - u.y0 - b, w: it.w + 2 * b + sx, h: it.h + 2 * b + sy });
        }));
        remaining = items.filter((i) => !taken.has(i.variantId + '#' + i.copy));
      }

      const areaCmp = (a, c) => (L.sizePriority === 'smallest' ? a.w * a.h - c.w * c.h : c.w * c.h - a.w * a.h);
      const entry = (i) => ({ ref: i, w: i.w + 2 * b + sx, h: i.h + 2 * b + sy });
      let entries = remaining.map(entry); let res; const po = { rotate: !!L.allowRotate, fixed };

      if (mode === 'efficiency') {
        res = packBest(entries, bin, po);
      } else if (mode === 'person') {
        const ordered = [];
        project.persons.forEach((per, idx) => {
          const mine = remaining.filter((i) => i.personId === per.id).sort((a, c) => areaCmp(a, c) || a.vi - c.vi || a.copy - c.copy);
          mine.forEach((it, k) => { const e = entry(it); if (k === 0 && ordered.length && L.pageBreakPerPerson) e.newPage = true; ordered.push(e); });
        });
        res = packCore(ordered, bin, Object.assign({}, po, { heur: 'BSSF', strict: !L.backfill }));
      } else if (mode === 'size') {
        const ordered = remaining.slice().sort((a, c) => areaCmp(a, c) || (a.w - c.w) || a.pi - c.pi || a.copy - c.copy).map(entry);
        res = packCore(ordered, bin, Object.assign({}, po, { heur: 'BSSF', strict: !L.backfill }));
      } else if (mode === 'mixed') {
        res = packCore(entries.slice().sort((a, c) => areaCmp(a.ref, c.ref)), bin, Object.assign({}, po, { heur: 'BSSF', strict: false }));
      } else { // manual: susunan awal berurutan per orang, per ukuran
        const ordered = remaining.slice().sort((a, c) => a.pi - c.pi || a.vi - c.vi || a.copy - c.copy).map(entry);
        res = shelfPack(ordered, bin, po);
        if (fixed.length) issues.push({ level: 'info', msg: 'Mode Manual tidak mengisi sekitar foto terkunci. Gunakan mode lain untuk Auto Arrange dengan kunci.' });
      }

      // ---- bangun objek layout ----
      const pageCount = Math.max(res.pages.length, ...fixedItems.map((f) => f.page + 1), 0);
      const pages = [];
      for (let i = 0; i < pageCount; i++) pages.push({ id: uid(), items: [] });
      fixedItems.forEach((f) => pages[f.page].items.push(f.item));
      res.pages.forEach((p, i) => {
        p.placed.forEach((pl) => {
          pages[i].items.push({
            id: uid(), personId: pl.ref.personId, variantId: pl.ref.variantId, copy: pl.ref.copy,
            x: u.x0 + pl.x + b, y: u.y0 + pl.y + b, w: pl.w - 2 * b - sx, h: pl.h - 2 * b - sy, rot: !!pl.rotated, locked: false,
          });
        });
      });
      const cleaned = pages.filter((p) => p.items.length);

      // ---- penyebab tidak muat ----
      const unplaced = res.unplaced.map((e) => e.ref);
      if (unplaced.length) {
        const seen = new Set();
        unplaced.forEach((i) => {
          const k = i.personId + i.variantId; if (seen.has(k)) return; seen.add(k);
          const cnt = unplaced.filter((x) => x.personId === i.personId && x.variantId === i.variantId).length;
          const rotOk = i.h + 2 * b <= u.pw + EPS && i.w + 2 * b <= u.ph + EPS;
          issues.push({
            level: 'error',
            msg: `${i.name} — ${i.size} (${i.w}×${i.h} mm${b ? ' + bleed' : ''}) ×${cnt} tidak muat: area cetak hanya ${Math.round(u.pw * 10) / 10}×${Math.round(u.ph * 10) / 10} mm.` +
              (!L.allowRotate && rotOk ? ' Aktifkan rotasi 90° agar muat.' : ' Gunakan media lebih besar atau kecilkan margin/bleed.'),
          });
        });
      }
      return { layout: { pages: cleaned, generatedAt: Date.now(), sig: Layout.signature(s) }, issues, unplaced };
    },

    /** Periksa layout: tabrakan, keluar media, keluar margin, sinkron dengan jumlah. */
    validate(project) {
      const s = project.settings; const u = Layout.usable(s);
      const res = { collisions: new Set(), pairs: [], oob: new Set(), outsideMargin: new Set(), missing: [], extra: 0, stale: false, placed: 0, needed: 0 };
      const layout = project.layout || { pages: [] };
      res.stale = layout.pages.length > 0 && layout.sig !== Layout.signature(s);
      const have = {}; const valid = new Set();
      project.persons.forEach((p) => p.variants.forEach((v) => valid.add(v.id)));
      layout.pages.forEach((pg) => {
        pg.items.forEach((it) => {
          have[it.variantId] = (have[it.variantId] || 0) + 1;
          if (!valid.has(it.variantId)) res.extra++;
          if (it.x < -EPS || it.y < -EPS || it.x + it.w > u.W + EPS || it.y + it.h > u.H + EPS) res.oob.add(it.id);
          else if (it.x < u.x0 - EPS || it.y < u.y0 - EPS || it.x + it.w > u.x0 + u.pw + EPS || it.y + it.h > u.y0 + u.ph + EPS) res.outsideMargin.add(it.id);
        });
        for (let i = 0; i < pg.items.length; i++) for (let j = i + 1; j < pg.items.length; j++) {
          const a = pg.items[i], c = pg.items[j];
          if (a.x < c.x + c.w - 1e-4 && a.x + a.w > c.x + 1e-4 && a.y < c.y + c.h - 1e-4 && a.y + a.h > c.y + 1e-4) { res.collisions.add(a.id); res.collisions.add(c.id); res.pairs.push([a.id, c.id]); }
        }
      });
      project.persons.forEach((per) => per.variants.forEach((v) => {
        if (!per.photoId) return;
        res.needed += v.qty; const h = Math.min(have[v.id] || 0, v.qty); res.placed += h;
        if ((have[v.id] || 0) < v.qty) res.missing.push({ personId: per.id, variantId: v.id, count: v.qty - (have[v.id] || 0) });
        if ((have[v.id] || 0) > v.qty) res.extra += (have[v.id] - v.qty);
      }));
      return res;
    },

    /** Pemanfaatan area cetak per halaman (0..1). */
    utilization(project) {
      const u = Layout.usable(project.settings); const total = u.pw * u.ph;
      return (project.layout.pages || []).map((pg) => pg.items.reduce((a, i) => a + i.w * i.h, 0) / total);
    },

    // ----------------- perataan (untuk editor manual) -----------------
    bbox(items) {
      const x1 = Math.min(...items.map((i) => i.x)), y1 = Math.min(...items.map((i) => i.y));
      return { x1, y1, x2: Math.max(...items.map((i) => i.x + i.w)), y2: Math.max(...items.map((i) => i.y + i.h)) };
    },
    /** mode: left|right|top|bottom|centerH|centerV ; ref = kotak acuan {x1,y1,x2,y2} */
    align(items, mode, ref) {
      const r = ref || Layout.bbox(items);
      items.forEach((i) => {
        if (i.locked) return;
        if (mode === 'left') i.x = r.x1; else if (mode === 'right') i.x = r.x2 - i.w; else if (mode === 'top') i.y = r.y1;
        else if (mode === 'bottom') i.y = r.y2 - i.h; else if (mode === 'centerH') i.x = (r.x1 + r.x2) / 2 - i.w / 2; else if (mode === 'centerV') i.y = (r.y1 + r.y2) / 2 - i.h / 2;
      });
    },
    /** Bagi jarak sama rata antar ≥3 item. axis: 'h' | 'v'. */
    distribute(items, axis) {
      if (items.length < 3) return false;
      const k = axis === 'h' ? 'x' : 'y', d = axis === 'h' ? 'w' : 'h';
      const arr = items.slice().sort((a, c) => a[k] - c[k]);
      const first = arr[0][k], last = arr[arr.length - 1][k] + arr[arr.length - 1][d];
      const total = arr.reduce((a, i) => a + i[d], 0); const gap = (last - first - total) / (arr.length - 1);
      let pos = first; arr.forEach((i) => { if (!i.locked) i[k] = pos; pos += i[d] + gap; });
      return true;
    },
  };

  PPS.Layout = Layout;
  if (typeof module !== 'undefined' && module.exports) module.exports = PPS;
})();
