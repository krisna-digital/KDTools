import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.js';
import { buildPolaroid2R, POLAROID_DEFAULTS, placePhoto, mapRect, windowOnPaper, MAX_ZOOM } from '../assets/js/templates.js';
import { computeFit } from '../assets/js/calculator.js';
import { buildSvg } from '../assets/js/renderer.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const count = (s, re) => (s.match(re) || []).length;
const tplOf = (o) => buildPolaroid2R({ orientation: o, ...POLAROID_DEFAULTS }).template;

test('placePhoto: zoom 1 + tengah = cover tepat; rasio foto utuh', () => {
  const win = tplOf('portrait').window;
  for (const [w, h] of [[3000, 4000], [4000, 3000], [6000, 2000], [1000, 1000]]) {
    const g = placePhoto(win, w, h);
    const f = computeFit(win.w, win.h, w, h, 'cover');
    assert.ok(near(g.x, win.x + f.x) && near(g.y, win.y + f.y) && near(g.w, f.w) && near(g.h, f.h));
    assert.ok(near(g.w / g.h, w / h, 1e-9));
  }
});

test('placePhoto: zoom memperbesar, tidak pernah di bawah cover, dan selalu menutup jendela pada semua posisi', () => {
  const win = tplOf('landscape').window;
  for (const [w, h] of [[3000, 4000], [4000, 3000], [2000, 2000]]) {
    for (const zoom of [0.2, 1, 1.7, 3, 5, 99]) {
      for (const ox of [-1, 0, 0.3, 0.5, 1, 2]) {
        for (const oy of [-1, 0, 0.7, 1, 2]) {
          const g = placePhoto(win, w, h, zoom, ox, oy);
          assert.ok(near(g.w / g.h, w / h, 1e-9), 'rasio berubah');
          assert.ok(g.x <= win.x + 1e-9 && g.y <= win.y + 1e-9, 'kiri/atas tidak tertutup');
          assert.ok(g.x + g.w >= win.x + win.w - 1e-9 && g.y + g.h >= win.y + win.h - 1e-9, 'kanan/bawah tidak tertutup');
          assert.ok(g.zoom >= 1 && g.zoom <= MAX_ZOOM);
        }
      }
    }
  }
  const base = placePhoto(win, 4000, 3000, 1);
  const z2 = placePhoto(win, 4000, 3000, 2);
  assert.ok(near(z2.w, base.w * 2) && near(z2.h, base.h * 2));
});

test('placePhoto: ox/oy menempelkan tepi gambar ke tepi jendela', () => {
  const win = tplOf('portrait').window;
  const l = placePhoto(win, 4000, 3000, 1, 0, 0.5); // foto lanskap di jendela potret: lebih lebar
  assert.ok(near(l.x, win.x));
  const r = placePhoto(win, 4000, 3000, 1, 1, 0.5);
  assert.ok(near(r.x + r.w, win.x + win.w));
  const t = placePhoto(win, 3000, 4000, 2, 0.5, 0);
  assert.ok(near(t.y, win.y));
});

test('mapRect: rotasi 90° CW menjaga persegi di dalam slot; windowOnPaper konsisten', () => {
  const slot = { x: 10, y: 20, w: 88.9, h: 63.5 };
  const rect = { x: 4, y: 4, w: 55.5, h: 70.9 };
  const m = mapRect(slot, rect, true);
  assert.ok(m.x >= slot.x - 1e-9 && m.y >= slot.y - 1e-9 && m.x + m.w <= slot.x + slot.w + 1e-9 && m.y + m.h <= slot.y + slot.h + 1e-9);
  assert.deepEqual(windowOnPaper({ ...slot, rotated: true }, rect), m);
  assert.deepEqual(mapRect(slot, rect, false), { x: 14, y: 24, w: 55.5, h: 70.9 });
});

function photos(list) {
  return list.map(([w, h, o]) => ({ pxW: w, pxH: h, href: 'data:image/png;base64,AAAA', tpl: tplOf(o), zoom: 1, ox: 0.5, oy: 0.5 }));
}
function setup() {
  const t = tplOf('portrait');
  const r = run({ paperName: 'A4', designW: String(t.cardW), designH: String(t.cardH), unit: 'mm' });
  return { r, cfg: { ...r.cfg, template: t } };
}

test('multi-foto: tiap foto 1 <image> sendiri; slot kosong tidak tercetak saat export', () => {
  const { r, cfg } = setup();
  const ph = photos([[3000, 4000, 'portrait'], [4000, 3000, 'landscape'], [3000, 4000, 'portrait']]);
  const svg = buildSvg(r.layout, cfg, { mode: 'export', photos: ph });
  assert.equal(count(svg, /<image /g), 3);
  assert.equal(count(svg, /stroke="#222222"/g), 3);
  assert.equal(count(svg, /fill="#ADD8E6"/g), 0);
  assert.equal(count(svg, /<clipPath id="pl-c\d+"/g), 3);
});

test('multi-foto di preview: slot kosong tampil sebagai placeholder; garis potong semua slot', () => {
  const { r, cfg } = setup();
  const svg = buildSvg(r.layout, cfg, { mode: 'preview', photos: photos([[3000, 4000, 'portrait']]) });
  assert.equal(count(svg, /<image /g), 1);
  assert.equal(count(svg, /fill="#ADD8E6"/g), r.layout.count - 1);
  assert.equal(count(svg, /stroke="#222222"/g), r.layout.count);
});

test('foto lanskap pada slot potret diputar 90°; foto potret pada slot potret tidak; rasio tiap foto utuh', () => {
  const { r, cfg } = setup();
  const slots = r.layout.placements;
  const ph = photos(slots.map((p, i) => (i % 2 ? [4000, 3000, 'landscape'] : [3000, 4000, 'portrait'])));
  const svg = buildSvg(r.layout, cfg, { mode: 'export', photos: ph });
  // Rotasi = kartu foto tidak sama orientasinya dengan slot
  const expectRot = slots.filter((p, i) => Math.abs(p.w - ph[i].tpl.cardW) > 1e-6).length;
  assert.equal(count(svg, /rotate\(90\)/g), expectRot);
  const imgs = [...svg.matchAll(/<image x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
  assert.equal(imgs.length, slots.length);
  imgs.forEach(([, , w, h], i) => assert.ok(near(w / h, ph[i].pxW / ph[i].pxH, 1e-3)));
});

test('interaktif: satu area sentuh + satu sorotan per foto; hanya yang terpilih berwarna; nomor mengikuti offset', () => {
  const { r, cfg } = setup();
  const ph = photos([[3000, 4000, 'portrait'], [3000, 4000, 'portrait'], [3000, 4000, 'portrait']]);
  const svg = buildSvg(r.layout, cfg, { mode: 'preview', photos: ph, interactive: true, selected: 1, numberOffset: 9, showNumbers: true });
  assert.equal(count(svg, /class="pl-hit"/g), 3);
  assert.equal(count(svg, /class="pl-sel"/g), 3);
  assert.equal(count(svg, /stroke="#f59e0b"/g), 1);
  assert.equal(count(svg, /data-slot=/g), 3 + 3 + 3);
  assert.match(svg, />10<\/text>/);
  assert.match(svg, />12<\/text>/);
  assert.doesNotMatch(svg, />13<\/text>/);
  const exp = buildSvg(r.layout, cfg, { mode: 'export', photos: ph, interactive: true });
  assert.equal(count(exp, /pl-hit/g), 0); // export tidak pernah memuat lapisan interaksi
});

test('posisi/zoom per foto tercermin di SVG (foto berbeda → geometri berbeda)', () => {
  const { r, cfg } = setup();
  const a = photos([[3000, 4000, 'portrait'], [3000, 4000, 'portrait']]);
  a[1].zoom = 2; a[1].ox = 0;
  const svg = buildSvg(r.layout, cfg, { mode: 'export', photos: a });
  const imgs = [...svg.matchAll(/<image x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
  assert.ok(near(imgs[1][2], imgs[0][2] * 2, 1e-3));
  assert.ok(near(imgs[1][0], 4, 1e-3)); // ox=0 → tepi kiri gambar = tepi kiri jendela (x = 4 mm)
});

test('tanpa photos: perilaku lama tidak berubah (satu placeholder per slot)', () => {
  const { r, cfg } = setup();
  const svg = buildSvg(r.layout, cfg, { mode: 'export' });
  assert.equal(count(svg, /fill="#ADD8E6"/g), r.layout.count);
  assert.equal(count(svg, /<image /g), 0);
});
