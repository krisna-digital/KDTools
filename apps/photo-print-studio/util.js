/**
 * util.js — Fungsi bantu umum (ID, angka, blob/canvas, ZIP, metadata DPI).
 */
(function () {
  'use strict';
  const PPS = (window.PPS = window.PPS || {});

  const U = {
    uid(prefix = 'id') {
      const r = (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 4e9, Math.random() * 4e9]);
      return prefix + '_' + Array.from(r).map((n) => (n >>> 0).toString(36)).join('');
    },
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    round: (v, d = 2) => { const k = Math.pow(10, d); return Math.round(v * k) / k; },
    num(v, fallback = 0) { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : fallback; },
    esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    mm(v) { return (Math.round(v * 100) / 100).toString().replace('.', ','); },
    debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = () => { clearTimeout(t); fn(); }; d.cancel = () => clearTimeout(t); return d; },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    nextFrame: () => new Promise((r) => requestAnimationFrame(() => r())),
    /** Beri kesempatan UI bernapas (hindari freeze saat proses berat). */
    yieldUI: () => new Promise((r) => setTimeout(r, 0)),
    deepClone: (o) => JSON.parse(JSON.stringify(o)),

    canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; },
    toBlob(canvas, type = 'image/png', q) {
      return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Gagal membuat gambar (canvas terlalu besar atau memori tidak cukup).'))), type, q));
    },
    blobToDataURL(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); },
    dataURLToBlob(url) {
      const [h, b64] = url.split(',');
      const mime = /data:([^;]+)/.exec(h)[1];
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    },
    /** Decode gambar dengan orientasi EXIF diterapkan. */
    async bitmap(blob) { return createImageBitmap(blob, { imageOrientation: 'from-image' }); },
    download(blob, filename) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    },
    safeName(s) { return String(s || 'proyek').replace(/[^\w\-. ]+/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'proyek'; },
    fmtBytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; },
    fmtDate(ts) { return new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); },
    mmToPx: (mm, dpi) => (mm / 25.4) * dpi,

    // ---------- ZIP (store, tanpa kompresi) ----------
    crc32(buf) {
      if (!U._crcT) { U._crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; U._crcT[n] = c >>> 0; } }
      let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = U._crcT[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
    },
    /** files: [{name, blob}] -> Blob zip */
    async zip(files) {
      const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
      const d = new Date(); const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      for (const f of files) {
        const data = new Uint8Array(await f.blob.arrayBuffer()); const name = enc.encode(f.name); const crc = U.crc32(data);
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
        lh.setUint16(10, dosT, true); lh.setUint16(12, dosD, true); lh.setUint32(14, crc, true);
        lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
        parts.push(lh.buffer, name, data);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
        ch.setUint16(12, dosT, true); ch.setUint16(14, dosD, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
        ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
        central.push(ch.buffer, name);
        offset += 30 + name.length + data.length;
      }
      let cdSize = 0; central.forEach((c) => (cdSize += c.byteLength));
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
      end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
      return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
    },

    // ---------- Metadata DPI pada PNG / JPEG (agar dicetak pada ukuran fisik benar) ----------
    async setDpi(blob, dpi) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      if (blob.type === 'image/png') {
        const ppm = Math.round(dpi / 0.0254);
        const chunk = new Uint8Array(21); const dv = new DataView(chunk.buffer);
        dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
        dv.setUint32(17, U.crc32(chunk.subarray(4, 17)));
        // sisipkan setelah IHDR (8 sig + 25 IHDR); hapus pHYs lama bila ada
        const out = new Uint8Array(buf.length + 21); out.set(buf.subarray(0, 33), 0); out.set(chunk, 33); out.set(buf.subarray(33), 54);
        return new Blob([out], { type: 'image/png' });
      }
      if (blob.type === 'image/jpeg' && buf[2] === 0xff && buf[3] === 0xe0 && buf[6] === 0x4a) { // JFIF APP0
        buf[13] = 1; buf[14] = (dpi >> 8) & 255; buf[15] = dpi & 255; buf[16] = (dpi >> 8) & 255; buf[17] = dpi & 255;
        return new Blob([buf], { type: 'image/jpeg' });
      }
      return blob;
    },
  };
  PPS.Util = U;
})();
