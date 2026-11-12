// Audio / video conversion with FFmpeg.wasm (single-thread core: works on GitHub Pages without COOP/COEP headers).
// The core (~30 MB) is only downloaded when the first audio/video job starts.
//
// Large inputs are mounted with WORKERFS so the 500 MB source is read lazily instead of being copied into WASM memory.

import { ConverterError, ERR, throwIfAborted } from '../core/errors.js';
import { baseName, extOf, mimeFor } from '../core/format.js';
import { vendorUrl, hasLib } from '../core/loader.js';
import { onDispose } from '../core/cleanup.js';

let ff = null;
let loading = null;
let mutex = Promise.resolve();   // FFmpeg.wasm runs one command at a time
let logTail = [];

async function load(onLog) {
  if (!(await hasLib('ffmpeg'))) {
    throw new ConverterError(ERR.LIB_MISSING, 'FFmpeg.wasm is not included in this build. Run "npm install && npm run vendor" and redeploy.', { retryable: false });
  }
  if (ff) return ff;
  if (!loading) {
    loading = (async () => {
      const mod = await import(/* @vite-ignore */ vendorUrl('ffmpeg/index.js'));
      const inst = new mod.FFmpeg();
      inst.on('log', ({ message }) => { logTail.push(message); if (logTail.length > 60) logTail.shift(); onLog?.(message); });
      try {
        await inst.load({ coreURL: vendorUrl('ffmpeg-core/ffmpeg-core.js'), wasmURL: vendorUrl('ffmpeg-core/ffmpeg-core.wasm') });
      } catch (e) {
        throw new ConverterError(ERR.BROWSER, `FFmpeg.wasm could not start (${e?.message || e}). WebAssembly and module workers are required.`, { cause: e });
      }
      ff = inst;
      return inst;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

export async function disposeFfmpeg() {
  const inst = ff; ff = null; loading = null;
  try { inst?.terminate(); } catch { /* ignore */ }
}
onDispose(disposeFfmpeg);

// ---------------- command building ----------------

const AUDIO = {
  mp3: { codec: 'libmp3lame', ext: 'mp3', lossy: true }, aac: { codec: 'aac', ext: 'aac', fmt: 'adts', lossy: true },
  m4a: { codec: 'aac', ext: 'm4a', lossy: true }, ogg: { codec: 'libvorbis', ext: 'ogg', lossy: true },
  flac: { codec: 'flac', ext: 'flac', lossy: false }, wav: { codec: 'pcm_s16le', ext: 'wav', lossy: false },
};

export function audioArgs(target, o) {
  const a = AUDIO[target];
  if (!a) throw new ConverterError(ERR.UNSUPPORTED, `Unknown audio target ${target}`);
  const args = ['-vn', '-map', '0:a:0', '-map_metadata', '0'];
  args.push('-c:a', o.codec && o.codec !== 'auto' ? o.codec : a.codec);
  if (a.lossy) {
    if (o.quality === 'vbr' && target === 'mp3') args.push('-q:a', String(o.vbrQuality ?? 2));
    else if (o.quality === 'vbr' && target === 'ogg') args.push('-q:a', '5');
    else args.push('-b:a', `${Number(o.bitrate) || 192}k`);
  }
  if (target === 'flac' && o.compression != null) args.push('-compression_level', String(o.compression));
  if (target === 'wav' && o.bitDepth === 24) args[args.indexOf('pcm_s16le')] = 'pcm_s24le';
  if (Number(o.sampleRate) > 0) args.push('-ar', String(o.sampleRate));
  if (o.channels === 'mono') args.push('-ac', '1'); else if (o.channels === 'stereo') args.push('-ac', '2');
  if (a.fmt) args.push('-f', a.fmt);
  if (target === 'm4a') args.push('-movflags', '+faststart');
  return args;
}

export function videoArgs(target, o) {
  const args = [];
  const vf = [];
  if (target === 'gif') {
    const fps = Number(o.gifFps) || 12, w = Number(o.gifWidth) || 480;
    const pre = [];
    if (Number(o.gifStart) > 0) args.push('-ss', String(o.gifStart));
    if (Number(o.gifDuration) > 0) args.push('-t', String(o.gifDuration));
    pre.push(`fps=${fps}`, `scale=${w}:-1:flags=lanczos`);
    return { pre: args, post: ['-an', '-filter_complex', `${pre.join(',')},split[a][b];[a]palettegen=max_colors=${Number(o.gifColors) || 256}[p];[b][p]paletteuse=dither=${o.gifDither || 'sierra2_4a'}`, '-loop', String(o.gifLoop === 'once' ? -1 : 0)] };
  }
  if (Number(o.height) > 0) vf.push(`scale=-2:${Math.round(o.height / 2) * 2}`);
  if (Number(o.fps) > 0) vf.push(`fps=${o.fps}`);
  const post = ['-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '0'];
  if (vf.length) post.push('-vf', vf.join(','));
  if (target === 'mp4') {
    post.push('-c:v', o.videoCodec && o.videoCodec !== 'auto' ? o.videoCodec : 'libx264', '-preset', o.preset || 'veryfast', '-pix_fmt', 'yuv420p');
    if (o.videoBitrate > 0) post.push('-b:v', `${o.videoBitrate}k`); else post.push('-crf', String(o.crf ?? 23));
    if (o.audio === 'none') post.push('-an'); else post.push('-c:a', 'aac', '-b:a', `${Number(o.audioBitrate) || 128}k`);
    post.push('-movflags', '+faststart');
  } else if (target === 'webm') {
    post.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '5', '-pix_fmt', 'yuv420p');
    if (o.videoBitrate > 0) post.push('-b:v', `${o.videoBitrate}k`); else post.push('-b:v', '1500k', '-crf', String(Math.min(63, Math.max(4, (o.crf ?? 23) + 7))));
    if (o.audio === 'none') post.push('-an'); else post.push('-c:a', 'libvorbis', '-b:a', `${Number(o.audioBitrate) || 128}k`);
  } else throw new ConverterError(ERR.UNSUPPORTED, `Unknown video target ${target}`);
  return { pre: args, post };
}

// ---------------- execution ----------------

function serialize(fn) {
  const run = mutex.then(fn, fn);
  mutex = run.catch(() => {});
  return run;
}

/**
 * @param {File} file
 * @param {string[]} pre   input options (before -i)
 * @param {string[]} post  output options
 * @param {string} outExt
 */
async function runFfmpeg({ file, pre = [], post = [], outExt, signal, onProgress, durationHint }) {
  return serialize(async () => {
    throwIfAborted(signal);
    onProgress?.(0.01, 'Loading FFmpeg…');
    const inst = await load();
    logTail = [];
    const id = Math.random().toString(36).slice(2, 8);
    const inDir = `/in_${id}`;
    const inName = `${inDir}/${file.name.replace(/[^\w.\-]+/g, '_') || 'input'}`;
    const outName = `out_${id}.${outExt}`;
    let mounted = false;
    let aborted = false;
    const onAbort = () => { aborted = true; disposeFfmpeg(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    let duration = durationHint || 0;
    const onLog = ({ message }) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(message);
      if (m && !duration) duration = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    };
    inst.on('log', onLog);
    const onProg = ({ progress, time }) => {
      let p = progress;
      if ((!Number.isFinite(p) || p <= 0 || p > 1) && duration && time) p = (time / 1e6) / duration;
      if (Number.isFinite(p)) onProgress?.(Math.min(0.99, Math.max(0.02, p)), `Encoding… ${Math.round(Math.min(0.99, Math.max(0, p)) * 100)}%`);
    };
    inst.on('progress', onProg);
    try {
      await inst.createDir(inDir);
      try {
        await inst.mount('WORKERFS', { files: [file] }, inDir);
        mounted = true;
      } catch {
        // WORKERFS unavailable: fall back to copying (needs ~2x RAM)
        await inst.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
      }
      const src = mounted ? `${inDir}/${file.name}` : inName;
      onProgress?.(0.02, 'Converting…');
      const code = await inst.exec(['-hide_banner', '-nostdin', '-y', ...pre, '-i', src, ...post, outName]);
      if (aborted) throw new ConverterError(ERR.CANCELLED);
      if (code !== 0) throw explain(code);
      let data;
      try { data = await inst.readFile(outName); } catch { throw explain(code); }
      if (!data || !data.length) throw new ConverterError(ERR.FAILED, 'FFmpeg produced an empty file.');
      const copy = new Uint8Array(data); // detach from WASM memory
      return copy;
    } catch (e) {
      if (aborted) throw new ConverterError(ERR.CANCELLED);
      throw e instanceof ConverterError ? e : new ConverterError(/memory/i.test(e?.message) ? ERR.MEMORY : ERR.FAILED, e?.message || String(e), { cause: e });
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (ff === inst) {
        inst.off?.('log', onLog); inst.off?.('progress', onProg);
        try { await inst.deleteFile(outName); } catch { /* ignore */ }
        try { if (mounted) await inst.unmount(inDir); else await inst.deleteFile(inName); } catch { /* ignore */ }
        try { await inst.deleteDir(inDir); } catch { /* ignore */ }
      }
    }
  });
}

function explain(code) {
  const log = logTail.join('\n');
  if (/Invalid data found|moov atom not found|could not find codec parameters|End of file/i.test(log) && !/Stream mapping/.test(log)) return new ConverterError(ERR.CORRUPT, 'FFmpeg could not read this media file.');
  if (/Stream map '.*' matches no streams|does not contain any stream|Output file does not contain|no audio/i.test(log)) return new ConverterError(ERR.FAILED, 'The file has no audio track to extract.', { retryable: false });
  if (/Unknown encoder|Encoder .* not found|Unsupported codec|codec not currently supported/i.test(log)) return new ConverterError(ERR.CODEC, 'The required encoder is not part of this FFmpeg.wasm build.');
  if (/Decoder .* not found|Unknown decoder|unsupported/i.test(log)) return new ConverterError(ERR.CODEC, 'The source uses a codec this FFmpeg.wasm build cannot decode.');
  if (/memory|alloc/i.test(log)) return new ConverterError(ERR.MEMORY, 'FFmpeg ran out of memory. Try lower resolution, a shorter clip or a smaller file.');
  const last = logTail.filter((l) => l.trim()).slice(-2).join(' | ');
  return new ConverterError(ERR.FAILED, `FFmpeg exited with code ${code}${last ? `: ${last}` : ''}`);
}

export async function convertAudio({ file, tool, options: o, signal, onProgress }) {
  const target = tool.to;
  const bytes = await runFfmpeg({ file, post: audioArgs(target, o), outExt: AUDIO[target].ext, signal, onProgress });
  const warnings = [];
  const src = extOf(file.name);
  if (AUDIO[src]?.lossy && AUDIO[target].lossy) warnings.push('Converting lossy → lossy re-encodes the audio and slightly reduces quality.');
  if (!AUDIO[target].lossy && AUDIO[src]?.lossy) warnings.push('Lossless output from a lossy source is larger but does not restore lost quality.');
  return { outputs: [{ name: `${baseName(file.name)}.${AUDIO[target].ext}`, blob: new Blob([bytes], { type: mimeFor(target) }), mime: mimeFor(target), kind: 'audio' }], warnings };
}

export async function convertVideo({ file, tool, options: o, signal, onProgress }) {
  const target = tool.to;
  const { pre, post } = videoArgs(target, o);
  const bytes = await runFfmpeg({ file, pre, post, outExt: target, signal, onProgress, durationHint: target === 'gif' && o.gifDuration > 0 ? Number(o.gifDuration) : 0 });
  const warnings = [];
  if (target === 'webm') warnings.push('WebM (VP8) encoding in the browser is slow; long videos may take many minutes.');
  if (target === 'gif') warnings.push('GIF files are large; shorten the duration, lower the frame rate or width to reduce size.');
  return { outputs: [{ name: `${baseName(file.name)}.${target}`, blob: new Blob([bytes], { type: mimeFor(target) }), mime: mimeFor(target), kind: target === 'gif' ? 'image' : 'video' }], warnings };
}

/** Video -> audio (MP3/WAV/AAC) and "extract audio from MP4". */
export async function extractAudio({ file, tool, options: o, signal, onProgress }) {
  const r = await convertAudio({ file, tool, options: o, signal, onProgress });
  return r;
}

export { hasLib };
