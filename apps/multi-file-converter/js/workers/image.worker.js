// Module worker: decodes browser-native raster formats (or receives a ready ImageBitmap) and encodes the target format.
import { encodeBitmap } from '../converters/imageCore.js';

self.onmessage = async (ev) => {
  const { id, file, bitmap, target, options } = ev.data;
  try {
    const src = bitmap || await createImageBitmap(file);
    self.postMessage({ id, type: 'progress', value: 0.5 });
    const blob = await encodeBitmap(src, target, options);
    src.close?.();
    const buffer = await blob.arrayBuffer();
    self.postMessage({ id, type: 'done', buffer, mime: blob.type }, [buffer]);
  } catch (e) {
    self.postMessage({ id, type: 'error', code: e.code || null, message: e.detail || e.message || String(e) });
  }
};
