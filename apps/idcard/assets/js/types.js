// ID Card Studio — types.js
// Registri jenis ID Card. Untuk menambah jenis baru: tambahkan satu objek di sini + folder templates/<id>/ berisi
// front.png, back.png, front-config.json, back-config.json. Mesin render, form, designer, dan export tidak perlu diubah.

export const ID_CARD_TYPES = [
  {
    id: 'provinsi',
    name: 'ID Card Provinsi Bali',
    basePath: 'templates/provinsi/',
    sides: {
      front: { label: 'Sisi Depan', config: 'front-config.json' },
      back: { label: 'Sisi Belakang', config: 'back-config.json' },
    },
    // Satu data, banyak sisi: field yang muncul di dua sisi hanya diisi sekali (di sisi pertama yang memuatnya).
    form: [
      { key: 'foto', label: 'Foto Pegawai', kind: 'photo', sides: ['front'] },
      { key: 'nama', label: 'Nama Lengkap', kind: 'text', sides: ['front', 'back'], placeholder: 'mis. KRISNA DIGITAL, S.Pd', required: true },
      { key: 'nip', label: 'NIP', kind: 'text', sides: ['front', 'back'], placeholder: 'mis. 19990822 202521 2 000', required: true },
      { key: 'jabatan', label: 'Jabatan', kind: 'text', sides: ['back'], placeholder: 'mis. Guru Ahli Pertama' },
      { key: 'gol_darah', label: 'Golongan Darah', kind: 'select', sides: ['back'], options: ['A', 'B', 'AB', 'O'] },
    ],
    sample: { nama: 'KRISNA DIGITAL, S.Pd', nip: '19990822 202521 2 000', jabatan: 'Guru Ahli Pertama', gol_darah: 'B' },
  },
  {
    id: 'kabupaten',
    name: 'ID Card Kabupaten Jembrana',
    basePath: 'templates/kabupaten/',
    sides: {
      front: { label: 'Sisi Depan', config: 'front-config.json' },
      back: { label: 'Sisi Belakang', config: 'back-config.json' },
    },
    form: [
      { key: 'foto', label: 'Foto Pegawai', kind: 'photo', sides: ['front'] },
      { key: 'nama', label: 'Nama Lengkap', kind: 'text', sides: ['front', 'back'], placeholder: 'mis. KRISNA DIGITAL', required: true },
      // Pegawai tanpa NIP (mis. tenaga alih daya) menampilkan "-" di belakang: sisi belakang boleh diisi berbeda (opsional).
      { key: 'nip', label: 'NIP', kind: 'text', sides: ['front', 'back'], placeholder: 'mis. 202521 202530 2 002', required: true, allowBackOverride: true },
      { key: 'jabatan', label: 'Jabatan', kind: 'text', sides: ['back'], placeholder: 'mis. TENAGA ALIH DAYA' },
    ],
    sample: { nama: 'KRISNA DIGITAL', nip: '202521 202530 2 002', jabatan: 'TENAGA ALIH DAYA', gol_darah: '' },
  },
];

export const getType = (id) => ID_CARD_TYPES.find((t) => t.id === id) || ID_CARD_TYPES[0];

/** Field form untuk satu sisi; `mirrored` = sudah diisi di sisi sebelumnya (tidak diminta dua kali). */
export function formForSide(type, side) {
  const order = Object.keys(type.sides);
  return type.form
    .filter((f) => f.sides.includes(side))
    .map((f) => ({ ...f, mirrored: f.sides.indexOf(side) > 0 && order.indexOf(f.sides[0]) < order.indexOf(side) }));
}

/**
 * Data efektif untuk satu sisi. Nilai di sisi belakang = nilai sisi depan, kecuali field yang
 * diizinkan `allowBackOverride` sengaja diisi berbeda (kunci `<key>@back`).
 */
export function dataForSide(type, data, side) {
  const out = { ...data };
  if (side !== 'front') {
    for (const f of type.form) {
      if (f.allowBackOverride && Object.prototype.hasOwnProperty.call(data, `${f.key}@back`) && data[`${f.key}@back`] !== null && data[`${f.key}@back`] !== undefined) {
        out[f.key] = data[`${f.key}@back`];
      }
    }
  }
  return out;
}
