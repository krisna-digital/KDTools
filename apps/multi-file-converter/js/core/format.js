// Small formatting / filename helpers shared across the app.

export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB target limit

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '–';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

export function extOf(name = '') {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function baseName(name = '') {
  return name.replace(/\.[A-Za-z0-9]+$/, '') || 'file';
}

/** Make a string safe to use as a file name (also used for ZIP entries). */
export function sanitizeFileName(name, fallback = 'file') {
  const cleaned = String(name || '')
    .replace(/[\u0000-\u001f<>:"\\|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}

/** Sanitize a ZIP entry path: no absolute paths, no `..` segments. */
export function sanitizeZipPath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => sanitizeFileName(s))
    .join('/');
}

/** Returns a function that makes names unique: a.png, a (2).png, ... */
export function uniqueNamer() {
  const used = new Map();
  return (name) => {
    const key = name.toLowerCase();
    const n = used.get(key) || 0;
    used.set(key, n + 1);
    if (n === 0) return name;
    const e = extOf(name);
    const b = e ? name.slice(0, -(e.length + 1)) : name;
    return `${b} (${n + 1})${e ? '.' + e : ''}`;
  };
}

export const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
  svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', html: 'text/html', htm: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', m4a: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg', wma: 'audio/x-ms-wma',
  mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo',
};

export function mimeFor(ext) { return MIME[ext] || 'application/octet-stream'; }

/** Parse "1-3, 5, 8-" into a sorted list of 1-based page numbers (max = total). */
export function parsePageRange(spec, total) {
  const s = String(spec || '').trim();
  if (!s || s.toLowerCase() === 'all') return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set();
  for (const part of s.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(p);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : total;
      if (a < 1 || b < a) throw new Error(`Invalid page range "${p}"`);
      for (let i = a; i <= Math.min(b, total); i++) set.add(i);
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (n < 1) throw new Error(`Invalid page "${p}"`);
      if (n <= total) set.add(n);
    } else {
      throw new Error(`Invalid page range "${p}"`);
    }
  }
  if (!set.size) throw new Error(`Page range "${s}" is outside the document (${total} page${total === 1 ? '' : 's'})`);
  return [...set].sort((a, b) => a - b);
}

export function pad(n, width) { return String(n).padStart(width, '0'); }

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const tick = () => new Promise((r) => setTimeout(r, 0));
