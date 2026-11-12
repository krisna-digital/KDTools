import { normalizeInputs } from '../assets/js/calculator.js';
import { optimizeLayout } from '../assets/js/optimizer.js';
import { validateLayout } from '../assets/js/validator.js';

export const BASE_RAW = {
  designW: '80', designH: '59', unit: 'mm', qty: '',
  paperW: '210', paperH: '297', orientation: 'portrait', paperName: 'A4',
  gapX: '2', gapY: '2', mTop: '0', mRight: '0', mBottom: '0', mLeft: '0',
  allowRotation: true, extendedSearch: true,
};

/** Jalankan pipeline lengkap: normalisasi → optimasi → validasi. */
export function run(overrides = {}) {
  const norm = normalizeInputs({ ...BASE_RAW, ...overrides });
  if (!norm.ok) throw new Error(norm.errors.join('; '));
  const result = optimizeLayout(norm.config);
  const layout = { count: result.placements.length, placements: result.placements };
  const validation = validateLayout(layout, norm.config);
  return { cfg: norm.config, result, layout, validation };
}
