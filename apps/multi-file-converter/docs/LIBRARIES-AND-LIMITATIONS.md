# Libraries and limitations

## Libraries (copied to `vendor/` by `npm run vendor`)

| Library | Version pinned | Used for | Loaded when |
|---|---|---|---|
| PDF.js (pdfjs-dist) | 6.2.108 | read/render PDFs, extract text positions | first PDF read |
| pdf-lib | 1.17.1 | write PDFs | first PDF write |
| @pdf-lib/fontkit | 1.1.1 | embed Liberation fonts (Unicode text in PDFs). Without it only Latin-1 text is possible and other characters become `?` | PDF write |
| docx | 9.8.1 | write DOCX | PDF→Word |
| PptxGenJS | 4.0.1 | write PPTX | PDF→PowerPoint |
| JSZip | 3.10.1 | ZIP, and reading DOCX/XLSX/PPTX packages | on demand |
| heic2any | 0.0.4 | HEIC decoding | HEIC tools |
| UTIF.js (+pako) | 3.1.0 / 2.1.0 | TIFF decoding | TIFF tools |
| FFmpeg.wasm (@ffmpeg/ffmpeg + @ffmpeg/core, single thread) | 0.12.15 / 0.12.10 | audio and video | first audio/video job (core ≈ 30 MB) |
| Tesseract.js (+core, eng/ind data) | 5.1.1 | optional OCR | when OCR is switched on |
| Browser APIs | – | Canvas/OffscreenCanvas, createImageBitmap, DOMParser, Blob, Workers | – |

Own code instead of SheetJS/Mammoth: XLSX reader/writer (`js/lib/xlsxLite.js`) and DOCX/PPTX readers (`js/converters/officeToPdf.js`).
`vendor/manifest.json` lists which libraries are present; missing ones disable only the converters that need them.

## Per-converter limitations

* **Images** – decoding/encoding use the browser; WEBP encoding needs a browser that supports it (Chrome, Edge, Firefox, recent Safari). Animated GIF/multi-page TIFF: first frame only. JPG output flattens transparency onto the chosen background. Maximum output ≈ 120 megapixels. HEIC and TIFF require heic2any / UTIF in `vendor/`.
* **PDF → JPG/PNG** – rendered by PDF.js at the chosen DPI (very large pages are automatically rendered at a lower DPI and the result says so).
* **PDF → DOCX / XLSX / PPTX** – text-based reconstruction. Headings, paragraphs, bold/italic, simple lists and tables with aligned columns become editable content. Images, vector graphics, multi-column flow, tables without alignment, merged cells and exact fonts are **not** reproduced. Scanned pages have no text: with OCR (if available) they are recognised, otherwise you get a clear error, or – only if you tick the option – the page is inserted as a (non-editable) image and flagged as such.
* **DOCX → PDF** – paragraphs, runs (bold/italic/underline/size/colour), headings, lists, tables, inline pictures, page breaks. Not: headers/footers, footnotes, text boxes, shapes, charts, equations, tracked changes, exact fonts.
* **XLSX → PDF** – each visible sheet is printed as a table using the displayed (formatted) values. Not: charts, images, cell colours, merged-cell layout, print areas.
* **PPTX → PDF** – shapes with their own or layout/master-inherited position, text, simple fills, pictures, tables. Not: gradients, animations, charts, SmartArt, grouped shapes, theme fonts, per-run inherited sizes from layouts.
* **HTML → PDF** – structural layout only (no CSS engine, scripts are never executed, external images and stylesheets are not fetched).
* **CSV ⇄ XLSX** – XLSX written by this app has values, bold/frozen header, widths and dates; no formulas/charts. Reading XLSX returns cached formula results. Legacy `.xls` is not supported.
* **Audio / Video** – FFmpeg.wasm single-thread. Expect several times real-time for video. Available encoders depend on the `@ffmpeg/core` build (MP3, AAC, Vorbis, FLAC, PCM, H.264, VP8, GIF are what the app asks for). **WMA** decoding works only if the core includes a WMA decoder; otherwise you get "Codec not supported". Inputs are mounted lazily (WORKERFS) so a 500 MB file is not copied into memory, but output and encoder memory still count against the browser's WASM limit (≈2–4 GB).
* **Archives** – ZIP only (no RAR/7z/TAR). Encrypted ZIPs are rejected. Zip-bomb guards: ≤ 20 000 entries, ≤ 4 GB uncompressed.
* **Size limit** – 500 MB per file is the *target*. Each tool estimates the memory it needs (file size × a per-tool factor) against `navigator.deviceMemory`; files that cannot realistically be processed are refused with an explanation. Passing the check does not guarantee success.

## Content-Security-Policy note

`index.html` ships a strict CSP (same-origin only, `wasm-unsafe-eval`). If a third-party WASM build (heic2any, Tesseract) turns out to need `unsafe-eval` on your target browsers, relax `script-src` in `index.html` deliberately – never add remote hosts.
