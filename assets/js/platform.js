/* Navbar global KRISNA DIGITAL + popup dukungan "Belikan Kopi".
   Navbar berisi link Dashboard + semua aplikasi (dibaca dari apps.js; muat apps.js sebelum file ini)
   dan tombol "Belikan Kopi". Tombol aksi milik aplikasi tetap berada di aplikasinya. */
(() => {
  // ---- Pengaturan dukungan (ubah di sini) ----
  const SUPPORT = {
    qris: 'assets/img/qris.jpeg',        // relatif dari root situs
    merchant: 'KRISNA DIGITAL',         // samakan dengan nama yang muncul saat QRIS di-scan
    message: 'Suka dengan tools ini? Traktir kopi biar developer-nya tetap semangat ☕',
    laterHours: 24,                     // jeda popup otomatis setelah muncul / "Nanti saja"
  };

  const path = location.pathname;
  const marker = path.lastIndexOf('/apps/');
  const base = marker >= 0 ? '../'.repeat(path.slice(marker + 1).split('/').length - 1) : '';
  const list = typeof APPS !== 'undefined' && Array.isArray(APPS) ? APPS : [];
  const active = list.find((a) => a.url && path.includes('/' + a.url.replace(/\/$/, '') + '/'));

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const link = (label, url, current) => `<a class="kd-link" href="${esc(base + url)}"${current ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  let title = active ? active.name : 'Dashboard';
  if (active && active.id === 'print-layout' && path.endsWith('/idcard.html')) title += ' · ID Card';

  // ================================================================ navbar
  const nav = document.createElement('nav');
  nav.className = 'kd-global-nav';
  nav.setAttribute('aria-label', 'Navigasi utama KRISNA DIGITAL');
  nav.innerHTML = `<a class="kd-brand" href="${esc(base)}index.html">KRISNA <b>DIGITAL</b></a>`
    + `<span class="kd-app-title">${esc(title)}</span>`
    + `<div class="kd-nav-tools">`
    + `<button type="button" class="kd-menu-toggle" aria-label="Buka menu aplikasi" aria-expanded="false"><span></span><span></span><span></span></button>`
    + `<div class="kd-links">${link('Dashboard', 'index.html', !active)}<span class="kd-sep" aria-hidden="true"></span>`
    + list.map((a) => link(a.name, a.url, a === active)).join('')
    + `</div></div>`
    + `<button type="button" class="kd-coffee" title="Dukung KRISNA DIGITAL"><span aria-hidden="true">☕</span><span class="kd-coffee-label">Belikan Kopi</span></button>`;
  document.body.insertBefore(nav, document.body.firstChild);

  const toggle = nav.querySelector('.kd-menu-toggle');
  const setOpen = (open) => { nav.classList.toggle('nav-open', open); toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!nav.classList.contains('nav-open')); });
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) setOpen(false); });
  window.addEventListener('resize', () => { if (window.innerWidth > 1100) setOpen(false); });

  document.documentElement.dataset.theme = 'dark';
  document.body.dataset.theme = 'dark';

  // ================================================================ dukungan / QRIS
  const KEY = 'kd-support';
  const HOUR = 36e5;
  const readState = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const writeState = (state) => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage diblokir */ } };
  const shouldAutoShow = () => {
    const s = readState();
    return !s.last || Date.now() - s.last >= SUPPORT.laterHours * HOUR;
  };

  const qrisUrl = base + SUPPORT.qris;
  const pop = document.createElement('div');
  pop.className = 'kd-support';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-labelledby', 'kdSupportTitle');
  pop.innerHTML = `<div class="kd-support-card">
    <button type="button" class="kd-support-x" data-act="close" aria-label="Tutup">×</button>
    <div class="kd-support-cup" aria-hidden="true">☕</div>
    <h2 id="kdSupportTitle"></h2>
    <p class="kd-support-msg">${esc(SUPPORT.message)}</p>
    <div class="kd-support-step" data-step="ask">
      <button type="button" class="kd-sbtn kd-sbtn-primary" data-act="qris">☕ Belikan Kopi</button>
    </div>
    <div class="kd-support-step" data-step="qris" hidden>
      <figure class="kd-qris">
        <img alt="QRIS ${esc(SUPPORT.merchant)}" width="260" height="260" decoding="async">
        <div class="kd-qris-missing" hidden>Gambar QRIS belum tersedia.</div>
        <figcaption>Merchant: <b>${esc(SUPPORT.merchant)}</b></figcaption>
      </figure>
      <p class="kd-support-hint">Scan dengan aplikasi e-wallet atau m-banking. Nominal bebas.<br>Membuka dari HP? Simpan dulu gambarnya, lalu scan dari galeri.</p>
      <button type="button" class="kd-sbtn kd-sbtn-primary" data-act="save">⬇ Simpan QRIS</button>
    </div>
    <div class="kd-support-actions">
      <button type="button" class="kd-sbtn" data-act="later">Nanti saja</button>
    </div>
  </div>`;
  document.body.appendChild(pop);

  const $p = (s) => pop.querySelector(s);
  const img = $p('.kd-qris img');
  const saveBtn = $p('[data-act="save"]');
  let lastFocus = null;

  img.addEventListener('error', () => { img.hidden = true; $p('.kd-qris-missing').hidden = false; saveBtn.disabled = true; });
  img.addEventListener('load', () => { img.hidden = false; $p('.kd-qris-missing').hidden = true; saveBtn.disabled = false; });

  function showStep(step) {
    pop.querySelectorAll('.kd-support-step').forEach((el) => { el.hidden = el.dataset.step !== step; });
    if (step === 'qris' && !img.getAttribute('src')) img.src = qrisUrl;
  }
  function open(mode) {
    lastFocus = document.activeElement;
    $p('#kdSupportTitle').textContent = mode === 'auto' ? 'Unduhan berhasil 🎉' : 'Dukung KRISNA DIGITAL';
    showStep(mode === 'auto' ? 'ask' : 'qris');
    pop.hidden = false;
    document.documentElement.classList.add('kd-support-open');
    (pop.querySelector('.kd-support-step:not([hidden]) .kd-sbtn-primary') || $p('[data-act="close"]')).focus();
  }
  function close() {
    pop.hidden = true;
    document.documentElement.classList.remove('kd-support-open');
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }
  function saveQris() {
    const a = document.createElement('a');
    a.href = qrisUrl;
    a.download = 'QRIS-' + SUPPORT.merchant.replace(/[^\w-]+/g, '-') + '.png';
    a.dataset.kdNoSupport = '1';
    document.body.appendChild(a); a.click(); a.remove();
  }

  pop.addEventListener('click', (e) => {
    if (e.target === pop) return close();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'qris') { showStep('qris'); saveBtn.focus(); }
    else if (act === 'save') saveQris();
    else if (act === 'later') { writeState({ last: Date.now() }); close(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!pop.hidden) { e.stopPropagation(); close(); } else setOpen(false);
  }, true);
  nav.querySelector('.kd-coffee').addEventListener('click', () => open('manual'));

  // ---- Popup otomatis setelah unduhan berhasil dipicu ----
  // Semua app mengunduh lewat <a download> (termasuk jsPDF doc.save), jadi cukup diamati di sini.
  const isDownload = (a) => a instanceof HTMLAnchorElement && a.hasAttribute('download')
    && !a.dataset.kdNoSupport && !/\.json$/i.test(a.getAttribute('download') || '');
  let autoTimer = null;
  function onDownload() {
    if (!shouldAutoShow()) return;
    clearTimeout(autoTimer);
    let tries = 0;
    const tryShow = () => {
      // Tunggu modal app (mis. progres export Bootstrap) tertutup dulu, maksimal ±10 detik.
      if (document.querySelector('.modal.show, dialog[open]') && tries++ < 20) { autoTimer = setTimeout(tryShow, 500); return; }
      if (!pop.hidden || !shouldAutoShow()) return;
      writeState({ last: Date.now() });
      open('auto');
    };
    autoTimer = setTimeout(tryShow, 1500);
  }
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (...args) { if (isDownload(this)) onDownload(); return nativeClick.apply(this, args); };
  const nativeDispatch = EventTarget.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (ev) { if (ev && ev.type === 'click' && isDownload(this)) onDownload(); return nativeDispatch.call(this, ev); };
  document.addEventListener('click', (e) => { if (e.isTrusted && isDownload(e.target.closest?.('a[download]'))) onDownload(); }, true);

  window.KDSupport = { open: () => open('manual') };
})();
