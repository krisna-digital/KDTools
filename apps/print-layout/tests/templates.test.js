import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.js';
import { buildPolaroid2R, resolveCardOrientation, windowOnPaper, CARD_2R, POLAROID_DEFAULTS } from '../assets/js/templates.js';
import { buildSvg, PLACEHOLDER_COLOR } from '../assets/js/renderer.js';
import { computeFit } from '../assets/js/calculator.js';

const count = (s, re) => (s.match(re) || []).length;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function poly(orientation, extra = {}) {
  const r = buildPolaroid2R({ orientation, ...POLAROID_DEFAULTS, ...extra });
  assert.ok(r.ok, r.errors.join('; '));
  return r.template;
}

test('2R = 2,5 x 3,5 inci = 63,5 x 88,9 mm', () => {
  assert.ok(near(CARD_2R.w, 2.5 * 25.4));
  assert.ok(near(CARD_2R.h, 3.5 * 25.4));
});

test('orientasi otomatis mengikuti foto; persegi / tanpa foto = potret; manual menang', () => {
  assert.equal(resolveCardOrientation('auto', { pxW: 4000, pxH: 3000 }), 'landscape');
  assert.equal(resolveCardOrientation('auto', { pxW: 3000, pxH: 4000 }), 'portrait');
  assert.equal(resolveCardOrientation('auto', { pxW: 1000, pxH: 1000 }), 'portrait');
  assert.equal(resolveCardOrientation('auto', null), 'portrait');
  assert.equal(resolveCardOrientation('portrait', { pxW: 4000, pxH: 3000 }), 'portrait');
  assert.equal(resolveCardOrientation('landscape', null), 'landscape');
});

test('kartu potret & lanskap: ukuran kartu dan jendela foto benar, border bawah tetap di bawah', () => {
  const p = poly('portrait');
  assert.deepEqual([p.cardW, p.cardH], [63.5, 88.9]);
  assert.ok(near(p.window.x, 4) && near(p.window.y, 4) && near(p.window.w, 55.5) && near(p.window.h, 70.9));
  const l = poly('landscape');
  assert.deepEqual([l.cardW, l.cardH], [88.9, 63.5]);
  assert.ok(near(l.window.w, 80.9) && near(l.window.h, 45.5));
  // border bawah = tinggi kartu - (y + h jendela)
  assert.ok(near(l.cardH - (l.window.y + l.window.h), 14));
});

test('border tidak valid ditolak', () => {
  assert.equal(buildPolaroid2R({ orientation: 'portrait', side: 'x', top: 4, bottom: 14 }).ok, false);
  assert.equal(buildPolaroid2R({ orientation: 'portrait', side: -1, top: 4, bottom: 14 }).ok, false);
  assert.equal(buildPolaroid2R({ orientation: 'portrait', side: 30, top: 4, bottom: 14 }).ok, false); // jendela < 10 mm
});

test('windowOnPaper: tidak dirotasi = geser; dirotasi 90° searah jarum jam tetap di dalam penempatan', () => {
  const t = poly('portrait');
  const n = windowOnPaper({ x: 10, y: 20, w: 63.5, h: 88.9, rotated: false }, t.window);
  assert.deepEqual([n.x, n.y, n.w, n.h].map((v) => +v.toFixed(6)), [14, 24, 55.5, 70.9]);
  const p = { x: 10, y: 20, w: 88.9, h: 63.5, rotated: true };
  const r = windowOnPaper(p, t.window);
  assert.ok(near(r.w, 70.9) && near(r.h, 55.5));
  assert.ok(r.x >= p.x - 1e-9 && r.y >= p.y - 1e-9 && r.x + r.w <= p.x + p.w + 1e-9 && r.y + r.h <= p.y + p.h + 1e-9);
  // Rotasi CW: sisi bawah kartu (border 14 mm) pindah ke kiri, sisi atas (4 mm) ke kanan.
  assert.ok(near(r.x - p.x, 14));
  assert.ok(near(p.x + p.w - (r.x + r.w), 4));
  assert.ok(near(r.y - p.y, 4) && near(p.y + p.h - (r.y + r.h), 4));
});

test('SVG tanpa foto: placeholder biru hanya di jendela foto, satu per kartu', () => {
  const t = poly('portrait');
  const r = run({ paperName: 'A4', designW: String(t.cardW), designH: String(t.cardH), unit: 'mm' });
  const cfg = { ...r.cfg, template: t };
  const svg = buildSvg(r.layout, cfg, { mode: 'export' });
  assert.equal(count(svg, new RegExp(`fill="${PLACEHOLDER_COLOR}"`, 'g')), r.layout.count);
  assert.equal(count(svg, /stroke="#222222"/g), r.layout.count);
});

for (const [label, orient, artW, artH] of [
  ['potret', 'portrait', 3000, 4000],
  ['lanskap', 'landscape', 4000, 3000],
  ['foto panoramik di kartu potret', 'portrait', 6000, 2000],
  ['foto persegi di kartu lanskap', 'landscape', 2000, 2000],
]) {
  test(`foto ${label}: cover memenuhi jendela, rasio asli utuh (tidak diregangkan)`, () => {
    const t = poly(orient);
    const r = run({ paperName: 'A4', designW: String(t.cardW), designH: String(t.cardH), unit: 'mm' });
    const cfg = { ...r.cfg, template: t };
    const svg = buildSvg(r.layout, cfg, { mode: 'export', artwork: { pxW: artW, pxH: artH }, href: 'x', fit: 'contain' }); // fit diabaikan
    const m = svg.match(/<image id="pl-art" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
    const [x, y, w, h] = m.slice(1).map(Number);
    assert.ok(near(w / h, artW / artH, 1e-3), `rasio ${w / h} != ${artW / artH}`);
    // menutup seluruh jendela
    const win = t.window;
    assert.ok(x <= win.x + 1e-3 && y <= win.y + 1e-3 && x + w >= win.x + win.w - 1e-3 && y + h >= win.y + win.h - 1e-3);
    // clip = jendela foto
    assert.match(svg, new RegExp(`<clipPath id="pl-frame"><rect x="${win.x}" y="${win.y}" width="${+win.w.toFixed(4)}" height="${+win.h.toFixed(4)}"/>`));
    // tepat satu sisi yang terpotong (cover): skala = max
    const f = computeFit(win.w, win.h, artW, artH, 'cover');
    assert.ok(near(w, f.w, 1e-3) && near(h, f.h, 1e-3));
  });
}

test('layout dengan template tetap lolos validator (kartu dirotasi diperbolehkan)', () => {
  const t = poly('landscape');
  const r = run({ paperName: 'A4', designW: String(t.cardW), designH: String(t.cardH), unit: 'mm' });
  assert.ok(r.validation.valid, r.validation.errors.join('; '));
  assert.ok(r.layout.count >= 8);
});
