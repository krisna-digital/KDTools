// PRINTLAY — artwork.js
// Memuat artwork secara lokal (tanpa upload), validasi tipe/ukuran, sanitasi SVG,
// dan menyiapkan sumber gambar untuk PDF (resolusi asli, tanpa pengecilan kecuali batas canvas).

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_SVG_CHARS = 5 * 1024 * 1024;
const RASTER_EXT = ['png', 'jpg', 'jpeg', 'webp'];
const RASTER_MIME = ['image/png', 'image/jpeg', 'image/webp'];

export function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

async function sniff(file) {
  const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  const s = (a, b) => String.fromCharCode(...buf.slice(a, b));
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Membaca tag orientasi EXIF (1–8) dari JPEG. Browser menerapkan EXIF saat menampilkan gambar,
 * tetapi byte JPEG mentah yang disematkan ke PDF TIDAK — tanpa penanganan ini foto HP bisa terputar/gepeng di PDF.
 */
async function readJpegOrientation(file) {
  try {
    const v = new DataView(await file.slice(0, 65536).arrayBuffer());
    if (v.getUint16(0) !== 0xffd8) return 1;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) { // "Exif"
        const t = off + 10;
        const little = v.getUint16(t) === 0x4949;
        const ifd = t + v.getUint32(t + 4, little);
        const count = v.getUint16(ifd, little);
        for (let i = 0; i < count; i++) {
          const e = ifd + 2 + i * 12;
          if (v.getUint16(e, little) === 0x0112) {
            const o = v.getUint16(e + 8, little);
            return o >= 1 && o <= 8 ? o : 1;
          }
        }
        return 1;
      }
      off += 2 + len;
    }
  } catch { /* anggap tanpa EXIF */ }
  return 1;
}

function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Gagal membaca file.'));
    r.readAsDataURL(blob);
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gambar tidak dapat dibaca.'));
    img.src = src;
  });
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------- Sanitasi SVG ----------
const BAD_TAGS = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas',
  'link', 'meta', 'base', 'animate', 'animatetransform', 'animatemotion', 'set', 'handler', 'listener',
]);
const SAFE_HREF = /^(#|data:image\/(png|jpe?g|webp|gif);base64,)/i;

function cleanCss(text) {
  return text
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none');
}

export function sanitizeSvg(text) {
  if (text.length > MAX_SVG_CHARS) throw new Error('File SVG terlalu besar.');
  if (/<!ENTITY/i.test(text)) throw new Error('SVG ditolak: mengandung deklarasi ENTITY.');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('SVG tidak valid.');
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg') throw new Error('Berkas bukan SVG yang valid.');

  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    const tag = el.localName.toLowerCase();
    if (BAD_TAGS.has(tag)) { el.remove(); continue; }
    if (tag === 'style') el.textContent = cleanCss(el.textContent || '');
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if (name === 'href' || name === 'xlink:href') {
        if (!SAFE_HREF.test(attr.value.trim())) el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style') el.setAttribute(attr.name, cleanCss(attr.value));
      else if (/javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }

  const num = (v) => {
    if (!v || /%/.test(v)) return NaN;
    const x = parseFloat(v);
    return Number.isFinite(x) && x > 0 ? x : NaN;
  };
  let w = num(root.getAttribute('width'));
  let h = num(root.getAttribute('height'));
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
    if (!Number.isFinite(w) || !Number.isFinite(h)) { w = vb[2]; h = vb[3]; }
  } else if (Number.isFinite(w) && Number.isFinite(h)) {
    root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  } else {
    throw new Error('SVG tidak memiliki ukuran (width/height atau viewBox).');
  }
  root.setAttribute('width', String(w));
  root.setAttribute('height', String(h));
  return { svg: new XMLSerializer().serializeToString(root), width: w, height: h };
}

// ---------- Memuat artwork ----------
export async function loadArtwork(file) {
  if (!file) throw new Error('Tidak ada file.');
  if (file.size === 0) throw new Error('File kosong.');
  if (file.size > MAX_FILE_BYTES) throw new Error(`File terlalu besar (${formatBytes(file.size)}); maksimum ${formatBytes(MAX_FILE_BYTES)}.`);

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isSvg = file.type === 'image/svg+xml' || ext === 'svg';
  let format;
  let blob = file;
  let vector = false;
  let svgSize = null;

  if (isSvg) {
    const { svg, width, height } = sanitizeSvg(await file.text());
    blob = new Blob([svg], { type: 'image/svg+xml' });
    format = 'svg';
    vector = true;
    svgSize = { width, height };
  } else {
    if (!RASTER_EXT.includes(ext) && !RASTER_MIME.includes(file.type)) {
      throw new Error('Format tidak didukung. Gunakan PNG, JPG, JPEG, WebP, atau SVG.');
    }
    format = await sniff(file);
    if (!format) throw new Error('Isi file bukan PNG/JPG/WebP yang valid.');
  }

  const displayUrl = URL.createObjectURL(blob);
  let img;
  try {
    img = await loadImage(displayUrl);
  } catch (e) {
    URL.revokeObjectURL(displayUrl);
    throw e;
  }
  const pxW = vector ? svgSize.width : img.naturalWidth;
  const pxH = vector ? svgSize.height : img.naturalHeight;
  if (!pxW || !pxH) { URL.revokeObjectURL(displayUrl); throw new Error('Dimensi gambar tidak terbaca.'); }

  const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }[format];
  let dataUrlPromise = null;
  const art = {
    name: file.name,
    exif: format === 'jpg' ? await readJpegOrientation(file) : 1,
    size: file.size,
    format,
    mime,
    vector,
    pxW,
    pxH,
    displayUrl,
    blob,
    file,
    getDataUrl() {
      if (!dataUrlPromise) {
        dataUrlPromise = vector
          ? Promise.resolve(`data:image/svg+xml;base64,${toBase64Utf8(svgTextCache)}`)
          : readDataUrl(blob);
      }
      return dataUrlPromise;
    },
    revoke() { URL.revokeObjectURL(displayUrl); },
  };
  let svgTextCache = '';
  if (vector) svgTextCache = await blob.text();
  return art;
}

// ---------- Sumber gambar untuk PDF ----------
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

function canvasToDataUrl(canvas, jpeg) {
  return jpeg ? canvas.toDataURL('image/jpeg', 0.98) : canvas.toDataURL('image/png');
}

/**
 * Menghasilkan { normal, rotated } berisi {dataUrl, format('JPEG'|'PNG'), w, h}.
 * - PNG/JPEG: byte asli dipakai apa adanya untuk orientasi normal (tanpa kompresi ulang).
 * - WebP: dikonversi ke PNG lossless.
 * - SVG: dirasterisasi ±300 DPI pada ukuran desain (maks 8000 px).
 * - Rotated: dirotasi 90° searah jarum jam di canvas (hanya jika dibutuhkan).
 * `notes` memuat catatan bila resolusi harus diturunkan karena batas canvas browser.
 */
export async function getPdfSources(art, { designW, designH, needRotated }) {
  const notes = [];
  let normal;
  if (art.format === 'jpg' && art.exif > 1) {
    // JPEG berorientasi EXIF: render ulang lewat canvas (browser menerapkan orientasi) agar piksel = tampilan.
    const img = await loadImage(art.displayUrl);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    normal = { dataUrl: canvasToDataUrl(c, true), format: 'JPEG', w: c.width, h: c.height };
  } else if (art.format === 'png' || art.format === 'jpg') {
    normal = { dataUrl: await art.getDataUrl(), format: art.format === 'jpg' ? 'JPEG' : 'PNG', w: art.pxW, h: art.pxH };
  } else if (art.format === 'webp') {
    const img = await loadImage(art.displayUrl);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    normal = { dataUrl: canvasToDataUrl(c, false), format: 'PNG', w: c.width, h: c.height };
  } else {
    const img = await loadImage(art.displayUrl);
    let pw = Math.round((designW / 25.4) * 300);
    let ph = Math.round(pw * (art.pxH / art.pxW));
    const k = Math.min(1, 8000 / Math.max(pw, ph));
    pw = Math.max(1, Math.round(pw * k)); ph = Math.max(1, Math.round(ph * k));
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    c.getContext('2d').drawImage(img, 0, 0, pw, ph);
    normal = { dataUrl: canvasToDataUrl(c, false), format: 'PNG', w: pw, h: ph };
  }

  let rotated = null;
  if (needRotated) {
    const img = await loadImage(normal.dataUrl);
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    const limit = isIOS() ? 16_000_000 : 100_000_000;
    let scale = 1;
    if (sw * sh > limit) {
      scale = Math.sqrt(limit / (sw * sh));
      notes.push(`Resolusi salinan yang dirotasi diturunkan ke ${Math.round(scale * 100)}% karena batas memori canvas browser.`);
    }
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const c = document.createElement('canvas');
    c.width = dh; c.height = dw; // hasil rotasi: lebar = tinggi sumber
    const ctx = c.getContext('2d');
    ctx.translate(dh, 0);
    ctx.rotate(Math.PI / 2); // 90° searah jarum jam (sama dengan transform SVG)
    ctx.drawImage(img, 0, 0, dw, dh);
    const jpeg = normal.format === 'JPEG';
    rotated = { dataUrl: canvasToDataUrl(c, jpeg), format: jpeg ? 'JPEG' : 'PNG', w: c.width, h: c.height };
  }
  return { normal, rotated, notes };
}
