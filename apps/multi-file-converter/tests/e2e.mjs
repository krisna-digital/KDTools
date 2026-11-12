// End-to-end browser tests: drives the real UI in headless Chromium, downloads results, saves to tests/out.
// Usage: node tests/e2e.mjs [toolId ...]     (needs playwright; verification of outputs: python3 tests/verify.py)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../scripts/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fx = (n) => path.join(root, 'tests/fixtures', n);
const OUT = path.join(root, 'tests/out');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

const CASES = [
  // [toolId, [fixtures], { adv: {label: value}, mode, name }]
  ['jpg-png', ['photo.jpg']], ['png-jpg', ['alpha.png']], ['png-webp', ['alpha.png']], ['webp-png', ['pic.webp']], ['webp-jpg', ['pic.webp']],
  ['jpg-webp', ['photo.jpg']], ['svg-png', ['vec.svg']], ['svg-jpg', ['vec.svg']], ['bmp-png', ['pic.bmp']], ['gif-png', ['pic.gif']],
  ['image-compress', ['photo.jpg', 'alpha.png']],
  ['pdf-jpg', ['doc.pdf']], ['pdf-png', ['doc.pdf']], ['jpg-pdf', ['photo.jpg']], ['png-pdf', ['alpha.png']],
  ['txt-pdf', ['notes.txt']], ['html-pdf', ['page.html']], ['csv-xlsx', ['data.csv']], ['xlsx-csv', ['book.xlsx']],
  ['docx-pdf', ['doc.docx']], ['xlsx-pdf', ['book.xlsx']], ['pptx-pdf', ['deck.pptx']],
  ['pdf-docx', ['doc.pdf']], ['pdf-xlsx', ['table.pdf']], ['pdf-pptx', ['doc.pdf']],
  ['zip-extract', ['sample.zip']], ['zip-create', ['notes.txt', 'photo.jpg']],
  // batch + errors
  ['jpg-webp', ['photo.jpg', 'alpha.png', 'fake.png', 'empty.txt'], { name: 'batch-mixed' }],
  ['png-jpg', ['alpha.png', 'fake.png'], { name: 'fake-content' }],
  ['pdf-docx', ['scan.pdf'], { name: 'scanned-no-ocr' }],
  ['jpg-pdf', ['photo.jpg', 'photo2.jpg'], { name: 'merge', adv: { 'Merge all images into one PDF': true } }],
  ['heic-jpg', ['photo.jpg'], { name: 'heic-unavailable' }], ['wav-mp3', ['notes.txt'], { name: 'ffmpeg-unavailable' }],
];
const only = process.argv.slice(2);
const server = await startServer(8123, root);
const browser = await chromium.launch();
const results = [];

for (const [tool, files, o = {}] of CASES) {
  const name = o.name || tool;
  if (only.length && !only.includes(name) && !only.includes(tool)) continue;
  const dir = path.join(OUT, name); fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  const t0 = Date.now();
  const r = { name, tool, files, ok: false };
  try {
    await page.goto(`http://localhost:8123/#/tool/${tool}`);
    await page.waitForSelector('.dropzone');
    if (o.adv) {
      await page.click('.seg-btn:has-text("Advanced")');
      for (const [label, v] of Object.entries(o.adv)) {
        const f = page.locator('.field', { hasText: label }).first();
        if (typeof v === 'boolean') await f.locator('input[type=checkbox]').setChecked(v);
        else await f.locator('select,input').first().fill(String(v));
      }
    }
    await page.setInputFiles('#file-input', files.map(fx));
    await page.waitForFunction((n) => document.querySelectorAll('.file-item').length === n, files.length, { timeout: 10000 });
    await page.waitForTimeout(400);
    r.rejected = await page.locator('.file-item.st-invalid .fi-error').allInnerTexts();
    const conv = page.locator('.actions .btn-primary');
    if (await conv.isEnabled()) {
      await conv.click();
      await page.waitForFunction(() => !document.querySelector('.file-item.st-running, .file-item.st-queued') && !document.querySelector('.actions .btn-danger'), null, { timeout: 120000 });
    } else r.convertDisabled = true;
    await page.waitForTimeout(300);
    r.banner = await page.locator('.banner').allInnerTexts();
    r.statuses = await page.locator('.file-item').evaluateAll((els) => els.map((e) => ({ name: e.querySelector('.fi-name').textContent, status: e.querySelector('.status').textContent })));
    r.errors = await page.locator('.file-item .fi-error').allInnerTexts();
    r.warnings = await page.locator('.file-item .fi-warn').allInnerTexts();
    // download every result
    r.downloads = [];
    for (let i = 0; i < 100; i++) {
      const btn = page.locator('.out-row .btn-primary').first();
      if (!(await btn.count())) break;
      const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()]);
      const p = path.join(dir, dl.suggestedFilename());
      await dl.saveAs(p); r.downloads.push(path.basename(p));
      await page.waitForTimeout(100);
    }
    // also test "Download All as ZIP" is enabled after convert when something was done (re-convert not needed)
    r.ok = true;
  } catch (e) { r.exception = e.message.split('\n')[0]; }
  r.console = logs; r.ms = Date.now() - t0;
  results.push(r);
  console.log(`${r.ok ? 'RAN ' : 'FAIL'} ${name.padEnd(18)} ${String(r.ms).padStart(6)}ms  files=${(r.downloads || []).join(', ') || '-'}  ${r.exception ? 'EXC: ' + r.exception : ''}`);
  await ctx.close();
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close(); server.close();
