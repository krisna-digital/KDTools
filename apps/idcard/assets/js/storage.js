/* IDCARD STUDIO — storage.js
 * LocalStorage: konfigurasi ringan (JSON posisi field, data form, pengaturan).
 * IndexedDB : gambar (foto pegawai terakhir, gambar template pengganti).
 */
(function (root) {
  'use strict';
  var IDS = root.IDS = root.IDS || {};
  var PREFIX = 'idcard-studio:';

  function ls() { try { return root.localStorage; } catch (e) { return null; } }

  IDS.store = {
    get: function (key, fallback) {
      var s = ls(); if (!s) return fallback;
      try { var v = s.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set: function (key, value) {
      var s = ls(); if (!s) return false;
      try { s.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove: function (key) { var s = ls(); if (s) s.removeItem(PREFIX + key); },
    configKey: function (templateId, side) { return 'config:' + templateId + ':' + side; }
  };

  /** Ambil config: versi tersimpan pengguna bila ada, kalau tidak default bawaan. */
  IDS.loadConfig = function (templateId, side) {
    var saved = IDS.store.get(IDS.store.configKey(templateId, side), null);
    var def = root.IDS_DEFAULTS && root.IDS_DEFAULTS[templateId] && root.IDS_DEFAULTS[templateId][side];
    if (saved && saved.config) {
      var v = IDS.validateConfig(saved.config);
      if (!v.errors.length) return { config: v.config, source: 'saved', savedAt: saved.savedAt };
    }
    return { config: IDS.clone(def), source: 'default' };
  };

  IDS.saveConfig = function (templateId, side, config) {
    config.savedAt = new Date().toISOString();
    return IDS.store.set(IDS.store.configKey(templateId, side), { config: config, savedAt: config.savedAt });
  };

  IDS.resetConfig = function (templateId, side) { IDS.store.remove(IDS.store.configKey(templateId, side)); };

  /* ---------- IndexedDB (blob gambar) ---------- */

  var dbp = null;
  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error('IndexedDB tidak tersedia'));
      var req = root.indexedDB.open('idcard-studio', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('blobs'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction('blobs', mode), st = t.objectStore('blobs'), r = fn(st);
        t.oncomplete = function () { resolve(r && r.result); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  IDS.blobs = {
    put: function (key, blob) { return tx('readwrite', function (s) { return s.put(blob, key); }); },
    get: function (key) { return tx('readonly', function (s) { return s.get(key); }).catch(function () { return null; }); },
    del: function (key) { return tx('readwrite', function (s) { return s.delete(key); }); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = IDS;
})(typeof window !== 'undefined' ? window : globalThis);
