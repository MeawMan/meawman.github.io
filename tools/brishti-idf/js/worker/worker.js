/**
 * worker.js — runs heavy computations off the main thread.
 * Messages in:  { id, job: 'analyse'|'bootstrap'|'gofp', payload }
 * Messages out: { id, type: 'progress', info } | { id, type: 'result', result } | { id, type: 'error', message }
 * Cancellation: the main thread terminates the worker and starts a new one (simple and immediate).
 */
import { analyseStation } from '../pipeline.js';
import { bootstrapQuantiles, parametricBootstrapGof } from '../core/uncertainty.js';
import { heterogeneity } from '../core/regional.js';

self.onmessage = (ev) => {
  const { id, job, payload } = ev.data;
  const progress = (info) => self.postMessage({ id, type: 'progress', info });
  try {
    let result;
    if (job === 'analyse') {
      result = analyseStation(payload.station, payload.settings, { ...payload.ctx, onProgress: progress });
    } else if (job === 'bootstrap') {
      const { ams, factors, freq, opt } = payload;
      const factor = (d) => factors[d] ?? 1;
      result = bootstrapQuantiles(ams, { ...freq, factor }, { ...opt, onProgress: progress });
      delete result.idfParams; // large; parameter CIs are summarised in paramCI
    } else if (job === 'gofp') {
      result = parametricBootstrapGof(payload.fit, payload.x, { ...payload.opt, onProgress: progress });
    } else if (job === 'heterogeneity') {
      result = heterogeneity(payload.sites, { ...payload.opt, onProgress: progress });
    } else throw new Error(`unknown job ${job}`);
    self.postMessage({ id, type: 'result', result });
  } catch (e) {
    self.postMessage({ id, type: 'error', message: e && e.message ? e.message : String(e) });
  }
};
