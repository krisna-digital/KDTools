// ZIP creation / inspection / extraction (JSZip, fully local).

import { getJSZip } from './loader.js';
import { ConverterError, ERR, throwIfAborted } from './errors.js';
import { extOf, sanitizeZipPath, uniqueNamer } from './format.js';

// Formats that are already compressed – deflating them again only wastes time.
const STORE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'mp3', 'aac', 'm4a', 'ogg', 'flac', 'mp4', 'mov', 'mkv', 'webm', 'avi', 'zip', 'docx', 'xlsx', 'pptx', 'wma']);

export const MAX_ENTRIES = 20000;
export const MAX_TOTAL_UNCOMPRESSED = 4 * 1024 ** 3; // zip-bomb guard

/**
 * @param {{name:string, blob:Blob}[]} entries  (name may contain "/" for folders)
 * @param {{level?:number, onProgress?:(p:number)=>void, signal?:AbortSignal}} opts
 */
export async function createZip(entries, { level = 6, onProgress, signal } = {}) {
  const JSZip = await getJSZip();
  const zip = new JSZip();
  const unique = uniqueNamer();
  for (const e of entries) {
    throwIfAborted(signal);
    const path = unique(sanitizeZipPath(e.name) || 'file');
    const store = level === 0 || STORE_EXT.has(extOf(path));
    zip.file(path, e.blob, {
      binary: true,
      compression: store ? 'STORE' : 'DEFLATE',
      compressionOptions: store ? undefined : { level },
    });
  }
  try {
    return await zip.generateAsync({ type: 'blob', streamFiles: true, mimeType: 'application/zip' },
      (m) => { onProgress?.(m.percent / 100); });
  } catch (e) {
    throw new ConverterError(ERR.FAILED, `Could not create the ZIP: ${e.message}`, { cause: e });
  }
}

/** Read the central directory and return a listing without extracting anything. */
export async function listZip(file) {
  const JSZip = await getJSZip();
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    throw new ConverterError(ERR.CORRUPT, 'This ZIP archive could not be read (it may be damaged, encrypted, or not a ZIP).', { cause: e });
  }
  const entries = [];
  let total = 0;
  zip.forEach((path, entry) => {
    const size = entry._data?.uncompressedSize ?? null;
    if (!entry.dir && size) total += size;
    entries.push({ path, dir: entry.dir, size, date: entry.date });
  });
  if (entries.length > MAX_ENTRIES) throw new ConverterError(ERR.MEMORY, `The archive has ${entries.length} entries (limit ${MAX_ENTRIES}).`);
  if (total > MAX_TOTAL_UNCOMPRESSED) throw new ConverterError(ERR.MEMORY, 'The archive expands to more data than this browser can safely handle.');
  entries.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  return { zip, entries, totalSize: total };
}

/** Extract chosen entries as Blobs. */
export async function extractEntries(zip, paths, { flatten = false, onProgress, signal } = {}) {
  const out = [];
  const unique = uniqueNamer();
  let i = 0;
  for (const p of paths) {
    throwIfAborted(signal);
    const entry = zip.file(p);
    if (!entry) continue;
    let name = sanitizeZipPath(p);
    if (flatten) name = name.split('/').pop();
    const blob = await entry.async('blob');
    out.push({ name: unique(name), blob });
    onProgress?.(++i / paths.length);
  }
  return out;
}
