/* IDCARD STUDIO — template-designer.js
 * Editor posisi visual: drag, resize, input numerik (mm), zoom, undo/redo, simpan & setujui.
 * Menggunakan renderer yang sama dengan preview/export (IDS.app.renderTo).
 */
(function (root) {
  'use strict';
  var IDS = root.IDS = root.IDS || {};
  var D = IDS.Designer = {};

  var PX_PER_MM_100 = 96 / 25.4;          // 1 mm pada zoom 100% (px CSS)
  var FONT_STACKS = [
    ["Arial", "Arial, 'Liberation Sans', Helvetica, sans-serif"],
    ["Arial Narrow", "'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif"],
    ["Helvetica", "Helvetica, Arial, sans-serif"],
    ["Calibri", "Calibri, Carlito, Arial, sans-serif"],
    ["Verdana", "Verdana, 'DejaVu Sans', sans-serif"],
    ["Tahoma", "Tahoma, Verdana, sans-serif"],
    ["Times New Roman", "'Times New Roman', 'Liberation Serif', serif"]
  ];
  var SOURCES = ['nama', 'nip', 'jabatan', 'gol_darah'];
  var LONG_SAMPLE = { nama: 'PROF. DR. I GUSTI AYU PUTU SRI WIDIANTARI KUSUMAWARDHANI, S.Pd., M.Pd.', nip: '19990822 202521 2 000', jabatan: 'Pranata Komputer Ahli Pertama pada Dinas Komunikasi dan Informatika', gol_darah: 'AB' };

  var st = null, root_el = null, raf = 0;
  var z = 0;               // px CSS per mm saat ini

  function $(sel, el) { return (el || root_el).querySelector(sel); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function cur() { return st.work[st.side]; }
  function selField() { return cur().fields.filter(function (f) { return f.id === st.sel; })[0] || null; }
  function tpl() { return IDS.TEMPLATES[IDS.app.state.templateId]; }
  function dataForPreview() {
    if (!st.showData) return {};
    if (st.longText) return LONG_SAMPLE;
    var d = IDS.app.state.data, has = SOURCES.some(function (k) { return d[k]; });
    return has ? d : IDS.app.SAMPLE;
  }

  /* ---------- Riwayat (undo/redo) ---------- */
  function hist() { return st.hist[st.side]; }
  function snapshot() {
    var h = hist(); h.stack = h.stack.slice(0, h.i + 1);
    var s = JSON.stringify(cur()); if (h.stack[h.i] === s) return;
    h.stack.push(s); if (h.stack.length > 100) h.stack.shift(); h.i = h.stack.length - 1;
    st.dirty[st.side] = true; updateToolbar();
  }
  function undo() { var h = hist(); if (h.i > 0) { h.i--; st.work[st.side] = JSON.parse(h.stack[h.i]); afterHistory(); } }
  function redo() { var h = hist(); if (h.i < h.stack.length - 1) { h.i++; st.work[st.side] = JSON.parse(h.stack[h.i]); afterHistory(); } }
  function afterHistory() {
    if (!selField()) st.sel = null;
    st.dirty[st.side] = true; buildBoxes(); buildList(); buildPanel(); draw(); updateToolbar();
  }

  /* ---------- Muat ---------- */
  function loadAll() {
    var t = IDS.app.state.templateId;
    st.work = {}; st.hist = {}; st.dirty = { front: false, back: false }; st.meta = {};
    ['front', 'back'].forEach(function (side) {
      var r = IDS.loadConfig(t, side);
      st.work[side] = r.config; st.meta[side] = r;
      st.hist[side] = { stack: [JSON.stringify(r.config)], i: 0 };
    });
  }

  /* ---------- Bangun UI ---------- */
  D.show = function (container) {
    root_el = container; root.removeEventListener('keydown', globalKey);
    if (!st) st = { side: 'front', sel: null, zoom: 1.6, showData: true, longText: false, grid: false, refOpacity: 0.5, refImg: {} };
    loadAll();
    container.innerHTML =
      '<div class="designer">' +
      '<div class="d-toolbar card">' +
      '  <div class="seg" id="d-sides"><button data-side="front">Sisi Depan</button><button data-side="back">Sisi Belakang</button></div>' +
      '  <div class="btn-group"><button class="btn" id="d-undo" title="Undo (Ctrl+Z)">↶ Undo</button><button class="btn" id="d-redo" title="Redo (Ctrl+Y)">↷ Redo</button></div>' +
      '  <div class="btn-group"><button class="btn" id="d-zout" title="Perkecil">−</button><span class="zoom-label" id="d-zlabel"></span><button class="btn" id="d-zin" title="Perbesar">+</button><button class="btn" id="d-zfit">Pas</button></div>' +
      '  <label class="chk"><input type="checkbox" id="d-data" checked> Data contoh</label>' +
      '  <label class="chk"><input type="checkbox" id="d-long"> Uji teks panjang</label>' +
      '  <label class="chk"><input type="checkbox" id="d-grid"> Grid 5 mm</label>' +
      '</div>' +
      '<div class="d-body">' +
      '  <div class="d-stage-wrap card" id="d-stagewrap"><div class="d-stage" id="d-stage"><canvas id="d-canvas"></canvas><img id="d-ref" alt="" hidden><div class="d-grid" id="d-gridlayer" hidden></div><div class="d-boxes" id="d-boxes"></div></div></div>' +
      '  <aside class="d-side">' +
      '    <div class="card"><h3>Field</h3><div id="d-list" class="d-list"></div>' +
      '      <div class="btn-row"><button class="btn" id="d-addtext">+ Area teks</button><button class="btn" id="d-addphoto">+ Area foto</button></div></div>' +
      '    <div class="card" id="d-panel"></div>' +
      '    <div class="card"><h3>Overlay referensi (opsional)</h3><p class="muted small">Unggah gambar ID Card jadi untuk mencocokkan posisi. Hanya tampilan bantu, tidak ikut tersimpan atau diekspor.</p>' +
      '      <input type="file" id="d-reffile" accept="image/*"><div class="row"><label class="small">Transparansi</label><input type="range" id="d-refop" min="0" max="1" step="0.05"></div><button class="btn small" id="d-refclear">Hapus overlay</button></div>' +
      '    <div class="card d-save"><div id="d-status" class="status-line"></div>' +
      '      <button class="btn" id="d-revert">Kembali ke tersimpan</button>' +
      '      <button class="btn" id="d-default">Reset ke bawaan</button>' +
      '      <button class="btn" id="d-save">Simpan draf</button>' +
      '      <button class="btn primary" id="d-approve">Simpan &amp; setujui posisi</button></div>' +
      '  </aside></div></div>';

    var sides = $('#d-sides');
    sides.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      st.side = b.dataset.side; st.sel = null; refreshAll();
    });
    $('#d-undo').onclick = undo; $('#d-redo').onclick = redo;
    $('#d-zin').onclick = function () { setZoom(st.zoom * 1.2); };
    $('#d-zout').onclick = function () { setZoom(st.zoom / 1.2); };
    $('#d-zfit').onclick = fitZoom;
    $('#d-data').onchange = function (e) { st.showData = e.target.checked; draw(); };
    $('#d-long').onchange = function (e) { st.longText = e.target.checked; draw(); };
    $('#d-grid').onchange = function (e) { st.grid = e.target.checked; layoutStage(); };
    $('#d-addtext').onclick = function () { addField('text'); };
    $('#d-addphoto').onclick = function () { addField('photo'); };
    $('#d-save').onclick = function () { save(false); };
    $('#d-approve').onclick = function () { save(true); };
    $('#d-revert').onclick = function () { revertSaved(); };
    $('#d-default').onclick = function () { resetDefault(); };
    $('#d-reffile').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var url = URL.createObjectURL(f); st.refImg[st.side] = url; layoutStage();
    };
    $('#d-refop').oninput = function (e) { st.refOpacity = +e.target.value; layoutStage(); };
    $('#d-refclear').onclick = function () { st.refImg[st.side] = null; $('#d-reffile').value = ''; layoutStage(); };
    $('#d-boxes').addEventListener('pointerdown', onPointerDown);
    root_el.addEventListener('keydown', onKey);
    root.addEventListener('keydown', globalKey);
    root.addEventListener('resize', layoutStage);
    st.zoomInit = false;
    refreshAll();
    setTimeout(function () { if (!st.zoomInit) fitZoom(); }, 30);
  };

  D.hide = function () { root.removeEventListener('keydown', globalKey); root.removeEventListener('resize', layoutStage); };

  function globalKey(e) {
    if (!root_el || !root_el.isConnected) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (e.key === 'Delete' && selField()) { removeSel(); }
    else if (e.key.indexOf('Arrow') === 0 && selField()) {
      e.preventDefault();
      var step = e.shiftKey ? 1 : 0.1, f = selField();
      if (e.key === 'ArrowLeft') f.x = round2(f.x - step); if (e.key === 'ArrowRight') f.x = round2(f.x + step);
      if (e.key === 'ArrowUp') f.y = round2(f.y - step); if (e.key === 'ArrowDown') f.y = round2(f.y + step);
      snapshot(); layoutBoxes(); syncPanelNumbers(); draw();
    }
  }
  function onKey() {}

  function refreshAll() {
    var btns = root_el.querySelectorAll('#d-sides button');
    Array.prototype.forEach.call(btns, function (b) { b.classList.toggle('on', b.dataset.side === st.side); });
    $('#d-data').checked = st.showData; $('#d-long').checked = st.longText; $('#d-grid').checked = st.grid;
    $('#d-refop').value = st.refOpacity;
    buildBoxes(); buildList(); buildPanel(); layoutStage(); updateToolbar();
  }

  /* ---------- Zoom & stage ---------- */
  function setZoom(v) { st.zoom = Math.max(0.5, Math.min(6, v)); st.zoomInit = true; layoutStage(); }
  function fitZoom() {
    var wrap = $('#d-stagewrap'), c = cur();
    var availW = wrap.clientWidth - 24, availH = Math.max(380, root.innerHeight - 220);
    var zmm = Math.min(availW / c.widthMm, availH / c.heightMm);
    st.zoom = Math.max(0.5, zmm / PX_PER_MM_100); st.zoomInit = true; layoutStage();
  }
  function layoutStage() {
    if (!root_el || !$('#d-stage')) return;
    var c = cur(); z = st.zoom * PX_PER_MM_100;
    var stage = $('#d-stage');
    stage.style.width = c.widthMm * z + 'px'; stage.style.height = c.heightMm * z + 'px';
    $('#d-zlabel').textContent = Math.round(st.zoom * 100) + '%';
    var g = $('#d-gridlayer'); g.hidden = !st.grid;
    g.style.backgroundSize = (5 * z) + 'px ' + (5 * z) + 'px';
    var ref = $('#d-ref'), url = st.refImg[st.side];
    ref.hidden = !url; if (url) { ref.src = url; ref.style.opacity = st.refOpacity; }
    layoutBoxes(); draw();
  }

  function draw() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0; if (!root_el || !root_el.isConnected) return;
      var canvas = $('#d-canvas'), dpr = Math.max(1, root.devicePixelRatio || 1);
      var res = IDS.app.renderTo(canvas, st.side, z * dpr / 1, { config: cur(), data: dataForPreview() });
      canvas.style.width = cur().widthMm * z + 'px'; canvas.style.height = cur().heightMm * z + 'px';
      st.lastRes = res; flagBoxes();
    });
  }

  /* ---------- Kotak field ---------- */
  var HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  function buildBoxes() {
    var wrap = $('#d-boxes'); wrap.innerHTML = '';
    cur().fields.forEach(function (f) {
      var b = document.createElement('div');
      b.className = 'fbox ' + f.type; b.dataset.id = f.id;
      b.innerHTML = '<span class="ftag">' + f.id + '</span>' + HANDLES.map(function (h) { return '<i class="h ' + h + '" data-h="' + h + '"></i>'; }).join('');
      wrap.appendChild(b);
    });
    layoutBoxes();
  }
  function layoutBoxes() {
    var c = cur();
    Array.prototype.forEach.call($('#d-boxes').children, function (b) {
      var f = c.fields.filter(function (x) { return x.id === b.dataset.id; })[0]; if (!f) return;
      b.style.left = f.x * z + 'px'; b.style.top = f.y * z + 'px'; b.style.width = f.width * z + 'px'; b.style.height = f.height * z + 'px';
      b.classList.toggle('sel', f.id === st.sel);
      b.classList.toggle('oob', IDS.outOfBounds(f, c));
    });
  }
  function flagBoxes() {
    if (!st.lastRes) return;
    var over = {}; st.lastRes.fields.forEach(function (f) { if (f.overflow) over[f.id] = 1; });
    Array.prototype.forEach.call($('#d-boxes').children, function (b) { b.classList.toggle('over', !!over[b.dataset.id]); });
  }

  var drag = null;
  function onPointerDown(e) {
    var box = e.target.closest('.fbox'); if (!box) { st.sel = null; layoutBoxes(); buildList(); buildPanel(); return; }
    e.preventDefault();
    var f = cur().fields.filter(function (x) { return x.id === box.dataset.id; })[0];
    if (st.sel !== f.id) { st.sel = f.id; layoutBoxes(); buildList(); buildPanel(); }
    var h = e.target.dataset && e.target.dataset.h;
    drag = { mode: h || 'move', sx: e.clientX, sy: e.clientY, o: { x: f.x, y: f.y, w: f.width, h: f.height }, f: f, moved: false };
    box.setPointerCapture(e.pointerId);
    box.addEventListener('pointermove', onPointerMove); box.addEventListener('pointerup', onPointerUp); box.addEventListener('pointercancel', onPointerUp);
  }
  function onPointerMove(e) {
    if (!drag) return;
    var dx = (e.clientX - drag.sx) / z, dy = (e.clientY - drag.sy) / z, o = drag.o, f = drag.f, m = drag.mode, MIN = 1;
    if (Math.abs(dx) + Math.abs(dy) > 0.02) drag.moved = true;
    if (m === 'move') { f.x = round2(o.x + dx); f.y = round2(o.y + dy); }
    else {
      var x = o.x, y = o.y, w = o.w, h = o.h;
      if (m.indexOf('e') >= 0) w = Math.max(MIN, o.w + dx);
      if (m.indexOf('s') >= 0) h = Math.max(MIN, o.h + dy);
      if (m.indexOf('w') >= 0) { w = Math.max(MIN, o.w - dx); x = o.x + o.w - w; }
      if (m.indexOf('n') >= 0) { h = Math.max(MIN, o.h - dy); y = o.y + o.h - h; }
      f.x = round2(x); f.y = round2(y); f.width = round2(w); f.height = round2(h);
    }
    layoutBoxes(); syncPanelNumbers(); draw();
  }
  function onPointerUp(e) {
    var box = e.currentTarget;
    box.removeEventListener('pointermove', onPointerMove); box.removeEventListener('pointerup', onPointerUp); box.removeEventListener('pointercancel', onPointerUp);
    if (drag && drag.moved) snapshot();
    drag = null;
  }

  /* ---------- Daftar & panel properti ---------- */
  function buildList() {
    var list = $('#d-list'); list.innerHTML = '';
    cur().fields.forEach(function (f) {
      var b = document.createElement('button');
      b.className = 'd-item' + (f.id === st.sel ? ' on' : '');
      b.innerHTML = '<span class="ico">' + (f.type === 'photo' ? '▣' : 'T') + '</span><span>' + f.id + '</span><em>' + (f.label || '') + '</em>';
      b.onclick = function () { st.sel = f.id; layoutBoxes(); buildList(); buildPanel(); };
      list.appendChild(b);
    });
    if (!cur().fields.length) list.innerHTML = '<p class="muted small">Belum ada field. Tambahkan area teks atau foto.</p>';
  }

  function numInput(key, label, step, min) {
    return '<label class="fld"><span>' + label + '</span><input type="number" data-k="' + key + '" step="' + (step || 0.01) + '"' + (min != null ? ' min="' + min + '"' : '') + '></label>';
  }

  function buildPanel() {
    var p = $('#d-panel'), f = selField();
    if (!f) { p.innerHTML = '<h3>Properti</h3><p class="muted small">Pilih sebuah area di kartu atau di daftar field. Koordinat dalam milimeter (origin kiri atas, Y ke bawah).</p>'; return; }
    var h = '<h3>Properti: <code>' + f.id + '</code></h3>' +
      '<label class="fld"><span>ID unik</span><input type="text" data-k="id" value="' + f.id + '"></label>' +
      '<label class="fld"><span>Label</span><input type="text" data-k="label"></label>' +
      '<div class="grid2">' + numInput('x', 'X (mm)') + numInput('y', 'Y (mm)') + numInput('width', 'Lebar (mm)', 0.01, 0.5) + numInput('height', 'Tinggi (mm)', 0.01, 0.5) + '</div>';
    if (f.type === 'text') {
      h += '<label class="fld"><span>Sumber data</span><select data-k="source">' + SOURCES.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label>' +
        '<label class="fld"><span>Awalan teks (mis. "NIP. ")</span><input type="text" data-k="prefix"></label>' +
        '<label class="fld"><span>Font</span><select data-k="fontFamily"></select></label>' +
        '<div class="grid2">' + numInput('maxFontSize', 'Ukuran maks (mm)', 0.05, 0.5) + numInput('minFontSize', 'Ukuran min (mm)', 0.05, 0.3) + '</div>' +
        '<p class="muted small" id="d-pt"></p>' +
        '<div class="grid2"><label class="fld"><span>Ketebalan</span><select data-k="fontWeight"><option value="normal">Normal</option><option value="bold">Bold</option></select></label>' +
        '<label class="fld"><span>Warna</span><input type="color" data-k="color"></label>' +
        '<label class="fld"><span>Rata</span><select data-k="textAlign"><option value="left">Kiri</option><option value="center">Tengah</option><option value="right">Kanan</option></select></label>' +
        '<label class="fld"><span>Rata vertikal</span><select data-k="verticalAlign"><option value="top">Atas</option><option value="middle">Tengah</option><option value="bottom">Bawah</option></select></label>' +
        numInput('hScale', 'Lebar huruf (%)', 1, 20) + numInput('letterSpacing', 'Jarak huruf (mm)', 0.01) + '</div>' +
        '<label class="chk"><input type="checkbox" data-k="autoFit"> Auto-fit ukuran font</label>' +
        '<label class="chk"><input type="checkbox" data-k="wrap"> Boleh pindah baris</label>';
    } else {
      h += '<label class="fld"><span>Sumber</span><input type="text" value="foto (unggahan pengguna)" disabled></label>' +
        '<p class="muted small">Mode crop: cover (mengisi area, proporsi foto tetap, posisi wajah diatur di halaman Buat ID Card).</p>' +
        '<div class="grid2">' + numInput('border.width', 'Border (mm)', 0.05, 0) + '<label class="fld"><span>Warna border</span><input type="color" data-k="border.color"></label></div>';
    }
    h += '<button class="btn danger small" id="d-del">Hapus field</button>';
    p.innerHTML = h;
    if (f.type === 'text') {
      var sel = $('select[data-k="fontFamily"]', p), found = false;
      FONT_STACKS.forEach(function (o) { var op = document.createElement('option'); op.value = o[1]; op.textContent = o[0]; if (o[1] === f.fontFamily) found = true; sel.appendChild(op); });
      if (!found) { var op = document.createElement('option'); op.value = f.fontFamily; op.textContent = 'Kustom'; sel.insertBefore(op, sel.firstChild); }
    }
    Array.prototype.forEach.call(p.querySelectorAll('[data-k]'), function (inp) { inp.addEventListener('input', onProp); inp.addEventListener('change', onPropCommit); });
    $('#d-del', p).onclick = removeSel;
    syncPanelValues();
  }

  function getProp(f, k) { var a = k.split('.'); return a.length === 2 ? (f[a[0]] || {})[a[1]] : f[k]; }
  function setProp(f, k, v) { var a = k.split('.'); if (a.length === 2) { f[a[0]] = f[a[0]] || {}; f[a[0]][a[1]] = v; } else f[k] = v; }

  function syncPanelValues() {
    var f = selField(), p = $('#d-panel'); if (!f) return;
    Array.prototype.forEach.call(p.querySelectorAll('[data-k]'), function (inp) {
      var k = inp.dataset.k, v = getProp(f, k);
      if (inp.type === 'checkbox') inp.checked = !!v;
      else if (k === 'hScale') inp.value = Math.round((v || 1) * 100);
      else if (document.activeElement !== inp) inp.value = (v == null ? '' : v);
    });
    ptNote();
  }
  function syncPanelNumbers() { syncPanelValues(); }
  function ptNote() {
    var f = selField(), n = $('#d-pt'); if (!n || !f) return;
    n.textContent = 'Ukuran maks ≈ ' + (f.maxFontSize * 72 / 25.4).toFixed(1) + ' pt, min ≈ ' + (f.minFontSize * 72 / 25.4).toFixed(1) + ' pt.';
  }

  function onProp(e) {
    var f = selField(), inp = e.target, k = inp.dataset.k; if (!f) return;
    var v;
    if (inp.type === 'checkbox') v = inp.checked;
    else if (inp.type === 'number') { v = parseFloat(inp.value); if (!isFinite(v)) return; if (k === 'hScale') v = v / 100; }
    else v = inp.value;
    if (k === 'id') return;                      // ID divalidasi saat commit
    setProp(f, k, v);
    if (k === 'maxFontSize') f.fontSize = v;
    layoutBoxes(); draw(); ptNote();
  }
  function onPropCommit(e) {
    var f = selField(), inp = e.target, k = inp.dataset.k; if (!f) return;
    if (k === 'id') {
      var nv = inp.value.trim().replace(/[^\w\-]/g, '_');
      if (!nv || nv === f.id) { inp.value = f.id; return; }
      if (cur().fields.some(function (x) { return x.id === nv; })) { alert('ID "' + nv + '" sudah dipakai. ID field harus unik.'); inp.value = f.id; return; }
      f.id = nv; st.sel = nv; buildBoxes(); buildList(); buildPanel();
    }
    if (inp.type === 'checkbox' || inp.tagName === 'SELECT') { buildBoxes(); }
    snapshot(); layoutBoxes(); draw();
  }

  /* ---------- Tambah / hapus ---------- */
  function addField(type) {
    var c = cur(), base = type === 'photo' ? 'foto' : 'teks';
    var id = IDS.uniqueId(c, base);
    var f = Object.assign({ id: id, label: '', type: type, source: type === 'photo' ? 'foto' : 'nama' }, IDS.fieldDefaults(type));
    var w = type === 'photo' ? 20 : 30, h = type === 'photo' ? 26 : 5;
    f.width = w; f.height = h; f.x = round2((c.widthMm - w) / 2); f.y = round2((c.heightMm - h) / 2);
    if (type === 'text') { f.fontSize = f.maxFontSize = 3; f.minFontSize = 1.8; }
    c.fields.push(f); st.sel = id; snapshot(); buildBoxes(); buildList(); buildPanel(); draw();
  }
  function removeSel() {
    var f = selField(); if (!f) return;
    if (!confirm('Hapus field "' + f.id + '"?')) return;
    cur().fields = cur().fields.filter(function (x) { return x.id !== f.id; });
    st.sel = null; snapshot(); buildBoxes(); buildList(); buildPanel(); draw();
  }

  /* ---------- Simpan ---------- */
  function updateToolbar() {
    var h = hist();
    $('#d-undo').disabled = h.i <= 0; $('#d-redo').disabled = h.i >= h.stack.length - 1;
    var c = cur(), m = st.meta[st.side], s = $('#d-status');
    var label = c.status === 'approved' ? '✔ Posisi disetujui' + (c.approvedAt ? ' (' + new Date(c.approvedAt).toLocaleString('id-ID') + ')' : '') : '● Draf — belum disetujui';
    s.className = 'status-line ' + (c.status === 'approved' ? 'ok' : 'warn');
    s.textContent = label + (st.dirty[st.side] ? ' · ada perubahan belum disimpan' : '') + (m.source === 'default' && !st.dirty[st.side] ? ' · memakai bawaan' : '');
  }
  function save(approve) {
    var errs = [], c = cur();
    ['front', 'back'].forEach(function (s) { var v = IDS.validateConfig(st.work[s]); errs = errs.concat(v.errors.map(function (m) { return s + ': ' + m; })); });
    if (errs.length) { alert('Tidak dapat menyimpan:\n' + errs.join('\n')); return; }
    if (approve) {
      var oob = c.fields.filter(function (f) { return IDS.outOfBounds(f, c); });
      if (oob.length && !confirm('Field berikut melewati batas kartu: ' + oob.map(function (f) { return f.id; }).join(', ') + '. Tetap setujui?')) return;
      c.status = 'approved'; c.approvedAt = new Date().toISOString();
    } else if (c.status === 'approved') c.status = 'draft';
    var ok = IDS.saveConfig(IDS.app.state.templateId, st.side, c);
    if (!ok) { alert('Gagal menyimpan ke penyimpanan browser.'); return; }
    st.dirty[st.side] = false; st.meta[st.side] = { source: 'saved' };
    snapshot(); st.dirty[st.side] = false;
    IDS.app.reloadConfigs(); updateToolbar();
    IDS.app.toast(approve ? 'Posisi sisi ' + (st.side === 'front' ? 'depan' : 'belakang') + ' disimpan dan disetujui.' : 'Draf posisi disimpan.');
  }
  function revertSaved() {
    var r = IDS.loadConfig(IDS.app.state.templateId, st.side);
    st.work[st.side] = r.config; st.meta[st.side] = r; st.sel = null; snapshot(); st.dirty[st.side] = false; refreshAll();
  }
  function resetDefault() {
    if (!confirm('Kembalikan posisi sisi ini ke konfigurasi bawaan (hasil ukur awal)? Perubahan Anda di editor akan diganti (bisa di-Undo).')) return;
    var def = IDS.clone(root.IDS_DEFAULTS[IDS.app.state.templateId][st.side]);
    st.work[st.side] = def; st.sel = null; snapshot(); refreshAll();
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof window !== 'undefined' ? window : globalThis);
