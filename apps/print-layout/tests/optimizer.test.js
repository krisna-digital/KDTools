import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.js';
import { simpleGridBest } from '../assets/js/calculator.js';
import { validateLayout } from '../assets/js/validator.js';

function assertGood(r, msg = '') {
  assert.equal(r.validation.valid, true, `${msg} ${r.validation.errors.join('\n')}`);
  assert.equal(r.result.count, r.layout.placements.length);
}

test('1. desain lebih kecil dari kertas: A4, 80×59, gap 2', () => {
  const r = run();
  assertGood(r);
  assert.ok(r.result.count >= 9, `hasil ${r.result.count} harus >= grid terbaik 9`);
  assert.ok(r.result.count <= r.result.upperBound);
});

test('2. desain tepat memenuhi ukuran kertas', () => {
  const r = run({ designW: '210', designH: '297', gapX: '0', gapY: '0' });
  assertGood(r);
  assert.equal(r.result.count, 1);
  assert.equal(r.layout.placements[0].rotated, false);
});

test('2b. desain sama dengan kertas tetapi dengan gap tetap muat 1', () => {
  const r = run({ designW: '210', designH: '297', gapX: '2', gapY: '2' });
  assert.equal(r.result.count, 1);
  assertGood(r);
});

test('3. desain tidak dapat dimuat → 0', () => {
  const r = run({ designW: '211', designH: '298', gapX: '0', gapY: '0', allowRotation: true });
  assert.equal(r.result.count, 0);
  assert.equal(r.validation.valid, true);
});

test('4. rotasi 90° memberi jumlah lebih banyak', () => {
  const noRot = run({ paperName: 'Custom', paperW: '100', paperH: '210', designW: '70', designH: '30', gapX: '0', gapY: '0', allowRotation: false });
  const rot = run({ paperName: 'Custom', paperW: '100', paperH: '210', designW: '70', designH: '30', gapX: '0', gapY: '0', allowRotation: true });
  assertGood(noRot); assertGood(rot);
  assert.equal(noRot.result.count, 7);
  assert.ok(rot.result.count >= 9, `rotasi: ${rot.result.count}`);
  assert.ok(rot.result.count > noRot.result.count);
  assert.ok(rot.layout.placements.some((p) => p.rotated));
});

test('4b. rotasi dibutuhkan agar desain muat', () => {
  const noRot = run({ paperW: '100', paperH: '30', designW: '30', designH: '100', gapX: '0', gapY: '0', allowRotation: false, orientation: 'landscape' });
  const rot = run({ paperW: '100', paperH: '30', designW: '30', designH: '100', gapX: '0', gapY: '0', allowRotation: true, orientation: 'landscape' });
  assert.equal(noRot.result.count, 0);
  assert.equal(rot.result.count, 1);
  assert.equal(rot.layout.placements[0].rotated, true);
  assertGood(rot);
});

test('5. kombinasi orientasi mengalahkan grid murni manapun', () => {
  // 100×140, 60×40: normal=3, rotasi=4, campuran (blok) = 5
  const r = run({ paperW: '100', paperH: '140', designW: '60', designH: '40', gapX: '0', gapY: '0' });
  assertGood(r);
  assert.equal(r.result.count, 5);
  const rot = r.layout.placements.filter((p) => p.rotated).length;
  assert.ok(rot > 0 && rot < r.result.count, 'harus campuran orientasi');
  assert.ok(r.result.count > simpleGridBest(r.cfg));
  assert.equal(r.result.provenOptimal, true); // 5 == batas atas luas (floor(14000/2400))
  assert.equal(r.result.upperBound, 5);
});

test('5b. angka yang sama dengan batas atas ditandai terbukti maksimum', () => {
  const r = run({ paperW: '100', paperH: '140', designW: '60', designH: '40', gapX: '0', gapY: '0' });
  assert.equal(r.result.count, r.result.upperBound);
  assert.equal(r.result.provenOptimal, true);
});

test('6. gap horizontal dan vertikal berbeda dipatuhi', () => {
  const r = run({ designW: '50', designH: '30', gapX: '10', gapY: '1', allowRotation: false });
  assertGood(r);
  // kolom: floor((210+10)/60)=3 ; baris: floor((297+1)/31)=9 → 27
  assert.equal(r.result.count, 27);
  const xs = [...new Set(r.layout.placements.map((p) => Number(p.x.toFixed(6))))].sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 60, 120]);
  const ys = [...new Set(r.layout.placements.map((p) => Number(p.y.toFixed(6))))].sort((a, b) => a - b);
  assert.equal(ys[1] - ys[0], 31);
});

test('7. margin berbeda pada setiap sisi', () => {
  const r = run({ designW: '50', designH: '50', gapX: '0', gapY: '0', mTop: '10', mRight: '5', mBottom: '20', mLeft: '15', allowRotation: false });
  assertGood(r);
  // area: 190×267 → 3 kolom × 5 baris = 15
  assert.equal(r.result.count, 15);
  for (const p of r.layout.placements) {
    assert.ok(p.x >= 15 - 1e-9 && p.y >= 10 - 1e-9);
    assert.ok(p.x + p.w <= 210 - 5 + 1e-9);
    assert.ok(p.y + p.h <= 297 - 20 + 1e-9);
  }
});

test('8. ukuran desimal (tanpa pembulatan prematur)', () => {
  const r = run({ designW: '33.3', designH: '22.2', gapX: '1.5', gapY: '0.75' });
  assertGood(r);
  assert.ok(r.result.count >= simpleGridBest(r.cfg));
  const r2 = run({ designW: '8', designH: '5,9', unit: 'cm' });
  assertGood(r2);
});

test('8b. toleransi floating-point: 0.1 × 3 muat tepat pada 0.3', () => {
  const r = run({ paperName: 'Custom', paperW: '0.3', paperH: '0.1', orientation: 'landscape', designW: '0.1', designH: '0.1', gapX: '0', gapY: '0' });
  assert.equal(r.result.count, 3);
  assertGood(r);
});

test('9. kertas custom', () => {
  const r = run({ paperName: 'Custom', paperW: '123.4', paperH: '456.7', designW: '20', designH: '20', gapX: '2', gapY: '2' });
  assertGood(r);
  assert.ok(r.result.count >= simpleGridBest(r.cfg));
});

test('10. desain lebih besar dari kertas → 0 dan tetap valid', () => {
  const r = run({ designW: '500', designH: '500' });
  assert.equal(r.result.count, 0);
  assert.equal(r.validation.valid, true);
  assert.match(r.result.note, /tidak dapat dimuat/);
});

test('11 & 12. tidak ada overlap dan tidak melewati batas (berbagai kasus, uji koordinat)', () => {
  const papers = [[210, 297], [297, 420], [215, 330], [329, 483], [148, 210], [105, 148]];
  const designs = [[80, 59], [50, 50], [90, 55], [33.3, 21.7], [100, 70], [25.4, 38.1]];
  const gaps = [[2, 2], [0, 0], [3, 1.5]];
  for (const [pw, ph] of papers) {
    for (const [dw, dh] of designs) {
      for (const [gx, gy] of gaps) {
        const r = run({ paperName: 'Custom', paperW: String(pw), paperH: String(ph), designW: String(dw), designH: String(dh), gapX: String(gx), gapY: String(gy), mTop: '3', mLeft: '2' });
        assertGood(r, `kertas ${pw}×${ph}, desain ${dw}×${dh}, gap ${gx}/${gy}`);
        assert.ok(r.result.count >= simpleGridBest(r.cfg), `hasil ${r.result.count} < grid ${simpleGridBest(r.cfg)}`);
        assert.ok(r.result.count <= r.result.upperBound);
      }
    }
  }
});

test('pembanding: hasil tidak lebih rendah daripada grid sederhana yang valid', () => {
  for (let i = 1; i <= 30; i++) {
    const dw = 15 + ((i * 7) % 60) + 0.5;
    const dh = 12 + ((i * 11) % 55) + 0.25;
    const r = run({ designW: String(dw), designH: String(dh), gapX: String(i % 4), gapY: String((i * 3) % 5) });
    assertGood(r, `i=${i}`);
    assert.ok(r.result.count >= r.result.baselineGrid);
    assert.equal(r.result.baselineGrid, simpleGridBest(r.cfg));
  }
});

test('MaxRects saja (di luar blok) menghasilkan layout valid', () => {
  // Tanpa pencarian blok murni: pastikan extendedSearch=true menjalankan MaxRects tanpa melanggar aturan
  const r = run({ designW: '60', designH: '40', paperName: 'Custom', paperW: '100', paperH: '100', gapX: '0', gapY: '0', extendedSearch: true });
  assertGood(r);
  assert.ok(r.result.count >= 2);
  assert.ok(r.result.candidates.some((c) => c.strategy.startsWith('MaxRects')) || r.result.provenOptimal);
});

test('desain kecil dalam jumlah besar tetap valid dan cepat', () => {
  const t = Date.now();
  const r = run({ designW: '20', designH: '15', gapX: '1', gapY: '1' });
  assertGood(r);
  assert.ok(r.result.count > 100);
  assert.ok(Date.now() - t < 15000, 'terlalu lambat');
});

test('terlalu banyak desain ditolak dengan jelas', () => {
  const r = run({ designW: '1', designH: '1', gapX: '0', gapY: '0' });
  assert.equal(r.result.tooMany, true);
  assert.equal(r.result.count, 0);
});

test('validator menolak layout hasil yang dimanipulasi', () => {
  const r = run();
  const tampered = r.layout.placements.map((p) => ({ ...p }));
  tampered[1].x = tampered[0].x + 1;
  tampered[1].y = tampered[0].y + 1;
  const v = validateLayout({ placements: tampered }, r.cfg);
  assert.equal(v.valid, false);
});

test('rotasi nonaktif: tidak ada desain dirotasi', () => {
  const r = run({ allowRotation: false });
  assertGood(r);
  assert.ok(r.layout.placements.every((p) => !p.rotated));
});
