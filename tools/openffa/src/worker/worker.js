// worker.js - runs analyses off the main thread so large bootstraps never freeze the UI.
// Protocol:
//   main -> worker : { id, cmd: 'analyze', input, settings }
//                    { id, cmd: 'call', fn: '<name in CALLS>', args: [...] }
//   worker -> main : { id, type: 'progress', stage, frac } | { id, type: 'result', result } | { id, type: 'error', message }
// Cancel = main thread calls worker.terminate() and creates a new worker (immediate and safe).

import { runAnalysis } from '../core/analysis.js';
import { fitNonstationaryGEV, gumbelResiduals } from '../core/nonstationary.js';
import { meanResidualLife, parameterStability, peaksOverThreshold, annualMaxima } from '../core/series.js';
import { fitDistribution } from '../core/fit.js';
import { bootstrapQuantiles } from '../core/uncertainty.js';

const CALLS = {
  nonstationary(x, cov, opts) {
    const f = fitNonstationaryGEV(x, cov, opts);
    if (!f.ok) return f;
    const { paramsAt, quantileAt, ...rest } = f;
    return { ...rest, residuals: gumbelResiduals(f, x, cov) };
  },
  potDiagnostics(values, thresholds, method) {
    return { mrl: meanResidualLife(values, thresholds), stability: parameterStability(values, thresholds, method) };
  },
  potFit(recordsSerial, threshold, decl, method) {
    const recs = recordsSerial.map(([t, v]) => ({ date: new Date(t), value: v }));
    const p = peaksOverThreshold(recs, threshold, decl);
    const f = fitDistribution('GPA', p.values, method, { loc: threshold });
    return { pot: { ...p, peaks: p.peaks.map((q) => [q.date.getTime(), q.value]) }, fit: f };
  },
  potBootstrap(values, fit, Fs, opts) { return bootstrapQuantiles(values, fit, Fs, opts); },
  annualMaxima(recordsSerial, opts) {
    const recs = recordsSerial.map(([t, v]) => ({ date: new Date(t), value: v }));
    const a = annualMaxima(recs, opts);
    return { ...a, years: a.years.map((y) => ({ ...y, date: y.date ? y.date.getTime() : null })) };
  },
};

self.onmessage = (ev) => {
  const { id, cmd } = ev.data;
  try {
    if (cmd === 'analyze') {
      let last = 0;
      const result = runAnalysis(ev.data.input, ev.data.settings, (p) => {
        const now = Date.now();
        if (now - last > 80 || p.frac === 1) { last = now; self.postMessage({ id, type: 'progress', ...p }); }
      });
      self.postMessage({ id, type: 'result', result });
    } else if (cmd === 'call') {
      const result = CALLS[ev.data.fn](...ev.data.args);
      self.postMessage({ id, type: 'result', result });
    } else throw new Error('unknown command ' + cmd);
  } catch (e) {
    self.postMessage({ id, type: 'error', message: e.message, stack: e.stack });
  }
};
