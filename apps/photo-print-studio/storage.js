/**
 * storage.js — Penyimpanan lokal (IndexedDB) untuk proyek, foto (blob), dan riwayat.
 * Semua data tetap di browser pengguna; tidak ada pengiriman ke server.
 *
 * Store:
 *   projects : { id, name, ..., persons, layout, settings, thumb }   (tanpa data gambar)
 *   blobs    : { id, projectId, blob }                               (foto asli, thumbnail, mask, cutout, bg)
 *   history  : { id, projectId, at, label, data }                    (snapshot proyek)
 */
(function () {
  'use strict';
  const PPS = (window.PPS = window.PPS || {});
  const U = PPS.Util;
  const DB_NAME = 'photo-print-studio';
  const DB_VER = 1;
  const HISTORY_MAX = 15;
  let dbp = null;

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('Browser ini tidak mendukung IndexedDB. Gunakan Chrome atau Edge terbaru.'));
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Gagal membuka database lokal.'));
      req.onblocked = () => reject(new Error('Database diblokir oleh tab lain. Tutup tab Photo Print Studio lainnya.'));
    });
    return dbp;
  }
  const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  async function tx(stores, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then((v) => (out = v), reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaksi database dibatalkan (penyimpanan penuh?).'));
    });
  }

  /** Daftar semua id blob yang dipakai sebuah proyek. */
  function blobRefs(p) {
    const ids = [];
    (p.persons || []).forEach((per) => {
      [per.photoId, per.thumbId].forEach((x) => x && ids.push(x));
      if (per.cutout) [per.cutout.maskId, per.cutout.cutoutId].forEach((x) => x && ids.push(x));
      (per.variants || []).forEach((v) => v.bg && v.bg.imageId && ids.push(v.bg.imageId));
    });
    return ids;
  }
  /** Ganti id blob menurut peta lama->baru (untuk duplikasi / impor). */
  function remapBlobs(p, map) {
    const m = (x) => (x && map[x]) || x;
    (p.persons || []).forEach((per) => {
      per.photoId = m(per.photoId); per.thumbId = m(per.thumbId);
      if (per.cutout) { per.cutout.maskId = m(per.cutout.maskId); per.cutout.cutoutId = m(per.cutout.cutoutId); }
      (per.variants || []).forEach((v) => { if (v.bg && v.bg.imageId) v.bg.imageId = m(v.bg.imageId); });
    });
    return p;
  }

  const Storage = {
    blobRefs, remapBlobs,
    async init() { await openDB(); },

    newProject(meta = {}) {
      const now = Date.now();
      return {
        id: U.uid('prj'), schema: 1,
        name: meta.name || 'Proyek Baru', customer: meta.customer || '', orderNo: meta.orderNo || '', notes: meta.notes || '',
        createdAt: now, updatedAt: now,
        persons: [], layout: { pages: [], generatedAt: 0, sig: '' },
        settings: PPS.Config.DEFAULT_SETTINGS(), thumb: '',
      };
    },

    async saveProject(p) { p.updatedAt = Date.now(); await tx(['projects'], 'readwrite', (t) => wrap(t.objectStore('projects').put(p))); },
    async getProject(id) { return tx(['projects'], 'readonly', (t) => wrap(t.objectStore('projects').get(id))); },
    async listProjects() {
      const all = await tx(['projects'], 'readonly', (t) => wrap(t.objectStore('projects').getAll()));
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    // ---- blob ----
    async putBlob(projectId, blob, id) {
      id = id || U.uid('blb');
      await tx(['blobs'], 'readwrite', (t) => wrap(t.objectStore('blobs').put({ id, projectId, blob })));
      return id;
    },
    async getBlob(id) { const r = await tx(['blobs'], 'readonly', (t) => wrap(t.objectStore('blobs').get(id))); return r ? r.blob : null; },
    async deleteBlobs(ids) { if (ids.length) await tx(['blobs'], 'readwrite', (t) => { const s = t.objectStore('blobs'); ids.forEach((i) => s.delete(i)); }); },
    async projectBlobIds(projectId) { return tx(['blobs'], 'readonly', (t) => wrap(t.objectStore('blobs').index('projectId').getAllKeys(projectId))); },

    /** Hapus blob yatim (tidak dipakai proyek sekarang maupun snapshot riwayat). */
    async gc(project) {
      const keep = new Set(blobRefs(project));
      const hist = await this.listHistory(project.id);
      hist.forEach((h) => blobRefs(h.data).forEach((x) => keep.add(x)));
      const all = await this.projectBlobIds(project.id);
      const orphan = all.filter((k) => !keep.has(k));
      await this.deleteBlobs(orphan);
      return orphan.length;
    },

    // ---- riwayat ----
    async addHistory(project, label) {
      const snap = { id: U.uid('his'), projectId: project.id, at: Date.now(), label: label || 'Simpan manual', data: U.deepClone(project) };
      snap.data.thumb = '';
      await tx(['history'], 'readwrite', (t) => wrap(t.objectStore('history').put(snap)));
      const list = await this.listHistory(project.id);
      const extra = list.slice(HISTORY_MAX);
      if (extra.length) await tx(['history'], 'readwrite', (t) => { extra.forEach((h) => t.objectStore('history').delete(h.id)); });
    },
    async listHistory(projectId) {
      const r = await tx(['history'], 'readonly', (t) => wrap(t.objectStore('history').index('projectId').getAll(projectId)));
      return r.sort((a, b) => b.at - a.at);
    },

    async deleteProject(id) {
      const blobIds = await this.projectBlobIds(id);
      const hist = await this.listHistory(id);
      await tx(['projects', 'blobs', 'history'], 'readwrite', (t) => {
        t.objectStore('projects').delete(id);
        blobIds.forEach((b) => t.objectStore('blobs').delete(b));
        hist.forEach((h) => t.objectStore('history').delete(h.id));
      });
    },

    /** Duplikasi proyek beserta seluruh blob (id blob baru). */
    async duplicateProject(id) {
      const src = await this.getProject(id);
      if (!src) throw new Error('Proyek tidak ditemukan.');
      const p = U.deepClone(src); p.id = U.uid('prj'); p.name = src.name + ' (salinan)'; p.createdAt = p.updatedAt = Date.now();
      const map = {};
      for (const old of new Set(blobRefs(src))) { const b = await this.getBlob(old); if (b) map[old] = await this.putBlob(p.id, b); }
      remapBlobs(p, map);
      await this.saveProject(p);
      return p;
    },

    // ---- ekspor / impor file proyek JSON ----
    async exportProjectFile(project) {
      const ids = Array.from(new Set(blobRefs(project)));
      const parts = ['{"app":"photo-print-studio","version":1,"project":', JSON.stringify(Object.assign({}, project, { thumb: project.thumb || '' })), ',"blobs":{'];
      let first = true;
      for (const id of ids) {
        const b = await this.getBlob(id); if (!b) continue;
        parts.push((first ? '' : ',') + JSON.stringify(id) + ':' + JSON.stringify(await U.blobToDataURL(b))); first = false;
      }
      parts.push('}}');
      return new Blob(parts, { type: 'application/json' });
    },
    async importProjectFile(file) {
      let data;
      try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('File proyek rusak atau bukan JSON yang valid.'); }
      if (!data || data.app !== 'photo-print-studio' || !data.project || !Array.isArray(data.project.persons) || typeof data.blobs !== 'object') {
        throw new Error('File ini bukan file proyek Photo Print Studio yang valid.');
      }
      const p = data.project; const base = this.newProject();
      p.settings = Object.assign(base.settings, p.settings || {});
      ['media', 'margins', 'spacing', 'layout', 'marks', 'guides', 'export'].forEach((k) => { p.settings[k] = Object.assign({}, base.settings[k], (p.settings || {})[k] || {}); });
      p.layout = p.layout && Array.isArray(p.layout.pages) ? p.layout : base.layout;
      p.id = U.uid('prj'); p.name = (p.name || 'Proyek') + ' (impor)'; p.updatedAt = Date.now();
      const map = {};
      for (const id of Object.keys(data.blobs)) {
        try { map[id] = await this.putBlob(p.id, U.dataURLToBlob(data.blobs[id])); } catch (e) { /* lewati blob rusak */ }
      }
      const missing = blobRefs(p).filter((id) => !map[id]);
      remapBlobs(p, map);
      // foto asli yang hilang di file -> orang ditandai belum punya foto
      p.persons.forEach((per) => { if (per.photoId && missing.includes(per.photoId)) per.photoId = null; });
      await this.saveProject(p);
      return { project: p, missing: missing.length };
    },

    async estimateUsage() {
      if (navigator.storage && navigator.storage.estimate) { try { return await navigator.storage.estimate(); } catch (e) { /* abaikan */ } }
      return null;
    },
  };
  PPS.Storage = Storage;
})();
