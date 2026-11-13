// App shell: sidebar, hash router. Theme is always dark (platform KRISNA DIGITAL).

import { h, icon, clear } from './ui/dom.js';
import { applyTheme } from './core/settings.js';
import { getTool, CATEGORIES } from './registry.js';
import { renderHome, renderCategory, renderAll, renderSettingsPage, renderAbout } from './ui/pages.js';
import { cleanupAll } from './core/cleanup.js';

applyTheme();

const NAV = [
  ['', 'Home', 'home'],
  ...CATEGORIES.map((c) => [c.id, c.label, c.icon]),
  ['all', 'All Tools', 'grid'],
  ['settings', 'Settings', 'settings'],
  ['about', 'About', 'info'],
];

const app = document.getElementById('app');
const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Main navigation' },
  h('a', { class: 'brand', href: '#/' }, h('span', { class: 'logo' }, icon('zap', 20)), h('span', { class: 'brand-name' }, 'Multi File', h('br'), 'Converter')),
  h('nav', null, NAV.map(([id, label, ic]) => h('a', { class: 'nav-item', href: `#/${id}`, dataset: { nav: id } }, icon(ic, 20), h('span', null, label)))),
  h('div', { class: 'side-foot' }, icon('lock', 14), h('span', null, 'Files never leave your device')),
);
const menuBtn = h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Open menu', 'aria-controls': 'sidebar', onclick: () => document.body.classList.toggle('nav-open') }, icon('menu', 22));
const topbar = h('header', { class: 'topbar' }, menuBtn, h('a', { class: 'brand-mini', href: '#/' }, 'Multi File Converter'));
const view = h('main', { class: 'view', id: 'view', tabindex: '-1' });
const scrim = h('div', { class: 'scrim', onclick: () => document.body.classList.remove('nav-open') });
app.append(sidebar, scrim, h('div', { class: 'main-col' }, topbar, view));

let unmount = null;

async function route() {
  document.body.classList.remove('nav-open');
  if (unmount) { try { unmount(); } catch (e) { console.warn(e); } unmount = null; }
  cleanupAll();
  clear(view);
  const hash = location.hash.replace(/^#\/?/, '');
  const [seg, arg] = hash.split('/');
  let navId = seg || '';
  if (seg === 'tool') {
    const tool = getTool(arg);
    if (!tool) { view.append(h('p', { class: 'muted' }, 'Unknown tool.'), h('a', { href: '#/all' }, 'Browse all tools')); document.title = 'Not found – Multi File Converter'; return; }
    navId = tool.category;
    document.title = `${tool.title} – Multi File Converter`;
    const { mountConverter } = await import('./ui/converterPage.js');
    unmount = mountConverter(view, tool);
  } else if (CATEGORIES.some((c) => c.id === seg)) {
    document.title = `${CATEGORIES.find((c) => c.id === seg).label} converters – Multi File Converter`;
    renderCategory(view, seg);
  } else if (seg === 'all') { document.title = 'All Tools – Multi File Converter'; renderAll(view); }
  else if (seg === 'settings') { document.title = 'Settings – Multi File Converter'; renderSettingsPage(view); }
  else if (seg === 'about') { document.title = 'About – Multi File Converter'; await renderAbout(view); }
  else { document.title = 'Multi File Converter – private, in-browser file conversion'; renderHome(view); }
  for (const a of sidebar.querySelectorAll('.nav-item')) a.classList.toggle('active', a.dataset.nav === navId);
  view.scrollTop = 0; window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
}

addEventListener('hashchange', route);
route();
