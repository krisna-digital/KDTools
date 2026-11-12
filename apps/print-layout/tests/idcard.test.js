import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutCard, drawLayout, checkTemplateAspect, validateConfig, PT_TO_MM } from '../assets/js/idcard/engine.js';
import { ID_CARD_TYPES, formForSide, getType } from '../assets/js/idcard/types.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../templates/provinsi/${f}`, import.meta.url), 'utf8'));
const FRONT = load('front-config.json');
const BACK = load('back-config.json');
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// Pengukur palsu deterministik: tiap karakter selebar 0,5 em.
const measure = { width: (t) => [...t].length * 0.5, metrics: () => ({ capEm: 0.7, descEm: 0.2 }) };
const DATA = { nama: 'BAIQ USNIATI, S.Pd', nip: '19990822 202521 2 000', jabatan: 'Guru Ahli Pertama', gol_darah: 'B' };
const PHOTO = { pxW: 3000, pxH: 4000 };
const lay = (cfg, data = DATA, photo = PHOTO) => layoutCard(cfg, data, { measure, photo });
const textOps = (L) => L.ops.filter((o) => o.kind === 'text');
const textOf = (L, id) => textOps(L).find((o) => o.id === id);
const field = (cfg, id) => cfg.fields.find((f) => f.id === id);

test('ukuran fisik template = 55 × 85 mm (portrait) di kedua sisi', () => {
  for (const c of [FRONT, BACK]) {
    assert.deepEqual(c.size, { widthMm: 55, heightMm: 85 });
    assert.ok(c.size.heightMm > c.size.widthMm);
  }
});

test('rasio template: 653×1007 dalam toleransi; rasio salah diberi peringatan (bukan diregangkan)', () => {
  assert.ok(checkTemplateAspect(FRONT).ok);
  assert.ok(checkTemplateAspect(BACK).ok);
  const bad = checkTemplateAspect({ size: FRONT.size, background: { pxWidth: 653, pxHeight: 900 } });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /tidak sesuai/);
});

test('konfigurasi bawaan valid, ID unik, semua field di dalam kartu, status draf', () => {
  for (const c of [FRONT, BACK]) {
    const v = validateConfig(c);
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.warnings, []);
    assert.equal(c.status, 'draft');
    assert.equal(new Set(c.fields.map((f) => f.id)).size, c.fields.length);
  }
  assert.equal(validateConfig({ size: { widthMm: 55, heightMm: 85 }, fields: [{ id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1 }, { id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1 }] }).ok, false);
});

test('field wajib tersedia sesuai spesifikasi', () => {
  const ids = (c) => c.fields.map((f) => f.id);
  for (const id of ['foto', 'nama_depan', 'nip_depan']) assert.ok(ids(FRONT).includes(id), id);
  for (const id of ['nama_belakang', 'nip_belakang', 'jabatan', 'gol_darah']) assert.ok(ids(BACK).includes(id), id);
});

test('nama & NIP depan dan belakang SELALU sama (satu sumber data)', () => {
  for (const d of [DATA, { ...DATA, nama: 'ANAK AGUNG GEDE', nip: '1 2 3' }]) {
    const F = lay(FRONT, d);
    const B = lay(BACK, d);
    assert.equal(textOf(F, 'nama_depan').lines[0].text, d.nama);
    assert.equal(textOf(B, 'nama_belakang').lines[0].text, d.nama);
    assert.equal(textOf(F, 'nip_depan').lines[0].text, `NIP. ${d.nip}`);
    assert.equal(textOf(B, 'nip_belakang').lines[0].text, d.nip);
  }
});

test('jabatan & golongan darah hanya di sisi belakang', () => {
  const F = lay(FRONT);
  const B = lay(BACK);
  assert.ok(!textOps(F).some((o) => o.lines.some((l) => l.text.includes(DATA.jabatan))));
  assert.equal(textOps(F).length, 2);
  assert.equal(textOf(B, 'jabatan').lines[0].text, DATA.jabatan);
  assert.equal(textOf(B, 'gol_darah').lines[0].text, 'B');
  assert.ok(!B.ops.some((o) => o.kind === 'photo'));
});

test('field kosong ditandai dan tidak digambar', () => {
  const B = lay(BACK, { nama: '', nip: '  ', jabatan: '', gol_darah: '' });
  assert.equal(textOps(B).length, 0);
  assert.equal(B.status.jabatan.state, 'empty');
  const F = lay(FRONT, DATA, null);
  assert.equal(F.status.foto.state, 'empty');
  assert.equal(F.ops.find((o) => o.kind === 'photo').missing, true);
});

test('teks pendek memakai ukuran font penuh, rata tengah di tengah kotak, tengah vertikal = tengah huruf kapital', () => {
  const f = field(FRONT, 'nama_depan');
  const op = textOf(lay(FRONT, { ...DATA, nama: 'ANI' }), 'nama_depan');
  assert.ok(near(op.fontPt, f.fontSize, 1e-6));
  assert.ok(near(op.lines[0].x, f.x + f.width / 2));
  const size = f.fontSize * PT_TO_MM;
  assert.ok(near(op.lines[0].y, f.y + f.height / 2 + 0.7 * size / 2));
});

test('teks panjang: font diperkecil proporsional agar tepat muat, tidak keluar kotak', () => {
  const f = field(FRONT, 'nama_depan');
  const L = lay(FRONT, { ...DATA, nama: 'I GUSTI AYU PUTU MADE SRI RAHAYU WULANDARI, S.Pd., M.Pd' });
  const op = textOf(L, 'nama_depan');
  assert.equal(L.status.nama_depan.state, 'shrunk');
  assert.ok(op.fontPt < f.fontSize && op.fontPt >= f.minFontSize);
  assert.ok(op.lines[0].widthMm <= f.width + 1e-6, `${op.lines[0].widthMm} > ${f.width}`);
  assert.ok(op.lines[0].widthMm > f.width * 0.98); // memanfaatkan lebar (tidak mengecil berlebihan)
  assert.equal(op.clip, false);
});

test('teks sangat panjang: font minimum, dipotong di kotak, dan ada PERINGATAN (tidak terpotong diam-diam)', () => {
  const L = lay(FRONT, { ...DATA, nama: 'X'.repeat(200) });
  const op = textOf(L, 'nama_depan');
  assert.equal(L.status.nama_depan.state, 'overflow');
  assert.ok(near(op.fontPt, field(FRONT, 'nama_depan').minFontSize, 1e-6));
  assert.equal(op.clip, true);
  assert.equal(L.warnings.length, 1);
  assert.match(L.warnings[0], /terlalu panjang/);
});

test('skala lebar huruf (scaleX) dan jarak karakter ikut dihitung dalam lebar', () => {
  const base = { ...field(BACK, 'jabatan'), scaleX: 1, letterSpacing: 0 };
  const w1 = textOf(lay({ ...BACK, fields: [base] }), 'jabatan').lines[0].widthMm;
  const w2 = textOf(lay({ ...BACK, fields: [{ ...base, scaleX: 0.5 }] }), 'jabatan').lines[0].widthMm;
  const w3 = textOf(lay({ ...BACK, fields: [{ ...base, letterSpacing: 1 }] }), 'jabatan').lines[0].widthMm;
  assert.ok(near(w2, w1 / 2));
  assert.ok(w3 > w1);
});

test('maxLines > 1: membungkus kata dan tetap di dalam area', () => {
  const f = { ...field(BACK, 'jabatan'), maxLines: 2, height: 8, fontSize: 9, maxFontSize: 9, scaleX: 1 };
  const op = textOf(lay({ ...BACK, fields: [f] }, { ...DATA, jabatan: 'Kepala Seksi Pengembangan Kompetensi Aparatur' }), 'jabatan');
  assert.equal(op.lines.length, 2);
  for (const l of op.lines) assert.ok(l.widthMm <= f.width + 1e-6);
  assert.ok(op.lines[1].y > op.lines[0].y);
});

test('foto cover: rasio asli utuh (tanpa distorsi), menutup seluruh kotak, tepat di kotak yang ditandai', () => {
  const pf = field(FRONT, 'foto');
  for (const [w, h] of [[3000, 4000], [4000, 3000], [1000, 1000], [6000, 2000]]) {
    const op = lay(FRONT, DATA, { pxW: w, pxH: h }).ops.find((o) => o.kind === 'photo');
    assert.deepEqual(op.box, { x: pf.x, y: pf.y, w: pf.width, h: pf.height });
    assert.ok(near(op.img.w / op.img.h, w / h, 1e-9));
    assert.ok(op.img.x <= pf.x + 1e-9 && op.img.y <= pf.y + 1e-9);
    assert.ok(op.img.x + op.img.w >= pf.x + pf.width - 1e-9 && op.img.y + op.img.h >= pf.y + pf.height - 1e-9);
  }
});

test('foto: zoom & posisi manual tetap menutup kotak; contain tampil utuh', () => {
  const pf = field(FRONT, 'foto');
  const z = lay(FRONT, DATA, { ...PHOTO, zoom: 2.5, ox: 0, oy: 1 }).ops.find((o) => o.kind === 'photo');
  assert.ok(near(z.img.x, pf.x));
  assert.ok(near(z.img.y + z.img.h, pf.y + pf.height));
  assert.ok(near(z.img.w / z.img.h, 0.75, 1e-9));
  const c = lay({ ...FRONT, fields: FRONT.fields.map((f) => (f.id === 'foto' ? { ...f, cropMode: 'contain' } : f)) }, DATA, { pxW: 4000, pxH: 3000 }).ops.find((o) => o.kind === 'photo');
  assert.ok(c.img.w <= pf.width + 1e-9 && c.img.h <= pf.height + 1e-9);
  assert.ok(near(c.img.w / c.img.h, 4 / 3, 1e-9));
});

test('urutan gambar: penutup → foto → teks (elemen permanen pada background tidak disentuh)', () => {
  const kinds = lay(FRONT).ops.map((o) => o.kind);
  assert.deepEqual(kinds, ['mask', 'photo', 'text', 'text']);
});

test('field nonaktif tidak digambar', () => {
  const cfg = { ...BACK, fields: BACK.fields.map((f) => (f.id === 'jabatan' ? { ...f, enabled: false } : f)) };
  const L = lay(cfg);
  assert.equal(L.status.jabatan.state, 'off');
  assert.ok(!textOf(L, 'jabatan'));
});

// --- paritas preview/export: satu layout, konversi mm→px hanya di drawLayout

function fakeCtx(w, h) {
  const calls = [];
  const ctx = {
    canvas: { width: w, height: h }, calls,
    save() {}, restore() {}, beginPath() {}, clip() {}, rect(...a) { calls.push(['rect', ...a]); }, scale() {},
    setTransform() {}, fillRect(...a) { calls.push(['fillRect', ...a]); }, strokeRect() {}, fillText(...a) { calls.push(['fillText', ...a]); },
    translate(...a) { calls.push(['translate', ...a]); }, drawImage(...a) { calls.push(['drawImage', ...a.slice(1)]); }, measureText: () => ({ width: 1 }),
  };
  return ctx;
}

test('preview & export: koordinat piksel = koordinat mm × skala (konsisten di semua resolusi)', () => {
  const L = lay(FRONT);
  const small = fakeCtx(275, 425);
  const big = fakeCtx(1299, 2008);
  drawLayout(small, L, { bg: {}, photo: {} });
  drawLayout(big, L, { bg: {}, photo: {} });
  const sx1 = 275 / 55; const sx2 = 1299 / 55;
  const photo = L.ops.find((o) => o.kind === 'photo');
  const find = (c, x, y) => c.calls.find((k) => k[0] === 'drawImage' && k.length === 5 && Math.abs(k[1] - x) < 1e-6 && Math.abs(k[2] - y) < 1e-6);
  assert.ok(find(small, photo.img.x * sx1, photo.img.y * (425 / 85)), 'foto @preview');
  assert.ok(find(big, photo.img.x * sx2, photo.img.y * (2008 / 85)), 'foto @export');
  // background menutupi seluruh canvas tanpa peregangan tambahan
  assert.deepEqual(big.calls.find((k) => k[0] === 'drawImage' && k.length === 5 && k[1] === 0 && k[2] === 0).slice(3), [1299, 2008]);
});

test('layout tidak bergantung pada resolusi (hanya mm): dihitung dua kali = identik', () => {
  assert.deepEqual(lay(FRONT), lay(FRONT));
  assert.deepEqual(lay(BACK), lay(BACK));
});

test('ukuran halaman PDF & PNG: rasio piksel PNG 600 dpi = 55:85', () => {
  const w = Math.round((55 / 25.4) * 600);
  const h = Math.round(w * (85 / 55));
  assert.equal(w, 1299);
  assert.ok(near(w / h, 55 / 85, 1e-3));
});

test('arsitektur jenis ID card: form depan/belakang & pencerminan nama/NIP', () => {
  const t = getType('provinsi');
  const keys = (s) => formForSide(t, s).map((f) => `${f.key}${f.mirrored ? '*' : ''}`);
  assert.deepEqual(keys('front'), ['foto', 'nama', 'nip']);
  assert.deepEqual(keys('back'), ['nama*', 'nip*', 'jabatan', 'gol_darah']);
  assert.equal(ID_CARD_TYPES.length, 1);
  assert.deepEqual(ID_CARD_TYPES[0].sides.front.config, 'front-config.json');
});
