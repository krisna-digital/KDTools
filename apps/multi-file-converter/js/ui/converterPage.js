// The converter page: drop zone, file list, settings (Recommended / Advanced), queue, results, downloads.

import { h, icon, clear, toast } from './dom.js';
import { CATEGORIES, effectiveOptions, defaultOptions } from '../registry.js';
import { validateFile, acceptAttribute } from '../core/validation.js';
import { JobQueue, STATUS, newId } from '../core/queue.js';
import { formatBytes, extOf, baseName, MAX_FILE_SIZE } from '../core/format.js';
import { ConverterError, ERR, normalizeError } from '../core/errors.js';
import { trackUrl, revokeUrl, releaseJob, killAllWorkers, runDisposers } from '../core/cleanup.js';
import { saveBlob } from '../core/downloadManager.js';
import { createZip } from '../core/zipManager.js';
import { getPref, setPref, addRecent, effectiveConcurrency } from '../core/settings.js';
import { missingLibs, libLabel, hasLib } from '../core/loader.js';
import { renderSettings } from './settingsPanel.js';

const STATUS_LABEL = { pending: 'Ready', invalid: 'Invalid', queued: 'Queued', running: 'Converting', done: 'Done', error: 'Failed', cancelled: 'Cancelled' };

export function mountConverter(root, tool) {
  const cat = CATEGORIES.find((c) => c.id === tool.category);
  const state = {
    items: [],
    mode: getPref('settingsMode') || 'recommended',
    adv: defaultOptions(tool),
    running: false,
    queue: null,
    missing: [],
  };
  const disposers = [];

  // ---------- header ----------
  const missingBanner = h('div', { class: 'banner banner-warn', hidden: true });
  const header = h('header', { class: 'tool-head' },
    h('a', { href: `#/${tool.category}`, class: 'crumb' }, cat.label),
    h('h1', null, tool.title),
    h('p', { class: 'lead' }, tool.description),
  );

  // ---------- drop zone ----------
  const input = h('input', { type: 'file', multiple: tool.id !== 'zip-extract' ? true : true, hidden: true, accept: acceptAttribute(tool), id: 'file-input' });
  const maxLabel = formatBytes(tool.maxSize || MAX_FILE_SIZE);
  const formats = tool.accept.length ? tool.accept.map((e) => e.toUpperCase()).join(', ') : 'Any file type';
  const dropzone = h('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': 'Add files: drop here or press Enter to browse' },
    h('div', { class: 'dz-icon' }, icon('upload', 32)),
    h('div', { class: 'dz-title' }, 'Drag & drop files here'),
    h('div', { class: 'dz-sub' }, 'or'),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => { e.stopPropagation(); input.click(); } }, icon('folder', 18), 'Browse Files'),
    h('div', { class: 'dz-meta' }, h('span', null, `Supported: ${formats}`), h('span', null, `Max ${maxLabel} per file`)),
    input,
  );
  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('over'); }));
  dropzone.addEventListener('drop', (e) => addFiles([...(e.dataTransfer?.files || [])]));
  input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });

  // ---------- list / settings / actions ----------
  const listBox = h('div', { class: 'file-list', 'aria-live': 'polite' });
  const overall = h('div', { class: 'overall', hidden: true },
    h('div', { class: 'overall-text' }), h('div', { class: 'bar' }, h('div', { class: 'bar-fill' })));
  const settingsBox = h('section', { class: 'card settings' });
  const actions = h('div', { class: 'actions' });
  const privacy = h('p', { class: 'privacy-note' }, icon('lock', 16), 'Your files are processed locally in your browser. We do not upload or store your files on external servers.');

  const layout = h('div', { class: 'converter-grid' },
    h('div', { class: 'col-main' }, missingBanner, dropzone, listBox, overall, actions),
    h('div', { class: 'col-side' }, settingsBox, privacy),
  );
  root.append(header, layout);

  // ---------- helpers ----------
  const valid = () => state.items.filter((i) => i.status !== STATUS.INVALID);
  const convertible = () => state.items.filter((i) => [STATUS.PENDING, STATUS.ERROR, STATUS.CANCELLED].includes(i.status) || (i.status === STATUS.DONE && !i.outputs?.length));
  const doneItems = () => state.items.filter((i) => i.status === STATUS.DONE && i.outputs?.length);
  const currentOptions = () => {
    const o = effectiveOptions(tool, state.mode, state.adv, state.items.map((i) => i.file));
    if (tool.id === 'zip-extract') return o;
    return o;
  };

  async function addFiles(files) {
    if (state.running) { toast('Wait for the current conversion to finish, or cancel it first.', 'info'); return; }
    if (!files.length) return;
    let invalid = 0;
    for (const file of files) {
      const dup = state.items.find((i) => i.file.name === file.name && i.file.size === file.size && i.file.lastModified === file.lastModified);
      if (dup) continue;
      const item = { id: newId(), file, status: STATUS.PENDING, progress: 0, message: '', warnings: [], outputs: [], thumb: null, ext: extOf(file.name) };
      state.items.push(item);
      const v = tool.accept.length || true ? await validateFile(file, tool) : { ok: true };
      if (!v.ok) { item.status = STATUS.INVALID; item.error = v.error; item.message = v.error.message; invalid++; }
      else item.warnings.push(...v.warnings);
      render();
      if (v.ok) prepareItem(item);
    }
    if (invalid) toast(`${invalid} file(s) were rejected. See the list for details.`, 'error');
  }

  async function prepareItem(item) {
    try {
      if (tool.preview === 'image') {
        const { makeThumbnail } = await import('../converters/image.js');
        const t = await makeThumbnail(item.file);
        if (t && state.items.includes(item)) { item.thumb = trackUrl(t); render(); }
      } else if (tool.preview === 'audio' || tool.preview === 'video') {
        const el = document.createElement(tool.preview === 'audio' ? 'audio' : 'video');
        if (el.canPlayType && (el.canPlayType(item.file.type) || /^(audio|video)\//.test(item.file.type))) { item.playUrl = trackUrl(item.file); render(); }
      } else if (tool.preview === 'zip') {
        const { previewZip } = await import('../converters/archive.js');
        const info = await previewZip(item.file);
        item.zip = info; item.selection = new Set(info.entries.filter((e) => !e.dir).map((e) => e.path)); render();
      }
    } catch (e) {
      if (tool.preview === 'zip') { item.status = STATUS.INVALID; item.error = normalizeError(e); item.message = item.error.message; render(); }
    }
  }

  function removeItem(item) {
    if (state.running) return;
    cleanItem(item);
    state.items = state.items.filter((i) => i !== item);
    render();
  }
  function cleanItem(item) {
    if (item.thumb) revokeUrl(item.thumb);
    if (item.playUrl) revokeUrl(item.playUrl);
    releaseJob(item);
    item.zip = null;
  }
  function clearAll() {
    if (state.running) state.queue?.cancelAll();
    state.items.forEach(cleanItem);
    state.items = [];
    render();
  }

  // ---------- conversion ----------
  async function convert(only) {
    if (state.running) return;
    const missing = await missingLibs(tool.needs || []);
    if (missing.length) { toast(`This converter is unavailable: ${missing.map(libLabel).join(', ')} not included in this build.`, 'error'); return; }
    const todo = (only || convertible()).filter((i) => i.status !== STATUS.INVALID);
    if (!todo.length) { toast('Add at least one valid file first.', 'info'); return; }
    const options = currentOptions();
    if (tool.id === 'zip-extract') {
      /* per-item selection is applied below */
    }
    addRecent(tool.id);
    todo.forEach((i) => { releaseJob(i); i.warnings = i.warnings.filter((w) => !i.runWarnings?.includes(w)); });

    const grouped = tool.group || tool.groupWhen?.(options);
    const jobs = [];
    if (grouped && todo.length) {
      const job = { id: newId(), label: `${todo.length} files`, group: todo, outputs: [], warnings: [] };
      jobs.push(job);
    } else {
      todo.forEach((i) => { i.label = i.file.name; jobs.push(i); });
    }
    state.running = true;
    state.queue = new JobQueue({
      concurrency: grouped ? 1 : effectiveConcurrency(tool.heavy),
      onUpdate: (job) => { if (job.group) syncGroup(job); updateItem(job.group ? null : job); updateOverall(); },
      run: async (job, { signal, onProgress }) => {
        const opts = { ...options };
        if (job.group) return tool.run({ files: job.group.map((i) => i.file), tool, options: opts, signal, onProgress });
        if (tool.id === 'zip-extract') opts.selection = job.selection;
        return tool.run({ file: job.file, tool, options: opts, signal, onProgress });
      },
    });
    render();
    try { await state.queue.start(jobs); }
    finally {
      state.running = false; state.queue = null;
      jobs.forEach((j) => { if (j.group) { syncGroup(j); j.group.forEach((i) => { i.runWarnings = i.warnings.slice(); }); } else j.runWarnings = j.warnings.slice(); });
      // free heavy engines when the batch is over (they are re-created on demand)
      runDisposers();
      killAllWorkers();
      render();
      const ok = state.items.filter((i) => i.status === STATUS.DONE).length, bad = state.items.filter((i) => i.status === STATUS.ERROR).length;
      if (ok || bad) toast(`${ok} converted${bad ? `, ${bad} failed` : ''}.`, bad ? 'error' : 'success');
    }
  }

  function syncGroup(job) {
    for (const i of job.group) {
      i.status = job.status; i.progress = job.progress; i.message = job.message; i.error = job.error;
      if (job.status === STATUS.DONE) { i.outputs = i === job.group[0] ? job.outputs : []; i.warnings = [...new Set([...(i.warnings || []), ...(job.warnings || [])])]; i.groupDone = true; }
    }
  }

  function cancelAll() { state.queue?.cancelAll(); }

  // ---------- downloads ----------
  function outName(o) { return o.name.split('/').pop(); }

  function downloadOutput(item, o) {
    try {
      saveBlob(o.blob, outName(o));
      o.downloaded = true;
      if (getPref('releaseAfterDownload')) {
        if (o.url) revokeUrl(o.url);
        o.blob = null; o.url = null; o.released = true;
      }
      render();
    } catch (e) { toast(normalizeError(e).message, 'error'); }
  }

  async function downloadAll() {
    const entries = [];
    for (const it of doneItems()) for (const o of it.outputs) if (o.blob) entries.push({ name: o.name, blob: o.blob });
    if (!entries.length) { toast('Nothing left to download. Convert again to get the files.', 'info'); return; }
    const btn = actions.querySelector('[data-zip]'); if (btn) btn.disabled = true;
    try {
      const blob = await createZip(entries, { level: 6 });
      saveBlob(blob, `converted-${tool.id}.zip`);
      if (getPref('releaseAfterDownload')) {
        for (const it of doneItems()) for (const o of it.outputs) { if (o.url) revokeUrl(o.url); o.blob = null; o.url = null; o.released = true; o.downloaded = true; }
      }
    } catch (e) { toast(normalizeError(new ConverterError(ERR.DOWNLOAD, e.message)).message, 'error'); }
    render();
  }

  // ---------- rendering ----------
  const itemEls = new Map();

  function render() {
    renderList(); renderSettingsPanel(); renderActions(); updateOverall(); renderBanner();
  }

  async function renderBanner() {
    const m = await missingLibs(tool.needs || []);
    state.missing = m;
    clear(missingBanner);
    if (m.length) {
      missingBanner.hidden = false;
      missingBanner.append(icon('alert', 18), h('div', null, h('strong', null, 'Not available in this build. '), `Missing: ${m.map(libLabel).join(', ')}. The deployment must include these libraries (run `, h('code', null, 'npm install && npm run vendor'), `). See the README.`));
    } else missingBanner.hidden = true;
    renderActions();
  }

  function renderList() {
    clear(listBox); itemEls.clear();
    if (!state.items.length) { listBox.hidden = true; return; }
    listBox.hidden = false;
    for (const item of state.items) listBox.append(buildItem(item));
  }

  function updateItem(item) {
    if (!item) { renderList(); renderActions(); return; }
    const el = itemEls.get(item.id);
    if (!el) return;
    const fresh = buildItem(item);
    el.replaceWith(fresh);
  }

  function buildItem(item) {
    const preview = item.thumb ? h('img', { class: 'thumb', src: item.thumb, alt: '' }) : h('div', { class: 'thumb ph' }, icon(cat.icon, 22));
    const stat = h('span', { class: `status st-${item.status}` }, STATUS_LABEL[item.status] || item.status);
    const row = h('div', { class: `file-item st-${item.status}`, dataset: { id: item.id } },
      preview,
      h('div', { class: 'fi-main' },
        h('div', { class: 'fi-name', title: item.file.name }, item.file.name),
        h('div', { class: 'fi-meta' }, formatBytes(item.file.size), ' · ', stat, item.message && item.status !== STATUS.DONE && item.status !== STATUS.PENDING ? h('span', { class: 'fi-msg' }, ' – ', item.message) : null),
        item.status === STATUS.RUNNING || item.status === STATUS.QUEUED ? h('div', { class: 'bar small' }, h('div', { class: 'bar-fill', style: { width: `${Math.round(item.progress * 100)}%` } })) : null,
        item.status === STATUS.INVALID || item.status === STATUS.ERROR ? h('div', { class: 'fi-error' }, icon('alert', 15), item.error?.message || item.message) : null,
        ...(item.warnings || []).slice(0, 6).map((w) => h('div', { class: 'fi-warn' }, icon('info', 14), w)),
        item.playUrl && tool.preview === 'audio' ? h('audio', { src: item.playUrl, controls: true, preload: 'none' }) : null,
        item.playUrl && tool.preview === 'video' ? h('video', { src: item.playUrl, controls: true, preload: 'none', class: 'vprev' }) : null,
        item.zip ? buildZipPreview(item) : null,
        item.status === STATUS.DONE ? buildOutputs(item) : null,
      ),
      h('div', { class: 'fi-actions' },
        item.status === STATUS.ERROR && item.error?.retryable !== false ? h('button', { class: 'icon-btn', title: 'Retry', 'aria-label': 'Retry', disabled: state.running, onclick: () => convert([item]) }, icon('refresh', 18)) : null,
        h('button', { class: 'icon-btn', title: 'Remove', 'aria-label': `Remove ${item.file.name}`, disabled: state.running, onclick: () => removeItem(item) }, icon('x', 18)),
      ),
    );
    itemEls.set(item.id, row);
    return row;
  }

  function buildZipPreview(item) {
    const files = item.zip.entries.filter((e) => !e.dir);
    const shown = files.slice(0, 300);
    const checkAll = h('input', { type: 'checkbox', checked: item.selection.size === files.length, onchange: (e) => { item.selection = new Set(e.target.checked ? files.map((f) => f.path) : []); updateItem(item); } });
    const selSize = files.filter((f) => item.selection.has(f.path)).reduce((n, f) => n + (f.size || 0), 0);
    return h('details', { class: 'zip-prev', open: files.length <= 20 },
      h('summary', null, `${files.length} files · ${formatBytes(item.zip.totalSize)} uncompressed · ${item.selection.size} selected (${formatBytes(selSize)})`),
      h('label', { class: 'zip-row all' }, checkAll, 'Select all'),
      h('div', { class: 'zip-list' }, shown.map((f) => h('label', { class: 'zip-row' },
        h('input', { type: 'checkbox', checked: item.selection.has(f.path), onchange: (e) => { e.target.checked ? item.selection.add(f.path) : item.selection.delete(f.path); updateItem(item); } }),
        h('span', { class: 'zp' }, f.path), h('span', { class: 'zs' }, f.size != null ? formatBytes(f.size) : '')))),
      files.length > shown.length ? h('div', { class: 'muted' }, `…and ${files.length - shown.length} more (all selected files are extracted).`) : null,
    );
  }

  function buildOutputs(item) {
    const wrap = h('div', { class: 'outputs' });
    const outs = item.outputs || [];
    if (!outs.length && item.groupDone) { wrap.append(h('div', { class: 'muted' }, 'Included in the combined result above.')); return wrap; }
    const MAX = 40;
    outs.slice(0, MAX).forEach((o) => {
      const row = h('div', { class: 'out-row' }, icon('file', 16), h('span', { class: 'out-name', title: o.name }, outName(o)), h('span', { class: 'muted' }, o.blob ? formatBytes(o.blob.size) : ''));
      if (o.blob) {
        if (o.kind === 'image' && o.blob.size < 25e6) { o.url ||= trackUrl(o.blob); row.prepend(h('img', { class: 'out-thumb', src: o.url, alt: '' })); }
        row.append(h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => downloadOutput(item, o) }, icon('download', 15), 'Download'));
      } else row.append(h('span', { class: 'muted' }, o.downloaded ? 'Downloaded · released from memory' : 'Released'));
      wrap.append(row);
      if (o.blob && o.kind === 'audio') { o.url ||= trackUrl(o.blob); wrap.append(h('audio', { src: o.url, controls: true, preload: 'none' })); }
      if (o.blob && o.kind === 'video') { o.url ||= trackUrl(o.blob); wrap.append(h('video', { src: o.url, controls: true, preload: 'none', class: 'vprev' })); }
    });
    if (outs.length > MAX) wrap.append(h('div', { class: 'muted' }, `+ ${outs.length - MAX} more files – use “Download All as ZIP”.`));
    return wrap;
  }

  function renderSettingsPanel() {
    renderSettings(settingsBox, {
      tool, mode: state.mode, values: state.adv, disabled: state.running,
      recommended: tool.recommended?.(state.items.map((i) => i.file)) || {},
      onMode: (m) => { state.mode = m; setPref('settingsMode', m); renderSettingsPanel(); },
      onChange: (id, v) => { state.adv[id] = v; renderSettingsPanel(); renderActions(); },
      onReset: () => { state.adv = defaultOptions(tool); renderSettingsPanel(); },
    });
  }

  function renderActions() {
    clear(actions);
    const hasFiles = state.items.length > 0;
    const doneCount = doneItems().reduce((n, i) => n + i.outputs.filter((o) => o.blob).length, 0);
    const blocked = state.missing.length > 0;
    const convertLabel = tool.group || tool.groupWhen?.(currentOptions()) ? 'Convert & combine' : (state.items.length > 1 ? 'Convert all' : 'Convert');
    if (state.running) {
      actions.append(h('button', { class: 'btn btn-danger', type: 'button', onclick: cancelAll }, icon('stop', 16), 'Cancel'));
    } else {
      actions.append(h('button', { class: 'btn btn-primary btn-lg', type: 'button', disabled: !convertible().length || blocked, title: blocked ? 'Converter not available in this build' : '', onclick: () => convert() }, icon('play', 16), convertLabel));
    }
    actions.append(
      h('button', { class: 'btn', type: 'button', 'data-zip': '1', disabled: state.running || doneCount < 1, onclick: downloadAll }, icon('archive', 18), 'Download All as ZIP'),
      h('button', { class: 'btn btn-ghost', type: 'button', disabled: !hasFiles, onclick: clearAll }, icon('trash', 18), 'Clear Files'),
    );
    if (state.items.some((i) => i.status === STATUS.ERROR && i.error?.retryable !== false) && !state.running) {
      actions.append(h('button', { class: 'btn', type: 'button', onclick: () => convert(state.items.filter((i) => i.status === STATUS.ERROR)) }, icon('refresh', 18), 'Retry failed'));
    }
  }

  function updateOverall() {
    const active = state.items.filter((i) => i.status !== STATUS.INVALID);
    const show = state.running || active.some((i) => [STATUS.DONE, STATUS.ERROR].includes(i.status));
    overall.hidden = !show || !active.length;
    if (overall.hidden) return;
    const total = active.length;
    const p = active.reduce((n, i) => n + ([STATUS.DONE, STATUS.ERROR, STATUS.CANCELLED].includes(i.status) ? 1 : (i.progress || 0)), 0) / total;
    const done = active.filter((i) => i.status === STATUS.DONE).length, failed = active.filter((i) => i.status === STATUS.ERROR).length;
    overall.querySelector('.overall-text').textContent = state.running ? `Converting… ${Math.round(p * 100)}% · ${done}/${total} done${failed ? ` · ${failed} failed` : ''}` : `Finished · ${done} of ${total} converted${failed ? ` · ${failed} failed` : ''}`;
    overall.querySelector('.bar-fill').style.width = `${Math.round(p * 100)}%`;
  }

  render();

  // Release everything when leaving this page.
  return () => {
    state.queue?.cancelAll();
    state.items.forEach(cleanItem);
    state.items = [];
    killAllWorkers();
    runDisposers();
    disposers.forEach((d) => d());
  };
}

export { hasLib };
