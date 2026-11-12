// PRINTLAY — storage.js
// LocalStorage: pengaturan + riwayat (kecil). IndexedDB: artwork (opsional, atas izin pengguna).

const SETTINGS_KEY = 'printlay.settings.v1';
const HISTORY_KEY = 'printlay.history.v1';
const MAX_HISTORY = 30;

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const loadSettings = () => lsGet(SETTINGS_KEY, null);
export const saveSettings = (s) => lsSet(SETTINGS_KEY, s);
export function resetSettings() { try { localStorage.removeItem(SETTINGS_KEY); } catch { /* abaikan */ } }

export const loadHistory = () => {
  const h = lsGet(HISTORY_KEY, []);
  return Array.isArray(h) ? h : [];
};
export function addHistory(entry) {
  const h = loadHistory();
  h.unshift(entry);
  lsSet(HISTORY_KEY, h.slice(0, MAX_HISTORY));
  return loadHistory();
}
export function clearHistory() { try { localStorage.removeItem(HISTORY_KEY); } catch { /* abaikan */ } }

// ---- IndexedDB untuk artwork ----
const DB_NAME = 'printlay';
const STORE = 'artwork';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB tidak tersedia.')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

export const saveArtworkBlob = (blob, name, type) => tx('readwrite', (s) => s.put({ blob, name, type }, 'current'));
export const loadArtworkBlob = () => tx('readonly', (s) => s.get('current'));
export const clearArtworkBlob = () => tx('readwrite', (s) => s.delete('current'));
