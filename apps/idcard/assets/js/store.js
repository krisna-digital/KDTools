// ID Card Studio — store.js
// Penyimpanan lokal (tanpa backend). Konfigurasi template (hasil Template Designer) disimpan di localStorage,
// TERPISAH dari data pegawai (yang tidak pernah disimpan). Font kustom disimpan di IndexedDB.

const LS_KEY = 'idcardstudio.templates.v1';

function readAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; }
}
function writeAll(o) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(o)); return true; } catch { return false; }
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const defaultsCache = new Map();

/** Konfigurasi bawaan (templates/<id>/*-config.json). Selalu mengembalikan salinan. */
export async function loadDefaults(type, fetchFn = fetch) {
  if (!defaultsCache.has(type.id)) {
    const out = {};
    for (const [side, def] of Object.entries(type.sides)) {
      const res = await fetchFn(type.basePath + def.config, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Gagal memuat ${type.basePath + def.config} (${res.status})`);
      out[side] = await res.json();
    }
    defaultsCache.set(type.id, out);
  }
  return clone(defaultsCache.get(type.id));
}

/**
 * Template aktif = penyesuaian pengguna (hasil Template Designer) bila ada dan masih berbasis versi template
 * yang sama; kalau tidak, konfigurasi bawaan. Bila versi bawaan berubah, penyesuaian lama dibuang agar
 * pembaruan desain sampai ke pengguna (dan `notice` memberi tahu).
 * @returns {{sides:{front,back}, origin:'default'|'custom', notice:string|null}}
 */
export async function loadTemplateSet(type, fetchFn = fetch) {
  const defaults = await loadDefaults(type, fetchFn);
  const all = readAll();
  const saved = all[type.id];
  if (saved && saved.sides) {
    const same = Object.keys(defaults).every((s) => saved.baseVersion && saved.baseVersion[s] === defaults[s].templateVersion);
    if (same) return { sides: clone(saved.sides), origin: 'custom', notice: null };
    delete all[type.id];
    writeAll(all);
    return { sides: defaults, origin: 'default', notice: 'Template bawaan diperbarui; penyesuaian posisi lokal sebelumnya dikembalikan ke desain terbaru.' };
  }
  return { sides: defaults, origin: 'default', notice: null };
}

/** Simpan penyesuaian pengguna. `baseVersion` = versi template bawaan yang menjadi dasarnya. */
export function saveTemplateSet(type, sides, baseVersion) {
  const all = readAll();
  all[type.id] = { sides: clone(sides), baseVersion: clone(baseVersion), savedAt: new Date().toISOString() };
  return { ok: writeAll(all), sides: clone(sides) };
}

export function resetTemplateSet(type) {
  const all = readAll();
  delete all[type.id];
  writeAll(all);
}

/** Impor berkas konfigurasi (front/back) hasil "Unduh JSON". */
export function parseImportedConfig(text) {
  const o = JSON.parse(text);
  if (!o || typeof o !== 'object' || !Array.isArray(o.fields) || !o.size) throw new Error('Berkas bukan konfigurasi template ID Card yang valid.');
  return o;
}

// ------------------------------------------------------------------ font kustom (IndexedDB)

const DB = 'idcardstudio';
const STORE = 'fonts';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const tx = (db, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode);
  const r = fn(t.objectStore(STORE));
  t.oncomplete = () => resolve(r && r.result);
  t.onerror = () => reject(t.error);
});

export async function listFonts() {
  try { const db = await openDb(); return (await tx(db, 'readonly', (s) => s.getAll())) || []; } catch { return []; }
}
export async function saveFont(rec) { const db = await openDb(); await tx(db, 'readwrite', (s) => s.put(rec)); }
export async function deleteFont(name) { const db = await openDb(); await tx(db, 'readwrite', (s) => s.delete(name)); }

/** Daftarkan font kustom ke dokumen agar dipakai canvas (preview dan export). */
export async function registerFont(rec) {
  const face = new FontFace(rec.name, rec.data, { weight: rec.weight || 'normal', style: rec.style || 'normal' });
  await face.load();
  document.fonts.add(face);
}
