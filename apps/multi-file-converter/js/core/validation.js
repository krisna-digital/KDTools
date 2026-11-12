// File validation: extension, size, emptiness, magic bytes, and device capability.

import { ConverterError, ERR } from './errors.js';
import { MAX_FILE_SIZE, extOf, formatBytes } from './format.js';

const ascii = (b, from, s) => [...s].every((c, i) => b[from + i] === c.charCodeAt(0));
const isZip = (b) => ascii(b, 0, 'PK') && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6));
const hasNul = (b) => b.slice(0, 4096).includes(0);
const textHead = (b) => new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 4096)).replace(/^﻿/, '');

// Each sniffer receives the first bytes of the file. Returns true when plausible.
const SNIFF = {
  pdf: (b) => { const s = new TextDecoder('latin1').decode(b.slice(0, 1024)); return s.includes('%PDF-'); },
  png: (b) => b[0] === 0x89 && ascii(b, 1, 'PNG'),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  gif: (b) => ascii(b, 0, 'GIF8'),
  bmp: (b) => ascii(b, 0, 'BM'),
  webp: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'),
  tiff: (b) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a),
  heic: (b) => ascii(b, 4, 'ftyp') && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)/.test(String.fromCharCode(...b.slice(8, 12))),
  zip: isZip,
  svg: (b) => /<svg[\s>]/i.test(textHead(b)) || (/<\?xml/i.test(textHead(b)) && !hasNul(b)),
  html: (b) => !hasNul(b),
  txt: (b) => !hasNul(b),
  csv: (b) => !hasNul(b),
  mp3: (b) => ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  wav: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE'),
  flac: (b) => ascii(b, 0, 'fLaC') || ascii(b, 0, 'ID3'),
  ogg: (b) => ascii(b, 0, 'OggS'),
  aac: (b) => (b[0] === 0xff && (b[1] & 0xf0) === 0xf0) || ascii(b, 0, 'ID3') || ascii(b, 4, 'ftyp'),
  m4a: (b) => ascii(b, 4, 'ftyp'),
  mp4: (b) => ascii(b, 4, 'ftyp'),
  mov: (b) => ascii(b, 4, 'ftyp') || ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].some((t) => ascii(b, 4, t)),
  mkv: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  webm: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  avi: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'AVI '),
  wma: (b) => b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75,
};
const ALIAS = { jpeg: 'jpg', tif: 'tiff', docx: 'zip', xlsx: 'zip', pptx: 'zip', htm: 'html' };

async function head(file, n = 4096) {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

/**
 * Validate one file for a tool.
 * @returns {{ok:boolean, ext:string, error?:ConverterError, warnings:string[]}}
 */
export async function validateFile(file, tool) {
  const ext = extOf(file.name);
  const warnings = [];
  const accept = tool.accept || [];
  if (accept.length && !accept.includes(ext)) {
    return { ok: false, ext, warnings, error: new ConverterError(ERR.UNSUPPORTED, `.${ext || '?'} files cannot be used here. Supported: ${accept.map((a) => a.toUpperCase()).join(', ')}.`) };
  }
  if (file.size === 0) return { ok: false, ext, warnings, error: new ConverterError(ERR.EMPTY) };
  const max = tool.maxSize || MAX_FILE_SIZE;
  if (file.size > max) {
    return { ok: false, ext, warnings, error: new ConverterError(ERR.TOO_LARGE, `${formatBytes(file.size)} is larger than the ${formatBytes(max)} limit.`) };
  }
  const sniff = SNIFF[ALIAS[ext] || ext];
  if (sniff) {
    try {
      const bytes = await head(file);
      if (!sniff(bytes)) {
        return { ok: false, ext, warnings, error: new ConverterError(ERR.CORRUPT, `The content does not look like a real .${ext} file (renaming a file does not convert it).`) };
      }
    } catch (e) {
      return { ok: false, ext, warnings, error: new ConverterError(ERR.CORRUPT, 'The file could not be read.', { cause: e }) };
    }
  }
  const cap = checkCapacity(file, tool);
  if (cap.error) return { ok: false, ext, warnings, error: cap.error };
  if (cap.warning) warnings.push(cap.warning);
  return { ok: true, ext, warnings };
}

/** Estimate whether the current device can plausibly process this file. Heuristic, not a guarantee. */
export function checkCapacity(file, tool) {
  const factor = tool.memFactor || 3;
  const deviceGB = navigator.deviceMemory || 4; // capped at 8 by browsers; unknown -> assume 4
  const hardCap = (tool.hardMemCapMB || 3072) * 1024 * 1024;
  const limit = Math.min(hardCap, deviceGB * 0.6 * 1024 ** 3);
  const estimate = file.size * factor;
  if (estimate > limit) {
    return {
      error: new ConverterError(ERR.MEMORY,
        `${formatBytes(file.size)} needs roughly ${formatBytes(estimate)} of memory for this conversion, but only about ${formatBytes(limit)} is safely available in this browser. Try a smaller file, a desktop browser, or close other tabs.`),
    };
  }
  if (estimate > limit * 0.5) {
    return { warning: `Large file (${formatBytes(file.size)}). Conversion may be slow or fail on this device; keep this tab open and avoid other heavy tabs.` };
  }
  return {};
}

export function acceptAttribute(tool) {
  return (tool.accept || []).map((e) => '.' + e).join(',');
}
