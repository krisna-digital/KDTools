/**
 * image-editor.js — Pemrosesan gambar dan editor crop.
 *
 * PPS.Imaging  : cache gambar, penghitung crop, renderer varian (SATU renderer dipakai preview,
 *                PNG, JPEG dan PDF sehingga hasilnya identik).
 * PPS.CropEditor : editor crop berbasis Canvas (bukan CSS transform).
 *
 * Model crop per varian: { rot: 0|90|180|270, flip: bool, cx, cy (pusat 0..1 pada gambar yang sudah
 * diputar/dibalik), zoom (1 = crop terbesar yang muat pada rasio ukuran cetak) }
 */
(function () {
  'use strict';
  const PPS = (window.PPS = window.PPS || {});
  const U = PPS.Util;

  const DEFAULT_CROP = () => ({ rot: 0, flip: false, cx: 0.5, cy: 0.5, zoom: 1 });
  const DEFAULT_BG = () => ({ type: 'original', color: '#1f5fd6', imageId: null });

  // -------------------------------------------------------------- cache gambar
  const bmpCache = new Map(); // key -> Promise<ImageBitmap>
  const BMP_LIMIT = 8;
  function evict(map, limit) { while (map.size > limit) map.delete(map.keys().next().value); }

  /** Ambil bitmap sebuah blob. maxDim>0 menghasilkan proksi kecil (untuk preview cepat). */
  function getBitmap(blobId, maxDim = 0) {
    const key = blobId + '@' + maxDim;
    if (bmpCache.has(key)) { const p = bmpCache.get(key); bmpCache.delete(key); bmpCache.set(key, p); return p; }
    const p = (async () => {
      if (maxDim === 0) {
        const blob = await PPS.Storage.getBlob(blobId);
        if (!blob) throw new Error('Data gambar tidak ditemukan di penyimpanan lokal.');
        return U.bitmap(blob);
      }
      const base = await getBitmap(blobId, 0); const m = Math.max(base.width, base.height);
      if (m <= maxDim) return base;
      const k = maxDim / m;
      return createImageBitmap(base, { resizeWidth: Math.round(base.width * k), resizeHeight: Math.round(base.height * k), resizeQuality: 'high' });
    })();
    bmpCache.set(key, p); evict(bmpCache, BMP_LIMIT);
    p.catch(() => bmpCache.delete(key));
    return p;
  }
  function dropBitmaps(blobId) { for (const k of Array.from(bmpCache.keys())) if (k.startsWith(blobId + '@')) bmpCache.delete(k); }
  function clearBitmaps() { bmpCache.clear(); }

  // object URL untuk thumbnail (di-revoke saat tidak dipakai)
  const urlCache = new Map();
  async function thumbURL(blobId) {
    if (!blobId) return '';
    if (urlCache.has(blobId)) return urlCache.get(blobId);
    const b = await PPS.Storage.getBlob(blobId); if (!b) return '';
    const url = URL.createObjectURL(b); urlCache.set(blobId, url); return url;
  }
  function revokeURLs(ids) { (ids || Array.from(urlCache.keys())).forEach((id) => { const u = urlCache.get(id); if (u) { URL.revokeObjectURL(u); urlCache.delete(id); } }); }

  // -------------------------------------------------------------- geometri crop
  function orientedSize(rot, W, H) { return rot % 180 ? { OW: H, OH: W } : { OW: W, OH: H }; }
  /** Persegi crop (koordinat piksel gambar teroriensi). */
  function cropRect(crop, W, H, aspect) {
    const c = Object.assign(DEFAULT_CROP(), crop || {});
    const { OW, OH } = orientedSize(c.rot, W, H);
    const base = Math.min(OW, OH * aspect);
    const w = base / c.zoom, h = w / aspect;
    const cx = U.clamp(c.cx, 0, 1) * OW, cy = U.clamp(c.cy, 0, 1) * OH;
    return { x: cx - w / 2, y: cy - h / 2, w, h, OW, OH };
  }
  /** Terapkan rotasi lalu flip pada ctx agar menggambar gambar asli ke ruang "teroriensi". */
  function orient(ctx, rot, flip, W, H) {
    const { OW } = orientedSize(rot, W, H);
    if (flip) ctx.transform(-1, 0, 0, 1, OW, 0);
    if (rot === 90) ctx.transform(0, 1, -1, 0, H, 0);
    else if (rot === 180) ctx.transform(-1, 0, 0, -1, W, H);
    else if (rot === 270) ctx.transform(0, -1, 1, 0, 0, W);
  }
  /** DPI efektif varian pada ukuran cetaknya (berdasarkan piksel asli). */
  function effectiveDpi(person, variant) {
    if (!person.imgW) return null;
    const cr = cropRect(variant.crop, person.imgW, person.imgH, variant.w / variant.h);
    return Math.round(cr.w / (variant.w / 25.4));
  }

  // -------------------------------------------------------------- renderer varian
  const renderCache = new Map(); // key -> canvas
  const inflight = new Map();
  const RENDER_LIMIT = 160;

  function revKey(person, variant, w, h, opt) {
    const cut = person.cutout;
    return [person.photoId, cut && cut.cutoutId, JSON.stringify(variant.crop || {}), JSON.stringify(variant.bg || {}),
      cut && cut.params ? JSON.stringify(cut.params.shadow || {}) : '', variant.w, variant.h, w, h, opt.bleedMm || 0, opt.preview ? 1 : 0].join('|');
  }
  /** Ambil dari cache tanpa menunggu (null bila belum ada). */
  function peekVariant(person, variant, w, h, opt = {}) { return renderCache.get(revKey(person, variant, w, h, opt)) || null; }

  /**
   * Render satu varian foto ke canvas w×h piksel. Ukuran piksel mewakili (ukuran + 2×bleed) mm.
   * Hasil mengikuti persis koordinat crop yang dipakai editor.
   */
  function renderVariant(person, variant, w, h, opt = {}) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const key = revKey(person, variant, w, h, opt);
    if (renderCache.has(key)) return Promise.resolve(renderCache.get(key));
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const bg = variant.bg || DEFAULT_BG();
      const useCut = bg.type !== 'original' && person.cutout && person.cutout.cutoutId;
      const src = await getBitmap(useCut ? person.cutout.cutoutId : person.photoId, opt.preview ? 1100 : 0);
      const canvas = U.canvas(w, h); const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      const crop = Object.assign(DEFAULT_CROP(), variant.crop || {});
      const cr = cropRect(crop, src.width, src.height, variant.w / variant.h);
      const bleed = opt.bleedMm || 0;
      const mmPx = cr.w / variant.w; // piksel gambar per mm
      const ex = { x: cr.x - bleed * mmPx, y: cr.y - bleed * mmPx, w: cr.w + 2 * bleed * mmPx, h: cr.h + 2 * bleed * mmPx };
      const s = w / ex.w;
      // latar
      if (bg.type === 'transparent' && useCut) { /* biarkan transparan */ }
      else if (bg.type === 'color' && useCut) { ctx.fillStyle = bg.color || '#ffffff'; ctx.fillRect(0, 0, w, h); }
      else if (bg.type === 'image' && useCut && bg.imageId) {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        try {
          const im = await getBitmap(bg.imageId, opt.preview ? 1100 : 0); const k = Math.max(w / im.width, h / im.height);
          ctx.drawImage(im, (w - im.width * k) / 2, (h - im.height * k) / 2, im.width * k, im.height * k);
        } catch (e) { /* latar hilang: tetap putih */ }
      } else { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
      // bayangan (hanya untuk hasil hapus background)
      const sh = useCut && person.cutout.params && person.cutout.params.shadow;
      if (sh && sh.on && bg.type !== 'transparent') {
        const pxMm = w / (variant.w + 2 * bleed);
        ctx.shadowColor = `rgba(0,0,0,${U.clamp(sh.opacity, 0, 1)})`; ctx.shadowBlur = sh.blur * pxMm; ctx.shadowOffsetY = sh.offset * pxMm;
      }
      ctx.save();
      ctx.setTransform(s, 0, 0, s, -ex.x * s, -ex.y * s);
      orient(ctx, crop.rot, crop.flip, src.width, src.height);
      ctx.drawImage(src, 0, 0);
      ctx.restore();
      renderCache.set(key, canvas); evict(renderCache, RENDER_LIMIT);
      return canvas;
    })();
    inflight.set(key, p);
    const done = () => inflight.delete(key); p.then(done, done);
    return p;
  }
  function clearRenderCache() { renderCache.clear(); }

  /** Putar canvas 90° searah jarum jam (untuk item yang dirotasi pada layout). */
  function rotateCanvas90(c) {
    const o = U.canvas(c.height, c.width); const x = o.getContext('2d');
    x.translate(o.width, 0); x.rotate(Math.PI / 2); x.drawImage(c, 0, 0); return o;
  }

  // -------------------------------------------------------------- impor foto
  const MAX_PIXELS = 160e6;
  /** Validasi & simpan foto (asli TIDAK diubah) + thumbnail. */
  async function importPhoto(file, projectId) {
    if (!file) throw new Error('Tidak ada file.');
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|bmp|gif|avif)$/i.test(file.name || '')) throw new Error(`"${file.name}" bukan file gambar.`);
    let bmp;
    try { bmp = await U.bitmap(file); } catch (e) { throw new Error(`"${file.name || 'gambar'}" tidak dapat dibaca (rusak atau format tidak didukung). Gunakan JPG, PNG, atau WebP.`); }
    if (bmp.width * bmp.height > MAX_PIXELS) { bmp.close(); throw new Error(`Foto terlalu besar (${bmp.width}×${bmp.height}px). Maksimum sekitar ${Math.round(MAX_PIXELS / 1e6)} megapiksel.`); }
    const k = Math.min(1, 420 / Math.max(bmp.width, bmp.height));
    const t = U.canvas(bmp.width * k, bmp.height * k); const tc = t.getContext('2d'); tc.imageSmoothingQuality = 'high'; tc.drawImage(bmp, 0, 0, t.width, t.height);
    const thumb = await U.toBlob(t, 'image/jpeg', 0.85);
    const info = { w: bmp.width, h: bmp.height, name: file.name || 'foto' };
    bmp.close();
    const photoId = await PPS.Storage.putBlob(projectId, file);
    const thumbId = await PPS.Storage.putBlob(projectId, thumb);
    return { photoId, thumbId, imgW: info.w, imgH: info.h, fileName: info.name };
  }

  PPS.Imaging = {
    DEFAULT_CROP, DEFAULT_BG, getBitmap, dropBitmaps, clearBitmaps, thumbURL, revokeURLs,
    cropRect, orient, orientedSize, effectiveDpi, renderVariant, peekVariant, clearRenderCache, rotateCanvas90, importPhoto,
  };

  // ============================================================== CropEditor
  class CropEditor {
    /** opts: { canvas, preview, onChange(state) } */
    constructor(opts) {
      this.cv = opts.canvas; this.pv = opts.preview; this.onChange = opts.onChange || (() => {});
      this.pointers = new Map(); this.stack = []; this.idx = -1; this._raf = 0;
      const cv = this.cv;
      cv.style.touchAction = 'none';
      cv.addEventListener('pointerdown', (e) => this._down(e));
      cv.addEventListener('pointermove', (e) => this._move(e));
      cv.addEventListener('pointerup', (e) => this._up(e));
      cv.addEventListener('pointercancel', (e) => this._up(e));
      cv.addEventListener('wheel', (e) => { e.preventDefault(); this.setZoom(this.state.zoom * Math.exp(-e.deltaY * 0.0015)); this.commitSoon(); }, { passive: false });
    }

    async load(person, variant) {
      this.person = person; this.variant = Object.assign({}, variant, { bg: Object.assign(DEFAULT_BG(), variant.bg || {}) });
      this.state = Object.assign(DEFAULT_CROP(), U.deepClone(variant.crop || {}));
      this.src = await getBitmap(person.photoId, 1600);
      this.stack = [JSON.stringify(this.state)]; this.idx = 0;
      this.resize(); this.draw(); this.drawPreview(); this.onChange(this.state);
    }
    resize() {
      const r = this.cv.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr; this.cv.width = Math.max(50, Math.round(r.width * dpr)); this.cv.height = Math.max(50, Math.round(r.height * dpr));
    }
    get aspect() { return this.variant.w / this.variant.h; }
    frame() {
      const cw = this.cv.width, ch = this.cv.height, A = this.aspect;
      const FW = Math.min(cw * 0.8, ch * 0.8 * A), FH = FW / A;
      return { FW, FH, fx: (cw - FW) / 2, fy: (ch - FH) / 2 };
    }
    draw() {
      if (!this.src) return;
      const ctx = this.cv.getContext('2d'); const cw = this.cv.width, ch = this.cv.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#161a2e'; ctx.fillRect(0, 0, cw, ch);
      const f = this.frame(); const cr = cropRect(this.state, this.src.width, this.src.height, this.aspect); const s = f.FW / cr.w;
      this._s = s; this._cr = cr;
      ctx.save(); ctx.imageSmoothingQuality = 'medium';
      ctx.setTransform(s, 0, 0, s, f.fx - cr.x * s, f.fy - cr.y * s);
      orient(ctx, this.state.rot, this.state.flip, this.src.width, this.src.height);
      ctx.drawImage(this.src, 0, 0); ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(8,10,24,.62)'; ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.rect(f.fx, f.fy, f.FW, f.FH); ctx.fill('evenodd');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * this.dpr; ctx.strokeRect(f.fx, f.fy, f.FW, f.FH);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = this.dpr; ctx.beginPath();
      for (let i = 1; i <= 2; i++) { ctx.moveTo(f.fx + (f.FW * i) / 3, f.fy); ctx.lineTo(f.fx + (f.FW * i) / 3, f.fy + f.FH); ctx.moveTo(f.fx, f.fy + (f.FH * i) / 3); ctx.lineTo(f.fx + f.FW, f.fy + (f.FH * i) / 3); }
      ctx.stroke();
    }
    drawPreview() {
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(async () => {
        const pv = this.pv; if (!pv || !this.src) return;
        const H = 260, W = Math.round(H * this.aspect); pv.width = W; pv.height = H;
        const v = Object.assign({}, this.variant, { crop: this.state });
        const c = await renderVariant(this.person, v, W, H, { preview: true });
        const x = pv.getContext('2d'); x.clearRect(0, 0, W, H); x.drawImage(c, 0, 0);
      });
    }
    _emit() { this.draw(); this.drawPreview(); this.onChange(this.state); }

    // ---- interaksi ----
    _down(e) { this.cv.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); this._pinch = null; }
    _move(e) {
      const p = this.pointers.get(e.pointerId); if (!p || !this._s) return;
      const nx = e.offsetX, ny = e.offsetY;
      if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, { x: nx, y: ny }); const [a, b] = Array.from(this.pointers.values()); const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinch) this.setZoom(this.state.zoom * (d / this._pinch)); this._pinch = d; this._moved = true; return;
      }
      const dx = (nx - p.x) * this.dpr, dy = (ny - p.y) * this.dpr; p.x = nx; p.y = ny;
      const { OW, OH } = this._cr; this.state.cx = U.clamp(this.state.cx - dx / this._s / OW, 0, 1); this.state.cy = U.clamp(this.state.cy - dy / this._s / OH, 0, 1);
      this._moved = true; this._emit();
    }
    _up(e) { this.pointers.delete(e.pointerId); this._pinch = null; if (this._moved && this.pointers.size === 0) { this._moved = false; this.commit(); } }

    // ---- operasi ----
    setZoom(z) { this.state.zoom = U.clamp(z, 0.3, 10); this._emit(); }
    commitSoon() { clearTimeout(this._ct); this._ct = setTimeout(() => this.commit(), 350); }
    commit() { const j = JSON.stringify(this.state); if (j === this.stack[this.idx]) return; this.stack = this.stack.slice(0, this.idx + 1); this.stack.push(j); if (this.stack.length > 60) this.stack.shift(); this.idx = this.stack.length - 1; this.onChange(this.state); }
    undo() { if (this.idx > 0) { this.idx--; this.state = JSON.parse(this.stack[this.idx]); this._emit(); } }
    redo() { if (this.idx < this.stack.length - 1) { this.idx++; this.state = JSON.parse(this.stack[this.idx]); this._emit(); } }
    get canUndo() { return this.idx > 0; } get canRedo() { return this.idx < this.stack.length - 1; }
    rotate() { const s = this.state; const cx = s.cx; s.rot = (s.rot + 90) % 360; s.cx = 1 - s.cy; s.cy = cx; this._emit(); this.commit(); }
    flip() { const s = this.state; s.flip = !s.flip; s.cx = 1 - s.cx; this._emit(); this.commit(); }
    reset() { this.state = DEFAULT_CROP(); this._emit(); this.commit(); }
    setState(st) { this.state = Object.assign(DEFAULT_CROP(), st); this._emit(); this.commit(); }
    setBg(bg) { this.variant.bg = Object.assign(DEFAULT_BG(), bg); this.drawPreview(); }
    dpi() { return effectiveDpi(this.person, Object.assign({}, this.variant, { crop: this.state })); }
  }
  PPS.CropEditor = CropEditor;
})();
