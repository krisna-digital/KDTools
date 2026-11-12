// PRINTLAY — app.js
// Penghubung UI. Seluruh geometri berasal dari optimizeLayout() → validateLayout() → buildSvg()/export.

import {
  parseNumber, toMm, PAPER_PRESETS, normalizeInputs, orderInfo, computeStats, imageQuality, formatMm, fromMm,
} from './calculator.js';
import { buildPolaroid2R, buildBatchTemplate, variantFor, resolveCardOrientation, POLAROID_DEFAULTS, placePhoto, mapRect, MIN_ZOOM, MAX_ZOOM } from './templates.js';
import { optimizeLayout } from './optimizer.js';
import { validateLayout } from './validator.js';
import { buildSvg } from './renderer.js';
import { loadArtwork, formatBytes } from './artwork.js';
import { exportPdf, exportSvg, printLayout } from './export.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  designW: '80', designH: '59', unit: 'mm', qty: '',
  preset: 'A4', paperW: '210', paperH: '297', orientation: 'portrait',
  gapX: '2', gapY: '2', mTop: '0', mRight: '0', mBottom: '0', mLeft: '0',
  allowRotation: true, extendedSearch: true,
  template: 'std', cardOrient: 'auto',
  pSide: String(POLAROID_DEFAULTS.side), pTop: String(POLAROID_DEFAULTS.top), pBottom: String(POLAROID_DEFAULTS.bottom),
  stdW: '80', stdH: '59', stdUnit: 'mm',
};

const MAX_PHOTOS = 200; // Polaroid
const MAX_BATCH_PHOTOS = 100; // Foto Kustom
let photoSeq = 0;

const state = {
  photos: [], sel: -1, sheet: 0,
  template: 'std', std: { w: '80', h: '59', unit: 'mm' },
  config: null, layout: null, result: null, validation: null,
  dirty: true, zoom: 1,
  artwork: null, fit: 'contain',
  showNumbers: true, showMargin: true, showDims: false,
  persistArtwork: false,
};

// ---------- Form ----------
function readRaw() {
  return {
    designW: $('designW').value, designH: $('designH').value, unit: $('designUnit').value, qty: $('qty').value,
    preset: $('paperPreset').value, paperW: $('paperW').value, paperH: $('paperH').value,
    orientation: document.querySelector('input[name="orientation"]:checked').value,
    gapX: $('gapX').value, gapY: $('gapY').value,
    mTop: $('mTop').value, mRight: $('mRight').value, mBottom: $('mBottom').value, mLeft: $('mLeft').value,
    allowRotation: $('allowRotation').checked, extendedSearch: $('extendedSearch').checked,
    template: state.template,
    cardOrient: document.querySelector('input[name="cardOrient"]:checked').value,
    pSide: $('pSide').value, pTop: $('pTop').value, pBottom: $('pBottom').value,
    stdW: state.std.w, stdH: state.std.h, stdUnit: state.std.unit,
  };
}

function applyRaw(r) {
  const v = { ...DEFAULTS, ...r };
  $('designW').value = v.designW; $('designH').value = v.designH; $('designUnit').value = v.unit; $('qty').value = v.qty;
  $('paperPreset').value = v.preset; $('paperW').value = v.paperW; $('paperH').value = v.paperH;
  (v.orientation === 'landscape' ? $('orientLandscape') : $('orientPortrait')).checked = true;
  $('gapX').value = v.gapX; $('gapY').value = v.gapY;
  $('mTop').value = v.mTop; $('mRight').value = v.mRight; $('mBottom').value = v.mBottom; $('mLeft').value = v.mLeft;
  $('allowRotation').checked = !!v.allowRotation; $('extendedSearch').checked = !!v.extendedSearch;
  state.template = ['polaroid2r', 'batch'].includes(v.template) ? v.template : 'std';
  $('templateSel').value = state.template;
  state.std = { w: String(v.stdW), h: String(v.stdH), unit: v.stdUnit };
  ({ portrait: $('cardPortrait'), landscape: $('cardLandscape') }[v.cardOrient] || $('cardAuto')).checked = true;
  $('pSide').value = v.pSide; $('pTop').value = v.pTop; $('pBottom').value = v.pBottom;
  applyTemplateUi();
}

// ---------- Template ----------
const isPoly = () => state.template === 'polaroid2r'; // Polaroid 2R (ukuran kartu terkunci + border)
const isBatch = () => state.template === 'batch'; // Foto Kustom (ukuran bebas, tanpa border)
const isMulti = () => isPoly() || isBatch(); // mode banyak foto + geser/zoom per foto
const cardOrientMode = () => document.querySelector('input[name="cardOrient"]:checked').value;

/** Template aktif + orientasi kartu yang sudah diputuskan (otomatis dari foto bila dipilih). */
function currentTemplate() {
  if (isBatch()) {
    const u = $('designUnit').value;
    return buildBatchTemplate({
      w: toMm(parseNumber($('designW').value), u), h: toMm(parseNumber($('designH').value), u),
      orientation: cardOrientMode() === 'landscape' ? 'landscape' : 'portrait',
    });
  }
  if (!isPoly()) return { ok: true, errors: [], template: null };
  // Ukuran "desain" untuk optimizer = kartu potret (otomatis) atau sesuai pilihan manual. Kartu lanskap hanyalah
  // kartu potret yang diputar 90°, jadi tata letak yang sama dipakai untuk foto potret maupun lanskap.
  return buildPolaroid2R({
    orientation: cardOrientMode() === 'landscape' ? 'landscape' : 'portrait',
    side: $('pSide').value, top: $('pTop').value, bottom: $('pBottom').value,
  });
}

/**
 * Template (orientasi) untuk satu foto: otomatis per foto, atau dipaksa manual.
 * `base` = template dasar dari config hasil hitung (border/ukuran konsisten dengan layout); bila kosong dipakai input saat ini.
 */
function photoTpl(art, base) {
  const b = base || currentTemplate().template;
  return b ? variantFor(b, resolveCardOrientation(cardOrientMode(), art)) : null;
}

/** Sinkronkan UI dengan template: kunci ukuran desain, isi ukuran kartu, kunci mode fit. */
function applyTemplateUi() {
  const poly = isPoly();
  const multi = isMulti();
  $('polaroidOpts').hidden = !multi;
  $('polaroidBorders').hidden = !poly;
  for (const id of ['designW', 'designH', 'designUnit', 'swapDesign']) $(id).disabled = poly; // Foto Kustom: ukuran tetap bebas diubah
  document.querySelectorAll('input[name="fit"]').forEach((r) => { r.disabled = multi; });
  $('fitNote').hidden = !multi;
  $('fileInput').multiple = multi;
  $('dzMain').innerHTML = multi
    ? '<strong>Seret &amp; lepas beberapa foto</strong> atau <u>pilih file</u>'
    : '<strong>Seret &amp; lepas gambar</strong> atau <u>pilih file</u>';
  if (poly) {
    const tp = currentTemplate();
    if (tp.ok) {
      const t = tp.template;
      $('designUnit').value = 'mm';
      $('designW').value = formatMm(t.cardW);
      $('designH').value = formatMm(t.cardH);
      const land = buildPolaroid2R({ orientation: 'landscape', side: $('pSide').value, top: $('pTop').value, bottom: $('pBottom').value }).template;
      const w = (x) => `${formatMm(x.window.w)} × ${formatMm(x.window.h)} mm (rasio ${(x.window.w / x.window.h).toFixed(2)})`;
      $('polaroidInfo').textContent = cardOrientMode() === 'auto'
        ? `Orientasi otomatis per foto. Kartu ${formatMm(t.cardW)} × ${formatMm(t.cardH)} mm · jendela potret ${w(t)} · jendela lanskap ${land ? w(land) : '–'}`
        : `Kartu ${t.orientation === 'landscape' ? 'lanskap' : 'potret'} (manual) ${formatMm(t.cardW)} × ${formatMm(t.cardH)} mm · jendela foto ${w(t)}`;
    } else {
      $('polaroidInfo').textContent = tp.errors[0];
    }
  } else {
    if ($('designUnit').value !== state.std.unit) $('designUnit').value = state.std.unit;
    if ($('designW').value !== state.std.w) $('designW').value = state.std.w;
    if ($('designH').value !== state.std.h) $('designH').value = state.std.h;
    if (isBatch()) {
      const tp = currentTemplate();
      if (tp.ok) {
        const t = tp.template;
        const land = variantFor(t, 'landscape');
        $('polaroidInfo').textContent = cardOrientMode() === 'auto'
          ? `Setiap foto mengisi 1 kotak (${formatMm(t.short)} × ${formatMm(t.long)} mm), tanpa tepi putih. Orientasi otomatis per foto: potret ${formatMm(t.short)} × ${formatMm(t.long)} mm · lanskap ${formatMm(land.cardW)} × ${formatMm(land.cardH)} mm. Ukuran kotak diatur di kartu "Ukuran Desain".`
          : `Setiap foto mengisi 1 kotak ${t.orientation === 'landscape' ? 'lanskap' : 'potret'} ${formatMm(t.cardW)} × ${formatMm(t.cardH)} mm, tanpa tepi putih.`;
      } else {
        $('polaroidInfo').textContent = tp.errors[0];
      }
    }
  }
}

function persistSettings() {
  store.saveSettings({
    raw: readRaw(), theme: document.documentElement.getAttribute('data-theme'),
    fit: state.fit, showNumbers: state.showNumbers, showMargin: state.showMargin, showDims: state.showDims,
    persistArtwork: state.persistArtwork,
  });
}

function currentConfig() {
  const raw = readRaw();
  const p = PAPER_PRESETS.find((x) => x.id === raw.preset);
  const tp = currentTemplate();
  if (!tp.ok) return { ok: false, errors: tp.errors, config: null };
  const t = tp.template;
  // Template: ukuran desain = ukuran kartu (mm), bukan isi kolom ukuran desain.
  const base = t ? { ...raw, designW: String(t.cardW), designH: String(t.cardH), unit: 'mm' } : raw;
  const res = normalizeInputs({ ...base, paperName: p ? p.name : 'Custom' });
  if (res.ok) res.config.template = t;
  return res;
}

function paperLabel(cfg) {
  return `${cfg.paperName} · ${formatMm(cfg.paperW)} × ${formatMm(cfg.paperH)} mm (${cfg.paperW > cfg.paperH ? 'landscape' : 'portrait'})`;
}

function updateInfo() {
  const { ok, config } = currentConfig();
  $('designInfo').textContent = ok
    ? `Ukuran desain: ${formatMm(config.designW)} × ${formatMm(config.designH)} mm (${formatMm(fromMm(config.designW, 'cm'))} × ${formatMm(fromMm(config.designH, 'cm'))} cm)`
    : '';
  $('paperInfo').textContent = ok ? `Kertas efektif: ${paperLabel(config)}` : '';
}

function markDirty() {
  if (!isPoly()) state.std = { w: $('designW').value, h: $('designH').value, unit: $('designUnit').value };
  applyTemplateUi();
  state.dirty = true;
  if (state.layout) {
    setBadge('stale', 'Hasil kedaluwarsa — tekan CALCULATE');
    for (const id of ['btnPdf', 'btnSvg', 'btnPrint']) $(id).disabled = true;
  }
  updateInfo();
  refreshArtUi();
  persistSettings();
}

function setBadge(kind, text) {
  const b = $('statusBadge');
  b.className = `badge ${kind}`;
  b.textContent = text;
}

// ---------- Calculate ----------
async function calculate() {
  const errBox = $('formErrors');
  const { ok, errors, config } = currentConfig();
  if (!ok) {
    errBox.hidden = false;
    errBox.innerHTML = '';
    const ul = document.createElement('ul');
    ul.style.margin = '0'; ul.style.paddingLeft = '18px';
    errors.forEach((e) => { const li = document.createElement('li'); li.textContent = e; ul.appendChild(li); });
    errBox.appendChild(ul);
    errBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  errBox.hidden = true;

  const btn = $('calcBtn');
  btn.disabled = true; btn.textContent = 'Menghitung…';
  await new Promise((r) => setTimeout(r, 30)); // beri kesempatan UI repaint

  try {
    const result = optimizeLayout(config);
    if (result.tooMany) {
      errBox.hidden = false;
      errBox.textContent = result.note;
      return;
    }
    const layout = { count: result.placements.length, placements: result.placements };
    const validation = validateLayout(layout, config);
    Object.assign(state, { config, layout, result, validation, dirty: false, zoom: 1 });
    renderResults();
    renderPreview();
    if (isMulti()) refreshPhotosUi();
    store.addHistory({
      t: Date.now(),
      text: `${config.template ? `${config.template.name} ${config.template.orientation === 'landscape' ? 'lanskap' : 'potret'}` : `${formatMm(config.designW)}×${formatMm(config.designH)} mm`} → ${config.paperName} ${formatMm(config.paperW)}×${formatMm(config.paperH)}: ${layout.count} pcs`,
      raw: readRaw(),
    });
    renderHistory();
    persistSettings();
    $('previewWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } finally {
    btn.disabled = false; btn.textContent = 'CALCULATE';
  }
}

function renderResults() {
  const { config: c, layout, result, validation } = state;
  const s = computeStats(c, layout);
  $('rCount').textContent = String(s.count);
  $('rPaper').textContent = paperLabel(c);
  $('rDesign').textContent = c.template
    ? `${c.template.name} ${c.template.orientation === 'landscape' ? 'lanskap' : 'potret'} · ${formatMm(c.designW)} × ${formatMm(c.designH)} mm`
    : `${formatMm(c.designW)} × ${formatMm(c.designH)} mm`;
  $('rGap').textContent = `${formatMm(c.gapX)} / ${formatMm(c.gapY)} mm`;
  $('rMargin').textContent = `${formatMm(c.margins.top)} / ${formatMm(c.margins.right)} / ${formatMm(c.margins.bottom)} / ${formatMm(c.margins.left)} mm`;
  $('rOrient').textContent = s.count === 0 ? '–' : s.rotated === 0 ? 'Semua normal' : s.normal === 0 ? 'Semua dirotasi 90°' : 'Campuran normal + rotasi';
  $('rNormal').textContent = String(s.normal);
  $('rRotated').textContent = String(s.rotated);
  $('rUtil').textContent = `${s.utilizationPaper.toFixed(1)}% dari kertas · ${s.utilizationUsable.toFixed(1)}% dari area cetak`;
  $('rWaste').textContent = `${(s.wasteArea / 100).toFixed(1)} cm² (${s.wastePercent.toFixed(1)}%)`;
  $('rStrategy').textContent = result.strategy;
  $('rNote').textContent = `${result.note}${result.baselineGrid ? ` (Grid sederhana terbaik: ${result.baselineGrid} pcs.)` : ''}`;

  if (validation.valid) setBadge('ok', `✔ Layout tervalidasi · ${s.count} pcs`);
  else setBadge('bad', '✖ Layout tidak valid');

  const labels = {
    inside: 'Semua desain berada di dalam area cetak (margin dipatuhi)',
    overlap: 'Tidak ada desain yang saling overlap',
    gap: 'Gap horizontal & vertikal terpenuhi',
    rotation: 'Orientasi/rotasi tercatat benar',
    count: 'Jumlah laporan = jumlah objek digambar',
  };
  const ul = $('rChecks');
  ul.innerHTML = '';
  Object.entries(labels).forEach(([k, text]) => {
    const li = document.createElement('li');
    li.className = validation.checks[k] ? 'ok' : 'bad';
    li.textContent = text;
    ul.appendChild(li);
  });
  validation.errors.slice(0, 5).forEach((e) => {
    const li = document.createElement('li');
    li.className = 'bad'; li.textContent = e; ul.appendChild(li);
  });

  const o = orderInfo(c.qty, s.count);
  $('orderBox').hidden = !o;
  if (o) {
    $('oSheets').textContent = `${o.sheets} lembar`;
    $('oTotal').textContent = `${o.totalPrinted} pcs (pesanan ${o.qty} pcs)`;
    $('oSpare').textContent = `${o.surplus} pcs`;
    $('oLast').textContent = `${o.lastSheetUsed} terpakai · ${o.lastSheetFree} kosong`;
  }

  const exportable = validation.valid && s.count > 0;
  for (const id of ['btnPdf', 'btnSvg', 'btnPrint']) $(id).disabled = !exportable;
  $('exportMsg').textContent = '';
}

// ---------- Preview ----------
function hasArtwork() { return isMulti() ? state.photos.length > 0 : !!state.artwork; }

function capacity() { return state.layout ? state.layout.placements.length : 0; }
function sheetTotal() { const c = capacity(); return c && state.photos.length ? Math.ceil(state.photos.length / c) : 1; }

/** Foto beserta template (orientasi) masing-masing, dihitung dari template dasar pada config yang sedang ditampilkan. */
function photoEntry(ph, base) {
  return { art: ph.art, zoom: ph.zoom, ox: ph.ox, oy: ph.oy, tpl: photoTpl(ph.art, base) };
}
function allPhotoEntries() {
  return state.photos.map((ph) => photoEntry(ph, baseNow()));
}

function renderPreview() {
  const host = $('previewHost');
  const poly = isMulti() && state.photos.length > 0;
  $('placeholderBadge').hidden = !(state.layout && !hasArtwork());
  $('adjustHint').hidden = !(state.layout && poly && state.layout.placements.length);
  const nav = $('sheetNav');
  if (!state.layout) { nav.hidden = true; return; }
  if (!state.layout.placements.length) {
    host.innerHTML = '<p class="muted empty">Desain tidak dapat dimuat pada kertas ini.</p>';
    nav.hidden = true;
    return;
  }
  const total = sheetTotal();
  state.sheet = Math.min(Math.max(0, state.sheet), total - 1);
  nav.hidden = !(poly && total > 1);
  $('sheetLabel').textContent = `Lembar ${state.sheet + 1}/${total}`;
  $('sheetPrev').disabled = state.sheet === 0;
  $('sheetNext').disabled = state.sheet >= total - 1;

  const opts = {
    mode: 'preview',
    showNumbers: state.showNumbers, showMargin: state.showMargin, showDims: state.showDims,
    artwork: state.artwork, href: state.artwork ? state.artwork.displayUrl : null, fit: state.fit,
  };
  if (poly && state.config.template) {
    const cap = capacity();
    const base = state.sheet * cap;
    opts.artwork = null; opts.href = null;
    opts.photos = state.photos.slice(base, base + cap).map((ph) => {
      const e = photoEntry(ph, state.config.template);
      return { pxW: ph.art.pxW, pxH: ph.art.pxH, href: ph.art.displayUrl, tpl: e.tpl, zoom: ph.zoom, ox: ph.ox, oy: ph.oy };
    });
    opts.interactive = true;
    opts.selected = state.sel - base;
    opts.numberOffset = base;
  }
  host.innerHTML = buildSvg(state.layout, state.config, opts);
  const svg = host.querySelector('svg');
  if (svg && opts.interactive) svg.classList.add('adjusting');
  applyZoom();
}

function applyZoom() {
  const svg = $('previewHost').querySelector('svg');
  if (!svg || !state.config) return;
  const wrap = $('previewWrap');
  const cw = Math.max(120, wrap.clientWidth - 24);
  const ch = Math.max(240, window.innerHeight * 0.7);
  const base = Math.min(cw / state.config.paperW, ch / state.config.paperH);
  svg.style.width = `${state.config.paperW * base * state.zoom}px`;
  svg.style.height = `${state.config.paperH * base * state.zoom}px`;
  $('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
}

function setZoom(z) {
  state.zoom = Math.min(10, Math.max(0.25, z));
  applyZoom();
}

// ---------- Artwork ----------
function showArtError(msg) {
  const e = $('artError');
  e.hidden = !msg;
  e.textContent = msg || '';
}

async function setArtwork(file, { silent = false } = {}) {
  showArtError('');
  try {
    const art = await loadArtwork(file);
    if (state.artwork) state.artwork.revoke();
    state.artwork = art;
    refreshArtUi();
    renderPreview();
    if (state.persistArtwork && !silent) store.saveArtworkBlob(art.file, art.name, art.file.type).catch(() => {});
  } catch (e) {
    showArtError(e.message || 'Gagal memuat gambar.');
  }
}

function removeArtwork() {
  if (state.artwork) state.artwork.revoke();
  state.artwork = null;
  $('fileInput').value = '';
  store.clearArtworkBlob().catch(() => {});
  refreshArtUi();
  renderPreview();
}

function refreshArtUi() {
  if (isMulti()) {
    $('artBox').hidden = true;
    $('dropzone').hidden = false;
    $('placeholderNote').hidden = state.photos.length > 0;
    $('artWarnings').innerHTML = '';
    $('photoBox').hidden = false;
    refreshPhotosUi();
    return;
  }
  $('photoBox').hidden = true;
  const art = state.artwork;
  $('artBox').hidden = !art;
  $('placeholderNote').hidden = !!art;
  $('dropzone').hidden = !!art;
  const warn = $('artWarnings');
  warn.innerHTML = '';
  if (!art) return;
  $('artThumb').src = art.displayUrl;

  const info = $('artInfo');
  info.innerHTML = '';
  const line = (k, v) => {
    const d = document.createElement('div');
    const b = document.createElement('b'); b.textContent = `${k}: `;
    d.appendChild(b); d.appendChild(document.createTextNode(v));
    info.appendChild(d);
  };
  const { ok, config } = currentConfig();
  line('File', art.name);
  line('Format', art.format.toUpperCase() + (art.vector ? ' (vektor, disanitasi)' : ''));
  line('Dimensi', `${art.pxW} × ${art.pxH} px`);
  line('Ukuran file', formatBytes(art.size));
  if (ok) {
    const t = config.template;
    const frameW = t ? t.window.w : config.designW;
    const frameH = t ? t.window.h : config.designH;
    const q = imageQuality({ pxW: art.pxW, pxH: art.pxH, frameW, frameH, fit: t ? 'cover' : state.fit, vector: art.vector, size: art.size, format: art.format });
    line('Rasio', `${q.ratioImg.toFixed(3)} (${t ? 'jendela foto' : 'desain'} ${q.ratioFrame.toFixed(3)})`);
    line('Estimasi DPI', q.dpi === null ? 'Vektor — tajam pada ukuran apa pun' : `±${Math.round(q.dpi)} DPI pada ${formatMm(frameW)}×${formatMm(frameH)} mm`);
    q.warnings.forEach((w) => {
      const d = document.createElement('div');
      d.className = `alert ${q.level === 'low' ? 'error' : 'warn'}`;
      d.textContent = w;
      warn.appendChild(d);
    });
  }
}


// ---------- Foto Polaroid (banyak foto + geser/zoom per foto) ----------
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const newPhoto = (art) => ({ id: ++photoSeq, art, zoom: 1, ox: 0.5, oy: 0.5 });

function migrateArtworkToPhotos() {
  if (isMulti() && state.artwork) {
    state.photos.push(newPhoto(state.artwork));
    state.artwork = null;
    if (state.sel < 0) state.sel = 0;
  }
}

async function addPhotos(files) {
  showArtError('');
  const errs = [];
  for (const f of files) {
    const limit = isBatch() ? MAX_BATCH_PHOTOS : MAX_PHOTOS;
    if (state.photos.length >= limit) { errs.push(`Maksimum ${limit} foto${isBatch() ? ' pada mode Foto Kustom' : ''}; sisanya diabaikan.`); break; }
    try { state.photos.push(newPhoto(await loadArtwork(f))); } catch (e) { errs.push(`${f.name}: ${e.message || 'gagal dimuat'}`); }
  }
  if (errs.length) showArtError(errs.slice(0, 3).join(' · ') + (errs.length > 3 ? ` (+${errs.length - 3} lainnya)` : ''));
  if (state.sel < 0 && state.photos.length) state.sel = 0;
  refreshArtUi();
  renderPreview();
}

function handleFiles(list) {
  const files = [...list];
  if (!files.length) return;
  if (isMulti()) addPhotos(files); else setArtwork(files[0]);
}

function baseNow() {
  return state.config && state.config.template ? state.config.template : undefined;
}

/** DPI efektif foto pada ukuran cetaknya (jendela × zoom). */
function photoDpi(ph) {
  if (ph.art.vector) return null;
  const tpl = photoTpl(ph.art, baseNow());
  if (!tpl) return null;
  const g = placePhoto(tpl.window, ph.art.pxW, ph.art.pxH, ph.zoom, ph.ox, ph.oy);
  return ph.art.pxW / (g.w / 25.4);
}

function buildPhotoGrid() {
  const grid = $('photoGrid');
  grid.innerHTML = '';
  state.photos.forEach((ph, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `photo-thumb${i === state.sel ? ' sel' : ''}`;
    b.title = ph.art.name;
    b.dataset.i = String(i);
    const img = document.createElement('img');
    img.src = ph.art.displayUrl; img.alt = ph.art.name; img.loading = 'lazy';
    const n = document.createElement('span');
    n.className = 'n'; n.textContent = String(i + 1);
    b.appendChild(img); b.appendChild(n);
    const d = photoDpi(ph);
    if (d !== null && d < 150) { const w = document.createElement('span'); w.className = 'w'; w.textContent = '⚠'; b.appendChild(w); }
    b.addEventListener('click', () => selectPhoto(i));
    grid.appendChild(b);
  });
}

function refreshPhotoEditor() {
  const ph = state.photos[state.sel];
  $('photoEditor').hidden = !ph;
  document.querySelectorAll('#photoGrid .photo-thumb').forEach((b) => b.classList.toggle('sel', +b.dataset.i === state.sel));
  const warn = $('photoWarn');
  warn.innerHTML = '';
  if (!ph) return;
  const tpl = photoTpl(ph.art, baseNow());
  const d = photoDpi(ph);
  $('photoMeta').textContent = `#${state.sel + 1} · ${ph.art.name} · ${ph.art.pxW}×${ph.art.pxH} px · ${isBatch() ? 'kotak' : 'kartu'} ${tpl && tpl.orientation === 'landscape' ? 'lanskap' : 'potret'}` +
    (d === null ? ' · vektor' : ` · ±${Math.round(d)} DPI`);
  $('photoZoom').value = String(Math.round(ph.zoom * 100));
  $('photoZoomVal').textContent = `${Math.round(ph.zoom * 100)}%`;
  if (d !== null && d < 300) {
    const a = document.createElement('div');
    a.className = `alert ${d < 150 ? 'error' : 'warn'}`;
    a.textContent = d < 150 ? `Resolusi rendah (±${Math.round(d)} DPI) — hasil cetak bisa pecah, terutama bila di-zoom.` : `Resolusi cukup (±${Math.round(d)} DPI); disarankan ≥ 300 DPI.`;
    warn.appendChild(a);
  }
}

function refreshPhotosUi() {
  buildPhotoGrid();
  const n = state.photos.length;
  const cap = capacity();
  let t;
  if (!n) t = 'Belum ada foto. Unggah beberapa foto sekaligus; tiap lembar diisi sesuai jumlah slot hasil CALCULATE dan berlanjut otomatis ke lembar berikutnya.';
  else if (!cap) t = `${n} foto. Tekan CALCULATE untuk menghitung slot per lembar.`;
  else {
    const sheets = Math.ceil(n / cap);
    const last = n - (sheets - 1) * cap;
    t = `${n} foto → ${sheets} lembar (${cap} slot per lembar).`;
    if (last < cap) t += ` Lembar terakhir terisi ${last} dari ${cap} slot; tambah ${cap - last} foto agar kelipatan ${cap} (slot kosong tidak dicetak).`;
  }
  $('photoSummary').textContent = t;
  refreshPhotoEditor();
}

function highlightSel() {
  const base = state.sheet * capacity();
  $('previewHost').querySelectorAll('.pl-sel').forEach((r) => r.setAttribute('stroke', +r.dataset.slot === state.sel - base ? '#f59e0b' : 'none'));
}

function selectPhoto(i) {
  if (i < 0 || i >= state.photos.length) return;
  state.sel = i;
  const cap = capacity();
  if (cap && Math.floor(i / cap) !== state.sheet) { state.sheet = Math.floor(i / cap); renderPreview(); }
  else highlightSel();
  refreshPhotoEditor();
}

function slotCtx(slotIdx) {
  if (!state.layout || !state.config || !state.config.template) return null;
  const gi = state.sheet * capacity() + slotIdx;
  const ph = state.photos[gi];
  const p = state.layout.placements[slotIdx];
  if (!ph || !p) return null;
  const tpl = photoTpl(ph.art, state.config.template);
  return { gi, ph, p, tpl, r: Math.abs(p.w - tpl.cardW) > 1e-6, slotIdx };
}

/** Perbarui hanya elemen <image> foto (tanpa render ulang SVG) agar geser/zoom terasa halus. */
function applyPhotoGeom(slotIdx) {
  const c = slotCtx(slotIdx);
  const img = $('previewHost').querySelector(`image[data-slot="${slotIdx}"]`);
  if (!c || !img) return;
  const g = placePhoto(c.tpl.window, c.ph.art.pxW, c.ph.art.pxH, c.ph.zoom, c.ph.ox, c.ph.oy);
  const f = (v) => String(Number(v.toFixed(4)));
  img.setAttribute('x', f(g.x)); img.setAttribute('y', f(g.y)); img.setAttribute('width', f(g.w)); img.setAttribute('height', f(g.h));
}

function setPhotoZoom(gi, z) {
  const ph = state.photos[gi];
  if (!ph) return;
  ph.zoom = clampN(z, MIN_ZOOM, MAX_ZOOM);
  const cap = capacity();
  if (cap && Math.floor(gi / cap) === state.sheet) applyPhotoGeom(gi - state.sheet * cap);
  if (gi === state.sel) { refreshPhotoEditor(); buildPhotoGridBadgeOnly(gi); }
}

function buildPhotoGridBadgeOnly(gi) {
  const b = document.querySelector(`#photoGrid .photo-thumb[data-i="${gi}"]`);
  if (!b) return;
  const d = photoDpi(state.photos[gi]);
  const has = b.querySelector('.w');
  if (d !== null && d < 150 && !has) { const w = document.createElement('span'); w.className = 'w'; w.textContent = '⚠'; b.appendChild(w); }
  if ((d === null || d >= 150) && has) has.remove();
}

function movePhoto(delta) {
  const i = state.sel; const j = i + delta;
  if (i < 0 || j < 0 || j >= state.photos.length) return;
  [state.photos[i], state.photos[j]] = [state.photos[j], state.photos[i]];
  state.sel = j;
  const cap = capacity();
  if (cap) state.sheet = Math.floor(j / cap);
  refreshPhotosUi();
  renderPreview();
}

function removePhoto() {
  const i = state.sel;
  if (i < 0) return;
  state.photos[i].art.revoke();
  state.photos.splice(i, 1);
  state.sel = state.photos.length ? Math.min(i, state.photos.length - 1) : -1;
  const cap = capacity();
  if (cap && state.sel >= 0) state.sheet = Math.floor(state.sel / cap);
  refreshPhotosUi();
  renderPreview();
}

function clearPhotos() {
  if (!state.photos.length) return;
  if (!window.confirm(`Hapus semua ${state.photos.length} foto?`)) return;
  state.photos.forEach((p) => p.art.revoke());
  state.photos = []; state.sel = -1; state.sheet = 0;
  refreshPhotosUi();
  renderPreview();
}

/** Geser (seret 1 jari/mouse), zoom (scroll / cubit 2 jari) langsung pada preview. */
function bindPreviewAdjust() {
  const host = $('previewHost');
  const ptrs = new Map();
  let drag = null;
  let pinch = null;

  const hitOf = (e) => (e.target && e.target.closest ? e.target.closest('.pl-hit') : null);
  const startDrag = (slotIdx, x, y) => {
    const c = slotCtx(slotIdx);
    drag = c ? { slotIdx, x0: x, y0: y, ox0: c.ph.ox, oy0: c.ph.oy } : null;
  };

  // Cegah seleksi teks / drag gambar bawaan browser saat menyeret foto.
  host.addEventListener('mousedown', (e) => { if (hitOf(e)) e.preventDefault(); });
  host.addEventListener('selectstart', (e) => e.preventDefault());
  host.addEventListener('dragstart', (e) => e.preventDefault());

  host.addEventListener('pointerdown', (e) => {
    const hit = hitOf(e);
    if (!hit) return;
    e.preventDefault();
    const slotIdx = +hit.dataset.slot;
    const c = slotCtx(slotIdx);
    if (!c) return;
    if (state.sel !== c.gi) selectPhoto(c.gi);
    try { hit.setPointerCapture(e.pointerId); } catch { /* abaikan */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { startDrag(slotIdx, e.clientX, e.clientY); pinch = null; }
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { slotIdx, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: c.ph.zoom };
      drag = null;
    }
  });

  host.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const c = slotCtx(pinch.slotIdx);
      if (c) setPhotoZoom(c.gi, pinch.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0));
      return;
    }
    if (!drag) return;
    const c = slotCtx(drag.slotIdx);
    const svg = host.querySelector('svg');
    if (!c || !svg) return;
    const k = svg.getBoundingClientRect().width / state.config.paperW; // px per mm di layar
    const dx = (e.clientX - drag.x0) / k;
    const dy = (e.clientY - drag.y0) / k;
    const [du, dv] = c.r ? [dy, -dx] : [dx, dy]; // slot dirotasi 90° CW → balik ke sumbu kartu
    const win = c.tpl.window;
    const g0 = placePhoto(win, c.ph.art.pxW, c.ph.art.pxH, c.ph.zoom, 0.5, 0.5);
    const ovx = g0.w - win.w;
    const ovy = g0.h - win.h;
    if (ovx > 1e-6) c.ph.ox = clampN(drag.ox0 - du / ovx, 0, 1);
    if (ovy > 1e-6) c.ph.oy = clampN(drag.oy0 - dv / ovy, 0, 1);
    applyPhotoGeom(drag.slotIdx);
  });

  const end = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    pinch = null;
    drag = null;
    if (ptrs.size === 1) { // sisa satu jari: lanjutkan geser tanpa lompatan
      const [rest] = [...ptrs.values()];
      if (state.sel >= 0) startDrag(state.sel - state.sheet * capacity(), rest.x, rest.y);
    }
    refreshPhotoEditor();
  };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);

  host.addEventListener('wheel', (e) => {
    const hit = hitOf(e);
    if (!hit) return;
    const c = slotCtx(+hit.dataset.slot);
    if (!c) return;
    e.preventDefault();
    if (state.sel !== c.gi) selectPhoto(c.gi);
    setPhotoZoom(c.gi, c.ph.zoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
}

// ---------- Export ----------
function exportOpts() {
  const o = { artwork: state.artwork, fit: state.fit, showNumbers: $('exportNumbers').checked };
  if (isMulti() && state.photos.length && state.config && state.config.template) {
    o.photos = allPhotoEntries();
    o.sheet = state.sheet;
    o.onProgress = (i, n) => { $('exportMsg').textContent = `Membuat PDF… foto ${i}/${n}`; };
  }
  return o;
}

async function guarded(fn, busyMsg, doneMsg) {
  const msg = $('exportMsg');
  if (state.dirty || !state.layout || !state.validation.valid) { msg.textContent = 'Hitung ulang layout terlebih dahulu.'; return; }
  msg.textContent = busyMsg;
  try {
    const r = await fn();
    msg.textContent = [doneMsg, ...(r && r.notes ? r.notes : [])].join(' ');
  } catch (e) {
    msg.textContent = `Gagal: ${e.message}`;
  }
}

function onPdf() {
  if (!hasArtwork() && !window.confirm('Belum ada artwork yang diunggah. PDF akan berisi placeholder biru muda (hanya untuk simulasi layout). Lanjutkan?')) return;
  guarded(() => exportPdf(state.layout, state.config, exportOpts()), 'Membuat PDF…',
    'PDF diunduh. Cetak dengan Actual Size / 100% (bukan Fit to Page).');
}

// ---------- History ----------
function renderHistory() {
  const list = $('historyList');
  list.innerHTML = '';
  const h = store.loadHistory();
  if (!h.length) {
    const li = document.createElement('li');
    li.className = 'muted small'; li.textContent = 'Belum ada riwayat.';
    list.appendChild(li);
    return;
  }
  h.forEach((e) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const t = document.createElement('span');
    t.className = 't'; t.textContent = new Date(e.t).toLocaleString('id-ID');
    b.appendChild(t); b.appendChild(document.createTextNode(e.text));
    b.addEventListener('click', () => { applyRaw(e.raw); markDirty(); calculate(); });
    li.appendChild(b);
    list.appendChild(li);
  });
}

// ---------- Init ----------
function initPresets() {
  const sel = $('paperPreset');
  PAPER_PRESETS.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.id === 'Custom' ? 'Custom' : `${p.name} (${p.w} × ${p.h} mm)`;
    sel.appendChild(o);
  });
}

function bind() {
  const inputs = ['designW', 'designH', 'designUnit', 'qty', 'paperW', 'paperH', 'gapX', 'gapY', 'mTop', 'mRight', 'mBottom', 'mLeft', 'allowRotation', 'extendedSearch'];
  inputs.forEach((id) => $(id).addEventListener('input', markDirty));
  document.querySelectorAll('input[name="orientation"]').forEach((r) => r.addEventListener('change', markDirty));

  // Template
  $('templateSel').addEventListener('change', () => {
    const next = $('templateSel').value;
    if (!isPoly() && next === 'polaroid2r') state.std = { w: $('designW').value, h: $('designH').value, unit: $('designUnit').value };
    state.template = next;
    migrateArtworkToPhotos();
    applyTemplateUi(); // keluar dari template: pulihkan ukuran desain sebelum markDirty menyimpannya
    markDirty();
  });
  document.querySelectorAll('input[name="cardOrient"]').forEach((r) => r.addEventListener('change', markDirty));
  ['pSide', 'pTop', 'pBottom'].forEach((id) => $(id).addEventListener('input', markDirty));

  $('paperPreset').addEventListener('change', () => {
    const p = PAPER_PRESETS.find((x) => x.id === $('paperPreset').value);
    if (p && p.id !== 'Custom') { $('paperW').value = String(p.w); $('paperH').value = String(p.h); }
    markDirty();
  });
  const toCustom = () => {
    const p = PAPER_PRESETS.find((x) => x.id === $('paperPreset').value);
    if (p && p.id !== 'Custom' && (String(p.w) !== $('paperW').value.trim() || String(p.h) !== $('paperH').value.trim())) $('paperPreset').value = 'Custom';
  };
  $('paperW').addEventListener('input', toCustom);
  $('paperH').addEventListener('input', toCustom);

  $('swapDesign').addEventListener('click', () => {
    const w = $('designW').value; $('designW').value = $('designH').value; $('designH').value = w; markDirty();
  });
  $('swapPaper').addEventListener('click', () => {
    (document.querySelector('input[name="orientation"]:checked').value === 'portrait' ? $('orientLandscape') : $('orientPortrait')).checked = true;
    markDirty();
  });

  $('calcBtn').addEventListener('click', calculate);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'radio') calculate();
  });

  // Artwork
  const dz = $('dropzone');
  const pick = () => $('fileInput').click();
  dz.addEventListener('click', pick);
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  $('replaceBtn').addEventListener('click', pick);
  $('removeBtn').addEventListener('click', removeArtwork);
  $('fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { handleFiles(e.dataTransfer.files); });
  // Cegah browser membuka file bila dilepas di luar dropzone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { if (!dz.contains(e.target)) { e.preventDefault(); if (e.dataTransfer) handleFiles(e.dataTransfer.files); } });
  document.querySelectorAll('input[name="fit"]').forEach((r) => r.addEventListener('change', () => {
    state.fit = document.querySelector('input[name="fit"]:checked').value;
    refreshArtUi(); renderPreview(); persistSettings();
  }));

  // Foto Polaroid
  $('addPhotosBtn').addEventListener('click', pick);
  $('clearPhotosBtn').addEventListener('click', clearPhotos);
  $('photoZoom').addEventListener('input', () => setPhotoZoom(state.sel, Number($('photoZoom').value) / 100));
  $('photoReset').addEventListener('click', () => {
    const ph = state.photos[state.sel];
    if (!ph) return;
    ph.zoom = 1; ph.ox = 0.5; ph.oy = 0.5;
    const cap = capacity();
    if (cap && Math.floor(state.sel / cap) === state.sheet) applyPhotoGeom(state.sel - state.sheet * cap);
    refreshPhotoEditor(); buildPhotoGridBadgeOnly(state.sel);
  });
  $('photoEarlier').addEventListener('click', () => movePhoto(-1));
  $('photoLater').addEventListener('click', () => movePhoto(1));
  $('photoRemove').addEventListener('click', removePhoto);
  $('sheetPrev').addEventListener('click', () => { state.sheet = Math.max(0, state.sheet - 1); renderPreview(); });
  $('sheetNext').addEventListener('click', () => { state.sheet = Math.min(sheetTotal() - 1, state.sheet + 1); renderPreview(); });
  bindPreviewAdjust();

  // Preview controls
  $('zoomIn').addEventListener('click', () => setZoom(state.zoom * 1.25));
  $('zoomOut').addEventListener('click', () => setZoom(state.zoom / 1.25));
  $('zoomFit').addEventListener('click', () => setZoom(1));
  window.addEventListener('resize', applyZoom);
  const tog = (id, key) => $(id).addEventListener('change', () => { state[key] = $(id).checked; renderPreview(); persistSettings(); });
  tog('showNumbers', 'showNumbers'); tog('showMargin', 'showMargin'); tog('showDims', 'showDims');

  // Export
  $('btnPreview').addEventListener('click', () => {
    if (state.dirty || !state.layout) { calculate(); return; }
    renderPreview();
    $('previewWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('btnPdf').addEventListener('click', onPdf);
  $('btnSvg').addEventListener('click', () => guarded(() => exportSvg(state.layout, state.config, exportOpts()), 'Membuat SVG…', 'SVG diunduh (ukuran fisik dalam mm).'));
  $('btnPrint').addEventListener('click', () => guarded(() => printLayout(state.layout, state.config, exportOpts()), 'Menyiapkan cetak…', 'Pilih skala Actual Size / 100% pada dialog cetak.'));

  // Settings tetap tersedia melalui navbar platform. Tema dikelola secara global.
  const dlg = $('settingsDialog');
  $('settingsBtn').addEventListener('click', () => { $('persistArtwork').checked = state.persistArtwork; dlg.showModal(); });
  $('persistArtwork').addEventListener('change', () => {
    state.persistArtwork = $('persistArtwork').checked;
    if (state.persistArtwork && state.artwork) store.saveArtworkBlob(state.artwork.file, state.artwork.name, state.artwork.file.type).catch(() => {});
    if (!state.persistArtwork) store.clearArtworkBlob().catch(() => {});
    persistSettings();
  });
  $('resetSettingsBtn').addEventListener('click', () => {
    store.resetSettings(); applyRaw(DEFAULTS); markDirty(); dlg.close();
  });
  document.querySelectorAll('[data-action="clear-history"]').forEach((b) => b.addEventListener('click', () => { store.clearHistory(); renderHistory(); }));
}

async function init() {
  initPresets();
  const saved = store.loadSettings();
  applyRaw(saved && saved.raw ? saved.raw : DEFAULTS);
  if (saved) {
    state.fit = saved.fit === 'cover' ? 'cover' : 'contain';
    state.showNumbers = saved.showNumbers !== false;
    state.showMargin = saved.showMargin !== false;
    state.showDims = !!saved.showDims;
    state.persistArtwork = !!saved.persistArtwork;
  }
  document.querySelector(`input[name="fit"][value="${state.fit}"]`).checked = true;
  $('showNumbers').checked = state.showNumbers;
  $('showMargin').checked = state.showMargin;
  $('showDims').checked = state.showDims;
  bind();
  updateInfo();
  renderHistory();
  refreshArtUi();

  if (state.persistArtwork) {
    try {
      const rec = await store.loadArtworkBlob();
      if (rec && rec.blob) await setArtwork(new File([rec.blob], rec.name, { type: rec.type }), { silent: true });
    } catch { /* abaikan */ }
    migrateArtworkToPhotos();
    refreshArtUi();
  }
}

init();
