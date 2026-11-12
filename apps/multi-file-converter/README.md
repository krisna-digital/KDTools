# Multi File Converter

A static web app that converts **documents, images, audio, video and ZIP archives entirely in your browser**.
No backend, no database, no third-party conversion API, no uploads. Deployable to **GitHub Pages**.

> Your files are processed locally in your browser. We do not upload or store your files on external servers.

## What is included (51 tools)

| Category | Tools |
|---|---|
| Documents | PDF→DOCX, DOCX→PDF, PDF→XLSX, XLSX→PDF, PDF→PPTX, PPTX→PDF, PDF→JPG, PDF→PNG, JPG→PDF, PNG→PDF (optionally merged), TXT→PDF, HTML→PDF, CSV→XLSX, XLSX→CSV |
| Images | JPG→PNG, PNG→JPG, PNG→WEBP, WEBP→PNG, WEBP→JPG, JPG→WEBP, SVG→PNG, SVG→JPG, BMP→PNG, GIF→PNG, HEIC→JPG/PNG, TIFF→JPG/PNG, Compress & Resize |
| Audio | WAV/AAC/M4A/FLAC/OGG/WMA→MP3, MP3→WAV/AAC/OGG/FLAC, extract audio from MP4 and other video |
| Video | MOV/MKV/WEBM/AVI→MP4, MP4→WEBM, MP4→GIF, Video→MP3/WAV/AAC |
| Archive | Extract ZIP (with preview and selection), Create ZIP |

Every tool has **Recommended** (automatic) and **Advanced** settings, drag & drop, multi-file batches with per-file status,
per-file errors that never fail the whole batch, cancel/retry, single downloads and *Download All as ZIP*.
Light/dark theme, responsive sidebar layout.

## Quick start

```bash
npm install            # downloads the third-party libraries
npm run vendor         # copies their browser builds into ./vendor  (use vendor:strict in CI)
npm run serve          # http://localhost:8080
```

The app is plain HTML + ES modules: there is no build step. `vendor/manifest.json` records which libraries are really
present; a converter whose library is missing is **shown as unavailable and its Convert button is disabled** – it never fakes a result.

## Deploy to GitHub Pages

1. Create a new GitHub repository and push this folder to the `main` branch.
2. *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
3. The workflow `.github/workflows/deploy.yml` runs `npm install`, `npm run vendor:strict` and publishes the site.
4. Open `https://<user>.github.io/<repo>/`.

All paths are relative, so it works under a repository sub-path. No special headers are needed: FFmpeg runs in its **single-thread**
WebAssembly build, which does not require `SharedArrayBuffer` / Cross-Origin Isolation (the price is speed). `.wasm` is served with
the correct MIME type by GitHub Pages.
If you commit `vendor/` yourself instead of using the workflow, remove it from `.gitignore` (it is not ignored by default) and deploy the folder as is.

## Honest capability notes

See [docs/LIBRARIES-AND-LIMITATIONS.md](docs/LIBRARIES-AND-LIMITATIONS.md). In short:

* **Exact / lossless-style**: image conversions, CSV⇄XLSX, ZIP, JPG/PNG/TXT→PDF, PDF→images.
* **Codec based (FFmpeg.wasm)**: audio/video. Works with real encoders but is much slower than desktop FFmpeg and bounded by browser memory.
* **Reconstructed** (not Microsoft Office / Adobe engines): PDF⇄DOCX/XLSX/PPTX and HTML→PDF are rebuilt from text and positions.
  Text, headings, lists, tables and (for ?→PDF) pictures are kept; fonts, complex layout, charts and vector art are not. Each result shows what was not reproduced.
* The **500 MB** limit is a *target*. The app checks file size against an estimate of available memory first and tells you when a file is too big for your device.
* Legacy `.doc`, `.xls`, `.ppt`, RTF, and archive formats other than ZIP are **not supported** and are rejected with a message.
* OCR (Tesseract.js) is optional and only offered when it is present in `vendor/`.

## Tests

```bash
npm install playwright && npx playwright install chromium   # once
npm test        # drives the real UI in headless Chromium, downloads results, verifies them with PIL/pdftotext/openpyxl/python-docx/python-pptx
```

## Project structure

```
index.html            app shell + Content-Security-Policy (blocks every non-same-origin network request)
css/styles.css        design system, light/dark, responsive
js/main.js            sidebar + hash router + theme
js/registry.js        every tool: formats, Recommended/Advanced settings schema, lazy runner
js/core/              validation, queue (controlled concurrency), cleanup, errors, settings, loader, download, zip
js/converters/        image, pdfRender, pdfCreate, pdfExtract, officeToPdf, spreadsheet, media (FFmpeg), archive, ocr
js/lib/               pdfWriter (layout), pdfText (text/table extraction), xlsxLite (XLSX reader/writer), csv
js/workers/           image worker (decode + resize + encode off the main thread)
js/ui/                dom helpers, converter page, settings panel, pages
scripts/              vendor.mjs (copy libs), serve.mjs (dev server)
tests/                e2e.mjs, verify.py, fixtures/
docs/                 USAGE.md, LIBRARIES-AND-LIMITATIONS.md
```

## Privacy & cleanup

* No network request carries file data: the CSP only allows same-origin requests and nothing in the code posts data anywhere.
* Results live in memory (Blob / Object URL) only. They are released: right after download (setting, on by default), on *Clear Files*, when you leave the tool, and on page close (`pagehide`).
* Workers and the FFmpeg/OCR engines are terminated after each batch.
* `localStorage` holds only theme, mode, concurrency and recently-used **tool names** – never file names or content.

Fonts: Liberation Sans/Mono (SIL OFL 1.1) are bundled for PDF text. Third-party libraries keep their own licenses (see `vendor/*/LICENSE` after vendoring and each package's repo).
