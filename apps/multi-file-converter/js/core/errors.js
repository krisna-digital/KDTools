// Central error type + friendly message mapping.

export const ERR = {
  UNSUPPORTED: 'UNSUPPORTED',          // Unsupported file format
  TOO_LARGE: 'TOO_LARGE',              // File exceeds maximum size
  EMPTY: 'EMPTY',                      // Empty file
  CORRUPT: 'CORRUPT',                  // Invalid or corrupted file
  FAILED: 'FAILED',                    // Conversion failed
  MEMORY: 'MEMORY',                    // Insufficient memory
  BROWSER: 'BROWSER',                  // Browser does not support this operation
  CODEC: 'CODEC',                      // Codec not supported
  CANCELLED: 'CANCELLED',              // Conversion cancelled
  DOWNLOAD: 'DOWNLOAD',                // Download failed
  LIB_MISSING: 'LIB_MISSING',          // A required library is not part of this build
  PASSWORD: 'PASSWORD',                // Password-protected input
  NO_TEXT: 'NO_TEXT',                  // Scanned PDF without OCR
};

const TITLES = {
  UNSUPPORTED: 'Unsupported file format',
  TOO_LARGE: 'File exceeds maximum size',
  EMPTY: 'The file is empty',
  CORRUPT: 'Invalid or corrupted file',
  FAILED: 'Conversion failed',
  MEMORY: 'Insufficient memory',
  BROWSER: 'Browser does not support this operation',
  CODEC: 'Codec not supported',
  CANCELLED: 'Conversion cancelled',
  DOWNLOAD: 'Download failed',
  LIB_MISSING: 'Converter library not installed',
  PASSWORD: 'Password-protected file',
  NO_TEXT: 'No selectable text found',
};

export class ConverterError extends Error {
  constructor(code, detail = '', opts = {}) {
    super(detail ? `${TITLES[code] || 'Error'}: ${detail}` : (TITLES[code] || 'Error'));
    this.name = 'ConverterError';
    this.code = code;
    this.detail = detail;
    this.retryable = opts.retryable ?? ![ERR.UNSUPPORTED, ERR.TOO_LARGE, ERR.EMPTY, ERR.LIB_MISSING, ERR.CODEC].includes(code);
    if (opts.cause) this.cause = opts.cause;
  }
}

export function isAbort(err) {
  return err?.code === ERR.CANCELLED || err?.name === 'AbortError';
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw new ConverterError(ERR.CANCELLED);
}

/** Convert any thrown value into a ConverterError with a human readable message. */
export function normalizeError(err) {
  if (err instanceof ConverterError) return err;
  const msg = String(err?.message || err || '');
  if (err?.name === 'AbortError') return new ConverterError(ERR.CANCELLED);
  if (err?.name === 'PasswordException' || /password/i.test(msg) && /pdf/i.test(msg)) {
    return new ConverterError(ERR.PASSWORD, 'Remove the password first; encrypted files cannot be converted.', { cause: err });
  }
  if (err?.name === 'InvalidPDFException' || /invalid pdf|bad xref|PDF header/i.test(msg)) {
    return new ConverterError(ERR.CORRUPT, 'This PDF could not be read.', { cause: err });
  }
  if (err instanceof RangeError && /memory|array buffer|allocation/i.test(msg) || /out of memory|memory access out of bounds|cannot enlarge memory|Array buffer allocation/i.test(msg)) {
    return new ConverterError(ERR.MEMORY, 'The file is too large for this device/browser. Try a smaller file or close other tabs.', { cause: err });
  }
  if (/Unsupported|not supported/i.test(msg) && /codec|decoder|encoder/i.test(msg)) {
    return new ConverterError(ERR.CODEC, msg, { cause: err });
  }
  if (/end of central directory|corrupted zip|not a zip|zip file/i.test(msg)) {
    return new ConverterError(ERR.CORRUPT, 'The file is not a valid ZIP/Office package.', { cause: err });
  }
  return new ConverterError(ERR.FAILED, msg || 'Unknown error', { cause: err });
}
