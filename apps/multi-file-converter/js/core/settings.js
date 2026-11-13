// App preferences. Only small preferences are persisted in localStorage
// (theme, concurrency, tool ids used recently). Never file names or contents.

const KEY = 'mfc.prefs.v1';
const DEFAULTS = {
  theme: 'system',            // 'light' | 'dark' | 'system'
  concurrency: 0,             // 0 = automatic
  settingsMode: 'recommended',// default mode on converter pages
  releaseAfterDownload: true, // drop result data from memory right after it was downloaded
  recent: [],                 // tool ids (max 6)
};

let prefs = { ...DEFAULTS };
const listeners = new Set();

try {
  const raw = localStorage.getItem(KEY);
  if (raw) prefs = { ...DEFAULTS, ...JSON.parse(raw) };
} catch { /* storage may be blocked – app still works */ }

export function getPref(k) { return prefs[k]; }

export function setPref(k, v) {
  prefs[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(k, v));
}

export function onPrefChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function addRecent(toolId) {
  const list = [toolId, ...prefs.recent.filter((x) => x !== toolId)].slice(0, 6);
  setPref('recent', list);
}

export function clearRecent() { setPref('recent', []); }

export function resetPrefs() {
  prefs = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach((fn) => fn('*', null));
}

export function effectiveConcurrency(heavy) {
  if (heavy) return 1;
  const c = prefs.concurrency;
  if (c > 0) return c;
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
}

export function applyTheme() {
  // Platform KRISNA DIGITAL selalu memakai dark mode.
  document.documentElement.dataset.theme = 'dark';
}
