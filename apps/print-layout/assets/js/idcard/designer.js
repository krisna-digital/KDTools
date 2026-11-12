// PRINTLAY — idcard/designer.js
// Template Designer: menentukan posisi foto/teks secara visual (drag, resize, input numerik dalam mm) dan
// menyimpannya sebagai konfigurasi template permanen. Preview memakai renderSide() yang sama dengan export.

import { DEFAULT_TEXT_FIELD, FIELD_SOURCES, validateConfig, checkTemplateAspect } from './engine.js';
import { renderSide, sizeCanvas, ensureFonts } from './render.js';
import { saveTemplateSet, resetTemplateSet, loadDefaults, parseImportedConfig, listFonts, saveFont, deleteFont, registerFont } from './store.js';

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (v) => Math.round(v * 100) / 100;
const BASE_W = 360;
const MIN_BOX = 1; // mm
const TYPE_LABEL = { text: 'Teks', photo: 'Foto', mask: 'Penutup' };

export const FONT_PRESETS = [
  { name: 'Arial (Liberation Sans)', value: '"Arial", "Liberation Sans", Helvetica, sans-serif' },
  { name: 'Arial Narrow', value: '"Arial Narrow", "Liberation Sans Narrow", "Nimbus Sans Narrow", Arial, sans-serif' },
  { name: 'Helvetica', value: 'Helvetica, "Helvetica Neue", Arial, sans-serif' },
  { name: 'Verdana', value: 'Verdana, "DejaVu Sans", sans-serif' },
  { name: 'Tahoma', value: 'Tahoma, "DejaVu Sans", sans-serif' },
  { name: 'Times New Roman', value: '"Times New Roman", "Liberation Serif", Times, serif' },
  { name: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
];

export function createDesigner(app, hooks) {
  const st = { side: 'front', work: null, sel: null, zoom: 1, undo: [], redo: [], editing: false, useForm: false, isOpen: false, fonts: [] };
  let paintId = 0;
  let drag = null;

  const cfg = () => st.work[st.side];
  const field = (id) => cfg().fields.find((f) => f.id === id);
  const snap = () => JSON.stringify(st.work);
  const dirty = () => JSON.stringify(st.work) !== JSON.stringify(app.set.sides);

  // ---------------------------------------------------------------- undo / redo
  function beginEdit() { if (!st.editing) { st.undo.push(snap()); if (st.undo.length > 80) st.undo.shift(); st.redo = []; st.editing = true; } }
  function endEdit() { st.editing = false; updateStatus(); }
  function restore(s) {
    st.work = JSON.parse(s);
    if (!st.sel || !field(st.sel)) st.sel = cfg().fields[0] ? cfg().fields[0].id : null;
    renderList(); renderProps(); syncBoxes(); schedulePaint(); updateStatus();
  }
  function undo() { if (!st.undo.length) return; st.redo.push(snap()); st.editing = false; restore(st.undo.pop()); }
  function redo() { if (!st.redo.length) return; st.undo.push(snap()); st.editing = false; restore(st.redo.pop()); }

  // ---------------------------------------------------------------- status
  function updateStatus() {
    const rev = app.set.sides.front.revision || 1;
    const base = app.set.approved ? `Template disetujui · rev ${rev}` : `Template DRAF (belum disetujui) · rev ${rev}`;
    $('desStatus').textContent = base + (dirty() ? ' · ADA PERUBAHAN BELUM DISIMPAN' : '');
    $('desUndo').disabled = !st.undo.length;
    $('desRedo').disabled = !st.redo.length;
    const bg = app.bg[st.side];
    const a = checkTemplateAspect({ size: cfg().size, background: { pxWidth: bg.naturalWidth, pxHeight: bg.naturalHeight } });
    const el = $('desAspect');
    el.hidden = false;
    el.className = `alert ${a.ok ? 'info' : 'error'}`;
    el.textContent = `${cfg().size.widthMm} × ${cfg().size.heightMm} mm · ${a.message}`;
  }

  // ---------------------------------------------------------------- daftar field
  function renderList() {
    const ul = $('fieldList');
    ul.innerHTML = '';
    for (const f of cfg().fields) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `item${f.id === st.sel ? ' sel' : ''}${f.enabled === false ? ' off' : ''}`;
      b.dataset.id = f.id;
      b.innerHTML = '<span class="tag"></span><span class="nm"></span>';
      b.querySelector('.tag').textContent = TYPE_LABEL[f.type];
      b.querySelector('.nm').textContent = `${f.label || f.id}  ·  ${f.id}`;
      b.addEventListener('click', () => select(f.id));
      li.appendChild(b);
      ul.appendChild(li);
    }
  }

  function select(id) {
    st.sel = id;
    renderList(); renderProps(); syncBoxes();
  }

  // ---------------------------------------------------------------- properti
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const numIn = (label, prop, v, { step = 0.05, min, max, mult = 1, cls = '' } = {}) =>
    `<label class="${cls}">${label}<input type="number" data-prop="${prop}" data-mult="${mult}" step="${step}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} value="${Number.isFinite(v) ? r2(v * mult) : ''}"></label>`;

  function fontOptions(current) {
    const all = [...FONT_PRESETS, ...st.fonts.map((f) => ({ name: `${f.name} (kustom)`, value: `"${f.name}", Arial, sans-serif` }))];
    if (!all.some((o) => o.value === current)) all.push({ name: 'Kustom (saat ini)', value: current });
    return all.map((o) => `<option value="${esc(o.value)}"${o.value === current ? ' selected' : ''}>${esc(o.name)}</option>`).join('');
  }

  function renderProps() {
    const host = $('props');
    const f = st.sel && field(st.sel);
    if (!f) { host.innerHTML = '<p class="muted small">Pilih field pada daftar atau pada canvas.</p>'; return; }
    let h = `<div class="props-grid">
      <label class="full">ID field (unik)<input type="text" value="${esc(f.id)}" data-prop="id" autocomplete="off"></label>
      <label class="full">Label<input type="text" value="${esc(f.label)}" data-prop="label" autocomplete="off"></label>
      ${numIn('X (mm)', 'x', f.x, { min: 0 })}${numIn('Y (mm)', 'y', f.y, { min: 0 })}
      ${numIn('Lebar (mm)', 'width', f.width, { min: MIN_BOX })}${numIn('Tinggi (mm)', 'height', f.height, { min: MIN_BOX })}
      <label class="check full"><input type="checkbox" data-prop="enabled" ${f.enabled !== false ? 'checked' : ''}> Aktif (tampil di kartu)</label>`;
    if (f.type === 'text') {
      h += `
      <label class="full">Sumber data<select data-prop="source">${['nama', 'nip', 'jabatan', 'gol_darah'].map((k) => `<option value="${k}"${f.source === k ? ' selected' : ''}>${FIELD_SOURCES[k]}</option>`).join('')}</select></label>
      <label class="full">Awalan teks (mis. "NIP. ")<input type="text" data-prop="prefix" value="${esc(f.prefix)}" autocomplete="off"></label>
      <label class="full">Font<select data-prop="fontFamily">${fontOptions(f.fontFamily)}</select></label>
      ${numIn('Ukuran font (pt)', 'fontSize', f.fontSize, { step: 0.1, min: 1 })}${numIn('Skala lebar huruf (%)', 'scaleX', f.scaleX, { step: 1, min: 30, max: 200, mult: 100 })}
      ${numIn('Font min (pt)', 'minFontSize', f.minFontSize, { step: 0.1, min: 1 })}${numIn('Font maks (pt)', 'maxFontSize', f.maxFontSize, { step: 0.1, min: 1 })}
      <label class="check"><input type="checkbox" data-prop="_bold" ${f.fontWeight === 'bold' ? 'checked' : ''}> Bold</label>
      <label class="check"><input type="checkbox" data-prop="_italic" ${f.fontStyle === 'italic' ? 'checked' : ''}> Italic</label>
      <label>Warna<input type="color" data-prop="color" value="${esc(f.color || '#000000')}"></label>
      ${numIn('Jarak karakter (pt)', 'letterSpacing', f.letterSpacing, { step: 0.05 })}
      <label>Rata<select data-prop="textAlign">${[['left', 'Kiri'], ['center', 'Tengah'], ['right', 'Kanan']].map(([v, l]) => `<option value="${v}"${f.textAlign === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Rata vertikal<select data-prop="verticalAlign">${[['top', 'Atas'], ['middle', 'Tengah'], ['bottom', 'Bawah']].map(([v, l]) => `<option value="${v}"${f.verticalAlign === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${numIn('Maks. baris', 'maxLines', f.maxLines, { step: 1, min: 1, max: 6 })}${numIn('Tinggi baris', 'lineHeight', f.lineHeight, { step: 0.05, min: 0.8 })}
      <label class="check full"><input type="checkbox" data-prop="autoFit" ${f.autoFit ? 'checked' : ''}> Auto-fit (perkecil font bila terlalu panjang)</label>
      <p class="muted small full">"Tengah" vertikal = tengah tinggi huruf kapital. Jika file font sudah bold, matikan Bold.</p>`;
    } else if (f.type === 'photo') {
      h += `
      <label class="full">Mode crop<select data-prop="cropMode"><option value="cover"${f.cropMode !== 'contain' ? ' selected' : ''}>Cover — isi penuh, potong kelebihan (zoom-in)</option><option value="contain"${f.cropMode === 'contain' ? ' selected' : ''}>Contain — tampil utuh, ada sisa kosong</option></select></label>
      ${numIn('Posisi awal X (0–1)', 'defaultOx', f.defaultOx ?? 0.5, { step: 0.05, min: 0, max: 1 })}${numIn('Posisi awal Y (0–1)', 'defaultOy', f.defaultOy ?? 0.5, { step: 0.05, min: 0, max: 1 })}
      ${numIn('Tebal border (mm)', 'borderWidth', f.borderWidth || 0, { step: 0.05, min: 0 })}<label>Warna border<input type="color" data-prop="borderColor" value="${esc(f.borderColor || '#000000')}"></label>
      <p class="muted small full">Foto tidak pernah diregangkan. Pengguna dapat menggeser/zoom foto per kartu di halaman form.</p>`;
    } else {
      h += `<label class="full">Warna penutup<input type="color" data-prop="color" value="${esc(f.color || '#ffffff')}"></label>
      <p class="muted small full">Penutup menimpa bagian gambar template (mis. placeholder foto) tanpa mengubah file template. Elemen permanen jangan ditutup.</p>`;
    }
    h += `<div class="full"><button type="button" class="btn small danger" id="propDelete">Hapus field ini</button></div></div>`;
    host.innerHTML = h;
    $('propDelete').addEventListener('click', deleteField);
  }

  function onPropInput(e) {
    const el = e.target;
    const prop = el.dataset && el.dataset.prop;
    if (!prop) return;
    const f = st.sel && field(st.sel);
    if (!f) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') {
      if (el.value === '') return;
      v = parseFloat(el.value) / (Number(el.dataset.mult) || 1);
      if (!Number.isFinite(v)) return;
    } else v = el.value;
    if (prop === 'id') {
      v = String(v).trim();
      if (!v || cfg().fields.some((o) => o !== f && o.id === v)) { el.setCustomValidity('ID harus unik dan tidak kosong'); el.reportValidity(); return; }
      el.setCustomValidity('');
    }
    beginEdit();
    if (prop === '_bold') f.fontWeight = v ? 'bold' : 'normal';
    else if (prop === '_italic') f.fontStyle = v ? 'italic' : 'normal';
    else f[prop] = v;
    if (prop === 'id') st.sel = v;
    if (['x', 'y', 'width', 'height'].includes(prop)) { f.x = clampN(f.x, 0, cfg().size.widthMm); f.y = clampN(f.y, 0, cfg().size.heightMm); }
    syncBoxes();
    schedulePaint();
    if (prop === 'label' || prop === 'enabled' || prop === 'id') renderList();
  }
  function onPropChange(e) {
    endEdit();
    const prop = e.target.dataset && e.target.dataset.prop;
    if (['cropMode', 'source'].includes(prop)) renderProps();
  }

  // ---------------------------------------------------------------- tambah / hapus
  function uniqueId(base) { let i = 1; const ids = new Set(cfg().fields.map((f) => f.id)); while (ids.has(`${base}_${i}`)) i++; return `${base}_${i}`; }
  function addField(type) {
    beginEdit();
    let f;
    if (type === 'text') f = { ...DEFAULT_TEXT_FIELD, id: uniqueId('teks'), label: 'Teks baru', source: 'nama', x: 5, y: 40, width: 45, height: 5, fontSize: 8, minFontSize: 5, maxFontSize: 8 };
    else if (type === 'photo') f = { id: uniqueId('foto'), type: 'photo', label: 'Foto baru', source: 'foto', enabled: true, cropMode: 'cover', defaultOx: 0.5, defaultOy: 0.5, borderWidth: 0, borderColor: '#000000', x: 10, y: 20, width: 30, height: 40 };
    else f = { id: uniqueId('penutup'), type: 'mask', label: 'Penutup baru', enabled: true, color: '#ffffff', x: 10, y: 10, width: 20, height: 10 };
    cfg().fields.push(f);
    endEdit();
    select(f.id);
    schedulePaint();
  }
  function deleteField() {
    const f = st.sel && field(st.sel);
    if (!f || !window.confirm(`Hapus field "${f.label || f.id}"? Elemen permanen pada gambar template tidak terpengaruh.`)) return;
    beginEdit();
    cfg().fields = cfg().fields.filter((o) => o !== f);
    endEdit();
    st.sel = cfg().fields[0] ? cfg().fields[0].id : null;
    renderList(); renderProps(); syncBoxes(); schedulePaint();
  }

  // ---------------------------------------------------------------- kotak di canvas
  const pxPerMm = () => $('desCanvas').getBoundingClientRect().width / cfg().size.widthMm;
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  function styleBox(el, f) {
    const k = Math.round(BASE_W * st.zoom) / cfg().size.widthMm;
    el.style.left = `${f.x * k}px`; el.style.top = `${f.y * k}px`; el.style.width = `${f.width * k}px`; el.style.height = `${f.height * k}px`;
  }

  function syncBoxes() {
    const ov = $('desOv');
    const fields = cfg().fields;
    const have = new Map([...ov.children].map((c) => [c.dataset.id, c]));
    for (const [id, el] of have) if (!fields.some((f) => f.id === id)) { el.remove(); have.delete(id); }
    for (const f of fields) {
      let el = have.get(f.id);
      if (!el) {
        el = document.createElement('div');
        el.dataset.id = f.id;
        el.innerHTML = '<span class="lbl"></span>' + HANDLES.map((h) => `<i class="hd ${h}" data-h="${h}"></i>`).join('');
        ov.appendChild(el);
        bindBox(el);
      } else if (el.dataset.id !== f.id) el.dataset.id = f.id;
      el.className = `fbox ${f.type}${f.id === st.sel ? ' sel' : ''}${f.enabled === false ? ' off' : ''}`;
      el.querySelector('.lbl').textContent = `${f.label || f.id}  ${r2(f.x)}, ${r2(f.y)} · ${r2(f.width)}×${r2(f.height)} mm`;
      styleBox(el, f);
    }
    // sinkronkan data-id setelah penggantian ID
    [...ov.children].forEach((el, i) => { if (fields[i] && !fields.some((f) => f.id === el.dataset.id)) el.dataset.id = fields[i].id; });
  }

  function bindBox(el) {
    el.addEventListener('pointerdown', (e) => {
      const id = el.dataset.id;
      const f = field(id);
      if (!f) return;
      e.preventDefault();
      e.stopPropagation();
      if (st.sel !== id) select(id);
      const h = e.target.dataset && e.target.dataset.h;
      beginEdit();
      drag = { id, mode: h ? 'resize' : 'move', h, x0: e.clientX, y0: e.clientY, orig: { x: f.x, y: f.y, w: f.width, h: f.height } };
      try { el.setPointerCapture(e.pointerId); } catch { /* abaikan */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== el.dataset.id) return;
      const f = field(drag.id);
      const k = pxPerMm();
      const dx = (e.clientX - drag.x0) / k;
      const dy = (e.clientY - drag.y0) / k;
      const W = cfg().size.widthMm;
      const H = cfg().size.heightMm;
      const o = drag.orig;
      let { x, y, w, h } = { x: o.x, y: o.y, w: o.w, h: o.h };
      if (drag.mode === 'move') { x = clampN(o.x + dx, 0, W - o.w); y = clampN(o.y + dy, 0, H - o.h); }
      else {
        const hd = drag.h;
        if (hd.includes('e')) w = clampN(o.w + dx, MIN_BOX, W - o.x);
        if (hd.includes('s')) h = clampN(o.h + dy, MIN_BOX, H - o.y);
        if (hd.includes('w')) { const nx = clampN(o.x + dx, 0, o.x + o.w - MIN_BOX); w = o.w + (o.x - nx); x = nx; }
        if (hd.includes('n')) { const ny = clampN(o.y + dy, 0, o.y + o.h - MIN_BOX); h = o.h + (o.y - ny); y = ny; }
      }
      Object.assign(f, { x: r2(x), y: r2(y), width: r2(w), height: r2(h) });
      styleBox(el, f);
      el.querySelector('.lbl').textContent = `${f.label || f.id}  ${f.x}, ${f.y} · ${f.width}×${f.height} mm`;
      syncPropNumbers(f);
      schedulePaint();
    });
    const end = () => { if (drag) { drag = null; endEdit(); syncBoxes(); } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function syncPropNumbers(f) {
    for (const p of ['x', 'y', 'width', 'height']) {
      const i = $('props').querySelector(`[data-prop="${p}"]`);
      if (i && document.activeElement !== i) i.value = String(r2(f[p]));
    }
  }

  // ---------------------------------------------------------------- canvas
  function schedulePaint() { if (!paintId) paintId = requestAnimationFrame(() => { paintId = 0; paint(); }); }

  async function paint() {
    if (!st.isOpen) return;
    const c = cfg();
    await ensureFonts(c);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssW = Math.round(BASE_W * st.zoom);
    const canvas = $('desCanvas');
    sizeCanvas(canvas, c, { cssWidthPx: cssW, dpr });
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${Math.round(cssW * c.size.heightMm / c.size.widthMm)}px`;
    renderSide(canvas, { cfg: c, bg: app.bg[st.side], data: st.useForm ? app.data : app.type.sample, photo: app.photo });
    $('dzLabel').textContent = `${Math.round(st.zoom * 100)}%`;
    document.body.dataset.desRendered = String((Number(document.body.dataset.desRendered) || 0) + 1);
  }

  function setZoom(z) { st.zoom = clampN(z, 0.5, 6); syncBoxes(); schedulePaint(); }
  function fit() {
    const desk = $('desk');
    const w = Math.min(desk.clientWidth - 40, (window.innerHeight * 0.78) * (55 / 85));
    setZoom(Math.max(0.5, w / BASE_W));
  }

  // ---------------------------------------------------------------- simpan, impor, ekspor
  function validateAll() {
    const errs = [];
    for (const s of ['front', 'back']) { const v = validateConfig(st.work[s]); errs.push(...v.errors.map((e) => `${s}: ${e}`)); }
    return errs;
  }
  function save(approve) {
    const errs = validateAll();
    if (errs.length) { window.alert('Tidak dapat menyimpan:\n' + errs.join('\n')); return; }
    if (approve && !window.confirm('Setujui posisi template?\n\nDengan menyetujui, Anda menyatakan posisi foto dan semua teks sudah diperiksa pada preview kedua sisi.')) return;
    const res = saveTemplateSet(app.type, st.work, { approve });
    if (!res.ok) window.alert('Penyimpanan di browser gagal (penuh/dinonaktifkan). Gunakan "Unduh JSON" agar konfigurasi tidak hilang.');
    app.set = { sides: res.sides, approved: res.approved, approvedAt: res.approvedAt, origin: 'custom' };
    st.work = clone(res.sides);
    st.undo = []; st.redo = []; st.editing = false;
    updateStatus();
    hooks.onSaved();
  }

  function downloadJson() {
    ['front', 'back'].forEach((s, i) => {
      setTimeout(() => {
        const blob = new Blob([JSON.stringify(st.work[s], null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `${s}-config.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      }, i * 400);
    });
  }

  async function importJson(files) {
    const done = [];
    for (const file of files) {
      try {
        const o = parseImportedConfig(await file.text());
        if (!['front', 'back'].includes(o.side)) throw new Error('Properti "side" harus front atau back.');
        const v = validateConfig(o);
        if (!v.ok) throw new Error(v.errors.join('; '));
        beginEdit();
        st.work[o.side] = o;
        endEdit();
        done.push(`${file.name} → ${o.side}`);
      } catch (e) { window.alert(`${file.name}: ${e.message}`); }
    }
    if (done.length) { st.sel = cfg().fields[0] ? cfg().fields[0].id : null; renderList(); renderProps(); syncBoxes(); schedulePaint(); updateStatus(); }
  }

  async function resetToDefault() {
    if (!window.confirm('Kembalikan template ke konfigurasi bawaan (draf)? Perubahan yang sudah disimpan akan hilang.')) return;
    resetTemplateSet(app.type);
    app.set = { sides: await loadDefaults(app.type), approved: false, approvedAt: null, origin: 'default' };
    st.work = clone(app.set.sides); st.undo = []; st.redo = [];
    st.sel = cfg().fields[0] ? cfg().fields[0].id : null;
    renderList(); renderProps(); syncBoxes(); schedulePaint(); updateStatus();
    hooks.onSaved();
  }

  // ---------------------------------------------------------------- font kustom
  async function refreshFonts() {
    st.fonts = await listFonts();
    const ul = $('fontList');
    ul.innerHTML = '';
    for (const f of st.fonts) {
      const li = document.createElement('li');
      li.className = 'fx';
      li.innerHTML = '<span></span><button type="button" class="btn small danger">Hapus</button>';
      li.querySelector('span').textContent = f.name;
      li.querySelector('button').addEventListener('click', async () => { await deleteFont(f.name); await refreshFonts(); renderProps(); });
      ul.appendChild(li);
    }
  }
  async function addFont(file) {
    if (file.size > 6 * 1024 * 1024) { window.alert('Ukuran font maksimum 6 MB.'); return; }
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || `Font${Date.now()}`;
    const rec = { name, data: await file.arrayBuffer(), weight: 'normal', style: 'normal' };
    try { await registerFont(rec); } catch { window.alert('Font tidak dapat dibaca browser.'); return; }
    await saveFont(rec);
    await refreshFonts();
    renderProps();
    schedulePaint();
  }

  // ---------------------------------------------------------------- bind
  function bind() {
    document.querySelectorAll('input[name="desSide"]').forEach((r) => r.addEventListener('change', () => {
      st.side = document.querySelector('input[name="desSide"]:checked').value;
      st.sel = cfg().fields[0] ? cfg().fields[0].id : null;
      renderList(); renderProps(); syncBoxes(); schedulePaint(); updateStatus();
    }));
    document.querySelectorAll('input[name="desData"]').forEach((r) => r.addEventListener('change', () => {
      st.useForm = document.querySelector('input[name="desData"]:checked').value === 'form'; schedulePaint();
    }));
    $('props').addEventListener('input', onPropInput);
    $('props').addEventListener('change', onPropChange);
    $('addText').addEventListener('click', () => addField('text'));
    $('addPhoto').addEventListener('click', () => addField('photo'));
    $('addMask').addEventListener('click', () => addField('mask'));
    $('desSave').addEventListener('click', () => save(false));
    $('desApprove').addEventListener('click', () => save(true));
    $('desBack').addEventListener('click', () => hooks.onClose());
    $('desUndo').addEventListener('click', undo);
    $('desRedo').addEventListener('click', redo);
    $('desExport').addEventListener('click', downloadJson);
    $('desImportBtn').addEventListener('click', () => $('desImport').click());
    $('desImport').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; importJson(fs); });
    $('desReset').addEventListener('click', resetToDefault);
    $('dzIn').addEventListener('click', () => setZoom(st.zoom * 1.25));
    $('dzOut').addEventListener('click', () => setZoom(st.zoom / 1.25));
    $('dzFit').addEventListener('click', fit);
    $('desPhoto').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const r = await app.setPhotoFile(f);
      if (!r.ok) window.alert(r.error);
      schedulePaint(); hooks.onSaved();
    });
    $('desFont').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await addFont(f); });
    $('desStage').addEventListener('pointermove', (e) => {
      const r = $('desCanvas').getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * cfg().size.widthMm;
      const y = ((e.clientY - r.top) / r.height) * cfg().size.heightMm;
      $('desCoord').textContent = `Kursor: X ${r2(x)} mm · Y ${r2(y)} mm — seret kotak untuk menggeser, tarik titik sudut/sisi untuk mengubah ukuran, panah keyboard menggeser 0,1 mm (Shift = 1 mm).`;
    });
    $('desk').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(st.zoom * Math.exp(-e.deltaY * 0.002)); } }, { passive: false });
    $('desk').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      const f = st.sel && field(st.sel);
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!f || !d) return;
      e.preventDefault();
      beginEdit();
      const step = e.shiftKey ? 1 : 0.1;
      f.x = r2(clampN(f.x + d[0] * step, 0, cfg().size.widthMm - f.width));
      f.y = r2(clampN(f.y + d[1] * step, 0, cfg().size.heightMm - f.height));
      st.editing = false;
      syncBoxes(); syncPropNumbers(f); schedulePaint(); updateStatus();
    });
    window.addEventListener('beforeunload', (e) => { if (st.isOpen && dirty()) { e.preventDefault(); e.returnValue = ''; } });
  }
  bind();

  // ---------------------------------------------------------------- API
  return {
    async open() {
      await refreshFonts();
      st.work = clone(app.set.sides);
      st.side = document.querySelector('input[name="desSide"]:checked').value;
      st.sel = cfg().fields[0] ? cfg().fields[0].id : null;
      st.undo = []; st.redo = []; st.editing = false; st.isOpen = true;
      $('ovDummy')?.remove();
      $('desOv').innerHTML = '';
      renderList(); renderProps(); syncBoxes(); updateStatus();
      // viewDes baru ditampilkan setelah open() → fit pada frame berikutnya.
      requestAnimationFrame(() => { fit(); });
    },
    isOpen: () => st.isOpen,
    /** @returns {boolean} true bila boleh meninggalkan designer */
    leave() {
      if (dirty() && !window.confirm('Ada perubahan template yang belum disimpan. Tinggalkan Designer?')) return false;
      st.isOpen = false;
      return true;
    },
    _state: st,
  };
}
