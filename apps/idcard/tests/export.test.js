// Jalankan: node tests/export.test.js
const assert = require('assert'), zlib = require('zlib');
const IDS = require('../assets/js/export.js');
let pass = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; } }
const img = (w, h) => ({ imgW: w, imgH: h, filter: 'FlateDecode', data: zlib.deflateSync(Buffer.alloc(w * h * 3, 255)) });

t('55 mm = 155.9055 pt, 85 mm = 240.9449 pt', () => {
  assert.ok(Math.abs(IDS.mmToPt(55) - 155.9055) < 1e-3); assert.ok(Math.abs(IDS.mmToPt(85) - 240.9449) < 1e-3);
});
t('PDF 2 halaman: tiap MediaBox tepat 55 x 85 mm, tanpa margin', () => {
  const pdf = IDS.buildPdf([Object.assign({ wMm: 55, hMm: 85 }, img(8, 12)), Object.assign({ wMm: 55, hMm: 85 }, img(8, 12))], 'uji');
  const boxes = IDS.readMediaBoxes(pdf); assert.strictEqual(boxes.length, 2);
  boxes.forEach((b) => { assert.ok(Math.abs(b.w / 72 * 25.4 - 55) < 0.01); assert.ok(Math.abs(b.h / 72 * 25.4 - 85) < 0.01); });
});
t('PDF bukan A4 dan memakai PrintScaling=None', () => {
  const pdf = Buffer.from(IDS.buildPdf([Object.assign({ wMm: 55, hMm: 85 }, img(4, 6))])).toString('latin1');
  assert.ok(!/595\.\d+ 841\.\d+/.test(pdf)); assert.ok(pdf.includes('/PrintScaling /None'));
});
t('struktur PDF: header, xref, trailer, offset xref benar', () => {
  const u8 = IDS.buildPdf([Object.assign({ wMm: 55, hMm: 85 }, img(4, 6))]), s = Buffer.from(u8).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4')); assert.ok(s.trimEnd().endsWith('%%EOF'));
  const start = parseInt(/startxref\n(\d+)/.exec(s)[1], 10); assert.strictEqual(s.substr(start, 4), 'xref');
  const m = /xref\n0 (\d+)\n/.exec(s); const n = +m[1]; const entries = s.substr(start + m[0].length, n * 20).match(/\d{10} \d{5} [nf]/g);
  entries.slice(1).forEach((e, i) => { const off = parseInt(e, 10); assert.ok(new RegExp('^' + (i + 1) + ' 0 obj').test(s.substr(off, 12)), 'offset obj ' + (i + 1)); });
});
t('PDF 1 halaman berdampingan: lebar = 2 kartu + jarak', () => {
  const pdf = IDS.buildPdf([Object.assign({ wMm: 115, hMm: 85 }, img(8, 6))]), b = IDS.readMediaBoxes(pdf)[0];
  assert.ok(Math.abs(b.w / 72 * 25.4 - 115) < 0.01);
});
t('PNG: chunk pHYs menyimpan DPI yang benar dan PNG tetap valid', () => {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) : 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
  const out = Buffer.from(IDS.pngSetDpi(new Uint8Array(png), 600));
  assert.strictEqual(out.toString('latin1', 37, 41), 'pHYs');
  assert.strictEqual(out.readUInt32BE(41), 23622); assert.strictEqual(out.readUInt32BE(45), 23622);
  if (zlib.crc32) assert.strictEqual(out.readUInt32BE(50), zlib.crc32(out.subarray(37, 50)));
  assert.strictEqual(out.toString('latin1', 58, 62), 'IDAT');
});
t('nama file aman', () => { assert.strictEqual(IDS.safeName('Krisna Digital, S.Pd'), 'Krisna_Digital_S_Pd'); assert.strictEqual(IDS.safeName(''), 'idcard'); });
console.log(pass + ' tes export lulus');
