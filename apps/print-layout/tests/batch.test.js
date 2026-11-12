import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.js';
import { buildBatchTemplate, buildPolaroid2R, variantFor, POLAROID_DEFAULTS, MIN_BATCH_MM } from '../assets/js/templates.js';
import { buildSvg } from '../assets/js/renderer.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const count = (s, re) => (s.match(re) || []).length;
const batch = (w, h, o = 'portrait') => { const r = buildBatchTemplate({ w, h, orientation: o }); assert.ok(r.ok, r.errors.join(';')); return r.template; };

test('Foto Kustom: jendela = seluruh kotak, tanpa border/tepi putih', () => {
  const t = batch(60, 90);
  assert.deepEqual([t.cardW, t.cardH], [60, 90]);
  assert.deepEqual(t.window, { x: 0, y: 0, w: 60, h: 90 });
  assert.deepEqual(t.border, { side: 0, top: 0, bottom: 0 });
  assert.equal(t.id, 'photo-batch');
});

test('urutan input bebas: 90×60 tetap kotak potret 60×90 (potret) atau lanskap 90×60', () => {
  assert.deepEqual([batch(90, 60).cardW, batch(90, 60).cardH], [60, 90]);
  assert.deepEqual([batch(90, 60, 'landscape').cardW, batch(90, 60, 'landscape').cardH], [90, 60]);
});

test('ukuran tidak valid ditolak', () => {
  for (const [w, h] of [[NaN, 90], [60, undefined], [2, 90], [60, 0]]) {
    const r = buildBatchTemplate({ w, h });
    assert.equal(r.ok, false);
    assert.ok(r.errors.length);
  }
  assert.ok(MIN_BATCH_MM > 0);
});

test('variantFor: batch & polaroid menghasilkan varian orientasi yang benar', () => {
  const b = batch(60, 90);
  const bl = variantFor(b, 'landscape');
  assert.deepEqual([bl.cardW, bl.cardH], [90, 60]);
  assert.deepEqual(bl.window, { x: 0, y: 0, w: 90, h: 60 });
  const p = buildPolaroid2R({ orientation: 'portrait', ...POLAROID_DEFAULTS }).template;
  const pl = variantFor(p, 'landscape');
  assert.equal(pl.id, 'polaroid-2r');
  assert.ok(near(pl.cardW, 88.9));
  assert.equal(variantFor(null, 'portrait'), null);
});

function setup(t) {
  const r = run({ paperName: 'A4', designW: String(t.cardW), designH: String(t.cardH), unit: 'mm' });
  return { r, cfg: { ...r.cfg, template: t } };
}
const photos = (t, list) => list.map(([w, h, o]) => ({ pxW: w, pxH: h, href: 'data:image/png;base64,AAAA', tpl: variantFor(t, o), zoom: 1, ox: 0.5, oy: 0.5 }));

test('Foto Kustom: foto menutup seluruh kotak, rasio utuh, dipotong tepat di batas kotak', () => {
  const t = batch(60, 90);
  const { r, cfg } = setup(t);
  const ph = photos(t, [[3000, 4000, 'portrait'], [4000, 3000, 'landscape'], [1000, 1000, 'portrait']]);
  const svg = buildSvg(r.layout, cfg, { mode: 'export', photos: ph });
  const imgs = [...svg.matchAll(/<image x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
  assert.equal(imgs.length, 3);
  imgs.forEach(([x, y, w, h], i) => {
    const win = ph[i].tpl.window;
    assert.ok(near(w / h, ph[i].pxW / ph[i].pxH, 1e-3), 'rasio berubah');
    assert.ok(x <= win.x + 1e-3 && y <= win.y + 1e-3 && x + w >= win.x + win.w - 1e-3 && y + h >= win.y + win.h - 1e-3, 'kotak tidak tertutup penuh');
  });
  // clip = seluruh kotak foto (tidak ada tepi)
  assert.match(svg, /<clipPath id="pl-c0"><rect x="0" y="0" width="60" height="90"\/>/);
  assert.match(svg, /<clipPath id="pl-c1"><rect x="0" y="0" width="90" height="60"\/>/);
});

test('Foto Kustom: foto lanskap pada slot potret diputar 90° (kotak fisik sama), potret tidak', () => {
  const t = batch(60, 90);
  const { r, cfg } = setup(t);
  const slots = r.layout.placements;
  const ph = photos(t, slots.map((p, i) => (i % 2 ? [4000, 3000, 'landscape'] : [3000, 4000, 'portrait'])));
  const svg = buildSvg(r.layout, cfg, { mode: 'export', photos: ph });
  const expectRot = slots.filter((p, i) => Math.abs(p.w - ph[i].tpl.cardW) > 1e-6).length;
  assert.equal(count(svg, /rotate\(90\)/g), expectRot);
});

test('Foto Kustom: 20 foto pada kapasitas per lembar → jumlah lembar & slot kosong tidak dicetak', () => {
  const t = batch(60, 90);
  const { r, cfg } = setup(t);
  const cap = r.layout.placements.length;
  assert.ok(cap >= 6);
  const sheets = Math.ceil(20 / cap);
  const lastFill = 20 - (sheets - 1) * cap;
  const slice = photos(t, Array.from({ length: lastFill }, () => [3000, 4000, 'portrait']));
  const svg = buildSvg(r.layout, cfg, { mode: 'export', photos: slice, numberOffset: (sheets - 1) * cap });
  assert.equal(count(svg, /<image /g), lastFill);
  assert.equal(count(svg, /stroke="#222222"/g), lastFill);
  assert.equal(count(svg, /fill="#ADD8E6"/g), 0);
});
