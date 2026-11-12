// Tool registry: every converter, its accepted formats, settings schema (Recommended + Advanced) and runner.
// Converter code is imported lazily so nothing heavy loads before it is needed.

import { MAX_FILE_SIZE } from './core/format.js';

export const CATEGORIES = [
  { id: 'documents', label: 'Documents', icon: 'file-text', blurb: 'PDF, Word, Excel, PowerPoint, text, HTML' },
  { id: 'images', label: 'Images', icon: 'image', blurb: 'JPG, PNG, WEBP, SVG, GIF, BMP, TIFF, HEIC' },
  { id: 'audio', label: 'Audio', icon: 'music', blurb: 'MP3, WAV, AAC, M4A, FLAC, OGG' },
  { id: 'video', label: 'Video', icon: 'film', blurb: 'MP4, MOV, MKV, WEBM, AVI, GIF' },
  { id: 'archive', label: 'Archive', icon: 'archive', blurb: 'Extract and create ZIP files' },
];

// ---------- reusable option fields ----------
const sel = (id, label, options, def, extra = {}) => ({ id, label, type: 'select', options: options.map((o) => (Array.isArray(o) ? { v: o[0], l: o[1] } : { v: o, l: String(o) })), default: def, ...extra });
const num = (id, label, def, extra = {}) => ({ id, label, type: 'number', default: def, ...extra });
const chk = (id, label, def, extra = {}) => ({ id, label, type: 'checkbox', default: def, ...extra });
const txt = (id, label, def, extra = {}) => ({ id, label, type: 'text', default: def, ...extra });
const color = (id, label, def, extra = {}) => ({ id, label, type: 'color', default: def, ...extra });
const range = (id, label, def, min, max, step = 1, extra = {}) => ({ id, label, type: 'range', default: def, min, max, step, ...extra });

const PAPER = sel('paper', 'Paper size', [['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['a3', 'A3'], ['a5', 'A5']], 'a4');
const ORIENT = sel('orientation', 'Orientation', [['portrait', 'Portrait'], ['landscape', 'Landscape']], 'portrait');
const ENCODING = sel('encoding', 'Text encoding', [['auto', 'Auto-detect'], ['utf-8', 'UTF-8'], ['windows-1252', 'Windows-1252'], ['iso-8859-1', 'ISO-8859-1'], ['utf-16le', 'UTF-16 LE']], 'auto');
const PAGES = txt('pages', 'Page range', 'all', { help: 'For example: 1-3, 5, 8-  (or "all")', placeholder: 'all' });
const OCR = (langs) => [
  sel('ocr', 'OCR (scanned pages)', [['off', 'Off'], ['auto', 'Only for pages without text'], ['force', 'Force on every page']], 'off', { requiresLib: 'tesseract', unavailable: 'The OCR engine (Tesseract.js) is not included in this build.' }),
  sel('ocrLang', 'OCR language', langs, 'eng', { requiresLib: 'tesseract', showIf: (o) => o.ocr && o.ocr !== 'off' }),
];
const OCR_LANGS = [['eng', 'English'], ['ind', 'Indonesian']];

const IMAGE_FIELDS = [
  range('quality', 'Quality (JPG / WEBP)', 90, 10, 100, 1, { help: 'Lower = smaller file. PNG is always lossless.' }),
  sel('resizeMode', 'Resize', [['none', 'Keep original size'], ['percent', 'Scale by percentage'], ['fit', 'Fit inside width × height'], ['exact', 'Exact width / height']], 'none'),
  num('percent', 'Scale (%)', 50, { min: 1, max: 400, showIf: (o) => o.resizeMode === 'percent' }),
  num('width', 'Width (px)', '', { min: 1, max: 20000, showIf: (o) => ['fit', 'exact'].includes(o.resizeMode) }),
  num('height', 'Height (px)', '', { min: 1, max: 20000, showIf: (o) => ['fit', 'exact'].includes(o.resizeMode) }),
  chk('keepAspect', 'Keep aspect ratio', true, { showIf: (o) => o.resizeMode === 'exact' }),
  chk('noUpscale', 'Never enlarge', false, { showIf: (o) => o.resizeMode !== 'none' }),
  sel('dpi', 'Resolution metadata (DPI)', [[0, 'Leave unchanged'], [72, '72 (screen)'], [96, '96'], [150, '150'], [300, '300 (print)']], 0, { help: 'Stored in the file header (JPG/PNG). Does not change pixel size.' }),
];
const BG = color('background', 'Background color', '#ffffff', { help: 'Used where the target format has no transparency (e.g. JPG).' });

// ---------- helpers ----------
const lazy = (mod, fn) => async (ctx) => (await import(mod))[fn](ctx);
const doc = (o) => ({ category: 'documents', maxSize: MAX_FILE_SIZE, ...o });

const fmtName = (e) => e.toUpperCase();

function imageTool(from, to, extra = {}) {
  const accept = Array.isArray(from) ? from : [from];
  const label = `${fmtName(accept[0])} to ${fmtName(to)}`;
  const fields = [...IMAGE_FIELDS];
  if (accept[0] === 'svg') fields.unshift(num('svgWidth', 'Render width (px)', 1024, { min: 16, max: 8000, help: 'SVG is vector: choose the pixel width of the result.' }));
  if (to === 'jpg') fields.push(BG);
  if (to === 'png' || to === 'webp') fields.push(chk('flatten', 'Fill transparency with background color', false), color('background', 'Background color', '#ffffff', { showIf: (o) => o.flatten }));
  return {
    id: `${accept[0]}-${to}`, category: 'images', title: label, from: accept[0], to, accept, mem: 4,
    description: `Convert ${fmtName(accept[0])} images to ${fmtName(to)} in your browser. Batch supported, with optional resize and quality control.`,
    maxSize: MAX_FILE_SIZE, memFactor: 8, hardMemCapMB: 2048, popular: extra.popular,
    fields, preview: 'image',
    recommended: () => ({ quality: to === 'png' ? 100 : 90, resizeMode: 'none', background: '#ffffff', dpi: 0, svgWidth: 1536 }),
    recommendedText: to === 'png' ? 'Lossless PNG at original size' : `Quality 90%, original size${to === 'jpg' ? ', white background for transparency' : ''}`,
    run: lazy('./converters/image.js', 'convertImage'),
    needs: accept[0] === 'heic' ? ['heic'] : (accept[0] === 'tiff' ? ['utif'] : []),
    ...extra,
  };
}

function audioTool(from, to, extra = {}) {
  const accept = Array.isArray(from) ? from : [from];
  const lossy = ['mp3', 'aac', 'm4a', 'ogg'].includes(to);
  const fields = [
    ...(lossy ? [
      sel('quality', 'Quality mode', [['cbr', 'Constant bitrate'], ...(to === 'mp3' || to === 'ogg' ? [['vbr', 'Variable bitrate (VBR)']] : [])], 'cbr'),
      sel('bitrate', 'Bitrate', [64, 96, 128, 160, 192, 224, 256, 320].map((b) => [b, `${b} kbps`]), 192, { showIf: (o) => o.quality !== 'vbr' }),
      ...(to === 'mp3' ? [sel('vbrQuality', 'VBR quality', [[0, '0 – best'], [2, '2 – high'], [4, '4 – good'], [6, '6 – small']], 2, { showIf: (o) => o.quality === 'vbr' })] : []),
    ] : []),
    ...(to === 'wav' ? [sel('bitDepth', 'Bit depth', [[16, '16-bit'], [24, '24-bit']], 16)] : []),
    ...(to === 'flac' ? [sel('compression', 'Compression level', [[0, '0 – fastest'], [5, '5 – balanced'], [8, '8 – smallest']], 5)] : []),
    sel('sampleRate', 'Sample rate', [[0, 'Keep original'], [22050, '22.05 kHz'], [32000, '32 kHz'], [44100, '44.1 kHz'], [48000, '48 kHz']], 0),
    sel('channels', 'Channels', [['auto', 'Keep original'], ['mono', 'Mono'], ['stereo', 'Stereo']], 'auto'),
  ];
  return {
    id: extra.id || `${accept[0]}-${to}`, category: extra.category || 'audio', title: extra.title || `${fmtName(accept[0])} to ${fmtName(to)}`,
    from: accept[0], to, accept, maxSize: MAX_FILE_SIZE, memFactor: 1.5, hardMemCapMB: 3072, heavy: true,
    description: extra.description || `Convert ${fmtName(accept[0])} audio to ${fmtName(to)} using FFmpeg (WebAssembly) in your browser.`,
    fields, preview: 'audio', needs: ['ffmpeg'],
    recommended: () => ({ quality: 'cbr', bitrate: to === 'aac' || to === 'm4a' ? 192 : 192, sampleRate: 0, channels: 'auto', bitDepth: 16, compression: 5 }),
    recommendedText: lossy ? '192 kbps, original sample rate and channels' : 'Lossless, original sample rate and channels',
    run: lazy('./converters/media.js', 'convertAudio'),
    ...extra,
  };
}

const VIDEO_ACCEPT = ['mp4', 'mov', 'mkv', 'webm', 'avi'];

function videoTool(from, to, extra = {}) {
  const accept = Array.isArray(from) ? from : [from];
  const common = [
    sel('height', 'Resolution (height)', [[0, 'Keep original'], [2160, '2160p (4K)'], [1440, '1440p'], [1080, '1080p'], [720, '720p'], [480, '480p'], [360, '360p']], 0),
    sel('fps', 'Frame rate', [[0, 'Keep original'], [60, '60 fps'], [30, '30 fps'], [25, '25 fps'], [24, '24 fps'], [15, '15 fps']], 0),
  ];
  const fields = to === 'gif' ? [
    num('gifStart', 'Start at (seconds)', 0, { min: 0 }),
    num('gifDuration', 'Duration (seconds)', 5, { min: 1, max: 120, help: 'GIFs get large quickly. 3–10 s is recommended.' }),
    sel('gifFps', 'GIF frame rate', [5, 8, 10, 12, 15, 20, 24].map((f) => [f, `${f} fps`]), 12),
    sel('gifWidth', 'GIF width', [240, 320, 480, 640, 800, 1024].map((w) => [w, `${w} px`]), 480),
    sel('gifColors', 'Colors', [[256, '256'], [128, '128'], [64, '64'], [32, '32']], 256),
    sel('gifLoop', 'Loop', [['forever', 'Forever'], ['once', 'Play once']], 'forever'),
  ] : [
    ...common,
    sel('crf', 'Quality / compression', [[18, 'High quality (large)'], [23, 'Balanced'], [28, 'Small file'], [32, 'Smallest file']], 23, { help: 'Constant-quality mode (CRF). Ignored when a video bitrate is set.' }),
    num('videoBitrate', 'Video bitrate (kbps, 0 = automatic)', 0, { min: 0, max: 50000 }),
    sel('audio', 'Audio', [['keep', 'Keep audio'], ['none', 'Remove audio']], 'keep'),
    sel('audioBitrate', 'Audio bitrate', [64, 96, 128, 160, 192, 256].map((b) => [b, `${b} kbps`]), 128, { showIf: (o) => o.audio !== 'none' }),
    ...(to === 'mp4' ? [sel('preset', 'Encoding speed', [['ultrafast', 'Fastest (larger)'], ['veryfast', 'Fast'], ['medium', 'Slower (smaller)']], 'veryfast'), sel('videoCodec', 'Video codec', [['auto', 'H.264 (libx264)']], 'auto')] : []),
  ];
  return {
    id: extra.id || `${accept[0]}-${to}`, category: 'video', title: extra.title || `${fmtName(accept[0])} to ${fmtName(to)}`, from: accept[0], to, accept,
    maxSize: MAX_FILE_SIZE, memFactor: 2, hardMemCapMB: 3072, heavy: true,
    description: `Convert ${fmtName(accept[0])} video to ${fmtName(to)} with FFmpeg (WebAssembly). Encoding runs on your CPU and can be slow for large files.`,
    fields, preview: 'video', needs: ['ffmpeg'],
    recommended: (files) => {
      const big = files.some((f) => f.size > 200 * 1024 * 1024);
      return to === 'gif' ? { gifStart: 0, gifDuration: 5, gifFps: 12, gifWidth: 480, gifColors: 256, gifLoop: 'forever' }
        : { height: big ? 720 : 0, fps: 0, crf: big ? 28 : 23, videoBitrate: 0, audio: 'keep', audioBitrate: 128, preset: 'veryfast', videoCodec: 'auto' };
    },
    recommendedText: to === 'gif' ? '5 seconds, 12 fps, 480 px wide' : 'Balanced quality (CRF 23), original resolution, 128 kbps audio (files over 200 MB: 720p, CRF 28)',
    run: lazy('./converters/media.js', 'convertVideo'),
    ...extra,
  };
}

function videoAudioTool(to) {
  const t = audioTool(VIDEO_ACCEPT, to, { id: `video-${to}`, category: 'video', title: `Video to ${fmtName(to)}`, description: `Extract the audio track of a video and save it as ${fmtName(to)}.` });
  t.preview = 'video';
  t.run = lazy('./converters/media.js', 'extractAudio');
  return t;
}

const pdfImageFields = (to) => [
  sel('dpi', 'Resolution (DPI)', [[72, '72 – screen, small'], [96, '96'], [150, '150 – balanced'], [200, '200'], [300, '300 – print'], [450, '450 – very large']], 150),
  PAGES,
  ...(to === 'jpg' ? [range('quality', 'JPG quality', 90, 10, 100)] : [chk('transparent', 'Transparent background', false)]),
  color('background', 'Background color', '#ffffff', { showIf: (o) => to === 'jpg' || !o.transparent }),
];

// ---------- tools ----------
export const TOOLS = [
  // ===== Documents =====
  doc({
    id: 'pdf-docx', title: 'PDF to Word (DOCX)', from: 'pdf', to: 'docx', accept: ['pdf'], memFactor: 6, popular: true,
    description: 'Rebuild a PDF as an editable Word document: text, headings, lists and detected tables. Scanned PDFs need OCR.',
    fields: [
      sel('layout', 'Layout mode', [['layout', 'Preserve layout (page-sized sections, indents)'], ['flow', 'Editable text first (continuous flow)']], 'layout'),
      PAGES, chk('tables', 'Detect tables', true), chk('snapshots', 'Insert scanned pages as images (not editable)', false), ...OCR(OCR_LANGS),
    ],
    recommended: () => ({ layout: 'layout', pages: 'all', tables: true, snapshots: false, ocr: 'off' }),
    recommendedText: 'Preserve layout, detect tables', needs: ['pdfjs', 'docx'],
    run: lazy('./converters/pdfExtract.js', 'pdfToDocx'),
  }),
  doc({
    id: 'docx-pdf', title: 'Word (DOCX) to PDF', from: 'docx', to: 'pdf', accept: ['docx'], memFactor: 6, popular: true,
    description: 'Convert a Word document to PDF with real, selectable text, tables, lists and pictures. Only .docx is supported (not legacy .doc).',
    fields: [sel('paper', 'Page size', [['auto', 'Same as document'], ['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal']], 'auto'), ORIENT, num('margin', 'Margin (pt)', 60, { min: 0, max: 150, showIf: (o) => o.paper !== 'auto' })],
    recommended: () => ({ paper: 'auto', orientation: 'portrait', margin: 60 }), recommendedText: 'Use the document page size', needs: ['pdflib', 'jszip'],
    run: lazy('./converters/officeToPdf.js', 'docxToPdf'),
  }),
  doc({
    id: 'pdf-xlsx', title: 'PDF to Excel (XLSX)', from: 'pdf', to: 'xlsx', accept: ['pdf'], memFactor: 6,
    description: 'Detect and rebuild tables from a PDF as Excel sheets. Works for PDFs with selectable text and aligned columns.',
    fields: [
      PAGES,
      sel('sheetMode', 'Sheets', [['perTable', 'One sheet per table'], ['perPage', 'One sheet per table (page-labelled)'], ['single', 'All tables on one sheet']], 'perTable'),
      num('minRows', 'Minimum rows per table', 2, { min: 2, max: 20 }), num('minCols', 'Minimum columns per table', 2, { min: 2, max: 20 }),
      chk('numbers', 'Convert numeric text to numbers', true), chk('includeText', 'Also include non-table text', false), ...OCR(OCR_LANGS),
    ],
    recommended: () => ({ pages: 'all', sheetMode: 'perTable', minRows: 2, minCols: 2, numbers: true, includeText: false, ocr: 'off' }),
    recommendedText: 'One sheet per detected table, numbers converted', needs: ['pdfjs', 'jszip'],
    run: lazy('./converters/pdfExtract.js', 'pdfToXlsx'),
  }),
  doc({
    id: 'xlsx-pdf', title: 'Excel (XLSX) to PDF', from: 'xlsx', to: 'pdf', accept: ['xlsx'], memFactor: 6,
    description: 'Print the sheets of an Excel workbook as PDF tables. Values are shown as formatted in Excel; charts and images are not included.',
    fields: [PAPER, sel('orientation', 'Orientation', [['landscape', 'Landscape'], ['portrait', 'Portrait']], 'landscape'), num('fontSize', 'Font size (pt)', 9, { min: 5, max: 16 }), num('margin', 'Margin (pt)', 36, { min: 0, max: 100 }),
      sel('fit', 'Wide sheets', [['split', 'Split columns across pages'], ['width', 'Squeeze to page width']], 'split'), chk('headerRow', 'Style first row as header', true), chk('sheetTitles', 'Show sheet names', true), chk('hiddenSheets', 'Include hidden sheets', false)],
    recommended: () => ({ paper: 'a4', orientation: 'landscape', fontSize: 9, margin: 36, fit: 'split', headerRow: true, sheetTitles: true, hiddenSheets: false }),
    recommendedText: 'A4 landscape, 9 pt, split wide sheets', needs: ['pdflib', 'jszip'],
    run: lazy('./converters/officeToPdf.js', 'xlsxToPdf'),
  }),
  doc({
    id: 'pdf-pptx', title: 'PDF to PowerPoint (PPTX)', from: 'pdf', to: 'pptx', accept: ['pdf'], memFactor: 6,
    description: 'One slide per PDF page with editable text boxes and tables. Pictures and graphics are not rebuilt (optionally kept as a background image).',
    fields: [PAGES, sel('background', 'Slide background', [['none', 'Plain (fully editable)'], ['snapshot', 'Original page as background image (text appears twice)']], 'none'), chk('snapshots', 'Insert scanned pages as images (not editable)', false), ...OCR(OCR_LANGS)],
    recommended: () => ({ pages: 'all', background: 'none', snapshots: false, ocr: 'off' }), recommendedText: 'Editable text boxes, plain background', needs: ['pdfjs', 'pptxgen'],
    run: lazy('./converters/pdfExtract.js', 'pdfToPptx'),
  }),
  doc({
    id: 'pptx-pdf', title: 'PowerPoint (PPTX) to PDF', from: 'pptx', to: 'pdf', accept: ['pptx'], memFactor: 6,
    description: 'Convert slides to PDF pages with real text, tables and pictures. Complex effects, charts and themes are simplified. Only .pptx is supported.',
    fields: [txt('slides', 'Slide range', 'all', { help: 'For example: 1-3, 5', placeholder: 'all' })],
    recommended: () => ({ slides: 'all' }), recommendedText: 'All slides, original slide size', needs: ['pdflib', 'jszip'],
    run: lazy('./converters/officeToPdf.js', 'pptxToPdf'),
  }),
  doc({
    id: 'pdf-jpg', title: 'PDF to JPG', from: 'pdf', to: 'jpg', accept: ['pdf'], memFactor: 4, popular: true,
    description: 'Render every page of a PDF as a JPG image.', fields: pdfImageFields('jpg'),
    recommended: () => ({ dpi: 150, pages: 'all', quality: 90, background: '#ffffff' }), recommendedText: '150 DPI, quality 90%, all pages', needs: ['pdfjs'],
    run: lazy('./converters/pdfRender.js', 'pdfToImages'),
  }),
  doc({
    id: 'pdf-png', title: 'PDF to PNG', from: 'pdf', to: 'png', accept: ['pdf'], memFactor: 4,
    description: 'Render every page of a PDF as a lossless PNG image.', fields: pdfImageFields('png'),
    recommended: () => ({ dpi: 150, pages: 'all', transparent: false, background: '#ffffff' }), recommendedText: '150 DPI, all pages', needs: ['pdfjs'],
    run: lazy('./converters/pdfRender.js', 'pdfToImages'),
  }),
  ...['jpg', 'png'].map((ext) => doc({
    id: `${ext}-pdf`, title: `${ext.toUpperCase()} to PDF`, from: ext, to: 'pdf', accept: ext === 'jpg' ? ['jpg', 'jpeg'] : ['png'], memFactor: 8, hardMemCapMB: 2048, popular: ext === 'jpg', preview: 'image',
    description: `Turn ${ext.toUpperCase()} images into a PDF – one PDF per image, or all images merged into one document.`, groupWhen: (o) => o.merge,
    fields: [
      chk('merge', 'Merge all images into one PDF', false),
      sel('paper', 'Page size', [['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['a5', 'A5'], ['fit', 'Same as image']], 'a4'),
      sel('orientation', 'Orientation', [['auto', 'Automatic'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], 'auto', { showIf: (o) => o.paper !== 'fit' }),
      num('margin', 'Margin (pt)', 24, { min: 0, max: 100, showIf: (o) => o.paper !== 'fit' }),
      sel('scaleMode', 'Image scaling', [['fit', 'Fit inside the page'], ['fill', 'Fill the page (crop)']], 'fit', { showIf: (o) => o.paper !== 'fit' }),
      chk('noUpscale', 'Do not enlarge small images', false, { showIf: (o) => o.paper !== 'fit' }),
      range('quality', 'Image quality', 85, 30, 100, 1, { help: 'Images are re-compressed unless set to 95+ (JPG is embedded untouched).' }),
      sel('maxImageWidth', 'Downscale large images', [[0, 'No'], [3000, '3000 px'], [2000, '2000 px'], [1500, '1500 px']], 0),
      color('background', 'Background color (transparent areas)', '#ffffff'),
    ],
    recommended: () => ({ merge: false, paper: 'a4', orientation: 'auto', margin: 24, scaleMode: 'fit', noUpscale: false, quality: 85, maxImageWidth: 3000, background: '#ffffff' }),
    recommendedText: 'A4, auto orientation, 24 pt margin, quality 85%', needs: ['pdflib'],
    run: async (ctx) => {
      const m = await import('./converters/pdfCreate.js');
      if (ctx.files) return { outputs: [{ name: 'images.pdf', blob: await m.imagesToPdf(ctx), mime: 'application/pdf' }], warnings: [] };
      return m.imageToPdf(ctx);
    },
  })),
  doc({
    id: 'txt-pdf', title: 'TXT to PDF', from: 'txt', to: 'pdf', accept: ['txt'], memFactor: 6,
    description: 'Convert plain text to a PDF with selectable text and automatic page breaks.',
    fields: [PAPER, ORIENT, sel('font', 'Font', [['sans', 'Sans-serif'], ['mono', 'Monospace']], 'sans'), num('fontSize', 'Font size (pt)', 11, { min: 6, max: 32 }), num('lineHeight', 'Line spacing', 1.4, { min: 1, max: 3, step: 0.1 }), num('margin', 'Margin (pt)', 54, { min: 10, max: 150 }), chk('wrap', 'Wrap long lines', true), ENCODING],
    recommended: () => ({ paper: 'a4', orientation: 'portrait', font: 'sans', fontSize: 11, lineHeight: 1.4, margin: 54, wrap: true, encoding: 'auto' }),
    recommendedText: 'A4, 11 pt sans-serif', needs: ['pdflib'],
    run: lazy('./converters/pdfCreate.js', 'txtToPdf'),
  }),
  doc({
    id: 'html-pdf', title: 'HTML to PDF', from: 'html', to: 'pdf', accept: ['html', 'htm'], memFactor: 6,
    description: 'Lay out an HTML file as a PDF: headings, paragraphs, lists, tables and embedded images. Scripts never run and full CSS layout is not supported.',
    fields: [PAPER, ORIENT, num('fontSize', 'Base font size (pt)', 11, { min: 6, max: 24 }), num('margin', 'Margin (pt)', 50, { min: 10, max: 150 }), chk('showTitle', 'Print <title> as heading', false), ENCODING],
    recommended: () => ({ paper: 'a4', orientation: 'portrait', fontSize: 11, margin: 50, showTitle: false, encoding: 'auto' }), recommendedText: 'A4, 11 pt', needs: ['pdflib'],
    run: lazy('./converters/pdfCreate.js', 'htmlToPdf'),
  }),
  doc({
    id: 'csv-xlsx', title: 'CSV to XLSX', from: 'csv', to: 'xlsx', accept: ['csv'], memFactor: 8,
    description: 'Convert CSV to an Excel workbook with automatic delimiter detection and number recognition.',
    fields: [sel('delimiter', 'Delimiter', [['auto', 'Auto-detect'], ['comma', 'Comma ,'], ['semicolon', 'Semicolon ;'], ['tab', 'Tab'], ['pipe', 'Pipe |']], 'auto'), ENCODING, chk('inferTypes', 'Convert numbers and booleans', true, { help: 'Leading zeros (e.g. 007) stay as text.' }), chk('headerRow', 'First row is a header (bold + frozen)', true), txt('sheetName', 'Sheet name', 'Sheet1')],
    recommended: () => ({ delimiter: 'auto', encoding: 'auto', inferTypes: true, headerRow: true, sheetName: 'Sheet1' }), recommendedText: 'Auto-detect delimiter and encoding', needs: ['jszip'],
    run: lazy('./converters/spreadsheet.js', 'csvToXlsx'),
  }),
  doc({
    id: 'xlsx-csv', title: 'XLSX to CSV', from: 'xlsx', to: 'csv', accept: ['xlsx'], memFactor: 8,
    description: 'Export Excel sheets to CSV files (UTF-8). Each sheet becomes its own file.',
    fields: [sel('delimiter', 'Delimiter', [['comma', 'Comma ,'], ['semicolon', 'Semicolon ;'], ['tab', 'Tab'], ['pipe', 'Pipe |']], 'comma'), sel('sheetMode', 'Sheets', [['all', 'All sheets (one file each)'], ['first', 'First sheet only']], 'all'), chk('useFormatted', 'Use displayed (formatted) values', true), chk('quoteAll', 'Quote every field', false), chk('bom', 'Add UTF-8 BOM (for Excel)', false), chk('hiddenSheets', 'Include hidden sheets', false)],
    recommended: () => ({ delimiter: 'comma', sheetMode: 'all', useFormatted: true, quoteAll: false, bom: false, hiddenSheets: false }), recommendedText: 'Comma-separated, all visible sheets', needs: ['jszip'],
    run: lazy('./converters/spreadsheet.js', 'xlsxToCsv'),
  }),

  // ===== Images =====
  imageTool(['jpg', 'jpeg'], 'png'), imageTool('png', 'jpg', { popular: true }), imageTool('png', 'webp'), imageTool('webp', 'png'), imageTool('webp', 'jpg'),
  imageTool(['jpg', 'jpeg'], 'webp', { popular: true }), imageTool('svg', 'png'), imageTool('svg', 'jpg'), imageTool('bmp', 'png'), imageTool('gif', 'png'),
  imageTool('heic', 'jpg', { popular: true }), imageTool('heic', 'png'), imageTool(['tif', 'tiff'], 'jpg'), imageTool(['tif', 'tiff'], 'png'),
  {
    id: 'image-compress', category: 'images', title: 'Compress & Resize Image', from: 'img', to: 'img', accept: ['jpg', 'jpeg', 'png', 'webp'], maxSize: MAX_FILE_SIZE, memFactor: 8, hardMemCapMB: 2048, preview: 'image', popular: true,
    description: 'Reduce image file size and/or dimensions. JPG and WEBP use lossy compression; PNG is only resized.',
    resolveTarget: (o, ext) => (o.outFormat === 'same' ? (ext === 'jpeg' ? 'jpg' : ext) : o.outFormat),
    fields: [sel('outFormat', 'Output format', [['same', 'Keep original format'], ['jpg', 'JPG'], ['webp', 'WEBP'], ['png', 'PNG']], 'same'), ...IMAGE_FIELDS, BG],
    recommended: () => ({ outFormat: 'same', quality: 78, resizeMode: 'fit', width: 2560, height: 2560, noUpscale: true, background: '#ffffff', dpi: 0 }),
    recommendedText: 'Quality 78%, longest side limited to 2560 px', needs: [],
    run: lazy('./converters/image.js', 'convertImage'),
  },

  // ===== Audio =====
  audioTool('wav', 'mp3', { popular: true }), audioTool('mp3', 'wav'), audioTool('aac', 'mp3'), audioTool('m4a', 'mp3'), audioTool('flac', 'mp3'), audioTool('ogg', 'mp3'),
  audioTool('wma', 'mp3', { description: 'Convert WMA to MP3. Works only if the bundled FFmpeg build includes a WMA decoder; otherwise you will see a "Codec not supported" message.' }),
  audioTool('mp3', 'aac'), audioTool('mp3', 'ogg'), audioTool('mp3', 'flac'),
  audioTool(VIDEO_ACCEPT, 'mp3', { id: 'audio-extract', title: 'Extract Audio from Video (MP4 and more)', description: 'Extract the audio track from MP4, MOV, MKV, WEBM or AVI. Pick MP3, WAV, AAC, M4A, OGG or FLAC.', preview: 'video' }),

  // ===== Video =====
  videoTool('mov', 'mp4'), videoTool('mkv', 'mp4'), videoTool('webm', 'mp4'), videoTool('avi', 'mp4'), videoTool('mp4', 'webm'), videoTool('mp4', 'gif'),
  videoAudioTool('mp3'), videoAudioTool('wav'), videoAudioTool('aac'),

  // ===== Archive =====
  {
    id: 'zip-extract', category: 'archive', title: 'Extract ZIP', from: 'zip', to: 'files', accept: ['zip'], maxSize: MAX_FILE_SIZE, memFactor: 3, preview: 'zip', popular: true,
    description: 'Open a ZIP file, preview its contents, choose what to extract and download files individually or re-zipped. ZIP is the only archive format supported.',
    fields: [sel('structure', 'Folder structure', [['keep', 'Keep folders'], ['flat', 'Flatten (all files in one folder)'], ['folder', 'Put everything in a folder named after the ZIP']], 'keep')],
    recommended: () => ({ structure: 'keep' }), recommendedText: 'Extract all files, keep folders', needs: ['jszip'],
    run: lazy('./converters/archive.js', 'extractZip'),
  },
  {
    id: 'zip-create', category: 'archive', title: 'Create ZIP', from: 'any', to: 'zip', accept: [], maxSize: MAX_FILE_SIZE, memFactor: 2, preview: 'none', group: true, popular: true,
    description: 'Combine any number of files into one ZIP archive.',
    fields: [sel('level', 'Compression level', [[0, '0 – store only'], [1, '1 – fastest'], [6, '6 – balanced'], [9, '9 – smallest']], 6), txt('zipName', 'ZIP file name', 'archive')],
    recommended: () => ({ level: 6, zipName: 'archive' }), recommendedText: 'Balanced compression', needs: ['jszip'],
    run: async (ctx) => {
      const { blob } = await (await import('./converters/archive.js')).zipFiles(ctx);
      const name = (String(ctx.options.zipName || 'archive').replace(/\.zip$/i, '') || 'archive') + '.zip';
      return { outputs: [{ name, blob, mime: 'application/zip' }], warnings: [] };
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.id, t]));
export const toolsIn = (cat) => TOOLS.filter((t) => t.category === cat);
export const getTool = (id) => TOOL_MAP.get(id);

/** Default values for every field of a tool. */
export function defaultOptions(tool) {
  const o = {};
  for (const f of tool.fields || []) o[f.id] = f.default;
  return o;
}

/** Options actually used for conversion in a mode. */
export function effectiveOptions(tool, mode, advancedValues, files) {
  const base = defaultOptions(tool);
  if (mode === 'advanced') return { ...base, ...advancedValues };
  return { ...base, ...(tool.recommended?.(files) || {}) };
}
