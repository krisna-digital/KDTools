// Job queue with controlled concurrency, per-job status/progress and cancellation.
// One failing job never fails the batch.

import { ConverterError, ERR, isAbort, normalizeError } from './errors.js';

let seq = 0;
export const newId = () => `j${Date.now().toString(36)}${(seq++).toString(36)}`;

export const STATUS = {
  PENDING: 'pending', INVALID: 'invalid', QUEUED: 'queued', RUNNING: 'running',
  DONE: 'done', ERROR: 'error', CANCELLED: 'cancelled',
};

export class JobQueue {
  /**
   * @param {object} o
   * @param {(job, ctx:{signal:AbortSignal, onProgress:(p:number,msg?:string)=>void})=>Promise<{outputs:object[], warnings?:string[]}>} o.run
   * @param {(job)=>void} o.onUpdate
   * @param {number} o.concurrency
   */
  constructor({ run, onUpdate, concurrency = 1 }) {
    this.runFn = run;
    this.onUpdate = onUpdate || (() => {});
    this.concurrency = Math.max(1, concurrency);
    this.running = new Set();
    this.cancelAllFlag = false;
  }

  /** Process the given jobs. Resolves once every job reached a final state. */
  async start(jobs) {
    this.cancelAllFlag = false;
    const pending = [];
    for (const job of jobs) {
      job.status = STATUS.QUEUED; job.progress = 0; job.error = null; job.message = 'Waiting…';
      job.controller = new AbortController();
      this.onUpdate(job);
      pending.push(job);
    }
    let idx = 0;
    const worker = async () => {
      while (idx < pending.length) {
        const job = pending[idx++];
        if (this.cancelAllFlag || job.controller.signal.aborted) { this._finish(job, STATUS.CANCELLED); continue; }
        await this._runOne(job);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, pending.length) }, worker));
  }

  async _runOne(job) {
    job.status = STATUS.RUNNING; job.progress = 0; job.message = 'Starting…';
    this.onUpdate(job);
    this.running.add(job);
    const onProgress = (p, msg) => {
      job.progress = Math.max(0, Math.min(1, p));
      if (msg) job.message = msg;
      this.onUpdate(job);
    };
    try {
      const res = await this.runFn(job, { signal: job.controller.signal, onProgress });
      if (job.controller.signal.aborted) throw new ConverterError(ERR.CANCELLED);
      job.outputs = res.outputs || [];
      job.warnings = [...(job.warnings || []), ...(res.warnings || [])];
      job.progress = 1;
      job.message = 'Done';
      this._finish(job, STATUS.DONE);
    } catch (e) {
      const err = normalizeError(e);
      job.error = err;
      job.message = err.message;
      if (isAbort(err)) this._finish(job, STATUS.CANCELLED); else this._finish(job, STATUS.ERROR);
      if (!isAbort(err)) console.warn('[convert]', job.label || job.id, e);
    } finally {
      this.running.delete(job);
    }
  }

  _finish(job, status) {
    job.status = status;
    if (status === STATUS.CANCELLED) { job.message = 'Cancelled'; job.error = new ConverterError(ERR.CANCELLED); }
    this.onUpdate(job);
  }

  cancel(job) { job.controller?.abort(); }

  cancelAll() {
    this.cancelAllFlag = true;
    for (const j of this.running) j.controller?.abort();
  }
}
