/* IDCARD STUDIO — field-mapping.js
 * Registri jenis ID Card, skema form, pemetaan data -> field, validasi konfigurasi.
 * Menambah jenis ID Card baru = menambah entri di IDS.TEMPLATES (tanpa mengubah renderer).
 * Semua koordinat dalam MILIMETER, origin kiri atas (X ke kanan, Y ke bawah).
 */
(function (root) {
  'use strict';
  var IDS = root.IDS = root.IDS || {};

  IDS.CARD = { widthMm: 55, heightMm: 85 };

  // Registri jenis ID Card. Hanya "provinsi" untuk tahap pertama.
  IDS.TEMPLATES = {
    provinsi: {
      id: 'provinsi',
      name: 'ID Card Provinsi Bali',
      widthMm: 55,
      heightMm: 85,
      basePath: 'assets/templates/provinsi/',
      sides: {
        front: { label: 'Sisi Depan', image: 'front.jpg' },
        back:  { label: 'Sisi Belakang', image: 'back.jpg' }
      },
      // Satu sumber data. Nama & NIP hanya diminta sekali (di form depan).
      form: {
        front: [
          { key: 'foto', label: 'Foto Pegawai', type: 'photo', required: true },
          { key: 'nama', label: 'Nama Lengkap', type: 'text', required: true, placeholder: 'mis. Krisna Digital, S.Pd' },
          { key: 'nip',  label: 'NIP', type: 'text', required: true, placeholder: 'mis. 1945 202521 2 000' }
        ],
        back: [
          { key: 'nama', label: 'Nama Lengkap', type: 'synced', from: 'nama' },
          { key: 'nip',  label: 'NIP', type: 'synced', from: 'nip' },
          { key: 'jabatan', label: 'Jabatan', type: 'text', required: true, placeholder: 'mis. Guru Ahli Pertama' },
          { key: 'gol_darah', label: 'Golongan Darah', type: 'text', required: true, placeholder: 'mis. B' }
        ]
      }
    }
  };

  var TEXT_DEFAULTS = {
    fontFamily: "Arial, 'Liberation Sans', Helvetica, sans-serif",
    fontSize: 3, minFontSize: 1.8, maxFontSize: 3,
    fontWeight: 'normal', color: '#000000',
    textAlign: 'left', verticalAlign: 'middle',
    autoFit: true, wrap: false, letterSpacing: 0, hScale: 1, prefix: ''
  };
  var PHOTO_DEFAULTS = { cropMode: 'cover', border: { width: 0, color: '#000000' } };

  IDS.fieldDefaults = function (type) {
    return JSON.parse(JSON.stringify(type === 'photo' ? PHOTO_DEFAULTS : TEXT_DEFAULTS));
  };

  /** Isi nilai teks sebuah field dari data (sumber tunggal). */
  IDS.fieldText = function (field, data) {
    var v = (data && data[field.source]);
    v = (v == null) ? '' : String(v).trim();
    if (!v) return '';
    return (field.prefix || '') + v;
  };

  /** Daftar field kosong yang wajib diisi untuk sisi tertentu. */
  IDS.missingFields = function (templateId, data, hasPhoto) {
    var t = IDS.TEMPLATES[templateId], out = [];
    ['front', 'back'].forEach(function (side) {
      t.form[side].forEach(function (f) {
        if (!f.required) return;
        if (f.type === 'photo') { if (!hasPhoto) out.push({ side: side, key: f.key, label: f.label }); return; }
        if (!data[f.key] || !String(data[f.key]).trim()) out.push({ side: side, key: f.key, label: f.label });
      });
    });
    return out;
  };

  /** ID field unik dalam satu config. */
  IDS.uniqueId = function (config, base) {
    var ids = {}, i = 1, id = base;
    config.fields.forEach(function (f) { ids[f.id] = 1; });
    while (ids[id]) { i++; id = base + '_' + i; }
    return id;
  };

  /** Validasi + normalisasi config. Mengembalikan {config, errors}. */
  IDS.validateConfig = function (cfg) {
    var errors = [];
    if (!cfg || typeof cfg !== 'object') return { config: null, errors: ['Konfigurasi bukan objek.'] };
    if (cfg.widthMm !== 55 || cfg.heightMm !== 85) errors.push('Ukuran fisik harus 55 × 85 mm.');
    if (!Array.isArray(cfg.fields)) { errors.push('Daftar field tidak ada.'); return { config: cfg, errors: errors }; }
    var seen = {};
    cfg.fields.forEach(function (f) {
      if (!f.id) errors.push('Ada field tanpa ID.');
      else if (seen[f.id]) errors.push('ID field ganda: ' + f.id);
      seen[f.id] = 1;
      ['x', 'y', 'width', 'height'].forEach(function (k) {
        if (typeof f[k] !== 'number' || !isFinite(f[k])) errors.push(f.id + ': ' + k + ' tidak valid.');
      });
      if (f.width <= 0 || f.height <= 0) errors.push(f.id + ': lebar/tinggi harus > 0.');
      var d = IDS.fieldDefaults(f.type);
      Object.keys(d).forEach(function (k) { if (f[k] === undefined) f[k] = d[k]; });
    });
    return { config: cfg, errors: errors };
  };

  /** Cek apakah field melewati batas kartu (peringatan, bukan error). */
  IDS.outOfBounds = function (f, cfg) {
    return f.x < 0 || f.y < 0 || f.x + f.width > cfg.widthMm + 1e-6 || f.y + f.height > cfg.heightMm + 1e-6;
  };

  IDS.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  if (typeof module !== 'undefined' && module.exports) module.exports = IDS;
})(typeof window !== 'undefined' ? window : globalThis);
