# PHOTO PRINT STUDIO — KRISNA DIGITAL
*Professional Photo Layout & Print Studio*

Aplikasi web statis (HTML + CSS + JavaScript murni) untuk menyusun foto banyak orang dan banyak ukuran ke dalam lembar cetak secara otomatis. Tanpa backend, tanpa database server, tanpa proses build. Semua foto diproses **lokal di browser** dan disimpan di IndexedDB; tidak ada analytics.

## Menjalankan secara lokal
IndexedDB dan modul gambar paling andal bila dibuka lewat server lokal (membuka `index.html` langsung juga umumnya bisa di Chrome/Edge):

```bash
cd photo-print-studio
python3 -m http.server 8000     # atau: npx serve .
# buka http://localhost:8000
```

Library (Bootstrap 5.3, jsPDF, Lucide) dan font sudah disertakan di `vendor/`, jadi aplikasi jalan offline. Google Fonts (Manrope, DM Sans) dimuat bila online; bila offline dipakai salinan lokal.

## Deploy ke GitHub Pages
1. Buat repository baru, unggah **seluruh isi** folder `photo-print-studio/` ke root repo (termasuk `vendor/` dan `assets/`).
2. Repo → **Settings → Pages** → *Build and deployment* → Source: **Deploy from a branch** → Branch `main` / folder `/ (root)` → Save.
3. Tunggu ±1 menit, aplikasi tersedia di `https://<username>.github.io/<repo>/`.

Data tersimpan per-browser dan per-domain. Gunakan **Ekspor JSON** untuk memindahkan proyek antar komputer.

## Struktur file
```
index.html          kerangka UI, modal
styles.css          tema (putih, navy, ungu)
config.js           ukuran foto (mm), media, warna latar — edit di sini bila standar berubah
util.js             fungsi bantu, ZIP, metadata DPI PNG/JPEG
storage.js          IndexedDB (proyek, foto, riwayat), ekspor/impor JSON
layout-engine.js    MaxRects (BSSF/BAF/BL), mode layout, validasi, align/distribute (tanpa DOM)
image-editor.js     renderer varian (satu-satunya renderer), crop editor berbasis Canvas
bgremoval.js        Smart Background Removal (AI lokal, warna polos, API, eraser, refine)
export.js           render halaman, garis potong, PDF/PNG/JPEG/Print, estimasi
layout-view.js      editor layout (drag, resize, align, zoom/pan, thumbnail)
app.js              navigasi, proyek, orang & foto, crop, rekap, export, pengaturan
assets/favicon.svg
vendor/             bootstrap, jspdf, lucide, font
```

## Cara pakai
1. **Proyek** — buat proyek (nama, pelanggan, no. order). Tersimpan otomatis; tombol *Simpan + riwayat* membuat snapshot (maks. 15). Proyek dapat diduplikasi, diganti namanya, dihapus, diekspor/diimpor `.pps.json`.
2. **Orang & Foto** — seret foto (banyak sekaligus), klik area unggah, atau tempel (Ctrl+V). Tiap foto menjadi satu orang. Seret foto ke kartu orang untuk mengganti fotonya. Tambah ukuran dari dropdown atau *Ukuran custom…*, atur jumlah cetak.
3. **Crop** — tiap ukuran punya crop sendiri (geser, zoom, putar 90°, flip, undo/redo, salin ke ukuran lain). Badge `~dpi` memperingatkan resolusi rendah.
4. **Background** — tombol *Background* membuka editor: AI Auto Remove, Manual Eraser, Smart Refine, feather/edge/smooth/defringe, bayangan, latar warna/gambar, Before/After. Foto asli tidak pernah diubah.
5. **Layout** — atur media, margin per sisi, spasi, bleed, garis potong. Klik **Generate Layout**. *Auto Arrange* mempertahankan posisi dan hanya menempatkan foto baru; *Repack All* menyusun ulang semua kecuali foto terkunci; *Clear Layout* mengosongkan. Edit manual: drag, panah keyboard (Shift = 5 mm), `R` putar, `L` kunci, `Ctrl+D` duplikat, `Del` hapus, `Ctrl+Z/Y`, `Ctrl+A`; mode resize (rasio tetap); align & distribute; snap ke grid/tepi foto lain; zoom roda mouse / cubit, geser dengan Spasi atau alat tangan.
6. **Rekap** — statistik, tabel Nama–Ukuran–Jumlah, status sinkron dengan layout, CSV.
7. **Export** — PDF (halaman = ukuran media, foto pada koordinat mm tepat, tanpa scaling), PNG/JPEG per halaman (DPI tertanam, opsi ZIP), Print (skala 100%).

### Ukuran baku (mm) — `config.js`
2×3 = 22×33 · 3×4 = 30×40 · 4×6 = 38×56 · 2R 60×90 · 3R 89×127 · 4R 102×152 · 5R 127×178 · 6R 152×203 · 8R 203×254 · 8R+ 203×305 · 10R 254×305. Media: A4 210×297 · A3 297×420 · A3+ 329×483 · Custom.

### Mencetak dengan ukuran tepat
Gunakan **PDF** dan cetak dengan skala **100% / Actual size**, matikan *Fit to page / Shrink to printable area*, margin *None*. Ukur satu foto dengan penggaris sebagai pemeriksaan (TEST 13).

## Background removal — penting
| Metode | Privasi | Catatan |
|---|---|---|
| MODNet / RMBG-1.4 (AI lokal, Transformers.js) | Foto **tidak dikirim**; hanya file model (±26–44 MB) diunduh sekali dari CDN lalu di-cache browser | Perlu internet saat pertama kali. RMBG-1.4 berlisensi non-komersial (Bria); MODNet Apache-2.0 — periksa lisensi untuk penggunaan komersial |
| Warna latar polos | Lokal, offline | **Bukan AI**: hanya menghapus warna latar seragam yang tersambung ke tepi foto |
| API eksternal | Foto **dikirim** ke server yang Anda isi | Selalu meminta persetujuan setiap kali |

Penggantian warna latar hanya aktif setelah ada hasil hapus background; aplikasi tidak memalsukan penggantian latar pada foto asli. Mask disimpan beresolusi kerja (maks. 2048 px sisi terpanjang), cutout PNG beresolusi asli.

## Fitur yang sudah berfungsi
Proyek (baru, simpan, auto-save, buka, duplikat, rename, hapus, riwayat, ekspor/impor JSON, thumbnail) · banyak orang & varian ukuran · upload / drag-drop / paste · crop per ukuran berbasis Canvas · background removal 3 mode + editor latar · auto layout MaxRects 5 mode multi-halaman dengan rotasi opsional · editor layout manual · garis potong/crop/corner marks + panduan layar · preview zoom/pan/fit/actual size/thumbnail halaman · export PDF/PNG/JPEG/Print + estimasi ukuran · rekap & CSV · validasi dan pesan galat · responsif desktop/tablet/HP.

## Hasil pengujian otomatis (Chromium headless)
Skenario Orang A (5×2×3 + 5×3×4), B (4×4×6), C (2×3×4 + 1×10R): semua foto tertata di A3 dan A3+ tanpa tabrakan; di A4 foto 10R dilaporkan **tidak muat beserta penyebabnya** sedangkan sisanya tertata; 200 foto 3×4 membuat 5 halaman. Ukuran fisik 2×3, 3×4, 4×6, 10R pada layout dan di PDF tepat 22×33, 30×40, 38×56, 254×305 mm; PDF berukuran halaman A3 297×420 mm. Crop berbeda per ukuran tersimpan terpisah; proyek bertahan setelah reload; tidak ada galat JavaScript; tidak ada overflow horizontal pada lebar 390 px.

## Keterbatasan
- **Model AI belum diuji di lingkungan pengembangan** (tanpa akses CDN/HuggingFace); jalur kode mengikuti dokumentasi Transformers.js. Uji sekali dengan internet; bila gagal aplikasi menampilkan pesan dan Anda dapat memakai warna polos / Manual Eraser.
- Export PNG/JPEG membuat satu kanvas per halaman: A3+ pada 600 DPI melebihi batas aman browser (aplikasi menolak dengan pesan jelas); gunakan PDF.
- Proses berat berjalan bertahap di thread utama (tanpa Web Worker); UI tetap responsif tetapi export 600 DPI bisa lama.
- Pratinjau Smart Refine/defringe diterapkan pada mask resolusi kerja; bayangan di editor adalah perkiraan.
- Resize manual hanya dengan rasio tetap. “Actual size” di layar hanyalah referensi 96 dpi.
- Perbandingan visual preview↔PDF (TEST 12) dan pengukuran cetak fisik (TEST 13) perlu dikonfirmasi pada printer Anda.
- Hanya Chrome/Edge yang menjadi target.
