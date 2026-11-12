import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutCard, validateConfig, checkTemplateAspect } from '../assets/js/engine.js';
import { ID_CARD_TYPES, getType, formForSide, dataForSide } from '../assets/js/types.js';

const load = (t, f) => JSON.parse(readFileSync(new URL(`../templates/${t}/${f}`, import.meta.url), 'utf8'));
const FRONT = load('kabupaten', 'front-config.json');
const BACK = load('kabupaten', 'back-config.json');
const PROV_BACK = load('provinsi', 'back-config.json');
const near = (a, b, e = 0.05) => Math.abs(a - b) <= e;
const measure = { width: (t) => [...t].length * 0.5, metrics: () => ({ capEm: 0.7, descEm: 0.2 }) };
const lay = (cfg, data, photo = { pxW: 3000, pxH: 4000 }) => layoutCard(cfg, data, { measure, photo });
const textOf = (L, id) => L.ops.find((o) => o.kind === 'text' && o.id === id);
const KAB = getType('kabupaten');
const DATA = { nama: 'KRISNA DIGITAL', nip: '202521 202530 2 002', jabatan: 'TENAGA ALIH DAYA' };

test('jenis ID Card tersedia: Provinsi Bali dan Kabupaten Jembrana', () => {
  assert.deepEqual(ID_CARD_TYPES.map((t) => t.id), ['provinsi', 'kabupaten']);
  assert.equal(KAB.basePath, 'templates/kabupaten/');
});

test('template Kabupaten: 55 × 85 mm, rasio dalam toleransi, konfigurasi valid tanpa status persetujuan', () => {
  for (const c of [FRONT, BACK]) {
    assert.deepEqual(c.size, { widthMm: 55, heightMm: 85 });
    assert.ok(checkTemplateAspect(c).ok);
    const v = validateConfig(c);
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.warnings, []);
    assert.equal(c.status, undefined);
  }
});

test('field Kabupaten: depan = foto, nama, NIP; belakang = nama, NIP, jabatan (tanpa golongan darah)', () => {
  assert.deepEqual(FRONT.fields.map((f) => f.id), ['mask_frame_biru', 'foto', 'nama_depan', 'nip_depan']);
  assert.deepEqual(BACK.fields.map((f) => f.id), ['nama_belakang', 'nip_belakang', 'jabatan']);
});

test('geometri hasil ukur piksel contoh Kabupaten tidak berubah (penjaga regresi, toleransi 0,05 mm)', () => {
  const m = FRONT.fields.find((f) => f.id === 'mask_frame_biru');
  const p = FRONT.fields.find((f) => f.id === 'foto');
  assert.equal(m.color.toLowerCase(), '#6cb4e6');
  assert.ok(near(m.x, 14.36) && near(m.y, 38.29) && near(m.width, 27.37) && near(m.height, 36.52));
  assert.ok(near(p.x, 15.10) && near(p.y, 39.19) && near(p.width, 25.89) && near(p.height, 34.79));
  // foto berada di dalam persegi biru dengan pita ±0,75 mm di sekelilingnya
  assert.ok(p.x > m.x + 0.6 && p.y > m.y + 0.6 && p.x + p.width < m.x + m.width - 0.6 && p.y + p.height < m.y + m.height - 0.6);
});

test('urutan gambar Kabupaten: persegi biru → foto → teks; penutup memakai sudut membulat', () => {
  const L = lay(FRONT, DATA);
  assert.deepEqual(L.ops.map((o) => o.kind), ['mask', 'photo', 'text', 'text']);
  assert.ok(L.ops[0].radius > 0);
});

test('foto Kabupaten: cover tanpa distorsi dan menutup seluruh kotak foto', () => {
  const p = FRONT.fields.find((f) => f.id === 'foto');
  for (const [w, h] of [[3000, 4000], [4000, 3000], [1000, 1000]]) {
    const op = lay(FRONT, DATA, { pxW: w, pxH: h }).ops.find((o) => o.kind === 'photo');
    assert.ok(Math.abs(op.img.w / op.img.h - w / h) < 1e-9);
    assert.ok(op.img.x <= p.x + 1e-9 && op.img.y <= p.y + 1e-9 && op.img.x + op.img.w >= p.x + p.width - 1e-9 && op.img.y + op.img.h >= p.y + p.height - 1e-9);
  }
});

test('teks Kabupaten: awalan "NIP . " di depan; nama sama di depan & belakang', () => {
  const F = lay(FRONT, DATA);
  const B = lay(BACK, DATA);
  assert.equal(textOf(F, 'nip_depan').lines[0].text, 'NIP . 202521 202530 2 002');
  assert.equal(textOf(F, 'nama_depan').lines[0].text, DATA.nama);
  assert.equal(textOf(B, 'nama_belakang').lines[0].text, DATA.nama);
  assert.equal(textOf(B, 'jabatan').lines[0].text, DATA.jabatan);
});

test('teks depan Kabupaten terpusat pada tengah bingkai foto (bukan tengah kartu)', () => {
  const p = FRONT.fields.find((f) => f.id === 'foto');
  const frameCenter = p.x + p.width / 2;
  for (const id of ['nama_depan', 'nip_depan']) {
    const f = FRONT.fields.find((x) => x.id === id);
    assert.equal(f.textAlign, 'center');
    assert.ok(near(f.x + f.width / 2, frameCenter, 0.2), `${id}: ${f.x + f.width / 2} vs ${frameCenter}`);
  }
});

test('NIP belakang boleh berbeda (mis. "-") hanya untuk Kabupaten; default mengikuti sisi depan', () => {
  const base = { ...DATA };
  assert.equal(dataForSide(KAB, base, 'back').nip, DATA.nip);
  const ovr = { ...base, 'nip@back': '-' };
  assert.equal(dataForSide(KAB, ovr, 'back').nip, '-');
  assert.equal(dataForSide(KAB, ovr, 'front').nip, DATA.nip);
  assert.equal(textOf(lay(BACK, dataForSide(KAB, ovr, 'back')), 'nip_belakang').lines[0].text, '-');
  // Provinsi: sinkronisasi ketat, override diabaikan
  const PROV = getType('provinsi');
  assert.equal(dataForSide(PROV, { ...base, 'nip@back': '-' }, 'back').nip, DATA.nip);
  assert.ok(PROV_BACK.fields.some((f) => f.id === 'gol_darah'));
});

test('override hanya field yang diizinkan; nama selalu satu sumber', () => {
  const d = dataForSide(KAB, { ...DATA, 'nama@back': 'LAIN' }, 'back');
  assert.equal(d.nama, DATA.nama);
});

test('form Kabupaten: nama & NIP tidak diminta dua kali; jabatan hanya di belakang', () => {
  const keys = (s) => formForSide(KAB, s).map((f) => `${f.key}${f.mirrored ? '*' : ''}`);
  assert.deepEqual(keys('front'), ['foto', 'nama', 'nip']);
  assert.deepEqual(keys('back'), ['nama*', 'nip*', 'jabatan']);
  assert.equal(formForSide(KAB, 'back').find((f) => f.key === 'nip').allowBackOverride, true);
});

test('teks panjang pada Kabupaten diperkecil, tidak keluar area; sangat panjang diberi peringatan', () => {
  const f = FRONT.fields.find((x) => x.id === 'nama_depan');
  const L = lay(FRONT, { ...DATA, nama: 'I GUSTI AYU PUTU MADE SRI RAHAYU' });
  const op = textOf(L, 'nama_depan');
  assert.equal(L.status.nama_depan.state, 'shrunk');
  assert.ok(op.fontPt < f.fontSize && op.fontPt >= f.minFontSize);
  assert.ok(op.lines[0].widthMm <= f.width + 1e-6);
  const L2 = lay(FRONT, { ...DATA, nama: 'X'.repeat(200) });
  assert.equal(L2.status.nama_depan.state, 'overflow');
  assert.equal(L2.warnings.length, 1);
});
