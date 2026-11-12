import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toMm, fromMm, normalizeInputs, orderInfo, computeFit, imageQuality, gridCount, simpleGridBest, computeStats, orientPaper,
} from '../assets/js/calculator.js';
import { BASE_RAW } from './helpers.js';

test('konversi satuan mm/cm/in', () => {
  assert.equal(toMm(8, 'cm'), 80);
  assert.equal(toMm(1, 'in'), 25.4);
  assert.equal(toMm(5.9, 'cm'), 59);
  assert.ok(Math.abs(fromMm(25.4, 'in') - 1) < 1e-12);
  assert.throws(() => toMm(1, 'ft'));
});

test('validasi input menolak nol, negatif, kosong, dan non-angka', () => {
  for (const bad of ['0', '-5', '', 'abc']) {
    const r = normalizeInputs({ ...BASE_RAW, designW: bad });
    assert.equal(r.ok, false, `designW=${JSON.stringify(bad)} harus ditolak`);
  }
  assert.equal(normalizeInputs({ ...BASE_RAW, gapX: '-1' }).ok, false);
  assert.equal(normalizeInputs({ ...BASE_RAW, mTop: '-1' }).ok, false);
  assert.equal(normalizeInputs({ ...BASE_RAW, qty: '2.5' }).ok, false);
});

test('koma desimal diterima dan satuan dikonversi ke mm', () => {
  const r = normalizeInputs({ ...BASE_RAW, designW: '8', designH: '5,9', unit: 'cm' });
  assert.ok(r.ok);
  assert.equal(r.config.designW, 80);
  assert.ok(Math.abs(r.config.designH - 59) < 1e-9);
});

test('margin yang menghabiskan kertas ditolak', () => {
  const r = normalizeInputs({ ...BASE_RAW, mLeft: '100', mRight: '110' });
  assert.equal(r.ok, false);
});

test('orientasi kertas', () => {
  assert.deepEqual(orientPaper(210, 297, 'portrait'), [210, 297]);
  assert.deepEqual(orientPaper(210, 297, 'landscape'), [297, 210]);
  assert.deepEqual(orientPaper(297, 210, 'portrait'), [210, 297]);
});

test('gridCount dan simpleGridBest memakai definisi gap yang benar', () => {
  // A4 210x297, desain 80x59, gap 2: normal 2x4=8, rotasi 3x3=9
  const { config } = normalizeInputs(BASE_RAW);
  assert.equal(gridCount(212, 299, 82, 61), 8);
  assert.equal(simpleGridBest(config), 9);
  assert.equal(simpleGridBest({ ...config, allowRotation: false }), 8);
});

test('orderInfo membedakan kapasitas dan kebutuhan', () => {
  const o = orderInfo(100, 9);
  assert.equal(o.sheets, 12);
  assert.equal(o.totalPrinted, 108);
  assert.equal(o.surplus, 8);
  assert.equal(o.lastSheetUsed, 1);
  assert.equal(o.lastSheetFree, 8);
  assert.equal(orderInfo(18, 9).sheets, 2);
  assert.equal(orderInfo(18, 9).surplus, 0);
  assert.equal(orderInfo(5, 0), null);
});

test('computeFit: contain dan cover mempertahankan rasio', () => {
  const c = computeFit(80, 59, 1000, 1000, 'contain');
  assert.ok(Math.abs(c.w - 59) < 1e-9 && Math.abs(c.h - 59) < 1e-9);
  assert.ok(Math.abs(c.x - 10.5) < 1e-9 && Math.abs(c.y) < 1e-9);
  const v = computeFit(80, 59, 1000, 1000, 'cover');
  assert.ok(Math.abs(v.w - 80) < 1e-9 && Math.abs(v.h - 80) < 1e-9);
  assert.ok(Math.abs(v.y + 10.5) < 1e-9);
});

test('imageQuality: DPI, rasio, peringatan', () => {
  const q = imageQuality({ pxW: 945, pxH: 697, frameW: 80, frameH: 59, fit: 'contain' });
  assert.ok(Math.abs(q.dpi - 300) < 2);
  assert.equal(q.ratioMismatch, false);
  const low = imageQuality({ pxW: 200, pxH: 150, frameW: 80, frameH: 59 });
  assert.equal(low.level, 'low');
  const mism = imageQuality({ pxW: 1000, pxH: 1000, frameW: 80, frameH: 59 });
  assert.equal(mism.ratioMismatch, true);
  const vec = imageQuality({ pxW: 100, pxH: 100, frameW: 80, frameH: 59, vector: true });
  assert.equal(vec.dpi, null);
});

test('computeStats', () => {
  const { config } = normalizeInputs(BASE_RAW);
  const layout = { placements: [{ x: 0, y: 0, w: 80, h: 59, rotated: false }, { x: 82, y: 0, w: 59, h: 80, rotated: true }] };
  const s = computeStats(config, layout);
  assert.equal(s.count, 2);
  assert.equal(s.rotated, 1);
  assert.equal(s.normal, 1);
  assert.ok(Math.abs(s.usedArea - 2 * 80 * 59) < 1e-9);
});
