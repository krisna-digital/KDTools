/**
 * bgremoval.js — Smart Background Removal.
 *
 * Mode:
 *  1. AI Auto Remove  : model segmentasi berjalan DI BROWSER (Transformers.js, lazy-load) — foto tidak dikirim ke mana pun
 *                       (hanya file model yang diunduh). Alternatif: "Warna latar polos" (offline, tanpa model)
 *                       atau API eksternal yang dikonfigurasi pengguna (selalu minta persetujuan).
 *  2. Manual Eraser   : kuas hapus / kembalikan.
 *  3. Smart Refine    : guided-filter (tepi mengikuti detail foto asli) pada pita tepi — rambut, telinga, bahu, kerah.
 *
 * Hasil: mask (alpha) + cutout PNG berukuran ASLI foto disimpan di IndexedDB. Foto asli tidak pernah diubah.
 */
(function () {
  'use strict';
  const PPS = (window.PPS = window.PPS || {});
  const U = PPS.Util;
  const WORK_MAX = 2048;

  const CONFIG = {
    transformersUrl: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6',
    models: {
      modnet: { label: 'MODNet — potret orang (AI lokal)', repo: 'Xenova/modnet', license: 'Apache-2.0', modelOpts: {}, proc: null, size: '± 26 MB' },
      rmbg: {
        label: 'RMBG-1.4 — objek umum (AI lokal)', repo: 'briaai/RMBG-1.4', license: 'Lisensi Bria: non-komersial (penggunaan komersial perlu izin Bria)', size: '± 44 MB (q8)',
        modelOpts: { config: { model_type: 'custom' } },
        proc: { do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5], feature_extractor_type: 'ImageFeatureExtractor', image_std: [1, 1, 1], resample: 2, rescale_factor: 0.00392156862745098, size: { width: 1024, height: 1024 } },
      },
    },
  };

  // ============================================================ algoritma mask (murni)
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  /** Box blur separabel (tepi direplikasi). Ctor = Uint8Array | Float32Array. */
  function box(src, W, H, r, Ctor) {
    if (r < 1) return Ctor === src.constructor ? src.slice() : Ctor.from(src);
    const n = 2 * r + 1; const tmp = new Float32Array(W * H); const out = new Ctor(W * H); const rnd = Ctor === Uint8Array ? 0.5 : 0;
    for (let y = 0; y < H; y++) {
      const row = y * W; let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) { tmp[row + x] = sum / n; sum += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) { out[y * W + x] = sum / n + rnd; sum += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; }
    }
    return out;
  }
  /** Erosi / dilasi persegi (r piksel). */
  function morph(src, W, H, r, isMax) {
    if (r < 1) return src.slice();
    const tmp = new Uint8Array(W * H); const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { const row = y * W; for (let x = 0; x < W; x++) { let v = isMax ? 0 : 255; const a = Math.max(0, x - r), b = Math.min(W - 1, x + r); for (let k = a; k <= b; k++) { const s = src[row + k]; if (isMax ? s > v : s < v) v = s; } tmp[row + x] = v; } }
    for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) { let v = isMax ? 0 : 255; const a = Math.max(0, y - r), b = Math.min(H - 1, y + r); for (let k = a; k <= b; k++) { const s = tmp[k * W + x]; if (isMax ? s > v : s < v) v = s; } out[y * W + x] = v; } }
    return out;
  }

  /** Terapkan pengaturan kualitas tepi pada mask mentah -> mask akhir. */
  function refineMask(m, W, H, p) {
    let a = m;
    if (p.edge) { const r = Math.min(10, Math.abs(Math.round(p.edge))); a = morph(a, W, H, r, p.edge < 0); } // + = ciutkan, − = lebarkan
    if (p.smooth > 0) {
      const r = Math.max(1, Math.round(p.smooth)); const b = box(box(a, W, H, r, Uint8Array), W, H, r, Uint8Array); const k = 1 + 0.3 * p.smooth;
      const o = new Uint8Array(W * H); for (let i = 0; i < o.length; i++) o[i] = clamp255((b[i] - 128) * k + 128); a = o;
    }
    if (p.feather > 0) { const r = Math.max(1, Math.round(p.feather)); a = box(box(a, W, H, r, Uint8Array), W, H, r, Uint8Array); }
    return a;
  }

  /** Smart Refine: guided filter pada pita tepi (alpha mengikuti detail foto asli). */
  function guidedRefine(mask, rgba, W, H, r, eps) {
    const N = W * H; const I = new Float32Array(N), P = new Float32Array(N);
    for (let i = 0; i < N; i++) { I[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255; P[i] = mask[i] / 255; }
    const mI = box(I, W, H, r, Float32Array), mP = box(P, W, H, r, Float32Array);
    const II = new Float32Array(N), IP = new Float32Array(N); for (let i = 0; i < N; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * P[i]; }
    const cII = box(II, W, H, r, Float32Array), cIP = box(IP, W, H, r, Float32Array);
    const A = new Float32Array(N), B = new Float32Array(N);
    for (let i = 0; i < N; i++) { const v = cII[i] - mI[i] * mI[i], c = cIP[i] - mI[i] * mP[i]; A[i] = c / (v + eps); B[i] = mP[i] - A[i] * mI[i]; }
    const mA = box(A, W, H, r, Float32Array), mB = box(B, W, H, r, Float32Array);
    const bin = new Uint8Array(N); for (let i = 0; i < N; i++) bin[i] = mask[i] > 127 ? 255 : 0;
    const bandR = Math.max(2, Math.round(r * 1.5)); const dil = morph(bin, W, H, bandR, true), ero = morph(bin, W, H, bandR, false);
    const out = new Uint8Array(N);
    for (let i = 0; i < N; i++) { if (dil[i] !== ero[i]) { const q = mA[i] * I[i] + mB[i]; out[i] = clamp255(Math.round(q * 255)); } else out[i] = mask[i]; }
    return out;
  }

  /** Hapus komponen subjek kecil (noise) < minFrac dari area. */
  function removeIslands(mask, W, H, minFrac) {
    const N = W * H; const seen = new Uint8Array(N); const q = new Int32Array(N); const minSize = N * minFrac;
    for (let s = 0; s < N; s++) {
      if (seen[s] || mask[s] <= 127) continue;
      let head = 0, tail = 0; q[tail++] = s; seen[s] = 1; const comp = [];
      while (head < tail) {
        const p = q[head++]; comp.push(p); const x = p % W, y = (p / W) | 0;
        if (x > 0 && !seen[p - 1] && mask[p - 1] > 127) { seen[p - 1] = 1; q[tail++] = p - 1; }
        if (x < W - 1 && !seen[p + 1] && mask[p + 1] > 127) { seen[p + 1] = 1; q[tail++] = p + 1; }
        if (y > 0 && !seen[p - W] && mask[p - W] > 127) { seen[p - W] = 1; q[tail++] = p - W; }
        if (y < H - 1 && !seen[p + W] && mask[p + W] > 127) { seen[p + W] = 1; q[tail++] = p + W; }
      }
      if (comp.length < minSize) for (const p of comp) mask[p] = 0;
    }
    return mask;
  }

  /** Estimasi warna latar dari piksel yang dianggap latar (mask kecil), atau dari tepi gambar. */
  function estimateBg(rgba, W, H, mask) {
    const acc = [[], [], []]; const step = Math.max(1, Math.floor(Math.sqrt((W * H) / 20000)));
    const pushPx = (i) => { acc[0].push(rgba[i * 4]); acc[1].push(rgba[i * 4 + 1]); acc[2].push(rgba[i * 4 + 2]); };
    if (mask) { for (let i = 0; i < W * H; i += step * 3 + 1) if (mask[i] < 8) pushPx(i); }
    if (acc[0].length < 50) { const ring = Math.max(3, Math.round(Math.min(W, H) * 0.02)); for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (x < ring || y < ring || x >= W - ring || y >= H - ring) pushPx(y * W + x); }
    return acc.map((a) => { a.sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 255; });
  }

  /**
   * Hapus latar polos: tumbuh dari tepi gambar pada piksel yang mirip warna latar (offline, tanpa AI).
   * tol: 10..120.
   */
  function colorKeyMask(rgba, W, H, tol) {
    const N = W * H; const bg = estimateBg(rgba, W, H, null); const hi = tol, lo = tol * 0.45;
    const dist = (i) => { const dr = rgba[i * 4] - bg[0], dg = rgba[i * 4 + 1] - bg[1], db = rgba[i * 4 + 2] - bg[2]; return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db); };
    const mask = new Uint8Array(N).fill(255); const seen = new Uint8Array(N); const q = new Int32Array(N); let head = 0, tail = 0;
    const seed = (i) => { if (!seen[i] && dist(i) < hi) { seen[i] = 1; q[tail++] = i; } };
    for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); } for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
    while (head < tail) {
      const p = q[head++]; const d = dist(p); const t = Math.min(1, Math.max(0, (d - lo) / (hi - lo))); mask[p] = Math.round(255 * t * t * (3 - 2 * t));
      const x = p % W, y = (p / W) | 0;
      if (x > 0) seed(p - 1); if (x < W - 1) seed(p + 1); if (y > 0) seed(p - W); if (y < H - 1) seed(p + W);
    }
    return removeIslands(mask, W, H, 0.012);
  }

  /** Defringe: dekontaminasi warna tepi + tarik warna dari bagian dalam subjek. img = ImageData (alpha sudah diisi). */
  function defringe(img, W, H, strength, bg) {
    const d = img.data; const N = W * H; const alpha = new Uint8Array(N); for (let i = 0; i < N; i++) alpha[i] = d[i * 4 + 3];
    for (let i = 0; i < N; i++) {
      const a = alpha[i]; if (a === 0 || a >= 250) continue; const af = a / 255; const k = i * 4;
      for (let c = 0; c < 3; c++) { const v = clamp255((d[k + c] - (1 - af) * bg[c]) / Math.max(af, 0.1)); d[k + c] = d[k + c] * (1 - strength) + v * strength; }
    }
    const rr = 1 + Math.round(strength * 3); const inner = morph(alpha, W, H, rr, false); const K = rr + 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (alpha[i] === 0 || inner[i] === 255) continue;
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let yy = Math.max(0, y - K); yy <= Math.min(H - 1, y + K); yy++) for (let xx = Math.max(0, x - K); xx <= Math.min(W - 1, x + K); xx++) { const j = yy * W + xx; if (inner[j] === 255) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; cnt++; } }
      if (cnt) { const t = strength * 0.85, k = i * 4; d[k] = d[k] * (1 - t) + (r / cnt) * t; d[k + 1] = d[k + 1] * (1 - t) + (g / cnt) * t; d[k + 2] = d[k + 2] * (1 - t) + (b / cnt) * t; }
    }
  }

  // ============================================================ model AI (lazy-load)
  let TF = null; const modelCache = {};
  async function loadTF() {
    if (TF) return TF;
    try { TF = await import(CONFIG.transformersUrl); } catch (e) { throw new Error('Pustaka AI tidak dapat dimuat (' + (e.message || e) + '). Periksa koneksi internet atau gunakan mode "Warna latar polos" / Manual Eraser.'); }
    TF.env.allowLocalModels = false; return TF;
  }
  async function getModel(key, onProgress) {
    if (modelCache[key]) return modelCache[key];
    const def = CONFIG.models[key]; const T = await loadTF(); const files = {};
    const cb = (p) => { if (p.status === 'progress' && p.file) { files[p.file] = p.progress || 0; const v = Object.values(files); onProgress && onProgress(v.reduce((a, b) => a + b, 0) / v.length); } };
    const attempt = async (device) => T.AutoModel.from_pretrained(def.repo, Object.assign({ device, dtype: 'fp32', progress_callback: cb }, def.modelOpts));
    let model, device = navigator.gpu ? 'webgpu' : 'wasm';
    try { model = await attempt(device); } catch (e) { if (device === 'webgpu') { device = 'wasm'; model = await attempt('wasm'); } else throw e; }
    const processor = await T.AutoProcessor.from_pretrained(def.repo, def.proc ? { config: def.proc, progress_callback: cb } : { progress_callback: cb });
    return (modelCache[key] = { model, processor, T, device });
  }
  async function runModel(key, canvas, onProgress, onPhase) {
    onPhase && onPhase('Memuat model AI (hanya diunduh sekali, lalu disimpan cache browser)…');
    const { model, processor, T, device } = await getModel(key, onProgress);
    onPhase && onPhase(`Memproses di perangkat Anda (${device === 'webgpu' ? 'GPU/WebGPU' : 'CPU/WASM'})…`);
    const image = await T.RawImage.fromBlob(await U.toBlob(canvas, 'image/png'));
    const { pixel_values } = await processor(image);
    const { output } = await model({ input: pixel_values });
    const mask = await T.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(image.width, image.height);
    const ch = mask.channels || 1; const N = image.width * image.height; const out = new Uint8Array(N);
    for (let i = 0; i < N; i++) out[i] = mask.data[i * ch];
    return out;
  }

  /** API eksternal: kirim foto (resolusi kerja) ke endpoint milik pengguna; ambil alpha dari PNG hasil. */
  async function runAPI(cfg, canvas, W, H) {
    const blob = await U.toBlob(canvas, 'image/jpeg', 0.92); const fd = new FormData(); fd.append(cfg.field || 'image_file', blob, 'photo.jpg');
    (cfg.extra || '').split('\n').forEach((l) => { const i = l.indexOf('='); if (i > 0) fd.append(l.slice(0, i).trim(), l.slice(i + 1).trim()); });
    const headers = {}; if (cfg.headerName && cfg.headerValue) headers[cfg.headerName] = cfg.headerValue;
    let res; try { res = await fetch(cfg.url, { method: 'POST', body: fd, headers }); } catch (e) { throw new Error('Tidak dapat menghubungi API (' + e.message + '). Periksa URL/CORS/koneksi.'); }
    if (!res.ok) throw new Error(`API menjawab galat ${res.status}. ${(await res.text().catch(() => '')).slice(0, 160)}`);
    const out = await res.blob(); if (!/image/.test(out.type)) throw new Error('Respons API bukan gambar PNG.');
    const bm = await createImageBitmap(out); const c = U.canvas(W, H); const x = c.getContext('2d'); x.drawImage(bm, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data; const m = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3]; return m;
  }

  // ============================================================ editor UI
  const TEMPLATE = `
<div class="modal fade" id="bgModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
 <div class="modal-dialog modal-xl modal-dialog-scrollable modal-fullscreen-lg-down"><div class="modal-content">
  <div class="modal-header py-2">
   <div><h5 class="modal-title mb-0" id="bg-title">Hapus Background</h5><div class="small text-muted" id="bg-sub"></div></div>
   <span class="badge text-bg-success ms-3" id="bg-where"><i data-lucide="shield-check"></i> Pemrosesan lokal</span>
   <button type="button" class="btn-close ms-auto" id="bg-x" aria-label="Tutup"></button>
  </div>
  <div class="modal-body p-0"><div class="bg-layout">
   <div class="bg-stage">
    <div class="bg-toolbar">
     <div class="btn-group btn-group-sm" role="group" id="bg-views">
      <button class="btn btn-outline-primary" data-view="before">Sebelum</button>
      <button class="btn btn-outline-primary active" data-view="after">Sesudah</button>
      <button class="btn btn-outline-primary" data-view="compare">Bandingkan</button>
     </div>
     <div class="btn-group btn-group-sm ms-2">
      <button class="btn btn-light" id="bg-zout" title="Perkecil"><i data-lucide="zoom-out"></i></button>
      <button class="btn btn-light" id="bg-zfit" title="Pas layar"><i data-lucide="maximize"></i></button>
      <button class="btn btn-light" id="bg-zin" title="Perbesar"><i data-lucide="zoom-in"></i></button>
     </div>
     <div class="btn-group btn-group-sm ms-2">
      <button class="btn btn-light" id="bg-undo" title="Undo"><i data-lucide="undo-2"></i></button>
      <button class="btn btn-light" id="bg-redo" title="Redo"><i data-lucide="redo-2"></i></button>
      <button class="btn btn-light" id="bg-reset" title="Reset ke kondisi saat editor dibuka"><i data-lucide="rotate-ccw"></i></button>
     </div>
    </div>
    <div class="bg-canvas-wrap" id="bg-wrap"><canvas id="bg-view"></canvas>
     <div class="bg-busy d-none" id="bg-busy"><div class="spinner-border text-light mb-2"></div><div id="bg-busytxt" class="small"></div><div class="progress mt-2" style="width:220px;height:6px"><div class="progress-bar" id="bg-prog" style="width:0%"></div></div></div>
    </div>
    <div class="bg-compare" id="bg-compare">
     <div><canvas width="110" height="140" data-cmp="transparent"></canvas><span>Transparan</span></div>
     <div><canvas width="110" height="140" data-cmp="#d90f1c"></canvas><span>Merah</span></div>
     <div><canvas width="110" height="140" data-cmp="#1f5fd6"></canvas><span>Biru</span></div>
     <div><canvas width="110" height="140" data-cmp="#ffffff"></canvas><span>Putih</span></div>
    </div>
   </div>
   <div class="bg-side">
    <div class="alert alert-warning py-2 small d-none" id="bg-warn"></div>
    <ul class="nav nav-pills nav-fill small mb-3" id="bg-tools">
     <li class="nav-item"><button class="nav-link active" data-tool="ai">AI Auto Remove</button></li>
     <li class="nav-item"><button class="nav-link" data-tool="manual">Manual Eraser</button></li>
     <li class="nav-item"><button class="nav-link" data-tool="refine">Smart Refine</button></li>
    </ul>

    <div data-panel="ai">
     <label class="form-label small fw-semibold">Metode</label>
     <select class="form-select form-select-sm mb-2" id="bg-method">
      <option value="modnet">MODNet — potret orang (AI lokal, disarankan)</option>
      <option value="rmbg">RMBG-1.4 — objek umum (AI lokal, lisensi non-komersial)</option>
      <option value="color">Warna latar polos (lokal, cepat, tanpa AI)</option>
      <option value="api">API eksternal (foto DIKIRIM ke server)</option>
     </select>
     <div class="small text-muted mb-2" id="bg-methodinfo"></div>
     <div id="bg-tolwrap" class="d-none mb-2"><label class="form-label small mb-0">Toleransi warna latar: <b id="bg-tolv">38</b></label><input type="range" class="form-range" id="bg-tol" min="10" max="120" value="38"></div>
     <div id="bg-apiwrap" class="d-none border rounded p-2 mb-2 small">
      <input class="form-control form-control-sm mb-1" id="bg-apiurl" placeholder="URL endpoint (POST multipart)">
      <input class="form-control form-control-sm mb-1" id="bg-apifield" placeholder="Nama field file (mis. image_file)">
      <div class="d-flex gap-1 mb-1"><input class="form-control form-control-sm" id="bg-apihn" placeholder="Header (mis. X-Api-Key)"><input class="form-control form-control-sm" id="bg-apihv" type="password" placeholder="Nilai header"></div>
      <textarea class="form-control form-control-sm" id="bg-apiextra" rows="2" placeholder="Field tambahan, satu per baris: nama=nilai"></textarea>
      <div class="text-muted mt-1">Pengaturan disimpan hanya di browser ini. Respons harus berupa PNG dengan alpha.</div>
     </div>
     <button class="btn btn-primary w-100" id="bg-run"><i data-lucide="wand-2"></i> Jalankan hapus background</button>
     <div class="small mt-2" id="bg-status"></div>
    </div>

    <div data-panel="manual" class="d-none">
     <div class="btn-group w-100 mb-2" id="bg-brushmode"><button class="btn btn-outline-danger btn-sm active" data-bm="erase"><i data-lucide="eraser"></i> Hapus</button><button class="btn btn-outline-success btn-sm" data-bm="restore"><i data-lucide="brush"></i> Kembalikan</button></div>
     <label class="form-label small mb-0">Ukuran kuas: <b id="bg-bsv">30</b></label><input type="range" class="form-range" id="bg-bs" min="3" max="200" value="30">
     <label class="form-label small mb-0">Kekerasan: <b id="bg-bhv">60</b>%</label><input type="range" class="form-range" id="bg-bh" min="0" max="100" value="60">
     <label class="form-label small mb-0">Kekuatan: <b id="bg-bkv">100</b>%</label><input type="range" class="form-range" id="bg-bk" min="10" max="100" value="100">
     <div class="small text-muted">Geser = menggambar. Untuk menggeser kanvas: tahan <kbd>Spasi</kbd> atau tombol tengah mouse, atau gunakan dua jari. Roda mouse = zoom.</div>
    </div>

    <div data-panel="refine" class="d-none">
     <p class="small text-muted mb-2">Memperbaiki hanya <b>pita tepi</b> subjek memakai detail foto asli — berguna untuk rambut, telinga, bahu, kerah, dan tepi pakaian.</p>
     <label class="form-label small mb-0">Detail tepi / rambut (radius): <b id="bg-srv">8</b> px</label><input type="range" class="form-range" id="bg-sr" min="2" max="24" value="8">
     <label class="form-label small mb-0">Kehalusan: <b id="bg-sev">4</b></label><input type="range" class="form-range" id="bg-se" min="1" max="30" value="4">
     <button class="btn btn-primary w-100" id="bg-dorefine"><i data-lucide="sparkles"></i> Terapkan Smart Refine</button>
     <div class="small mt-2" id="bg-refstatus"></div>
    </div>

    <hr>
    <div class="fw-semibold small mb-2">Kualitas tepi <span class="text-muted fw-normal">(px pada resolusi kerja)</span></div>
    <div class="bg-sl"><label>Feather <b id="bg-feav">0</b></label><input type="range" class="form-range" id="bg-fea" min="0" max="12" step="1" value="0"></div>
    <div class="bg-sl"><label>Edge refinement (+ ciut / − lebar) <b id="bg-edgv">0</b></label><input type="range" class="form-range" id="bg-edg" min="-8" max="8" step="1" value="0"></div>
    <div class="bg-sl"><label>Smooth <b id="bg-smov">0</b></label><input type="range" class="form-range" id="bg-smo" min="0" max="8" step="1" value="0"></div>
    <div class="bg-sl"><label>Defringe <b id="bg-dfv">0</b>%</label><input type="range" class="form-range" id="bg-df" min="0" max="100" step="5" value="0"></div>
    <div class="bg-sl"><label>Opacity subjek <b id="bg-opv">100</b>%</label><input type="range" class="form-range" id="bg-op" min="10" max="100" step="1" value="100"></div>
    <div class="form-check form-switch my-2"><input class="form-check-input" type="checkbox" id="bg-sh"><label class="form-check-label small" for="bg-sh">Bayangan subjek</label></div>
    <div id="bg-shwrap" class="d-none">
     <div class="bg-sl"><label>Opacity bayangan <b id="bg-shov">35</b>%</label><input type="range" class="form-range" id="bg-sho" min="5" max="100" value="35"></div>
     <div class="bg-sl"><label>Blur bayangan <b id="bg-shbv">2.5</b> mm</label><input type="range" class="form-range" id="bg-shb" min="0" max="10" step="0.5" value="2.5"></div>
     <div class="bg-sl"><label>Jarak bayangan <b id="bg-shdv">1.2</b> mm</label><input type="range" class="form-range" id="bg-shd" min="0" max="8" step="0.2" value="1.2"></div>
     <div class="small text-muted">Pratinjau bayangan perkiraan; hasil cetak mengikuti ukuran foto.</div>
    </div>
    <hr>
    <div class="fw-semibold small mb-2">Latar belakang baru</div>
    <div class="bg-chips" id="bg-chips"></div>
    <div class="d-flex gap-2 align-items-center mt-2"><input type="color" class="form-control form-control-color" id="bg-custom" value="#1f5fd6" title="Warna custom"><button class="btn btn-sm btn-outline-secondary" id="bg-imgbtn"><i data-lucide="image"></i> Gambar latar…</button><input type="file" accept="image/*" class="d-none" id="bg-imgfile"></div>
    <div class="form-check mt-2 small"><input class="form-check-input" type="checkbox" id="bg-all" checked><label class="form-check-label" for="bg-all">Pakai latar ini untuk semua ukuran orang ini</label></div>
    <div class="small text-muted mt-1">Latar dapat diganti kapan saja tanpa mengulang proses penghapusan.</div>
   </div>
  </div></div>
  <div class="modal-footer py-2">
   <button class="btn btn-outline-secondary btn-sm me-auto" id="bg-dl"><i data-lucide="download"></i> Unduh PNG transparan</button>
   <button class="btn btn-light" id="bg-cancel">Batal</button>
   <button class="btn btn-primary" id="bg-apply"><i data-lucide="check"></i> Terapkan</button>
  </div>
 </div></div>
</div>`;

  class BGEditor {
    constructor(el) {
      this.el = el; this.q = (s) => el.querySelector(s); this.qa = (s) => Array.from(el.querySelectorAll(s));
      this.params = this.defaultParams(); this.undoS = []; this.redoS = []; this.view = { zoom: 1, ox: 0, oy: 0 };
      this.mode = 'after'; this.tool = 'ai'; this.brush = { mode: 'erase', size: 30, hard: 0.6, str: 1 }; this.bgChoice = { type: 'transparent', color: '#1f5fd6' };
      this.cmpX = 0.5; this.pointers = new Map(); this.checker = null; this.hasMask = false;
      this._wire();
    }
    defaultParams() { return { feather: 0, edge: 0, smooth: 0, defringe: 0, opacity: 100, shadow: Object.assign({}, PPS.Config.SHADOW_DEFAULT) }; }
    ui() { return PPS.UI || { toast: (m) => alert(m), confirm: async (m) => confirm(m) }; }

    // -------------------------------------------------- pembukaan
    async open(opts) {
      this.opts = opts; const per = (this.person = opts.person); this.projectId = opts.projectId;
      this.q('#bg-title').textContent = 'Hapus Background — ' + per.name;
      this.modal = bootstrap.Modal.getOrCreateInstance(this.el, { focus: false }); // tanpa focus-trap agar dialog konfirmasi di atasnya bisa diketik
      const full = await PPS.Imaging.getBitmap(per.photoId, 0); this.full = full;
      const k = Math.min(1, WORK_MAX / Math.max(full.width, full.height)); this.W = Math.max(1, Math.round(full.width * k)); this.H = Math.max(1, Math.round(full.height * k));
      this.q('#bg-sub').textContent = `Foto asli ${full.width}×${full.height}px • area kerja ${this.W}×${this.H}px • foto asli tidak diubah`;
      const sc = (this.srcCanvas = U.canvas(this.W, this.H)); const sx = sc.getContext('2d'); sx.imageSmoothingQuality = 'high'; sx.drawImage(full, 0, 0, this.W, this.H);
      this.srcData = sx.getImageData(0, 0, this.W, this.H); this.out = U.canvas(this.W, this.H); this.outCtx = this.out.getContext('2d');
      this.mask = new Uint8Array(this.W * this.H); this.hasMask = false; this.params = this.defaultParams(); this.method = per.cutout ? per.cutout.method : 'modnet';
      this.bgChoice = { type: 'transparent', color: '#1f5fd6' }; this.bgImg = null; this.undoS = []; this.redoS = []; this.fullDone = false;
      const warn = [];
      if (Math.max(full.width, full.height) < 600) warn.push('Foto sangat kecil (' + full.width + '×' + full.height + 'px): hasil akan kurang tajam dan tepi kurang rapi, terutama untuk ukuran besar.');
      // muat mask lama
      if (per.cutout && per.cutout.maskId) {
        try {
          const mb = await PPS.Storage.getBlob(per.cutout.maskId); const bm = await createImageBitmap(mb); const c = U.canvas(this.W, this.H); const x = c.getContext('2d'); x.drawImage(bm, 0, 0, this.W, this.H);
          const d = x.getImageData(0, 0, this.W, this.H).data; for (let i = 0; i < this.mask.length; i++) this.mask[i] = d[i * 4 + 3]; this.hasMask = true;
          this.params = Object.assign(this.defaultParams(), U.deepClone(per.cutout.params || {})); this.params.shadow = Object.assign({}, PPS.Config.SHADOW_DEFAULT, this.params.shadow || {});
          this.fullDone = true;
        } catch (e) { warn.push('Mask lama tidak dapat dimuat; mulai dari awal.'); }
      }
      this.initialMask = this.mask.slice(); this.initialParams = U.deepClone(this.params); this.initialHas = this.hasMask;
      this.bgRef = estimateBg(this.srcData.data, this.W, this.H, this.hasMask ? this.mask : null);
      this._setWarn(warn.join(' ')); this._loadApiCfg(); this._syncControls(); this._chips(); this.setTool('ai'); this._setMethod(this.method);
      this.q('#bg-status').textContent = this.hasMask ? 'Hasil sebelumnya dimuat. Anda dapat menyempurnakannya.' : 'Pilih metode lalu klik “Jalankan”.';
      this.mode = this.hasMask ? 'after' : 'before'; this._setView(this.mode);
      PPS.UI && PPS.UI.icons && PPS.UI.icons(this.el);
      this.done = null; const prom = new Promise((r) => (this.done = r));
      this.modal.show();
      this.el.addEventListener('shown.bs.modal', () => { this.fit(); this.recompute(); }, { once: true });
      return prom;
    }
    close(result) { this.modal.hide(); this.out = null; this.srcData = null; if (this.done) this.done(result || null); this.done = null; }
    _setWarn(t) { const w = this.q('#bg-warn'); w.textContent = t; w.classList.toggle('d-none', !t); }

    // -------------------------------------------------- penghubung UI
    _wire() {
      const q = this.q, el = this.el; const on = (s, ev, fn) => q(s).addEventListener(ev, fn);
      on('#bg-x', 'click', () => this.cancel()); on('#bg-cancel', 'click', () => this.cancel()); on('#bg-apply', 'click', () => this.apply());
      on('#bg-views', 'click', (e) => { const b = e.target.closest('[data-view]'); if (b) this._setView(b.dataset.view); });
      on('#bg-tools', 'click', (e) => { const b = e.target.closest('[data-tool]'); if (b) this.setTool(b.dataset.tool); });
      on('#bg-zin', 'click', () => this.zoomBy(1.25)); on('#bg-zout', 'click', () => this.zoomBy(0.8)); on('#bg-zfit', 'click', () => this.fit());
      on('#bg-undo', 'click', () => this.undo()); on('#bg-redo', 'click', () => this.redo()); on('#bg-reset', 'click', () => this.resetAll());
      on('#bg-method', 'change', (e) => this._setMethod(e.target.value)); on('#bg-run', 'click', () => this.run());
      on('#bg-tol', 'input', (e) => (q('#bg-tolv').textContent = e.target.value));
      on('#bg-dorefine', 'click', () => this.smartRefine());
      on('#bg-brushmode', 'click', (e) => { const b = e.target.closest('[data-bm]'); if (!b) return; this.brush.mode = b.dataset.bm; this.qa('#bg-brushmode button').forEach((x) => x.classList.toggle('active', x === b)); });
      const bind = (id, fn, out) => { on('#' + id, 'input', (e) => { fn(parseFloat(e.target.value)); q('#' + out).textContent = e.target.value; }); };
      bind('bg-bs', (v) => (this.brush.size = v), 'bg-bsv'); bind('bg-bh', (v) => (this.brush.hard = v / 100), 'bg-bhv'); bind('bg-bk', (v) => (this.brush.str = v / 100), 'bg-bkv');
      const prm = (id, key, out, sub) => { on('#' + id, 'input', (e) => { const v = parseFloat(e.target.value); if (sub) this.params.shadow[key] = key === 'opacity' ? v / 100 : v; else this.params[key] = v; q('#' + out).textContent = e.target.value; this.schedule(); }); on('#' + id, 'change', () => this.pushUndo()); };
      prm('bg-fea', 'feather', 'bg-feav'); prm('bg-edg', 'edge', 'bg-edgv'); prm('bg-smo', 'smooth', 'bg-smov'); prm('bg-df', 'defringe', 'bg-dfv'); prm('bg-op', 'opacity', 'bg-opv');
      prm('bg-sho', 'opacity', 'bg-shov', true); prm('bg-shb', 'blur', 'bg-shbv', true); prm('bg-shd', 'offset', 'bg-shdv', true);
      on('#bg-sh', 'change', (e) => { this.params.shadow.on = e.target.checked; q('#bg-shwrap').classList.toggle('d-none', !e.target.checked); this.schedule(true); });
      on('#bg-chips', 'click', (e) => { const b = e.target.closest('[data-bgc]'); if (!b) return; const v = b.dataset.bgc; this.bgChoice = v === 'transparent' ? { type: 'transparent' } : { type: 'color', color: v }; this._chips(); this.redraw(); this.drawCompare(); });
      on('#bg-custom', 'input', (e) => { this.bgChoice = { type: 'color', color: e.target.value }; this._chips(); this.redraw(); });
      on('#bg-imgbtn', 'click', () => q('#bg-imgfile').click());
      on('#bg-imgfile', 'change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const id = await PPS.Storage.putBlob(this.projectId, f); this.bgImg = await createImageBitmap(f); this.bgChoice = { type: 'image', imageId: id }; this._chips(); this.redraw(); } catch (err) { this.ui().toast('Gambar latar tidak valid.', 'danger'); } });
      on('#bg-dl', 'click', () => this.download());
      ['api-url:url', 'api-field:field', 'api-hn:headerName', 'api-hv:headerValue', 'api-extra:extra'].forEach((s) => { const [id, k] = s.split(':'); on('#bg-' + id.replace('api-', 'api'), 'input', (e) => { this.api = this.api || {}; this.api[k] = e.target.value; localStorage.setItem('pps.bgapi', JSON.stringify(this.api)); }); });
      // kanvas
      const cv = (this.cv = q('#bg-view'));
      cv.style.touchAction = 'none';
      cv.addEventListener('pointerdown', (e) => this._pd(e)); cv.addEventListener('pointermove', (e) => this._pm(e)); cv.addEventListener('pointerup', (e) => this._pu(e)); cv.addEventListener('pointercancel', (e) => this._pu(e));
      cv.addEventListener('pointerleave', () => { this.cursor = null; this.redraw(); });
      cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); this.zoomAt(Math.exp(-e.deltaY * 0.0018), (e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr); }, { passive: false });
      window.addEventListener('keydown', (e) => { if (e.code === 'Space' && this.el.classList.contains('show')) { this.space = true; } });
      window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.space = false; });
      window.addEventListener('resize', () => { if (this.el.classList.contains('show')) { this.sizeCanvas(); this.redraw(); } });
    }
    _loadApiCfg() { try { this.api = JSON.parse(localStorage.getItem('pps.bgapi') || '{}'); } catch (e) { this.api = {}; } const q = this.q; q('#bg-apiurl').value = this.api.url || ''; q('#bg-apifield').value = this.api.field || 'image_file'; q('#bg-apihn').value = this.api.headerName || ''; q('#bg-apihv').value = this.api.headerValue || ''; q('#bg-apiextra').value = this.api.extra || ''; }
    _syncControls() {
      const p = this.params, q = this.q; const set = (id, v, out) => { q('#' + id).value = v; q('#' + out).textContent = v; };
      set('bg-fea', p.feather, 'bg-feav'); set('bg-edg', p.edge, 'bg-edgv'); set('bg-smo', p.smooth, 'bg-smov'); set('bg-df', p.defringe, 'bg-dfv'); set('bg-op', p.opacity, 'bg-opv');
      q('#bg-sh').checked = !!p.shadow.on; q('#bg-shwrap').classList.toggle('d-none', !p.shadow.on); set('bg-sho', Math.round(p.shadow.opacity * 100), 'bg-shov'); set('bg-shb', p.shadow.blur, 'bg-shbv'); set('bg-shd', p.shadow.offset, 'bg-shdv');
    }
    _chips() {
      const items = [{ v: 'transparent', l: 'Transparan' }].concat(PPS.Config.BG_COLORS.map((c) => ({ v: c.color, l: c.label })));
      this.q('#bg-chips').innerHTML = items.map((i) => { const act = (this.bgChoice.type === 'transparent' && i.v === 'transparent') || (this.bgChoice.type === 'color' && this.bgChoice.color.toLowerCase() === i.v.toLowerCase());
        return `<button type="button" class="bg-chip ${act ? 'active' : ''}" data-bgc="${i.v}" title="${i.l}" style="${i.v === 'transparent' ? '' : 'background:' + i.v}">${i.v === 'transparent' ? '<span class="chk"></span>' : ''}</button>`; }).join('') + (this.bgChoice.type === 'image' ? '<span class="badge text-bg-secondary ms-1">gambar</span>' : '');
    }
    _setMethod(m) {
      this.method = m; this.q('#bg-method').value = m; const info = this.q('#bg-methodinfo'); const web = m === 'api';
      this.q('#bg-tolwrap').classList.toggle('d-none', m !== 'color'); this.q('#bg-apiwrap').classList.toggle('d-none', !web);
      const b = this.q('#bg-where'); b.className = 'badge ms-3 ' + (web ? 'text-bg-danger' : 'text-bg-success'); b.innerHTML = web ? '<i data-lucide="cloud-upload"></i> API eksternal' : '<i data-lucide="shield-check"></i> Pemrosesan lokal'; PPS.UI && PPS.UI.icons && PPS.UI.icons(b);
      if (CONFIG.models[m]) { const d = CONFIG.models[m]; info.innerHTML = `Model diunduh dari internet sekali (${d.size}) lalu dipakai di browser Anda. <b>Foto tidak dikirim ke server.</b> Lisensi model: ${U.esc(d.license)}.`; }
      else if (m === 'color') info.textContent = 'Bukan AI: menghapus warna latar polos (dinding/kain) yang tersambung ke tepi foto. Tanpa unduhan, bekerja offline. Kurang cocok untuk latar bermotif.';
      else info.innerHTML = '<b class="text-danger">Peringatan:</b> foto (resolusi kerja) akan dikirim ke server API yang Anda isi. Anda akan diminta persetujuan setiap kali.';
    }
    setTool(t) { this.tool = t; this.qa('#bg-tools .nav-link').forEach((b) => b.classList.toggle('active', b.dataset.tool === t)); this.qa('[data-panel]').forEach((p) => p.classList.toggle('d-none', p.dataset.panel !== t)); this.cv.style.cursor = t === 'manual' ? 'none' : 'grab'; this.redraw(); }
    _setView(m) { this.mode = m; this.qa('#bg-views button').forEach((b) => b.classList.toggle('active', b.dataset.view === m)); this.redraw(); }

    // -------------------------------------------------- status / sibuk
    busy(on, text, pct) { const b = this.q('#bg-busy'); b.classList.toggle('d-none', !on); if (text != null) this.q('#bg-busytxt').textContent = text; if (pct != null) this.q('#bg-prog').style.width = Math.round(pct) + '%'; this.q('#bg-apply').disabled = on; this.q('#bg-run').disabled = on; }
    status(t, cls) { const s = this.q('#bg-status'); s.className = 'small mt-2 ' + (cls || ''); s.textContent = t; }

    // -------------------------------------------------- undo/redo
    snap() { return { mask: this.mask.slice(), params: U.deepClone(this.params), has: this.hasMask }; }
    pushUndo() { this.undoS.push(this.snap()); if (this.undoS.length > 14) this.undoS.shift(); this.redoS = []; }
    restore(s) { this.mask = s.mask.slice(); this.params = U.deepClone(s.params); this.hasMask = s.has; this._syncControls(); this.recompute(); }
    undo() { if (!this.undoS.length) return; this.redoS.push(this.snap()); this.restore(this.undoS.pop()); }
    redo() { if (!this.redoS.length) return; this.undoS.push(this.snap()); this.restore(this.redoS.pop()); }
    resetAll() { this.pushUndo(); this.mask = this.initialMask.slice(); this.params = U.deepClone(this.initialParams); this.hasMask = this.initialHas; this._syncControls(); this.recompute(); this.status('Dikembalikan ke kondisi saat editor dibuka.'); }

    // -------------------------------------------------- jalankan pemrosesan
    async run() {
      const m = this.method; this.q('#bg-warn').classList.add('d-none');
      try {
        let mask;
        if (m === 'api') {
          const cfg = this.api || {}; if (!cfg.url || !/^https?:\/\//i.test(cfg.url)) throw new Error('Isi URL API yang valid terlebih dahulu.');
          const host = new URL(cfg.url).host;
          if (!(await this.ui().confirm(`Foto ini akan DIKIRIM ke server eksternal:\n${host}\n\nFoto pelanggan keluar dari perangkat ini. Lanjutkan?`, { okText: 'Ya, kirim foto', danger: true }))) { this.status('Dibatalkan — tidak ada foto yang dikirim.'); return; }
          this.busy(true, 'Mengirim ke ' + host + '…', 15); mask = await runAPI(cfg, this.srcCanvas, this.W, this.H);
        } else if (m === 'color') {
          this.busy(true, 'Menganalisis warna latar…', 40); await U.yieldUI(); mask = colorKeyMask(this.srcData.data, this.W, this.H, parseFloat(this.q('#bg-tol').value));
        } else {
          this.busy(true, 'Menyiapkan…', 2);
          mask = await runModel(m, this.srcCanvas, (p) => this.busy(true, null, p), (t) => this.busy(true, t));
          mask = removeIslands(mask, this.W, this.H, 0.004);
        }
        // validasi hasil — jangan klaim sukses bila tidak ada subjek
        let cov = 0; for (let i = 0; i < mask.length; i++) if (mask[i] > 127) cov++; cov /= mask.length;
        this.busy(false);
        if (cov < 0.03) { this.status('Subjek tidak terdeteksi (area subjek < 3%). Hasil TIDAK diterapkan. Coba metode lain atau gunakan Manual Eraser.', 'text-danger'); this._setWarn('Subjek tidak terdeteksi. Coba lagi dengan metode/toleransi lain, atau beralih ke Manual Eraser.'); return; }
        this.pushUndo(); this.mask = mask; this.hasMask = true; this.bgRef = estimateBg(this.srcData.data, this.W, this.H, this.mask); this.recompute(); this._setView('after');
        if (cov > 0.97) { this.status('Selesai, tetapi hampir seluruh gambar terdeteksi sebagai subjek — latar mungkin belum terhapus. Periksa hasil.', 'text-warning'); }
        else this.status(`Selesai (${m === 'api' ? 'API eksternal' : 'lokal'}). Subjek ${Math.round(cov * 100)}% dari gambar. Periksa tepi lalu sempurnakan bila perlu.`, 'text-success');
      } catch (err) {
        this.busy(false); this.status('Gagal: ' + (err.message || err), 'text-danger');
        this._setWarn((err.message || String(err)) + ' — Anda dapat mencoba lagi atau beralih ke Manual Eraser.');
      }
    }
    async smartRefine() {
      if (!this.hasMask) { this.q('#bg-refstatus').textContent = 'Buat seleksi dulu (AI Auto atau Manual).'; return; }
      this.busy(true, 'Smart Refine…', 50); await U.yieldUI();
      try { this.pushUndo(); this.mask = guidedRefine(this.mask, this.srcData.data, this.W, this.H, parseInt(this.q('#bg-sr').value, 10), Math.pow(10, -parseFloat(this.q('#bg-se').value) / 3 - 1)); this.recompute(); this.q('#bg-refstatus').textContent = 'Tepi diperbaiki memakai detail foto. Gunakan Undo bila kurang sesuai.'; this.q('#bg-refstatus').className = 'small mt-2 text-success'; }
      catch (e) { this.q('#bg-refstatus').textContent = 'Gagal: ' + e.message; } finally { this.busy(false); }
    }

    // -------------------------------------------------- komposisi
    schedule(shadowOnly) { if (this._rq) return; this._rq = requestAnimationFrame(() => { this._rq = 0; if (shadowOnly) this.redraw(); else this.recompute(); }); }
    finalMask() { return refineMask(this.mask, this.W, this.H, this.params); }
    recompute() {
      if (!this.srcData) return;
      this.final = this.hasMask ? this.finalMask() : new Uint8Array(this.W * this.H).fill(255);
      const img = new ImageData(new Uint8ClampedArray(this.srcData.data), this.W, this.H); const d = img.data; const op = this.params.opacity / 100;
      for (let i = 0; i < this.final.length; i++) d[i * 4 + 3] = this.hasMask ? this.final[i] * op : 255;
      if (this.hasMask && this.params.defringe > 0) defringe(img, this.W, this.H, this.params.defringe / 100, this.bgRef);
      this.outCtx.putImageData(img, 0, 0); this.redraw(); this.drawCompare();
    }
    /** Pembaruan cepat saat menyikat (belum menerapkan refine). */
    _partial(x0, y0, x1, y1) {
      x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(this.W, Math.ceil(x1)); y1 = Math.min(this.H, Math.ceil(y1)); const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return;
      const img = this.outCtx.getImageData(x0, y0, w, h); const op = this.params.opacity / 100;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const si = ((y0 + y) * this.W + x0 + x); const k = (y * w + x) * 4; img.data[k] = this.srcData.data[si * 4]; img.data[k + 1] = this.srcData.data[si * 4 + 1]; img.data[k + 2] = this.srcData.data[si * 4 + 2]; img.data[k + 3] = this.mask[si] * op; }
      this.outCtx.putImageData(img, x0, y0);
    }

    // -------------------------------------------------- tampilan
    sizeCanvas() { const r = this.q('#bg-wrap').getBoundingClientRect(); const dpr = (this.dpr = Math.min(window.devicePixelRatio || 1, 2)); this.cv.width = Math.max(100, Math.round(r.width * dpr)); this.cv.height = Math.max(100, Math.round(r.height * dpr)); }
    fit() { this.sizeCanvas(); const k = Math.min(this.cv.width / this.W, this.cv.height / this.H) * 0.96; this.view = { zoom: k, ox: (this.cv.width - this.W * k) / 2, oy: (this.cv.height - this.H * k) / 2 }; this.redraw(); }
    zoomAt(f, cx, cy) { const v = this.view; const nz = U.clamp(v.zoom * f, 0.05, 12); const k = nz / v.zoom; v.ox = cx - (cx - v.ox) * k; v.oy = cy - (cy - v.oy) * k; v.zoom = nz; this.redraw(); }
    zoomBy(f) { this.zoomAt(f, this.cv.width / 2, this.cv.height / 2); }
    _pattern(ctx) { if (!this.checker) { const c = U.canvas(24, 24); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 24, 24); x.fillStyle = '#d4d7de'; x.fillRect(0, 0, 12, 12); x.fillRect(12, 12, 12, 12); this.checker = ctx.createPattern(c, 'repeat'); } return this.checker; }
    _paintBg(ctx, x, y, w, h, choice) {
      if (choice.type === 'color') { ctx.fillStyle = choice.color; ctx.fillRect(x, y, w, h); }
      else if (choice.type === 'image' && this.bgImg) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); const k = Math.max(w / this.bgImg.width, h / this.bgImg.height); ctx.drawImage(this.bgImg, x + (w - this.bgImg.width * k) / 2, y + (h - this.bgImg.height * k) / 2, this.bgImg.width * k, this.bgImg.height * k); ctx.restore(); }
      else { ctx.fillStyle = this._pattern(ctx); ctx.fillRect(x, y, w, h); }
    }
    _drawAfter(ctx, dx, dy, dw, dh, choice, clipX) {
      ctx.save(); if (clipX != null) { ctx.beginPath(); ctx.rect(clipX, dy - 1, dx + dw - clipX + 1, dh + 2); ctx.clip(); }
      this._paintBg(ctx, dx, dy, dw, dh, choice);
      const sh = this.params.shadow; if (sh.on && choice.type !== 'transparent') { const ppm = dw / 100; ctx.shadowColor = `rgba(0,0,0,${sh.opacity})`; ctx.shadowBlur = sh.blur * ppm; ctx.shadowOffsetY = sh.offset * ppm; }
      ctx.imageSmoothingQuality = 'high'; ctx.drawImage(this.out, dx, dy, dw, dh); ctx.restore();
    }
    redraw() {
      if (!this.out || !this.cv.width) return; const ctx = this.cv.getContext('2d'); const v = this.view; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#2a2f45'; ctx.fillRect(0, 0, this.cv.width, this.cv.height);
      const dx = v.ox, dy = v.oy, dw = this.W * v.zoom, dh = this.H * v.zoom;
      if (this.mode === 'before' || !this.hasMask) { ctx.drawImage(this.srcCanvas, dx, dy, dw, dh); }
      else if (this.mode === 'after') this._drawAfter(ctx, dx, dy, dw, dh, this.bgChoice);
      else { ctx.drawImage(this.srcCanvas, dx, dy, dw, dh); const cx = dx + dw * this.cmpX; this._drawAfter(ctx, dx, dy, dw, dh, this.bgChoice, cx);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * this.dpr; ctx.beginPath(); ctx.moveTo(cx, dy); ctx.lineTo(cx, dy + dh); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, dy + dh / 2, 9 * this.dpr, 0, 7); ctx.fill(); }
      if (this.tool === 'manual' && this.cursor) { const r = (this.brush.size * v.zoom); ctx.strokeStyle = this.brush.mode === 'erase' ? '#ff4d4f' : '#22c55e'; ctx.lineWidth = 1.5 * this.dpr; ctx.beginPath(); ctx.arc(this.cursor.x, this.cursor.y, r, 0, 7); ctx.stroke(); }
      this.q('#bg-undo').disabled = !this.undoS.length; this.q('#bg-redo').disabled = !this.redoS.length;
    }
    drawCompare() {
      if (!this.out) return; this.qa('[data-cmp]').forEach((c) => { const x = c.getContext('2d'); const w = c.width, h = c.height; const k = Math.min(w / this.W, h / this.H); const dw = this.W * k, dh = this.H * k, dx = (w - dw) / 2, dy = (h - dh) / 2;
        x.clearRect(0, 0, w, h); const v = c.dataset.cmp; if (v === 'transparent') { x.fillStyle = this._pattern(x); x.fillRect(0, 0, w, h); } else { x.fillStyle = v; x.fillRect(0, 0, w, h); }
        if (this.hasMask) x.drawImage(this.out, dx, dy, dw, dh); else x.drawImage(this.srcCanvas, dx, dy, dw, dh); });
    }

    // -------------------------------------------------- interaksi kanvas
    _pos(e) { const r = this.cv.getBoundingClientRect(); const x = (e.clientX - r.left) * this.dpr, y = (e.clientY - r.top) * this.dpr; return { x, y, ix: (x - this.view.ox) / this.view.zoom, iy: (y - this.view.oy) / this.view.zoom }; }
    _pd(e) {
      this.cv.setPointerCapture(e.pointerId); const p = this._pos(e); this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) { this.painting = false; this.panning = true; this._pinch = null; return; }
      if (this.mode === 'compare' && this.tool !== 'manual') { const dx = this.view.ox + this.W * this.view.zoom * this.cmpX; if (Math.abs(p.x - dx) < 18 * this.dpr) { this.dragCmp = true; return; } }
      if (e.button === 1 || this.space || this.tool !== 'manual' || !this.hasMask && this.tool === 'manual' && false) { this.panning = true; this.last = p; this.cv.style.cursor = 'grabbing'; return; }
      if (!this.hasMask) { this.status('Buat seleksi dulu dengan AI Auto Remove. Atau tekan “Mulai dari seluruh gambar” — lalu hapus manual.', 'text-warning'); this._offerBlank(); return; }
      this.pushUndo(); this.painting = true; this.dirty = null; this.lastPt = null; this._stroke(p);
    }
    _offerBlank() { if (!this._blankOffered) { this._blankOffered = true; this.ui().confirm('Belum ada seleksi. Mulai dengan seluruh gambar sebagai subjek, lalu hapus latar secara manual?', { okText: 'Mulai manual' }).then((ok) => { this._blankOffered = false; if (ok) { this.pushUndo(); this.mask.fill(255); this.hasMask = true; this.recompute(); this._setView('after'); } }); } }
    _pm(e) {
      const p = this._pos(e); this.cursor = { x: p.x, y: p.y };
      if (this.pointers.has(e.pointerId)) {
        const prev = this.pointers.get(e.pointerId); this.pointers.set(e.pointerId, p);
        if (this.pointers.size === 2) { const [a, b] = Array.from(this.pointers.values()); const d = Math.hypot(a.x - b.x, a.y - b.y); const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; if (this._pinch) this.zoomAt(d / this._pinch.d, mx, my), (this.view.ox += mx - this._pinch.mx, this.view.oy += my - this._pinch.my); this._pinch = { d, mx, my }; this.redraw(); return; }
        if (this.dragCmp) { this.cmpX = U.clamp((p.x - this.view.ox) / (this.W * this.view.zoom), 0.02, 0.98); this.redraw(); return; }
        if (this.panning) { this.view.ox += p.x - prev.x; this.view.oy += p.y - prev.y; this.redraw(); return; }
        if (this.painting) { this._stroke(p); return; }
      }
      if (this.tool === 'manual') this.redraw();
    }
    _pu(e) {
      this.pointers.delete(e.pointerId); this._pinch = null;
      if (!this.pointers.size) { const wasPaint = this.painting; this.painting = false; this.panning = false; this.dragCmp = false; this.cv.style.cursor = this.tool === 'manual' ? 'none' : 'grab'; if (wasPaint) { this.recompute(); } }
    }
    _stroke(p) {
      const r = this.brush.size; const pts = []; const cur = { x: p.ix, y: p.iy };
      if (this.lastPt) { const dx = cur.x - this.lastPt.x, dy = cur.y - this.lastPt.y; const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, r * 0.25))); for (let i = 1; i <= n; i++) pts.push({ x: this.lastPt.x + (dx * i) / n, y: this.lastPt.y + (dy * i) / n }); } else pts.push(cur);
      this.lastPt = cur; let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
      for (const s of pts) { this._stamp(s.x, s.y); bx0 = Math.min(bx0, s.x - r); by0 = Math.min(by0, s.y - r); bx1 = Math.max(bx1, s.x + r); by1 = Math.max(by1, s.y + r); }
      this._partial(bx0 - 1, by0 - 1, bx1 + 1, by1 + 1); this.redraw();
    }
    _stamp(cx, cy) {
      const { size: r, hard, str, mode } = this.brush; const W = this.W, H = this.H; const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy); if (d > r) continue; let w = d <= r * hard ? 1 : 1 - (d - r * hard) / (r * (1 - hard) + 1e-6); w = w * w * (3 - 2 * w) * str; const i = y * W + x;
        this.mask[i] = mode === 'erase' ? this.mask[i] * (1 - w) : this.mask[i] + (255 - this.mask[i]) * w;
      }
    }

    // -------------------------------------------------- hasil akhir
    /** Cutout beresolusi ASLI foto (canvas RGBA). */
    composeFull() {
      const fw = this.full.width, fh = this.full.height; const c = U.canvas(fw, fh); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(this.full, 0, 0);
      const m = U.canvas(this.W, this.H); const mx = m.getContext('2d'); const mi = mx.createImageData(this.W, this.H); const op = this.params.opacity / 100; const fin = this.final || this.finalMask();
      for (let i = 0; i < fin.length; i++) { mi.data[i * 4] = 255; mi.data[i * 4 + 1] = 255; mi.data[i * 4 + 2] = 255; mi.data[i * 4 + 3] = fin[i] * op; } mx.putImageData(mi, 0, 0);
      x.globalCompositeOperation = 'destination-in'; x.imageSmoothingQuality = 'high'; x.drawImage(m, 0, 0, fw, fh); x.globalCompositeOperation = 'source-over';
      if (this.params.defringe > 0) { const id = x.getImageData(0, 0, fw, fh); defringe(id, fw, fh, this.params.defringe / 100, this.bgRef); x.putImageData(id, 0, 0); }
      return c;
    }
    async download() {
      if (!this.hasMask) { this.ui().toast('Belum ada hasil untuk diunduh.', 'warning'); return; }
      this.busy(true, 'Membuat PNG resolusi asli…', 60); await U.yieldUI();
      try { const b = await U.toBlob(this.composeFull(), 'image/png'); U.download(b, U.safeName(this.person.name) + '_tanpa-background.png'); } catch (e) { this.ui().toast('Gagal membuat PNG: ' + e.message, 'danger'); } finally { this.busy(false); }
    }
    async cancel() {
      const changed = this.undoS.length > 0; if (changed && !(await this.ui().confirm('Batalkan perubahan? Hasil yang belum diterapkan akan hilang.', { okText: 'Buang perubahan', danger: true }))) return;
      this.close(null);
    }
    async apply() {
      if (!this.hasMask) { this.ui().toast('Belum ada seleksi. Jalankan hapus background atau gunakan Manual Eraser dulu.', 'warning'); return; }
      this.busy(true, 'Menyimpan hasil (resolusi asli)…', 30); await U.yieldUI();
      try {
        const cut = await U.toBlob(this.composeFull(), 'image/png'); this.busy(true, null, 70);
        const mc = U.canvas(this.W, this.H); const mx = mc.getContext('2d'); const mi = mx.createImageData(this.W, this.H); for (let i = 0; i < this.mask.length; i++) { mi.data[i * 4] = 255; mi.data[i * 4 + 1] = 255; mi.data[i * 4 + 2] = 255; mi.data[i * 4 + 3] = this.mask[i]; } mx.putImageData(mi, 0, 0);
        const maskBlob = await U.toBlob(mc, 'image/png');
        const cutoutId = await PPS.Storage.putBlob(this.projectId, cut); const maskId = await PPS.Storage.putBlob(this.projectId, maskBlob);
        const old = this.person.cutout; if (old) { PPS.Imaging.dropBitmaps(old.cutoutId); }
        const res = { cutout: { maskId, cutoutId, params: U.deepClone(this.params), method: this.method, at: Date.now() }, bg: this.bgChoice, applyAll: this.q('#bg-all').checked };
        this.close(res);
      } catch (e) { this.busy(false); this.ui().toast('Gagal menyimpan hasil: ' + (e.message || e), 'danger'); }
    }
  }

  let editor = null;
  PPS.BG = {
    CONFIG, algo: { box, morph, refineMask, guidedRefine, removeIslands, colorKeyMask, defringe, estimateBg },
    /** opts: { person, projectId } -> Promise<{cutout, bg, applyAll}|null> */
    open(opts) {
      if (!editor) { const d = document.createElement('div'); d.innerHTML = TEMPLATE; document.body.appendChild(d.firstElementChild); editor = new BGEditor(document.getElementById('bgModal')); }
      return editor.open(opts);
    },
  };
})();
