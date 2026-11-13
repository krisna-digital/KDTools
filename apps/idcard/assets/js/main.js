// ID Card Studio — main.js
// Bootstrap + Generator ID Card (form, preview, export). Template Designer ada di designer.js.

import { ID_CARD_TYPES, getType, formForSide, dataForSide } from './types.js';
import { loadTemplateSet, listFonts, registerFont } from './store.js';
import { checkTemplateAspect } from './engine.js';
import { renderSide, sizeCanvas, loadImage, ensureFonts } from './render.js';
import { exportPng, exportPdf } from './export.js';
import { placePhoto, MIN_ZOOM, MAX_ZOOM } from './geometry.js';
import { createDesigner } from './designer.js';

const $ = (id) => document.getElementById(id);
const SIDES = ['front', 'back'];
const BASE_W = 300; // lebar preview dasar (CSS px) pada zoom 100%
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

export const app = {
  type: null,
  set: null, // {sides:{front,back}, origin:'default'|'custom', notice}
  bg: {}, // gambar latar per sisi
  data: { nama: '', nip: '', jabatan: '', gol_darah: '' },
  photo: null, // {img,url,name,pxW,pxH,zoom,ox,oy}
  zoom: 1,
  layouts: {},
  notice: null,
};

/** Data efektif untuk satu sisi (sisi belakang = sisi depan, kecuali override yang diizinkan). */
export const dataFor = (side) => dataForSide(app.type, app.data, side);

// ------------------------------------------------------------------ tema

function initTheme() { /* Tema dikendalikan oleh navbar platform. */ }

// ------------------------------------------------------------------ foto

export async function setPhotoFile(file) {
  const ok = /^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!ok) return { ok: false, error: 'Format foto harus JPG, JPEG, PNG, atau WebP.' };
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (!(img.naturalWidth > 0)) throw new Error('Foto tidak terbaca.');
    if (app.photo) URL.revokeObjectURL(app.photo.url);
    app.photo = { img, url, name: file.name, pxW: img.naturalWidth, pxH: img.naturalHeight, zoom: 1, ox: 0.5, oy: 0.5 };
    return { ok: true };
  } catch (e) {
    URL.revokeObjectURL(url);
    return { ok: false, error: e.message || 'Foto gagal dimuat.' };
  }
}
app.setPhotoFile = setPhotoFile;

function removePhoto() {
  if (app.photo) URL.revokeObjectURL(app.photo.url);
  app.photo = null;
  refreshPhotoUi();
  scheduleRender();
}

const photoField = (cfg) => cfg.fields.find((f) => f.type === 'photo' && f.enabled !== false);

// ------------------------------------------------------------------ form

function buildForm() {
  for (const side of SIDES) {
    const host = $(`${side}Fields`);
    host.innerHTML = '';
    for (const f of formForSide(app.type, side)) {
      const wrap = document.createElement('div');
      wrap.className = 'idc-field';
      if (f.kind === 'photo') { buildPhotoField(wrap, f); host.appendChild(wrap); continue; }
      const label = document.createElement('label');
      label.textContent = f.label + (f.required ? ' *' : '');
      let input;
      if (f.kind === 'select') {
        input = document.createElement('select');
        input.innerHTML = '<option value="">— pilih —</option>' + f.options.map((o) => `<option value="${o}">${o}</option>`).join('');
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = f.placeholder || '';
        input.autocomplete = 'off';
      }
      input.dataset.key = f.key;
      if (f.mirrored) {
        input.readOnly = true;
        input.disabled = f.kind === 'select';
        input.dataset.mirror = '1';
        input.id = `m_${side}_${f.key}`;
        const note = document.createElement('span');
        note.className = 'mirror-note';
        note.textContent = 'Otomatis dari sisi depan — tidak perlu diisi lagi.';
        label.appendChild(input);
        label.appendChild(note);
        if (f.allowBackOverride) {
          const ck = document.createElement('label');
          ck.className = 'check';
          ck.innerHTML = '<input type="checkbox"> <span>Isi berbeda di sisi belakang (mis. “-” bila tanpa NIP)</span>';
          const box = ck.querySelector('input');
          box.id = `ovr_${f.key}`;
          box.addEventListener('change', () => {
            const k = `${f.key}@back`;
            if (box.checked) { app.data[k] = '-'; input.readOnly = false; input.dataset.override = '1'; }
            else { delete app.data[k]; input.readOnly = true; delete input.dataset.override; }
            syncMirrors(); scheduleRender();
          });
          input.addEventListener('input', () => { if (input.dataset.override === '1') { app.data[`${f.key}@back`] = input.value; scheduleRender(); } });
          wrap.appendChild(label);
          wrap.appendChild(ck);
          host.appendChild(wrap);
          continue;
        }
      } else {
        input.id = `f_${f.key}`;
        input.value = app.data[f.key] || '';
        input.addEventListener('input', () => { app.data[f.key] = input.value; syncMirrors(); scheduleRender(); });
        input.addEventListener('change', () => { app.data[f.key] = input.value; syncMirrors(); scheduleRender(); });
        label.appendChild(input);
      }
      wrap.appendChild(label);
      host.appendChild(wrap);
    }
  }
  syncMirrors();
}

function syncMirrors() {
  document.querySelectorAll('[data-mirror="1"]').forEach((el) => {
    const ovr = el.dataset.override === '1';
    if (ovr && document.activeElement === el) return; // sedang diketik
    el.value = (ovr ? app.data[`${el.dataset.key}@back`] : app.data[el.dataset.key]) || '';
  });
}

function buildPhotoField(wrap, f) {
  wrap.innerHTML = `
    <label>${f.label}
      <input type="file" id="photoInput" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp">
    </label>
    <div id="photoErr" class="alert error" role="alert" hidden></div>
    <div id="photoBox" class="idc-photo" hidden>
      <img id="photoThumb" class="thumb" alt="Foto pegawai">
      <div class="info"><span id="photoInfo"></span><button type="button" class="btn small danger" id="photoRemove">Hapus foto</button></div>
    </div>
    <div id="photoCtl" class="idc-photo-ctl" hidden>
      <label>Zoom foto <span id="photoZoomVal" class="muted"></span>
        <input type="range" id="photoZoom" min="100" max="${MAX_ZOOM * 100}" step="1" value="100" aria-label="Zoom foto">
      </label>
      <button type="button" class="btn small" id="photoReset">Reset posisi &amp; zoom</button>
      <p class="muted small">Foto mengisi kotak dengan mode cover tanpa distorsi. Geser foto langsung di preview.</p>
    </div>`;
  const err = (m) => { const e = $('photoErr'); e.hidden = !m; e.textContent = m || ''; };
  wrap.querySelector('#photoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    err('');
    const r = await setPhotoFile(file);
    if (!r.ok) err(r.error);
    refreshPhotoUi();
    scheduleRender();
  });
  wrap.querySelector('#photoRemove').addEventListener('click', removePhoto);
  wrap.querySelector('#photoZoom').addEventListener('input', (e) => {
    if (!app.photo) return;
    app.photo.zoom = clampN(Number(e.target.value) / 100, MIN_ZOOM, MAX_ZOOM);
    refreshPhotoUi(true);
    scheduleRender();
  });
  wrap.querySelector('#photoReset').addEventListener('click', () => {
    if (!app.photo) return;
    Object.assign(app.photo, { zoom: 1, ox: 0.5, oy: 0.5 });
    refreshPhotoUi();
    scheduleRender();
  });
}

function refreshPhotoUi(sliderOnly = false) {
  const p = app.photo;
  if (!$('photoBox')) return;
  $('photoBox').hidden = !p;
  $('photoCtl').hidden = !p;
  if (!p) return;
  $('photoZoomVal').textContent = `${Math.round(p.zoom * 100)}%`;
  if (sliderOnly) return;
  $('photoZoom').value = String(Math.round(p.zoom * 100));
  $('photoThumb').src = p.url;
  const cfg = app.set && app.set.sides.front;
  const pf = cfg && photoField(cfg);
  let dpi = '';
  if (pf) {
    const g = placePhoto({ x: 0, y: 0, w: pf.width, h: pf.height }, p.pxW, p.pxH, p.zoom, 0.5, 0.5);
    const d = Math.round(p.pxW / (g.w / 25.4));
    dpi = ` · ±${d} DPI pada ukuran cetak${d < 200 ? ' (rendah — hasil bisa kurang tajam)' : ''}`;
  }
  $('photoInfo').textContent = `${p.name} · ${p.pxW}×${p.pxH} px${dpi}`;
}

// ------------------------------------------------------------------ preview

let renderToken = 0;
let rafId = 0;
export function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; renderPreviews(); });
}

const cap = (side) => side[0].toUpperCase() + side.slice(1);

async function renderPreviews() {
  if (!app.set || !app.bg.front) return;
  const token = ++renderToken;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const cssW = Math.round(BASE_W * app.zoom);
  for (const side of SIDES) await ensureFonts(app.set.sides[side]);
  if (token !== renderToken) return;
  for (const side of SIDES) {
    const cfg = app.set.sides[side];
    const canvas = $(`cv${cap(side)}`);
    sizeCanvas(canvas, cfg, { cssWidthPx: cssW, dpr });
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${Math.round(cssW * cfg.size.heightMm / cfg.size.widthMm)}px`;
    const layout = renderSide(canvas, { cfg, bg: app.bg[side], data: dataFor(side), photo: app.photo });
    app.layouts[side] = layout;
    drawOverlay(side, cfg, layout, cssW);
    const w = $(`warn${cap(side)}`);
    w.innerHTML = '';
    for (const m of layout.warnings) { const d = document.createElement('div'); d.className = 'w'; d.textContent = m; w.appendChild(d); }
  }
  renderStatus();
  $('zLabel').textContent = `${Math.round(app.zoom * 100)}%`;
  document.body.dataset.rendered = String((Number(document.body.dataset.rendered) || 0) + 1);
}

function drawOverlay(side, cfg, layout, cssW) {
  const ov = $(`ov${cap(side)}`);
  ov.innerHTML = '';
  const k = cssW / cfg.size.widthMm;
  const place = (el, b) => { el.style.left = `${b.x * k}px`; el.style.top = `${b.y * k}px`; el.style.width = `${b.w * k}px`; el.style.height = `${b.h * k}px`; };
  if ($('showHints').checked) {
    for (const f of cfg.fields) {
      const st = layout.status[f.id];
      if (!st || !['empty', 'shrunk', 'overflow'].includes(st.state) || f.type === 'mask') continue;
      const d = document.createElement('div');
      d.className = `hint ${st.state}`;
      d.title = `${st.label}: ${st.message}`;
      place(d, { x: f.x, y: f.y, w: f.width, h: f.height });
      ov.appendChild(d);
    }
  }
  const po = layout.ops.find((o) => o.kind === 'photo' && !o.missing);
  if (po) {
    const hit = document.createElement('div');
    hit.className = 'photo-hit';
    place(hit, po.box);
    ov.appendChild(hit);
  }
}

function renderStatus() {
  const ul = $('statusList');
  if (!ul) return;
  ul.innerHTML = '';
  const icon = { ok: '✔', empty: '○', shrunk: '▲', overflow: '✖' };
  const seen = new Set();
  for (const side of SIDES) {
    const L = app.layouts[side];
    if (!L) continue;
    for (const [id, st] of Object.entries(L.status)) {
      if (st.state === 'off') continue;
      const key = `${side}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const li = document.createElement('li');
      li.className = st.state;
      li.innerHTML = `<span class="ic">${icon[st.state] || '•'}</span><span><b></b> <span class="msg"></span></span>`;
      li.querySelector('b').textContent = st.label;
      li.querySelector('.msg').textContent = st.state === 'ok' ? '' : st.message;
      ul.appendChild(li);
    }
  }
}

// Geser & zoom foto langsung di preview (mouse, sentuh, scroll, cubit).
function bindPhotoAdjust() {
  const ov = $('ovFront');
  const ptrs = new Map();
  let drag = null;
  let pinch = null;
  const boxOf = () => { const op = app.layouts.front && app.layouts.front.ops.find((o) => o.kind === 'photo' && !o.missing); return op && op.box; };
  const pxPerMm = () => $('cvFront').getBoundingClientRect().width / app.set.sides.front.size.widthMm;
  const overflow = (box) => { const g = placePhoto(box, app.photo.pxW, app.photo.pxH, app.photo.zoom, 0.5, 0.5); return { x: g.w - box.w, y: g.h - box.h }; };

  ov.addEventListener('pointerdown', (e) => {
    if (!e.target.classList.contains('photo-hit') || !app.photo) return;
    e.preventDefault();
    try { ov.setPointerCapture(e.pointerId); } catch { /* abaikan */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { drag = { x0: e.clientX, y0: e.clientY, ox0: app.photo.ox, oy0: app.photo.oy }; pinch = null; }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: app.photo.zoom }; drag = null; }
  });
  ov.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !app.photo) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      app.photo.zoom = clampN(pinch.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0), MIN_ZOOM, MAX_ZOOM);
      refreshPhotoUi(true); $('photoZoom').value = String(Math.round(app.photo.zoom * 100)); scheduleRender();
      return;
    }
    const box = boxOf();
    if (!drag || !box) return;
    const k = pxPerMm();
    const ov2 = overflow(box);
    if (ov2.x > 1e-6) app.photo.ox = clampN(drag.ox0 - (e.clientX - drag.x0) / k / ov2.x, 0, 1);
    if (ov2.y > 1e-6) app.photo.oy = clampN(drag.oy0 - (e.clientY - drag.y0) / k / ov2.y, 0, 1);
    scheduleRender();
  });
  const end = (e) => {
    ptrs.delete(e.pointerId);
    pinch = null; drag = null;
    if (ptrs.size === 1 && app.photo) { const [r] = [...ptrs.values()]; drag = { x0: r.x, y0: r.y, ox0: app.photo.ox, oy0: app.photo.oy }; }
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', end);
  ov.addEventListener('wheel', (e) => {
    if (!e.target.classList.contains('photo-hit') || !app.photo) return;
    e.preventDefault();
    app.photo.zoom = clampN(app.photo.zoom * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
    $('photoZoom').value = String(Math.round(app.photo.zoom * 100));
    refreshPhotoUi(true);
    scheduleRender();
  }, { passive: false });
  ov.addEventListener('mousedown', (e) => { if (e.target.classList.contains('photo-hit')) e.preventDefault(); });
}

// ------------------------------------------------------------------ badge & peringatan template

function aspectChecks() {
  return SIDES.map((side) => {
    const cfg = app.set.sides[side];
    const bg = app.bg[side];
    return { side, ...checkTemplateAspect({ size: cfg.size, background: { pxWidth: bg.naturalWidth, pxHeight: bg.naturalHeight } }) };
  });
}

export function refreshTemplateBadge() {
  const b = $('tplBadge');
  const v = app.set.sides.front.templateVersion || '1';
  b.className = 'badge ok';
  b.textContent = `${app.type.name} · v${v}${app.set.origin === 'custom' ? ' · posisi disesuaikan' : ''}`;
  const banner = $('noticeBanner');
  const bad = aspectChecks().filter((a) => !a.ok);
  const msgs = [];
  if (app.notice) msgs.push(app.notice);
  for (const a of bad) msgs.push(`<b>${a.side === 'front' ? 'Depan' : 'Belakang'}:</b> ${a.message}`);
  banner.hidden = msgs.length === 0;
  banner.className = `alert ${bad.length ? 'error' : 'info'}`;
  banner.innerHTML = msgs.join('<br>');
  const blocked = bad.length > 0;
  ['btnPngFront', 'btnPngBack', 'btnPdfTwo', 'btnPdfOne'].forEach((id) => { $(id).disabled = blocked; });
}

// ------------------------------------------------------------------ export

function exportCtx() {
  return { typeId: app.type.id, sides: app.set.sides, bg: app.bg, data: { front: dataFor('front'), back: dataFor('back') }, photo: app.photo };
}

async function runExport(kind) {
  const msg = $('exportMsg');
  const missing = [];
  if (!app.data.nama.trim()) missing.push('nama');
  if (!app.data.nip.trim()) missing.push('NIP');
  if (!app.photo) missing.push('foto');
  if (missing.length && !window.confirm(`Belum diisi: ${missing.join(', ')}. Tetap ekspor?`)) return;
  const dpi = Number($('dpiSel').value) || 600;
  const buttons = ['btnPngFront', 'btnPngBack', 'btnPdfTwo', 'btnPdfOne'].map($);
  buttons.forEach((b) => { b.disabled = true; });
  msg.textContent = 'Membuat file…';
  try {
    let r;
    if (kind === 'pngFront') r = await exportPng('front', exportCtx(), { dpi, name: app.data.nama });
    else if (kind === 'pngBack') r = await exportPng('back', exportCtx(), { dpi, name: app.data.nama });
    else r = await exportPdf(kind === 'pdfOne' ? 'one' : 'two', exportCtx(), { dpi, name: app.data.nama });
    const extra = r.width ? ` (${r.width}×${r.height} px)` : '';
    msg.textContent = `Selesai${extra}.${r.warnings.length ? ' Peringatan: ' + r.warnings.join(' | ') : ''}`;
  } catch (e) {
    msg.textContent = `Gagal: ${e.message}`;
  } finally {
    refreshTemplateBadge();
  }
}

// ------------------------------------------------------------------ memuat jenis ID card

async function loadBackgrounds() {
  for (const side of SIDES) {
    const cfg = app.set.sides[side];
    app.bg[side] = await loadImage(app.type.basePath + cfg.background.src);
  }
}

async function loadType(id) {
  app.type = getType(id);
  $('loadError').hidden = true;
  try {
    app.set = await loadTemplateSet(app.type);
    app.notice = app.set.notice;
    await loadBackgrounds();
  } catch (e) {
    $('loadError').hidden = false;
    $('loadError').textContent = `Template gagal dimuat: ${e.message}. Buka aplikasi lewat server (mis. GitHub Pages), bukan file:// langsung.`;
    return;
  }
  for (const k of Object.keys(app.data)) if (k.endsWith('@back')) delete app.data[k];
  buildForm();
  refreshPhotoUi();
  refreshTemplateBadge();
  scheduleRender();
}

// ------------------------------------------------------------------ tab

let designer;
function showView(v) {
  const des = v === 'des';
  if (des) designer.open(); else if (designer.isOpen() && !designer.leave()) return;
  $('viewGen').hidden = des;
  $('viewDes').hidden = !des;
  $('tabGen').classList.toggle('active', !des);
  $('tabDes').classList.toggle('active', des);
  $('tabGen').setAttribute('aria-selected', String(!des));
  $('tabDes').setAttribute('aria-selected', String(des));
  if (!des) { refreshTemplateBadge(); scheduleRender(); }
}

async function boot() {
  initTheme();
  $('typeSel').innerHTML = ID_CARD_TYPES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  $('typeSel').addEventListener('change', () => loadType($('typeSel').value));
  for (const rec of await listFonts()) { try { await registerFont(rec); } catch { /* font rusak diabaikan */ } }

  designer = createDesigner(app, {
    onSaved: () => { refreshTemplateBadge(); refreshPhotoUi(); scheduleRender(); },
    onClose: () => showView('gen'),
  });
  $('tabGen').addEventListener('click', () => showView('gen'));
  $('tabDes').addEventListener('click', () => showView('des'));
  $('btnEditPos').addEventListener('click', () => showView('des'));
  $('zIn').addEventListener('click', () => { app.zoom = clampN(app.zoom * 1.2, 0.5, 4); scheduleRender(); });
  $('zOut').addEventListener('click', () => { app.zoom = clampN(app.zoom / 1.2, 0.5, 4); scheduleRender(); });
  $('zReset').addEventListener('click', () => { app.zoom = 1; scheduleRender(); });
  $('showHints').addEventListener('change', scheduleRender);
  $('btnPngFront').addEventListener('click', () => runExport('pngFront'));
  $('btnPngBack').addEventListener('click', () => runExport('pngBack'));
  $('btnPdfTwo').addEventListener('click', () => runExport('pdfTwo'));
  $('btnPdfOne').addEventListener('click', () => runExport('pdfOne'));
  bindPhotoAdjust();
  window.addEventListener('resize', () => scheduleRender());
  await loadType(ID_CARD_TYPES[0].id);
}

boot();
