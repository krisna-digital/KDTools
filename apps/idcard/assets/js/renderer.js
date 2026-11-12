/* IDCARD STUDIO — renderer.js
 * SATU sistem rendering untuk preview, Template Designer, PNG, dan PDF.
 * Semua posisi dalam mm; skala px/mm hanya diterapkan lewat transformasi canvas.
 * Tidak ada penghitungan posisi terpisah untuk export.
 */
(function (root) {
  'use strict';
  var IDS = root.IDS = root.IDS || {};

  var REF = 100;          // ukuran font referensi saat mengukur (px)
  var CAP = 0.716;        // tinggi huruf kapital / em (Arial & turunannya)
  var LINE = 1.2;         // jarak antarbaris untuk teks multi-baris

  /* ---------- Pengukuran teks ---------- */

  var _mctx = null;
  /** Pengukur: kembalikan lebar teks dalam satuan em (untuk 1 em = 1). */
  IDS.makeMeasurer = function (ctx) {
    ctx = ctx || (function () {
      if (_mctx) return _mctx;
      var c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(10, 10) : document.createElement('canvas');
      return (_mctx = c.getContext('2d'));
    })();
    return function (text, field) {
      ctx.font = (field.fontWeight || 'normal') + ' ' + REF + 'px ' + (field.fontFamily || 'Arial');
      return ctx.measureText(text).width / REF;
    };
  };

  function textWidth(measure, text, size, field) {
    var n = Array.from(text).length;
    return measure(text, field) * size * (field.hScale || 1) + (field.letterSpacing || 0) * Math.max(0, n - 1);
  }

  function wrapText(measure, text, size, field, maxW) {
    var words = text.split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (!cur || textWidth(measure, t, size, field) <= maxW) cur = t;
      else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  /**
   * Hitung ukuran font terbesar yang muat di area field.
   * Mengembalikan {size, lines:[{text,width}], overflow}. Teks TIDAK pernah dipotong:
   * bila tak muat pada ukuran minimum, overflow=true (UI menampilkan peringatan).
   */
  IDS.fitText = function (measure, text, field) {
    var min = field.minFontSize || 1, max = field.maxFontSize || field.fontSize || 3;
    var W = field.width, H = field.height, n = Array.from(text).length, size, lines, overflow = false;

    if (!field.wrap) {
      var em = measure(text, field) * (field.hScale || 1);
      if (field.autoFit) {
        var sW = em > 0 ? (W - (field.letterSpacing || 0) * Math.max(0, n - 1)) / em : max;
        size = Math.min(max, sW, H / CAP);
        if (size < min) { size = min; }
      } else size = field.fontSize || max;
      var w = textWidth(measure, text, size, field);
      overflow = w > W + 1e-6 || CAP * size > H + 1e-6;
      return { size: size, lines: [{ text: text, width: w }], overflow: overflow };
    }

    size = field.autoFit ? max : (field.fontSize || max);
    var floor = field.autoFit ? min : size;
    for (;;) {
      lines = wrapText(measure, text, size, field, W);
      var h = CAP * size + (lines.length - 1) * size * LINE;
      var widest = Math.max.apply(null, lines.map(function (l) { return textWidth(measure, l, size, field); }));
      if ((h <= H + 1e-6 && widest <= W + 1e-6) || size <= floor + 1e-9) {
        overflow = !(h <= H + 1e-6 && widest <= W + 1e-6);
        break;
      }
      size = Math.max(floor, size - 0.05);
    }
    return { size: size, lines: lines.map(function (l) { return { text: l, width: textWidth(measure, l, size, field) }; }), overflow: overflow };
  };

  /** Hitung posisi (mm) baris pertama: x awal tiap baris & baseline. Murni (dapat diuji). */
  IDS.layoutLines = function (field, fit) {
    var out = [], size = fit.size, n = fit.lines.length;
    var blockH = CAP * size + (n - 1) * size * LINE;
    var top;
    if (field.verticalAlign === 'top') top = field.y;
    else if (field.verticalAlign === 'bottom') top = field.y + field.height - blockH;
    else top = field.y + (field.height - blockH) / 2;
    fit.lines.forEach(function (l, i) {
      var x = field.x;
      if (field.textAlign === 'center') x = field.x + (field.width - l.width) / 2;
      else if (field.textAlign === 'right') x = field.x + field.width - l.width;
      out.push({ text: l.text, x: x, baseline: top + CAP * size + i * size * LINE, width: l.width });
    });
    return out;
  };

  /** Crop foto "cover" dengan zoom & geser. pan -1..1. Hasil: rect gambar (mm) relatif area foto. */
  IDS.photoCrop = function (iw, ih, fw, fh, adj) {
    adj = adj || {};
    var zoom = Math.max(1, adj.zoom || 1);
    var s = Math.max(fw / iw, fh / ih) * zoom;
    var dw = iw * s, dh = ih * s;
    var px = Math.max(-1, Math.min(1, adj.panX || 0)), py = Math.max(-1, Math.min(1, adj.panY || 0));
    return { dx: -(dw - fw) * (0.5 + px / 2), dy: -(dh - fh) * (0.5 + py / 2), dw: dw, dh: dh };
  };

  /* ---------- Penggambaran ---------- */

  function drawBackground(ctx, bg, W, H) {
    if (!bg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); return; }
    var bw = bg.naturalWidth || bg.width, bh = bg.naturalHeight || bg.height;
    var s = Math.max(W / bw, H / bh);               // proporsi asli dipertahankan (tidak diregangkan)
    var dw = bw * s, dh = bh * s;
    ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  function drawText(ctx, field, lines, size) {
    ctx.fillStyle = field.color || '#000';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = (field.fontWeight || 'normal') + ' ' + (size * REF) + 'px ' + (field.fontFamily || 'Arial');
    var hs = field.hScale || 1, ls = field.letterSpacing || 0;
    lines.forEach(function (l) {
      ctx.save();
      ctx.translate(l.x, l.baseline);
      ctx.scale(hs / REF, 1 / REF);
      if (!ls) ctx.fillText(l.text, 0, 0);
      else {
        var x = 0;
        Array.from(l.text).forEach(function (ch) {
          ctx.fillText(ch, x, 0);
          x += ctx.measureText(ch).width + ls * REF / hs;
        });
      }
      ctx.restore();
    });
  }

  /**
   * Render satu sisi kartu ke canvas.
   * opts: { config, bg, data, photo, photoAdj, pxPerMm, measure }
   * Return { warnings:[{id,msg}], fields:[{id,type,empty,overflow}] }
   */
  IDS.renderCard = function (canvas, opts) {
    var cfg = opts.config, k = opts.pxPerMm, W = cfg.widthMm, H = cfg.heightMm;
    canvas.width = Math.round(W * k);
    canvas.height = Math.round(H * k);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    var measure = opts.measure || IDS.makeMeasurer();
    var res = { warnings: [], fields: [] };

    drawBackground(ctx, opts.bg, W, H);

    cfg.fields.forEach(function (f) {
      if (f.type !== 'photo') return;
      var info = { id: f.id, type: 'photo', empty: !opts.photo, overflow: false };
      if (opts.photo) {
        var iw = opts.photo.naturalWidth || opts.photo.width, ih = opts.photo.naturalHeight || opts.photo.height;
        var c = IDS.photoCrop(iw, ih, f.width, f.height, opts.photoAdj);
        ctx.save();
        ctx.beginPath(); ctx.rect(f.x, f.y, f.width, f.height); ctx.clip();
        ctx.drawImage(opts.photo, f.x + c.dx, f.y + c.dy, c.dw, c.dh);
        ctx.restore();
        if (f.border && f.border.width > 0) {
          ctx.save(); ctx.strokeStyle = f.border.color || '#000'; ctx.lineWidth = f.border.width;
          ctx.strokeRect(f.x + f.border.width / 2, f.y + f.border.width / 2, f.width - f.border.width, f.height - f.border.width);
          ctx.restore();
        }
      }
      res.fields.push(info);
    });

    cfg.fields.forEach(function (f) {
      if (f.type !== 'text') return;
      var text = IDS.fieldText(f, opts.data);
      var info = { id: f.id, type: 'text', empty: !text, overflow: false };
      if (text) {
        var fit = IDS.fitText(measure, text, f);
        drawText(ctx, f, IDS.layoutLines(f, fit), fit.size);
        info.overflow = fit.overflow; info.size = fit.size;
        if (fit.overflow) res.warnings.push({ id: f.id, msg: 'Teks "' + (f.label || f.id) + '" terlalu panjang: tidak muat pada ukuran font minimum (' + (f.minFontSize || 1) + ' mm).' });
      }
      res.fields.push(info);
    });
    return res;
  };

  /** Cek rasio gambar template terhadap 55:85. Kembalikan pesan peringatan atau null. */
  IDS.checkRatio = function (w, h, cfg) {
    var r = w / h, target = (cfg ? cfg.widthMm / cfg.heightMm : 55 / 85), diff = Math.abs(r - target) / target;
    if (diff > 0.01) return 'Rasio gambar template ' + w + '×' + h + ' px (' + r.toFixed(4) + ') tidak sama dengan 55:85 (' + target.toFixed(4) + '). Gambar tidak diregangkan; sebagian tepi dapat terpotong.';
    return null;
  };

  IDS.constants = { REF: REF, CAP: CAP, LINE: LINE };

  if (typeof module !== 'undefined' && module.exports) module.exports = IDS;
})(typeof window !== 'undefined' ? window : globalThis);
