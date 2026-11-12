// Saves blobs to the user's device through a temporary Object URL (nothing leaves the browser).

import { ConverterError, ERR } from './errors.js';
import { sanitizeFileName } from './format.js';

export function saveBlob(blob, name) {
  if (!blob) throw new ConverterError(ERR.DOWNLOAD, 'The result is no longer in memory. Convert the file again.');
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFileName(name, 'download');
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser time to start the download before the URL is released.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    throw new ConverterError(ERR.DOWNLOAD, e.message, { cause: e });
  }
}
