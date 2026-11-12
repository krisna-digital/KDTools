/* IDCARD STUDIO — app.js
 * Routing, state, Dashboard, Buat ID Card (form + preview + export), Pengaturan.
 */
(function (root) {
  'use strict';
  var IDS = root.IDS = root.IDS || {};
  var CSS_PX_PER_MM = 96 / 25.4;           // ukuran sebenarnya pada layar (zoom 100%)

  var state = {
    templateId: 'provinsi',
    data: {},                  // sumber data tunggal: nama, nip, jabatan, gol_darah
    photo: null, photoBlob: null, photoName: '',
    photoAdj: { zoom: 1, panX: 0, panY: 0 },
    configs: {}, bgs: {}, bgInfo: {},
    settings: { dpi: 600 },
    previewSide: 'front', previewZoom: 1
  };
  var SAMPLE = { nama: 'Krisna Digital, S.Pd', nip: '1945 202521 2 000', jabatan: 'Guru Ahli Pertama', gol_darah: 'B' };
  IDS.app = { state: state, SAMPLE: SAMPLE };

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function tpl() { return IDS.TEMPLATES[state.templateId]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var SIDE_LABEL = { front: 'depan', back: 'belakang' };

  /* ---------- Toast ---------- */
  var toastTimer = 0;
  IDS.app.toast = function (msg, kind) {
    var t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, 3800);
  };

  /* ---------- Gambar & konfigurasi ---------- */
  function loadImage(src) {
    return new Promise(function (res, rej) {
      var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('Gagal memuat gambar: ' + src)); }; im.src = src;
    });
  }

  IDS.app.reloadConfigs = function () {
    ['front', 'back'].forEach(function (side) { state.configs[side] = IDS.loadConfig(state.templateId, side).config; });
  };

  async function loadBackgrounds() {
    var t = tpl();
    for (var side of ['front', 'back']) {
      var key = 'bg:' + t.id + ':' + side, blob = await IDS.blobs.get(key), url = blob ? URL.createObjectURL(blob) : t.basePath + t.sides[side].image;
      try {
        var im = await loadImage(url);
        state.bgs[side] = im;
        state.bgInfo[side] = { custom: !!blob, w: im.naturalWidth, h: im.naturalHeight, warn: IDS.checkRatio(im.naturalWidth, im.naturalHeight, state.configs[side]) };
      } catch (e) { state.bgs[side] = null; state.bgInfo[side] = { error: e.message }; }
    }
  }

  async function loadPhoto() {
    var blob = await IDS.blobs.get('photo:' + state.templateId);
    if (blob) { try { state.photo = await createImageBitmap(blob); state.photoBlob = blob; } catch (e) { state.photo = null; } }
  }

  /* ---------- Rendering (satu sumber untuk preview & export) ---------- */
  IDS.app.renderTo = function (canvas, side, ppm, opts) {
    opts = opts || {};
    return IDS.renderCard(canvas, {
      config: opts.config || state.configs[side],
      bg: state.bgs[side],
      data: opts.data || state.data,
      photo: opts.photo === undefined ? state.photo : opts.photo,
      photoAdj: state.photoAdj,
      pxPerMm: ppm
    });
  };
  function renderSide(side, ppm) { var c = document.createElement('canvas'); IDS.app.renderTo(c, side, ppm); return c; }

  /* ---------- Routing ---------- */
  var routes = { dashboard: viewDashboard, generator: viewGenerator, designer: viewDesigner, settings: viewSettings };
  function route() {
    var name = (location.hash.replace(/^#\/?/, '') || 'dashboard');
    if (!routes[name]) name = 'dashboard';
    IDS.Designer.hide();
    $$('.nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.route === name); });
    document.body.dataset.view = name;
    var view = $('#view'); view.innerHTML = '';
    routes[name](view);
    window.scrollTo(0, 0);
  }

  /* ---------- Dashboard ---------- */
  function statusBadge(side) {
    var c = state.configs[side], approved = c && c.status === 'approved';
    return '<span class="badge ' + (approved ? 'ok' : 'warn') + '">' + (approved ? 'Disetujui' : 'Draf — periksa') + '</span>';
  }

  function viewDashboard(v) {
    var t = tpl(), allOk = ['front', 'back'].every(function (s) { return state.configs[s].status === 'approved'; });
    v.innerHTML =
      '<div class="page-head"><h1>Dashboard</h1><p class="muted">Buat ID Card pegawai otomatis</p></div>' +
      (allOk ? '' : '<div class="alert warn"><b>Posisi field belum disetujui.</b> Posisi awal diukur otomatis dari gambar ID Card jadi Anda. Periksa dan setujui satu kali di <a href="#/designer">Template Designer</a> sebelum dipakai untuk cetak.</div>') +
      '<div class="grid-2">' +
      '<div class="card tpl-card"><div class="tpl-thumbs"><img src="' + t.basePath + t.sides.front.image + '" alt="Depan"><img src="' + t.basePath + t.sides.back.image + '" alt="Belakang"></div>' +
      '<h3>' + esc(t.name) + '</h3><p class="muted">' + t.widthMm + ' × ' + t.heightMm + ' mm · portrait · depan &amp; belakang</p>' +
      '<table class="mini"><tr><td>Posisi sisi depan</td><td>' + statusBadge('front') + '</td></tr><tr><td>Posisi sisi belakang</td><td>' + statusBadge('back') + '</td></tr></table>' +
      '<div class="btn-row"><a class="btn primary" href="#/generator">Buat ID Card</a><a class="btn" href="#/designer">Template Designer</a></div></div>' +
      '<div class="card"><h3>Alur kerja</h3><ol class="steps"><li>Buka <b>Buat ID Card</b>.</li><li>Unggah foto pegawai, isi nama, NIP, jabatan, golongan darah.</li><li>Periksa preview sisi depan &amp; belakang (geser foto bila perlu).</li><li>Unduh <b>PNG</b> atau <b>PDF</b> 55 × 85 mm dan cetak pada <b>Actual Size / 100%</b>.</li></ol>' +
      '<p class="muted small">Semua proses berjalan lokal di browser. Tidak ada data yang dikirim ke server.</p></div>' +
      '</div>';
  }

  /* ---------- Template Designer ---------- */
  function viewDesigner(v) { IDS.Designer.show(v); }

  /* ---------- Generator ---------- */
  function persistData() { IDS.store.set('data:' + state.templateId, state.data); }
  function persistAdj() { IDS.store.set('photoAdj:' + state.templateId, state.photoAdj); }

  function formFieldHtml(f) {
    if (f.type === 'photo') {
      return '<div class="fld"><span>' + f.label + (f.required ? ' <b class="req">*</b>' : '') + '</span>' +
        '<label class="drop" id="drop"><input type="file" id="photo-file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp">' +
        '<div id="photo-info" class="drop-info"></div></label>' +
        '<div id="photo-adj" class="photo-adj" hidden>' +
        '<label class="small">Zoom <input type="range" id="adj-zoom" min="1" max="3" step="0.01"></label>' +
        '<label class="small">Geser horizontal <input type="range" id="adj-x" min="-1" max="1" step="0.01"></label>' +
        '<label class="small">Geser vertikal <input type="range" id="adj-y" min="-1" max="1" step="0.01"></label>' +
        '<div class="btn-row"><button class="btn small" id="adj-reset" type="button">Reset posisi foto</button><button class="btn small danger" id="photo-del" type="button">Hapus foto</button></div>' +
        '<p class="muted small">Tip: seret foto langsung di preview untuk mengatur posisi wajah.</p></div></div>';
    }
    if (f.type === 'synced') {
      return '<label class="fld"><span>' + f.label + ' <em class="sync-note">otomatis dari form depan</em></span><input type="text" data-sync="' + f.from + '" readonly tabindex="-1"></label>';
    }
    return '<label class="fld"><span>' + f.label + (f.required ? ' <b class="req">*</b>' : '') + '</span><input type="text" data-key="' + f.key + '" placeholder="' + esc(f.placeholder || '') + '" autocomplete="off"></label>';
  }

  function viewGenerator(v) {
    var t = tpl();
    v.innerHTML =
      '<div class="page-head"><h1>Buat ID Card</h1></div><div id="g-banner"></div>' +
      '<div class="gen">' +
      '<section class="gen-forms">' +
      '<div class="card"><label class="fld"><span>Jenis ID Card</span><select id="g-type"><option value="provinsi">' + esc(t.name) + '</option></select></label></div>' +
      '<div class="card"><h3>Sisi Depan</h3>' + t.form.front.map(formFieldHtml).join('') + '</div>' +
      '<div class="card"><h3>Sisi Belakang</h3>' + t.form.back.map(formFieldHtml).join('') +
      '<p class="muted small">Alamat kantor, tempat/tanggal, cap, dan tanda tangan sudah menjadi bagian permanen template.</p></div>' +
      '<div class="card"><h3>Unduh hasil</h3>' +
      '<div class="export-grid">' +
      '<button class="btn" data-exp="png-front">PNG sisi depan</button><button class="btn" data-exp="png-back">PNG sisi belakang</button>' +
      '<button class="btn primary" data-exp="pdf-two">PDF 2 halaman (55×85 mm)</button><button class="btn" data-exp="pdf-one">PDF 1 halaman (berdampingan)</button></div>' +
      '<label class="fld inline"><span>Resolusi</span><select id="g-dpi"><option value="300">300 dpi</option><option value="600">600 dpi (disarankan)</option><option value="900">900 dpi</option></select></label>' +
      '<div class="print-note"><b>Cetak:</b> pilih <b>Actual Size / 100%</b>, bukan <i>Fit to Page</i>. PDF mode 2 halaman berukuran tepat 55 × 85 mm tanpa margin; mode 1 halaman hanya untuk dokumentasi/pemeriksaan.</div>' +
      '<div id="g-exp-status" class="muted small"></div></div>' +
      '</section>' +
      '<section class="gen-preview card"><div class="pv-bar">' +
      '<div class="seg" id="pv-sides"><button data-side="front">Depan</button><button data-side="back">Belakang</button></div>' +
      '<div class="btn-group"><button class="btn" id="pv-out">−</button><span class="zoom-label" id="pv-zl"></span><button class="btn" id="pv-in">+</button><button class="btn" id="pv-reset">100%</button></div>' +
      '<a class="btn small" href="#/designer">Edit template</a></div>' +
      '<div class="pv-scroll"><div class="pv-stage" id="pv-stage"><canvas id="pv-canvas"></canvas><div class="pv-over" id="pv-over"></div></div></div>' +
      '<div id="pv-warn"></div>' +
      '<p class="muted small center">Preview menggunakan mesin render yang sama dengan hasil unduhan. 100% = ukuran fisik 55 × 85 mm di layar.</p>' +
      '</section></div>';

    // nilai awal
    $$('[data-key]', v).forEach(function (inp) {
      inp.value = state.data[inp.dataset.key] || '';
      inp.addEventListener('input', function () { state.data[inp.dataset.key] = inp.value; persistData(); syncMirrors(v); schedulePreview(); });
    });
    syncMirrors(v);
    $('#g-dpi').value = String(state.settings.dpi);
    $('#g-dpi').onchange = function (e) { state.settings.dpi = +e.target.value; IDS.store.set('settings', state.settings); };

    // foto
    var file = $('#photo-file'), drop = $('#drop');
    file.addEventListener('change', function () { if (file.files[0]) handlePhoto(file.files[0]); file.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) handlePhoto(f); });
    $('#adj-zoom').oninput = function (e) { state.photoAdj.zoom = +e.target.value; persistAdj(); schedulePreview(); };
    $('#adj-x').oninput = function (e) { state.photoAdj.panX = +e.target.value; persistAdj(); schedulePreview(); };
    $('#adj-y').oninput = function (e) { state.photoAdj.panY = +e.target.value; persistAdj(); schedulePreview(); };
    $('#adj-reset').onclick = function () { state.photoAdj = { zoom: 1, panX: 0, panY: 0 }; persistAdj(); syncPhotoUi(); schedulePreview(); };
    $('#photo-del').onclick = async function () {
      state.photo = null; state.photoBlob = null; state.photoName = ''; await IDS.blobs.del('photo:' + state.templateId).catch(function () {});
      syncPhotoUi(); schedulePreview();
    };
    syncPhotoUi();

    // preview
    $('#pv-sides').onclick = function (e) { var b = e.target.closest('button'); if (b) { state.previewSide = b.dataset.side; updatePvTabs(); schedulePreview(); } };
    $('#pv-in').onclick = function () { setPvZoom(state.previewZoom * 1.2); };
    $('#pv-out').onclick = function () { setPvZoom(state.previewZoom / 1.2); };
    $('#pv-reset').onclick = function () { setPvZoom(1); };
    setupPhotoDrag();
    $$('[data-exp]', v).forEach(function (b) { b.onclick = function () { doExport(b.dataset.exp); }; });
    updatePvTabs(); renderBanner(); schedulePreview();
  }

  function syncMirrors(v) {
    $$('[data-sync]', v || document).forEach(function (inp) { inp.value = state.data[inp.dataset.sync] || ''; });
  }

  function renderBanner() {
    var b = $('#g-banner'); if (!b) return; var msgs = [];
    var draft = ['front', 'back'].filter(function (s) { return state.configs[s].status !== 'approved'; });
    if (draft.length) msgs.push('<div class="alert warn">Posisi field sisi ' + draft.map(function (s) { return SIDE_LABEL[s]; }).join(' &amp; ') + ' masih <b>draf</b>. Periksa dulu di <a href="#/designer">Template Designer</a> lalu setujui, agar hasil cetak akurat.</div>');
    ['front', 'back'].forEach(function (s) { var i = state.bgInfo[s]; if (i && i.warn) msgs.push('<div class="alert warn">Template ' + SIDE_LABEL[s] + ': ' + esc(i.warn) + '</div>'); if (i && i.error) msgs.push('<div class="alert err">' + esc(i.error) + '</div>'); });
    b.innerHTML = msgs.join('');
  }

  var PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  async function handlePhoto(file) {
    var okExt = /\.(jpe?g|png|webp)$/i.test(file.name);
    if (PHOTO_TYPES.indexOf(file.type) < 0 && !okExt) { IDS.app.toast('Format foto harus JPG, JPEG, PNG, atau WebP.', 'err'); return; }
    if (file.size > 30 * 1024 * 1024) { IDS.app.toast('Ukuran foto terlalu besar (maks. 30 MB).', 'err'); return; }
    try {
      var bmp = await createImageBitmap(file);
      state.photo = bmp; state.photoBlob = file; state.photoName = file.name;
      state.photoAdj = { zoom: 1, panX: 0, panY: 0 }; persistAdj();
      await IDS.blobs.put('photo:' + state.templateId, file).catch(function () { IDS.app.toast('Foto tidak dapat disimpan untuk sesi berikutnya, tetapi tetap dipakai sekarang.', 'warn'); });
      syncPhotoUi(); schedulePreview();
    } catch (e) { IDS.app.toast('Foto tidak dapat dibaca. Coba file lain.', 'err'); }
  }

  function syncPhotoUi() {
    var info = $('#photo-info'); if (!info) return;
    var has = !!state.photo;
    info.innerHTML = has ? '<b>Foto terpasang</b> ' + esc(state.photoName || '') + '<br><span class="muted small">' + state.photo.width + ' × ' + state.photo.height + ' px — klik/seret untuk mengganti</span>'
      : 'Klik atau seret foto ke sini<br><span class="muted small">JPG, JPEG, PNG, WebP</span>';
    $('#photo-adj').hidden = !has;
    $('#adj-zoom').value = state.photoAdj.zoom; $('#adj-x').value = state.photoAdj.panX; $('#adj-y').value = state.photoAdj.panY;
  }

  function setPvZoom(zv) { state.previewZoom = Math.max(0.3, Math.min(4, zv)); schedulePreview(); }
  function updatePvTabs() { $$('#pv-sides button').forEach(function (b) { b.classList.toggle('on', b.dataset.side === state.previewSide); }); }

  var pvRaf = 0;
  function schedulePreview() { if (pvRaf) return; pvRaf = requestAnimationFrame(function () { pvRaf = 0; renderPreview(); }); }

  function renderPreview() {
    var canvas = $('#pv-canvas'); if (!canvas) return;
    var side = state.previewSide, cfg = state.configs[side], k = state.previewZoom * CSS_PX_PER_MM, dpr = Math.max(1, root.devicePixelRatio || 1);
    var res = IDS.app.renderTo(canvas, side, k * dpr);
    canvas.style.width = cfg.widthMm * k + 'px'; canvas.style.height = cfg.heightMm * k + 'px';
    var stage = $('#pv-stage'); stage.style.width = cfg.widthMm * k + 'px'; stage.style.height = cfg.heightMm * k + 'px';
    $('#pv-zl').textContent = Math.round(state.previewZoom * 100) + '%';
    // indikator field kosong / teks terlalu panjang (overlay DOM, tidak ikut export)
    var over = $('#pv-over'); over.innerHTML = '';
    res.fields.forEach(function (fi) {
      var f = cfg.fields.filter(function (x) { return x.id === fi.id; })[0];
      if (!fi.empty && !fi.overflow) return;
      var d = document.createElement('div'); d.className = 'ind ' + (fi.overflow ? 'over' : 'miss');
      d.style.cssText = 'left:' + f.x * k + 'px;top:' + f.y * k + 'px;width:' + f.width * k + 'px;height:' + f.height * k + 'px';
      d.title = fi.overflow ? 'Teks terlalu panjang' : 'Belum diisi';
      d.innerHTML = '<span>' + (fi.overflow ? 'Terlalu panjang' : 'Belum diisi') + '</span>'; over.appendChild(d);
    });
    var warn = $('#pv-warn');
    var all = [];
    ['front', 'back'].forEach(function (s) {
      if (s === side) res.warnings.forEach(function (w) { all.push(w.msg); });
    });
    var miss = IDS.missingFields(state.templateId, state.data, !!state.photo);
    warn.innerHTML = (all.length ? all.map(function (m) { return '<div class="alert warn small">' + esc(m) + '</div>'; }).join('') : '') +
      (miss.length ? '<div class="alert info small">Belum diisi: ' + miss.map(function (m) { return esc(m.label) + ' (' + SIDE_LABEL[m.side] + ')'; }).join(', ') + '</div>' : '<div class="alert ok small">Semua field wajib terisi.</div>');
  }

  /* geser foto langsung di preview */
  function setupPhotoDrag() {
    var stage = $('#pv-stage'), d = null;
    stage.addEventListener('pointerdown', function (e) {
      if (state.previewSide !== 'front' || !state.photo) return;
      var cfg = state.configs.front, k = state.previewZoom * CSS_PX_PER_MM, r = stage.getBoundingClientRect();
      var mx = (e.clientX - r.left) / k, my = (e.clientY - r.top) / k;
      var f = cfg.fields.filter(function (x) { return x.type === 'photo' && mx >= x.x && mx <= x.x + x.width && my >= x.y && my <= x.y + x.height; })[0];
      if (!f) return;
      e.preventDefault(); stage.setPointerCapture(e.pointerId);
      d = { sx: e.clientX, sy: e.clientY, f: f, adj: Object.assign({}, state.photoAdj), k: k };
      stage.classList.add('grabbing');
    });
    stage.addEventListener('pointermove', function (e) {
      if (!d) return;
      var c = IDS.photoCrop(state.photo.width, state.photo.height, d.f.width, d.f.height, d.adj);
      var freeX = c.dw - d.f.width, freeY = c.dh - d.f.height;
      var dxMm = (e.clientX - d.sx) / d.k, dyMm = (e.clientY - d.sy) / d.k;
      if (freeX > 1e-6) state.photoAdj.panX = Math.max(-1, Math.min(1, d.adj.panX - 2 * dxMm / freeX));
      if (freeY > 1e-6) state.photoAdj.panY = Math.max(-1, Math.min(1, d.adj.panY - 2 * dyMm / freeY));
      syncPhotoUi(); schedulePreview();
    });
    var end = function () { if (d) { persistAdj(); d = null; stage.classList.remove('grabbing'); } };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  }

  /* ---------- Export ---------- */
  function precheck() {
    var issues = [], miss = IDS.missingFields(state.templateId, state.data, !!state.photo);
    if (miss.length) issues.push('Belum diisi: ' + miss.map(function (m) { return m.label + ' (' + SIDE_LABEL[m.side] + ')'; }).join(', '));
    ['front', 'back'].forEach(function (s) {
      var r = IDS.app.renderTo(document.createElement('canvas'), s, 2);
      r.warnings.forEach(function (w) { issues.push(w.msg); });
    });
    ['front', 'back'].forEach(function (s) { if (state.configs[s].status !== 'approved') issues.push('Posisi sisi ' + SIDE_LABEL[s] + ' belum disetujui di Template Designer.'); });
    return issues;
  }

  async function doExport(kind) {
    var issues = precheck();
    if (issues.length && !confirm('Perhatian:\n\n• ' + issues.join('\n• ') + '\n\nTetap unduh?')) return;
    var st = $('#g-exp-status'), dpi = state.settings.dpi, nm = IDS.safeName(state.data.nama);
    st.textContent = 'Menyiapkan file…';
    try {
      if (kind === 'png-front' || kind === 'png-back') {
        var side = kind === 'png-front' ? 'front' : 'back';
        var png = await IDS.exportPng(renderSide, side, dpi);
        IDS.download(png, 'IDCARD_' + nm + '_' + SIDE_LABEL[side] + '.png', 'image/png');
      } else {
        var mode = kind === 'pdf-two' ? 'two' : 'one';
        var pdf = await IDS.exportPdf(renderSide, mode, dpi, 'ID Card ' + (state.data.nama || ''));
        IDS.download(pdf, 'IDCARD_' + nm + (mode === 'two' ? '_55x85mm' : '_berdampingan') + '.pdf', 'application/pdf');
      }
      st.textContent = 'Selesai. Cetak pada Actual Size / 100%.';
    } catch (e) {
      st.textContent = ''; IDS.app.toast('Gagal membuat file: ' + e.message, 'err');
    }
  }

  /* ---------- Pengaturan ---------- */
  function viewSettings(v) {
    var t = tpl();
    v.innerHTML =
      '<div class="page-head"><h1>Pengaturan</h1><p class="muted">Pengaturan teknis template. Pengguna harian tidak perlu membuka halaman ini.</p></div>' +
      '<div class="grid-2">' +
      '<div class="card"><h3>Gambar template</h3>' + ['front', 'back'].map(function (s) {
        var i = state.bgInfo[s] || {};
        return '<div class="set-row"><div><b>Sisi ' + SIDE_LABEL[s] + '</b><div class="muted small">' + (i.w ? i.w + ' × ' + i.h + ' px' : '—') + (i.custom ? ' · gambar pengganti' : ' · bawaan') + '</div>' + (i.warn ? '<div class="alert warn small">' + esc(i.warn) + '</div>' : '') + '</div>' +
          '<div class="btn-row"><label class="btn small">Ganti<input type="file" accept="image/png,image/jpeg,image/webp" data-bg="' + s + '" hidden></label>' + (i.custom ? '<button class="btn small" data-bgreset="' + s + '">Kembalikan</button>' : '') + '</div></div>';
      }).join('') + '<p class="muted small">Ganti hanya bila ada versi template baru. Rasio gambar harus 55:85; gambar tidak diregangkan.</p></div>' +
      '<div class="card"><h3>Konfigurasi posisi</h3>' +
      '<div class="btn-row"><button class="btn" id="s-export">Ekspor JSON</button><label class="btn">Impor JSON<input type="file" id="s-import" accept=".json,application/json" hidden></label></div>' +
      '<div class="btn-row"><button class="btn danger" id="s-reset">Reset semua ke bawaan</button></div>' +
      '<p class="muted small">Untuk menjadikan posisi yang sudah disetujui sebagai bawaan repo, ekspor JSON lalu salin isinya ke <code>front-config.json</code> / <code>back-config.json</code> dan jalankan <code>node tools/build-defaults.js</code>.</p></div>' +
      '<div class="card"><h3>Data tersimpan</h3><div class="btn-row"><button class="btn danger" id="s-clear">Hapus data form &amp; foto</button></div><p class="muted small">Data disimpan hanya di browser ini (LocalStorage &amp; IndexedDB).</p></div>' +
      '<div class="card"><h3>Tentang</h3><p class="muted small">IDCARD STUDIO-KrisnaDigital v1.0 · ' + esc(t.name) + ' · ' + t.widthMm + ' × ' + t.heightMm + ' mm · tanpa server, tanpa login, proyek terpisah.</p></div>' +
      '</div>';

    $$('[data-bg]', v).forEach(function (inp) {
      inp.onchange = async function () {
        var f = inp.files[0]; if (!f) return;
        await IDS.blobs.put('bg:' + t.id + ':' + inp.dataset.bg, f); await loadBackgrounds(); IDS.app.toast('Gambar template diganti.'); route();
      };
    });
    $$('[data-bgreset]', v).forEach(function (b) { b.onclick = async function () { await IDS.blobs.del('bg:' + t.id + ':' + b.dataset.bgreset); await loadBackgrounds(); route(); }; });
    $('#s-export').onclick = function () {
      var out = { app: 'idcard-studio', version: 1, templateId: t.id, front: state.configs.front, back: state.configs.back };
      IDS.download(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), 'idcard-studio-' + t.id + '-config.json', 'application/json');
    };
    $('#s-import').onchange = async function (e) {
      var f = e.target.files[0]; if (!f) return;
      try {
        var j = JSON.parse(await f.text()), bad = [];
        ['front', 'back'].forEach(function (s) { if (j[s]) { var r = IDS.validateConfig(j[s]); if (r.errors.length) bad = bad.concat(r.errors); } });
        if (bad.length) { alert('File tidak valid:\n' + bad.join('\n')); return; }
        ['front', 'back'].forEach(function (s) { if (j[s]) IDS.saveConfig(t.id, s, j[s]); });
        IDS.app.reloadConfigs(); IDS.app.toast('Konfigurasi diimpor.'); route();
      } catch (err) { alert('File JSON tidak dapat dibaca.'); }
    };
    $('#s-reset').onclick = function () {
      if (!confirm('Reset posisi kedua sisi ke konfigurasi bawaan? Posisi yang sudah Anda setujui akan hilang.')) return;
      ['front', 'back'].forEach(function (s) { IDS.resetConfig(t.id, s); }); IDS.app.reloadConfigs(); IDS.app.toast('Dikembalikan ke bawaan.'); route();
    };
    $('#s-clear').onclick = async function () {
      if (!confirm('Hapus data form dan foto tersimpan?')) return;
      state.data = {}; state.photo = null; state.photoBlob = null; state.photoAdj = { zoom: 1, panX: 0, panY: 0 };
      IDS.store.remove('data:' + t.id); IDS.store.remove('photoAdj:' + t.id); await IDS.blobs.del('photo:' + t.id).catch(function () {}); IDS.app.toast('Data dihapus.');
    };
  }

  /* ---------- Init ---------- */
  async function init() {
    state.data = IDS.store.get('data:' + state.templateId, {});
    state.photoAdj = IDS.store.get('photoAdj:' + state.templateId, state.photoAdj);
    state.settings = IDS.store.get('settings', state.settings);
    IDS.app.reloadConfigs();
    await Promise.all([loadBackgrounds(), loadPhoto()]);
    window.addEventListener('hashchange', route);
    $('#navtoggle').onclick = function () { document.body.classList.toggle('nav-open'); };
    $('.nav').addEventListener('click', function () { document.body.classList.remove('nav-open'); });
    route();
    root.IDS_READY = true;
  }

  IDS.app.init = init;
  IDS.app.route = route;
  document.addEventListener('DOMContentLoaded', init);
})(window);
