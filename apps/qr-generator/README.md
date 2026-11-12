# QR Generator dengan Frame

Aplikasi statis (HTML/CSS/JS), siap di-deploy ke GitHub Pages. Library QR dimuat dari CDN jsDelivr (`qr-code-styling`).

## Struktur
```
index.html
css/style.css
js/app.js
assets/frames/
  frames.json   <- daftar frame gambar
  (gambar frame kamu: png/webp/svg)
```

## Menambah frame gambar
1. Upload gambar ke `assets/frames/` (mis. `frame-1.png`). PNG transparan disarankan.
2. Daftarkan di `assets/frames/frames.json`:

```json
{
  "frames": [
    {
      "id": "frame-1",
      "name": "Frame 1",
      "file": "frame-1.png",
      "qr": { "x": 0.5, "y": 0.4, "size": 0.55 }
    }
  ]
}
```

`qr` = posisi tengah QR dan ukurannya, sebagai pecahan dari lebar/tinggi gambar frame:
- `x`: 0 (kiri) sampai 1 (kanan), titik tengah QR
- `y`: 0 (atas) sampai 1 (bawah), titik tengah QR
- `size`: lebar QR dibanding lebar frame

Tips: pilih frame di aplikasi, geser slider "Posisi QR di frame" sampai pas, klik **Salin nilai posisi (JSON)**, lalu tempel ke `qr` di `frames.json`.

## Deploy ke GitHub Pages
1. Push semua file ke repo GitHub.
2. Settings > Pages > Source: `Deploy from a branch`, pilih branch `main` dan folder `/ (root)`.
3. Buka `https://<username>.github.io/<nama-repo>/`.

Untuk tes lokal, jalankan server (mis. `python -m http.server`), jangan buka lewat `file://` karena `frames.json` di-fetch.
