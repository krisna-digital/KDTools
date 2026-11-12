// Copies the browser builds of third-party libraries from node_modules into ./vendor
// and writes vendor/manifest.json describing which libraries are really present.
// The app reads the manifest at startup and marks converters as unavailable when a
// required library is missing (instead of pretending to work).
//
// Usage:  npm install && npm run vendor
// Optional: VENDOR_NM=/path/to/node_modules npm run vendor

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'vendor');

const candidates = [
  process.env.VENDOR_NM,
  path.join(root, 'node_modules'),
  '/opt/npm-tools/node_modules',
].filter(Boolean);

function findPkg(name) {
  for (const base of candidates) {
    const dir = path.join(base, name);
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  }
  return null;
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
function copyDir(src, dst, filter = () => true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, filter);
    else if (filter(e.name)) fs.copyFileSync(s, d);
  }
}

// Each library: package, list of operations, and a file that must exist afterwards.
const LIBS = {
  pdfjs: {
    pkg: 'pdfjs-dist',
    run(p) {
      copyFile(`${p}/build/pdf.min.mjs`, `${out}/pdfjs/pdf.min.mjs`);
      copyFile(`${p}/build/pdf.worker.min.mjs`, `${out}/pdfjs/pdf.worker.min.mjs`);
      for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
        if (fs.existsSync(`${p}/${d}`)) copyDir(`${p}/${d}`, `${out}/pdfjs/${d}`);
      }
    },
    check: 'pdfjs/pdf.min.mjs',
  },
  pdflib: {
    pkg: 'pdf-lib',
    run: (p) => copyFile(`${p}/dist/pdf-lib.esm.min.js`, `${out}/pdf-lib/pdf-lib.esm.min.js`),
    check: 'pdf-lib/pdf-lib.esm.min.js',
  },
  fontkit: {
    pkg: '@pdf-lib/fontkit',
    run: (p) => copyFile(`${p}/dist/fontkit.umd.min.js`, `${out}/fontkit/fontkit.umd.min.js`),
    check: 'fontkit/fontkit.umd.min.js',
  },
  jszip: {
    pkg: 'jszip',
    run: (p) => copyFile(`${p}/dist/jszip.min.js`, `${out}/jszip/jszip.min.js`),
    check: 'jszip/jszip.min.js',
  },
  pptxgen: {
    pkg: 'pptxgenjs',
    run: (p) => copyFile(`${p}/dist/pptxgen.bundle.js`, `${out}/pptxgenjs/pptxgen.bundle.js`),
    check: 'pptxgenjs/pptxgen.bundle.js',
  },
  docx: {
    pkg: 'docx',
    run: (p) => copyFile(`${p}/dist/index.iife.js`, `${out}/docx/docx.iife.js`),
    check: 'docx/docx.iife.js',
  },
  pako: {
    pkg: 'pako',
    run: (p) => copyFile(`${p}/dist/pako.min.js`, `${out}/pako/pako.min.js`),
    check: 'pako/pako.min.js',
  },
  utif: {
    pkg: 'utif',
    run: (p) => copyFile(`${p}/UTIF.js`, `${out}/utif/UTIF.js`),
    check: 'utif/UTIF.js',
  },
  heic: {
    pkg: 'heic2any',
    run: (p) => copyFile(`${p}/dist/heic2any.min.js`, `${out}/heic2any/heic2any.min.js`),
    check: 'heic2any/heic2any.min.js',
  },
  ffmpeg: {
    pkg: '@ffmpeg/ffmpeg',
    run(p) {
      copyDir(`${p}/dist/esm`, `${out}/ffmpeg`, (n) => n.endsWith('.js'));
      const core = findPkg('@ffmpeg/core');
      if (!core) throw new Error('@ffmpeg/core not installed');
      copyFile(`${core}/dist/esm/ffmpeg-core.js`, `${out}/ffmpeg-core/ffmpeg-core.js`);
      copyFile(`${core}/dist/esm/ffmpeg-core.wasm`, `${out}/ffmpeg-core/ffmpeg-core.wasm`);
    },
    check: 'ffmpeg-core/ffmpeg-core.wasm',
  },
  tesseract: {
    pkg: 'tesseract.js',
    run(p) {
      copyFile(`${p}/dist/tesseract.min.js`, `${out}/tesseract/tesseract.min.js`);
      copyFile(`${p}/dist/worker.min.js`, `${out}/tesseract/worker.min.js`);
      const core = findPkg('tesseract.js-core');
      if (!core) throw new Error('tesseract.js-core not installed');
      copyDir(core, `${out}/tesseract/core`, (n) => /^tesseract-core.*\.(js|wasm)$/.test(n));
      for (const [pkg, code] of [['@tesseract.js-data/eng', 'eng'], ['@tesseract.js-data/ind', 'ind']]) {
        const d = findPkg(pkg);
        if (!d) continue;
        const dir = fs.readdirSync(d).find((x) => /^\d/.test(x));
        const f = dir && `${d}/${dir}/${code}.traineddata.gz`;
        if (f && fs.existsSync(f)) copyFile(f, `${out}/tesseract/lang/${code}.traineddata.gz`);
      }
    },
    check: 'tesseract/tesseract.min.js',
  },
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const manifest = { generated: new Date().toISOString(), libs: {}, versions: {}, languages: [] };
for (const [id, lib] of Object.entries(LIBS)) {
  const p = findPkg(lib.pkg);
  if (!p) {
    console.log(`MISSING  ${id.padEnd(10)} (package ${lib.pkg} not found)`);
    manifest.libs[id] = false;
    continue;
  }
  try {
    lib.run(p);
    const ok = fs.existsSync(path.join(out, lib.check));
    manifest.libs[id] = ok;
    manifest.versions[id] = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8')).version;
    console.log(`${ok ? 'OK     ' : 'FAILED '}  ${id.padEnd(10)} ${manifest.versions[id]}`);
  } catch (e) {
    manifest.libs[id] = false;
    console.log(`FAILED   ${id.padEnd(10)} ${e.message}`);
  }
}
const langDir = path.join(out, 'tesseract/lang');
if (fs.existsSync(langDir)) {
  manifest.languages = fs.readdirSync(langDir).map((f) => f.split('.')[0]);
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('\nWrote vendor/manifest.json');
const missing = Object.entries(manifest.libs).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) console.log('Unavailable libraries (converters that need them will be disabled):', missing.join(', '));
if (process.argv.includes('--strict') && missing.length) { console.error('\n--strict: refusing to continue with missing libraries.'); process.exit(1); }
