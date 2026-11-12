// Jalankan: node tests/renderer.test.js   (tanpa dependensi)
const assert = require('assert');
const IDS = require('../assets/js/field-mapping.js');
require('../assets/js/renderer.js');
require('../assets/js/export.js');
const defaults = (() => { global.window = undefined; const fs = require('fs'); return {
  front: JSON.parse(fs.readFileSync(__dirname + '/../assets/templates/provinsi/front-config.json', 'utf8')),
  back: JSON.parse(fs.readFileSync(__dirname + '/../assets/templates/provinsi/back-config.json', 'utf8')) }; })();

let pass = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; } }

// pengukur palsu: 0.5 em per karakter (deterministik)
const measure = (text) => Array.from(text).length * 0.5;
const D = { nama: 'Krisna Digital, S.Pd', nip: '1945 202521 2 000', jabatan: 'Guru Ahli Pertama', gol_darah: 'B' };
const F = (c, id) => c.fields.find((f) => f.id === id);

t('ukuran kartu 55 x 85 mm di kedua sisi', () => {
  for (const s of ['front', 'back']) { assert.strictEqual(defaults[s].widthMm, 55); assert.strictEqual(defaults[s].heightMm, 85); }
});
t('config default valid, ID unik, semua field di dalam kartu', () => {
  for (const s of ['front', 'back']) {
    const r = IDS.validateConfig(IDS.clone(defaults[s])); assert.deepStrictEqual(r.errors, []);
    defaults[s].fields.forEach((f) => assert.ok(!IDS.outOfBounds(f, defaults[s]), f.id + ' keluar kartu'));
  }
});
t('validasi menolak ID ganda dan ukuran salah', () => {
  const c = IDS.clone(defaults.front); c.fields.push(IDS.clone(c.fields[1]));
  assert.ok(IDS.validateConfig(c).errors.some((e) => /ganda/.test(e)));
  const d = IDS.clone(defaults.front); d.widthMm = 60; assert.ok(IDS.validateConfig(d).errors.length);
});
t('sinkronisasi: nama & NIP depan/belakang dari satu sumber', () => {
  assert.strictEqual(IDS.fieldText(F(defaults.front, 'nama_depan'), D), D.nama);
  assert.strictEqual(IDS.fieldText(F(defaults.back, 'nama_belakang'), D), D.nama);
  assert.strictEqual(IDS.fieldText(F(defaults.front, 'nip_depan'), D), 'NIP. ' + D.nip);
  assert.strictEqual(IDS.fieldText(F(defaults.back, 'nip_belakang'), D), D.nip);
  const D2 = Object.assign({}, D, { nama: 'X' });
  assert.strictEqual(IDS.fieldText(F(defaults.front, 'nama_depan'), D2), 'X');
  assert.strictEqual(IDS.fieldText(F(defaults.back, 'nama_belakang'), D2), 'X');
});
t('jabatan & golongan darah hanya ada di sisi belakang', () => {
  const sources = (c) => c.fields.filter((f) => f.type === 'text').map((f) => f.source);
  assert.ok(!sources(defaults.front).includes('jabatan') && !sources(defaults.front).includes('gol_darah'));
  assert.ok(sources(defaults.back).includes('jabatan') && sources(defaults.back).includes('gol_darah'));
});
t('field kosong menghasilkan teks kosong (tidak menggambar "undefined")', () => {
  assert.strictEqual(IDS.fieldText(F(defaults.back, 'jabatan'), {}), '');
  assert.strictEqual(IDS.fieldText(F(defaults.front, 'nip_depan'), { nip: '  ' }), '');
});
t('field wajib kosong terdeteksi', () => {
  const m = IDS.missingFields('provinsi', { nama: 'A' }, false).map((x) => x.key);
  assert.deepStrictEqual(m.sort(), ['foto', 'gol_darah', 'jabatan', 'nip'].sort());
  assert.strictEqual(IDS.missingFields('provinsi', D, true).length, 0);
});
t('teks pendek memakai ukuran maksimum', () => {
  const f = Object.assign({}, F(defaults.back, 'jabatan'), { hScale: 1 });
  const r = IDS.fitText(measure, 'AB', f); assert.strictEqual(r.size, f.maxFontSize); assert.ok(!r.overflow);
});
t('teks panjang mengecil agar muat dalam lebar area', () => {
  const f = Object.assign({}, F(defaults.back, 'jabatan'), { hScale: 1, minFontSize: 0.1 });
  const text = 'X'.repeat(80), r = IDS.fitText(measure, text, f);
  assert.ok(r.size < f.maxFontSize); assert.ok(r.lines[0].width <= f.width + 1e-6); assert.ok(!r.overflow);
});
t('teks tak muat pada ukuran minimum -> overflow (tidak dipotong diam-diam)', () => {
  const f = Object.assign({}, F(defaults.back, 'jabatan'), { hScale: 1, minFontSize: 2 });
  const text = 'X'.repeat(200), r = IDS.fitText(measure, text, f);
  assert.strictEqual(r.size, 2); assert.ok(r.overflow); assert.strictEqual(r.lines[0].text, text);
});
t('mode wrap memecah baris dan tetap dalam tinggi area', () => {
  const f = Object.assign({}, F(defaults.back, 'jabatan'), { hScale: 1, wrap: true, height: 12, minFontSize: 0.5 });
  const r = IDS.fitText(measure, 'Pranata Komputer Ahli Pertama pada Dinas Komunikasi dan Informatika', f);
  assert.ok(r.lines.length > 1); assert.ok(!r.overflow);
  r.lines.forEach((l) => assert.ok(l.width <= f.width + 1e-6));
});
t('layout teks: posisi tetap dalam kotak field (kiri/tengah/kanan, atas/tengah/bawah)', () => {
  const base = Object.assign({}, F(defaults.back, 'nama_belakang'), { hScale: 1 });
  for (const ta of ['left', 'center', 'right']) for (const va of ['top', 'middle', 'bottom']) {
    const f = Object.assign({}, base, { textAlign: ta, verticalAlign: va });
    const fit = IDS.fitText(measure, 'ABCDE', f), L = IDS.layoutLines(f, fit)[0];
    assert.ok(L.x >= f.x - 1e-6 && L.x + L.width <= f.x + f.width + 1e-6, ta);
    assert.ok(L.baseline <= f.y + f.height + 1e-6 && L.baseline - IDS.constants.CAP * fit.size >= f.y - 1e-6, va);
  }
});
t('crop foto: tidak terdistorsi (rasio gambar tetap) dan selalu menutup area', () => {
  for (const [iw, ih] of [[3000, 4000], [4000, 3000], [1000, 1000], [358, 472]]) for (const zoom of [1, 1.7]) for (const p of [-1, 0, 1]) {
    const c = IDS.photoCrop(iw, ih, 30.22, 39.84, { zoom, panX: p, panY: p });
    assert.ok(Math.abs(c.dw / c.dh - iw / ih) < 1e-9, 'rasio berubah');
    assert.ok(c.dx <= 1e-9 && c.dy <= 1e-9 && c.dx + c.dw >= 30.22 - 1e-9 && c.dy + c.dh >= 39.84 - 1e-9, 'area tidak tertutup');
  }
});
t('peringatan rasio template tidak 55:85', () => {
  assert.strictEqual(IDS.checkRatio(653, 1007, defaults.front), null);
  assert.ok(IDS.checkRatio(800, 800, defaults.front));
});
console.log(pass + ' tes renderer lulus');
