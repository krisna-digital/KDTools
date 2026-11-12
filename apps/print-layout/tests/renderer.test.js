import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.js';
import { buildSvg, PLACEHOLDER_COLOR } from '../assets/js/renderer.js';

const count = (s, re) => (s.match(re) || []).length;

test('SVG tanpa artwork: tiap posisi = 1 placeholder biru muda + 1 garis potong', () => {
  const r = run();
  const svg = buildSvg(r.layout, r.cfg, { mode: 'export' });
  assert.equal(PLACEHOLDER_COLOR, '#ADD8E6');
  assert.equal(count(svg, /fill="#ADD8E6"/g), r.layout.count);
  assert.equal(count(svg, /stroke="#222222"/g), r.layout.count);
  assert.match(svg, /width="210mm" height="297mm"/);
  assert.match(svg, /viewBox="0 0 210 297"/);
});

test('koordinat SVG identik dengan hasil optimizer (preview = hasil algoritma)', () => {
  const r = run({ paperName: 'Custom', paperW: '100', paperH: '140', designW: '60', designH: '40', gapX: '0', gapY: '0' });
  const svg = buildSvg(r.layout, r.cfg, { mode: 'export' });
  const cuts = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none" stroke="#222222"/g)]
    .map((m) => m.slice(1).map(Number));
  assert.equal(cuts.length, r.layout.count);
  r.layout.placements.forEach((p, i) => {
    assert.deepEqual(cuts[i], [p.x, p.y, p.w, p.h].map((v) => Number(v.toFixed(4))));
  });
});

test('dengan artwork: satu definisi gambar dipakai ulang; desain dirotasi diberi rotate(90)', () => {
  const r = run({ paperName: 'Custom', paperW: '100', paperH: '140', designW: '60', designH: '40', gapX: '0', gapY: '0' });
  const art = { pxW: 600, pxH: 400 };
  const svg = buildSvg(r.layout, r.cfg, { mode: 'export', artwork: art, href: 'data:image/png;base64,AAAA', fit: 'contain' });
  assert.equal(count(svg, /<image /g), 1);
  assert.equal(count(svg, /<use /g), r.layout.count);
  assert.equal(count(svg, /rotate\(90\)/g), r.layout.placements.filter((p) => p.rotated).length);
  assert.equal(count(svg, /fill="#ADD8E6"/g), 0);
});

test('mode contain/cover: rasio gambar tidak diubah dan cover memenuhi bingkai', () => {
  const r = run({ designW: '80', designH: '59' });
  const art = { pxW: 1000, pxH: 1000 };
  const grab = (fit) => {
    const svg = buildSvg(r.layout, r.cfg, { mode: 'export', artwork: art, href: 'x', fit });
    const m = svg.match(/<image id="pl-art" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
    return m.slice(1).map(Number);
  };
  const [, , cw, ch] = grab('contain');
  const [, , vw, vh] = grab('cover');
  assert.ok(Math.abs(cw / ch - 1) < 1e-3 && Math.abs(vw / vh - 1) < 1e-3);
  assert.ok(cw <= 80 + 1e-6 && ch <= 59 + 1e-6);
  assert.ok(vw >= 80 - 1e-6 && vh >= 59 - 1e-6);
});

test('nomor dan margin hanya muncul bila diminta; nama file tidak di-inject', () => {
  const r = run();
  const plain = buildSvg(r.layout, r.cfg, { mode: 'preview' });
  assert.equal(count(plain, /<text /g), 0);
  const nums = buildSvg(r.layout, r.cfg, { mode: 'preview', showNumbers: true, showMargin: true });
  assert.equal(count(nums, /<text /g), r.layout.count);
  assert.match(nums, /stroke-dasharray/);
  const evil = buildSvg(r.layout, r.cfg, { mode: 'export', artwork: { pxW: 1, pxH: 1 }, href: 'x"><script>alert(1)</script>' });
  assert.equal(count(evil, /<script/g), 0);
});
