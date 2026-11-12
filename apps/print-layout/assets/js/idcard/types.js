// PRINTLAY — idcard/types.js
// Registri jenis ID Card. Untuk menambah jenis baru (mis. Kabupaten): tambahkan satu objek di sini +
// folder templates/<id>/ berisi front.png, back.png, front-config.json, back-config.json.
// Mesin render, form, designer, dan export tidak perlu diubah.

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
      { key: 'nama', label: 'Nama Lengkap', kind: 'text', sides: ['front', 'back'], placeholder: 'mis. BAIQ USNIATI, S.Pd', required: true },
      { key: 'nip', label: 'NIP', kind: 'text', sides: ['front', 'back'], placeholder: 'mis. 19990822 202521 2 000', required: true },
      { key: 'jabatan', label: 'Jabatan', kind: 'text', sides: ['back'], placeholder: 'mis. Guru Ahli Pertama' },
      { key: 'gol_darah', label: 'Golongan Darah', kind: 'select', sides: ['back'], options: ['A', 'B', 'AB', 'O'] },
    ],
    sample: { nama: 'BAIQ USNIATI, S.Pd', nip: '19990822 202521 2 000', jabatan: 'Guru Ahli Pertama', gol_darah: 'B' },
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
