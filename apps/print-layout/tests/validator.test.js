import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLayout } from '../assets/js/validator.js';
import { normalizeInputs } from '../assets/js/calculator.js';
import { BASE_RAW } from './helpers.js';

const cfg = (o = {}) => normalizeInputs({ ...BASE_RAW, designW: '50', designH: '30', gapX: '2', gapY: '3', ...o }).config;
const P = (x, y, w = 50, h = 30, rotated = false) => ({ x, y, w, h, rotated });

test('layout valid diterima', () => {
  const c = cfg();
  const v = validateLayout({ count: 2, placements: [P(0, 0), P(52, 0)] }, c);
  assert.equal(v.valid, true, v.errors.join('\n'));
});

test('mendeteksi overlap', () => {
  const c = cfg();
  const v = validateLayout({ placements: [P(0, 0), P(40, 10)] }, c);
  assert.equal(v.valid, false);
  assert.equal(v.checks.overlap, false);
});

test('mendeteksi pelanggaran gap horizontal (1 mm < 2 mm)', () => {
  const c = cfg();
  const v = validateLayout({ placements: [P(0, 0), P(51, 0)] }, c);
  assert.equal(v.valid, false);
  assert.equal(v.checks.gap, false);
});

test('mendeteksi pelanggaran gap vertikal (gap V = 3 mm)', () => {
  const c = cfg();
  const bad = validateLayout({ placements: [P(0, 0), P(0, 32)] }, c);
  assert.equal(bad.valid, false);
  const ok = validateLayout({ placements: [P(0, 0), P(0, 33)] }, c);
  assert.equal(ok.valid, true, ok.errors.join('\n'));
});

test('diagonal yang hanya memenuhi salah satu gap tetap valid', () => {
  const c = cfg();
  // terpisah horizontal 2 mm walau bertumpuk vertikal
  const v = validateLayout({ placements: [P(0, 0), P(52, 10)] }, c);
  assert.equal(v.valid, true);
});

test('mendeteksi desain keluar kertas dan melewati margin', () => {
  const c = cfg();
  assert.equal(validateLayout({ placements: [P(180, 0)] }, c).checks.inside, false);
  assert.equal(validateLayout({ placements: [P(-1, 0)] }, c).checks.inside, false);
  const cm = cfg({ mLeft: '10' });
  assert.equal(validateLayout({ placements: [P(5, 0)] }, cm).checks.inside, false);
  assert.equal(validateLayout({ placements: [P(10, 0)] }, cm).valid, true);
});

test('mendeteksi ukuran tidak sesuai rotasi dan rotasi terlarang', () => {
  const c = cfg();
  assert.equal(validateLayout({ placements: [P(0, 0, 50, 30, true)] }, c).checks.rotation, false);
  assert.equal(validateLayout({ placements: [P(0, 0, 30, 50, true)] }, c).valid, true);
  const noRot = cfg({ allowRotation: false });
  assert.equal(validateLayout({ placements: [P(0, 0, 30, 50, true)] }, noRot).checks.rotation, false);
});

test('mendeteksi jumlah yang dilaporkan tidak sama dengan objek', () => {
  const c = cfg();
  const v = validateLayout({ count: 3, placements: [P(0, 0)] }, c);
  assert.equal(v.valid, false);
  assert.equal(v.checks.count, false);
});

test('layout rusak ditolak', () => {
  const c = cfg();
  assert.equal(validateLayout(null, c).valid, false);
  assert.equal(validateLayout({ placements: [{ x: NaN, y: 0, w: 50, h: 30 }] }, c).valid, false);
});
