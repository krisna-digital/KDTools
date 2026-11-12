// Memory cleanup: tracks Object URLs, workers and "disposers" so nothing outlives its purpose.

const urls = new Set();
const workers = new Set();
const disposers = new Set();

/** Create an Object URL that will be revoked on cleanup. */
export function trackUrl(blob) {
  const u = URL.createObjectURL(blob);
  urls.add(u);
  return u;
}

export function revokeUrl(u) {
  if (!u) return;
  URL.revokeObjectURL(u);
  urls.delete(u);
}

export function revokeAllUrls() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls.clear();
}

export function trackWorker(w) { workers.add(w); return w; }

export function killWorker(w) {
  try { w.terminate(); } catch { /* ignore */ }
  workers.delete(w);
}

export function killAllWorkers() {
  for (const w of workers) { try { w.terminate(); } catch { /* ignore */ } }
  workers.clear();
}

/** Register a function that releases heavy resources (e.g. terminate ffmpeg). Returns an unregister fn. */
export function onDispose(fn) { disposers.add(fn); return () => disposers.delete(fn); }

export async function runDisposers() {
  for (const fn of [...disposers]) {
    try { await fn(); } catch { /* ignore */ }
  }
}

/** Release everything held for a conversion job (outputs, previews). */
export function releaseJob(job) {
  if (!job) return;
  for (const o of job.outputs || []) {
    if (o.url) revokeUrl(o.url);
    o.blob = null;
    o.url = null;
  }
  job.outputs = [];
  if (job.previewUrl) { revokeUrl(job.previewUrl); job.previewUrl = null; }
}

export function cleanupAll() {
  revokeAllUrls();
  killAllWorkers();
  runDisposers();
}

// Best effort when the page is closed or navigated away.
addEventListener('pagehide', () => { revokeAllUrls(); killAllWorkers(); });
addEventListener('beforeunload', () => { revokeAllUrls(); killAllWorkers(); });

export function debugStats() {
  return { urls: urls.size, workers: workers.size, disposers: disposers.size };
}
