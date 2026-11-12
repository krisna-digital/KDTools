import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// localStorage palsu untuk Node
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { loadTemplateSet, saveTemplateSet, resetTemplateSet, loadDefaults } = await import('../assets/js/store.js');
const { getType } = await import('../assets/js/types.js');

const root = new URL('../', import.meta.url);
const fakeFetch = async (path) => {
  try { const t = readFileSync(new URL(path, root), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(t) }; } catch { return { ok: false, status: 404 }; }
};
const KAB = getType('kabupaten');

test('tanpa penyesuaian: template bawaan, tidak ada status persetujuan', async () => {
  mem.clear();
  const set = await loadTemplateSet(KAB, fakeFetch);
  assert.equal(set.origin, 'default');
  assert.equal(set.approved, undefined);
  assert.equal(set.notice, null);
  assert.deepEqual(Object.keys(set.sides), ['front', 'back']);
});

test('penyesuaian pengguna disimpan terpisah dan dimuat kembali; reset mengembalikan bawaan', async () => {
  mem.clear();
  const d = await loadDefaults(KAB, fakeFetch);
  const sides = JSON.parse(JSON.stringify(d));
  sides.front.fields.find((f) => f.id === 'foto').x += 1;
  const r = saveTemplateSet(KAB, sides, { front: d.front.templateVersion, back: d.back.templateVersion });
  assert.ok(r.ok);
  const loaded = await loadTemplateSet(KAB, fakeFetch);
  assert.equal(loaded.origin, 'custom');
  assert.equal(loaded.sides.front.fields.find((f) => f.id === 'foto').x, d.front.fields.find((f) => f.id === 'foto').x + 1);
  resetTemplateSet(KAB);
  assert.equal((await loadTemplateSet(KAB, fakeFetch)).origin, 'default');
});

test('versi template bawaan berubah → penyesuaian lama dibuang & pengguna diberi tahu', async () => {
  mem.clear();
  const d = await loadDefaults(KAB, fakeFetch);
  saveTemplateSet(KAB, d, { front: '0.9.0', back: '0.9.0' });
  const loaded = await loadTemplateSet(KAB, fakeFetch);
  assert.equal(loaded.origin, 'default');
  assert.match(loaded.notice, /diperbarui/);
  assert.equal((await loadTemplateSet(KAB, fakeFetch)).notice, null); // pemberitahuan hanya sekali
});

test('pengaturan Kabupaten dan Provinsi tersimpan terpisah', async () => {
  mem.clear();
  const PROV = getType('provinsi');
  const dk = await loadDefaults(KAB, fakeFetch);
  saveTemplateSet(KAB, dk, { front: dk.front.templateVersion, back: dk.back.templateVersion });
  assert.equal((await loadTemplateSet(PROV, fakeFetch)).origin, 'default');
  assert.equal((await loadTemplateSet(KAB, fakeFetch)).origin, 'custom');
});
