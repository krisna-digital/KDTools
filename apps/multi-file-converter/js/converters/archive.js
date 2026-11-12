// Archive tools: ZIP extraction (with preview/selection) and ZIP creation. Only ZIP is implemented.

import { ConverterError, ERR } from '../core/errors.js';
import { baseName, mimeFor } from '../core/format.js';
import { createZip, extractEntries, listZip } from '../core/zipManager.js';

export async function previewZip(file) {
  const { entries, totalSize } = await listZip(file);
  return { entries, totalSize };
}

/** Extract selected entries (all by default). Each file becomes one output. */
export async function extractZip({ file, options: o, signal, onProgress }) {
  onProgress?.(0.05, 'Reading archive…');
  const { zip, entries } = await listZip(file);
  const files = entries.filter((e) => !e.dir);
  if (!files.length) throw new ConverterError(ERR.FAILED, 'The archive contains no files.', { retryable: false });
  const selected = o.selection ? files.filter((e) => o.selection.has(e.path)) : files;
  if (!selected.length) throw new ConverterError(ERR.FAILED, 'No files selected for extraction.', { retryable: false });
  const out = await extractEntries(zip, selected.map((e) => e.path), { flatten: o.structure === 'flat', signal, onProgress: (p) => onProgress?.(0.1 + 0.85 * p, `Extracting… ${Math.round(p * 100)}%`) });
  const root = o.structure === 'folder' ? `${baseName(file.name)}/` : '';
  const outputs = out.map((f) => ({ name: root + f.name, blob: f.blob, mime: f.blob.type || mimeFor(f.name.split('.').pop().toLowerCase()) }));
  const warnings = [];
  if (files.length > selected.length) warnings.push(`${selected.length} of ${files.length} files extracted.`);
  onProgress?.(1);
  return { outputs, warnings };
}

/** Create one ZIP from all given files. */
export async function zipFiles({ files, options: o, signal, onProgress }) {
  const entries = files.map((f) => ({ name: f.name, blob: f }));
  const blob = await createZip(entries, { level: Number(o.level ?? 6), signal, onProgress: (p) => onProgress?.(p, `Compressing… ${Math.round(p * 100)}%`) });
  return { blob };
}
