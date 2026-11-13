/**
 * layout-view.js — Tampilan Layout: pengaturan media/margin/spasi, auto layout, editor manual (drag, align, dst.),
 * pratinjau berskala (zoom/pan), thumbnail halaman, panduan & garis potong.
 * Seluruh koordinat dalam MILIMETER; kanvas hanya memetakan mm -> piksel layar.
 */
(function () {
  'use strict';
  const PPS = window.PPS;
  const U = PPS.Util, C = PPS.Config, L = PPS.Layout, R = PPS.Render;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = U.esc;
  const LV = (PPS.LayoutView = {});
  const app = () => PPS.App; const proj = () => PPS.App.project; const ui = () => PPS.UI;
  const ACTUAL = 96 / 25.4; // px CSS per mm pada "Actual size" (referensi tampilan)

  const S = {
    built: false, pageIdx: 0, sel: new Set(), view: { scale: 2, ox: 20, oy: 20 }, undo: [], redo: [], resize: false, pan: false, labels: true,
    issues: [], passes: 0, drag: null, pointers: new Map(), space: false, guides: [], val: null, fitKey: '', dpr: 1, busy: false,
  };

  // ============================================================ util
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setPath = (o, p, v) => { const k = p.split('.'); const last = k.pop(); const t = k.reduce((a, x) => a[x], o); t[last] = v; };
  const page = () => (proj().layout.pages[S.pageIdx] || null);
  const selItems = () => { const pg = page(); return pg ? pg.items.filter((i) => S.sel.has(i.id)) : []; };
  const pageSize = () => C.pageSize(proj().settings);
  const personOf = (it) => proj().persons.find((p) => p.id === it.personId);
  const variantOf = (it) => { const per = personOf(it); return per && per.variants.find((v) => v.id === it.variantId); };
  const clampPage = () => { const n = proj().layout.pages.length; S.pageIdx = Math.max(0, Math.min(S.pageIdx, n - 1)); };

  /** Hapus foto layout yang tidak lagi sesuai data (orang/varian dihapus, jumlah dikurangi), nomori ulang salinan. */
  LV.prune = function (p) {
    p = p || proj(); if (!p) return 0;
    const valid = new Map(); p.persons.forEach((per) => per.variants.forEach((v) => valid.set(v.id, { per, v })));
    const counts = {}; let removed = 0;
    p.layout.pages.forEach((pg) => { pg.items = pg.items.filter((it) => {
      const e = valid.get(it.variantId);
      if (!e || e.per.id !== it.personId || !e.per.photoId) { removed++; return false; }
      counts[it.variantId] = (counts[it.variantId] || 0) + 1;
      if (counts[it.variantId] > e.v.qty) { counts[it.variantId]--; removed++; return false; }
      return true;
    }); });
    const n = {}; p.layout.pages.forEach((pg) => pg.items.forEach((it) => { n[it.variantId] = (n[it.variantId] || 0) + 1; it.copy = n[it.variantId]; }));
    p.layout.pages = p.layout.pages.filter((pg) => pg.items.length);
    if (S.built && p === proj()) { clampPage(); S.sel = new Set(Array.from(S.sel).filter((id) => p.layout.pages.some((pg) => pg.items.some((i) => i.id === id)))); LV.refresh(); }
    return removed;
  };

  const qtyMap = () => { const m = {}; proj().persons.forEach((per) => per.variants.forEach((v) => (m[v.id] = v.qty))); return m; };
  const snapshot = () => JSON.stringify({ layout: proj().layout, q: qtyMap() });
  function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 60) S.undo.shift(); S.redo = []; updateButtons(); }
  function restore(json) {
    const o = JSON.parse(json); const p = proj(); p.layout = o.layout;
    p.persons.forEach((per) => per.variants.forEach((v) => { if (o.q[v.id]) v.qty = o.q[v.id]; }));
    clampPage(); S.sel = new Set(); changed();
  }
  function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); }
  function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); }

  // ============================================================ DOM
  function build() {
    const el = $('#view-layout');
    const num = (path, label, min, max, step = 0.5) => `<label class="lv-f"><span>${label}</span><input type="number" inputmode="decimal" class="form-control form-control-sm" data-set="${path}" min="${min}" max="${max}" step="${step}"></label>`;
    const chk = (path, label) => `<div class="form-check form-switch"><input class="form-check-input" type="checkbox" data-set="${path}" id="c-${path}"><label class="form-check-label small" for="c-${path}">${label}</label></div>`;
    el.innerHTML = `
    <div class="lv">
      <aside class="lv-panel" id="lv-panel">
        <details open><summary>Media cetak</summary>
          <label class="lv-f"><span>Ukuran media</span><select class="form-select form-select-sm" data-set="media.preset">${C.MEDIA.map((m) => `<option value="${m.id}">${m.name}${m.id === 'custom' ? '' : ` — ${m.w}×${m.h} mm`}</option>`).join('')}</select></label>
          <div class="lv-row">${num('media.w', 'Lebar (mm)', 30, 2000, 1)}${num('media.h', 'Tinggi (mm)', 30, 2000, 1)}</div>
          <div class="btn-group btn-group-sm w-100 mt-1" role="group" aria-label="Orientasi"><button type="button" class="btn btn-outline-primary" data-orient="portrait"><i data-lucide="rectangle-vertical"></i> Portrait</button><button type="button" class="btn btn-outline-primary" data-orient="landscape"><i data-lucide="rectangle-horizontal"></i> Landscape</button></div>
        </details>
        <details open><summary>Margin (mm)</summary>
          <div class="lv-row">${num('margins.top', 'Atas', 0, 200)}${num('margins.bottom', 'Bawah', 0, 200)}</div>
          <div class="lv-row">${num('margins.left', 'Kiri', 0, 200)}${num('margins.right', 'Kanan', 0, 200)}</div>
          <div class="form-check form-switch mt-1"><input class="form-check-input" type="checkbox" id="lv-mlock"><label class="form-check-label small" for="lv-mlock">Samakan semua sisi</label></div>
        </details>
        <details open><summary>Spasi &amp; bleed (mm)</summary>
          <div class="lv-row">${num('spacing.h', 'Spasi horizontal', 0, 100)}${num('spacing.v', 'Spasi vertikal', 0, 100)}</div>
          ${num('bleed', 'Bleed (tambahan di tiap foto)', 0, 10, 0.1)}
          <div class="small text-muted">Bleed memperluas gambar di luar garis potong; spasi dihitung antar area bleed.</div>
        </details>
        <details open><summary>Algoritma layout</summary>
          <label class="lv-f"><span>Mode</span><select class="form-select form-select-sm" data-set="layout.mode"><option value="efficiency">A. Maximum Efficiency</option><option value="person">B. Group by Person</option><option value="size">C. Group by Size</option><option value="mixed">D. Mixed Layout</option><option value="manual">E. Manual Layout</option></select></label>
          <div class="small text-muted mb-1" id="lv-modehelp"></div>
          ${chk('layout.allowRotate', 'Izinkan rotasi 90° (hanya memutar, tidak mengubah rasio)')}
          <label class="lv-f mt-1"><span>Prioritas ukuran</span><select class="form-select form-select-sm" data-set="layout.sizePriority"><option value="largest">Terbesar dulu</option><option value="smallest">Terkecil dulu</option></select></label>
          ${chk('layout.pageBreakPerPerson', 'Halaman baru tiap orang (mode Group by Person)')}
          ${chk('layout.backfill', 'Isi ruang kosong halaman sebelumnya (Group by Person/Size)')}
        </details>
        <details><summary>Garis potong</summary>
          <label class="lv-f"><span>Gaya</span><select class="form-select form-select-sm" data-set="marks.style"><option value="none">Tidak ada</option><option value="cut">Garis potong (kotak di tiap foto)</option><option value="crop">Crop marks (tanda sudut tegak lurus)</option><option value="corner">Corner marks (siku di sudut)</option></select></label>
          <div class="lv-row"><label class="lv-f"><span>Warna</span><input type="color" class="form-control form-control-sm form-control-color w-100" data-set="marks.color"></label>${num('marks.width', 'Tebal (mm)', 0.05, 2, 0.05)}</div>
          <div class="lv-row">${num('marks.length', 'Panjang (mm)', 0.5, 20, 0.5)}${num('marks.offset', 'Jarak dari foto (mm)', 0, 10, 0.1)}</div>
          <div class="small text-muted">Garis dipotong otomatis agar tidak menimpa foto lain dan tidak mengubah ukuran foto.</div>
        </details>
        <details><summary>Panduan &amp; snap</summary>
          ${chk('guides.margin', 'Margin guide')}${chk('guides.bleed', 'Bleed guide')}${chk('guides.center', 'Center guide')}${chk('guides.grid', 'Grid guide')}
          ${num('guides.gridSize', 'Ukuran grid (mm)', 1, 100, 1)}
          ${chk('guides.snap', 'Snap ke grid &amp; tepi foto lain')}
          <div class="small text-muted">Panduan hanya tampil di layar, tidak ikut export.</div>
        </details>
      </aside>

      <div class="lv-main">
        <div class="lv-toolbar">
          <div class="btn-group btn-group-sm"><button class="btn btn-primary" id="lv-gen" title="Susun layout dari awal"><i data-lucide="wand-2"></i> <span>Generate Layout</span></button>
            <button class="btn btn-outline-primary" id="lv-arr" title="Pertahankan posisi, tambahkan foto yang belum ada, buang yang berlebih"><i data-lucide="sparkles"></i> <span>Auto Arrange</span></button>
            <button class="btn btn-outline-primary" id="lv-repack" title="Susun ulang semua foto (foto terkunci tetap)"><i data-lucide="refresh-cw"></i> <span>Repack All</span></button>
            <button class="btn btn-outline-danger" id="lv-clear" title="Kosongkan layout"><i data-lucide="eraser"></i> <span>Clear Layout</span></button></div>
          <div class="btn-group btn-group-sm"><button class="btn btn-light" id="lv-undo" title="Undo (Ctrl+Z)"><i data-lucide="undo-2"></i></button><button class="btn btn-light" id="lv-redo" title="Redo (Ctrl+Y)"><i data-lucide="redo-2"></i></button></div>
          <div class="btn-group btn-group-sm"><button class="btn btn-light" id="lv-zout" title="Perkecil"><i data-lucide="zoom-out"></i></button><button class="btn btn-light lv-zv" id="lv-zv" title="Persentase terhadap ukuran nyata (96 dpi)">100%</button><button class="btn btn-light" id="lv-zin" title="Perbesar"><i data-lucide="zoom-in"></i></button><button class="btn btn-light" id="lv-fit" title="Pas layar"><i data-lucide="maximize"></i></button><button class="btn btn-light" id="lv-actual" title="Actual size (referensi tampilan; browser zoom memengaruhi)"><i data-lucide="scan-line"></i> 1:1</button></div>
          <div class="btn-group btn-group-sm"><button class="btn btn-light" id="lv-pan" title="Alat geser (atau tahan Spasi / tombol tengah mouse)"><i data-lucide="hand"></i></button><button class="btn btn-light" id="lv-resizemode" title="Mode resize: ubah ukuran foto terpilih (rasio tetap)"><i data-lucide="scaling"></i></button><button class="btn btn-light active" id="lv-labels" title="Label nama &amp; ukuran"><i data-lucide="tag"></i></button></div>
          <div class="btn-group btn-group-sm ms-auto"><button class="btn btn-light" id="lv-prev" aria-label="Halaman sebelumnya"><i data-lucide="chevron-left"></i></button><span class="btn btn-light disabled lv-pg" id="lv-pg">—</span><button class="btn btn-light" id="lv-next" aria-label="Halaman berikutnya"><i data-lucide="chevron-right"></i></button></div>
        </div>
        <div class="lv-sel" id="lv-sel">
          <span class="small text-muted me-1">Terpilih:</span>
          <div class="btn-group btn-group-sm"><button class="btn btn-light" data-op="rotate" title="Rotate 90° (R)"><i data-lucide="rotate-cw"></i></button><button class="btn btn-light" data-op="dup" title="Duplicate (Ctrl+D) — menambah jumlah cetak"><i data-lucide="copy"></i></button><button class="btn btn-light" data-op="del" title="Hapus dari layout (Del) — mengurangi jumlah cetak"><i data-lucide="trash-2"></i></button><button class="btn btn-light" data-op="lock" title="Kunci / buka posisi (L)"><i data-lucide="lock"></i></button></div>
          <div class="btn-group btn-group-sm"><button class="btn btn-light" data-op="left" title="Rata kiri"><i data-lucide="align-horizontal-justify-start"></i></button><button class="btn btn-light" data-op="centerH" title="Tengah horizontal"><i data-lucide="align-horizontal-justify-center"></i></button><button class="btn btn-light" data-op="right" title="Rata kanan"><i data-lucide="align-horizontal-justify-end"></i></button><button class="btn btn-light" data-op="top" title="Rata atas"><i data-lucide="align-vertical-justify-start"></i></button><button class="btn btn-light" data-op="centerV" title="Tengah vertikal"><i data-lucide="align-vertical-justify-center"></i></button><button class="btn btn-light" data-op="bottom" title="Rata bawah"><i data-lucide="align-vertical-justify-end"></i></button></div>
          <div class="btn-group btn-group-sm"><button class="btn btn-light" data-op="distH" title="Distribusi spasi horizontal (≥3 foto)"><i data-lucide="align-horizontal-space-between"></i></button><button class="btn btn-light" data-op="distV" title="Distribusi spasi vertikal (≥3 foto)"><i data-lucide="align-vertical-space-between"></i></button></div>
          <div class="btn-group btn-group-sm"><button class="btn btn-light" data-op="toprev" title="Pindah ke halaman sebelumnya"><i data-lucide="arrow-left-to-line"></i></button><button class="btn btn-light" data-op="tonext" title="Pindah ke halaman berikutnya"><i data-lucide="arrow-right-to-line"></i></button></div>
          <label class="lv-xy">X <input type="number" step="0.1" id="lv-x" class="form-control form-control-sm"></label><label class="lv-xy">Y <input type="number" step="0.1" id="lv-y" class="form-control form-control-sm"></label>
        </div>
        <div class="lv-alerts" id="lv-alerts"></div>
        <div class="lv-body">
          <div class="lv-canvas-wrap" id="lv-wrap"><canvas id="lv-canvas" aria-label="Pratinjau halaman cetak"></canvas><div class="lv-empty d-none" id="lv-empty"></div></div>
          <div class="lv-thumbs" id="lv-thumbs" aria-label="Thumbnail halaman"></div>
        </div>
        <div class="lv-status" id="lv-status"></div>
      </div>
    </div>`;
  }

  // ============================================================ panel pengaturan
  const MODE_HELP = {
    efficiency: 'Mencoba banyak urutan & heuristik MaxRects untuk jumlah halaman paling sedikit.',
    person: 'Foto satu orang dikelompokkan berdampingan; orang berikutnya mulai setelahnya.',
    size: 'Foto sejenis (ukuran sama) dikelompokkan; ukuran lain menyusul.',
    mixed: 'Semua orang & ukuran dicampur, satu kali packing berurutan menurut prioritas ukuran.',
    manual: 'Disusun baris demi baris sebagai titik awal; atur sendiri dengan drag, align, dll.',
  };
  function syncPanel() {
    const p = proj(); if (!p || !S.built) return; const st = p.settings;
    $$('#lv-panel [data-set]').forEach((el) => { const v = getPath(st, el.dataset.set); if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el) el.value = v; });
    const custom = st.media.preset === 'custom'; $('[data-set="media.w"]').disabled = !custom; $('[data-set="media.h"]').disabled = !custom;
    $$('[data-orient]').forEach((b) => b.classList.toggle('active', b.dataset.orient === st.media.orientation));
    $('#lv-modehelp').textContent = MODE_HELP[st.layout.mode] || '';
    const g = st.layout.mode; $('[data-set="layout.pageBreakPerPerson"]').closest('.form-check').style.display = g === 'person' ? '' : 'none'; $('[data-set="layout.backfill"]').closest('.form-check').style.display = g === 'person' || g === 'size' ? '' : 'none';
  }
  const GEOM = /^(media|margins|spacing|bleed)/;
  function onSet(el) {
    const p = proj(); const st = p.settings; const path = el.dataset.set; let val;
    if (el.type === 'checkbox') val = el.checked; else if (el.type === 'number') {
      val = U.num(el.value, NaN); const min = el.min !== '' ? parseFloat(el.min) : 0, max = el.max !== '' ? parseFloat(el.max) : 1e5;
      if (!Number.isFinite(val) || val < min || val > max) { ui().toast(`Nilai harus berupa angka antara ${min} dan ${max}.`, 'warning'); syncPanel(); return; }
    } else val = el.value;
    if (path === 'media.preset') { const m = C.MEDIA.find((x) => x.id === val); st.media.preset = val; if (m && val !== 'custom') { st.media.w = m.w; st.media.h = m.h; } }
    else if (path === 'media.w' || path === 'media.h') { setPath(st, path, val); st.media.preset = 'custom'; }
    else if (path.startsWith('margins.') && $('#lv-mlock').checked) { ['top', 'bottom', 'left', 'right'].forEach((k) => (st.margins[k] = val)); }
    else setPath(st, path, val);
    if (path === 'margins.top' || path.startsWith('margins.')) { /* batas pemakaian area cetak diperiksa di peringatan */ }
    S.fitKey = S.fitKey; syncPanel(); changed({ geom: GEOM.test(path) });
  }
  function settingsWarnings(st) {
    const w = []; const m = st.margins; const min = C.MIN_SAFE_MARGIN;
    const small = [['atas', m.top], ['bawah', m.bottom], ['kiri', m.left], ['kanan', m.right]].filter(([, v]) => v < min);
    if (small.length) w.push({ level: small.some(([, v]) => v <= 0) ? 'danger' : 'warning', msg: `Margin ${small.map(([n, v]) => n + ' ' + v + ' mm').join(', ')} kurang dari ${min} mm. Sebagian besar printer tidak dapat mencetak sampai tepi kertas; foto di area itu bisa terpotong. Cek area cetak printer Anda.` });
    const u = L.usable(st); if (u.pw <= 0 || u.ph <= 0) w.push({ level: 'danger', msg: 'Margin terlalu besar: tidak ada area cetak tersisa.' });
    const gap = Math.min(st.spacing.h, st.spacing.v) + 2 * (st.bleed || 0);
    if (st.marks.style === 'cut' && gap < st.marks.width + 2 * st.marks.offset + 0.02) w.push({ level: 'warning', msg: `Garis potong (kotak) butuh jarak antar foto ≥ ${U.round(st.marks.width + 2 * st.marks.offset + 0.02)} mm; jarak saat ini ${U.round(gap)} mm — garis akan dirapatkan ke foto.` });
    if ((st.marks.style === 'crop') && gap < st.marks.offset + 0.5) w.push({ level: 'warning', msg: 'Jarak antar foto terlalu sempit untuk crop marks; tanda akan dipendekkan/hilang. Perbesar spasi.' });
    if (st.bleed > 0 && Math.min(st.spacing.h, st.spacing.v) === 0) w.push({ level: 'info', msg: 'Bleed aktif dengan spasi 0: area bleed foto bersebelahan saling menempel.' });
    return w;
  }

  // ============================================================ validasi & peringatan
  function revalidate() { const p = proj(); S.val = p ? L.validate(p) : null; }
  function renderAlerts() {
    const p = proj(); const box = $('#lv-alerts'); if (!p || !box) return; const v = S.val || L.validate(p); const items = [];
    const add = (level, msg, action) => items.push(`<div class="alert alert-${level} py-1 px-2 mb-1 small d-flex align-items-center gap-2"><div class="flex-grow-1">${esc(msg)}</div>${action ? `<button class="btn btn-sm btn-outline-${level === 'danger' ? 'danger' : 'dark'} py-0" data-alert="${action[0]}">${action[1]}</button>` : ''}</div>`);
    const lay = p.layout; const hasPages = lay.pages.length > 0;
    const noPhoto = p.persons.filter((x) => !x.photoId);
    if (noPhoto.length) add('warning', `${noPhoto.length} orang belum punya foto (${noPhoto.slice(0, 3).map((x) => x.name).join(', ')}${noPhoto.length > 3 ? '…' : ''}) — tidak disertakan dalam layout.`);
    if (!hasPages) add('info', 'Belum ada layout. Klik “Generate Layout” untuk menyusun semua foto otomatis.');
    else {
      if (v.stale) add('warning', 'Pengaturan media/margin/spasi/bleed berubah setelah layout dibuat. Susun ulang agar sesuai.', ['repack', 'Repack All']);
      if (v.missing.length) add('warning', `${v.needed - v.placed} foto belum ditempatkan (jumlah cetak bertambah / orang baru).`, ['arrange', 'Auto Arrange']);
      if (v.collisions.size) add('danger', `${v.collisions.size} foto bertabrakan (ditandai merah). Geser agar tidak saling menimpa.`);
      if (v.oob.size) add('danger', `${v.oob.size} foto keluar dari batas media.`);
      if (v.outsideMargin.size) add('warning', `${v.outsideMargin.size} foto berada di dalam area margin (mungkin tidak tercetak oleh printer).`);
    }
    S.issues.forEach((i) => add(i.level === 'error' ? 'danger' : i.level === 'info' ? 'info' : 'warning', i.msg));
    settingsWarnings(p.settings).forEach((w) => add(w.level, w.msg));
    box.innerHTML = items.join(''); box.classList.toggle('d-none', !items.length);
  }

  // ============================================================ status & tombol
  function updateButtons() {
    $('#lv-undo').disabled = !S.undo.length; $('#lv-redo').disabled = !S.redo.length;
    $('#lv-pan').classList.toggle('active', S.pan); $('#lv-resizemode').classList.toggle('active', S.resize); $('#lv-labels').classList.toggle('active', S.labels);
    const n = proj().layout.pages.length; $('#lv-pg').textContent = n ? `Hal. ${S.pageIdx + 1} / ${n}` : 'Tidak ada halaman';
    $('#lv-prev').disabled = S.pageIdx <= 0; $('#lv-next').disabled = S.pageIdx >= n - 1; $('#lv-zv').textContent = Math.round((S.view.scale / ACTUAL) * 100) + '%';
    const sel = selItems(); $$('#lv-sel [data-op]').forEach((b) => { const op = b.dataset.op; b.disabled = !sel.length || (op === 'distH' || op === 'distV' ? sel.length < 3 : false); });
    const one = sel.length === 1 ? sel[0] : null; $('#lv-x').disabled = $('#lv-y').disabled = !one; $('#lv-x').value = one ? U.round(one.x) : ''; $('#lv-y').value = one ? U.round(one.y) : '';
    const lockBtn = $('[data-op="lock"] i, [data-op="lock"] svg'); if (lockBtn) { /* ikon tetap */ }
  }
  function renderStatus() {
    const p = proj(); const pg = page(); const v = S.val; if (!pg) { $('#lv-status').textContent = 'Tidak ada layout.'; return; }
    const u = L.utilization(p)[S.pageIdx] || 0; const sel = selItems(); const parts = [`Halaman ${S.pageIdx + 1}/${p.layout.pages.length}`, `${pg.items.length} foto`, `${Math.round(u * 100)}% area cetak terpakai`];
    if (v && v.collisions.size) parts.push(`${v.collisions.size} tabrakan`);
    let sx = ''; if (sel.length === 1) { const it = sel[0]; const per = personOf(it), vr = variantOf(it); const std = vr ? (it.rot ? vr.h : vr.w) : it.w; sx = ` • <b>${esc(per ? per.name : '?')}</b> — ${esc(vr ? vr.name : '?')} (${U.mm(U.round(it.w))}×${U.mm(U.round(it.h))} mm${Math.abs(std - it.w) > 0.05 ? ', ukuran diubah' : ''}) @ ${U.mm(U.round(it.x))}, ${U.mm(U.round(it.y))} mm${it.rot ? ' • diputar 90°' : ''}${it.locked ? ' • terkunci' : ''}`; }
    else if (sel.length > 1) sx = ` • ${sel.length} foto dipilih`;
    $('#lv-status').innerHTML = parts.join(' • ') + sx;
  }
  const buildThumbs = U.debounce(async () => {
    const p = proj(); const box = $('#lv-thumbs'); if (!p || !box || app().view !== 'layout') return; const n = p.layout.pages.length;
    box.innerHTML = p.layout.pages.map((pg, i) => `<button class="lv-thumb ${i === S.pageIdx ? 'active' : ''}" data-i="${i}" aria-label="Halaman ${i + 1}"><img alt="" data-ti="${i}"><span>${i + 1} • ${pg.items.length}</span></button>`).join('');
    for (let i = 0; i < n; i++) { try { const url = await R.thumb(p, i, 150); const img = box.querySelector(`[data-ti="${i}"]`); if (img) img.src = url; } catch (e) { /* thumbnail opsional */ } }
  }, 500);
  function changed(o = {}) {
    revalidate(); clampPage(); updateButtons(); renderAlerts(); renderStatus(); LV.draw(); buildThumbs();
    app().touch({ layout: true }); if (o.geom && S.val && S.val.stale) { /* peringatan stale sudah tampil */ }
  }
  LV.refresh = function () { if (!S.built || !proj()) return; syncPanel(); revalidate(); clampPage(); updateButtons(); renderAlerts(); renderStatus(); if (app().view === 'layout') { LV.draw(); buildThumbs(); } };
  LV.onProjectChanged = function () { S.sel = new Set(); S.undo = []; S.redo = []; S.pageIdx = 0; S.issues = []; S.fitKey = ''; if (S.built) { syncPanel(); revalidate(); } };

  // ============================================================ kanvas
  const quant = (k) => [2, 3, 4, 6, 8, 12, 16, 24, 32].find((q) => q >= k) || 32;
  function resizeCanvas() {
    const wrap = $('#lv-wrap'); const r = wrap.getBoundingClientRect(); S.dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.cv.width = Math.max(50, Math.round(r.width * S.dpr)); S.cv.height = Math.max(50, Math.round(r.height * S.dpr)); S.cw = r.width; S.ch = r.height;
  }
  LV.fit = function () { S.userView = false; const pg = pageSize(); const k = Math.min((S.cw - 32) / pg.w, (S.ch - 32) / pg.h); S.view.scale = Math.max(0.3, k); S.view.ox = (S.cw - pg.w * S.view.scale) / 2; S.view.oy = (S.ch - pg.h * S.view.scale) / 2; updateButtons(); LV.draw(); };
  function zoomAt(f, cx, cy) { S.userView = true; const V = S.view; const ns = U.clamp(V.scale * f, 0.3, 80); const k = ns / V.scale; V.ox = cx - (cx - V.ox) * k; V.oy = cy - (cy - V.oy) * k; V.scale = ns; updateButtons(); LV.draw(); }
  LV.show = function () {
    if (!S.built) return; const p = proj(); if (!p) return;
    syncPanel(); resizeCanvas(); revalidate(); clampPage(); const pg = pageSize(); const key = pg.w + 'x' + pg.h;
    if (S.fitKey !== key) { S.fitKey = key; LV.fit(); }
    updateButtons(); renderAlerts(); renderStatus(); LV.draw(); buildThumbs(); ui().icons();
  };

  LV.draw = function (user = true) {
    if (!S.built || !proj() || app().view !== 'layout' || !S.cv || !S.cw) return; if (user) S.passes = 0;
    const p = proj(); const st = p.settings; const cv = S.cv; const ctx = cv.getContext('2d'); const dpr = S.dpr; const pg = pageSize(); const V = S.view; const k = V.scale * dpr;
    const X = (mm) => (V.ox + mm * V.scale) * dpr, Y = (mm) => (V.oy + mm * V.scale) * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#e6e9f2'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.save(); ctx.shadowColor = 'rgba(15,27,61,.28)'; ctx.shadowBlur = 16 * dpr; ctx.shadowOffsetY = 3 * dpr; ctx.fillStyle = '#fff'; ctx.fillRect(X(0), Y(0), pg.w * k, pg.h * k); ctx.restore();
    const pgData = page();
    if (pgData) {
      const maxMm = Math.max(40, ...pgData.items.map((i) => Math.max(i.w, i.h))); const s0 = Math.min(quant(k), Math.max(1.5, 2200 / maxMm)); const f = k / s0;
      ctx.save(); ctx.translate(X(0), Y(0)); ctx.scale(f, f);
      R.paintSync(ctx, p, pgData, s0, { minLine: 1 / f, onLoaded: () => { if (S.passes++ < 6) LV.draw(false); } });
      ctx.restore();
    }
    // --- panduan ---
    const u = L.usable(st); const g = st.guides; const v = S.val;
    ctx.save(); ctx.lineWidth = dpr;
    if (g.grid && g.gridSize * V.scale > 4) { ctx.strokeStyle = 'rgba(100,116,139,.28)'; ctx.beginPath(); for (let x = g.gridSize; x < pg.w; x += g.gridSize) { ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(pg.h)); } for (let y = g.gridSize; y < pg.h; y += g.gridSize) { ctx.moveTo(X(0), Y(y)); ctx.lineTo(X(pg.w), Y(y)); } ctx.stroke(); }
    if (g.margin) { ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(124,58,237,.75)'; ctx.strokeRect(X(u.x0), Y(u.y0), u.pw * k, u.ph * k); }
    if (g.center) { ctx.setLineDash([2 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(6,182,212,.9)'; ctx.beginPath(); ctx.moveTo(X(pg.w / 2), Y(0)); ctx.lineTo(X(pg.w / 2), Y(pg.h)); ctx.moveTo(X(0), Y(pg.h / 2)); ctx.lineTo(X(pg.w), Y(pg.h / 2)); ctx.stroke(); }
    ctx.setLineDash([]);
    if (pgData) {
      pgData.items.forEach((it) => {
        const x = X(it.x), y = Y(it.y), w = it.w * k, h = it.h * k; const col = v && v.collisions.has(it.id), oob = v && v.oob.has(it.id), mar = v && v.outsideMargin.has(it.id); const sel = S.sel.has(it.id);
        if (g.bleed && st.bleed > 0) { ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.strokeStyle = 'rgba(239,68,68,.85)'; ctx.strokeRect(X(it.x - st.bleed), Y(it.y - st.bleed), (it.w + 2 * st.bleed) * k, (it.h + 2 * st.bleed) * k); ctx.setLineDash([]); }
        ctx.strokeStyle = 'rgba(15,27,61,.28)'; ctx.lineWidth = dpr; ctx.strokeRect(x, y, w, h);
        if (col || oob) { ctx.fillStyle = 'rgba(220,38,38,.16)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2 * dpr; ctx.strokeRect(x, y, w, h); }
        else if (mar) { ctx.setLineDash([5 * dpr, 3 * dpr]); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(x, y, w, h); ctx.setLineDash([]); }
        if (sel) { ctx.strokeStyle = '#0e8c76'; ctx.lineWidth = 2.5 * dpr; ctx.strokeRect(x, y, w, h); }
        if (S.labels && w > 60 * dpr && h > 26 * dpr) {
          const per = personOf(it), vr = variantOf(it); const txt = `${per ? per.name : '?'} · ${vr ? vr.name : ''}`; ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
          ctx.font = `600 ${10 * dpr}px "DM Sans", sans-serif`; ctx.fillStyle = 'rgba(15,27,61,.72)'; ctx.fillRect(x, y, w, 15 * dpr); ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x + 4 * dpr, y + 8 * dpr); ctx.restore();
        }
        if (it.locked) { ctx.fillStyle = '#0f1b3d'; ctx.beginPath(); ctx.arc(x + w - 9 * dpr, y + h - 9 * dpr, 7 * dpr, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = `${9 * dpr}px sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText('L', x + w - 9 * dpr, y + h - 8.5 * dpr); ctx.textAlign = 'left'; }
      });
      const sel = selItems(); if (sel.length > 1) { const b = L.bbox(sel); ctx.setLineDash([5 * dpr, 3 * dpr]); ctx.strokeStyle = '#0e8c76'; ctx.lineWidth = dpr; ctx.strokeRect(X(b.x1), Y(b.y1), (b.x2 - b.x1) * k, (b.y2 - b.y1) * k); ctx.setLineDash([]); }
      if (S.resize && sel.length === 1 && !sel[0].locked) handles(sel[0]).forEach((hh) => { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0e8c76'; ctx.lineWidth = 2 * dpr; const sz = 9 * dpr; ctx.fillRect(X(hh.x) - sz / 2, Y(hh.y) - sz / 2, sz, sz); ctx.strokeRect(X(hh.x) - sz / 2, Y(hh.y) - sz / 2, sz, sz); });
    }
    if (S.guides.length) { ctx.strokeStyle = '#ec4899'; ctx.lineWidth = dpr; ctx.beginPath(); S.guides.forEach((gd) => { if (gd.axis === 'x') { ctx.moveTo(X(gd.pos), Y(0)); ctx.lineTo(X(gd.pos), Y(pg.h)); } else { ctx.moveTo(X(0), Y(gd.pos)); ctx.lineTo(X(pg.w), Y(gd.pos)); } }); ctx.stroke(); }
    ctx.restore();
    const emp = $('#lv-empty'); emp.classList.toggle('d-none', !!pgData); if (!pgData) emp.innerHTML = '<i data-lucide="layout-grid"></i><div class="fw-semibold">Belum ada layout</div><div class="small">Klik <b>Generate Layout</b></div>';
  };
  const handles = (it) => [{ x: it.x, y: it.y, c: 0 }, { x: it.x + it.w, y: it.y, c: 1 }, { x: it.x, y: it.y + it.h, c: 2 }, { x: it.x + it.w, y: it.y + it.h, c: 3 }];

  // ============================================================ interaksi kanvas
  const mmOf = (e) => { const r = S.cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; return { x, y, mx: (x - S.view.ox) / S.view.scale, my: (y - S.view.oy) / S.view.scale }; };
  function itemAt(mx, my) { const pg = page(); if (!pg) return null; for (let i = pg.items.length - 1; i >= 0; i--) { const it = pg.items[i]; if (mx >= it.x && mx <= it.x + it.w && my >= it.y && my <= it.y + it.h) return it; } return null; }
  function handleAt(pt) { const sel = selItems(); if (!S.resize || sel.length !== 1 || sel[0].locked) return null; for (const h of handles(sel[0])) { if (Math.hypot(S.view.ox + h.x * S.view.scale - pt.x, S.view.oy + h.y * S.view.scale - pt.y) < 10) return h; } return null; }

  function onDown(e) {
    S.cv.setPointerCapture(e.pointerId); const pt = mmOf(e); S.pointers.set(e.pointerId, pt);
    if (S.pointers.size === 2) { S.drag = { type: 'pinch' }; S.pinch = null; return; }
    if (e.button === 1 || S.space || S.pan) { S.drag = { type: 'pan', last: pt }; S.cv.style.cursor = 'grabbing'; return; }
    const h = handleAt(pt);
    if (h) { const it = selItems()[0]; pushUndo(); const opp = handles(it)[3 - h.c]; S.drag = { type: 'resize', it, opp, asp: it.h / it.w, moved: false, h }; return; }
    const it = itemAt(pt.mx, pt.my);
    if (it) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { if (S.sel.has(it.id)) S.sel.delete(it.id); else S.sel.add(it.id); }
      else if (!S.sel.has(it.id)) S.sel = new Set([it.id]);
      const movers = selItems().filter((i) => !i.locked);
      S.drag = { type: 'move', start: pt, orig: new Map(movers.map((i) => [i.id, { x: i.x, y: i.y }])), items: movers, moved: false, bbox: movers.length ? L.bbox(movers) : null, undoDone: false };
      if (!movers.length) ui().toast('Foto terkunci — buka kunci (L) untuk memindahkan.', 'info', 1800);
      updateButtons(); renderStatus(); LV.draw(); return;
    }
    if (!(e.shiftKey)) S.sel = new Set(); S.drag = { type: 'pan', last: pt, click: true }; updateButtons(); renderStatus(); LV.draw();
  }
  function snapMove(d, nx, ny) {
    const st = proj().settings; const g = st.guides; const bw = d.bbox.x2 - d.bbox.x1, bh = d.bbox.y2 - d.bbox.y1; const pg = pageSize(); S.guides = [];
    if (g.snap) {
      if (g.gridSize > 0) { nx = Math.round(nx / g.gridSize) * g.gridSize; ny = Math.round(ny / g.gridSize) * g.gridSize; }
      const thr = 6 / S.view.scale; const u = L.usable(st); const others = page().items.filter((i) => !S.sel.has(i.id));
      const xs = [u.x0, u.x0 + u.pw, pg.w / 2], ys = [u.y0, u.y0 + u.ph, pg.h / 2]; others.forEach((o) => { xs.push(o.x, o.x + o.w, o.x + o.w / 2); ys.push(o.y, o.y + o.h, o.y + o.h / 2); });
      const best = (lines, pos, len) => { let bd = thr, adj = 0, at = null; for (const q of lines) for (const off of [0, len / 2, len]) { const diff = q - (pos + off); if (Math.abs(diff) < bd) { bd = Math.abs(diff); adj = diff; at = q; } } return at == null ? null : { adj, at }; };
      const bx = best(xs, nx, bw), by = best(ys, ny, bh); if (bx) { nx += bx.adj; S.guides.push({ axis: 'x', pos: bx.at }); } if (by) { ny += by.adj; S.guides.push({ axis: 'y', pos: by.at }); }
    }
    return { nx: U.clamp(nx, 0, pg.w - bw), ny: U.clamp(ny, 0, pg.h - bh) };
  }
  function onMove(e) {
    const pt = mmOf(e); const d = S.drag;
    if (S.pointers.has(e.pointerId)) S.pointers.set(e.pointerId, pt);
    if (!d) { S.cv.style.cursor = (S.pan || S.space) ? 'grab' : handleAt(pt) ? 'nwse-resize' : itemAt(pt.mx, pt.my) ? 'move' : 'default'; return; }
    if (d.type === 'pinch') { if (S.pointers.size < 2) return; const [a, b] = Array.from(S.pointers.values()); const dist = Math.hypot(a.x - b.x, a.y - b.y); const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2; if (S.pinch) { zoomAt(dist / S.pinch.d, cx, cy); S.view.ox += cx - S.pinch.cx; S.view.oy += cy - S.pinch.cy; LV.draw(); } S.pinch = { d: dist, cx, cy }; return; }
    if (d.type === 'pan') { S.userView = true; S.view.ox += pt.x - d.last.x; S.view.oy += pt.y - d.last.y; d.last = pt; if (Math.abs(pt.x - d.last.x) > 0) d.click = false; LV.draw(); return; }
    if (d.type === 'move' && d.bbox) {
      const dx = pt.mx - d.start.mx, dy = pt.my - d.start.my; if (!d.moved && Math.hypot(dx, dy) * S.view.scale < 3) return;
      if (!d.moved) { d.moved = true; pushUndo(); d.undoDone = true; }
      const { nx, ny } = snapMove(d, d.bbox.x1 + dx, d.bbox.y1 + dy); d.items.forEach((i) => { const o = d.orig.get(i.id); i.x = U.round(o.x + (nx - d.bbox.x1), 3); i.y = U.round(o.y + (ny - d.bbox.y1), 3); });
      LV.draw(false); renderStatus(); return;
    }
    if (d.type === 'resize') {
      const it = d.it; const pg = pageSize(); const ox = d.opp.x, oy = d.opp.y; let w = Math.abs(pt.mx - ox); w = Math.max(5, Math.min(w, pg.w, pg.h / d.asp)); const h = w * d.asp;
      const right = d.h.c === 1 || d.h.c === 3, bottom = d.h.c === 2 || d.h.c === 3; it.w = U.round(w, 3); it.h = U.round(h, 3); it.x = U.round(right ? ox : ox - w, 3); it.y = U.round(bottom ? oy : oy - h, 3);
      it.x = U.clamp(it.x, 0, pg.w - it.w); it.y = U.clamp(it.y, 0, pg.h - it.h); d.moved = true; LV.draw(false); renderStatus();
    }
  }
  function onUp(e) {
    S.pointers.delete(e.pointerId); const d = S.drag; if (S.pointers.size) return; S.drag = null; S.guides = []; S.pinch = null; S.cv.style.cursor = S.pan || S.space ? 'grab' : 'default';
    if (!d) return;
    if (d.type === 'move' && d.moved) { changed(); notifyCollision(); }
    else if (d.type === 'resize' && d.moved) { changed(); notifyCollision(); }
    else LV.draw();
  }
  function notifyCollision() { const v = S.val; if (v && v.collisions.size) ui().toast(`Peringatan: ${v.collisions.size} foto bertabrakan (ditandai merah).`, 'warning', 2600); else if (v && v.oob.size) ui().toast('Peringatan: ada foto di luar batas media.', 'warning', 2600); }

  // ============================================================ operasi pada foto terpilih
  function op(name) {
    const p = proj(); const sel = selItems(); if (!sel.length) return; const pg = pageSize(); const st = p.settings; const u = L.usable(st);
    if (name === 'rotate') { pushUndo(); sel.forEach((it) => { if (it.locked) return; const cx = it.x + it.w / 2, cy = it.y + it.h / 2; [it.w, it.h] = [it.h, it.w]; it.rot = !it.rot; it.x = U.clamp(U.round(cx - it.w / 2, 3), 0, Math.max(0, pg.w - it.w)); it.y = U.clamp(U.round(cy - it.h / 2, 3), 0, Math.max(0, pg.h - it.h)); }); }
    else if (name === 'dup') {
      pushUndo(); const added = [];
      sel.forEach((it) => {
        const v = variantOf(it); if (!v) return; if (v.qty >= 999) { ui().toast('Jumlah cetak maksimal 999.', 'warning'); return; } v.qty++;
        const n = page().items.filter((x) => x.variantId === it.variantId).length + 1;
        const c = Object.assign({}, it, { id: 'it_' + U.uid('d'), copy: n, locked: false, x: U.clamp(it.x + 3, 0, pg.w - it.w), y: U.clamp(it.y + 3, 0, pg.h - it.h) }); page().items.push(c); added.push(c.id);
      });
      if (added.length) { S.sel = new Set(added); LV.prune(); ui().toast('Foto diduplikasi — jumlah cetak bertambah. Periksa tabrakan, lalu geser ke ruang kosong.', 'info', 3200); }
    }
    else if (name === 'del') {
      const per = {}; sel.forEach((it) => (per[it.variantId] = (per[it.variantId] || 0) + 1)); const refuse = []; const del = new Set();
      sel.forEach((it) => { const v = variantOf(it); if (!v) { del.add(it.id); return; } const left = v.qty - (per[it.variantId] || 0); if (left < 1) { if (!refuse.includes(v.name)) refuse.push(v.name); } else del.add(it.id); });
      if (refuse.length) ui().toast(`Jumlah cetak minimal 1. Untuk membuang ukuran ${refuse.join(', ')} seluruhnya, hapus ukuran tersebut dari daftar orang.`, 'warning', 5000);
      if (!del.size) return; pushUndo(); const cnt = {}; sel.filter((i) => del.has(i.id)).forEach((i) => (cnt[i.variantId] = (cnt[i.variantId] || 0) + 1));
      Object.keys(cnt).forEach((vid) => { const v = p.persons.flatMap((x) => x.variants).find((x) => x.id === vid); if (v) v.qty -= cnt[vid]; });
      page().items = page().items.filter((i) => !del.has(i.id)); S.sel = new Set(); LV.prune();
    }
    else if (name === 'lock') { pushUndo(); const lock = sel.some((i) => !i.locked); sel.forEach((i) => (i.locked = lock)); }
    else if (['left', 'right', 'top', 'bottom', 'centerH', 'centerV'].includes(name)) { pushUndo(); const ref = sel.length > 1 ? null : { x1: u.x0, y1: u.y0, x2: u.x0 + u.pw, y2: u.y0 + u.ph }; L.align(sel, name, ref); sel.forEach((i) => { i.x = U.clamp(U.round(i.x, 3), 0, pg.w - i.w); i.y = U.clamp(U.round(i.y, 3), 0, pg.h - i.h); }); }
    else if (name === 'distH' || name === 'distV') { if (sel.length < 3) { ui().toast('Distribusi spasi membutuhkan minimal 3 foto.', 'warning'); return; } pushUndo(); L.distribute(sel, name === 'distH' ? 'h' : 'v'); }
    else if (name === 'toprev' || name === 'tonext') {
      const to = S.pageIdx + (name === 'tonext' ? 1 : -1); if (to < 0) { ui().toast('Ini halaman pertama.', 'info'); return; }
      pushUndo(); const movers = sel.filter((i) => !i.locked); if (!movers.length) return;
      if (to >= p.layout.pages.length) p.layout.pages.push({ id: 'pg_' + U.uid('p'), items: [] });
      const ids = new Set(movers.map((i) => i.id)); page().items = page().items.filter((i) => !ids.has(i.id)); p.layout.pages[to].items.push(...movers);
      S.pageIdx = to; LV.prune(); S.sel = new Set(ids); S.pageIdx = Math.min(to, p.layout.pages.length - 1);
    }
    changed(); if (name !== 'rotate' && name !== 'lock') notifyCollision();
  }

  // ============================================================ generate / arrange
  async function generate(kind) {
    const p = proj(); const A = app(); if (S.busy) return;
    const ready = p.persons.filter((x) => x.photoId && x.variants.length);
    if (!ready.length) { ui().toast('Tidak bisa membuat layout: belum ada orang yang punya foto dan ukuran. Unggah foto di menu “Orang & Foto”.', 'warning', 6000); return; }
    if (kind === 'clear') {
      if (!p.layout.pages.length) { ui().toast('Layout sudah kosong.', 'info'); return; }
      if (!(await ui().confirm('Kosongkan seluruh layout? (Foto, jumlah cetak, dan crop tidak dihapus.)', { okText: 'Clear Layout', danger: true }))) return;
      pushUndo(); p.layout = { pages: [], generatedAt: 0, sig: '' }; S.sel = new Set(); S.issues = []; S.pageIdx = 0; changed(); return;
    }
    if (kind === 'fresh' && p.layout.pages.length && !(await ui().confirm('Layout yang ada (termasuk posisi manual dan kunci) akan diganti dengan susunan baru dari awal. Lanjutkan?', { okText: 'Generate ulang' }))) return;
    if (kind === 'repack' && !p.layout.pages.length) kind = 'fresh';
    S.busy = true; $$('#lv-gen,#lv-arr,#lv-repack,#lv-clear').forEach((b) => (b.disabled = true)); ui().toast('Menyusun layout…', 'info', 1200); await U.yieldUI(); await U.sleep(30);
    let res;
    try {
      pushUndo(); LV.prune(p);
      if (kind === 'fresh') res = L.generate(p, {});
      else if (kind === 'repack') res = L.generate(p, { keepLocked: true });
      else {
        if (!p.layout.pages.length) res = L.generate(p, {});
        else { // pertahankan semua posisi saat ini; tambahkan yang belum ada ke ruang kosong
          const orig = new Set(); p.layout.pages.forEach((pg) => pg.items.forEach((i) => i.locked && orig.add(i.id)));
          const clone = Object.assign({}, p, { layout: U.deepClone(p.layout) }); clone.layout.pages.forEach((pg) => pg.items.forEach((i) => (i.locked = true)));
          res = L.generate(clone, { keepLocked: true, mode: p.settings.layout.mode === 'manual' ? 'mixed' : p.settings.layout.mode });
          if (!res.error) res.layout.pages.forEach((pg) => pg.items.forEach((i) => (i.locked = orig.has(i.id))));
        }
      }
    } catch (err) { res = { error: 'Terjadi galat saat menyusun layout: ' + (err.message || err) }; }
    S.busy = false; $$('#lv-gen,#lv-arr,#lv-repack,#lv-clear').forEach((b) => (b.disabled = false));
    if (res.error) { S.undo.pop(); updateButtons(); ui().toast(res.error, 'danger', 8000); return; }
    p.layout = res.layout; S.issues = res.issues || []; S.sel = new Set(); S.pageIdx = Math.min(S.pageIdx, Math.max(0, p.layout.pages.length - 1)); if (kind === 'fresh') S.pageIdx = 0;
    changed({ geom: true });
    const total = p.layout.pages.reduce((a, pg) => a + pg.items.length, 0); const util = L.utilization(p); const avg = util.length ? util.reduce((a, b) => a + b, 0) / util.length : 0;
    if (res.unplaced.length) ui().toast(`${res.unplaced.length} foto TIDAK muat dan dilewati. Lihat peringatan merah untuk penyebabnya.`, 'danger', 9000);
    else ui().toast(`Layout selesai: ${p.layout.pages.length} halaman, ${total} foto, rata-rata ${Math.round(avg * 100)}% area terpakai.`, 'success');
    if (kind === 'fresh') A.save('Layout dibuat').catch(() => {});
  }

  // ============================================================ init
  LV.init = function () {
    build(); S.built = true; S.cv = $('#lv-canvas'); S.cv.style.touchAction = 'none';
    const panel = $('#lv-panel');
    panel.addEventListener('change', (e) => { if (e.target.dataset.set) onSet(e.target); });
    panel.addEventListener('input', (e) => { if (e.target.type === 'color' && e.target.dataset.set) onSet(e.target); });
    panel.addEventListener('click', (e) => { const b = e.target.closest('[data-orient]'); if (b) { proj().settings.media.orientation = b.dataset.orient; syncPanel(); S.fitKey = ''; changed({ geom: true }); LV.show(); } });
    $('#lv-gen').onclick = () => generate('fresh'); $('#lv-arr').onclick = () => generate('arrange'); $('#lv-repack').onclick = () => generate('repack'); $('#lv-clear').onclick = () => generate('clear');
    $('#lv-undo').onclick = undo; $('#lv-redo').onclick = redo;
    $('#lv-zin').onclick = () => zoomAt(1.25, S.cw / 2, S.ch / 2); $('#lv-zout').onclick = () => zoomAt(0.8, S.cw / 2, S.ch / 2); $('#lv-fit').onclick = () => LV.fit();
    $('#lv-actual').onclick = () => { const pg = pageSize(); S.view.scale = ACTUAL; S.view.ox = (S.cw - pg.w * ACTUAL) / 2; S.view.oy = Math.max(10, (S.ch - pg.h * ACTUAL) / 2); updateButtons(); LV.draw(); ui().toast('Actual size = 96 dpi CSS (referensi saja; zoom browser/monitor memengaruhi). Gunakan Export PDF untuk ukuran fisik presisi.', 'info', 4500); };
    $('#lv-pan').onclick = () => { S.pan = !S.pan; updateButtons(); }; $('#lv-resizemode').onclick = () => { S.resize = !S.resize; if (S.resize) ui().toast('Mode resize aktif: tarik pegangan di sudut foto terpilih (rasio tetap).', 'info', 3000); updateButtons(); LV.draw(); }; $('#lv-labels').onclick = () => { S.labels = !S.labels; updateButtons(); LV.draw(); };
    $('#lv-prev').onclick = () => { if (S.pageIdx > 0) { S.pageIdx--; S.sel = new Set(); changed(); } }; $('#lv-next').onclick = () => { if (S.pageIdx < proj().layout.pages.length - 1) { S.pageIdx++; S.sel = new Set(); changed(); } };
    $('#lv-sel').addEventListener('click', (e) => { const b = e.target.closest('[data-op]'); if (b) op(b.dataset.op); });
    const xy = (axis) => () => { const it = selItems()[0]; if (!it || it.locked) { updateButtons(); return; } const v = U.num($(axis === 'x' ? '#lv-x' : '#lv-y').value, NaN); if (!Number.isFinite(v)) { updateButtons(); return; } pushUndo(); const pg = pageSize(); if (axis === 'x') it.x = U.clamp(v, 0, pg.w - it.w); else it.y = U.clamp(v, 0, pg.h - it.h); changed(); notifyCollision(); };
    $('#lv-x').onchange = xy('x'); $('#lv-y').onchange = xy('y');
    $('#lv-alerts').addEventListener('click', (e) => { const b = e.target.closest('[data-alert]'); if (b) generate(b.dataset.alert); });
    $('#lv-thumbs').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { S.pageIdx = +b.dataset.i; S.sel = new Set(); changed(); } });
    const cv = S.cv; cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const pt = mmOf(e); zoomAt(Math.exp(-e.deltaY * 0.0015), pt.x, pt.y); }, { passive: false });
    cv.addEventListener('dblclick', () => LV.fit());
    new ResizeObserver(() => { if (app().view === 'layout') { resizeCanvas(); if (!S.userView) LV.fit(); else LV.draw(); } }).observe($('#lv-wrap'));
    document.addEventListener('keydown', (e) => {
      if (app().view !== 'layout' || /input|textarea|select/i.test(e.target.tagName) || $('.modal.show')) return;
      if (e.code === 'Space') { S.space = true; S.cv.style.cursor = 'grab'; e.preventDefault(); return; }
      const k = e.key.toLowerCase(); const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } else if (ctrl && k === 'y') { e.preventDefault(); redo(); }
      else if (ctrl && k === 'a') { e.preventDefault(); const pg = page(); if (pg) { S.sel = new Set(pg.items.map((i) => i.id)); updateButtons(); renderStatus(); LV.draw(); } }
      else if (ctrl && k === 'd') { e.preventDefault(); op('dup'); }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); op('del'); } else if (k === 'r' && !ctrl) op('rotate'); else if (k === 'l' && !ctrl) op('lock');
      else if (k === 'escape') { S.sel = new Set(); updateButtons(); renderStatus(); LV.draw(); }
      else if (k.startsWith('arrow')) {
        const sel = selItems().filter((i) => !i.locked); if (!sel.length) return; e.preventDefault(); const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 0.5; const pg = pageSize();
        pushUndo(); const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0; const b = L.bbox(sel);
        const ax = U.clamp(dx, -b.x1, pg.w - b.x2), ay = U.clamp(dy, -b.y1, pg.h - b.y2); sel.forEach((i) => { i.x = U.round(i.x + ax, 3); i.y = U.round(i.y + ay, 3); }); changed();
      }
    });
    document.addEventListener('keyup', (e) => { if (e.code === 'Space') { S.space = false; S.cv.style.cursor = S.pan ? 'grab' : 'default'; } });
    window.addEventListener('beforeprint', () => {}); ui().icons();
  };
})();
