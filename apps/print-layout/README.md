# PRINTLAY — Smart Print Layout Calculator

Aplikasi web statis untuk menghitung jumlah maksimal desain per lembar kertas, menampilkan simulasi
layout dengan garis potong, dan mengunduh PDF siap cetak (skala 1:1). Semua diproses lokal di browser:
tanpa backend, tanpa login, tanpa API berbayar, gambar tidak pernah diunggah ke server.

## Fitur

- Input ukuran desain (mm / cm / inch), swap, jumlah pesanan; preset kertas A4, A3, A5, A6, F4, Folio, A3+, Custom (nilai dapat diedit) + orientasi.
- Gap horizontal/vertikal (default 2 mm) dan margin 4 sisi (default 0).
- Optimasi **MaxRects** (Best Short Side Fit, Best Long Side Fit, Best Area Fit, Bottom Left, Contact Point) dengan rotasi 90°, mode orientasi normal / rotasi / campuran, ditambah pencarian blok guillotine. Hasil terbaik dipilih berdasarkan jumlah, lalu kemudahan pemotongan.
- **Validator independen** (`validator.js`) memeriksa setiap layout: di dalam area cetak, tanpa overlap, gap terpenuhi, rotasi tercatat benar, jumlah = jumlah objek. Layout tidak valid tidak dapat diekspor.
- Upload artwork asli (PNG, JPG, JPEG, WebP, SVG tersanitasi), drag & drop, mode **Contain / Cover**, info piksel, rasio, estimasi DPI, peringatan resolusi/rasio. Tanpa artwork → placeholder biru muda `#ADD8E6`.
- **Template Polaroid 2R** (63,5 × 88,9 mm = 2,5 × 3,5 inci): kartu berbingkai dengan jendela foto. Orientasi kartu **otomatis** mengikuti foto (lanskap bila lebar > tinggi; persegi / tanpa foto = potret), bisa dipaksa manual. Border samping/atas/bawah dapat diatur (bawaan 4 / 4 / 14 mm). Foto diisikan dengan **zoom-in (cover)** lalu dipotong di tepi jendela — rasio asli foto tidak pernah diregangkan. Kartu disusun optimizer seperti desain biasa (rotasi 90° di lembar tetap diperbolehkan). Foto JPEG berorientasi EXIF (foto HP) ditangani agar PDF tidak terputar.
- **Banyak foto di mode Polaroid**: unggah beberapa foto sekaligus. Foto mengisi slot berurutan; tiap lembar = jumlah slot hasil CALCULATE (mis. 9 di A4) dan berlanjut otomatis ke lembar berikutnya (PDF multi-halaman). Orientasi kartu ditentukan per foto. Jika jumlah foto bukan kelipatan kapasitas lembar, lembar terakhir terisi sebagian dan slot kosong tidak dicetak.
- **Atur tiap foto langsung di preview**: seret untuk menggeser, scroll / cubit 2 jari untuk zoom, atau pakai slider zoom (100–500%; 100% = cover pas, tidak pernah lebih kecil sehingga tidak ada area kosong). Tersedia reset, ubah urutan, hapus, dan penanda resolusi rendah per foto. Posisi/zoom ikut ke PDF/SVG/Print.
- **Foto Kustom (impor hingga 100 foto)**: pilih *Template → Foto Kustom*, atur ukuran kotak di kartu "Ukuran Desain" (mm/cm/inci), lalu unggah foto sekaligus. Tiap foto mengisi satu kotak penuh tanpa tepi putih (zoom-in/cover, rasio asli utuh), orientasi kotak otomatis mengikuti foto (kotak lanskap = kotak potret yang diputar 90°, ukuran fisik sama). Foto berurutan mengisi slot, lanjut ke lembar berikutnya (PDF multi-halaman), dan tiap foto bisa digeser/di-zoom di preview. Bagian geser/zoom/lembar/PDF dipakai bersama dengan mode Polaroid.
- **Generator ID Card** (`idcard.html`, tautan "ID Card" di header): modul terpisah untuk ID Card Provinsi Bali 55 × 85 mm dengan template asli, Template Designer visual, preview, dan ekspor PNG/PDF. Konfigurasi di `templates/provinsi/`. Posisi bawaan adalah DRAF hasil pengukuran piksel dan harus diperiksa lalu disetujui di Template Designer.
- Preview SVG (zoom, fit, nomor, margin, ukuran), export PDF / SVG / Print dari koordinat yang sama.
- Riwayat dan pengaturan di LocalStorage; artwork (opsional) di IndexedDB; dark mode.

### Tentang keakuratan

MaxRects adalah heuristik. PRINTLAY **tidak** mengklaim optimum global. Aplikasi menampilkan batas atas
teoretis berdasarkan luas; hanya bila jumlah hasil sama dengan batas atas, hasil ditandai "terbukti maksimum".
Definisi gap: jarak antar tepi desain yang berdampingan ≥ gap; tidak ada gap di tepi kertas.

## Menjalankan

Butuh server statis (ES modules tidak berjalan dari `file://`):

```bash
cd printlay
python3 -m http.server 8080      # atau: npm run serve
# buka http://localhost:8080
```

## Testing

Membutuhkan Node.js 18+ (tanpa dependensi):

```bash
npm test
```

Mencakup: konversi satuan, validasi input, gap H/V berbeda, margin tiap sisi, ukuran desimal,
toleransi floating-point, kertas custom, desain tidak muat / terlalu besar, rotasi, kombinasi orientasi,
tidak ada overlap / keluar batas (diuji pada koordinat tiap objek), pembanding terhadap grid sederhana,
validator (termasuk layout yang sengaja dirusak), renderer SVG, dan template Polaroid (geometri jendela foto, orientasi otomatis, cover tanpa distorsi, pemetaan jendela pada kartu yang dirotasi).

## Deploy ke GitHub Pages

1. Buat repository di GitHub dan push seluruh isi folder `printlay/` (file `index.html` di root repo).
2. Buka **Settings → Pages**.
3. Pada **Build and deployment → Source** pilih **Deploy from a branch**, branch `main`, folder `/ (root)`, lalu **Save**.
4. Tunggu 1–2 menit; aplikasi tersedia di `https://<username>.github.io/<nama-repo>/`.

Semua path aset relatif, jadi berfungsi pada URL project repository. Library jsPDF (v4.2.1, MIT) sudah
disertakan di `assets/js/vendor/`, sehingga tidak ada ketergantungan CDN.

## Mencetak

Cetak PDF dengan **Actual Size / 100%**, bukan *Fit to Page*, agar skala tetap 1:1. Ukuran halaman PDF
sama dengan ukuran kertas yang dipilih (tidak dipaksa menjadi A4).

## Struktur

```
index.html
assets/css/        style.css, responsive.css
assets/js/         app.js, calculator.js, optimizer.js, validator.js, renderer.js,
                   templates.js (geometri Polaroid & Foto Kustom, placePhoto, mapRect), idcard/ (modul ID Card), artwork.js, export.js, storage.js, vendor/jspdf.umd.min.js
assets/icons/      icon.svg
tests/             *.test.js, helpers.js
```

## Keamanan artwork

File divalidasi (ekstensi, tanda tangan biner, ukuran maks 50 MB). SVG disanitasi: elemen `script`,
`foreignObject`, animasi, dan sejenisnya dibuang; atribut `on*`, tautan eksternal, dan `url()` eksternal
dihapus; deklarasi ENTITY ditolak. Gambar diproses lewat object URL dan dibersihkan saat diganti/dihapus.

## Batasan yang diketahui

- Di atas ±4000 desain per lembar, pencarian MaxRects dilewati (hanya pencarian blok); di atas 20.000 ditolak.
- Pada iOS Safari, salinan artwork yang dirotasi diturunkan resolusinya bila melebihi batas canvas (16 MP); aplikasi memberi catatan saat ini terjadi.
- Garis potong digambar sebagai garis tipis (0,1 mm) pada batas desain; atur ulang di `renderer.js`/`export.js` bila printer Anda memerlukan crop mark terpisah.
