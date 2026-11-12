// Renders the Recommended / Advanced settings card for a tool. Only fields of this tool are shown.

import { h, icon, clear } from './dom.js';
import { getManifest } from '../core/loader.js';

let manifest = { libs: {} };
getManifest().then((m) => { manifest = m; });

export function renderSettings(box, { tool, mode, values, recommended, disabled, onMode, onChange, onReset }) {
  clear(box);
  const hasFields = (tool.fields || []).length > 0;
  box.append(
    h('div', { class: 'settings-head' }, icon('sliders', 18), h('h2', null, 'Settings')),
    h('div', { class: 'seg', role: 'tablist' },
      ['recommended', 'advanced'].map((m) => h('button', { class: `seg-btn${mode === m ? ' on' : ''}`, role: 'tab', 'aria-selected': mode === m, type: 'button', disabled, onclick: () => onMode(m) }, m === 'recommended' ? 'Recommended' : 'Advanced'))),
  );
  if (mode === 'recommended' || !hasFields) {
    box.append(h('p', { class: 'rec-text' }, icon('zap', 16), h('span', null, h('strong', null, 'Automatic: '), tool.recommendedText || 'Optimal defaults for this conversion.')),
      h('p', { class: 'muted' }, 'Just add your files and press Convert. Switch to Advanced for full control.'));
    return;
  }
  const fields = h('div', { class: 'fields' });
  for (const f of tool.fields) {
    if (f.showIf && !f.showIf(values)) continue;
    fields.append(renderField(f, values, disabled, onChange));
  }
  box.append(fields, h('button', { class: 'btn btn-ghost btn-small', type: 'button', disabled, onclick: onReset }, icon('refresh', 15), 'Reset to defaults'));
}

function renderField(f, values, disabled, onChange) {
  const lib = f.requiresLib && !manifest.libs?.[f.requiresLib];
  const id = `f-${f.id}`;
  const dis = disabled || lib;
  let control;
  const v = values[f.id];
  if (f.type === 'select') {
    control = h('select', { id, disabled: dis, onchange: (e) => onChange(f.id, castLike(f, e.target.value)) },
      f.options.map((o) => h('option', { value: String(o.v), selected: String(o.v) === String(v) }, o.l)));
  } else if (f.type === 'checkbox') {
    return h('div', { class: 'field field-check' },
      h('label', { for: id }, h('input', { id, type: 'checkbox', checked: !!v, disabled: dis, onchange: (e) => onChange(f.id, e.target.checked) }), h('span', null, f.label)),
      f.help ? h('small', null, f.help) : null);
  } else if (f.type === 'range') {
    control = h('div', { class: 'range-wrap' },
      h('input', { id, type: 'range', min: f.min, max: f.max, step: f.step, value: v, disabled: dis, oninput: (e) => { e.target.nextSibling.textContent = e.target.value; }, onchange: (e) => onChange(f.id, Number(e.target.value)) }),
      h('output', null, String(v)));
  } else if (f.type === 'number') {
    control = h('input', { id, type: 'number', min: f.min, max: f.max, step: f.step || 1, value: v ?? '', disabled: dis, placeholder: f.placeholder || '', onchange: (e) => onChange(f.id, e.target.value === '' ? '' : Number(e.target.value)) });
  } else if (f.type === 'color') {
    control = h('input', { id, type: 'color', value: v, disabled: dis, onchange: (e) => onChange(f.id, e.target.value) });
  } else {
    control = h('input', { id, type: 'text', value: v ?? '', placeholder: f.placeholder || '', disabled: dis, onchange: (e) => onChange(f.id, e.target.value) });
  }
  return h('div', { class: 'field' },
    h('label', { for: id }, f.label),
    control,
    lib ? h('small', { class: 'unavail' }, f.unavailable || 'Not available in this build.') : (f.help ? h('small', null, f.help) : null));
}

function castLike(f, raw) {
  const opt = f.options.find((o) => String(o.v) === raw);
  return opt ? opt.v : raw;
}
