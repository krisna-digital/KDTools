/**
 * export.js — Render halaman, garis potong, dan ekspor (PDF / PNG / JPEG / Print).
 *
 * PPS.Render : satu-satunya pintu penggambaran halaman (dipakai preview, PNG, JPEG, thumbnail).
 *              PDF memakai posisi mm yang sama + segmen garis dari fungsi yang sama -> identik dengan preview.
 * PPS.Export : PDF (jsPDF), PNG, JPEG (+ZIP), Print, estimasi ukuran file.
 */
(function () {
  'use strict';
  const PPS = (window.PPS = window.PPS || {});
  const U = PPS.Util; const IM = () => PPS.Imaging;
  const MAX_SIDE = 16384, MAX_AREA = 150e6;

  const findInfo = (project, item) => {
    for (const person of project.persons) { const variant = person.variants.find((v) => v.id === item.variantId); if (variant && person.id === item.personId) return { person, variant }; }
    return null;
  };

  /** Ukuran piksel canvas "natural" (tanpa rotasi) satu item pada skala s (px/mm). */
  function natural(item, s, bleed, preview) {
    const nw = (item.rot ? item.h : item.w) + 2 * bleed, nh = (item.rot ? item.w : item.h) + 2 * bleed;
    let w = nw * s, h = nh * s; if (preview) { w = Math.max(32, Math.ceil(w / 32) * 32); h = Math.max(32, Math.round((w * nh) / nw)); } else { w = Math.round(w); h = Math.round(h); }
    return { nw, nh, w, h };
  }

  /** Segmen garis potong (mm) untuk satu item. style: none|cut|corner|crop. */
  function marksSegments(item, settings) {
    const m = settings.marks; if (!m || m.style === 'none') return [];
    const gap = Math.min(settings.spacing.h, settings.spacing.v) + 2 * (settings.bleed || 0);
    const x1 = item.x, y1 = item.y, x2 = item.x + item.w, y2 = item.y + item.h; const segs = [];
    if (m.style === 'cut') {
      const o = Math.max(0, Math.min(m.offset, gap / 2 - m.width / 2 - 0.01)); const a = x1 - o, b = y1 - o, c = x2 + o, d = y2 + o;
      segs.push([a, b, c, b], [c, b, c, d], [c, d, a, d], [a, d, a, b]);
    } else if (m.style === 'crop') {
      const o = Math.min(m.offset, Math.max(0, gap - 0.2)); const L = Math.max(0, Math.min(m.length, gap - o - 0.05));
      if (L > 0.05) [[x1, y1, -1, -1], [x2, y1, 1, -1], [x1, y2, -1, 1], [x2, y2, 1, 1]].forEach(([cx, cy, sx, sy]) => { segs.push([cx + sx * o, cy, cx + sx * (o + L), cy], [cx, cy + sy * o, cx, cy + sy * (o + L)]); });
    } else if (m.style === 'corner') {
      const o = Math.min(m.offset, Math.max(0, gap / 2 - m.width)); const L = Math.max(0.3, m.length);
      [[x1 - o, y1 - o, 1, 1], [x2 + o, y1 - o, -1, 1], [x1 - o, y2 + o, 1, -1], [x2 + o, y2 + o, -1, -1]].forEach(([cx, cy, sx, sy]) => { segs.push([cx, cy, cx + sx * L, cy], [cx, cy, cx, cy + sy * L]); });
    }
    return segs;
  }
  function drawMarks(ctx, page, settings, s, minPx) {
    const m = settings.marks; if (!m || m.style === 'none') return;
    ctx.save(); ctx.strokeStyle = m.color; ctx.lineWidth = Math.max(minPx || 0, m.width * s); ctx.lineCap = 'butt'; ctx.beginPath();
    page.items.forEach((it) => marksSegments(it, settings).forEach(([a, b, c, d]) => { ctx.moveTo(a * s, b * s); ctx.lineTo(c * s, d * s); }));
    ctx.stroke(); ctx.restore();
  }

  function drawItemCanvas(ctx, item, canvas, s, bleed) {
    const nw = (item.rot ? item.h : item.w) + 2 * bleed, nh = (item.rot ? item.w : item.h) + 2 * bleed;
    const cx = (item.x + item.w / 2) * s, cy = (item.y + item.h / 2) * s;
    ctx.save(); ctx.translate(cx, cy); if (item.rot) ctx.rotate(Math.PI / 2);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, (-nw * s) / 2, (-nh * s) / 2, nw * s, nh * s); ctx.restore();
  }

  const Render = {
    natural, marksSegments, findInfo,

    /**
     * Gambar halaman secara SINKRON untuk preview interaktif. Item yang belum ter-cache digambar sebagai
     * placeholder dan onLoaded() dipanggil setelah siap. s = px per mm.
     */
    paintSync(ctx, project, page, s, opt = {}) {
      const st = project.settings; const bleed = st.bleed || 0; const pg = PPS.Config.pageSize(st);
      ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pg.w * s, pg.h * s); ctx.restore();
      const pending = [];
      page.items.forEach((item) => {
        const info = findInfo(project, item); if (!info) return;
        const n = natural(item, s, bleed, true); const o = { bleedMm: bleed, preview: true };
        const c = IM().peekVariant(info.person, info.variant, n.w, n.h, o);
        if (c) drawItemCanvas(ctx, item, c, s, bleed);
        else { ctx.fillStyle = '#e4e7f1'; ctx.fillRect(item.x * s, item.y * s, item.w * s, item.h * s); pending.push(IM().renderVariant(info.person, info.variant, n.w, n.h, o).catch(() => null)); }
      });
      if (opt.marks !== false) drawMarks(ctx, page, st, s, opt.minLine || 0);
      if (pending.length && opt.onLoaded) Promise.all(pending).then(() => opt.onLoaded());
    },

    /** Gambar halaman penuh (async, kualitas ekspor). s = px per mm. */
    async paintAsync(ctx, project, page, s, opt = {}) {
      const st = project.settings; const bleed = st.bleed || 0; const pg = PPS.Config.pageSize(st);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, Math.round(pg.w * s), Math.round(pg.h * s));
      let n = 0;
      for (const item of page.items) {
        if (opt.signal && opt.signal.cancelled) throw new Error('Dibatalkan.');
        const info = findInfo(project, item); if (!info) continue;
        const d = natural(item, s, bleed, !!opt.preview);
        const c = await IM().renderVariant(info.person, info.variant, d.w, d.h, { bleedMm: bleed, preview: !!opt.preview });
        drawItemCanvas(ctx, item, c, s, bleed);
        if (++n % 6 === 0) await U.yieldUI();
      }
      if (opt.marks !== false) drawMarks(ctx, page, st, s, opt.minLine || 0);
    },

    /** Canvas halaman pada DPI tertentu. Melempar galat jelas bila terlalu besar. */
    async pageCanvas(project, pageIdx, dpi, opt = {}) {
      const pg = PPS.Config.pageSize(project.settings); const w = Math.round((pg.w / 25.4) * dpi), h = Math.round((pg.h / 25.4) * dpi);
      if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_AREA) throw new Error(`Resolusi ${dpi} DPI menghasilkan gambar ${w}×${h}px (${Math.round((w * h) / 1e6)} MP) — melebihi batas aman browser. Turunkan DPI atau ekspor sebagai PDF (tidak membuat kanvas satu halaman penuh).`);
      const c = U.canvas(w, h); await Render.paintAsync(c.getContext('2d'), project, project.layout.pages[pageIdx], dpi / 25.4, opt); return c;
    },
    /** Thumbnail halaman kecil (data URL JPEG). */
    async thumb(project, pageIdx, maxPx = 240) {
      const pg = PPS.Config.pageSize(project.settings); const s = maxPx / Math.max(pg.w, pg.h); const c = U.canvas(pg.w * s, pg.h * s);
      await Render.paintAsync(c.getContext('2d'), project, project.layout.pages[pageIdx], s, { preview: true, minLine: 1 }); return c.toDataURL('image/jpeg', 0.7);
    },
  };

  // ======================================================================= Export
  function layoutReady(project) {
    if (!project.layout || !project.layout.pages.length) throw new Error('Belum ada layout. Klik “Generate Layout” terlebih dahulu.');
    const v = PPS.Layout.validate(project);
    if (v.missing.length) throw new Error('Layout belum sinkron dengan jumlah foto (ada foto yang belum ditempatkan). Klik “Auto Arrange” atau “Generate Layout”.');
  }

  const Export = {
    layoutReady,
    /** Estimasi ukuran file & kebutuhan memori. */
    estimate(project, fmt, dpi) {
      const pages = project.layout.pages; const pg = PPS.Config.pageSize(project.settings); const pxmm = dpi / 25.4;
      const pagePx = pg.w * pxmm * pg.h * pxmm; let itemPx = 0; const uniq = new Map();
      pages.forEach((p) => p.items.forEach((i) => { const a = i.w * i.h * pxmm * pxmm; itemPx += a; uniq.set(i.variantId + (i.rot ? 'r' : ''), Math.max(uniq.get(i.variantId + (i.rot ? 'r' : '')) || 0, a)); }));
      let bytes, warn = []; const uniqPx = Array.from(uniq.values()).reduce((a, b) => a + b, 0);
      if (fmt === 'pdf') bytes = uniqPx * 0.3 + 20000 * pages.length;
      else if (fmt === 'png') bytes = itemPx * 1.9 + pagePx * 0.02;
      else bytes = itemPx * 0.22 + pagePx * 0.01;
      const mem = fmt === 'pdf' ? Math.max(...Array.from(uniq.values()).concat([0])) * 4 * 3 : pagePx * 4 * 2;
      const w = Math.round(pg.w * pxmm), h = Math.round(pg.h * pxmm);
      if (fmt !== 'pdf' && (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_AREA)) warn.push(`Halaman ${w}×${h}px terlalu besar untuk PNG/JPEG pada ${dpi} DPI. Gunakan PDF atau turunkan DPI.`);
      else if (mem > 600e6) warn.push('Memori yang dibutuhkan besar (> 600 MB); proses bisa lambat atau gagal di perangkat dengan RAM kecil.');
      return { bytes, mem, warn, pxW: w, pxH: h };
    },

    /** PDF: ukuran halaman = ukuran media; foto ditempatkan pada koordinat mm yang tepat; tanpa scaling. */
    async pdf(project, opt = {}) {
      layoutReady(project);
      if (!window.jspdf) throw new Error('Pustaka jsPDF tidak termuat.');
      const { jsPDF } = window.jspdf; const dpi = opt.dpi || 300; const st = project.settings; const pg = PPS.Config.pageSize(st); const bleed = st.bleed || 0;
      const orient = pg.w > pg.h ? 'l' : 'p';
      const doc = new jsPDF({ orientation: orient, unit: 'mm', format: [pg.w, pg.h], compress: true, putOnlyUsedFonts: true });
      doc.setProperties({ title: `${project.name} — ${project.customer || ''}`.trim(), creator: 'PHOTO PRINT STUDIO — KRISNA DIGITAL', subject: `${st.media.preset} ${pg.w}×${pg.h} mm @${dpi} DPI` });
      const cache = new Map(); const totalItems = project.layout.pages.reduce((a, p) => a + p.items.length, 0); let done = 0;
      const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      for (let pi = 0; pi < project.layout.pages.length; pi++) {
        if (pi > 0) doc.addPage([pg.w, pg.h], orient);
        const page = project.layout.pages[pi];
        for (const item of page.items) {
          if (opt.signal && opt.signal.cancelled) throw new Error('Dibatalkan.');
          const info = findInfo(project, item); if (!info) continue;
          const nat = natural(item, dpi / 25.4, bleed, false); const key = [info.variant.id, item.rot ? 'r' : 'n', nat.w, nat.h].join('|');
          let ent = cache.get(key);
          if (!ent) {
            let c = await IM().renderVariant(info.person, info.variant, nat.w, nat.h, { bleedMm: bleed }); if (item.rot) c = IM().rotateCanvas90(c);
            const alpha = info.variant.bg && info.variant.bg.type === 'transparent' && info.person.cutout;
            ent = { url: alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.95), fmt: alpha ? 'PNG' : 'JPEG', alias: 'i' + cache.size }; cache.set(key, ent);
          }
          doc.addImage(ent.url, ent.fmt, item.x - bleed, item.y - bleed, item.w + 2 * bleed, item.h + 2 * bleed, ent.alias, 'NONE');
          done++; if (opt.onProgress) opt.onProgress(done / totalItems, `Halaman ${pi + 1}/${project.layout.pages.length} — foto ${done}/${totalItems}`);
          if (done % 5 === 0) await U.yieldUI();
        }
        const m = st.marks; if (m && m.style !== 'none') {
          doc.setDrawColor(...rgb(m.color)); doc.setLineWidth(m.width);
          page.items.forEach((it) => marksSegments(it, st).forEach(([a, b, c, d]) => doc.line(a, b, c, d)));
        }
      }
      return doc.output('blob');
    },

    /** PNG / JPEG per halaman. Mengembalikan [{name, blob}]. */
    async images(project, fmt, opt = {}) {
      layoutReady(project); const dpi = opt.dpi || 300; const type = fmt === 'png' ? 'image/png' : 'image/jpeg'; const ext = fmt === 'png' ? 'png' : 'jpg';
      const idxs = opt.pages || project.layout.pages.map((_, i) => i); const out = [];
      for (let k = 0; k < idxs.length; k++) {
        if (opt.signal && opt.signal.cancelled) throw new Error('Dibatalkan.');
        opt.onProgress && opt.onProgress(k / idxs.length, `Merender halaman ${idxs[k] + 1}…`);
        const c = await Render.pageCanvas(project, idxs[k], dpi, { signal: opt.signal });
        let blob = await U.toBlob(c, type, opt.quality || 0.92); blob = await U.setDpi(blob, dpi); c.width = c.height = 1;
        out.push({ name: `${U.safeName(project.name)}_hal-${String(idxs[k] + 1).padStart(2, '0')}_${dpi}dpi.${ext}`, blob }); await U.yieldUI();
      }
      opt.onProgress && opt.onProgress(1, 'Selesai'); return out;
    },

    /** Print: halaman dirender sebagai gambar berukuran fisik, skala 100%. */
    async print(project, opt = {}) {
      layoutReady(project); const pg = PPS.Config.pageSize(project.settings); const dpi = Math.min(opt.dpi || 200, 300);
      const root = document.createElement('div'); root.id = 'print-root'; const urls = [];
      for (let i = 0; i < project.layout.pages.length; i++) {
        opt.onProgress && opt.onProgress(i / project.layout.pages.length, `Menyiapkan halaman ${i + 1}…`);
        const c = await Render.pageCanvas(project, i, dpi); const b = await U.toBlob(c, 'image/png'); const url = URL.createObjectURL(b); urls.push(url);
        const img = new Image(); img.src = url; img.style.cssText = `width:${pg.w}mm;height:${pg.h}mm;display:block;page-break-after:${i < project.layout.pages.length - 1 ? 'always' : 'auto'};break-after:${i < project.layout.pages.length - 1 ? 'page' : 'auto'}`; await img.decode().catch(() => {}); root.appendChild(img);
      }
      const style = document.createElement('style'); style.id = 'print-page-style'; style.textContent = `@page{size:${pg.w}mm ${pg.h}mm;margin:0}`;
      document.head.appendChild(style); document.body.appendChild(root); document.body.classList.add('printing');
      const cleanup = () => { document.body.classList.remove('printing'); root.remove(); style.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup); setTimeout(() => window.print(), 80);
    },
  };

  PPS.Render = Render; PPS.Export = Export;
})();
