// CSV <-> XLSX using the built-in CSV parser and xlsxLite (no SheetJS required).

import { ConverterError, ERR } from '../core/errors.js';
import { baseName, mimeFor } from '../core/format.js';
import { decodeText, detectDelimiter, inferValue, parseCsv, toCsv } from '../lib/csv.js';
import { readXlsx, writeXlsx } from '../lib/xlsxLite.js';

const DELIMS = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };

export async function csvToXlsx({ file, options: o, onProgress }) {
  onProgress?.(0.1, 'Reading CSV…');
  const text = decodeText(await file.arrayBuffer(), o.encoding);
  const delimiter = o.delimiter === 'auto' ? detectDelimiter(text) : (DELIMS[o.delimiter] || ',');
  const raw = parseCsv(text, delimiter);
  if (!raw.length) throw new ConverterError(ERR.CORRUPT, 'The CSV contains no rows.');
  if (raw.length > 1_048_576) throw new ConverterError(ERR.FAILED, 'Excel supports at most 1,048,576 rows.');
  onProgress?.(0.4, 'Building workbook…');
  const width = Math.max(...raw.map((r) => r.length));
  if (width > 16384) throw new ConverterError(ERR.FAILED, 'Excel supports at most 16,384 columns.');
  const rows = raw.map((r) => r.map((c) => (o.inferTypes ? inferValue(c) : c)));
  const colWidths = Array.from({ length: width }, (_, c) => {
    let m = 6;
    for (let i = 0; i < Math.min(rows.length, 300); i++) m = Math.max(m, String(rows[i][c] ?? '').length + 2);
    return Math.min(60, m);
  });
  const blob = await writeXlsx([{ name: o.sheetName || 'Sheet1', rows, colWidths, freezeHeader: !!o.headerRow, boldHeader: !!o.headerRow }]);
  onProgress?.(1);
  return {
    outputs: [{ name: `${baseName(file.name)}.xlsx`, blob, mime: mimeFor('xlsx') }],
    warnings: [`Delimiter detected: ${delimiter === '\t' ? 'tab' : `"${delimiter}"`}. ${raw.length} rows × ${width} columns.`],
  };
}

export async function xlsxToCsv({ file, options: o, onProgress }) {
  onProgress?.(0.1, 'Reading workbook…');
  const wb = await readXlsx(file);
  const delimiter = DELIMS[o.delimiter] || ',';
  const sheets = wb.sheets.filter((s) => o.hiddenSheets || !s.hidden);
  const chosen = o.sheetMode === 'first' ? sheets.slice(0, 1) : sheets;
  if (!chosen.length) throw new ConverterError(ERR.CORRUPT, 'No visible sheets in the workbook.');
  const outputs = [];
  const warnings = [];
  chosen.forEach((s, i) => {
    const width = Math.max(0, ...s.rows.map((r) => r.length));
    const rows = s.rows.map((r) => Array.from({ length: width }, (_, c) => {
      const cell = r[c];
      if (!cell) return '';
      return o.useFormatted ? cell.text : (cell.t === 'd' ? cell.text : cell.v);
    }));
    let csv = toCsv(rows, { delimiter, quoteAll: o.quoteAll });
    if (o.bom) csv = '﻿' + csv;
    const suffix = chosen.length > 1 ? `-${s.name.replace(/[\\/:*?"<>|]/g, '_')}` : '';
    outputs.push({ name: `${baseName(file.name)}${suffix}.csv`, blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }), mime: mimeFor('csv') });
    onProgress?.((i + 1) / chosen.length);
  });
  if (wb.sheets.some((s) => s.merges.length)) warnings.push('Merged cells: only the top-left cell keeps its value in CSV.');
  warnings.push('Formulas are exported as their last calculated values.');
  if (outputs.length > 1) warnings.push(`${outputs.length} sheets were exported as separate CSV files.`);
  return { outputs, warnings };
}
