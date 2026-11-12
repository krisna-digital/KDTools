// Non-converter pages: Home, category pages, All Tools, Settings, About.

import { h, icon, clear, toast } from './dom.js';
import { CATEGORIES, TOOLS, getTool, toolsIn } from '../registry.js';
import { getPref, setPref, onPrefChange, clearRecent, resetPrefs, applyTheme } from '../core/settings.js';
import { getManifest, libLabel } from '../core/loader.js';
import { formatBytes, MAX_FILE_SIZE } from '../core/format.js';

const catIcon = (id) => CATEGORIES.find((c) => c.id === id)?.icon || 'file';

export function toolCard(t, { showCat = false } = {}) {
  return h('a', { class: 'tool-card', href: `#/tool/${t.id}`, dataset: { cat: t.category } },
    h('div', { class: `tc-icon cat-${t.category}` }, icon(catIcon(t.category), 22)),
    h('div', { class: 'tc-body' },
      h('div', { class: 'tc-title' }, t.title),
      h('div', { class: 'tc-sub' }, showCat ? CATEGORIES.find((c) => c.id === t.category).label : (t.from === 'img' || t.from === 'any' ? 'Any supported file' : `${(t.accept[0] || '').toUpperCase()} → ${String(t.to).toUpperCase()}`))),
    icon('chevron', 18, 'tc-arrow'));
}

function searchBox(onInput, value = '') {
  const input = h('input', { type: 'search', placeholder: 'Search converters (e.g. “pdf to word”, “heic”, “mp3”)', 'aria-label': 'Search converters', value, oninput: (e) => onInput(e.target.value) });
  return { el: h('label', { class: 'search' }, icon('search', 18), input), input };
}

export function matchTools(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return TOOLS.filter((t) => {
    const hay = `${t.title} ${t.from} ${t.to} ${t.accept.join(' ')} ${t.category} ${t.description}`.toLowerCase();
    return terms.every((x) => hay.includes(x.replace(/^to$/, '')));
  }).slice(0, 24);
}

export function renderHome(root) {
  const results = h('div', { class: 'grid tools', hidden: true });
  const sb = searchBox((v) => {
    const r = matchTools(v);
    clear(results); results.hidden = !v.trim();
    if (v.trim() && !r.length) results.append(h('p', { class: 'muted' }, 'No converter matches that search.'));
    r.forEach((t) => results.append(toolCard(t, { showCat: true })));
  });
  const recent = (getPref('recent') || []).map(getTool).filter(Boolean);
  const popular = TOOLS.filter((t) => t.popular).slice(0, 9);

  root.append(
    h('section', { class: 'hero' },
      h('h1', null, 'Convert any file, right in your browser'),
      h('p', { class: 'lead' }, 'Documents, images, audio, video and archives – converted locally on your device. No uploads, no accounts, no servers.'),
      sb.el, results),
    h('section', { class: 'info-row' },
      h('div', { class: 'info-card' }, icon('shield', 22), h('div', null, h('strong', null, 'Private by design'), h('p', null, 'Your files are processed locally in your browser. We do not upload or store your files on external servers.'))),
      h('div', { class: 'info-card' }, icon('file', 22), h('div', null, h('strong', null, `Up to ${formatBytes(MAX_FILE_SIZE)} per file`), h('p', null, 'This is a target limit. Whether a very large file works depends on your device memory and the format – you will get a clear message if it cannot be processed.'))),
      h('div', { class: 'info-card' }, icon('zap', 22), h('div', null, h('strong', null, 'Batch & ZIP'), h('p', null, 'Convert many files at once and download everything in a single ZIP.')))),
    h('section', null, h('h2', { class: 'sec' }, 'Categories'),
      h('div', { class: 'grid cats' }, CATEGORIES.map((c) => h('a', { class: 'cat-card', href: `#/${c.id}` },
        h('div', { class: `tc-icon cat-${c.id}` }, icon(c.icon, 26)), h('div', null, h('div', { class: 'tc-title' }, c.label), h('div', { class: 'tc-sub' }, c.blurb), h('div', { class: 'tc-count' }, `${toolsIn(c.id).length} tools`)))))),
    h('section', null, h('h2', { class: 'sec' }, 'Popular converters'), h('div', { class: 'grid tools' }, popular.map((t) => toolCard(t)))),
    recent.length ? h('section', null,
      h('div', { class: 'sec-row' }, h('h2', { class: 'sec' }, 'Recently used'), h('button', { class: 'btn btn-ghost btn-small', onclick: () => { clearRecent(); toast('Recent tools cleared.', 'success'); location.reload(); } }, 'Clear')),
      h('p', { class: 'muted' }, 'Only tool names are remembered on this device – never your files or file names.'),
      h('div', { class: 'grid tools' }, recent.map((t) => toolCard(t)))) : null,
  );
}

export function renderCategory(root, catId) {
  const cat = CATEGORIES.find((c) => c.id === catId);
  root.append(
    h('header', { class: 'tool-head' }, h('a', { href: '#/', class: 'crumb' }, 'Home'), h('h1', null, cat.label), h('p', { class: 'lead' }, cat.blurb)),
    h('div', { class: 'grid tools' }, toolsIn(catId).map((t) => toolCard(t))));
}

export function renderAll(root) {
  const list = h('div');
  const draw = (q) => {
    clear(list);
    const filtered = q.trim() ? matchTools(q) : null;
    if (filtered) { list.append(h('div', { class: 'grid tools' }, filtered.length ? filtered.map((t) => toolCard(t, { showCat: true })) : h('p', { class: 'muted' }, 'No converter matches that search.'))); return; }
    for (const c of CATEGORIES) list.append(h('h2', { class: 'sec' }, c.label), h('div', { class: 'grid tools' }, toolsIn(c.id).map((t) => toolCard(t))));
  };
  const sb = searchBox(draw);
  root.append(h('header', { class: 'tool-head' }, h('h1', null, 'All Tools'), h('p', { class: 'lead' }, `${TOOLS.length} converters`), sb.el), list);
  draw('');
}

export function renderSettingsPage(root) {
  const themeSel = h('select', { id: 'pref-theme', onchange: (e) => { setPref('theme', e.target.value); applyTheme(); } },
    [['system', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: getPref('theme') === v }, l)));
  const conc = h('select', { id: 'pref-conc', onchange: (e) => setPref('concurrency', Number(e.target.value)) },
    [[0, 'Automatic (recommended)'], [1, '1 file at a time (lowest memory)'], [2, '2 files at a time'], [3, '3 files at a time'], [4, '4 files at a time']].map(([v, l]) => h('option', { value: v, selected: getPref('concurrency') === v }, l)));
  const mode = h('select', { id: 'pref-mode', onchange: (e) => setPref('settingsMode', e.target.value) },
    [['recommended', 'Recommended'], ['advanced', 'Advanced']].map(([v, l]) => h('option', { value: v, selected: getPref('settingsMode') === v }, l)));
  const rel = h('input', { type: 'checkbox', id: 'pref-rel', checked: getPref('releaseAfterDownload'), onchange: (e) => setPref('releaseAfterDownload', e.target.checked) });
  root.append(
    h('header', { class: 'tool-head' }, h('h1', null, 'Settings'), h('p', { class: 'lead' }, 'Preferences are stored only in your browser (localStorage). No file data is ever saved.')),
    h('div', { class: 'card form' },
      h('div', { class: 'field' }, h('label', { for: 'pref-theme' }, 'Theme'), themeSel),
      h('div', { class: 'field' }, h('label', { for: 'pref-mode' }, 'Default settings mode'), mode),
      h('div', { class: 'field' }, h('label', { for: 'pref-conc' }, 'Parallel conversions'), conc, h('small', null, 'Video and audio conversions always run one at a time to protect browser memory.')),
      h('div', { class: 'field field-check' }, h('label', { for: 'pref-rel' }, rel, h('span', null, 'Release a result from memory right after it was downloaded')), h('small', null, 'Recommended. Converted files are never kept longer than needed; turn this off if you want to download the same result more than once.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { clearRecent(); toast('Recently used list cleared.', 'success'); } }, 'Clear recently used'),
        h('button', { class: 'btn btn-ghost', onclick: () => { resetPrefs(); applyTheme(); toast('Preferences reset.', 'success'); location.reload(); } }, 'Reset all preferences'))));
}

export async function renderAbout(root) {
  const m = await getManifest();
  const libs = Object.entries(m.libs || {});
  root.append(
    h('header', { class: 'tool-head' }, h('h1', null, 'About Multi File Converter'), h('p', { class: 'lead' }, 'A static web app that converts documents, images, audio, video and ZIP archives entirely in your browser.')),
    h('div', { class: 'card prose' },
      h('h2', null, 'Privacy'),
      h('p', null, 'Your files are processed locally in your browser. We do not upload or store your files on external servers. There is no backend, no database, no third-party conversion API and no file analytics. Results live in memory only; they are released after download, when you clear the list, when you leave the tool and when you close the tab.'),
      h('p', null, 'The only data saved on your device is a small preferences record (theme, mode, recently used tool names).'),
      h('h2', null, 'How well do conversions work?'),
      h('ul', null,
        h('li', null, h('strong', null, 'Images, CSV ⇄ XLSX, ZIP: '), 'faithful conversions.'),
        h('li', null, h('strong', null, 'Audio / video: '), 'FFmpeg compiled to WebAssembly. Real encoders, but slow compared to desktop FFmpeg and limited by browser memory.'),
        h('li', null, h('strong', null, 'PDF ⇄ Word / Excel / PowerPoint, HTML → PDF: '), 'rebuilt from text and layout information by in-browser code, not by Microsoft Office. Text, tables and pictures are kept where possible; complex layouts will differ from the original. Each result shows what could not be reproduced.')),
      h('h2', null, 'Library status in this deployment'),
      h('ul', { class: 'libs' }, libs.length ? libs.map(([k, ok]) => h('li', { class: ok ? 'ok' : 'no' }, icon(ok ? 'check' : 'x', 16), `${libLabel(k)}${ok && m.versions?.[k] ? ` ${m.versions[k]}` : ''}`, ok ? '' : ' – not included (dependent converters are disabled)')) : h('li', null, 'Library manifest not found.')),
      h('p', { class: 'muted' }, 'Fonts: Liberation Sans/Mono (SIL Open Font License 1.1).')));
}
