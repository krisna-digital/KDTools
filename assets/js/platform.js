/* Navbar global KRISNA DIGITAL.
   Hanya berisi link Dashboard + semua aplikasi. Daftar aplikasi dibaca dari apps.js
   (muat apps.js sebelum file ini). Tombol aksi milik aplikasi tetap berada di aplikasinya. */
(() => {
  const path = location.pathname;
  const marker = path.lastIndexOf('/apps/');
  const base = marker >= 0 ? '../'.repeat(path.slice(marker + 1).split('/').length - 1) : '';
  const list = typeof APPS !== 'undefined' && Array.isArray(APPS) ? APPS : [];
  const active = list.find((a) => a.url && path.includes('/' + a.url.replace(/\/$/, '') + '/'));

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const link = (label, url, current) => `<a class="kd-link" href="${esc(base + url)}"${current ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  let title = active ? active.name : 'Dashboard';
  if (active && active.id === 'print-layout' && path.endsWith('/idcard.html')) title += ' · ID Card';

  const nav = document.createElement('nav');
  nav.className = 'kd-global-nav';
  nav.setAttribute('aria-label', 'Navigasi utama KRISNA DIGITAL');
  nav.innerHTML = `<a class="kd-brand" href="${esc(base)}index.html">KRISNA <b>DIGITAL</b></a>`
    + `<span class="kd-app-title">${esc(title)}</span>`
    + `<div class="kd-nav-tools">`
    + `<button type="button" class="kd-menu-toggle" aria-label="Buka menu aplikasi" aria-expanded="false"><span></span><span></span><span></span></button>`
    + `<div class="kd-links">${link('Dashboard', 'index.html', !active)}<span class="kd-sep" aria-hidden="true"></span>`
    + list.map((a) => link(a.name, a.url, a === active)).join('')
    + `</div></div>`;
  document.body.insertBefore(nav, document.body.firstChild);

  const toggle = nav.querySelector('.kd-menu-toggle');
  const setOpen = (open) => { nav.classList.toggle('nav-open', open); toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!nav.classList.contains('nav-open')); });
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  window.addEventListener('resize', () => { if (window.innerWidth > 1100) setOpen(false); });

  document.documentElement.dataset.theme = 'dark';
  document.body.dataset.theme = 'dark';
})();
