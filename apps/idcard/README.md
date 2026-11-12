# ID Card Studio

Generator ID Card pegawai dari **template desain asli**. Isi biodata, unggah foto, lihat preview depan & belakang, lalu unduh PNG / PDF siap cetak.
Web app statis (HTML + JavaScript modul), **diproses lokal di browser** — tanpa backend, login, atau database. Aplikasi ini berdiri sendiri dan tidak bergantung pada aplikasi lain.

## Jenis ID Card
- **ID Card Provinsi Bali**
- **ID Card Kabupaten Jembrana**

Ukuran fisik semua jenis: **55 × 85 mm (portrait)**. Template asli dipakai apa adanya sebagai latar; foto dan teks digambar sebagai elemen terpisah di atasnya.

## Cara pakai
1. Pilih jenis ID Card.
2. Isi form sisi depan (foto, nama, NIP) dan belakang (jabatan, dst.). Nama & NIP otomatis sama di kedua sisi.
3. Geser foto langsung di preview (seret; scroll / cubit untuk zoom) bila wajah belum pas.
4. Unduh: **PNG** depan/belakang (300/600/1200 dpi) atau **PDF** (2 halaman @ 55×85 mm, atau 1 halaman 110×85 mm berdampingan).
5. Cetak PDF dengan skala **Actual Size / 100%**, bukan *Fit to Page*.

Catatan Kabupaten: pegawai tanpa NIP dapat menampilkan "-" di sisi belakang lewat centang *Isi berbeda di sisi belakang*. Secara bawaan sisi belakang selalu mengikuti sisi depan.

## Menjalankan
```bash
python3 -m http.server 8080     # lalu buka http://localhost:8080
npm test                        # tes unit (Node ≥ 18)
```
Aplikasi harus dibuka lewat server (mis. GitHub Pages), bukan langsung `file://`, karena memakai ES module dan `fetch`.

## Struktur
```text
index.html                    halaman aplikasi (Generator + Template Designer)
assets/js/
  engine.js                   layoutCard() + drawLayout(): SATU sumber posisi (mm) untuk preview, PNG, PDF
  geometry.js                 foto cover tanpa distorsi, zoom, geser
  types.js                    registri jenis ID Card + definisi form
  store.js                    penyimpanan lokal (localStorage / IndexedDB)
  render.js, export.js        jembatan canvas, ekspor PNG/PDF
  designer.js, main.js        Template Designer, generator
templates/<jenis>/
  front.png, back.png         gambar template asli (tidak diubah)
  front-config.json, back-config.json   posisi & pengaturan semua field (mm)
tests/                        tes unit
```

## Konfigurasi template (`*-config.json`)
Koordinat dalam **milimeter**, titik (0,0) di kiri-atas, X ke kanan, Y ke bawah. Konversi ke pixel hanya terjadi saat menggambar.

| Jenis field | Properti utama |
|---|---|
| `text` | `x y width height`, `source` (`nama` / `nip` / `jabatan` / `gol_darah`), `prefix`, `fontFamily`, `fontSize` (pt), `minFontSize`, `maxFontSize`, `fontWeight`, `color`, `textAlign`, `verticalAlign`, `autoFit`, `letterSpacing` (pt), `scaleX` (lebar huruf), `strokeWidth` (tebal tambahan, mm), `maxLines`, `lineHeight` |
| `photo` | `x y width height`, `cropMode` (`cover` / `contain`), `defaultOx/Oy`, `borderWidth`, `borderColor` |
| `mask` | `x y width height`, `color`, `radius` — penutup bagian gambar template (mis. latar biru bingkai foto) |

Teks yang terlalu panjang diperkecil otomatis hingga `minFontSize`; bila masih tidak muat, teks dipotong di batas area **dan diberi peringatan**. "Rata vertikal tengah" = tengah tinggi huruf kapital.

## Template Designer
Tab *Template Designer*: tampilkan template di canvas, tambah/geser/ubah ukuran area foto, teks, dan penutup (mouse/sentuh atau angka mm), atur properti teks, undo/redo, lalu **Simpan posisi**. Hasil tersimpan di browser (terpisah dari data pegawai). Gunakan **Unduh JSON** untuk menyalin konfigurasi ke folder `templates/<jenis>/` agar berlaku untuk semua pengguna.
Bila `templateVersion` pada konfigurasi bawaan dinaikkan, penyesuaian lokal lama dibuang otomatis agar desain terbaru berlaku.

Font kustom (TTF/OTF/WOFF/WOFF2) dapat diunggah di Designer dan dipakai preview maupun ekspor, agar tampilan teks sama di semua perangkat.

## Menambah jenis ID Card baru
1. Buat `templates/<id>/` berisi `front.png`, `back.png`, `front-config.json`, `back-config.json`.
2. Tambahkan satu objek di `ID_CARD_TYPES` pada `assets/js/types.js` (nama, `basePath`, daftar field form, data contoh).

Mesin render, form, designer, dan ekspor tidak perlu diubah.

## Akurasi
- Satu fungsi layout dipakai preview, PNG, dan PDF; yang berbeda hanya resolusi canvas.
- Rasio template dicek terhadap 55:85 (toleransi 0,5%). Gambar tidak pernah diregangkan; bila di luar toleransi, ekspor dinonaktifkan dan muncul peringatan.
- Posisi bawaan Provinsi & Kabupaten dikalibrasi terhadap contoh ID card: tepi teks cocok dalam ±0,5 px (pada 653 px lebar), foto tepat pada kotaknya.
