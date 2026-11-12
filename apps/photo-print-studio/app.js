/**
 * app.js — Aplikasi utama: navigasi, proyek, orang & foto, crop, rekap, export, pengaturan.
 * Tampilan Layout ada di layout-view.js. Semua data tersimpan lokal (IndexedDB / LocalStorage).
 */
(function () {
  'use strict';
  const PPS = window.PPS;
  const U = PPS.Util, C = PPS.Config, S = PPS.Storage, IM = PPS.Imaging, L = PPS.Layout;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = U.esc;

  // ====================================================================== UI helper
  const UI = (PPS.UI = {
    icons() { try { if (window.lucide) window.lucide.createIcons(); } catch (e) { /* ikon opsional */ } },
    toast(msg, type = 'info', ms) {
      const cls = { success: 'text-bg-success', danger: 'text-bg-danger', warning: 'text-bg-warning', info: 'text-bg-dark' }[type] || 'text-bg-dark';
      const el = document.createElement('div'); el.className = 'toast align-items-center border-0 ' + cls; el.setAttribute('role', 'alert');
      el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(msg)}</div><button type="button" class="btn-close ${type === 'warning' ? '' : 'btn-close-white'} me-2 m-auto" data-bs-dismiss="toast" aria-label="Tutup"></button></div>`;
      $('#toasts').appendChild(el);
      const t = new bootstrap.Toast(el, { delay: ms || (type === 'danger' ? 8000 : 4200) }); el.addEventListener('hidden.bs.toast', () => el.remove()); t.show();
    },
    show(el, opts) {
      return new Promise((res) => {
        const m = bootstrap.Modal.getOrCreateInstance(el, opts || {});
        if (el.classList.contains('show')) return res(m);
        el.addEventListener('shown.bs.modal', () => res(m), { once: true }); m.show();
      });
    },
    hide(el) {
      return new Promise((res) => {
        const m = bootstrap.Modal.getInstance(el); if (!m || !el.classList.contains('show')) return res();
        el.addEventListener('hidden.bs.modal', () => { if ($('.modal.show')) document.body.classList.add('modal-open'); res(); }, { once: true }); m.hide();
      });
    },
    confirm(body, o = {}) { return dialog(Object.assign({ body }, o)); },
    prompt(title, value, o = {}) { return dialog(Object.assign({ title, input: true, value }, o)); },
  });

  let dlgChain = Promise.resolve();
  function dialog(o) {
    const run = () => new Promise(async (resolve) => {
      const el = $('#uiModal'); $('#ui-title').textContent = o.title || 'Konfirmasi'; $('#ui-body').textContent = o.body || '';
      const inp = $('#ui-input'); inp.classList.toggle('d-none', !o.input); if (o.input) { inp.value = o.value || ''; inp.placeholder = o.placeholder || ''; }
      const ok = $('#ui-ok'), cancel = $('#ui-cancel'); ok.textContent = o.okText || 'OK'; ok.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary');
      cancel.textContent = o.cancelText || 'Batal'; cancel.classList.toggle('d-none', !!o.hideCancel);
      let result = o.input ? null : false;
      ok.onclick = () => { result = o.input ? inp.value : true; UI.hide(el); };
      cancel.onclick = () => UI.hide(el);
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } };
      el.addEventListener('hidden.bs.modal', () => resolve(result), { once: true });
      await UI.show(el, { backdrop: 'static' }); if (o.input) { inp.focus(); inp.select(); } else ok.focus();
    });
    const p = dlgChain.then(run, run); dlgChain = p.catch(() => {}); return p;
  }

  // ====================================================================== state
  const App = (PPS.App = { project: null, view: 'projects', dirty: false, thumbDirty: false, focusPid: null });
  const findPerson = (id) => App.project.persons.find((p) => p.id === id);
  const appPrefs = () => C.appSettings();

  const VIEWS = [
    { id: 'projects', label: 'Proyek', icon: 'folder-open' },
    { id: 'people', label: 'Orang & Foto', icon: 'users' },
    { id: 'layout', label: 'Layout', icon: 'layout-grid' },
    { id: 'recap', label: 'Rekap', icon: 'clipboard-list' },
    { id: 'export', label: 'Export', icon: 'download' },
    { id: 'settings', label: 'Pengaturan', icon: 'settings' },
  ];

  /** Lengkapi proyek lama / hasil impor dengan nilai default. */
  function normalize(p) {
    const base = S.newProject();
    const st = Object.assign(base.settings, p.settings || {});
    ['media', 'margins', 'spacing', 'layout', 'marks', 'guides', 'export'].forEach((k) => { st[k] = Object.assign({}, base.settings[k], (p.settings || {})[k] || {}); });
    p.settings = st;
    p.layout = p.layout && Array.isArray(p.layout.pages) ? p.layout : base.layout;
    p.persons = Array.isArray(p.persons) ? p.persons : [];
    p.persons.forEach((per) => {
      per.variants = Array.isArray(per.variants) ? per.variants : [];
      per.variants.forEach((v) => { v.crop = Object.assign(IM.DEFAULT_CROP(), v.crop || {}); v.bg = Object.assign(IM.DEFAULT_BG(), v.bg || {}); v.qty = Math.max(1, parseInt(v.qty, 10) || 1); });
    });
    return p;
  }

  // ====================================================================== simpan otomatis
  function setSaveState(s) {
    const el = $('#save-state'); if (!el) return;
    const map = { dirty: ['Belum tersimpan…', 'warn'], saving: ['Menyimpan…', ''], saved: ['Tersimpan ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }), 'ok'], error: ['Gagal menyimpan', 'err'] };
    const [t, c] = map[s] || ['', '']; el.textContent = t; el.className = 'save-state ' + c;
  }
  const autosave = U.debounce(() => { if (appPrefs().autosave !== false) App.save(); }, 1200);
  /** Tandai proyek berubah (otomatis tersimpan). opt.layout = thumbnail perlu diperbarui. */
  App.touch = (opt = {}) => { if (!App.project) return; App.project.updatedAt = Date.now(); App.dirty = true; if (opt.layout) App.thumbDirty = true; setSaveState('dirty'); autosave(); updateTop(); };
  let saving = null;
  App.save = async (label) => {
    if (!App.project) return;
    if (saving) await saving.catch(() => {});
    saving = (async () => {
      setSaveState('saving');
      try {
        if (App.thumbDirty && App.project.layout.pages.length) { try { App.project.thumb = await PPS.Render.thumb(App.project, 0, 220); } catch (e) { /* thumbnail opsional */ } }
        App.thumbDirty = false;
        await S.saveProject(App.project);
        if (label) await S.addHistory(App.project, label);
        App.dirty = false; setSaveState('saved');
      } catch (e) { setSaveState('error'); UI.toast('Gagal menyimpan ke penyimpanan lokal: ' + (e.message || e), 'danger'); throw e; }
    })();
    try { await saving; } finally { saving = null; }
  };
  function updateTop() {
    const p = App.project; if (!p) return;
    // Navbar proyek lokal sudah digabung ke navbar utama platform.
    // Elemen top-project/top-sub tidak lagi ada di halaman; jangan hentikan
    // inisialisasi aplikasi hanya karena elemen presentasional tersebut absen.
    const projectTitle = $('#top-project');
    const projectSubtitle = $('#top-sub');
    if (projectTitle) projectTitle.textContent = p.name;
    if (projectSubtitle) projectSubtitle.textContent = [p.customer, p.orderNo && '#' + p.orderNo].filter(Boolean).join(' • ') || 'Proyek aktif';
    document.title = p.name + ' — PHOTO PRINT STUDIO';
  }

  // ====================================================================== proyek
  async function openProject(id) {
    if (App.project && App.dirty) await App.save().catch(() => {});
    const p = await S.getProject(id); if (!p) { UI.toast('Proyek tidak ditemukan.', 'danger'); return; }
    App.project = normalize(p); App.dirty = false; App.thumbDirty = false;
    IM.clearRenderCache(); IM.clearBitmaps(); IM.revokeURLs();
    const pref = appPrefs(); pref.lastProject = id; C.saveAppSettings(pref);
    PPS.LayoutView.onProjectChanged(); updateTop(); setSaveState('saved'); App.show(App.view);
    S.gc(App.project).catch(() => {});
  }
  async function createProject(meta) {
    if (App.project && App.dirty) await App.save().catch(() => {});
    const p = S.newProject(meta); await S.saveProject(p); await openProject(p.id); return p;
  }
  async function newProjectDialog() {
    $('#np-name').value = ''; $('#np-customer').value = ''; $('#np-order').value = ''; $('#np-notes').value = '';
    const el = $('#projModal'); await UI.show(el); $('#np-name').focus();
    $('#np-ok').onclick = async () => {
      const name = $('#np-name').value.trim() || 'Proyek Baru';
      await UI.hide(el);
      try { await createProject({ name, customer: $('#np-customer').value.trim(), orderNo: $('#np-order').value.trim(), notes: $('#np-notes').value.trim() }); App.show('people'); UI.toast('Proyek dibuat.', 'success'); }
      catch (e) { UI.toast('Gagal membuat proyek: ' + e.message, 'danger'); }
    };
  }
  async function deleteProject(id) {
    const list = await S.listProjects(); const target = list.find((x) => x.id === id); if (!target) return;
    if (!(await UI.confirm(`Hapus proyek “${target.name}” beserta seluruh foto & hasil prosesnya dari browser ini?\nTindakan ini tidak dapat dibatalkan.`, { okText: 'Hapus proyek', danger: true, title: 'Hapus proyek' }))) return;
    const wasCurrent = App.project && App.project.id === id;
    await S.deleteProject(id);
    if (wasCurrent) { App.dirty = false; const rest = list.filter((x) => x.id !== id); if (rest.length) await openProject(rest[0].id); else await createProject({ name: 'Proyek Baru' }); }
    UI.toast('Proyek dihapus.', 'success'); if (App.view === 'projects') renderProjects();
  }

  async function renderProjects() {
    const p = App.project; const list = (await S.listProjects()).map((x) => (x.id === p.id ? p : x));
    const el = $('#view-projects');
    el.innerHTML = `
    <div class="page-head"><div><h1>Proyek</h1><p class="text-muted mb-0">Setiap pekerjaan cetak adalah satu proyek. Data tersimpan <b>lokal</b> di browser ini — foto tidak dikirim ke server.</p></div>
      <div class="d-flex gap-2 flex-wrap"><button class="btn btn-primary" data-act="new"><i data-lucide="plus"></i> Proyek baru</button>
      <label class="btn btn-outline-primary mb-0"><i data-lucide="upload"></i> Impor JSON<input type="file" accept=".json,application/json" hidden id="import-file"></label></div></div>
    <div class="card-x mb-4">
      <div class="d-flex justify-content-between align-items-center mb-2"><h2 class="h6 mb-0">Proyek aktif</h2>
        <div class="d-flex gap-1 flex-wrap"><button class="btn btn-sm btn-outline-secondary" data-act="snap"><i data-lucide="save"></i> Simpan + riwayat</button><button class="btn btn-sm btn-outline-secondary" data-act="history"><i data-lucide="history"></i> Riwayat</button><button class="btn btn-sm btn-outline-secondary" data-act="export-cur"><i data-lucide="file-down"></i> Ekspor JSON</button></div></div>
      <div class="row g-2">
        <div class="col-md-4"><label class="form-label small fw-semibold" for="pj-name">Nama proyek</label><input class="form-control" id="pj-name" maxlength="80" value="${esc(p.name)}"></div>
        <div class="col-md-4"><label class="form-label small fw-semibold" for="pj-customer">Nama pelanggan</label><input class="form-control" id="pj-customer" maxlength="80" value="${esc(p.customer)}"></div>
        <div class="col-md-2"><label class="form-label small fw-semibold" for="pj-order">No. order</label><input class="form-control" id="pj-order" maxlength="40" value="${esc(p.orderNo)}"></div>
        <div class="col-md-2"><label class="form-label small fw-semibold">Tanggal proyek</label><input class="form-control" disabled value="${new Date(p.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}"></div>
        <div class="col-12"><label class="form-label small fw-semibold" for="pj-notes">Catatan</label><textarea class="form-control" id="pj-notes" rows="2">${esc(p.notes)}</textarea></div>
      </div></div>
    <h2 class="h6 mb-2">Semua proyek (${list.length})</h2>
    <div class="row g-3">${list.map((x) => {
      const cnt = x.persons.reduce((a, per) => a + per.variants.reduce((b, v) => b + (v.qty || 0), 0), 0);
      return `<div class="col-sm-6 col-xl-4"><div class="project-card ${x.id === p.id ? 'current' : ''}" data-id="${x.id}">
        <div class="pc-thumb">${x.thumb ? `<img src="${x.thumb}" alt="">` : '<i data-lucide="image"></i>'}</div>
        <div class="pc-body"><div class="d-flex align-items-start gap-2"><div class="fw-bold text-truncate flex-grow-1">${esc(x.name)}</div>${x.id === p.id ? '<span class="badge text-bg-primary">Aktif</span>' : ''}</div>
          <div class="small text-muted text-truncate">${esc([x.customer, x.orderNo && '#' + x.orderNo].filter(Boolean).join(' • ') || 'Tanpa pelanggan')}</div>
          <div class="small text-muted">${x.persons.length} orang • ${cnt} foto • ${U.fmtDate(x.updatedAt)}</div>
          <div class="d-flex flex-wrap gap-1 mt-2">
            <button class="btn btn-sm btn-primary" data-pa="open" ${x.id === p.id ? 'disabled' : ''}>Buka</button>
            <button class="btn btn-sm btn-outline-secondary" data-pa="dup" title="Duplikasi"><i data-lucide="copy"></i></button>
            <button class="btn btn-sm btn-outline-secondary" data-pa="rename" title="Ganti nama"><i data-lucide="pencil"></i></button>
            <button class="btn btn-sm btn-outline-secondary" data-pa="export" title="Ekspor JSON"><i data-lucide="file-down"></i></button>
            <button class="btn btn-sm btn-outline-danger" data-pa="del" title="Hapus"><i data-lucide="trash-2"></i></button></div></div></div></div>`;
    }).join('')}</div>`;
    UI.icons();
  }
  async function exportProject(id) {
    try {
      const proj = App.project && App.project.id === id ? App.project : await S.getProject(id);
      if (App.project && App.project.id === id) await App.save().catch(() => {});
      UI.toast('Menyiapkan file proyek…', 'info', 1800);
      const blob = await S.exportProjectFile(proj); U.download(blob, U.safeName(proj.name) + '.pps.json'); UI.toast('File proyek diunduh (' + U.fmtBytes(blob.size) + ').', 'success');
    } catch (e) { UI.toast('Gagal mengekspor proyek: ' + e.message, 'danger'); }
  }
  function wireProjects() {
    const el = $('#view-projects');
    el.addEventListener('input', (e) => {
      const m = { 'pj-name': 'name', 'pj-customer': 'customer', 'pj-order': 'orderNo', 'pj-notes': 'notes' }[e.target.id]; if (!m) return;
      App.project[m] = e.target.value; if (m === 'name' && !e.target.value.trim()) App.project.name = 'Proyek Tanpa Nama'; App.touch();
    });
    el.addEventListener('change', async (e) => {
      if (e.target.id !== 'import-file') return; const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { UI.toast('Mengimpor proyek…', 'info', 1500); const r = await S.importProjectFile(f); await openProject(r.project.id); UI.toast(r.missing ? `Proyek diimpor, tetapi ${r.missing} file gambar tidak ada di file.` : 'Proyek berhasil diimpor.', r.missing ? 'warning' : 'success'); }
      catch (err) { UI.toast(err.message || 'Gagal mengimpor proyek.', 'danger'); }
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act],[data-pa]'); if (!b) return;
      try {
        if (b.dataset.act === 'new') return newProjectDialog();
        if (b.dataset.act === 'snap') { await App.save('Simpan manual'); UI.toast('Proyek disimpan dan ditambahkan ke riwayat.', 'success'); return; }
        if (b.dataset.act === 'history') return historyDialog();
        if (b.dataset.act === 'export-cur') return exportProject(App.project.id);
        const id = b.closest('[data-id]').dataset.id;
        if (b.dataset.pa === 'open') { await openProject(id); UI.toast('Proyek dibuka.', 'success'); }
        else if (b.dataset.pa === 'dup') { if (App.project.id === id) await App.save().catch(() => {}); const d = await S.duplicateProject(id); UI.toast('Proyek diduplikasi: ' + d.name, 'success'); renderProjects(); }
        else if (b.dataset.pa === 'rename') {
          const cur = await S.getProject(id); const n = await UI.prompt('Ganti nama proyek', cur.name, { okText: 'Simpan' }); if (n == null || !n.trim()) return;
          if (App.project.id === id) { App.project.name = n.trim(); App.touch(); updateTop(); } else { cur.name = n.trim(); await S.saveProject(cur); } renderProjects();
        } else if (b.dataset.pa === 'export') return exportProject(id);
        else if (b.dataset.pa === 'del') return deleteProject(id);
      } catch (err) { UI.toast('Gagal: ' + (err.message || err), 'danger'); }
    });
  }
  async function historyDialog() {
    const el = $('#histModal'); const body = $('#hist-body'); body.innerHTML = '<div class="text-muted">Memuat…</div>'; UI.show(el);
    const render = async () => {
      const list = await S.listHistory(App.project.id);
      body.innerHTML = list.length ? `<div class="list-group">${list.map((h) => `<div class="list-group-item d-flex align-items-center gap-2" data-hid="${h.id}"><div class="flex-grow-1"><div class="fw-semibold small">${esc(h.label)}</div><div class="small text-muted">${U.fmtDate(h.at)} • ${h.data.persons.length} orang</div></div><button class="btn btn-sm btn-outline-primary" data-h="restore">Pulihkan</button></div>`).join('')}</div><div class="small text-muted mt-2">Riwayat menyimpan snapshot data proyek (maks. 15). Memulihkan akan menimpa kondisi proyek saat ini.</div>` : '<div class="text-muted">Belum ada riwayat. Klik “Simpan + riwayat” atau buat layout untuk menambahkan.</div>';
      body.onclick = async (e) => {
        const b = e.target.closest('[data-h="restore"]'); if (!b) return; const h = list.find((x) => x.id === b.closest('[data-hid]').dataset.hid); if (!h) return;
        if (!(await UI.confirm('Pulihkan proyek ke snapshot ' + U.fmtDate(h.at) + '? Kondisi sekarang akan ditimpa (simpan riwayat dulu bila perlu).', { okText: 'Pulihkan', danger: true }))) return;
        await S.addHistory(App.project, 'Sebelum memulihkan');
        const cur = App.project; const restored = normalize(U.deepClone(h.data)); restored.id = cur.id; restored.thumb = cur.thumb; App.project = restored; IM.clearRenderCache(); IM.clearBitmaps();
        await App.save(); PPS.LayoutView.onProjectChanged(); await UI.hide(el); App.show(App.view); UI.toast('Proyek dipulihkan.', 'success');
      };
    }; render();
  }

  // ====================================================================== orang & foto
  const defaultVariant = (size, from) => ({ id: U.uid('var'), sizeId: size.id, name: size.name, w: size.w, h: size.h, qty: 1, crop: IM.DEFAULT_CROP(), bg: from ? U.deepClone(from.bg) : IM.DEFAULT_BG() });
  function newPerson(name) {
    const p = App.project; const n = name || 'Orang ' + (p.persons.length + 1);
    const per = { id: U.uid('per'), name: n, photoId: null, thumbId: null, imgW: 0, imgH: 0, fileName: '', cutout: null, variants: [] };
    const sz = C.findSize('3x4'); if (sz) { const v = defaultVariant(sz); v.qty = 4; per.variants.push(v); }
    p.persons.push(per); return per;
  }
  const hasEdits = (per) => !!per.cutout || per.variants.some((v) => JSON.stringify(v.crop) !== JSON.stringify(IM.DEFAULT_CROP()));
  async function setPhoto(per, file) {
    if (per.photoId && hasEdits(per) && !(await UI.confirm(`Mengganti foto “${per.name}” akan mereset crop dan hasil hapus background orang ini. Lanjutkan?`, { okText: 'Ganti foto', danger: true }))) return false;
    const info = await IM.importPhoto(file, App.project.id);
    if (per.photoId) IM.dropBitmaps(per.photoId); if (per.cutout) IM.dropBitmaps(per.cutout.cutoutId);
    Object.assign(per, { photoId: info.photoId, thumbId: info.thumbId, imgW: info.imgW, imgH: info.imgH, fileName: info.fileName, cutout: null });
    per.variants.forEach((v) => { v.crop = IM.DEFAULT_CROP(); v.bg = IM.DEFAULT_BG(); });
    return true;
  }
  /** Tangani banyak file: ke orang tertentu (ganti foto) atau buat orang baru per file. */
  async function handleFiles(files, targetPid) {
    files = Array.from(files || []).filter(Boolean); if (!files.length) return;
    const errs = []; let ok = 0;
    UI.toast(`Memproses ${files.length} foto…`, 'info', 1500);
    if (targetPid) {
      const per = findPerson(targetPid); if (!per) return;
      try { if (await setPhoto(per, files[0])) ok++; } catch (e) { errs.push(e.message); }
    } else {
      for (const f of files) {
        const name = (f.name || '').replace(/\.[^.]+$/, '').slice(0, 40) || undefined;
        try { const info = await IM.importPhoto(f, App.project.id); const per = newPerson(name && name !== 'image' ? name : undefined); Object.assign(per, { photoId: info.photoId, thumbId: info.thumbId, imgW: info.imgW, imgH: info.imgH, fileName: info.fileName }); ok++; }
        catch (e) { errs.push(e.message); }
      }
    }
    if (ok) { App.touch({ layout: true }); PPS.LayoutView.prune(); }
    if (errs.length) UI.toast(errs.join('\n'), 'danger', 9000);
    if (ok) UI.toast(`${ok} foto ditambahkan.`, 'success');
    renderPeople();
  }

  function sizeOptions() {
    const groups = {}; C.allSizes().forEach((s) => (groups[s.group] = groups[s.group] || []).push(s));
    return Object.keys(groups).map((g) => `<optgroup label="${esc(g)}">${groups[g].map((s) => `<option value="${esc(s.id)}">${esc(s.name)} — ${U.mm(s.w)}×${U.mm(s.h)} mm</option>`).join('')}</optgroup>`).join('');
  }
  function variantRow(per, v) {
    const dpi = per.photoId ? IM.effectiveDpi(per, v) : null; const cls = dpi == null ? '' : dpi < 150 ? 'text-bg-danger' : dpi < 250 ? 'text-bg-warning' : 'text-bg-success';
    const bgTxt = !v.bg || v.bg.type === 'original' ? '' : v.bg.type === 'transparent' ? 'transparan' : v.bg.type === 'image' ? 'gambar' : `<span class="dot" style="background:${esc(v.bg.color)}"></span>${esc(v.bg.color)}`;
    return `<div class="variant-row" data-vid="${v.id}">
      <div class="checker vprev-wrap"><canvas class="vprev" data-vprev="${v.id}"></canvas></div>
      <div class="v-info"><div><b>${esc(v.name)}</b> <span class="text-muted small">${U.mm(v.w)}×${U.mm(v.h)} mm</span></div>
        <div class="small d-flex flex-wrap gap-1 align-items-center">${dpi != null ? `<span class="badge ${cls}" title="Resolusi efektif foto asli pada ukuran cetak ini">~${dpi} dpi${dpi < 150 ? ' • rendah' : ''}</span>` : ''}${bgTxt ? `<span class="badge text-bg-light border">${bgTxt}</span>` : ''}</div></div>
      <div class="qty-ctl" title="Jumlah cetak"><button class="btn btn-light btn-sm" data-act="qty-" aria-label="Kurangi"><i data-lucide="minus"></i></button><input type="number" inputmode="numeric" min="1" max="999" value="${v.qty}" data-field="qty" aria-label="Jumlah cetak"><button class="btn btn-light btn-sm" data-act="qty+" aria-label="Tambah"><i data-lucide="plus"></i></button></div>
      <div class="d-flex gap-1"><button class="btn btn-sm btn-outline-primary" data-act="crop" title="Crop & latar"><i data-lucide="crop"></i><span class="d-none d-sm-inline"> Crop</span></button><button class="btn btn-sm btn-outline-danger" data-act="del-variant" title="Hapus ukuran ini"><i data-lucide="x"></i></button></div></div>`;
  }
  function personCard(per) {
    const nPics = per.variants.reduce((a, v) => a + v.qty, 0);
    return `<div class="person-card ${per.photoId ? '' : 'no-photo-card'}" data-pid="${per.id}">
      <div class="person-head">
        <div class="person-thumb" data-act="photo" title="Klik untuk ${per.photoId ? 'mengganti' : 'mengunggah'} foto atau seret file ke sini" tabindex="0" role="button">${per.thumbId ? `<img data-thumb="${per.thumbId}" alt="Foto ${esc(per.name)}">` : '<div class="no-photo"><i data-lucide="image-plus"></i><span>Unggah foto</span></div>'}</div>
        <div class="person-meta">
          <input class="form-control fw-bold person-name" value="${esc(per.name)}" data-field="name" maxlength="60" aria-label="Nama orang">
          <div class="small text-muted mt-1">${per.photoId ? `${esc(per.fileName)} • ${per.imgW}×${per.imgH}px` : '<span class="text-danger fw-semibold">Belum ada foto — tidak akan masuk layout</span>'} • ${nPics} lembar ${per.cutout ? '• <span class="badge text-bg-primary">background dihapus</span>' : ''}</div>
          <div class="d-flex flex-wrap gap-1 mt-2">
            <button class="btn btn-sm btn-outline-secondary" data-act="photo"><i data-lucide="${per.photoId ? 'refresh-cw' : 'upload'}"></i> ${per.photoId ? 'Ganti foto' : 'Unggah foto'}</button>
            ${per.photoId ? '<button class="btn btn-sm btn-outline-secondary" data-act="rm-photo"><i data-lucide="image-off"></i> Hapus foto</button><button class="btn btn-sm btn-outline-primary" data-act="bg"><i data-lucide="wand-2"></i> Background</button>' : ''}
            <button class="btn btn-sm btn-outline-secondary" data-act="dup-person"><i data-lucide="copy"></i> Duplikasi</button>
            <button class="btn btn-sm btn-outline-danger" data-act="del-person"><i data-lucide="trash-2"></i> Hapus</button></div></div></div>
      <div class="variant-list">${per.variants.length ? per.variants.map((v) => variantRow(per, v)).join('') : '<div class="text-muted small p-2">Belum ada ukuran. Tambahkan ukuran di bawah.</div>'}</div>
      <div class="variant-add"><select class="form-select form-select-sm" data-field="add-size" aria-label="Pilih ukuran">${sizeOptions()}</select>
        <button class="btn btn-sm btn-primary" data-act="add-variant"><i data-lucide="plus"></i> Tambah ukuran</button>
        <button class="btn btn-sm btn-outline-secondary" data-act="custom-size"><i data-lucide="ruler"></i> Ukuran custom…</button></div></div>`;
  }
  function renderPeople() {
    const p = App.project; const el = $('#view-people');
    if (!$('#people-list', el)) {
      el.innerHTML = `<div class="page-head"><div><h1>Orang &amp; Foto</h1><p class="text-muted mb-0">Satu proyek dapat berisi banyak orang. Setiap orang punya foto, ukuran, jumlah cetak, crop dan background sendiri.</p></div>
        <div class="d-flex gap-2"><button class="btn btn-primary" data-act="add-person"><i data-lucide="user-plus"></i> Tambah orang</button></div></div>
        <div class="dropzone" id="dropzone" tabindex="0" role="button"><i data-lucide="upload-cloud"></i><div><b>Seret foto ke sini</b>, klik untuk memilih, atau tempel (Ctrl+V) gambar dari clipboard.<div class="small text-muted">Setiap foto menjadi satu orang baru. Untuk mengganti foto, seret ke kartu orangnya.</div></div></div>
        <div id="people-summary" class="mb-3"></div><div id="people-list"></div>`;
    }
    const tot = p.persons.reduce((a, per) => a + per.variants.reduce((b, v) => b + v.qty, 0), 0);
    $('#people-summary').innerHTML = `<span class="chip">${p.persons.length} orang</span> <span class="chip">${p.persons.reduce((a, x) => a + x.variants.length, 0)} varian ukuran</span> <span class="chip">${tot} lembar foto</span>` + (p.persons.some((x) => !x.photoId) ? ' <span class="chip chip-warn">ada orang tanpa foto</span>' : '');
    const list = $('#people-list'); const sc = list.scrollTop;
    list.innerHTML = p.persons.length ? p.persons.map(personCard).join('') : '<div class="empty-state"><i data-lucide="users"></i><div class="fw-semibold">Belum ada orang</div><div class="text-muted small">Seret foto ke area di atas atau klik “Tambah orang”.</div></div>';
    list.scrollTop = sc; UI.icons(); hydratePeople();
  }
  async function hydratePeople() {
    $$('#people-list img[data-thumb]').forEach(async (img) => { const u = await IM.thumbURL(img.dataset.thumb); if (u) img.src = u; });
    for (const cv of $$('#people-list canvas[data-vprev]')) {
      const card = cv.closest('[data-pid]'); if (!card) continue; const per = findPerson(card.dataset.pid); const v = per && per.variants.find((x) => x.id === cv.dataset.vprev); if (!v) continue;
      const H = 72, W = Math.max(24, Math.round((H * v.w) / v.h)); cv.style.width = W / 2 + 'px'; cv.style.height = H / 2 + 'px'; cv.width = W; cv.height = H;
      if (!per.photoId) continue;
      try { const c = await IM.renderVariant(per, v, W, H, { preview: true }); if (cv.isConnected) cv.getContext('2d').drawImage(c, 0, 0); } catch (e) { /* pratinjau gagal: dibiarkan kosong */ }
    }
  }
  function afterVariantChange(opts = {}) { PPS.LayoutView.prune(); App.touch({ layout: true }); if (opts.rerender !== false) renderPeople(); }

  async function customSizeDialog(existing) {
    const el = $('#sizeModal'); $('#sz-title').textContent = existing ? 'Edit ukuran custom' : 'Ukuran custom';
    $('#sz-name').value = existing ? existing.name : ''; $('#sz-w').value = existing ? existing.w : ''; $('#sz-h').value = existing ? existing.h : ''; $('#sz-err').classList.add('d-none');
    await UI.show(el); $('#sz-name').focus();
    return new Promise((resolve) => {
      let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
      el.addEventListener('hidden.bs.modal', () => fin(null), { once: true });
      $('#sz-ok').onclick = () => {
        const name = $('#sz-name').value.trim(), w = U.num($('#sz-w').value, NaN), h = U.num($('#sz-h').value, NaN); const err = $('#sz-err');
        const bad = !name ? 'Nama ukuran wajib diisi.' : !(w >= 5 && w <= 2000 && h >= 5 && h <= 2000) ? 'Lebar dan tinggi harus angka antara 5 dan 2000 mm.' : C.SIZES.some((s) => s.name.toLowerCase() === name.toLowerCase()) ? 'Nama sudah dipakai ukuran baku.' : C.customSizes().some((s) => s.name.toLowerCase() === name.toLowerCase() && (!existing || s.id !== existing.id)) ? 'Nama sudah dipakai preset custom lain.' : '';
        if (bad) { err.textContent = bad; err.classList.remove('d-none'); return; }
        const list = C.customSizes(); let sz;
        if (existing) { sz = list.find((s) => s.id === existing.id); Object.assign(sz, { name, w: U.round(w), h: U.round(h) }); } else { sz = { id: 'c_' + U.uid('s'), name, w: U.round(w), h: U.round(h) }; list.push(sz); }
        C.saveCustomSizes(list); fin(sz); UI.hide(el);
      };
    });
  }

  async function personAction(e) {
    const b = e.target.closest('[data-act]'); if (!b) return; const card = b.closest('[data-pid]'); const act = b.dataset.act;
    if (act === 'add-person') { newPerson(); App.touch(); renderPeople(); const last = $('#people-list').lastElementChild; if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (!card) return; const per = findPerson(card.dataset.pid); if (!per) return; App.focusPid = per.id;
    const vrow = b.closest('[data-vid]'); const v = vrow && per.variants.find((x) => x.id === vrow.dataset.vid);
    try {
      if (act === 'photo') { App.pendingPid = per.id; $('#file-photo').multiple = false; $('#file-photo').click(); }
      else if (act === 'rm-photo') {
        if (!(await UI.confirm(`Hapus foto “${per.name}”? Crop dan hasil hapus background akan hilang. Data ukuran & jumlah tetap ada.`, { okText: 'Hapus foto', danger: true }))) return;
        IM.dropBitmaps(per.photoId); Object.assign(per, { photoId: null, thumbId: null, imgW: 0, imgH: 0, fileName: '', cutout: null }); per.variants.forEach((x) => { x.crop = IM.DEFAULT_CROP(); x.bg = IM.DEFAULT_BG(); }); afterVariantChange();
      } else if (act === 'bg') await openBgStudio(per, null);
      else if (act === 'dup-person') {
        const c = U.deepClone(per); c.id = U.uid('per'); c.name = per.name + ' (salinan)'; c.variants.forEach((x) => (x.id = U.uid('var')));
        if (c.cutout) { const old = c.cutout; const mb = await S.getBlob(old.maskId), cb = await S.getBlob(old.cutoutId); if (mb && cb) { c.cutout.maskId = await S.putBlob(App.project.id, mb); c.cutout.cutoutId = await S.putBlob(App.project.id, cb); } else c.cutout = null; }
        App.project.persons.splice(App.project.persons.indexOf(per) + 1, 0, c); App.touch(); renderPeople(); UI.toast('Orang diduplikasi. Layout perlu disusun ulang (Auto Arrange).', 'success');
      } else if (act === 'del-person') {
        if (!(await UI.confirm(`Hapus “${per.name}” beserta seluruh ukuran dan foto dari proyek ini?`, { okText: 'Hapus orang', danger: true }))) return;
        App.project.persons.splice(App.project.persons.indexOf(per), 1); afterVariantChange();
      } else if (act === 'add-variant') {
        const id = $('[data-field="add-size"]', card).value; const sz = C.findSize(id); if (!sz) { UI.toast('Pilih ukuran terlebih dahulu.', 'warning'); return; }
        per.variants.push(defaultVariant(sz, per.variants[per.variants.length - 1])); afterVariantChange(); UI.toast(`Ukuran ${sz.name} ditambahkan.`, 'success', 1800);
      } else if (act === 'custom-size') { const sz = await customSizeDialog(); if (sz) { per.variants.push(defaultVariant(sz, per.variants[per.variants.length - 1])); afterVariantChange(); UI.toast(`Preset “${sz.name}” disimpan dan ditambahkan.`, 'success'); } }
      else if (act === 'del-variant' && v) { per.variants.splice(per.variants.indexOf(v), 1); afterVariantChange(); }
      else if ((act === 'qty+' || act === 'qty-') && v) { setQty(per, v, v.qty + (act === 'qty+' ? 1 : -1), vrow); }
      else if (act === 'crop' && v) await openCrop(per.id, v.id);
    } catch (err) { UI.toast('Gagal: ' + (err.message || err), 'danger'); }
  }
  function setQty(per, v, raw, vrow) {
    let n = Math.round(U.num(raw, NaN));
    if (!Number.isFinite(n) || n < 1) { UI.toast('Jumlah cetak harus bilangan bulat minimal 1 (nol/negatif tidak diperbolehkan).', 'warning'); n = v.qty; }
    n = Math.min(999, n); const dec = n < v.qty; v.qty = n; const inp = $('[data-field="qty"]', vrow); if (inp) inp.value = n;
    if (dec) PPS.LayoutView.prune(); App.touch({ layout: dec });
    const card = vrow.closest('.person-card'); const sub = $('.person-meta .small', card); if (sub) { /* ringkasan diperbarui saat render berikutnya */ }
    const tot = App.project.persons.reduce((a, x) => a + x.variants.reduce((c, y) => c + y.qty, 0), 0); const chips = $('#people-summary'); if (chips) chips.querySelectorAll('.chip')[2].textContent = tot + ' lembar foto';
  }
  function wirePeople() {
    const el = $('#view-people'); const fp = $('#file-photo');
    el.addEventListener('click', (e) => { if (e.target.closest('#dropzone')) { App.pendingPid = null; fp.multiple = true; fp.click(); return; } personAction(e); });
    el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('#dropzone, .person-thumb')) { e.preventDefault(); e.target.click(); } });
    fp.addEventListener('change', () => { const files = fp.files; const pid = App.pendingPid; handleFiles(files, pid).finally(() => { fp.value = ''; App.pendingPid = null; }); });
    el.addEventListener('change', (e) => {
      const f = e.target.dataset.field; if (!f) return; const card = e.target.closest('[data-pid]'); if (!card) return; const per = findPerson(card.dataset.pid); if (!per) return;
      if (f === 'name') { per.name = e.target.value.trim() || 'Tanpa nama'; e.target.value = per.name; App.touch(); PPS.LayoutView.refresh(); }
      else if (f === 'qty') { const vrow = e.target.closest('[data-vid]'); const v = per.variants.find((x) => x.id === vrow.dataset.vid); if (v) setQty(per, v, e.target.value, vrow); }
    });
    el.addEventListener('focusin', (e) => { const c = e.target.closest('[data-pid]'); if (c) App.focusPid = c.dataset.pid; });
    // drag & drop
    let depth = 0;
    el.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { depth++; el.classList.add('dragging'); } });
    el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove('dragging'); });
    el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); });
    el.addEventListener('drop', (e) => {
      if (!e.dataTransfer.files.length) return; e.preventDefault(); depth = 0; el.classList.remove('dragging');
      const card = e.target.closest('[data-pid]'); handleFiles(e.dataTransfer.files, card ? card.dataset.pid : null);
    });
    window.addEventListener('dragover', (e) => e.preventDefault()); window.addEventListener('drop', (e) => { if (!e.target.closest('#view-people')) e.preventDefault(); });
    document.addEventListener('paste', (e) => {
      if (App.view !== 'people' || /input|textarea|select/i.test((e.target.tagName || ''))) return;
      const files = Array.from(e.clipboardData ? e.clipboardData.files : []).filter((f) => f.type.startsWith('image/')); if (!files.length) return;
      e.preventDefault(); const tgt = App.focusPid && findPerson(App.focusPid); handleFiles(files, tgt && !tgt.photoId ? tgt.id : null);
    });
  }

  // ====================================================================== editor crop
  let cropEd = null, cropCtx = null;
  function cropBgChips() {
    const { per, v } = cropCtx; const box = $('#crop-bg');
    if (!per.cutout) { box.innerHTML = '<div class="small text-muted">Pilihan warna latar hanya berlaku setelah background dihapus. Foto asli dipakai apa adanya (tidak mengganti warna secara palsu).</div>'; return; }
    const cur = cropEd.variant.bg; const items = [{ t: 'original', c: '', l: 'Asli' }, { t: 'transparent', c: '', l: 'Transparan' }].concat(C.BG_COLORS.map((x) => ({ t: 'color', c: x.color, l: x.label })));
    box.innerHTML = `<div class="bg-chips">${items.map((i) => { const act = cur.type === i.t && (i.t !== 'color' || (cur.color || '').toLowerCase() === i.c); return `<button type="button" class="bg-chip ${act ? 'active' : ''}" data-cbg="${i.t}" data-c="${i.c}" title="${i.l}" style="${i.t === 'color' ? 'background:' + i.c : ''}">${i.t === 'original' ? '<i data-lucide="image"></i>' : i.t === 'transparent' ? '<span class="chk"></span>' : ''}</button>`; }).join('')}<input type="color" class="form-control form-control-color bg-color-input" value="${cur.type === 'color' ? cur.color : '#1f5fd6'}" data-cbg-custom title="Warna custom"></div>${cur.type === 'image' ? '<div class="small text-muted mt-1">Memakai gambar latar.</div>' : ''}`;
    UI.icons();
  }
  function cropInfo() {
    if (!cropEd || !cropEd.src) return; const dpi = cropEd.dpi(); const st = cropEd.state;
    $('#crop-zoom').value = st.zoom; $('#crop-zoomv').textContent = Math.round(st.zoom * 100) + '%';
    $('#crop-info').innerHTML = `${U.mm(cropCtx.v.w)}×${U.mm(cropCtx.v.h)} mm • <span class="badge ${dpi < 150 ? 'text-bg-danger' : dpi < 250 ? 'text-bg-warning' : 'text-bg-success'}">~${dpi} dpi</span>${dpi < 200 ? '<div class="text-danger">Resolusi rendah untuk ukuran ini — hasil cetak bisa pecah.</div>' : ''}`;
    $('[data-c="undo"]').disabled = !cropEd.canUndo; $('[data-c="redo"]').disabled = !cropEd.canRedo;
  }
  async function openCrop(pid, vid) {
    const per = findPerson(pid); const v = per && per.variants.find((x) => x.id === vid); if (!per || !v) return;
    if (!per.photoId) { UI.toast('Orang ini belum punya foto. Unggah foto terlebih dahulu.', 'warning'); return; }
    const el = $('#cropModal'); cropCtx = { per, v, el };
    $('#crop-title').textContent = `Crop — ${per.name}`; $('#crop-sub').textContent = `Ukuran ${v.name} (${U.mm(v.w)}×${U.mm(v.h)} mm) • crop ini hanya berlaku untuk ukuran ini`;
    const others = per.variants.filter((x) => x.id !== v.id);
    $('#crop-copy').innerHTML = others.length ? others.map((o) => `<label class="d-flex align-items-center gap-2 mb-1"><input type="checkbox" class="form-check-input mt-0" data-copy="${o.id}"> ${esc(o.name)} <span class="text-muted">${U.mm(o.w)}×${U.mm(o.h)} mm</span></label>`).join('') + '<div class="text-muted">Posisi, zoom, rotasi, dan flip disalin saat Simpan.</div>' : '<span class="text-muted">Orang ini hanya punya satu ukuran.</span>';
    await UI.show(el, { backdrop: 'static', keyboard: false, focus: false }); UI.icons();
    if (!cropEd) cropEd = new PPS.CropEditor({ canvas: $('#crop-canvas'), preview: $('#crop-preview'), onChange: cropInfo });
    try { await cropEd.load(per, v); } catch (e) { UI.toast('Foto tidak dapat dimuat: ' + e.message, 'danger'); await UI.hide(el); return; }
    cropBgChips(); cropInfo();
    return new Promise((resolve) => { cropCtx.resolve = resolve; });
  }
  async function closeCrop(save) {
    const { per, v, el, resolve } = cropCtx;
    if (save) {
      v.crop = U.deepClone(cropEd.state); v.bg = U.deepClone(cropEd.variant.bg);
      $$('[data-copy]', $('#crop-copy')).filter((c) => c.checked).forEach((c) => { const o = per.variants.find((x) => x.id === c.dataset.copy); if (o) o.crop = U.deepClone(cropEd.state); });
      App.touch({ layout: true });
    }
    await UI.hide(el); if (resolve) resolve(save); cropCtx.resolve = null;
    if (save) { renderPeople(); PPS.LayoutView.refresh(); }
  }
  function wireCrop() {
    const el = $('#cropModal');
    $('#crop-save').onclick = () => closeCrop(true); $('#crop-cancel').onclick = () => closeCrop(false); $('#crop-x').onclick = () => closeCrop(false);
    $('#crop-zoom').addEventListener('input', (e) => { if (cropEd) { cropEd.setZoom(parseFloat(e.target.value)); cropEd.commitSoon(); } });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-c]'); if (b && cropEd) {
        const c = b.dataset.c;
        if (c === 'rotate') cropEd.rotate(); else if (c === 'flip') cropEd.flip(); else if (c === 'reset') cropEd.reset(); else if (c === 'undo') cropEd.undo(); else if (c === 'redo') cropEd.redo();
        else if (c === 'studio') {
          const { per, v } = cropCtx; v.crop = U.deepClone(cropEd.state); v.bg = U.deepClone(cropEd.variant.bg); const copies = $$('[data-copy]', $('#crop-copy')).filter((x) => x.checked).map((x) => x.dataset.copy);
          const resolve = cropCtx.resolve; await UI.hide(el); await openBgStudio(per, v); App.touch({ layout: true });
          if (resolve) resolve(true); openCrop(per.id, v.id).then(() => {}); copies.forEach((id) => { const chk = $(`[data-copy="${id}"]`); if (chk) chk.checked = true; });
        }
        cropInfo(); return;
      }
      const chip = e.target.closest('[data-cbg]'); if (chip && cropEd) {
        const t = chip.dataset.cbg; cropEd.setBg(t === 'color' ? { type: 'color', color: chip.dataset.c } : { type: t, color: cropEd.variant.bg.color }); cropBgChips(); return;
      }
    });
    el.addEventListener('input', (e) => { if (e.target.matches('[data-cbg-custom]') && cropEd) { cropEd.setBg({ type: 'color', color: e.target.value }); $$('#crop-bg .bg-chip').forEach((x) => x.classList.remove('active')); } });
    window.addEventListener('resize', () => { if (cropEd && el.classList.contains('show')) { cropEd.resize(); cropEd.draw(); } });
  }

  async function openBgStudio(per, variant) {
    if (!per.photoId) { UI.toast('Unggah foto terlebih dahulu.', 'warning'); return; }
    const res = await PPS.BG.open({ person: per, projectId: App.project.id }); if (!res) return;
    per.cutout = res.cutout;
    const targets = res.applyAll || !variant ? per.variants : [variant];
    targets.forEach((v) => { v.bg = { type: res.bg.type, color: res.bg.color || (v.bg && v.bg.color) || '#1f5fd6', imageId: res.bg.imageId || null }; });
    App.touch({ layout: true }); IM.clearRenderCache(); renderPeople(); PPS.LayoutView.refresh();
    UI.toast('Background diterapkan. Foto asli tetap tersimpan.', 'success');
  }

  // ====================================================================== rekap
  function renderRecap() {
    const p = App.project; const st = p.settings; const pg = C.pageSize(st); const v = L.validate(p);
    const persons = p.persons.length; const variants = p.persons.reduce((a, x) => a + x.variants.length, 0);
    const total = p.persons.reduce((a, x) => a + (x.photoId ? x.variants.reduce((b, y) => b + y.qty, 0) : 0), 0);
    const pages = p.layout.pages.length; const util = pages ? L.utilization(p) : []; const avg = util.length ? util.reduce((a, b) => a + b, 0) / util.length : 0;
    const placed = {}; p.layout.pages.forEach((pgx) => pgx.items.forEach((i) => (placed[i.variantId] = (placed[i.variantId] || 0) + 1)));
    const rows = []; p.persons.forEach((per) => per.variants.forEach((x) => rows.push({ per, v: x, n: placed[x.id] || 0 })));
    const placedTotal = Object.values(placed).reduce((a, b) => a + b, 0);
    const sync = !pages ? ['secondary', 'Layout belum dibuat'] : (v.missing.length || placedTotal !== total) ? ['warning', `Layout belum sinkron: ${placedTotal} dari ${total} foto ditempatkan`] : ['success', `Sinkron: ${placedTotal} dari ${total} foto ditempatkan`];
    $('#view-recap').innerHTML = `<div class="page-head"><div><h1>Rekap pesanan</h1><p class="text-muted mb-0">${esc(p.name)}${p.customer ? ' — ' + esc(p.customer) : ''}${p.orderNo ? ' (#' + esc(p.orderNo) + ')' : ''}</p></div>
      <div class="d-flex gap-2"><button class="btn btn-outline-secondary" data-act="csv"><i data-lucide="file-spreadsheet"></i> Unduh CSV</button></div></div>
      <div class="stat-grid">${[['users', persons, 'Orang'], ['ruler', variants, 'Varian ukuran'], ['images', total, 'Total foto'], ['files', pages, 'Halaman layout'], ['maximize', `${esc(st.media.preset === 'custom' ? 'Custom' : st.media.preset)}<small>${pg.w}×${pg.h} mm</small>`, 'Media'], ['package', pages ? `${pages} lembar<small>${U.round((pages * pg.w * pg.h) / 1e6, 3)} m² • ${Math.round(avg * 100)}% terisi</small>` : '—', 'Estimasi kertas']].map(([i, val, lb]) => `<div class="stat"><i data-lucide="${i}"></i><div class="stat-v">${val}</div><div class="stat-l">${lb}</div></div>`).join('')}</div>
      <div class="alert alert-${sync[0]} py-2 small">${esc(sync[1])}${v.collisions.size ? ` • ${v.collisions.size} foto bertabrakan` : ''}</div>
      <div class="card-x p-0 table-responsive"><table class="table table-sm align-middle mb-0 recap-table"><thead><tr><th>Nama</th><th>Ukuran</th><th class="text-end">Jumlah</th><th class="text-end">Di layout</th><th>Latar</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.per.photoId ? '' : 'table-warning'}"><td>${esc(r.per.name)}${r.per.photoId ? '' : ' <span class="badge text-bg-warning">tanpa foto</span>'}</td><td>${esc(r.v.name)} <span class="text-muted small">${U.mm(r.v.w)}×${U.mm(r.v.h)} mm</span></td><td class="text-end fw-semibold">${r.v.qty}</td><td class="text-end ${r.per.photoId && r.n !== r.v.qty ? 'text-danger fw-semibold' : ''}">${r.n}</td><td class="small">${!r.v.bg || r.v.bg.type === 'original' ? 'Asli' : r.v.bg.type === 'transparent' ? 'Transparan' : r.v.bg.type === 'image' ? 'Gambar' : esc(r.v.bg.color)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center text-muted py-4">Belum ada data.</td></tr>'}
      </tbody>${rows.length ? `<tfoot><tr class="fw-bold"><td colspan="2">Total</td><td class="text-end">${rows.reduce((a, r) => a + r.v.qty, 0)}</td><td class="text-end">${placedTotal}</td><td></td></tr></tfoot>` : ''}</table></div>`;
    UI.icons();
  }
  function exportCsv() {
    const p = App.project; const lines = [['Nama', 'Ukuran', 'Lebar mm', 'Tinggi mm', 'Jumlah'].join(',')];
    p.persons.forEach((per) => per.variants.forEach((v) => lines.push([`"${per.name.replace(/"/g, '""')}"`, `"${v.name}"`, v.w, v.h, v.qty].join(','))));
    U.download(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }), U.safeName(p.name) + '_rekap.csv');
  }

  // ====================================================================== export
  let expFmt = 'pdf';
  function renderExport() {
    const p = App.project; const st = p.settings; const ex = st.export; const pg = C.pageSize(st); const ready = p.layout.pages.length > 0;
    const fmts = [['pdf', 'file-text', 'PDF', 'Satu file, ukuran halaman = media. Disarankan untuk produksi.'], ['png', 'image', 'PNG', 'Per halaman, lossless, DPI tertanam.'], ['jpg', 'image', 'JPEG', 'Per halaman, ukuran file kecil.'], ['print', 'printer', 'Print', 'Cetak langsung, skala 100%.']];
    $('#view-export').innerHTML = `<div class="page-head"><div><h1>Export</h1><p class="text-muted mb-0">Preview, PDF, PNG, JPEG, dan print memakai renderer dan koordinat mm yang sama.</p></div></div>
    ${ready ? '' : '<div class="alert alert-warning">Belum ada layout. Buka menu <b>Layout</b> lalu klik <b>Generate Layout</b>.</div>'}
    <div class="row g-3"><div class="col-lg-7"><div class="card-x"><div class="fw-semibold mb-2">Format</div><div class="fmt-grid">${fmts.map(([id, ic, nm, ds]) => `<label class="fmt ${expFmt === id ? 'active' : ''}"><input type="radio" name="fmt" value="${id}" ${expFmt === id ? 'checked' : ''}><i data-lucide="${ic}"></i><div><b>${nm}</b><div class="small text-muted">${ds}</div></div></label>`).join('')}</div>
      <div class="row g-3 mt-1"><div class="col-sm-6"><label class="form-label small fw-semibold" for="ex-dpi">Resolusi (DPI)</label><select class="form-select" id="ex-dpi">${C.DPI_OPTIONS.map((d) => `<option ${d === ex.dpi ? 'selected' : ''}>${d}</option>`).join('')}</select><div class="form-text">Default 300 DPI. 600 DPI membutuhkan memori besar.</div></div>
      <div class="col-sm-6 ${expFmt === 'jpg' ? '' : 'd-none'}" id="ex-q-wrap"><label class="form-label small fw-semibold" for="ex-q">Kualitas JPEG: <b id="ex-qv">${Math.round(ex.jpegQuality * 100)}</b>%</label><input type="range" class="form-range" id="ex-q" min="50" max="100" value="${Math.round(ex.jpegQuality * 100)}"></div>
      <div class="col-sm-6 ${expFmt === 'png' || expFmt === 'jpg' ? '' : 'd-none'}" id="ex-zip-wrap"><div class="form-check form-switch mt-4"><input class="form-check-input" type="checkbox" id="ex-zip" ${ex.zip ? 'checked' : ''}><label class="form-check-label" for="ex-zip">Gabungkan halaman dalam ZIP</label></div></div></div>
      <div class="mt-3 d-flex gap-2 flex-wrap"><button class="btn btn-primary btn-lg" id="ex-go" ${ready ? '' : 'disabled'}><i data-lucide="${expFmt === 'print' ? 'printer' : 'download'}"></i> ${expFmt === 'print' ? 'Cetak' : 'Export ' + expFmt.toUpperCase()}</button></div></div></div>
    <div class="col-lg-5"><div class="card-x" id="ex-est"></div></div></div>`;
    UI.icons(); exportEstimate();
  }
  function exportEstimate() {
    const p = App.project; const box = $('#ex-est'); if (!box) return; const pg = C.pageSize(p.settings); const dpi = p.settings.export.dpi;
    if (!p.layout.pages.length) { box.innerHTML = '<div class="fw-semibold mb-1">Estimasi</div><div class="text-muted small">Buat layout terlebih dahulu.</div>'; return; }
    const est = PPS.Export.estimate(p, expFmt === 'print' ? 'png' : expFmt === 'jpg' ? 'jpg' : expFmt, expFmt === 'print' ? Math.min(dpi, 300) : dpi); const v = L.validate(p);
    box.innerHTML = `<div class="fw-semibold mb-2">Ringkasan export</div><dl class="kv"><dt>Media</dt><dd>${pg.w}×${pg.h} mm</dd><dt>Halaman</dt><dd>${p.layout.pages.length}</dd><dt>Piksel / halaman</dt><dd>${est.pxW}×${est.pxH}</dd><dt>Perkiraan ukuran file</dt><dd>± ${U.fmtBytes(est.bytes)}${expFmt === 'pdf' || p.layout.pages.length === 1 ? '' : ' total'}</dd><dt>Perkiraan memori</dt><dd>± ${U.fmtBytes(est.mem)}</dd><dt>Garis potong</dt><dd>${p.settings.marks.style === 'none' ? 'Tidak' : 'Ya (' + p.settings.marks.style + ')'}</dd></dl>
    ${est.warn.map((w) => `<div class="alert alert-warning py-2 small mb-2">${esc(w)}</div>`).join('')}
    ${v.missing.length ? '<div class="alert alert-danger py-2 small mb-2">Layout belum sinkron dengan jumlah foto — Auto Arrange dulu.</div>' : ''}${v.collisions.size ? `<div class="alert alert-warning py-2 small mb-2">${v.collisions.size} foto bertabrakan.</div>` : ''}${v.outsideMargin.size ? `<div class="alert alert-warning py-2 small mb-2">${v.outsideMargin.size} foto berada di area margin (mungkin tidak tercetak).</div>` : ''}
    <div class="small text-muted">Estimasi bersifat kasar (isi foto memengaruhi kompresi).</div>`;
  }
  function wireExport() {
    const el = $('#view-export');
    el.addEventListener('change', (e) => {
      const st = App.project.settings.export;
      if (e.target.name === 'fmt') { expFmt = e.target.value; renderExport(); }
      else if (e.target.id === 'ex-dpi') { st.dpi = parseInt(e.target.value, 10); App.touch(); exportEstimate(); }
      else if (e.target.id === 'ex-zip') { st.zip = e.target.checked; App.touch(); }
    });
    el.addEventListener('input', (e) => { if (e.target.id === 'ex-q') { App.project.settings.export.jpegQuality = e.target.value / 100; $('#ex-qv').textContent = e.target.value; App.touch(); } });
    el.addEventListener('click', (e) => { if (e.target.closest('#ex-go')) runExport(expFmt); });
    $('#pr-go').onclick = async () => { await UI.hide($('#printModal')); doPrint(); };
  }
  async function preflight() {
    const p = App.project;
    try { PPS.Export.layoutReady(p); } catch (e) { UI.toast(e.message, 'warning'); return false; }
    const v = L.validate(p);
    if (v.collisions.size && !(await UI.confirm(`${v.collisions.size} foto saling bertabrakan pada layout. Tetap lanjutkan?`, { okText: 'Tetap lanjutkan' }))) return false;
    if (v.oob.size) { UI.toast(`${v.oob.size} foto berada di luar batas media. Perbaiki posisinya di Layout sebelum export.`, 'danger'); return false; }
    return true;
  }
  const progress = { sig: null };
  async function withProgress(title, fn) {
    const el = $('#progModal'); progress.sig = { cancelled: false }; $('#prog-title').textContent = title; $('#prog-bar').style.width = '0%'; $('#prog-text').textContent = 'Menyiapkan…';
    $('#prog-cancel').onclick = () => { progress.sig.cancelled = true; $('#prog-text').textContent = 'Membatalkan…'; };
    await UI.show(el, { backdrop: 'static', keyboard: false });
    try { return await fn(progress.sig, (f, t) => { $('#prog-bar').style.width = Math.round(f * 100) + '%'; if (t) $('#prog-text').textContent = t; }); } finally { await UI.hide(el); }
  }
  async function runExport(fmt) {
    if (fmt === 'print') { if (!(await preflight())) return; $('#pr-paper').textContent = (() => { const g = C.pageSize(App.project.settings); return `${g.w}×${g.h} mm`; })(); UI.show($('#printModal')); return; }
    if (!(await preflight())) return;
    const p = App.project; const st = p.settings; const pg = C.pageSize(st); const dpi = st.export.dpi; const base = `${U.safeName(p.name)}_${pg.w}x${pg.h}mm_${dpi}dpi`;
    const est = PPS.Export.estimate(p, fmt, dpi);
    if (est.warn.length && fmt !== 'pdf') { UI.toast(est.warn[0], 'danger', 9000); return; }
    try {
      await withProgress('Export ' + fmt.toUpperCase() + '…', async (sig, onProgress) => {
        if (fmt === 'pdf') { const blob = await PPS.Export.pdf(p, { dpi, signal: sig, onProgress }); U.download(blob, base + '.pdf'); UI.toast('PDF selesai (' + U.fmtBytes(blob.size) + ').', 'success'); }
        else {
          const files = await PPS.Export.images(p, fmt, { dpi, quality: st.export.jpegQuality, signal: sig, onProgress });
          if (files.length > 1 && st.export.zip) { onProgress(0.98, 'Membuat ZIP…'); U.download(await U.zip(files), base + '.zip'); } else files.forEach((f, i) => setTimeout(() => U.download(f.blob, f.name), i * 400));
          UI.toast(`${files.length} halaman ${fmt.toUpperCase()} selesai.`, 'success');
        }
      });
    } catch (e) { UI.toast(/Dibatalkan/.test(e.message) ? 'Export dibatalkan.' : 'Export gagal: ' + (e.message || e), /Dibatalkan/.test(e.message) ? 'info' : 'danger', 9000); }
  }
  async function doPrint() {
    try { await withProgress('Menyiapkan cetak…', (sig, onProgress) => PPS.Export.print(App.project, { dpi: Math.min(App.project.settings.export.dpi, 300), onProgress })); }
    catch (e) { UI.toast('Gagal menyiapkan cetak: ' + (e.message || e), 'danger'); }
  }

  // ====================================================================== pengaturan
  async function renderSettings() {
    const prefs = appPrefs(); const custom = C.customSizes(); const usage = await S.estimateUsage();
    $('#view-settings').innerHTML = `<div class="page-head"><div><h1>Pengaturan</h1><p class="text-muted mb-0">Konfigurasi ukuran, penyimpanan lokal, dan informasi aplikasi.</p></div></div>
    <div class="row g-3"><div class="col-lg-7">
      <div class="card-x mb-3"><div class="d-flex justify-content-between align-items-center mb-2"><h2 class="h6 mb-0">Ukuran baku produksi (mm)</h2></div>
        <div class="table-responsive"><table class="table table-sm mb-0"><tbody>${C.SIZES.map((s) => `<tr><td>${esc(s.name)}</td><td class="text-muted small">${esc(s.group)}</td><td class="text-end">${s.w} × ${s.h} mm</td></tr>`).join('')}</tbody></table></div>
        <div class="small text-muted mt-2">Ukuran baku disimpan terpusat di <code>config.js</code> (mudah diedit bila standar produksi berubah). Pas foto: 2×3 = 22×33, 3×4 = 30×40, 4×6 = 38×56 mm.</div></div>
      <div class="card-x mb-3"><div class="d-flex justify-content-between align-items-center mb-2"><h2 class="h6 mb-0">Preset ukuran custom</h2><button class="btn btn-sm btn-primary" data-act="sz-add"><i data-lucide="plus"></i> Tambah preset</button></div>
        ${custom.length ? `<div class="table-responsive"><table class="table table-sm align-middle mb-0"><tbody>${custom.map((s) => `<tr data-sid="${esc(s.id)}"><td>${esc(s.name)}</td><td class="text-end">${s.w} × ${s.h} mm</td><td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-act="sz-edit"><i data-lucide="pencil"></i></button> <button class="btn btn-sm btn-outline-danger" data-act="sz-del"><i data-lucide="trash-2"></i></button></td></tr>`).join('')}</tbody></table></div>` : '<div class="text-muted small">Belum ada preset custom.</div>'}
        <div class="small text-muted mt-2">Mengubah/menghapus preset tidak mengubah ukuran yang sudah dipakai pada proyek.</div></div>
      <div class="card-x"><h2 class="h6">Aplikasi</h2><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="set-autosave" ${prefs.autosave === false ? '' : 'checked'}><label class="form-check-label" for="set-autosave">Simpan otomatis (auto-save)</label></div></div>
    </div><div class="col-lg-5">
      <div class="card-x mb-3"><h2 class="h6">Penyimpanan lokal</h2><div class="small mb-2">${usage ? `Terpakai ± <b>${U.fmtBytes(usage.usage || 0)}</b> dari kuota ± ${U.fmtBytes(usage.quota || 0)}` : 'Perkiraan penyimpanan tidak tersedia.'}</div>
        <div class="d-grid gap-2"><button class="btn btn-sm btn-outline-secondary" data-act="persist"><i data-lucide="hard-drive"></i> Minta penyimpanan permanen</button><button class="btn btn-sm btn-outline-secondary" data-act="gc"><i data-lucide="eraser"></i> Bersihkan data tak terpakai</button><button class="btn btn-sm btn-outline-danger" data-act="wipe"><i data-lucide="trash-2"></i> Hapus SEMUA data aplikasi</button></div>
        <div class="small text-muted mt-2">Foto pelanggan hanya disimpan di IndexedDB browser ini dan tidak dikirim ke server mana pun.</div></div>
      <div class="card-x mb-3"><h2 class="h6">Background removal</h2><div class="small text-muted">Model AI dijalankan di browser dan diunduh sekali dari CDN (file model saja; foto tidak dikirim). Metode “API eksternal” hanya aktif bila Anda mengisinya dan menyetujui setiap pengiriman. Detail ada di editor Background.</div></div>
      <div class="card-x"><h2 class="h6">Tentang</h2><div class="small"><b>PHOTO PRINT STUDIO</b> — KRISNA DIGITAL<br>Professional Photo Layout &amp; Print Studio<br>Versi ${C.VERSION} • Chrome &amp; Edge<br><span class="text-muted">Panduan lengkap: README.md</span></div></div>
    </div></div>`;
    UI.icons();
  }
  function wireSettings() {
    const el = $('#view-settings');
    el.addEventListener('change', (e) => { if (e.target.id === 'set-autosave') { const p = appPrefs(); p.autosave = e.target.checked; C.saveAppSettings(p); UI.toast(e.target.checked ? 'Auto-save aktif.' : 'Auto-save dimatikan — gunakan tombol Simpan.', 'info'); } });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; const act = b.dataset.act;
      try {
        if (act === 'sz-add') { if (await customSizeDialog()) renderSettings(); }
        else if (act === 'sz-edit') { const s = C.customSizes().find((x) => x.id === b.closest('[data-sid]').dataset.sid); if (s && (await customSizeDialog(s))) renderSettings(); }
        else if (act === 'sz-del') { const id = b.closest('[data-sid]').dataset.sid; const s = C.customSizes().find((x) => x.id === id); if (s && (await UI.confirm(`Hapus preset “${s.name}”?`, { okText: 'Hapus', danger: true }))) { C.saveCustomSizes(C.customSizes().filter((x) => x.id !== id)); renderSettings(); } }
        else if (act === 'persist') { const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; UI.toast(ok ? 'Penyimpanan ditandai permanen.' : 'Browser tidak memberi penyimpanan permanen (mungkin perlu memasang aplikasi / menandai situs).', ok ? 'success' : 'warning'); }
        else if (act === 'gc') { await App.save(); let n = 0; for (const p of await S.listProjects()) n += await S.gc(p); UI.toast(`${n} data tak terpakai dibersihkan.`, 'success'); renderSettings(); }
        else if (act === 'wipe') {
          if (!(await UI.confirm('Hapus SEMUA proyek, foto, riwayat, dan preset dari browser ini? Tindakan ini tidak dapat dibatalkan.', { okText: 'Hapus semuanya', danger: true, title: 'Hapus semua data' }))) return;
          const list = await S.listProjects(); for (const p of list) await S.deleteProject(p.id); localStorage.removeItem('pps.customSizes'); localStorage.removeItem('pps.app'); localStorage.removeItem('pps.bgapi'); App.dirty = false; await createProject({ name: 'Proyek Baru' }); UI.toast('Semua data dihapus.', 'success'); renderSettings();
        }
      } catch (err) { UI.toast('Gagal: ' + (err.message || err), 'danger'); }
    });
  }

  // ====================================================================== navigasi
  const renderers = { projects: renderProjects, people: renderPeople, layout: () => PPS.LayoutView.show(), recap: renderRecap, export: renderExport, settings: renderSettings };
  App.show = (view) => {
    App.view = view; $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('#content').scrollTop = 0; Promise.resolve(renderers[view]()).catch((e) => UI.toast('Gagal menampilkan halaman: ' + e.message, 'danger')); UI.icons();
  };
  function buildNav() {
    const html = VIEWS.map((v) => `<button class="nav-item" data-view="${v.id}"><i data-lucide="${v.icon}"></i><span>${v.label}</span></button>`).join('');
    $('#nav').innerHTML = html; $('#bottom-nav').innerHTML = html; $('#app-version').textContent = 'v' + C.VERSION;
    document.addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) App.show(b.dataset.view); });
  }

  // ====================================================================== start
  async function init() {
    try {
      buildNav(); UI.icons();
      await S.init();
      PPS.LayoutView.init(); wireProjects(); wirePeople(); wireCrop(); wireExport(); wireSettings();
      $('#btn-save').onclick = async () => { try { await App.save('Simpan manual'); UI.toast('Proyek tersimpan.', 'success', 1800); } catch (e) { /* sudah ditampilkan */ } };
      document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#btn-save').click(); } });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && App.dirty) App.save().catch(() => {}); });
      window.addEventListener('beforeunload', (e) => { if (App.dirty) { App.save().catch(() => {}); e.preventDefault(); e.returnValue = ''; } });
      window.addEventListener('error', (e) => { console.error(e.error || e.message); });
      window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); UI.toast('Terjadi galat: ' + ((e.reason && e.reason.message) || e.reason), 'danger'); });
      const prefs = appPrefs(); let id = prefs.lastProject; const list = await S.listProjects();
      if (!id || !list.some((x) => x.id === id)) id = list.length ? list[0].id : null;
      if (id) await openProject(id); else await createProject({ name: 'Proyek Baru' });
      App.show('projects');
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      console.error(e);
      $('#content').innerHTML = `<div class="alert alert-danger m-4"><b>Aplikasi tidak dapat dimulai.</b><br>${esc(e.message || e)}<br><small>Gunakan Chrome/Edge terbaru dan pastikan penyimpanan situs tidak diblokir (bukan mode privat).</small></div>`;
    }
  }
  App.renderPeople = renderPeople; App.openBgStudio = openBgStudio;
  document.addEventListener('DOMContentLoaded', init);
  $('#view-recap').addEventListener('click', (e) => { if (e.target.closest('[data-act="csv"]')) exportCsv(); });
})();
