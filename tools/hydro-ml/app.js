/* Hydro ML Studio — application (data → features → train/tune → results → predict).
   Developed by Mahfujur Rahman Joy. Everything runs in the browser; nothing is uploaded. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = HC.fmtN, fmtD = (ms) => HIO.fmtDate(ms, S.series && S.series.step === 'hour');
  const css = HC.css;
  const DAY = 86400000;

  function msg(text, kind) { const m = $('msg'); m.textContent = text; m.className = 'msg' + (kind ? ' ' + kind : ''); }

  // ================================================================ background worker
  // Models train in a Web Worker so the page stays responsive. If workers are unavailable
  // (e.g. the page was opened straight from disk), the same engine runs on the page instead.
  const WM = (() => {
    let w = null, seq = 0, mode = 'worker', readyResolve, gotPong = false;
    let ready = new Promise((r) => { readyResolve = r; });
    const pending = new Map();
    function route(m) {
      if (m.cmd === 'pong') { gotPong = true; readyResolve(); return; }
      const p = pending.get(m.id); if (!p) return;
      if (m.cmd === 'progress') { if (p.onProgress) p.onProgress(m.f, m.phase); return; }
      if (m.cmd === 'trial') { if (p.onTrial) p.onTrial(m); return; }
      pending.delete(m.id);
      if (m.cmd === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    }
    function fallback() { if (w) { try { w.terminate(); } catch (e) { /* ignore */ } } w = null; mode = 'page'; readyResolve(); }
    function start() {
      gotPong = false;
      ready = new Promise((r) => { readyResolve = r; });
      try {
        w = new Worker('ml-worker.js');
        w.onmessage = (e) => route(e.data);
        w.onerror = () => fallback();
        w.postMessage({ cmd: 'ping', id: 'ping' });
        setTimeout(() => { if (!gotPong && mode === 'worker') fallback(); }, 2500);
      } catch (e) { fallback(); }
    }
    async function send(msg, h) {
      await ready;
      const id = msg.id || 'j' + ++seq; msg.id = id;
      return new Promise((resolve, reject) => {
        pending.set(id, Object.assign({ resolve, reject }, h || {}));
        if (mode === 'worker' && w) w.postMessage(msg);
        else setTimeout(() => HML.handle(msg, route), 30);
      });
    }
    function cancel() {
      for (const [, p] of pending) p.reject(new Error('Stopped'));
      pending.clear();
      if (mode === 'worker') { try { w.terminate(); } catch (e) { /* ignore */ } start(); }
    }
    start();
    return { send, cancel, get mode() { return mode; } };
  })();

  // ================================================================ ⓘ explanations
  // Every small "i" button (data-info="key") opens the matching text below. Edit or add entries freely.
  const INFO = {
    // data
    regular: ['REGULAR rows only', 'BWDB downloads list each day several times: REGULAR readings plus HIGH and LOW tide / peak readings. Keeping only REGULAR rows gives one consistent reading per time step, which is what the lags assume.'],
    agg: ['Time step', 'Lags are counted in steps, so the step matters. Hourly or 3-hourly data can be aggregated to daily (or monthly) means; rainfall-like columns are summed instead of averaged.'],
    gaps: ['Missing values', '<b>Interpolate</b> draws a straight line across gaps up to the length you set — fine for water level and discharge. <b>Carry forward</b> repeats the last value. Longer gaps stay empty and those rows are left out of training. Interpolated values are never used as “observed” answers when scoring.'],
    ignore: ['Ignore values', 'Codes that mean “no data”, such as -999 or 9999, are treated as missing. Separate several with commas. Leave it empty if 0 is a real value (e.g. dry-day rainfall).'],
    roles: ['Target and inputs', 'The <b>target</b> is the series you want to predict (e.g. downstream water level). <b>Inputs</b> are the series that explain it (rainfall, upstream level). <b>Ignore</b> leaves a column out — use it for serial numbers or columns you do not trust.'],
    // features
    mode: ['Simulate or forecast', '<b>Simulate</b>: inputs at the same time step are known, e.g. rebuilding a missing record from rainfall on the same day. <b>Forecast</b>: only data at least <i>h</i> steps old may be used, so the model predicts the target <i>h</i> steps ahead — the honest setting for early warning.'],
    lags: ['Input lags', 'A lag of 3 means “the value 3 steps earlier”. Rain takes time to reach the river, so the right lags reflect travel time through the catchment. 0 = same time step (simulation only). Use the lag analysis below to choose them.'],
    roll: ['Rolling windows', 'Sums or means over the last N steps, e.g. 7-day rainfall. They describe how wet the catchment has been (antecedent conditions), which single lags miss.'],
    ar: ['Past values of the target', 'Feeds the target’s own recent values (e.g. yesterday’s discharge) to the model. Usually the strongest predictor, but the model then needs the target’s history to run; gaps are filled one step at a time (recursively).'],
    season: ['Seasonal terms', 'Sine and cosine of the day of year (or month) let the model learn the monsoon cycle without a jump between 31 December and 1 January. The trend term captures slow long-term change such as riverbed erosion.'],
    inlags: ['Lags per input', 'Each input can have its own lags and rolling windows — rainfall far upstream may need longer lags than a nearby gauge. “Suggest” picks lags from the lag analysis; blank uses the defaults above; “-” switches that kind of feature off for the input.'],
    lagan: ['Lag analysis', 'For an input: cross-correlation with the target at each lag — peaks show the travel time. For the target itself: partial autocorrelation (PACF), the extra information each past value adds once the shorter lags are known. Green bars are the suggested lags. Computed on the training period only.'],
    featsel: ['Switching features off', 'Click a chip to drop that feature from every model. Removing weak or duplicated features can reduce over-fitting and speeds up training; the importance chart on Results shows which ones matter.'],
    // train
    split: ['Splitting the record', 'The model learns from the training part and is judged on the test part it never saw. Keep the split <b>chronological</b> for time series: random rows let the model peek at the day before and after, which makes scores look better than they really are.'],
    val: ['Validation for early stopping', 'Gradient boosting and the neural network watch their error on the last part of the training period and stop adding trees / epochs once it stops improving. This guards against over-fitting without touching the test period.'],
    seed: ['Random seed', 'Fixes the random choices (bootstrap samples, initial weights, random search). The same seed gives the same result every time, so runs can be reproduced and compared fairly.'],
    models: ['Which models?', 'Start with the baselines (persistence, climatology): a useful model must beat them. Tree ensembles (random forest, extra trees, gradient boosting) and SVR are usually the strongest on hydrological data; linear regression is the easiest to explain. Train several and compare.'],
    cv: ['Cross-validation', 'Repeats training and testing on different slices of the training period to see how stable a model is. <b>Time-series</b>: each fold trains on the past and tests on the next block (no peeking ahead). <b>Blocked k-fold</b>: the record is cut into k blocks and each block is tested once. It only scores — use “Train selected models” to fit the models.'],
    tuning: ['Automatic tuning', 'Tries different settings for one model and keeps the ones with the best cross-validated score on the training period, so the test period stays untouched. “Apply best settings & train” then trains it with those settings.'],
    tunemethod: ['Search methods', '<b>Grid search</b> tries every combination of the listed values — thorough but slow. <b>Random search</b> samples combinations at random — often as good with far fewer trials. <b>Bayesian optimisation</b> fits a Gaussian-process model of score vs settings and picks the next trial where improvement is most likely (expected improvement) — usually the fewest trials.'],
    // metrics
    nse: ['NSE — Nash–Sutcliffe efficiency', '1 is perfect; 0 means no better than the mean of the observations; below 0 is worse than the mean. Sensitive to peaks because errors are squared. Above 0.75 is usually “very good” (Moriasi et al., 2007).'],
    kge: ['KGE — Kling–Gupta efficiency', 'Combines correlation, bias and variability into one score (1 is perfect). Unlike NSE it also checks that the model reproduces the spread of the data. Above about −0.41 already beats the mean.'],
    r2: ['R² — coefficient of determination', 'Share of the variance explained, from the correlation squared. It ignores bias: a model that is always 20% too high can still have R² = 1, so read it together with PBIAS.'],
    r: ['r — correlation', 'How well predicted and observed values rise and fall together, from −1 to 1. Timing and shape only, no bias.'],
    rmse: ['RMSE — root mean square error', 'Typical error size in the units of the target (m, m³/s, mm). Large errors count more, so it is dominated by floods / peaks. Lower is better.'],
    mae: ['MAE — mean absolute error', 'Average size of the error in the target’s units. Less affected by a few big misses than RMSE. Lower is better.'],
    pbias: ['PBIAS — percent bias', 'Average tendency to over- or under-estimate. Positive = the model under-estimates; negative = it over-estimates. Within ±10% is very good for streamflow.'],
    rsr: ['RSR', 'RMSE divided by the standard deviation of the observations, so errors are comparable between rivers. 0 is perfect; 0.5 or less is very good.'],
    rating: ['Performance rating', 'Combines NSE, RSR and PBIAS using the thresholds of Moriasi et al. (2007), written for monthly streamflow. The rating is the worst of the three. Use it as a guide for other variables and time steps.'],
    evalset: ['Which period to judge', '<b>Test</b> is the fair score — data the model never saw. <b>Training</b> scores are always higher; a big gap between the two means over-fitting. <b>Whole record</b> mixes both.'],
    details: ['Model details', 'All statistics of the selected model for each period side by side, its settings, and what happened during training (out-of-bag score, support vectors, early stopping, features kept). Switch models with the arrows or by clicking a leaderboard row.'],
    impmethod: ['Importance methods', '<b>Built-in</b> comes from the model itself (how much the trees’ splits on a feature reduce error, or standardized coefficients for linear models). <b>Permutation</b> shuffles one feature at a time on the test period and measures the drop in NSE — slower, but works for every model and is easier to compare.'],
    zip: ['Download everything', 'One .zip with the Excel workbook (all predictions and statistics), a PNG of every chart for every model, each trained model as .json, the methods paragraph, the leaderboard and your settings. Charts use the period chosen under “Evaluate on”.'],
    // predict
    savedmodels: ['Saved models', 'A saved model (.json) holds the trained model plus everything needed to rebuild its inputs: column names, lags, rolling windows and gap settings. Load it later — even on another computer — to fill gaps or predict new data without retraining. Column names in the new data must match.'],
    predictmodes: ['Fill gaps or predict a new file', '<b>Fill gaps</b> predicts the target wherever it is missing in the loaded record and keeps the observed values elsewhere. <b>New file</b> applies the model to another file with the same columns (e.g. a new year of data). Models that use past target values fill gaps recursively: each predicted step feeds the next one.'],
  };
  // model descriptions for the ⓘ on each model card
  const MODEL_INFO = {
    persist: 'Predicts that the next value equals the last known one. Hard to beat for slow rivers at short horizons — every model should do better.',
    clim: 'Predicts the average of each calendar month in the training period. Shows how much is explained by the season alone.',
    linear: 'A weighted sum of the features — fast and easy to explain. <b>Ridge</b> shrinks the weights to handle correlated lags; <b>Lasso</b> sets useless ones to exactly zero (built-in feature selection); <b>Elastic Net</b> mixes both. Cannot capture thresholds or non-linear runoff on its own.',
    knn: 'Finds the k most similar past days and averages what happened next. Simple and assumption-free, but cannot predict beyond the range it has seen (e.g. a record flood) and slows down on long records.',
    svr: 'Support vector regression with an RBF kernel fits a smooth non-linear surface and ignores errors smaller than ε. <b>C</b> sets how hard it fits the data, <b>γ</b> how local the curve is. Strong for rainfall–runoff; trains on up to the chosen number of rows.',
    tree: 'One decision tree: a set of if-then rules (e.g. “if 3-day rain > 40 mm and level > 2 m…”). Easy to read but jumpy and prone to over-fitting — mainly a building block for the ensembles.',
    forest: 'Hundreds of trees, each grown on a random sample of rows and features, averaged together. Robust, hard to over-fit, little tuning needed. The out-of-bag score is a free validation estimate.',
    extra: 'Like random forest but split points are chosen at random, which smooths the predictions and trains faster. Often equal or better than random forest on noisy hydrological data.',
    gbm: 'Adds small trees one at a time, each correcting the errors of the ones before (the idea behind XGBoost / LightGBM). Usually the most accurate; learning rate and number of trees control over-fitting, with early stopping on the validation part.',
    mlp: 'A small neural network (multi-layer perceptron) trained with Adam. Flexible and smooth but needs more data and is more sensitive to settings; early stopping keeps the best epoch.',
  };
  // table cell text without the ⓘ buttons (for copying / export)
  const cellText = (c) => [...c.childNodes].filter((n) => !(n.classList && n.classList.contains('ib'))).map((n) => n.textContent).join('').trim();
  const ib = (key, label) => '<button class="ib" type="button" data-info="' + key + '" aria-label="About ' + esc(label || key) + '" aria-expanded="false">i</button>';
  const infoPop = (() => {
    let pop = null, owner = null;
    function close() { if (pop) pop.remove(); if (owner) owner.setAttribute('aria-expanded', 'false'); pop = owner = null; }
    function open(btn) {
      const key = btn.dataset.info, mt = key.startsWith('model-') ? key.slice(6) : null;
      const it = mt ? [CAT[mt] ? CAT[mt].name : mt, MODEL_INFO[mt] || ''] : INFO[key];
      if (!it) return;
      close();
      pop = document.createElement('div');
      pop.className = 'ipop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', it[0]);
      pop.innerHTML = '<b class="ipop-t">' + esc(it[0]) + '</b><div class="ipop-b">' + it[1] + '</div>';
      document.body.appendChild(pop);
      owner = btn; btn.setAttribute('aria-expanded', 'true');
      place();
    }
    // below the button, flipped above when there is no room, kept inside the window; follows the button on scroll / resize
    function place() {
      if (!pop) return;
      if (!owner.isConnected || !owner.offsetParent) { close(); return; }
      const b = owner.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const left = Math.max(8, Math.min(vw - pw - 8, b.left + b.width / 2 - pw / 2));
      const top = b.bottom + 8 + ph > vh && b.top - 8 - ph > 0 ? b.top - 8 - ph : b.bottom + 8;
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
    }
    // capture phase: the click opens the note without also ticking a checkbox, sorting a column or opening a model card
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.ib');
      if (btn) { e.preventDefault(); e.stopPropagation(); if (owner === btn) close(); else open(btn); return; }
      if (pop && !pop.contains(e.target)) close();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) { const o = owner; close(); if (o) o.focus(); } });
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.addEventListener('hashchange', close);
    return { close };
  })();

  // ================================================================ model catalogue
  const P = (key, label, type, def, extra) => Object.assign({ key, label, type, def }, extra || {});
  const CAT = {
    persist: { name: 'Persistence', short: 'Baseline', desc: 'Repeats the last known value (benchmark every model must beat).', color: '--dim', dash: '5 4', baseline: true, params: [] },
    clim: { name: 'Climatology', short: 'Baseline', desc: 'Mean of the training period for each calendar month.', color: '--lo', dash: '2 3', baseline: true, params: [] },
    linear: {
      name: 'Linear regression', short: 'MLR / Ridge / Lasso', desc: 'Weighted sum of the features. Ridge shrinks, Lasso / Elastic Net also switch useless lags off.', color: '--warn',
      params: [P('penalty', 'Penalty', 'select', 'ridge', { options: ['none', 'ridge', 'lasso', 'elastic'] }), P('lambda', 'Strength λ', 'number', 0, { min: 0, step: 0.001 }),
        P('l1ratio', 'Elastic-net L1 share', 'number', 0.5, { min: 0, max: 1, step: 0.05 })],
      space: [{ name: 'lambda', kind: 'float', min: 0.0001, max: 10, log: true, grid: '0, 0.001, 0.01, 0.1, 1, 10' }, { name: 'penalty', kind: 'choice', values: ['ridge', 'lasso', 'elastic'] }],
    },
    svr: {
      name: 'Support vector regression', short: 'SVR (RBF)', desc: 'Kernel model that fits a tube of width ε around the data. Strong on non-linear rainfall–runoff; trains on ≤ 3000 rows.', color: '--pink',
      params: [P('C', 'C (penalty)', 'number', 10, { min: 0.001, step: 1 }), P('epsilon', 'ε (in target std units)', 'number', 0.05, { min: 0, max: 2, step: 0.01 }),
        P('gamma', 'γ (0 = 1 / features)', 'number', 0, { min: 0, step: 0.01 }), P('maxRows', 'Max training rows', 'number', 3000, { min: 200, step: 500, int: true })],
      space: [{ name: 'C', kind: 'float', min: 0.1, max: 200, log: true, grid: '1, 10, 100' }, { name: 'epsilon', kind: 'float', min: 0.005, max: 0.3, log: true, grid: '0.01, 0.05, 0.1' },
        { name: 'gamma', kind: 'float', min: 0.003, max: 1, log: true, grid: '0.01, 0.03, 0.1' }],
    },
    extra: {
      name: 'Extra trees', short: 'ET', desc: 'Like random forest but with random cut points: faster, smoother, often as accurate.', color: '--teal',
      params: [P('nTrees', 'Trees', 'number', 150, { min: 1, step: 10, int: true }), P('maxDepth', 'Max depth', 'number', 16, { min: 1, step: 1, int: true }),
        P('minLeaf', 'Min samples per leaf', 'number', 2, { min: 1, step: 1, int: true }), P('mtryFrac', 'Features per split (fraction)', 'number', 0.7, { min: 0.05, max: 1, step: 0.05 })],
      space: [{ name: 'nTrees', kind: 'int', min: 50, max: 300, grid: '100, 200' }, { name: 'maxDepth', kind: 'int', min: 6, max: 24, grid: '10, 16, 22' },
        { name: 'minLeaf', kind: 'int', min: 1, max: 12, grid: '1, 3, 6' }, { name: 'mtryFrac', kind: 'float', min: 0.2, max: 1, grid: '0.5, 0.8, 1' }],
    },
    knn: {
      name: 'K-nearest neighbours', short: 'KNN', desc: 'Averages the k most similar past situations (inputs standardised).', color: '--err',
      params: [P('k', 'Neighbours k', 'number', 7, { min: 1, step: 1, int: true }), P('weights', 'Weights', 'select', 'distance', { options: ['distance', 'uniform'] })],
      space: [{ name: 'k', kind: 'int', min: 2, max: 40, grid: '3, 5, 7, 11, 15, 25' }, { name: 'weights', kind: 'choice', values: ['distance', 'uniform'] }],
    },
    tree: {
      name: 'Decision tree', short: 'CART', desc: 'One regression tree of if/else splits. Easy to read, prone to over-fitting.', color: '--ok',
      params: [P('maxDepth', 'Max depth', 'number', 8, { min: 1, step: 1, int: true }), P('minLeaf', 'Min samples per leaf', 'number', 5, { min: 1, step: 1, int: true })],
      space: [{ name: 'maxDepth', kind: 'int', min: 2, max: 18, grid: '4, 6, 8, 12' }, { name: 'minLeaf', kind: 'int', min: 1, max: 40, grid: '2, 5, 10, 20' }],
    },
    forest: {
      name: 'Random forest', short: 'RF', desc: 'Many trees on bootstrap samples, averaged. Robust default with feature importance and an out-of-bag score.', color: '--accent',
      params: [P('nTrees', 'Trees', 'number', 120, { min: 1, step: 10, int: true }), P('maxDepth', 'Max depth', 'number', 14, { min: 1, step: 1, int: true }),
        P('minLeaf', 'Min samples per leaf', 'number', 3, { min: 1, step: 1, int: true }), P('mtryFrac', 'Features per split (fraction)', 'number', 0.33, { min: 0.05, max: 1, step: 0.05 }),
        P('sampleFrac', 'Bootstrap sample (fraction)', 'number', 1, { min: 0.1, max: 1, step: 0.1 })],
      space: [{ name: 'nTrees', kind: 'int', min: 50, max: 300, grid: '100, 200' }, { name: 'maxDepth', kind: 'int', min: 4, max: 22, grid: '8, 12, 18' },
        { name: 'minLeaf', kind: 'int', min: 1, max: 15, grid: '1, 3, 8' }, { name: 'mtryFrac', kind: 'float', min: 0.15, max: 0.9, grid: '0.33, 0.6' }],
    },
    gbm: {
      name: 'Gradient boosting', short: 'GBM', desc: 'Small trees added one by one, each correcting the last. Often the most accurate; uses early stopping.', color: '--gen',
      params: [P('nEst', 'Max trees', 'number', 400, { min: 10, step: 50, int: true }), P('lr', 'Learning rate', 'number', 0.05, { min: 0.001, max: 1, step: 0.01 }),
        P('maxDepth', 'Tree depth', 'number', 4, { min: 1, step: 1, int: true }), P('minLeaf', 'Min samples per leaf', 'number', 5, { min: 1, step: 1, int: true }),
        P('subsample', 'Row subsample', 'number', 0.8, { min: 0.2, max: 1, step: 0.05 }), P('earlyStop', 'Early stopping', 'check', true)],
      space: [{ name: 'nEst', kind: 'int', min: 100, max: 800, grid: '200, 500' }, { name: 'lr', kind: 'float', min: 0.01, max: 0.3, log: true, grid: '0.03, 0.06, 0.1' },
        { name: 'maxDepth', kind: 'int', min: 2, max: 7, grid: '3, 4, 6' }, { name: 'subsample', kind: 'float', min: 0.5, max: 1, grid: '0.7, 1' }],
    },
    mlp: {
      name: 'Neural network', short: 'MLP', desc: 'Multilayer perceptron (Adam optimiser, early stopping). Flexible; needs more data.', color: '--hi',
      params: [P('hidden', 'Hidden layers (e.g. 32,16)', 'text', '32,16'), P('activation', 'Activation', 'select', 'relu', { options: ['relu', 'tanh'] }),
        P('epochs', 'Max epochs', 'number', 200, { min: 1, step: 10, int: true }), P('lr', 'Learning rate', 'number', 0.003, { min: 0.00001, max: 0.1, step: 0.001 }),
        P('batch', 'Batch size', 'number', 64, { min: 1, step: 8, int: true }), P('l2', 'L2 penalty', 'number', 0.0001, { min: 0, step: 0.0001 }), P('earlyStop', 'Early stopping', 'check', true)],
      space: [{ name: 'hidden', kind: 'choice', values: ['16', '32', '32,16', '64,32', '64,32,16'] }, { name: 'lr', kind: 'float', min: 0.0005, max: 0.02, log: true, grid: '0.001, 0.003, 0.01' },
        { name: 'l2', kind: 'float', min: 0.000001, max: 0.01, log: true, grid: '0.00001, 0.0001, 0.001' }, { name: 'activation', kind: 'choice', values: ['relu', 'tanh'] }],
    },
  };
  const ORDER = ['persist', 'clim', 'linear', 'knn', 'svr', 'tree', 'forest', 'extra', 'gbm', 'mlp'];
  const colorOf = (type) => css(CAT[type].color, '#5be7ff');

  // ================================================================ state
  const defaults = () => ({
    sheet: 0, dateCol: null, timeCol: '', regularOnly: false, order: 'auto', agg: 'none', gap: 'interp', gapMax: 7, ignore: '',
    roles: {},
    mode: 'sim', horizon: 1, lags: '0,1,2,3,7', roll: '3,7', rollStat: 'auto', ar: true, arLags: '1,2,3', doy: true, month: false, trend: false,
    split: 'chrono', pct: 70, splitDate: '', val: 0.15, seed: 42, folds: 5, cvType: 'timeseries',
    inputLags: {}, exclude: [],
    on: { persist: true, clim: true, linear: true, knn: false, svr: true, tree: false, forest: true, extra: true, gbm: true, mlp: false },
    params: Object.fromEntries(Object.keys(CAT).map((k) => [k, Object.fromEntries(CAT[k].params.map((p) => [p.key, p.def]))])),
    tune: { model: 'forest', method: 'bayes', nIter: 20, folds: 3, cvType: 'timeseries', metric: 'nse', space: {} },
  });
  const S = {
    cfg: defaults(), file: null, table: null, series: null, feat: null, split: null,
    runs: {}, focus: null, chart: 'hydro', evalSet: 'test', zoom: null, dzoom: null, pzoom: null, imported: [], impSeq: 0, pickModel: null,
    cv: {}, tuning: null, version: 0, predict: null, busy: false,
  };

  // ================================================================ data loading
  async function readFile(file) {
    const name = file.name, lower = name.toLowerCase();
    if (/\.(xlsx|xlsm)$/.test(lower)) return { name, sheets: await HIO.readXlsx(await file.arrayBuffer()) };
    if (/\.xls$/.test(lower)) throw new Error('Old .xls files are not supported. In Excel use Save As → .xlsx or .csv.');
    return { name, sheets: HIO.parseDelimited(await file.text()) };
  }
  async function loadFile(file) {
    try {
      msg('Reading ' + file.name + '…');
      const r = await readFile(file);
      if (!r.sheets.length) throw new Error('No data found in the file');
      adopt(r.name, r.sheets, false);
    } catch (e) { msg(e.message, 'err'); }
  }
  function loadText(text, label) {
    try {
      const sheets = HIO.parseDelimited(text);
      if (!sheets[0].rows.length) throw new Error('Nothing to load');
      adopt(label || 'pasted data', sheets, false);
    } catch (e) { msg(e.message, 'err'); }
  }

  function adopt(name, sheets, example) {
    const keepCfg = S.file && S.file.name === name;
    S.file = { name, sheets, example };
    if (!keepCfg) { const c = defaults(); c.params = S.cfg.params; c.on = S.cfg.on; c.tune = S.cfg.tune; S.cfg = c; }
    S.cfg.sheet = Math.min(S.cfg.sheet || 0, sheets.length - 1);
    S.runs = {}; S.cv = {}; S.tuning = null; S.predict = null; S.focus = null; S.zoom = S.dzoom = null;
    WM.send({ cmd: 'clear' }).catch(() => {});
    S.imported.forEach((m) => { m.alive = false; });
    chooseSheet(S.cfg.sheet, true);
    msg('Loaded ' + name + (example ? ' (synthetic example)' : '') + '. Check the columns, then continue to Features.', 'ok');
  }

  const isText = (c) => typeof c === 'string' && c.trim() !== '' && !isFinite(HIO.toNumber(c)) && !isFinite(HIO.parseDate(c));
  const isDateLike = (c) => (c && typeof c === 'object') || (typeof c === 'string' && isFinite(HIO.parseDate(c)));
  const isNum = (c) => typeof c !== 'object' && isFinite(HIO.toNumber(c));
  // Find the header row: files such as BWDB downloads start with a letterhead / metadata block.
  // The header is the first all-text row that is followed by rows holding a date and a number.
  function findHeader(rows) {
    const lim = Math.min(rows.length - 2, 60);
    for (let r = 0; r < lim; r++) {
      const row = rows[r] || [], cells = row.filter((c) => c !== '' && c != null);
      if (cells.length < 2 || !cells.every(isText)) continue;
      const next = rows.slice(r + 1, r + 4);
      if (next.length && next.every((nr) => nr.some(isDateLike) && nr.some(isNum))) return r;
    }
    // no title block: a first row of text is the header, otherwise there is none
    return (rows[0] || []).some(isText) ? 0 : -1;
  }

  function chooseSheet(i, fresh) {
    S.cfg.sheet = i;
    const rows = S.file.sheets[i].rows;
    const hr = findHeader(rows);
    const first = hr >= 0 ? rows[hr] : [];
    const body = rows.slice(hr + 1);
    const width = Math.max(first.length, ...body.slice(0, 50).map((r) => r.length));
    const header = [];
    for (let j = 0; j < width; j++) {
      let h = String(first[j] == null ? '' : first[j]).replace(/\s+/g, ' ').trim();
      if (!h || h.length > 60) h = 'Column ' + String.fromCharCode(65 + (j % 26)) + (j >= 26 ? Math.floor(j / 26) : '');
      while (header.includes(h)) h += '_';
      header.push(h);
    }
    S.table = { header, rows: body, headerRow: hr, skippedTop: Math.max(0, hr) };
    // detect the date column and numeric columns
    const n = Math.min(S.table.rows.length, 400);
    const scoreDate = header.map((h, j) => {
      let ok = 0, tot = 0;
      for (let r = 0; r < n; r++) { const v = S.table.rows[r][j]; if (v === '' || v == null) continue; tot++; if (typeof v === 'object' || (typeof v === 'string' && isFinite(HIO.parseDate(v)))) ok++; }
      return tot ? ok / tot + (/date|time|day|month/i.test(h) ? 0.2 : 0) : 0;
    });
    const numeric = header.map((h, j) => {
      let ok = 0, tot = 0;
      for (let r = 0; r < n; r++) { const v = S.table.rows[r][j]; if (v === '' || v == null) continue; tot++; if (typeof v !== 'object' && isFinite(HIO.toNumber(v))) ok++; }
      return tot > 0 && ok / tot >= 0.6;
    });
    S.table.numeric = numeric;
    if (fresh || S.cfg.dateCol == null || !header.includes(S.cfg.dateCol)) {
      let best = -1, bj = -1; scoreDate.forEach((s, j) => { if (s > best) { best = s; bj = j; } });
      S.cfg.dateCol = best >= 0.6 ? header[bj] : null;
    }
    // separate time-of-day column (e.g. "Time [hh:mm:ss]") to combine with the date
    if (fresh || (S.cfg.timeCol && !header.includes(S.cfg.timeCol))) {
      S.cfg.timeCol = header.find((h, j) => h !== S.cfg.dateCol && /time|hour|hh:mm/i.test(h) && !/date/i.test(h) &&
        S.table.rows.slice(0, 50).every((r) => { const v = r[j]; return v === '' || v == null || (v && typeof v === 'object' && v.serial < 1) || (typeof v === 'number' && v >= 0 && v < 1) || /^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i.test(String(v).trim()); })) || '';
    }
    // BWDB-style "DATA TYPE" column with HIGH / LOW / REGULAR rows
    const typeJ = header.findIndex((h) => /type/i.test(h));
    S.table.typeCol = typeJ >= 0 && S.table.rows.slice(0, 200).some((r) => /^regular$/i.test(String(r[typeJ] || '').trim())) ? header[typeJ] : '';
    if (fresh) S.cfg.regularOnly = !!S.table.typeCol;
    if (fresh || !Object.keys(S.cfg.roles).length) {
      const nums = header.filter((h, j) => numeric[j] && h !== S.cfg.dateCol && h !== S.cfg.timeCol);
      // serial-number columns (SL, No, Index, or 1,2,3,… ) are not real inputs
      const isSerial = (h) => {
        if (/^(sl|s\.?\s?l\.?|sl\.?\s?no\.?|no\.?|serial|index|id|#)$/i.test(h.trim())) return true;
        const j = header.indexOf(h), v = S.table.rows.slice(0, 200).map((r) => HIO.toNumber(r[j])).filter(isFinite);
        return v.length > 10 && v.every((x, k) => k === 0 || x - v[k - 1] === 1);
      };
      let tgt = [...nums].reverse().find((h) => !isSerial(h) && /wl|level|stage|discharge|flow|\bq\b|runoff|target/i.test(h)) || [...nums].reverse().find((h) => !isSerial(h));
      S.cfg.roles = {};
      nums.forEach((h) => { S.cfg.roles[h] = h === tgt ? 'target' : isSerial(h) ? 'ignore' : 'input'; });
    }
    rebuild();
  }

  // ================================================================ series
  const parseIgnore = (s) => String(s || '').split(/[,;\s]+/).filter((tok) => tok.trim() !== '').map(Number).filter(isFinite);
  function buildSeries(table, cfg, needCols) {
    const di = table.header.indexOf(cfg.dateCol);
    if (di < 0) throw new Error('Choose the date column');
    const cols = needCols || table.header.filter((h, j) => table.numeric[j] && h !== cfg.dateCol && h !== cfg.timeCol);
    const ci = cols.map((c) => table.header.indexOf(c));
    const ign = parseIgnore(cfg.ignore);
    // detect day/month order from the data when 'auto'
    let order = cfg.order;
    if (order === 'auto') {
      let a12 = false, b12 = false;
      for (const r of table.rows.slice(0, 2000)) { const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(String(r[di] || '')); if (m) { if (+m[1] > 12) a12 = true; if (+m[2] > 12) b12 = true; } }
      order = b12 && !a12 ? 'mdy' : 'dmy';
    }
    let recs = [], bad = 0, skippedType = 0;
    const ti = cfg.timeCol ? table.header.indexOf(cfg.timeCol) : -1;
    const tyi = cfg.regularOnly && table.typeCol ? table.header.indexOf(table.typeCol) : -1;
    const timeOf = (v) => {
      if (v == null || v === '') return 0;
      if (typeof v === 'object' && v.serial != null) return (v.serial % 1) * DAY;
      if (typeof v === 'number') return v >= 0 && v < 1 ? v * DAY : 0;
      const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(v).trim());
      if (!m) return 0;
      let hh = +m[1]; if (m[4]) { const ap = m[4].toLowerCase(); if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0; }
      return ((hh * 60 + +m[2]) * 60 + +(m[3] || 0)) * 1000;
    };
    for (const r of table.rows) {
      if (tyi >= 0 && !/^regular$/i.test(String(r[tyi] || '').trim())) { skippedType++; continue; }
      let t = HIO.parseDate(r[di], order);
      if (!isFinite(t)) { bad++; continue; }
      if (ti >= 0) { const d = new Date(t); t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + timeOf(r[ti]); }
      recs.push({ t, v: ci.map((j) => { let x = HIO.toNumber(r[j]); if (ign.includes(x)) x = NaN; return x; }) });
    }
    recs.sort((a, b) => a.t - b.t);
    // merge duplicate timestamps (mean)
    const merged = [];
    for (const r of recs) {
      const last = merged[merged.length - 1];
      if (last && last.t === r.t) { r.v.forEach((x, k) => { if (isFinite(x)) { last.s[k] += x; last.c[k]++; } }); }
      else merged.push({ t: r.t, s: r.v.map((x) => (isFinite(x) ? x : 0)), c: r.v.map((x) => (isFinite(x) ? 1 : 0)) });
    }
    recs = merged.map((m) => ({ t: m.t, v: m.s.map((s, k) => (m.c[k] ? s / m.c[k] : NaN)) }));
    if (recs.length < 10) throw new Error('Too few dated rows (' + recs.length + ')');
    const rainLike = cols.map((c) => /rain|precip|ppt|rf\b|rainfall/i.test(c));
    // aggregate to a coarser step
    if (cfg.agg === 'day' || cfg.agg === 'month') {
      const key = (t) => { const d = new Date(t); return cfg.agg === 'day' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
      const m = new Map();
      for (const r of recs) { const k = key(r.t); let b = m.get(k); if (!b) { b = { s: cols.map(() => 0), c: cols.map(() => 0) }; m.set(k, b); } r.v.forEach((x, k2) => { if (isFinite(x)) { b.s[k2] += x; b.c[k2]++; } }); }
      recs = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => ({ t, v: b.s.map((s, k) => (b.c[k] ? (rainLike[k] ? s : s / b.c[k]) : NaN)) }));
    }
    // infer the step and fill the calendar so lags are real time lags
    const diffs = []; for (let i = 1; i < Math.min(recs.length, 3000); i++) diffs.push(recs[i].t - recs[i - 1].t);
    diffs.sort((a, b) => a - b);
    const med = diffs[Math.floor(diffs.length / 2)] || DAY;
    let step = 'irregular', stepMs = med;
    if (Math.abs(med - DAY) < 3600000) step = 'day';
    else if (med >= 27 * DAY && med <= 31 * DAY) step = 'month';
    else if (Math.abs(med - 3600000) < 60000) step = 'hour';
    else if (med % 3600000 === 0 && med < DAY) step = 'hours';
    let t = [], V = cols.map(() => []), inserted = 0;
    if (step === 'irregular') { t = recs.map((r) => r.t); recs.forEach((r) => r.v.forEach((x, k) => V[k].push(x))); }
    else {
      const next = (x) => { if (step === 'month') { const d = new Date(x); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); } return x + stepMs; };
      const snap = (x) => { if (step === 'month') { const d = new Date(x); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); } return x; };
      let k = 0, cur = snap(recs[0].t);
      const end = snap(recs[recs.length - 1].t);
      while (cur <= end && t.length < 400000) {
        while (k < recs.length && snap(recs[k].t) < cur) k++;
        if (k < recs.length && snap(recs[k].t) === cur) { t.push(cur); recs[k].v.forEach((x, j) => V[j].push(x)); k++; }
        else { t.push(cur); V.forEach((a) => a.push(NaN)); inserted++; }
        cur = next(cur);
      }
    }
    const raw = V.map((a) => Float64Array.from(a));
    // fill gaps
    const filledCount = cols.map(() => 0);
    const out = raw.map((a, j) => {
      const b = Float64Array.from(a);
      if (cfg.gap === 'none') return b;
      const maxG = Math.max(1, +cfg.gapMax || 7);
      let i = 0;
      while (i < b.length) {
        if (isFinite(b[i])) { i++; continue; }
        let e = i; while (e < b.length && !isFinite(b[e])) e++;
        const len = e - i;
        if (len <= maxG && i > 0) {
          if (cfg.gap === 'ffill') { for (let q = i; q < e; q++) b[q] = b[i - 1]; filledCount[j] += len; }
          else if (e < b.length) { const a0 = b[i - 1], a1 = b[e]; for (let q = i; q < e; q++) b[q] = a0 + ((a1 - a0) * (q - i + 1)) / (len + 1); filledCount[j] += len; }
        }
        i = e;
      }
      return b;
    });
    const C = {}; cols.forEach((c, j) => { C[c] = out[j]; });
    const R = {}; cols.forEach((c, j) => { R[c] = raw[j]; });
    return { t, cols: C, raw: R, names: cols, step, stepMs, inserted, bad, skippedType, filled: Object.fromEntries(cols.map((c, j) => [c, filledCount[j]])), order, rainLike: Object.fromEntries(cols.map((c, j) => [c, rainLike[j]])) };
  }

  // ================================================================ features
  const parseList = (s, min) => [...new Set(String(s || '').split(/[,;\s]+/).map((x) => parseInt(x, 10)).filter((v) => isFinite(v) && v >= (min || 0) && v <= 3650))].sort((a, b) => a - b);
  const target = () => Object.keys(S.cfg.roles).find((k) => S.cfg.roles[k] === 'target');
  const inputs = () => Object.keys(S.cfg.roles).filter((k) => S.cfg.roles[k] === 'input');

  function featureSpec(cfg) {
    const h = cfg.mode === 'fc' ? Math.max(1, +cfg.horizon || 1) : 0;
    let lags = parseList(cfg.lags, h); if (!lags.length) lags = [h];
    const roll = parseList(cfg.roll, 2);
    let ar = cfg.ar ? parseList(cfg.arLags, Math.max(1, h)) : [];
    if (cfg.ar && !ar.length) ar = [Math.max(1, h)];
    return { h, lags, roll, ar };
  }
  const stepLabel = (step) => ({ day: 'd', month: 'mo', hour: 'h', hours: 'step', irregular: 'step' }[step] || 'step');

  // Build the design matrix. Rows are kept only when every feature is known; rows with a known X but missing y are returned separately (for gap filling).
  function buildFeatures(series, cfg, tgt, ins) {
    const G = makeGetters(series, cfg, tgt, ins), { names, getters } = G, { h } = G.spec, n = series.t.length;
    // Learn from and score against measured targets only (interpolated values are used as past-target inputs, never as answers)
    const y = tgt ? (series.raw && series.raw[tgt]) || series.cols[tgt] : null;
    const X = [], Y = [], idx = [], gapX = [], gapIdx = [];
    let dropped = 0;
    for (let i = 0; i < n; i++) {
      const row = new Array(getters.length); let ok = true;
      for (let j = 0; j < getters.length; j++) { const v = getters[j](i); if (!isFinite(v)) { ok = false; break; } row[j] = v; }
      if (!ok) { dropped++; continue; }
      const yv = y ? y[i] : NaN;
      if (y && isFinite(yv)) { X.push(row); Y.push(yv); idx.push(i); } else { gapX.push(row); gapIdx.push(i); }
    }
    return { names, allNames: G.allNames, X, y: Y, idx, gapX, gapIdx, dropped, h, spec: G.spec };
  }
  // Feature functions of the row index; they read the series arrays live, so recursive gap filling can feed predictions back in.
  // Lags and rolling windows for one input: its own setting if given, otherwise the default
  function inputSpec(cfg, c) {
    const sp = featureSpec(cfg), own = (cfg.inputLags || {})[c] || {};
    let lags = own.lags != null && String(own.lags).trim() !== '' ? parseList(own.lags, sp.h) : sp.lags;
    if (own.lags != null && String(own.lags).trim() === '-') lags = [];
    const roll = own.roll != null && String(own.roll).trim() !== '' ? (String(own.roll).trim() === '-' ? [] : parseList(own.roll, 2)) : sp.roll;
    return { lags, roll, own: own.lags != null && String(own.lags).trim() !== '' || own.roll != null && String(own.roll).trim() !== '' };
  }
  function makeGetters(series, cfg, tgt, ins) {
    const { h, lags: _lags, roll: _roll, ar } = featureSpec(cfg);
    let names = [], getters = [];
    const tag = (k) => (k === 0 ? '[t]' : '[t-' + k + ']');
    for (const c of ins) {
      const a = series.cols[c]; if (!a) throw new Error('Column “' + c + '” is missing');
      const { lags, roll } = inputSpec(cfg, c);
      for (const k of lags) { names.push(c + tag(k)); getters.push((i) => (i - k >= 0 ? a[i - k] : NaN)); }
      if (roll.length) {
        const stat = cfg.rollStat === 'auto' ? (series.rainLike[c] ? 'sum' : 'mean') : cfg.rollStat;
        for (const w of roll) {
          names.push(c + ' ' + stat + w + tag(h));
          getters.push((i) => {
            const e = i - h, s = e - w + 1; if (s < 0) return NaN;
            let acc = stat === 'max' ? -Infinity : 0;
            for (let q = s; q <= e; q++) { const v = a[q]; if (!isFinite(v)) return NaN; if (stat === 'max') { if (v > acc) acc = v; } else acc += v; }
            return stat === 'mean' ? acc / w : acc;
          });
        }
      }
    }
    if (tgt && ar.length) { const a = series.cols[tgt]; if (a) for (const k of ar) { names.push(tgt + tag(k)); getters.push((i) => (i - k >= 0 ? a[i - k] : NaN)); } }
    if (cfg.doy) {
      names.push('season sin', 'season cos');
      const doy = (i) => { const d = new Date(series.t[i]); return (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY; };
      getters.push((i) => Math.sin((2 * Math.PI * doy(i)) / 365.25), (i) => Math.cos((2 * Math.PI * doy(i)) / 365.25));
    }
    if (cfg.month) { names.push('month sin', 'month cos'); getters.push((i) => Math.sin((2 * Math.PI * new Date(series.t[i]).getUTCMonth()) / 12), (i) => Math.cos((2 * Math.PI * new Date(series.t[i]).getUTCMonth()) / 12)); }
    if (cfg.trend) { const t0 = series.t[0]; names.push('trend (years)'); getters.push((i) => (series.t[i] - t0) / (365.25 * DAY)); }
    const allNames = names.slice();
    const ex = new Set(cfg.exclude || []);
    if (ex.size) { const keep = names.map((n) => !ex.has(n)); getters = getters.filter((_, j) => keep[j]); names = names.filter((_, j) => keep[j]); }
    if (!names.length) throw new Error('No features — pick at least one input, enable past target values, or switch some features back on');
    return { names, getters, allNames, spec: { h, lags: _lags, roll: _roll, ar } };
  }

  // ================================================================ split
  function makeSplit(feat, cfg, series) {
    const N = feat.X.length;
    let train = [], test = [];
    if (cfg.split === 'random') {
      const rng = HML.rng(+cfg.seed || 1), order = Array.from({ length: N }, (_, i) => i);
      for (let q = N - 1; q > 0; q--) { const r = Math.floor(rng() * (q + 1)); [order[q], order[r]] = [order[r], order[q]]; }
      const cut = Math.round((N * cfg.pct) / 100);
      train = order.slice(0, cut).sort((a, b) => a - b); test = order.slice(cut).sort((a, b) => a - b);
    } else {
      let cut = Math.round((N * cfg.pct) / 100);
      if (cfg.split === 'date' && cfg.splitDate) {
        const d = Date.parse(cfg.splitDate + 'T00:00:00Z');
        if (isFinite(d)) { cut = feat.idx.findIndex((i) => series.t[i] >= d); if (cut < 0) cut = N; }
      }
      for (let i = 0; i < N; i++) (i < cut ? train : test).push(i);
    }
    const valN = Math.floor(train.length * (+cfg.val || 0));
    return { train, test, valN };
  }

  // ================================================================ pipeline
  const sig = () => JSON.stringify([S.version, S.cfg.sheet, S.cfg.dateCol, S.cfg.timeCol, S.cfg.regularOnly, S.cfg.order, S.cfg.agg, S.cfg.gap, S.cfg.gapMax, S.cfg.ignore, S.cfg.roles, S.cfg.mode, S.cfg.horizon, S.cfg.lags, S.cfg.inputLags, S.cfg.exclude, S.cfg.roll, S.cfg.rollStat, S.cfg.ar, S.cfg.arLags, S.cfg.doy, S.cfg.month, S.cfg.trend, S.cfg.split, S.cfg.pct, S.cfg.splitDate, S.cfg.val, S.cfg.seed]);

  function rebuild() {
    S.series = null; S.feat = null; S.split = null;
    const notes = [];
    try {
      if (!S.table) return;
      if (!S.cfg.dateCol) throw new Error('No date column found — choose it above.');
      S.series = buildSeries(S.table, S.cfg);
      const tg = target(), ins = inputs();
      if (S.table.skippedTop) notes.push(['ok', 'The table starts on row ' + (S.table.headerRow + 1) + ' — ' + S.table.skippedTop + ' title / information row(s) above it were skipped.']);
      if (S.series.skippedType) notes.push(['ok', S.series.skippedType + ' HIGH / LOW rows were skipped (they repeat REGULAR readings). Untick “REGULAR rows only” to keep them.']);
      if (S.series.bad) notes.push(['warn', S.series.bad + ' rows had no readable date and were skipped (e.g. footer text).']);
      if (/^hours?$/.test(S.series.step) && S.cfg.agg === 'none') notes.push(['', 'Sub-daily data: for daily models choose Time step → Daily (aggregate).']);
      if (S.series.inserted) notes.push(['', S.series.inserted + ' missing time steps were added to make a regular ' + S.series.step + ' series.']);
      if (S.series.step === 'irregular') notes.push(['warn', 'Time steps are irregular — lags count rows, not time. Consider aggregating to daily or monthly.']);
      if (tg) {
        S.feat = buildFeatures(S.series, S.cfg, tg, ins);
        if (S.feat.X.length < 30) throw new Error('Only ' + S.feat.X.length + ' usable rows after building features. Fill gaps, use fewer lags, or choose other columns.');
        S.split = makeSplit(S.feat, S.cfg, S.series);
        if (S.split.train.length < 20 || S.split.test.length < 5) throw new Error('The split leaves too few rows for training or testing.');
      } else notes.push(['warn', 'Choose a target column (the variable to predict).']);
    } catch (e) { notes.push(['err', e.message]); S.feat = null; S.split = null; }
    S.notes = notes;
    renderAll();
  }

  // ================================================================ rendering
  function renderAll() {
    renderSteps();
    renderData();
    renderFeatures();
    renderTrain();
    renderResults();
    renderPredict();
  }
  const visible = (pane) => document.documentElement.getAttribute('data-tool-tab') === pane;

  function renderSteps() {
    const s = [], tg = target();
    if (S.series) s.push('<span class="ok">Data <b>' + esc(S.file.name) + '</b> · ' + S.series.t.length + ' steps</span>');
    else s.push('<span>Data: not loaded</span>');
    if (tg) s.push('<span class="' + (S.feat ? 'ok' : '') + '">Target <b>' + esc(tg) + '</b> · ' + inputs().length + ' inputs</span>');
    if (S.feat) s.push('<span class="ok">Features <b>' + S.feat.names.length + '</b> · ' + S.feat.X.length + ' rows</span>');
    const runs = Object.values(S.runs).filter((r) => r.m);
    if (runs.length) { const b = bestRun('test'); s.push('<span class="ok">Models <b>' + runs.length + '</b>' + (b ? ' · best ' + esc(CAT[b.type].short) + ' NSE ' + fmt(b.m.test.nse) : '') + '</span>'); }
    $('steps').innerHTML = s.join('');
    const done = { data: !!S.series, features: !!S.feat, train: runs.length > 0, results: runs.length > 0 };
    $$('.ts-tab').forEach((a) => a.classList.toggle('done', !!done[a.dataset.tab] && a.getAttribute('aria-selected') !== 'true'));
    $$('[data-need="target"]').forEach((e) => { e.hidden = !!S.feat; });
    $$('[data-show="target"]').forEach((e) => { e.hidden = !S.feat; });
    $$('[data-need="runs"]').forEach((e) => { e.hidden = runs.length > 0; });
    $$('[data-show="runs"]').forEach((e) => { e.hidden = !runs.length; });
  }

  // ---------------------------------------------------------------- 1 data
  function renderData() {
    const has = !!S.table;
    $('dWelcome').hidden = has; $('dBody').hidden = !has;
    if (!has) return;
    $('dName').textContent = S.file.name;
    $('dBadge').hidden = !S.file.example;
    const sh = $('dSheet');
    $('dSheetWrap').hidden = S.file.sheets.length < 2;
    sh.innerHTML = S.file.sheets.map((s, i) => '<option value="' + i + '"' + (i === S.cfg.sheet ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
    $('dDate').innerHTML = '<option value="">— choose —</option>' + S.table.header.map((h) => '<option' + (h === S.cfg.dateCol ? ' selected' : '') + '>' + esc(h) + '</option>').join('');
    $('dTime').innerHTML = '<option value="">— none —</option>' + S.table.header.filter((h) => h !== S.cfg.dateCol).map((h) => '<option' + (h === S.cfg.timeCol ? ' selected' : '') + '>' + esc(h) + '</option>').join('');
    $('dRegWrap').hidden = !S.table.typeCol; $('dReg').checked = !!S.cfg.regularOnly;
    $('dOrder').value = S.cfg.order; $('dAgg').value = S.cfg.agg; $('dGap').value = S.cfg.gap; $('dGapMax').value = S.cfg.gapMax; $('dIgnore').value = S.cfg.ignore;
    $('dGapMaxWrap').hidden = S.cfg.gap === 'none';
    const sr = S.series;
    $('dFacts').innerHTML = sr ? [['period', fmtD(sr.t[0]) + ' to ' + fmtD(sr.t[sr.t.length - 1])], ['steps', sr.t.length], ['time step', sr.step + (S.cfg.agg !== 'none' ? ' (aggregated)' : '')], ['rows in file', S.table.rows.length], ['columns', S.table.header.length]]
      .map(([k, v]) => '<span><i>' + k + '</i>' + esc(v) + '</span>').join('') : '';
    $('dNotes').innerHTML = (S.notes || []).map(([k, t]) => '<span class="' + k + '">' + esc(t) + '</span>').join('');
    // columns table
    const rows = S.table.header.map((h, j) => {
      const isNum = S.table.numeric[j] && h !== S.cfg.dateCol;
      const role = h === S.cfg.dateCol ? 'date' : isNum ? S.cfg.roles[h] || 'ignore' : 'ignore';
      let stats = '<td colspan="7" class="muted">' + (h === S.cfg.dateCol ? 'date / time' : 'not numeric') + '</td>';
      if (isNum && sr && sr.cols[h]) {
        const raw = sr.raw[h], a = Array.from(raw).filter(isFinite), miss = raw.length - a.length;
        const mean = a.reduce((x, v) => x + v, 0) / (a.length || 1), sd = Math.sqrt(a.reduce((x, v) => x + (v - mean) ** 2, 0) / Math.max(1, a.length - 1));
        stats = '<td>' + a.length + '</td><td>' + (raw.length ? ((100 * miss) / raw.length).toFixed(1) : 0) + '%</td><td>' + (sr.filled[h] || 0) + '</td><td>' + fmt(Math.min(...a)) + '</td><td>' + fmt(Math.max(...a)) + '</td><td>' + fmt(mean) + '</td><td>' + fmt(sd) + '</td>';
      }
      const sel = h === S.cfg.dateCol ? '<span class="muted">date</span>' : isNum ? '<select data-role="' + esc(h) + '"><option value="target"' + (role === 'target' ? ' selected' : '') + '>Target</option><option value="input"' + (role === 'input' ? ' selected' : '') + '>Input</option><option value="ignore"' + (role === 'ignore' ? ' selected' : '') + '>Ignore</option></select>' : '<span class="muted">—</span>';
      return '<tr class="' + (role === 'ignore' ? 'ignored' : '') + '"><td class="role-' + role + '">' + esc(h) + '</td><td>' + sel + '</td>' + stats + '</tr>';
    });
    $('dCols').innerHTML = '<thead><tr><th>Column</th><th>Role</th><th>Values</th><th>Missing</th><th>Filled</th><th>Min</th><th>Max</th><th>Mean</th><th>Std</th></tr></thead><tbody>' + rows.join('') + '</tbody>';
    const plotCols = sr ? sr.names : [];
    const pc = $('dPlotCol'), cur = pc.value && plotCols.includes(pc.value) ? pc.value : target() || plotCols[0];
    pc.innerHTML = plotCols.map((c) => '<option' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
    if (visible('data')) drawDataChart();
  }
  function drawDataChart() {
    const sr = S.series, c = $('dPlotCol').value;
    if (!sr || !c) { $('dChart').innerHTML = ''; return; }
    const filledMask = Array.from(sr.cols[c], (v, i) => (isFinite(v) && !isFinite(sr.raw[c][i]) ? v : NaN));
    HC.line($('dChart'), {
      height: 280, domain: S.dzoom, onZoom: (d) => { S.dzoom = d; drawDataChart(); },
      series: [{ name: c, x: sr.t, y: Array.from(sr.raw[c]), color: c === target() ? css('--hi') : css('--accent'), width: 1.3 },
        { name: 'filled gaps', x: sr.t, y: filledMask, color: css('--warn'), width: 2.2 }],
    });
  }

  // ---------------------------------------------------------------- 2 features
  function renderFeatures() {
    const c = S.cfg;
    $('fMode').value = c.mode; $('fH').value = c.horizon; $('fHWrap').hidden = c.mode !== 'fc';
    $('fLags').value = c.lags; $('fRoll').value = c.roll; $('fRollStat').value = c.rollStat;
    $('fAr').checked = c.ar; $('fArLags').value = c.arLags; $('fArWrap').hidden = !c.ar;
    $('fDoy').checked = c.doy; $('fMonth').checked = c.month; $('fTrend').checked = c.trend;
    if (!S.feat) return;
    const f = S.feat, sp = f.spec, unit = stepLabel(S.series.step);
    $('fHelp').innerHTML = c.mode === 'fc'
      ? 'Forecasting <b>' + sp.h + ' ' + unit + ' ahead</b>: only values at least ' + sp.h + ' ' + unit + ' old are used. Input lags used: <b>' + sp.lags.join(', ') + '</b>' + (sp.ar.length ? '; target lags: <b>' + sp.ar.join(', ') + '</b>' : '') + '. Lags below the horizon are dropped automatically.'
      : 'Simulation: the target at time t is estimated from inputs at t and earlier' + (sp.ar.length ? ', plus past target values (' + sp.ar.join(', ') + ' ' + unit + ' back)' : '') + '. Turn off past target values to build a pure input–output model.';
    const tr = S.split.train;
    $('fKpis').innerHTML = [
      ['Features', f.names.length, '', 'acc'],
      ['Usable rows', f.X.length, f.dropped + ' dropped (lags / missing)', ''],
      ['Training rows', tr.length, fmtD(S.series.t[f.idx[tr[0]]]) + ' → ' + fmtD(S.series.t[f.idx[tr[tr.length - 1]]]), ''],
      ['Test rows', S.split.test.length, S.split.test.length ? fmtD(S.series.t[f.idx[S.split.test[0]]]) + ' → ' + fmtD(S.series.t[f.idx[S.split.test[S.split.test.length - 1]]]) : '', ''],
    ].map(([l, v, s, k]) => '<div class="kpi ' + k + '"><span class="l">' + l + '</span><span class="v">' + v + '</span><span class="s">' + esc(s) + '</span></div>').join('');
    const tg = target(), ex = new Set(c.exclude || []);
    $('fList').innerHTML = (f.allNames || f.names).map((nm) => '<button type="button" class="chip' + (nm.startsWith(tg + '[') ? ' t' : /^(season|month|trend)/.test(nm) ? ' s' : '') + (ex.has(nm) ? ' off' : '') + '" data-feat="' + esc(nm) + '" title="' + (ex.has(nm) ? 'Switched off — click to use it' : 'Click to switch off') + '">' + esc(nm) + '</button>').join('');
    $('fCount').textContent = f.names.length + ' features' + (ex.size ? ' (' + ex.size + ' switched off)' : '');
    // per-input lag table
    const ins = inputs(), sp2 = featureSpec(c);
    $('fInLags').innerHTML = '<thead><tr><th>Series</th><th>Lags</th><th>Rolling windows</th><th>Used now</th><th></th></tr></thead><tbody>' +
      ins.map((col) => {
        const own = (c.inputLags || {})[col] || {}, is = inputSpec(c, col);
        return '<tr class="' + (is.own ? 'own' : '') + '"><td>' + esc(col) + '</td><td><input type="text" data-il="' + esc(col) + '" data-f="lags" value="' + esc(own.lags || '') + '" placeholder="' + esc(sp2.lags.join(',')) + '" /></td>' +
          '<td><input type="text" data-il="' + esc(col) + '" data-f="roll" value="' + esc(own.roll || '') + '" placeholder="' + esc(sp2.roll.join(',') || '-') + '" /></td>' +
          '<td class="muted">lags ' + (is.lags.join(', ') || 'none') + (is.roll.length ? ' · roll ' + is.roll.join(', ') : '') + '</td><td><button class="btn small" type="button" data-suggest="' + esc(col) + '">Suggest</button></td></tr>';
      }).join('') +
      (c.ar ? '<tr><td class="c-target">' + esc(tg) + ' <span class="muted small">(past target)</span></td><td><input type="text" id="fArLags2" value="' + esc(c.arLags) + '" /></td><td class="muted">—</td><td class="muted">lags ' + (sp2.ar.join(', ') || 'none') + '</td><td><button class="btn small" type="button" data-suggest="' + esc(tg) + '">Suggest</button></td></tr>' : '') + '</tbody>';
    const lc = $('fLagCol'), cur = lc.value && [...ins, tg].includes(lc.value) ? lc.value : ins[0] || tg;
    lc.innerHTML = [...ins, tg].map((col) => '<option' + (col === cur ? ' selected' : '') + '>' + esc(col) + '</option>').join('');
    if (visible('features')) drawFeatureCharts();
  }

  // ---- lag analysis: cross-correlation for inputs, partial autocorrelation for the target
  function trainEnd() {
    if (S.feat && S.split && S.split.train.length) return S.feat.idx[S.split.train[S.split.train.length - 1]];
    return Math.floor(S.series.t.length * 0.7);
  }
  function ccf(x, y, maxLag, end) {
    const out = [];
    for (let k = 0; k <= maxLag; k++) {
      const a = [], b = [];
      for (let i = k; i <= end; i++) { const u = x[i - k], v = y[i]; if (isFinite(u) && isFinite(v)) { a.push(u); b.push(v); } }
      out.push(a.length > 10 ? pearson(a, b) : NaN);
    }
    return out;
  }
  function pacf(y, maxLag, end) {
    const acf = ccf(y, y, maxLag, end), p = [1], phi = [[]];
    for (let k = 1; k <= maxLag; k++) {
      let num = acf[k], den = 1;
      for (let j = 1; j < k; j++) { num -= phi[k - 1][j] * acf[k - j]; den -= phi[k - 1][j] * acf[j]; }
      const pk = den !== 0 ? num / den : 0;
      phi[k] = [];
      for (let j = 1; j < k; j++) phi[k][j] = phi[k - 1][j] - pk * phi[k - 1][k - j];
      phi[k][k] = pk; p.push(pk);
    }
    return p;
  }
  function lagInfo(col) {
    const sr = S.series, tg = target(), end = trainEnd(), maxLag = Math.min(+$('fLagMax').value || 30, Math.floor(end / 4));
    const h = featureSpec(S.cfg).h, n = end + 1, sig = 1.96 / Math.sqrt(n);
    if (col === tg) {
      const p = pacf(sr.cols[tg], maxLag, end), minK = Math.max(1, h);
      let pick = []; for (let k = minK; k <= maxLag && pick.length < 4; k++) if (Math.abs(p[k]) > sig) pick.push(k);
      if (!pick.length) pick = [minK];
      if (!pick.includes(minK)) pick.unshift(minK);
      return { kind: 'pacf', r: p, pick: [...new Set(pick)].slice(0, 4).sort((a, b) => a - b), sig, h: minK };
    }
    const r = ccf(sr.cols[col], sr.cols[tg], maxLag, end);
    const ok = (k) => k >= h && isFinite(r[k]);
    const peaks = [];
    for (let k = h; k <= maxLag; k++) if (ok(k) && (k === h || Math.abs(r[k]) >= Math.abs(r[k - 1] || 0)) && (k === maxLag || Math.abs(r[k]) >= Math.abs(r[k + 1] || 0))) peaks.push(k);
    peaks.sort((a, b) => Math.abs(r[b]) - Math.abs(r[a]));
    const pick = [...new Set([h, ...peaks.slice(0, 3), ...(peaks.length < 2 ? [h + 1, h + 2] : [])])].filter((k) => k <= maxLag).slice(0, 4).sort((a, b) => a - b);
    return { kind: 'ccf', r, pick, sig, h };
  }
  function drawLagChart() {
    if (!S.series) return;
    const col = $('fLagCol').value; if (!col) return;
    const L = lagInfo(col), tg = target();
    const labels = L.r.map((_, k) => String(k)), vals = L.r.map((v, k) => (L.kind === 'pacf' && k === 0 ? NaN : v));
    HC.columns($('fLagChart'), { labels, values: vals, height: 200, yLabel: L.kind === 'pacf' ? 'partial autocorrelation of ' + tg : 'correlation of ' + col + '[t−lag] with ' + tg + '[t]', color: (v) => css('--accent') });
    // highlight suggested lags
    const svg = $('fLagChart').querySelector('svg');
    if (svg) svg.querySelectorAll('rect').forEach((r) => { const t = r.querySelector('title'); if (!t) return; const k = +t.textContent.split(':')[0]; r.setAttribute('fill', L.pick.includes(k) ? css('--ok') : css('--accent')); r.setAttribute('opacity', L.pick.includes(k) ? '1' : (k < L.h ? '.25' : '.6')); });
    $('fLagNote').textContent = 'significance ±' + L.sig.toFixed(3);
    $('fLagCap').innerHTML = (L.kind === 'pacf'
      ? 'Partial autocorrelation: how much the target at lag k still explains today once the shorter lags are known. Bars beyond ±' + L.sig.toFixed(3) + ' are significant.'
      : 'Cross-correlation between ' + esc(col) + ' k steps earlier and ' + esc(tg) + '. Peaks show the travel / response time.') +
      ' <b>Suggested lags: ' + L.pick.join(', ') + '</b> (green)' + (L.h ? '; lags below ' + L.h + ' are not allowed for this forecast horizon (faded).' : '.') + ' Training period only.';
  }
  function suggestLags(cols) {
    const tg = target();
    S.cfg.inputLags = Object.assign({}, S.cfg.inputLags);
    for (const col of cols) {
      const L = lagInfo(col);
      if (col === tg) { S.cfg.arLags = L.pick.join(','); S.cfg.ar = true; }
      else S.cfg.inputLags[col] = Object.assign({}, S.cfg.inputLags[col], { lags: L.pick.join(',') });
    }
    S.version++; rebuild();
    msg('Suggested lags applied: ' + cols.map((col) => col + ' → ' + (col === tg ? S.cfg.arLags : S.cfg.inputLags[col].lags)).join('; ') + '. Edit them freely.', 'ok');
  }
  const pearson = (a, b) => {
    const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
  };
  function drawFeatureCharts() {
    const f = S.feat; if (!f) return;
    drawLagChart();
    const tr = S.split.train, y = tr.map((i) => f.y[i]);
    const cors = f.names.map((nm, j) => [nm, pearson(tr.map((i) => f.X[i][j]), y)]).filter((c) => isFinite(c[1])).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 20);
    HC.bars($('fCorr'), { labels: cors.map((c) => c[0]), values: cors.map((c) => c[1]), color: (v) => (v >= 0 ? css('--accent') : css('--hi')), fmt: (v) => v.toFixed(2) });
    const cols = [target(), ...inputs()].filter(Boolean).slice(0, 14), sr = S.series;
    const ok = sr.t.map((_, i) => cols.every((c) => isFinite(sr.cols[c][i])));
    const vecs = cols.map((c) => Array.from(sr.cols[c]).filter((_, i) => ok[i]));
    HC.heatmap($('fHeat'), { labels: cols, matrix: cols.map((_, a) => cols.map((_, b) => pearson(vecs[a], vecs[b]))) });
  }

  // ---------------------------------------------------------------- 3 train
  function renderTrain() {
    const c = S.cfg;
    $('tSplit').value = c.split; $('tPct').value = c.pct; $('tPctV').textContent = c.pct + '%'; $('tDate').value = c.splitDate; $('tVal').value = String(c.val); $('tSeed').value = c.seed;
    $('tPctWrap').hidden = c.split === 'date'; $('tDateWrap').hidden = c.split !== 'date';
    $('tFolds').value = c.folds; $('tCvType').value = c.cvType;
    renderModels();
    renderTuneCard();
    if (!S.feat) return;
    const sp = S.split, f = S.feat, t = (i) => S.series.t[f.idx[i]];
    $('tSplitNote').innerHTML = c.split === 'random'
      ? '<b>Random split</b> mixes past and future: neighbouring days share information, so scores look better than real forecasting skill. Prefer a chronological split.'
      : 'Training: <b>' + sp.train.length + '</b> rows (' + fmtD(t(sp.train[0])) + ' → ' + fmtD(t(sp.train[sp.train.length - 1])) + ')' + (sp.valN ? ', of which the last ' + sp.valN + ' are used for early stopping' : '') + ' · Test: <b>' + sp.test.length + '</b> rows (' + fmtD(t(sp.test[0])) + ' → ' + fmtD(t(sp.test[sp.test.length - 1])) + ').';
    if (visible('train')) drawSplitChart();
    renderCvTable();
  }
  function drawSplitChart() {
    const f = S.feat; if (!f) return;
    const tg = target(), sr = S.series, sp = S.split;
    const t0 = sr.t[f.idx[sp.train[0]]], t1 = sr.t[f.idx[sp.train[sp.train.length - 1]]];
    const shade = S.cfg.split === 'random' ? [] : [{ from: t0, to: t1, label: 'training', color: css('--accent'), opacity: 0.1 }];
    if (sp.valN && S.cfg.split !== 'random') shade.push({ from: sr.t[f.idx[sp.train[sp.train.length - sp.valN]]], to: t1, label: 'validation', color: css('--gen'), opacity: 0.16 });
    if (S.cfg.split !== 'random') shade.push({ from: sr.t[f.idx[sp.test[0]]], to: sr.t[f.idx[sp.test[sp.test.length - 1]]], label: 'test', color: css('--hi'), opacity: 0.08 });
    HC.line($('tSplitChart'), { height: 150, zoom: false, legend: false, shade, series: [{ name: tg, x: sr.t, y: Array.from(sr.raw[tg]), color: css('--fg'), width: 1 }] });
  }

  function paramInput(type, p, val) {
    const id = 'mp-' + type + '-' + p.key;
    if (p.type === 'select') return '<label class="field">' + esc(p.label) + '<select id="' + id + '" data-mt="' + type + '" data-mp="' + p.key + '">' + p.options.map((o) => '<option' + (o === val ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label>';
    if (p.type === 'check') return '<label class="check"><input type="checkbox" id="' + id + '" data-mt="' + type + '" data-mp="' + p.key + '"' + (val ? ' checked' : '') + ' /> ' + esc(p.label) + '</label>';
    if (p.type === 'text') return '<label class="field">' + esc(p.label) + '<input type="text" id="' + id + '" data-mt="' + type + '" data-mp="' + p.key + '" value="' + esc(val) + '" /></label>';
    return '<label class="field">' + esc(p.label) + '<input type="number" id="' + id + '" data-mt="' + type + '" data-mp="' + p.key + '" value="' + val + '"' + (p.min != null ? ' min="' + p.min + '"' : '') + (p.max != null ? ' max="' + p.max + '"' : '') + (p.step ? ' step="' + p.step + '"' : '') + ' /></label>';
  }
  function renderModels() {
    const box = $('tModels'), open = new Set($$('details.model[open]', box).map((d) => d.dataset.type));
    box.innerHTML = ORDER.map((type) => {
      const m = CAT[type], on = !!S.cfg.on[type], run = S.runs[type];
      const status = run && run.m ? 'NSE ' + fmt(run.m.test.nse) : m.baseline ? 'baseline' : '⚙ settings';
      return '<details class="model' + (on ? ' on' : '') + '" data-type="' + type + '" style="--mc:' + colorOf(type) + '"' + (open.has(type) ? ' open' : '') + '><summary>' +
        '<input type="checkbox" data-on="' + type + '"' + (on ? ' checked' : '') + ' aria-label="Train ' + esc(m.name) + '" />' +
        '<span><b>' + esc(m.name) + '</b>' + ib('model-' + type, m.name) + ' <span class="muted small">' + esc(m.short) + '</span><small>' + esc(m.desc) + '</small></span><span class="cog">' + status + '</span></summary>' +
        (m.params.length ? '<div class="mp">' + m.params.map((p) => paramInput(type, p, S.cfg.params[type][p.key])).join('') +
          (CAT[type].space ? '<p class="tip"><a href="#tuneCard" data-tune="' + type + '">Tune ' + esc(m.short) + ' automatically ↓</a></p>' : '') + '</div>' : '<div class="mp"><p class="tip">No settings — used as a reference score.</p></div>') +
        '</details>';
    }).join('');
  }

  // ---------------------------------------------------------------- tuning UI
  const tunable = () => ORDER.filter((t) => CAT[t].space);
  function spaceFor(type) {
    const saved = S.cfg.tune.space[type];
    return CAT[type].space.map((s) => Object.assign({}, s, saved && saved[s.name] ? saved[s.name] : {}));
  }
  function renderTuneCard() {
    const u = S.cfg.tune;
    $('uModel').innerHTML = tunable().map((t) => '<option value="' + t + '"' + (t === u.model ? ' selected' : '') + '>' + esc(CAT[t].name) + '</option>').join('');
    $('uMethod').value = u.method; $('uIter').value = u.nIter; $('uFolds').value = u.folds; $('uCvType').value = u.cvType; $('uMetric').value = u.metric;
    $('uIterWrap').hidden = u.method === 'grid';
    const sp = spaceFor(u.model), grid = u.method === 'grid';
    $('uSpace').innerHTML = '<thead><tr><th>Setting</th><th>Type</th>' + (grid ? '<th>Values to try (grid)</th>' : '<th>From</th><th>To</th><th>Scale</th>') + '</tr></thead><tbody>' +
      sp.map((s) => {
        const label = (CAT[u.model].params.find((p) => p.key === s.name) || {}).label || s.name;
        if (s.kind === 'choice') return '<tr><td>' + esc(label) + '</td><td class="dimc">choice</td><td colspan="' + (grid ? 1 : 3) + '"><input type="text" class="grid" data-sp="' + s.name + '" data-f="values" value="' + esc(s.values.join(', ')) + '" /></td></tr>';
        if (grid) return '<tr><td>' + esc(label) + '</td><td class="dimc">' + s.kind + '</td><td><input type="text" class="grid" data-sp="' + s.name + '" data-f="grid" value="' + esc(s.grid || s.min + ', ' + s.max) + '" /></td></tr>';
        return '<tr><td>' + esc(label) + '</td><td class="dimc">' + s.kind + '</td><td><input type="number" data-sp="' + s.name + '" data-f="min" value="' + s.min + '" step="any" /></td><td><input type="number" data-sp="' + s.name + '" data-f="max" value="' + s.max + '" step="any" /></td><td><select data-sp="' + s.name + '" data-f="log"><option value="0"' + (!s.log ? ' selected' : '') + '>linear</option><option value="1"' + (s.log ? ' selected' : '') + '>log</option></select></td></tr>';
      }).join('') + '</tbody>';
    const n = gridCount();
    const folds = +u.folds;
    $('uHelp').innerHTML = u.method === 'grid' ? 'Grid search tries every combination: <b>' + n + '</b> combinations × ' + folds + ' folds = <b>' + n * folds + '</b> model fits.' + (n > 300 ? ' Only the first 300 are tried.' : '')
      : u.method === 'random' ? 'Random search samples <b>' + u.nIter + '</b> settings from the ranges (× ' + folds + ' folds).'
        : 'Bayesian optimisation starts with a few random settings, then a Gaussian-process model of the score chooses the most promising next setting (expected improvement). <b>' + u.nIter + '</b> trials × ' + folds + ' folds.';
    renderTuning();
  }
  function gridCount() {
    const sp = spaceFor(S.cfg.tune.model);
    return sp.reduce((a, s) => a * Math.max(1, (s.kind === 'choice' ? s.values : String(s.grid || '').split(/[,\s]+/).filter(Boolean)).length), 1);
  }
  function readSpaceForRun() {
    const type = S.cfg.tune.model, grid = S.cfg.tune.method === 'grid';
    return spaceFor(type).map((s) => {
      if (s.kind === 'choice') return { name: s.name, kind: 'choice', values: s.values };
      if (grid) {
        const vals = String(s.grid || '').split(/[,\s]+/).filter(Boolean).map(Number).filter(isFinite).map((v) => (s.kind === 'int' ? Math.round(v) : v));
        return { name: s.name, kind: s.kind, values: vals.length ? vals : [s.min, s.max] };
      }
      let lo = +s.min, hi = +s.max; if (lo > hi) [lo, hi] = [hi, lo];
      return { name: s.name, kind: s.kind, min: lo, max: hi, log: !!s.log && lo > 0 };
    });
  }
  function renderTuning() {
    const T = S.tuning;
    $('uOut').hidden = !T || !T.trials.length;
    $('uApply').hidden = !T || !T.best || T.running;
    $('uRun').hidden = T && T.running; $('uStop').hidden = !(T && T.running);
    if (!T) { $('uStatus').textContent = ''; return; }
    const better = T.metric === 'rmse' ? -1 : 1;
    $('uStatus').innerHTML = (T.running ? 'Running… ' : 'Done. ') + T.trials.length + (T.total ? ' / ' + T.total : '') + ' trials' + (T.best ? ' · best ' + T.metric.toUpperCase() + ' <b>' + fmt(T.best.mean) + '</b>' : '');
    const sorted = [...T.trials].sort((a, b) => better * (b.mean - a.mean));
    const keys = Object.keys(T.trials[0] ? T.trials[0].params : {});
    $('uTrials').innerHTML = '<thead><tr><th>#</th>' + keys.map((k) => '<th>' + esc(k) + '</th>').join('') + '<th>' + T.metric.toUpperCase() + ' (CV mean)</th><th>± sd</th><th>how</th></tr></thead><tbody>' +
      sorted.slice(0, 60).map((t) => '<tr' + (T.best && t.i === T.best.i ? ' class="focus"' : '') + '><td>' + t.i + '</td>' + keys.map((k) => '<td>' + esc(typeof t.params[k] === 'number' ? fmt(t.params[k]) : t.params[k]) + '</td>').join('') + '<td>' + fmt(t.mean) + '</td><td>' + fmt(t.sd) + '</td><td class="muted">' + esc(t.how) + '</td></tr>').join('') + '</tbody>';
    if (visible('train') && T.trials.length) {
      let best = -Infinity * better;
      const bestLine = T.trials.map((t) => { if (better * t.mean > better * best) best = t.mean; return best; });
      HC.line($('uChart'), {
        xTime: false, height: 240, zoom: false, yLabel: 'CV ' + T.metric.toUpperCase() + ' by trial',
        series: [{ name: 'trial', x: T.trials.map((t) => t.i), y: T.trials.map((t) => t.mean), color: css('--gen'), dots: true, r: 3 },
          { name: 'best so far', x: T.trials.map((t) => t.i), y: bestLine, color: css('--ok'), width: 2 }],
      });
    }
  }

  // ---------------------------------------------------------------- training
  const trainPayload = (type) => {
    const f = S.feat, sp = S.split;
    const X = sp.train.map((i) => f.X[i]), y = sp.train.map((i) => f.y[i]);
    const vN = sp.valN;
    return { X, y, val: vN > 5 ? { X: X.slice(-vN), y: y.slice(-vN) } : null, Xall: f.X, params: S.cfg.params[type], seed: +S.cfg.seed || 1 };
  };
  // Everything needed to rebuild a model's features on other data (stored with the model and in saved model files)
  const SPEC_KEYS = ['dateCol', 'timeCol', 'regularOnly', 'order', 'agg', 'gap', 'gapMax', 'ignore', 'mode', 'horizon', 'lags', 'inputLags', 'exclude', 'roll', 'rollStat', 'ar', 'arLags', 'doy', 'month', 'trend'];
  const specNow = () => ({ cfg: JSON.parse(JSON.stringify(Object.fromEntries(SPEC_KEYS.map((k) => [k, S.cfg[k]])))), names: S.feat.names.slice(), target: target(), inputs: inputs(), step: S.series.step });
  function metricsFor(pred) {
    const f = S.feat, sp = S.split, set = (ix) => { const o = [], p = []; for (const i of ix) if (isFinite(pred[i])) { o.push(f.y[i]); p.push(pred[i]); } return o.length ? HML.metrics(o, p) : null; };
    return { train: set(sp.train), test: set(sp.test), all: set(f.y.map((_, i) => i)) };
  }
  function baselinePred(type) {
    const f = S.feat, sr = S.series, tg = target(), y = sr.cols[tg];
    if (type === 'persist') { const k = Math.max(1, f.h); return f.idx.map((i) => (i - k >= 0 ? y[i - k] : NaN)); }
    const sum = new Array(12).fill(0), cnt = new Array(12).fill(0);
    for (const r of S.split.train) { const mo = new Date(sr.t[f.idx[r]]).getUTCMonth(); sum[mo] += f.y[r]; cnt[mo]++; }
    const all = S.split.train.reduce((a, r) => a + f.y[r], 0) / S.split.train.length;
    return f.idx.map((i) => { const mo = new Date(sr.t[i]).getUTCMonth(); return cnt[mo] ? sum[mo] / cnt[mo] : all; });
  }

  async function trainSelected(types) {
    if (!S.feat || S.busy) return;
    types = (types || ORDER.filter((t) => S.cfg.on[t]));
    if (!types.length) { msg('Tick at least one model.', 'warn'); return; }
    S.busy = true; setBusy(true);
    const prog = $('tProg');
    prog.innerHTML = types.map((t) => '<div class="pr" id="pr-' + t + '" style="--mc:' + colorOf(t) + '"><span>' + esc(CAT[t].name) + '</span><span class="bar2"><i></i></span><span class="st">waiting</span></div>').join('');
    const setP = (t, f, txt, cls) => { const r = $('pr-' + t); if (!r) return; r.querySelector('i').style.width = Math.round(f * 100) + '%'; r.querySelector('.st').textContent = txt; if (cls) r.classList.add(cls); };
    const signature = sig();
    let failures = 0;
    for (const type of types) {
      try {
        const t0 = performance.now();
        let res;
        if (CAT[type].baseline) res = { pred: baselinePred(type), imp: null, curve: null, ms: performance.now() - t0 };
        else {
          setP(type, 0, 'training…');
          const pl = trainPayload(type);
          res = await WM.send(Object.assign({ cmd: 'train', type, model: type }, pl), { onProgress: (f, ph) => setP(type, f, ph === 'predict' ? 'predicting…' : 'training ' + Math.round(f * 100) + '%') });
        }
        const pred = Float64Array.from(res.pred);
        S.runs[type] = { type, pred, m: metricsFor(pred), imp: res.imp, curve: res.curve, bestIter: res.bestIter, oob: res.oob, info: res.info || null, ms: res.ms, params: Object.assign({}, S.cfg.params[type]), sig: signature, alive: !CAT[type].baseline, perm: null, spec: CAT[type].baseline ? null : specNow(), nTrain: S.split.train.length, trainedAt: new Date().toISOString() };
        setP(type, 1, 'NSE ' + fmt(S.runs[type].m.test ? S.runs[type].m.test.nse : NaN) + ' · ' + (res.ms / 1000).toFixed(1) + ' s', 'done');
        renderSteps();
      } catch (e) {
        failures++;
        setP(type, 1, e.message === 'Stopped' ? 'stopped' : 'error', 'err');
        if (e.message === 'Stopped') break;
        msg(CAT[type].name + ': ' + e.message, 'err');
      }
    }
    S.busy = false; setBusy(false);
    const b = bestRun('test');
    if (!S.focus || !S.runs[S.focus]) S.focus = b ? b.type : null;
    renderAll();
    if (Object.keys(S.runs).length && !failures) {
      msg('Training finished. Best on the test period: ' + (b ? CAT[b.type].name + ' (NSE ' + fmt(b.m.test.nse) + ')' : '—') + '.', 'ok');
      location.hash = '#results';
    }
  }
  function setBusy(on) {
    $('tTrain').disabled = on; $('tCv').disabled = on; $('uRun').disabled = on;
    $('tCancel').hidden = !on;
  }

  async function crossValidate() {
    if (!S.feat || S.busy) return;
    const types = ORDER.filter((t) => S.cfg.on[t] && !CAT[t].baseline);
    if (!types.length) { msg('Tick at least one (non-baseline) model to cross-validate.', 'warn'); return; }
    S.busy = true; setBusy(true);
    const f = S.feat, sp = S.split, X = sp.train.map((i) => f.X[i]), y = sp.train.map((i) => f.y[i]);
    const prog = $('tProg');
    prog.innerHTML = types.map((t) => '<div class="pr" id="pr-' + t + '" style="--mc:' + colorOf(t) + '"><span>CV · ' + esc(CAT[t].name) + '</span><span class="bar2"><i></i></span><span class="st">waiting</span></div>').join('');
    for (const type of types) {
      const r = $('pr-' + type);
      try {
        const res = await WM.send({ cmd: 'cv', type, X, y, params: S.cfg.params[type], folds: +S.cfg.folds, cvType: S.cfg.cvType, seed: +S.cfg.seed }, { onProgress: (fr) => { r.querySelector('i').style.width = Math.round(fr * 100) + '%'; r.querySelector('.st').textContent = 'fold ' + Math.round(fr * S.cfg.folds) + '/' + S.cfg.folds; } });
        S.cv[type] = { folds: res.folds, folds_n: +S.cfg.folds, scheme: S.cfg.cvType, params: Object.assign({}, S.cfg.params[type]) };
        const nse = res.folds.map((x) => x.nse);
        r.classList.add('done'); r.querySelector('i').style.width = '100%';
        r.querySelector('.st').textContent = 'NSE ' + fmt(avg(nse)) + ' ± ' + fmt(sd(nse));
      } catch (e) { r.classList.add('err'); r.querySelector('.st').textContent = e.message === 'Stopped' ? 'stopped' : 'error'; if (e.message === 'Stopped') break; msg(e.message, 'err'); }
    }
    S.busy = false; setBusy(false);
    renderCvTable();
    msg('Cross-validation finished (' + S.cfg.folds + ' folds, ' + (S.cfg.cvType === 'blocked' ? 'blocked k-fold' : 'time-series expanding window') + ', training period only). This only scores the models — click “Train selected models” to fit them and see them in Results.', 'ok');
  }
  const avg = (a) => a.reduce((x, v) => x + v, 0) / (a.length || 1);
  const sd = (a) => { const m = avg(a); return Math.sqrt(a.reduce((x, v) => x + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
  function renderCvTable() {
    const types = Object.keys(S.cv);
    $('tCvWrap').hidden = !types.length;
    if (!types.length) return;
    $('tCvTbl').innerHTML = '<thead><tr><th>Cross-validation</th><th>Folds</th><th>NSE mean ± sd</th><th>KGE mean ± sd</th><th>RMSE mean ± sd</th><th>Per fold NSE</th></tr></thead><tbody>' +
      types.map((t) => {
        const F = S.cv[t].folds, g = (k) => F.map((x) => x[k]);
        return '<tr><td><span class="lbsw" style="color:' + colorOf(t) + '">■</span> ' + esc(CAT[t].name) + '</td><td>' + F.length + ' · ' + (S.cv[t].scheme === 'blocked' ? 'blocked' : 'time-series') + '</td><td>' + fmt(avg(g('nse'))) + ' ± ' + fmt(sd(g('nse'))) + '</td><td>' + fmt(avg(g('kge'))) + ' ± ' + fmt(sd(g('kge'))) + '</td><td>' + fmt(avg(g('rmse'))) + ' ± ' + fmt(sd(g('rmse'))) + '</td><td class="muted">' + F.map((x) => fmt(x.nse)).join(' · ') + '</td></tr>';
      }).join('') + '</tbody>';
  }

  async function runTuning() {
    if (!S.feat || S.busy) return;
    const u = S.cfg.tune, type = u.model, f = S.feat, sp = S.split;
    const X = sp.train.map((i) => f.X[i]), y = sp.train.map((i) => f.y[i]);
    const space = readSpaceForRun();
    S.tuning = { model: type, method: u.method, metric: u.metric, trials: [], best: null, running: true, total: u.method === 'grid' ? Math.min(300, gridCount()) : +u.nIter, folds: +u.folds, cvType: u.cvType, space };
    S.busy = true; setBusy(true); renderTuning();
    msg('Tuning ' + CAT[type].name + ' with ' + ({ grid: 'grid search', random: 'random search', bayes: 'Bayesian optimisation' }[u.method]) + '…');
    try {
      const res = await WM.send({ cmd: 'tune', type, X, y, space, method: u.method, nIter: +u.nIter, folds: +u.folds, cvType: u.cvType, metric: u.metric, seed: +S.cfg.seed, base: S.cfg.params[type], maxGrid: 300 },
        { onTrial: (m) => { S.tuning.trials.push(m.trial); S.tuning.best = m.best; if (m.total) S.tuning.total = m.total; renderTuning(); } });
      S.tuning.trials = res.trials; S.tuning.best = res.best;
      msg('Tuning finished. Best ' + u.metric.toUpperCase() + ' ' + fmt(res.best.mean) + ' with ' + Object.entries(res.best.params).map(([k, v]) => k + ' = ' + (typeof v === 'number' ? fmt(v) : v)).join(', ') + '.', 'ok');
    } catch (e) { msg(e.message === 'Stopped' ? 'Tuning stopped.' : 'Tuning failed: ' + e.message, e.message === 'Stopped' ? 'warn' : 'err'); }
    S.tuning.running = false; S.busy = false; setBusy(false); renderTuning();
  }
  function applyBest() {
    const T = S.tuning; if (!T || !T.best) return;
    Object.assign(S.cfg.params[T.model], T.best.params);
    S.cfg.on[T.model] = true;
    renderModels();
    // retrain the tuned model, plus any ticked model that has not been trained (or is out of date), so Results shows them all
    const s = sig(), types = ORDER.filter((t) => t === T.model || (S.cfg.on[t] && (!S.runs[t] || S.runs[t].sig !== s)));
    msg('Applied the best settings to ' + CAT[T.model].name + '. Training ' + (types.length > 1 ? 'it and ' + (types.length - 1) + ' other ticked model' + (types.length > 2 ? 's' : '') : 'it') + ' now…', 'ok');
    trainSelected(types);
  }

  // ---------------------------------------------------------------- 4 results
  // Moriasi et al. (2007): NSE, RSR and PBIAS thresholds (streamflow, monthly step)
  function rating(m) {
    if (!m || !isFinite(m.nse)) return null;
    const r1 = m.nse > 0.75 ? 3 : m.nse > 0.65 ? 2 : m.nse > 0.5 ? 1 : 0;
    const r2 = !isFinite(m.rsr) ? 3 : m.rsr <= 0.5 ? 3 : m.rsr <= 0.6 ? 2 : m.rsr <= 0.7 ? 1 : 0;
    const ab = Math.abs(m.pbias), r3 = !isFinite(ab) ? 3 : ab < 10 ? 3 : ab < 15 ? 2 : ab < 25 ? 1 : 0;
    const r = Math.min(r1, r2, r3);
    return [['u', 'Unsatisfactory'], ['s', 'Satisfactory'], ['g', 'Good'], ['vg', 'Very good']][r];
  }
  const runList = () => ORDER.map((t) => S.runs[t]).filter((r) => r && r.m);
  function bestRun(set) {
    let b = null;
    for (const r of runList()) { const v = r.m[set] && r.m[set].nse; if (isFinite(v) && (!b || v > b.m[set].nse)) b = r; }
    return b;
  }
  let lbSort = { key: 'nse', dir: -1 };
  function renderResults() {
    const runs = runList();
    if (!runs.length || !S.feat) return;
    $('rStale').hidden = runs.every((r) => r.sig === sig());
    const untrained = ORDER.filter((t) => S.cfg.on[t] && !S.runs[t]);
    $('rMissing').hidden = !untrained.length;
    $('rMissingTxt').textContent = untrained.length ? 'Ticked on the Train tab but not trained yet: ' + untrained.map((t) => CAT[t].name).join(', ') + '.' : '';
    const set = S.evalSet; $('rSet').value = set;
    const b = bestRun(set);
    if (!S.focus || !S.runs[S.focus]) S.focus = b ? b.type : runs[0].type;
    // the tiles follow the model picked in the leaderboard (the best one until another is clicked)
    const fr = S.runs[S.focus], fm = (fr && fr.m[set]) || {}, rt = rating(fm), isBest = b && fr && b.type === fr.type;
    const where = set === 'test' ? 'test period' : set === 'train' ? 'training period' : 'whole record';
    $('rKpis').innerHTML = fr ? [
      [isBest ? 'Best model' : 'Selected model', CAT[fr.type].name, isBest ? 'highest NSE on the ' + where : 'best is ' + (b ? CAT[b.type].name + ' (NSE ' + fmt(b.m[set].nse) + ')' : '—'), 'acc'],
      ['NSE', fmt(fm.nse), rt ? rt[1] + ' (Moriasi 2007)' : '', 'ok'],
      ['KGE', fmt(fm.kge), 'r ' + fmt(fm.r), ''],
      ['RMSE', fmt(fm.rmse), 'MAE ' + fmt(fm.mae), ''],
      ['PBIAS', isFinite(fm.pbias) ? fm.pbias.toFixed(1) + '%' : '—', fm.pbias > 0 ? 'under-estimates on average' : 'over-estimates on average', 'gen'],
    ].map(([l, v, s, k]) => '<div class="kpi ' + k + '"><span class="l">' + l + '</span><span class="v">' + esc(v) + '</span><span class="s">' + esc(s) + '</span></div>').join('') : '';
    renderDetail();
    // leaderboard
    const cols = [['nse', 'NSE', 1], ['kge', 'KGE', 1], ['r2', 'R²', 1], ['rmse', 'RMSE', -1], ['mae', 'MAE', -1], ['pbias', 'PBIAS %', 0], ['rsr', 'RSR', -1]];
    const best = {}; for (const [k, , dir] of cols) { const vals = runs.map((r) => r.m[set] && r.m[set][k]).filter(isFinite); if (!vals.length) continue; best[k] = dir === 1 ? Math.max(...vals) : dir === -1 ? Math.min(...vals) : vals.reduce((a, v) => (Math.abs(v) < Math.abs(a) ? v : a)); }
    const sorted = [...runs].sort((a, c) => { const va = a.m[set] ? a.m[set][lbSort.key] : NaN, vc = c.m[set] ? c.m[set][lbSort.key] : NaN; return (isFinite(va) ? 0 : 1) - (isFinite(vc) ? 0 : 1) || lbSort.dir * ((lbSort.key === 'pbias' ? Math.abs(vc) - Math.abs(va) : vc - va) || 0) * -1; });
    $('rLb').innerHTML = '<thead><tr><th>Model</th>' + cols.map(([k, l]) => '<th class="sortable' + (lbSort.key === k ? ' sorted' : '') + '" data-sort="' + k + '">' + l + ib(k, l) + '</th>').join('') + '<th>Train NSE</th><th>Rating' + ib('rating', 'rating') + '</th><th>Time</th></tr></thead><tbody>' +
      sorted.map((r) => {
        const m = r.m[set] || {}, rt2 = rating(m), over = r.m.train && r.m.test && r.m.train.nse - r.m.test.nse > 0.15;
        return '<tr data-run="' + r.type + '" class="' + (r.type === S.focus ? 'focus' : '') + '"><td><span class="sw" style="background:' + colorOf(r.type) + '"></span>' + esc(CAT[r.type].name) + (r.sig !== sig() ? ' <span class="muted small">(stale)</span>' : '') + '</td>' +
          cols.map(([k]) => '<td class="' + (isFinite(m[k]) && m[k] === best[k] ? 'best' : '') + '">' + (k === 'pbias' ? (isFinite(m[k]) ? m[k].toFixed(1) : '—') : fmt(m[k])) + '</td>').join('') +
          '<td' + (over ? ' title="Training score much higher than test: over-fitting"' : '') + '>' + fmt(r.m.train ? r.m.train.nse : NaN) + (over ? ' ⚠' : '') + '</td><td>' + (rt2 ? '<span class="rate ' + rt2[0] + '">' + rt2[1] + '</span>' : '—') + '</td><td>' + (r.ms ? (r.ms / 1000).toFixed(1) + ' s' : '—') + '</td></tr>';
      }).join('') + '</tbody>';
    $('rRating').innerHTML = 'Ratings combine NSE, RSR and PBIAS thresholds of Moriasi et al. (2007), written for monthly streamflow — use them as a guide for other variables and time steps. ⚠ marks models whose training NSE is much higher than test NSE (over-fitting). Click a row to inspect that model.';
    // chart tabs
    const tabs = [['hydro', 'Hydrograph'], ['scatter', 'Scatter'], ['resid', 'Residuals'], ['imp', 'Importance'], ['fdc', 'Duration curve'], ['month', 'By month'], ['compare', 'Compare'], ['curve', 'Training curve'], ['pdp', 'Partial dependence']];
    $('rTabs').innerHTML = tabs.map(([k, l]) => '<button class="tab" role="tab" type="button" data-chart="' + k + '" aria-selected="' + (S.chart === k) + '">' + l + '</button>').join('');
    $('rModel').innerHTML = runs.map((r) => '<option value="' + r.type + '"' + (r.type === S.focus ? ' selected' : '') + '>' + esc(CAT[r.type].name) + '</option>').join('');
    $('rFeat').innerHTML = S.feat.names.map((n, j) => '<option value="' + j + '"' + (+$('rFeat').value === j ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
    if (visible('results')) drawResultChart();
  }

  // Full statistics of the focused model: every metric for training, test and the whole record, plus settings and training info
  const DMET = [['nse', 'NSE'], ['kge', 'KGE'], ['r2', 'R²'], ['r', 'r (correlation)'], ['rmse', 'RMSE'], ['mae', 'MAE'], ['pbias', 'PBIAS %'], ['rsr', 'RSR'], ['n', 'Time steps (n)']];
  function paramText(type, params) {
    const defs = CAT[type].params || [];
    return defs.map((d) => d.label + ' = ' + (params[d.key] == null ? '—' : params[d.key])).join(' · ');
  }
  function infoText(r) {
    const i = r.info || {}, out = [];
    if (r.ms) out.push('trained in ' + (r.ms / 1000).toFixed(1) + ' s');
    if (r.nTrain) out.push(r.nTrain + ' training rows');
    if (i.nTrain && i.nTrain < r.nTrain) out.push('SVR used an evenly spaced subsample of ' + i.nTrain + ' rows');
    if (i.nSV != null) out.push(i.nSV + ' support vectors' + (i.nTrain ? ' (' + Math.round((100 * i.nSV) / i.nTrain) + '% of rows)' : ''));
    if (i.iterations != null) out.push(i.iterations + ' solver iterations');
    if (i.timedOut) out.push('stopped at the time limit — try a smaller C or fewer rows');
    if (i.nonzero != null && S.feat) out.push(i.nonzero + ' of ' + S.feat.names.length + ' features kept (non-zero coefficients)');
    if (r.oob && isFinite(r.oob.nse)) out.push('out-of-bag NSE ' + fmt(r.oob.nse) + ' (a free validation score from the rows each tree did not see)');
    if (r.bestIter) out.push((r.type === 'mlp' ? 'early stopping kept epoch ' : 'early stopping kept ') + r.bestIter + (r.type === 'gbm' ? ' trees' : ''));
    return out;
  }
  function renderDetail() {
    const runs = runList(), r = S.runs[S.focus];
    $('rDetailCard').hidden = !r;
    if (!r) return;
    const sets = [['train', 'Training'], ['test', 'Test'], ['all', 'Whole record']];
    $('rDetailTitle').innerHTML = '<span class="sw" style="background:' + colorOf(r.type) + '"></span>' + esc(CAT[r.type].name) + ' <span class="muted small">' + (runs.indexOf(r) + 1) + ' / ' + runs.length + '</span>';
    $('rDetail').innerHTML = '<thead><tr><th>Statistic</th>' + sets.map(([k, l]) => '<th' + (k === S.evalSet ? ' class="sorted"' : '') + '>' + l + '</th>').join('') + '</tr></thead><tbody>' +
      DMET.map(([k, l]) => '<tr><td>' + l + (INFO[k] ? ib(k, l) : '') + '</td>' + sets.map(([s]) => { const v = r.m[s] && r.m[s][k]; return '<td>' + (v == null ? '—' : k === 'n' ? v : k === 'pbias' ? (isFinite(v) ? v.toFixed(1) : '—') : fmt(v)) + '</td>'; }).join('') + '</tr>').join('') +
      '<tr><td>Rating' + ib('rating', 'rating') + '</td>' + sets.map(([s]) => { const rt = rating(r.m[s]); return '<td>' + (rt ? '<span class="rate ' + rt[0] + '">' + rt[1] + '</span>' : '—') + '</td>'; }).join('') + '</tr></tbody>';
    const cv = S.cv[r.type], bits = [];
    const pt = paramText(r.type, r.params || {});
    if (pt) bits.push('<b>Settings:</b> ' + esc(pt));
    const it = infoText(r); if (it.length) bits.push('<b>Training:</b> ' + esc(it.join(' · ')));
    if (cv) { const v = cv.folds.map((x) => x.nse).filter(isFinite); if (v.length) bits.push('<b>Cross-validation:</b> NSE ' + fmt(avg(v)) + ' ± ' + fmt(sd(v)) + ' over ' + v.length + ' folds'); }
    if (r.sig !== sig()) bits.push('<span class="warn">Trained with earlier data / feature settings — retrain to refresh.</span>');
    $('rDetailInfo').innerHTML = bits.join('<br>');
    const ml = !CAT[r.type].baseline;
    $('rSaveModel').disabled = !ml || !r.alive; $('rUseModel').disabled = !ml || !r.alive;
    $('rSaveModel').title = !ml ? 'Baselines need no saving' : r.alive ? 'Download this trained model as a .json file' : 'Retrain the model first';
    $('rPrev').hidden = $('rNext').hidden = runs.length < 2;
  }

  const setIdx = (set) => (set === 'test' ? S.split.test : set === 'train' ? S.split.train : S.feat.y.map((_, i) => i));
  async function drawResultChart() {
    const k = S.chart, r = S.runs[S.focus];
    if (!r) return;
    $('rModelWrap').hidden = k === 'compare' || k === 'hydro';
    $('rFeatWrap').hidden = k !== 'pdp'; $('rImpWrap').hidden = k !== 'imp';
    if (k === 'imp' && !r.imp) $('rImp').value = 'perm';
    const c = await renderChart($('rChart'), k, r, S.evalSet, { imp: $('rImp').value, feat: +$('rFeat').value || 0, zoom: S.zoom, onZoom: (d) => { S.zoom = d; drawResultChart(); }, live: () => S.chart === k && S.runs[S.focus] === r });
    if (c != null) $('rCap').innerHTML = c;
  }

  // Draws one result chart into el and resolves to its caption (null when superseded).
  // o: imp ('builtin'|'perm'), feat (pdp feature index), zoom/onZoom, show ('top'|'all'|'one'), live()
  async function renderChart(el, k, r, set, o = {}) {
    const f = S.feat, sr = S.series, live = () => (o.live ? o.live() : true);
    const times = f.idx.map((i) => sr.t[i]);
    const sub = (n) => { el.innerHTML = Array.from({ length: n }, (_, i) => '<div class="hsub hsub' + i + '"></div>').join(''); return Array.from({ length: n }, (_, i) => el.querySelector('.hsub' + i)); };
    if (k === 'hydro') {
      const runs = runList(), tg = target(), mode = o.show || 'top';
      const top = [...runs].filter((x) => !CAT[x.type].baseline).sort((a, b) => (b.m.test ? b.m.test.nse : -9) - (a.m.test ? a.m.test.nse : -9)).slice(0, 3).map((x) => x.type);
      const show = mode === 'all' ? new Set(runs.map((x) => x.type)) : mode === 'one' ? new Set([r.type]) : new Set([r.type, ...top]);
      const series = [{ name: 'Observed', x: sr.t, y: Array.from(sr.raw[tg]), color: css('--strong'), width: 1.7 }];
      for (const x of runs) if (show.has(x.type)) series.push({ name: CAT[x.type].name, x: times, y: Array.from(x.pred), color: colorOf(x.type), width: x.type === r.type ? 1.8 : 1.2, dash: CAT[x.type].dash, opacity: x.type === r.type || mode === 'all' ? 1 : 0.8 });
      const sp = S.split, shade = S.cfg.split === 'random' ? [] : [{ from: times[sp.train[0]], to: times[sp.train[sp.train.length - 1]], label: 'training', color: css('--accent'), opacity: 0.06 }];
      HC.line(el, { height: 400, series, shade, domain: o.zoom, onZoom: o.onZoom, zoom: !!o.onZoom, yLabel: tg });
      return mode === 'top' ? 'Observed ' + esc(tg) + ' and the predictions of the selected model plus the three best models. The shaded part is the training period; the rest is the test period. Drag to zoom in, double-click to reset.' : 'Observed ' + esc(tg) + ' and predictions. The shaded part is the training period.';
    }
    if (k === 'scatter') {
      const ix = setIdx(set).filter((i) => isFinite(r.pred[i]));
      HC.scatter(el, { x: ix.map((i) => f.y[i]), y: ix.map((i) => r.pred[i]), color: colorOf(r.type), xLabel: 'Observed ' + target(), yLabel: 'Predicted', note: 'NSE ' + fmt(r.m[set].nse) + ' · R² ' + fmt(r.m[set].r2), height: 420 });
      return 'Each dot is one time step of the ' + set + ' set. Points on the dashed 1:1 line are perfect predictions; the solid line is the least-squares fit.';
    }
    if (k === 'resid') {
      const [a, b] = sub(2);
      const ix = setIdx(set).filter((i) => isFinite(r.pred[i])), res = ix.map((i) => f.y[i] - r.pred[i]);
      HC.line(a, { height: 220, hline: 0, zoom: false, legend: false, series: [{ name: 'residual', x: ix.map((i) => times[i]), y: res, color: colorOf(r.type), dots: true, r: 1.6 }], yLabel: 'observed − predicted' });
      HC.hist(b, { values: res, color: colorOf(r.type), xLabel: 'distribution of residuals', height: 180 });
      return 'Residual = observed − predicted on the ' + set + ' set. Mean ' + fmt(avg(res)) + ', standard deviation ' + fmt(sd(res)) + '. Patterns over time (e.g. all positive in the monsoon) show what the model misses.';
    }
    if (k === 'imp') {
      let imp = null, how = '';
      const perm = o.imp === 'perm' || !r.imp;
      if (perm) {
        if (CAT[r.type].baseline) { el.innerHTML = '<p class="cap">Baselines have no features.</p>'; return ''; }
        if (!r.perm) {
          if (!r.alive) { el.innerHTML = '<p class="cap">This model is no longer in memory (training was stopped or the page restarted the engine). Retrain it to compute importance.</p>'; return ''; }
          el.innerHTML = '<p class="cap">Computing permutation importance…</p>';
          const ix = S.split.test;
          try { const res = await WM.send({ cmd: 'perm', model: r.type, X: ix.map((i) => f.X[i]), y: ix.map((i) => f.y[i]), seed: +S.cfg.seed }); r.perm = res.imp; }
          catch (e) { el.innerHTML = '<p class="cap">' + esc(e.message) + '</p>'; return ''; }
          if (!live()) return null;
        }
        imp = r.perm; how = 'Permutation importance: how much the test NSE drops when that feature is shuffled.';
      } else { imp = r.imp; how = r.type === 'linear' ? 'Absolute standardized coefficients of the linear model.' : 'Built-in (impurity) importance: share of the total variance reduction from splits on each feature.'; }
      const pairs = f.names.map((n, j) => [n, imp[j]]).filter((p) => isFinite(p[1])).sort((a, b) => b[1] - a[1]).slice(0, 25);
      HC.bars(el, { labels: pairs.map((p) => p[0]), values: pairs.map((p) => p[1]), color: colorOf(r.type), fmt: (v) => (r.type === 'linear' && !perm ? fmt(v) : (v * 100).toFixed(1) + '%') });
      return how + ' Top 25 shown.';
    }
    if (k === 'fdc') {
      const ix = setIdx(set).filter((i) => isFinite(r.pred[i]));
      const ob = ix.map((i) => f.y[i]).sort((a, b) => b - a), p = ix.map((i) => r.pred[i]).sort((a, b) => b - a), n = ob.length;
      const ex = ob.map((_, i) => (100 * (i + 1)) / (n + 1));
      HC.line(el, { xTime: false, height: 380, zoom: false, yLabel: target(), series: [{ name: 'Observed', x: ex, y: ob, color: css('--strong'), width: 1.8 }, { name: CAT[r.type].name, x: ex, y: p, color: colorOf(r.type), width: 1.6 }] });
      return 'Duration curve: the value that is equalled or exceeded the given % of the time (x-axis, %), on the ' + set + ' set. It checks whether the model reproduces high and low values, not just the timing.';
    }
    if (k === 'month') {
      const [a, b] = sub(2);
      const ix = setIdx(set).filter((i) => isFinite(r.pred[i])), so = new Array(12).fill(0), sp = new Array(12).fill(0), se = new Array(12).fill(0), c = new Array(12).fill(0);
      for (const i of ix) { const mo = new Date(times[i]).getUTCMonth(); so[mo] += f.y[i]; sp[mo] += r.pred[i]; se[mo] += (f.y[i] - r.pred[i]) ** 2; c[mo]++; }
      const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], mi = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      HC.line(a, { xTime: false, zoom: false, height: 200, yLabel: 'mean by month', series: [{ name: 'Observed', x: mi.map((m) => m + 1), y: mi.map((m) => (c[m] ? so[m] / c[m] : NaN)), color: css('--strong'), width: 2 }, { name: CAT[r.type].name, x: mi.map((m) => m + 1), y: mi.map((m) => (c[m] ? sp[m] / c[m] : NaN)), color: colorOf(r.type), width: 2 }] });
      HC.columns(b, { labels: M, values: mi.map((m) => (c[m] ? Math.sqrt(se[m] / c[m]) : NaN)), color: colorOf(r.type), yLabel: 'RMSE by month', height: 200 });
      return 'Seasonal check on the ' + set + ' set: average by calendar month (x = month 1–12) and the error (RMSE) in each month.';
    }
    if (k === 'compare') {
      const runs = runList().filter((x) => x.m[set]).sort((a, b) => b.m[set].nse - a.m[set].nse);
      HC.bars(el, { labels: runs.map((x) => CAT[x.type].name), values: runs.map((x) => x.m[set].nse), color: (v, i) => colorOf(runs[i].type), fmt: (v) => 'NSE ' + fmt(v), rowH: 30 });
      return 'NSE of every model on the ' + set + ' set. Anything below the persistence baseline adds no skill over simply repeating the last value.';
    }
    if (k === 'curve') {
      if (!r.curve || !r.curve.length) { el.innerHTML = '<p class="cap">Training curves are available for gradient boosting (error vs number of trees) and the neural network (error vs epoch).</p>'; return ''; }
      const s = [{ name: 'training RMSE', x: r.curve.map((p) => p.i), y: r.curve.map((p) => p.train), color: colorOf(r.type), width: 1.8 }];
      if (r.curve.some((p) => p.val != null)) s.push({ name: 'validation RMSE', x: r.curve.map((p) => p.i), y: r.curve.map((p) => p.val), color: css('--warn'), width: 1.8 });
      HC.line(el, { xTime: false, height: 360, zoom: false, series: s, vlines: r.bestIter ? [{ x: r.bestIter, color: css('--ok') }] : [], yLabel: 'RMSE' });
      return (r.type === 'gbm' ? 'Error as trees are added.' : 'Error per epoch.') + (r.bestIter ? ' The green line marks the point kept by early stopping (' + r.bestIter + ').' : '') + ' A widening gap between training and validation means over-fitting.';
    }
    if (k === 'pdp') {
      if (CAT[r.type].baseline) { el.innerHTML = '<p class="cap">Baselines have no features.</p>'; return ''; }
      if (!r.alive) { el.innerHTML = '<p class="cap">Retrain this model to compute partial dependence.</p>'; return ''; }
      const j = o.feat || 0;
      el.innerHTML = '<p class="cap">Computing…</p>';
      try {
        const ix = S.split.train, res = await WM.send({ cmd: 'pdp', model: r.type, X: ix.map((i) => f.X[i]), j, seed: +S.cfg.seed });
        if (!live()) return null;
        HC.line(el, { xTime: false, height: 340, zoom: false, legend: false, yLabel: 'average predicted ' + target(), series: [{ name: 'partial dependence', x: res.res.grid, y: res.res.pd, color: colorOf(r.type), width: 2.2 }] });
        return 'Partial dependence: the average prediction when <b>' + esc(f.names[j]) + '</b> is set to each value (x-axis) and all other features keep their real values. Shows the shape of the learned relationship.';
      } catch (e) { el.innerHTML = '<p class="cap">' + esc(e.message) + '</p>'; return ''; }
    }
    return '';
  }

  // ---------------------------------------------------------------- 5 predict
  // A model handle = a model the engine holds plus the recipe (spec) to rebuild its features on any data.
  // Handles come from models trained in this session and from saved model files.
  function modelHandles() {
    const out = [];
    for (const r of runList()) if (!CAT[r.type].baseline && r.alive && r.spec) out.push({ id: 'run:' + r.type, key: r.type, type: r.type, name: CAT[r.type].name, spec: r.spec, metrics: r.m, stale: r.sig !== sig(), src: 'Trained in this session' });
    for (const m of S.imported) out.push({ id: 'imp:' + m.key, key: m.key, type: m.type, name: m.name, spec: m.spec, metrics: m.metrics, imported: m, src: 'Loaded from ' + m.file + (m.trainedOn ? ' — trained on ' + m.trainedOn : '') + (m.savedAt ? ', ' + m.savedAt.slice(0, 10) : '') });
    return out;
  }
  const handleById = (id) => modelHandles().find((h) => h.id === id);
  function renderPredict() {
    const hs = modelHandles(), cur = S.pickModel || $('pModel').value;
    S.pickModel = null;
    $('pNeed').hidden = hs.length > 0; $('pBody').hidden = !hs.length;
    $('pLoaded').textContent = S.imported.length ? S.imported.length + ' saved model' + (S.imported.length > 1 ? 's' : '') + ' loaded: ' + S.imported.map((m) => m.name).join(', ') : '';
    const sel = hs.find((h) => h.id === cur) || hs.find((h) => h.id === 'run:' + S.focus) || hs[0];
    $('pModel').innerHTML = hs.map((h) => '<option value="' + h.id + '"' + (h === sel ? ' selected' : '') + '>' + esc((h.imported ? 'Saved · ' : '') + h.name + (h.metrics && h.metrics.test ? ' · test NSE ' + fmt(h.metrics.test.nse) : '') + (h.stale ? ' (stale)' : '')) + '</option>').join('');
    if (sel) {
      const sp = sel.spec, fs = featureSpec(sp.cfg);
      $('pModelInfo').innerHTML = esc(sel.src) + '. Predicts <b>' + esc(sp.target) + '</b> from ' + (sp.inputs.length ? esc(sp.inputs.join(', ')) : 'no inputs') + ' · ' + sp.names.length + ' features' +
        (fs.ar.length ? ' · uses past ' + esc(sp.target) + ' (gaps filled recursively)' : '') + (sp.cfg.mode === 'fc' ? ' · forecasts ' + fs.h + ' step(s) ahead' : '') + '.';
    }
    $('pFill').disabled = !S.table;
    $('pFill').title = S.table ? '' : 'Load a data file on the Data tab first';
    $('pOut').hidden = !S.predict;
    if (S.predict && visible('predict')) drawPredict();
  }
  // models restored from a file live in the engine only until it is restarted (Stop) or a new file is loaded
  async function ensureLoaded(h) {
    if (!h.imported || h.imported.alive) return;
    await WM.send({ cmd: 'import', model: h.key, type: h.type, data: h.imported.data });
    h.imported.alive = true;
  }
  // Header row, numeric columns and BWDB type column of a raw sheet (same rules as the Data tab)
  function tableFromRows(rows) {
    const hr = findHeader(rows), first = hr >= 0 ? rows[hr] : [], body = rows.slice(hr + 1);
    const width = Math.max(first.length, ...body.slice(0, 50).map((r) => r.length));
    const header = [];
    for (let j = 0; j < width; j++) {
      let h = String(first[j] == null ? '' : first[j]).replace(/\s+/g, ' ').trim();
      if (!h || h.length > 60) h = 'Column ' + String.fromCharCode(65 + (j % 26)) + (j >= 26 ? Math.floor(j / 26) : '');
      while (header.includes(h)) h += '_';
      header.push(h);
    }
    const n = Math.min(body.length, 400), score = (test) => header.map((h, j) => { let ok = 0, tot = 0; for (let r = 0; r < n; r++) { const v = body[r][j]; if (v === '' || v == null) continue; tot++; if (test(v)) ok++; } return tot ? ok / tot : 0; });
    const numeric = score((v) => typeof v !== 'object' && isFinite(HIO.toNumber(v))).map((s) => s >= 0.6);
    const dateScore = score((v) => typeof v === 'object' || (typeof v === 'string' && isFinite(HIO.parseDate(v))));
    const typeJ = header.findIndex((h) => /type/i.test(h));
    const typeCol = typeJ >= 0 && body.slice(0, 200).some((r) => /^regular$/i.test(String(r[typeJ] || '').trim())) ? header[typeJ] : '';
    let bj = -1; dateScore.forEach((s, j) => { if (s >= 0.6 && (bj < 0 || s > dateScore[bj])) bj = j; });
    return { header, rows: body, numeric, typeCol, headerRow: hr, skippedTop: Math.max(0, hr), dateGuess: bj >= 0 ? header[bj] : null };
  }
  // Rebuild the model's features on a table and predict every time step where the inputs exist.
  // Models that use past target values fill missing target steps recursively (each prediction feeds the next step).
  async function applyModel(h, table, dateCol, onStep) {
    const sp = h.spec, tg = sp.target, ins = sp.inputs;
    const cfg = Object.assign({}, sp.cfg, { dateCol, timeCol: sp.cfg.timeCol && table.header.includes(sp.cfg.timeCol) ? sp.cfg.timeCol : '' });
    const missing = ins.filter((c) => !table.header.includes(c));
    if (missing.length) throw new Error('The data is missing input column(s) used by the model: ' + missing.join(', ') + '. Column names must match the training data.');
    const hasT = table.header.includes(tg), ar = featureSpec(cfg).ar.length > 0;
    if (ar && !hasT) throw new Error('This model uses past values of “' + tg + '”, so the data must include that column (with its history).');
    const series = buildSeries(table, cfg, hasT ? [...ins, tg] : ins.slice());
    const ycopy = hasT ? Float64Array.from(series.cols[tg]) : null;
    const live = hasT ? Object.assign({}, series, { cols: Object.assign({}, series.cols, { [tg]: ycopy }) }) : series;
    const G = makeGetters(live, cfg, hasT ? tg : null, ins);
    if (G.names.join('\n') !== sp.names.join('\n')) throw new Error('The features built from this data do not match the ones the model was trained on (' + G.names.length + ' vs ' + sp.names.length + ').');
    await ensureLoaded(h);
    const n = series.t.length, pred = new Float64Array(n).fill(NaN);
    const rowAt = (i) => { const row = G.getters.map((g) => g(i)); return row.every(isFinite) ? row : null; };
    const X = [], at = [];
    for (let i = 0; i < n; i++) { const row = rowAt(i); if (row) { X.push(row); at.push(i); } }
    if (X.length) { const p = (await WM.send({ cmd: 'predict', model: h.key, X })).pred; at.forEach((i, k) => { pred[i] = p[k]; }); }
    if (ar) {
      // re-predict every missing target step in time order, including short gaps that were interpolated
      const raw = series.raw[tg], todo = [];
      for (let i = 0; i < n; i++) if (!isFinite(raw[i])) { todo.push(i); ycopy[i] = NaN; }
      if (todo.length > 20000) throw new Error('Too many missing values to fill one by one (' + todo.length + ').');
      let done = 0;
      for (const i of todo) {
        const row = rowAt(i); if (!row) { pred[i] = NaN; continue; }
        const p = (await WM.send({ cmd: 'predict', model: h.key, X: [row] })).pred[0];
        ycopy[i] = p; pred[i] = p;
        if (onStep && ++done % 50 === 0) onStep(done, todo.length);
      }
    }
    let met = null;
    const obs = hasT ? Array.from(series.raw[tg]) : null;
    if (obs) { const o = [], q = []; obs.forEach((v, i) => { if (isFinite(v) && isFinite(pred[i])) { o.push(v); q.push(pred[i]); } }); if (o.length > 5) met = HML.metrics(o, q); }
    return { series, pred, obs, met, recursive: ar };
  }
  const predBase = (h) => ({ type: h.type, label: h.name, target: h.spec.target, nse: h.metrics && h.metrics.test ? h.metrics.test.nse : NaN });
  async function fillGaps() {
    const h = handleById($('pModel').value); if (!h) return;
    if (!S.table) { msg('Load a data file on the Data tab first.', 'warn'); return; }
    try {
      msg('Applying ' + h.name + '…');
      const R = await applyModel(h, S.table, S.cfg.dateCol, (d, n) => msg('Filling gaps… ' + d + ' / ' + n));
      if (!R.obs) throw new Error('The loaded record has no “' + h.spec.target + '” column to fill.');
      const obs = R.obs, fitted = Array.from(R.pred, (p, i) => (isFinite(obs[i]) ? p : NaN)), pred = Array.from(R.pred, (p, i) => (isFinite(obs[i]) ? NaN : p));
      const final = obs.map((v, i) => (isFinite(v) ? v : pred[i]));
      const filled = pred.filter(isFinite).length, stillMissing = final.filter((v) => !isFinite(v)).length;
      S.predict = Object.assign(predBase(h), { kind: 'fill', t: R.series.t, obs, pred, fitted, final, filled, stillMissing, recursive: R.recursive, met: R.met, name: S.file.name });
      S.pzoom = null;
      renderPredict();
      msg(filled ? 'Filled ' + filled + ' missing values of ' + h.spec.target + ' with ' + h.name + (R.recursive ? ' (recursively — each filled value feeds the next step)' : '') + (stillMissing ? '; ' + stillMissing + ' remain where the inputs are missing too.' : '.') : 'The target has no gaps where the inputs are available.', 'ok');
    } catch (e) { msg(e.message, 'err'); }
  }
  async function predictNewFile(file) {
    const h = handleById($('pModel').value); if (!h) return;
    try {
      msg('Reading ' + file.name + '…');
      const r = await readFile(file);
      if (!r.sheets.length) throw new Error('No data found in the file');
      const table = tableFromRows(r.sheets[0].rows);
      const dateCol = table.header.includes(h.spec.cfg.dateCol) ? h.spec.cfg.dateCol : table.dateGuess;
      if (!dateCol) throw new Error('No date column found in ' + file.name + '.');
      const R = await applyModel(h, table, dateCol);
      const pred = Array.from(R.pred), count = pred.filter(isFinite).length;
      if (!count) throw new Error('No rows with all required inputs (check lags and gaps).');
      S.predict = Object.assign(predBase(h), { kind: 'new', t: R.series.t, obs: R.obs, pred, final: R.obs ? R.obs.map((v, i) => (isFinite(v) ? v : pred[i])) : pred, met: R.met, name: file.name, count });
      S.pzoom = null;
      renderPredict();
      msg('Predicted ' + count + ' time steps for ' + file.name + ' with ' + h.name + '.', 'ok');
    } catch (e) { msg(e.message, 'err'); }
  }
  function drawPredict() {
    const P = S.predict; if (!P) return;
    const tg = P.target, col = colorOf(P.type);
    $('pTitle').textContent = P.kind === 'fill' ? 'Gap-filled ' + tg + ' — ' + P.name : 'Prediction for ' + P.name;
    const k = [];
    if (P.kind === 'fill') k.push(['Values filled', P.filled, P.recursive ? 'recursive: predictions feed the next step' : 'missing target values predicted', 'ok'], ['Still missing', P.stillMissing, 'inputs missing as well', ''], ['Model', P.label, 'test NSE ' + fmt(P.nse) + (P.met ? ' · fit where observed ' + fmt(P.met.nse) : ''), 'acc']);
    else { k.push(['Steps predicted', P.count, '', 'acc'], ['Model', P.label, 'test NSE ' + fmt(P.nse), '']); if (P.met) k.push(['NSE (where observed)', fmt(P.met.nse), 'KGE ' + fmt(P.met.kge) + ' · RMSE ' + fmt(P.met.rmse), 'ok']); }
    $('pKpis').innerHTML = k.map(([l, v, s, c]) => '<div class="kpi ' + c + '"><span class="l">' + l + '</span><span class="v">' + esc(v) + '</span><span class="s">' + esc(s) + '</span></div>').join('');
    const series = [];
    if (P.obs) series.push({ name: 'Observed', x: P.t, y: P.obs, color: css('--strong'), width: 1.6 });
    if (P.kind === 'fill' && P.fitted) series.push({ name: P.label + ' (fit)', x: P.t, y: P.fitted, color: col, width: 1, opacity: 0.45 });
    series.push({ name: P.kind === 'fill' ? 'Filled values' : 'Predicted', x: P.t, y: P.pred, color: P.kind === 'fill' ? css('--warn') : col, width: 2.2 });
    HC.line($('pChart'), { height: 380, series, domain: S.pzoom, onZoom: (d) => { S.pzoom = d; drawPredict(); }, yLabel: tg });
    const rows = [];
    for (let i = 0; i < P.t.length && rows.length < 400; i++) {
      if (P.kind === 'fill' && isFinite(P.obs[i])) continue;
      rows.push('<tr><td>' + fmtD(P.t[i]) + '</td>' + (P.obs ? '<td>' + fmt(P.obs[i]) + '</td>' : '') + '<td>' + fmt(P.pred[i]) + '</td><td>' + fmt(P.final[i]) + '</td></tr>');
    }
    $('pTbl').innerHTML = '<thead><tr><th>Date</th>' + (P.obs ? '<th>Observed</th>' : '') + '<th>Predicted</th><th>Final</th></tr></thead><tbody>' + (rows.join('') || '<tr><td colspan="4" class="muted">Nothing to list.</td></tr>') + '</tbody>';
  }

  // ---------------------------------------------------------------- export
  const stamp = () => new Date().toISOString().slice(0, 10);
  const cleanName = (s) => String(s).replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40);
  function buildWorkbook() {
    const runs = runList(), f = S.feat, sr = S.series, tg = target();
    const inTrain = new Set(S.split.train);
    const pred = [['Date', 'Observed ' + tg, 'Set', ...runs.map((r) => CAT[r.type].name)]];
    f.idx.forEach((i, k) => pred.push([{ date: sr.t[i] }, f.y[k], inTrain.has(k) ? 'train' : 'test', ...runs.map((r) => r.pred[k])]));
    const met = [['Model', 'Set', 'NSE', 'KGE', 'R2', 'r', 'RMSE', 'MAE', 'PBIAS %', 'RSR', 'n', 'Rating (Moriasi 2007)', 'Train time (s)']];
    for (const r of runs) for (const set of ['train', 'test', 'all']) { const m = r.m[set]; if (m) met.push([CAT[r.type].name, set, m.nse, m.kge, m.r2, m.r, m.rmse, m.mae, m.pbias, m.rsr, m.n, (rating(m) || ['', ''])[1], r.ms ? r.ms / 1000 : '']); }
    const impRuns = runs.filter((r) => r.imp || r.perm);
    const imp = [['Feature', ...impRuns.map((r) => CAT[r.type].name + (r.perm ? ' (permutation)' : ' (built-in)'))]];
    f.names.forEach((n, j) => imp.push([n, ...impRuns.map((r) => (r.perm || r.imp)[j])]));
    const sheets = [{ name: 'Predictions', rows: pred }, { name: 'Metrics', rows: met }];
    if (impRuns.length) sheets.push({ name: 'Importance', rows: imp });
    if (Object.keys(S.cv).length) {
      const cv = [['Model', 'Scheme', 'Fold', 'Train rows', 'Test rows', 'NSE', 'KGE', 'R2', 'RMSE', 'PBIAS %']];
      for (const [t, c] of Object.entries(S.cv)) for (const x of c.folds) cv.push([CAT[t].name, c.scheme, x.fold, x.nTrain, x.nTest, x.nse, x.kge, x.r2, x.rmse, x.pbias]);
      sheets.push({ name: 'Cross-validation', rows: cv });
    }
    if (S.tuning && S.tuning.trials.length) {
      const keys = Object.keys(S.tuning.trials[0].params);
      const tu = [['Trial', ...keys, 'CV ' + S.tuning.metric.toUpperCase() + ' mean', 'sd', 'How']];
      S.tuning.trials.forEach((t) => tu.push([t.i, ...keys.map((k) => t.params[k]), t.mean, t.sd, t.how]));
      sheets.push({ name: 'Tuning ' + CAT[S.tuning.model].short, rows: tu });
    }
    const st = [['Setting', 'Value'], ['Tool', 'Hydro ML Studio (Mahfujur Rahman Joy)'], ['Exported', new Date().toISOString()], ['File', S.file.name], ['Target', tg], ['Inputs', inputs().join(', ')],
      ['Time step', sr.step], ['Mode', S.cfg.mode === 'fc' ? 'forecast ' + featureSpec(S.cfg).h + ' steps ahead' : 'simulation'], ['Input lags', featureSpec(S.cfg).lags.join(', ')], ['Rolling windows', S.cfg.roll + ' (' + S.cfg.rollStat + ')'],
      ['Target lags', featureSpec(S.cfg).ar.join(', ') || 'none'], ['Seasonal terms', [S.cfg.doy && 'day of year', S.cfg.month && 'month', S.cfg.trend && 'trend'].filter(Boolean).join(', ') || 'none'],
      ['Missing values', S.cfg.gap + ' (max ' + S.cfg.gapMax + ' steps)'], ['Split', S.cfg.split + ' ' + (S.cfg.split === 'date' ? S.cfg.splitDate : S.cfg.pct + '% training')], ['Validation share', S.cfg.val], ['Seed', S.cfg.seed]];
    for (const r of runs) st.push(['Params: ' + CAT[r.type].name, JSON.stringify(r.params)]);
    sheets.push({ name: 'Settings', rows: st }, { name: 'Features', rows: [['Feature'], ...f.names.map((n) => [n])] });
    return HIO.writeXlsx(sheets);
  }
  const baseName = () => 'HydroML_' + cleanName(S.file.name) + '_' + stamp();
  function exportXlsx() {
    HIO.download(buildWorkbook(), baseName() + '.xlsx');
    msg('Excel workbook saved.', 'ok');
  }
  const settingsJson = () => JSON.stringify({ tool: 'Hydro ML Studio', version: 1, cfg: S.cfg }, null, 2);

  // ---------------------------------------------------------------- saved models (.json)
  async function modelJson(r) {
    if (CAT[r.type].baseline) throw new Error('Baselines need no saving.');
    if (!r.alive) throw new Error(CAT[r.type].name + ' is no longer in memory — retrain it first.');
    const ex = await WM.send({ cmd: 'export', model: r.type });
    const sp = r.spec;
    return JSON.stringify({ format: 'hydro-ml-model', version: 1, tool: 'Hydro ML Studio — https://meawman.github.io/tools/hydro-ml/', type: r.type, name: CAT[r.type].name, savedAt: new Date().toISOString(), trainedAt: r.trainedAt, trainedOn: S.file.name,
      target: sp.target, inputs: sp.inputs, features: sp.names, step: sp.step, cfg: sp.cfg, params: r.params, metrics: r.m, info: r.info, oob: r.oob, bestIter: r.bestIter, nTrain: r.nTrain, model: ex.model });
  }
  const modelFileName = (r) => 'HydroML_model_' + r.type + '_' + cleanName(target()) + '_' + stamp() + '.json';
  async function saveModel(r) {
    try { HIO.download(new Blob([await modelJson(r)], { type: 'application/json' }), modelFileName(r)); msg(CAT[r.type].name + ' saved. Load it later on the Predict tab — no retraining needed.', 'ok'); }
    catch (e) { msg(e.message, 'err'); }
  }
  async function saveAllModels() {
    const runs = runList().filter((r) => !CAT[r.type].baseline && r.alive);
    if (!runs.length) { msg('No trained machine-learning models in memory.', 'warn'); return; }
    try {
      const files = [];
      for (const r of runs) files.push({ name: modelFileName(r), text: await modelJson(r) });
      if (files.length === 1) HIO.download(new Blob([files[0].text], { type: 'application/json' }), files[0].name);
      else HIO.download(HIO.zip(files), baseName() + '_models.zip');
      msg(files.length + ' model' + (files.length > 1 ? 's' : '') + ' saved' + (files.length > 1 ? ' in a .zip (unzip, then load any .json on the Predict tab)' : '') + '.', 'ok');
    } catch (e) { msg(e.message, 'err'); }
  }
  async function loadModels(files) {
    let n = 0; const D0 = defaults();
    for (const file of files) {
      try {
        const j = JSON.parse(await file.text());
        if (j.format !== 'hydro-ml-model' || !j.model || !CAT[j.type] || CAT[j.type].baseline) throw new Error('not a Hydro ML Studio model file');
        if (!Array.isArray(j.features) || !j.cfg || !j.target) throw new Error('the file is incomplete');
        const key = 'imp' + ++S.impSeq;
        const m = { key, type: j.type, name: j.name || CAT[j.type].name, file: file.name, savedAt: j.savedAt, trainedOn: j.trainedOn, metrics: j.metrics || null, params: j.params, data: j.model, alive: false,
          spec: { cfg: Object.assign(Object.fromEntries(SPEC_KEYS.map((k) => [k, D0[k]])), j.cfg), names: j.features, target: j.target, inputs: j.inputs || [], step: j.step } };
        await ensureLoaded({ imported: m, key, type: m.type });
        S.imported.push(m); n++;
        S.pickModel = 'imp:' + key;
      } catch (e) { msg(file.name + ': ' + e.message, 'err'); }
    }
    if (n) { renderPredict(); msg(n + ' saved model' + (n > 1 ? 's' : '') + ' loaded. Use it to fill gaps in the loaded record or predict a new file.', 'ok'); }
  }

  // ---------------------------------------------------------------- everything (.zip)
  // Every chart is drawn off-screen at a fixed width and turned into a PNG
  async function exportZip() {
    const runs = runList(); if (!runs.length) return;
    const btn = $('xZip'), prog = $('xProg'), tg = target(), set = S.evalSet;
    btn.disabled = true;
    const say = (t) => { prog.textContent = t; };
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-12000px;top:0;width:1100px;pointer-events:none';
    host.className = 'chart';
    document.body.appendChild(host);
    const files = [], enc = new TextEncoder(), stamp2 = (n) => String(n).padStart(2, '0');
    const png = async (el, name, title) => { try { const b = await HC.pngBlob(el, title); if (b) files.push({ name, data: new Uint8Array(await b.arrayBuffer()) }); } catch (e) { /* skip a chart that fails */ } };
    // charts with two panels are saved as two images
    const shoot = async (kind, r, name, title) => {
      host.innerHTML = '';
      const c = await renderChart(host, kind, r, set, { imp: r.imp ? 'model' : 'perm', show: kind === 'hydro' ? 'one' : undefined });
      if (c == null) return;
      const subs = host.querySelectorAll('.hsub');
      if (subs.length) { let q = 0; for (const s of subs) await png(s, name + '_' + 'ab'[q++] + '.png', title); }
      else if (host.querySelector('svg')) await png(host, name + '.png', title);
    };
    try {
      say('Building the workbook…');
      files.push({ name: 'results.xlsx', data: new Uint8Array(await buildWorkbook().arrayBuffer()) });
      files.push({ name: 'methods.txt', text: methodsText() }, { name: 'settings.json', text: settingsJson() });
      const lb = $$('#rLb tr').map((tr) => $$('th,td', tr).map(cellText).join('\t')).join('\r\n');
      files.push({ name: 'leaderboard_' + set + '.tsv', text: lb });
      say('Drawing the summary charts…');
      const best = bestRun('test') || runs[0];
      host.innerHTML = '';
      await renderChart(host, 'hydro', best, set, { show: 'all' });
      await png(host, 'plots/00_all_models_hydrograph.png', 'All models — ' + tg);
      await shoot('compare', best, 'plots/00_compare_nse_' + set, 'NSE of every model (' + set + ')');
      if (S.tuning && S.tuning.trials && S.tuning.trials.length) {
        const t = S.tuning.trials, bestSoFar = []; let m = -Infinity;
        for (const x of t) { if (isFinite(x.mean) && x.mean > m) m = x.mean; bestSoFar.push(m); }
        host.innerHTML = '';
        HC.line(host, { xTime: false, height: 340, zoom: false, yLabel: 'CV ' + S.tuning.metric.toUpperCase(), series: [{ name: 'trial', x: t.map((x) => x.i), y: t.map((x) => x.mean), color: css('--dim'), dots: true, r: 2.5, width: 0 }, { name: 'best so far', x: t.map((x) => x.i), y: bestSoFar, color: css('--ok'), width: 2 }] });
        await png(host, 'plots/00_tuning_' + S.tuning.model + '.png', 'Tuning — ' + CAT[S.tuning.model].name);
      }
      const kinds = [['hydro', 'hydrograph'], ['scatter', 'scatter'], ['resid', 'residuals'], ['imp', 'importance'], ['fdc', 'duration_curve'], ['month', 'by_month'], ['curve', 'training_curve']];
      let q = 0;
      for (const r of runs) {
        q++;
        const dir = 'plots/' + stamp2(q) + '_' + r.type + '/';
        for (const [k, nm] of kinds) {
          if (CAT[r.type].baseline && (k === 'imp' || k === 'curve')) continue;
          if (k === 'curve' && !(r.curve && r.curve.length)) continue;
          say('Drawing ' + CAT[r.type].name + ' — ' + nm.replace('_', ' ') + '…');
          await shoot(k, r, dir + nm, CAT[r.type].name + ' — ' + nm.replace('_', ' '));
        }
      }
      const ml = runs.filter((r) => !CAT[r.type].baseline && r.alive);
      for (const r of ml) { say('Saving ' + CAT[r.type].name + '…'); files.push({ name: 'models/' + modelFileName(r), text: await modelJson(r) }); }
      files.push({ name: 'README.txt', text: 'Hydro ML Studio export — ' + new Date().toISOString() + '\r\nData: ' + S.file.name + '\r\nTarget: ' + tg + '\r\n\r\nresults.xlsx   predictions of every model, metrics (train / test / whole record), importance, cross-validation, tuning, settings\r\nplots/         PNG charts: summary charts first, then one folder per model (statistics on the ' + set + ' set)\r\nmodels/        trained models — load them on the Predict tab with "Load a saved model"\r\nmethods.txt    a methods paragraph for a report\r\nsettings.json  all settings — load with "Load settings"\r\n' });
      say('Packing ' + files.length + ' files…');
      HIO.download(HIO.zip(files), baseName() + '_all.zip');
      say(''); msg('Downloaded everything: ' + files.filter((f) => /\.png$/.test(f.name)).length + ' charts, ' + ml.length + ' models, workbook, methods and settings.', 'ok');
    } catch (e) { say(''); msg('Export failed: ' + e.message, 'err'); }
    finally { host.remove(); btn.disabled = false; if (visible('results')) drawResultChart(); }
  }
  function exportPredict() {
    const P = S.predict; if (!P) return;
    const tg = P.target, rows = [['Date', ...(P.obs ? ['Observed ' + tg] : []), 'Predicted (' + P.label + ')', P.kind === 'fill' ? 'Gap-filled ' + tg : 'Final', 'Source']];
    P.t.forEach((t, i) => rows.push([{ date: t }, ...(P.obs ? [P.obs[i]] : []), P.pred[i], P.final[i], P.obs && isFinite(P.obs[i]) ? 'observed' : isFinite(P.pred[i]) ? 'model' : 'missing']));
    HIO.download(HIO.writeXlsx([{ name: P.kind === 'fill' ? 'Gap-filled' : 'Prediction', rows }]), 'HydroML_' + (P.kind === 'fill' ? 'gapfilled_' : 'prediction_') + cleanName(P.name) + '_' + stamp() + '.xlsx');
  }
  function methodsText() {
    const runs = runList(), b = bestRun('test'); if (!b) return '';
    const sr = S.series, f = S.feat, sp = featureSpec(S.cfg), tg = target(), ins = inputs(), unit = { day: 'daily', month: 'monthly', hour: 'hourly' }[sr.step] || '';
    const tr = S.split.train, te = S.split.test, t = (i) => fmtD(sr.t[f.idx[i]]);
    const m = b.m.test, rt = rating(m);
    const models = runs.filter((r) => !CAT[r.type].baseline).map((r) => CAT[r.type].name.toLowerCase() + (r.type === 'linear' && r.params.lambda > 0 ? ' (ridge, λ = ' + r.params.lambda + ')' : ''));
    const base = runs.filter((r) => CAT[r.type].baseline).map((r) => r.type === 'persist' ? 'persistence' : 'monthly climatology');
    const feats = [ins.length ? ins.join(', ') + ' at lags of ' + sp.lags.join(', ') + ' ' + (sr.step === 'day' ? 'days' : 'time steps') : '', S.cfg.roll && ins.length ? 'rolling ' + (S.cfg.rollStat === 'auto' ? 'sums/means' : S.cfg.rollStat + 's') + ' over ' + featureSpec(S.cfg).roll.join(', ') + ' steps' : '', sp.ar.length ? 'antecedent ' + tg + ' (lags ' + sp.ar.join(', ') + ')' : '', S.cfg.doy ? 'sine and cosine of the day of year' : '', S.cfg.month ? 'month (sine/cosine)' : '', S.cfg.trend ? 'a linear time trend' : ''].filter(Boolean);
    let s = 'Machine-learning models were developed in Hydro ML Studio (Joy, 2026) to ' + (S.cfg.mode === 'fc' ? 'forecast ' + tg + ' ' + sp.h + ' ' + (sr.step === 'day' ? 'day(s)' : 'time step(s)') + ' ahead' : 'simulate ' + tg) + ' from ' + (unit ? unit + ' ' : '') + 'records spanning ' + fmtD(sr.t[0]) + ' to ' + fmtD(sr.t[sr.t.length - 1]) + '. ';
    if (S.cfg.gap !== 'none') s += 'Gaps of up to ' + S.cfg.gapMax + ' steps were ' + (S.cfg.gap === 'interp' ? 'linearly interpolated' : 'filled with the last available value') + '. ';
    s += 'The predictors (' + f.names.length + ' in total) were ' + feats.join('; ') + '. ';
    s += 'The ' + f.X.length + ' complete records were split ' + (S.cfg.split === 'random' ? 'randomly' : 'chronologically') + ' into a training period (' + t(tr[0]) + ' to ' + t(tr[tr.length - 1]) + ', n = ' + tr.length + ') and a test period (' + t(te[0]) + ' to ' + t(te[te.length - 1]) + ', n = ' + te.length + ')' + (S.split.valN ? ', with the final ' + Math.round(S.cfg.val * 100) + '% of the training period used for early stopping' : '') + '. ';
    s += 'The models compared were ' + models.join(', ') + (base.length ? ', benchmarked against ' + base.join(' and ') : '') + '. ';
    if (Object.keys(S.cv).length) { const c = Object.values(S.cv)[0]; s += 'Model stability was assessed with ' + c.folds.length + '-fold ' + (c.scheme === 'blocked' ? 'blocked' : 'expanding-window time-series') + ' cross-validation on the training period. '; }
    if (S.tuning && S.tuning.best) s += 'Hyper-parameters of the ' + CAT[S.tuning.model].name.toLowerCase() + ' were tuned by ' + ({ grid: 'grid search', random: 'random search', bayes: 'Bayesian optimisation (Gaussian-process surrogate with expected improvement)' }[S.tuning.method]) + ' over ' + S.tuning.trials.length + ' trials, maximising the ' + S.tuning.folds + '-fold cross-validated ' + S.tuning.metric.toUpperCase() + '. ';
    s += 'Performance was evaluated with the Nash–Sutcliffe efficiency (NSE; Nash and Sutcliffe, 1970), the Kling–Gupta efficiency (KGE; Gupta et al., 2009), the coefficient of determination (R²), RMSE, MAE, percent bias (PBIAS) and the RMSE–observations standard deviation ratio (RSR). ';
    s += 'The ' + CAT[b.type].name.toLowerCase() + ' performed best in the test period (NSE = ' + m.nse.toFixed(3) + ', KGE = ' + m.kge.toFixed(3) + ', R² = ' + m.r2.toFixed(3) + ', RMSE = ' + fmt(m.rmse) + ', PBIAS = ' + m.pbias.toFixed(1) + '%)' + (rt ? ', a rating of “' + rt[1].toLowerCase() + '” following Moriasi et al. (2007)' : '') + '.';
    s += '\n\nReferences\nGupta, H. V., Kling, H., Yilmaz, K. K., & Martinez, G. F. (2009). Decomposition of the mean squared error and NSE performance criteria. Journal of Hydrology, 377(1–2), 80–91.\nMoriasi, D. N., et al. (2007). Model evaluation guidelines for systematic quantification of accuracy in watershed simulations. Transactions of the ASABE, 50(3), 885–900.\nNash, J. E., & Sutcliffe, J. V. (1970). River flow forecasting through conceptual models part I. Journal of Hydrology, 10(3), 282–290.\nJoy, M. R. (2026). Hydro ML Studio [Software]. https://meawman.github.io/tools/hydro-ml/';
    return s;
  }

  // ---------------------------------------------------------------- example data (synthetic)
  // A synthetic but hydrologically shaped catchment: two rain gauges, soil moisture that controls
  // how much rain becomes runoff (non-linear), quick flow + slow baseflow, river routing delays and
  // measurement noise. The upstream gauge sees the flood a day before the downstream station.
  function exampleData() {
    const rng = HML.rng(2024), gauss = () => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const start = Date.UTC(2015, 0, 1), n = 9 * 365 + 2;
    const rows = [['Date', 'Rain_StationA_mm', 'Rain_StationB_mm', 'WL_Upstream_m', 'Temperature_C', 'Discharge_Downstream_m3s']];
    let M = 0.2, QF = 0, B = 2;
    const q = [];
    for (let i = 0; i < n; i++) {
      const doy = i % 365.25, mf = Math.exp(-(((doy - 205) / 50) ** 2));
      const wet = 0.07 + 0.6 * mf;
      const rA = rng() < wet ? -Math.log(rng()) * (5 + 30 * mf) : 0;
      const rB = 0.55 * rA + (rng() < wet * 0.8 ? -Math.log(rng()) * (4 + 22 * mf) : 0) * 0.7;
      const r = (rA + rB) / 2;
      const temp = 26 + 4.5 * Math.sin((2 * Math.PI * (doy - 100)) / 365.25) + 0.8 * gauss();
      M = Math.min(1, Math.max(0, 0.968 * M + r / 140 - (temp - 20) * 0.0006));
      QF = 0.5 * QF + 22 * r * M * M;
      B = 0.993 * B + 0.12 * r * M;
      q.push(35 + 7 * B + QF);
      const wlUp = 1.2 + 0.85 * Math.log(1 + q[i] / 40) + 0.05 * gauss();
      const qd = 0.55 * q[Math.max(0, i - 1)] + 0.3 * q[Math.max(0, i - 2)] + 0.15 * q[Math.max(0, i - 3)];
      rows.push([HIO.fmtDate(start + i * DAY), +rA.toFixed(1), +rB.toFixed(1), +wlUp.toFixed(3), +temp.toFixed(1), +(qd * Math.exp(0.08 * gauss())).toFixed(1)]);
    }
    // realistic gaps (sensor outages)
    const gap = (col, a, len) => { for (let i = a; i < a + len && i + 1 < rows.length; i++) rows[i + 1][col] = ''; };
    gap(5, 620, 18); gap(5, 1490, 9); gap(5, 2511, 30); gap(3, 980, 4); gap(1, 1702, 3); gap(5, 300, 2); gap(2, 2200, 5);
    return [{ name: 'Example', rows }];
  }

  // ================================================================ events
  const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
  const cfgSet = (k, v) => { S.cfg[k] = v; S.version++; rebuild(); };
  // data
  on('dOpen', 'click', () => $('file').click()); on('dReplace', 'click', () => $('file').click());
  on('file', 'change', (e) => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; });
  on('dSample', 'click', () => adopt('example_daily_discharge.csv', exampleData(), true));
  on('dPaste', 'click', () => { $('pasteOv').hidden = false; $('pasteBox').focus(); });
  on('pasteClose', 'click', () => { $('pasteOv').hidden = true; });
  on('pasteGo', 'click', () => { const t = $('pasteBox').value; $('pasteOv').hidden = true; if (t.trim()) loadText(t); });
  on('dSheet', 'change', (e) => { S.cfg.roles = {}; chooseSheet(+e.target.value, true); });
  on('dDate', 'change', (e) => { S.cfg.dateCol = e.target.value || null; S.cfg.roles = {}; chooseSheet(S.cfg.sheet, false); });
  on('dTime', 'change', (e) => { S.cfg.timeCol = e.target.value; S.cfg.roles = {}; chooseSheet(S.cfg.sheet, false); });
  on('dReg', 'change', (e) => cfgSet('regularOnly', e.target.checked));
  on('dOrder', 'change', (e) => cfgSet('order', e.target.value));
  on('dAgg', 'change', (e) => cfgSet('agg', e.target.value));
  on('dGap', 'change', (e) => cfgSet('gap', e.target.value));
  on('dGapMax', 'change', (e) => cfgSet('gapMax', Math.max(1, +e.target.value || 1)));
  on('dIgnore', 'change', (e) => cfgSet('ignore', e.target.value));
  on('dCols', 'change', (e) => {
    const s = e.target.closest('select[data-role]'); if (!s) return;
    const col = s.dataset.role;
    if (s.value === 'target') for (const k of Object.keys(S.cfg.roles)) if (S.cfg.roles[k] === 'target') S.cfg.roles[k] = 'input';
    S.cfg.roles[col] = s.value; S.version++; rebuild();
  });
  on('dPlotCol', 'change', () => { S.dzoom = null; drawDataChart(); });
  // features
  on('fMode', 'change', (e) => cfgSet('mode', e.target.value));
  on('fH', 'change', (e) => cfgSet('horizon', Math.max(1, Math.round(+e.target.value) || 1)));
  on('fLags', 'change', (e) => cfgSet('lags', e.target.value));
  on('fRoll', 'change', (e) => cfgSet('roll', e.target.value));
  on('fRollStat', 'change', (e) => cfgSet('rollStat', e.target.value));
  on('fAr', 'change', (e) => cfgSet('ar', e.target.checked));
  on('fArLags', 'change', (e) => cfgSet('arLags', e.target.value));
  on('fDoy', 'change', (e) => cfgSet('doy', e.target.checked));
  on('fMonth', 'change', (e) => cfgSet('month', e.target.checked));
  on('fTrend', 'change', (e) => cfgSet('trend', e.target.checked));
  on('fInLags', 'change', (e) => {
    if (e.target.id === 'fArLags2') { cfgSet('arLags', e.target.value); return; }
    const el = e.target.closest('[data-il]'); if (!el) return;
    S.cfg.inputLags = Object.assign({}, S.cfg.inputLags);
    S.cfg.inputLags[el.dataset.il] = Object.assign({}, S.cfg.inputLags[el.dataset.il], { [el.dataset.f]: el.value.trim() });
    S.version++; rebuild();
  });
  on('fInLags', 'click', (e) => { const b = e.target.closest('[data-suggest]'); if (b) { $('fLagCol').value = b.dataset.suggest; suggestLags([b.dataset.suggest]); } });
  on('fSuggestAll', 'click', () => suggestLags([...inputs(), ...(S.cfg.ar ? [target()] : [])]));
  on('fResetLags', 'click', () => { S.cfg.inputLags = {}; S.version++; rebuild(); });
  on('fLagCol', 'change', drawLagChart);
  on('fLagMax', 'change', drawLagChart);
  on('fList', 'click', (e) => {
    const b = e.target.closest('[data-feat]'); if (!b) return;
    const ex = new Set(S.cfg.exclude || []), nm = b.dataset.feat;
    ex.has(nm) ? ex.delete(nm) : ex.add(nm);
    S.cfg.exclude = [...ex]; S.version++; rebuild();
  });
  on('fAllOn', 'click', () => { S.cfg.exclude = []; S.version++; rebuild(); });
  // split
  on('tSplit', 'change', (e) => cfgSet('split', e.target.value));
  on('tPct', 'input', (e) => { $('tPctV').textContent = e.target.value + '%'; });
  on('tPct', 'change', (e) => cfgSet('pct', +e.target.value));
  on('tDate', 'change', (e) => cfgSet('splitDate', e.target.value));
  on('tVal', 'change', (e) => cfgSet('val', +e.target.value));
  on('tSeed', 'change', (e) => cfgSet('seed', Math.max(1, Math.round(+e.target.value) || 1)));
  on('tFolds', 'change', (e) => { S.cfg.folds = Math.min(20, Math.max(2, Math.round(+e.target.value) || 5)); e.target.value = S.cfg.folds; });
  on('tCvType', 'change', (e) => { S.cfg.cvType = e.target.value; });
  // models
  on('tModels', 'change', (e) => {
    const cb = e.target.closest('[data-on]');
    if (cb) { S.cfg.on[cb.dataset.on] = cb.checked; cb.closest('.model').classList.toggle('on', cb.checked); return; }
    const p = e.target.closest('[data-mp]'); if (!p) return;
    const type = p.dataset.mt, def = CAT[type].params.find((x) => x.key === p.dataset.mp);
    let v = def.type === 'check' ? p.checked : def.type === 'number' ? +p.value : p.value;
    if (def.type === 'number') { if (!isFinite(v)) v = def.def; if (def.min != null) v = Math.max(def.min, v); if (def.max != null) v = Math.min(def.max, v); if (def.int) v = Math.round(v); p.value = v; }
    S.cfg.params[type][def.key] = v;
  });
  on('tModels', 'click', (e) => {
    if (e.target.closest('[data-on]')) e.stopPropagation();
    const a = e.target.closest('[data-tune]');
    if (a) { e.preventDefault(); S.cfg.tune.model = a.dataset.tune; renderTuneCard(); $('tuneCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  on('tAll', 'click', () => { ORDER.forEach((t) => { S.cfg.on[t] = true; }); renderModels(); });
  on('tNone', 'click', () => { ORDER.forEach((t) => { S.cfg.on[t] = false; }); renderModels(); });
  on('tTrain', 'click', () => trainSelected());
  on('tCv', 'click', crossValidate);
  on('tCancel', 'click', () => { WM.cancel(); Object.values(S.runs).forEach((r) => { if (!CAT[r.type].baseline) r.alive = false; }); S.imported.forEach((m) => { m.alive = false; }); });
  // tuning
  on('uModel', 'change', (e) => { S.cfg.tune.model = e.target.value; renderTuneCard(); });
  on('uMethod', 'change', (e) => { S.cfg.tune.method = e.target.value; renderTuneCard(); });
  on('uIter', 'change', (e) => { S.cfg.tune.nIter = Math.min(200, Math.max(4, Math.round(+e.target.value) || 20)); renderTuneCard(); });
  on('uFolds', 'change', (e) => { S.cfg.tune.folds = Math.min(10, Math.max(2, Math.round(+e.target.value) || 3)); renderTuneCard(); });
  on('uCvType', 'change', (e) => { S.cfg.tune.cvType = e.target.value; });
  on('uMetric', 'change', (e) => { S.cfg.tune.metric = e.target.value; });
  on('uSpace', 'change', (e) => {
    const el = e.target.closest('[data-sp]'); if (!el) return;
    const type = S.cfg.tune.model, sp = (S.cfg.tune.space[type] = S.cfg.tune.space[type] || {}), cur = (sp[el.dataset.sp] = sp[el.dataset.sp] || {});
    const f = el.dataset.f;
    if (f === 'values') cur.values = el.value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (f === 'grid') cur.grid = el.value;
    else if (f === 'log') cur.log = el.value === '1';
    else cur[f] = +el.value;
    renderTuneCard();
  });
  on('uRun', 'click', runTuning);
  on('uStop', 'click', () => { WM.cancel(); Object.values(S.runs).forEach((r) => { if (!CAT[r.type].baseline) r.alive = false; }); S.imported.forEach((m) => { m.alive = false; }); });
  on('uApply', 'click', applyBest);
  // results
  on('rSet', 'change', (e) => { S.evalSet = e.target.value; renderResults(); });
  on('rLb', 'click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (th) { lbSort = { key: th.dataset.sort, dir: lbSort.key === th.dataset.sort ? -lbSort.dir : -1 }; renderResults(); return; }
    const tr = e.target.closest('[data-run]'); if (tr) { S.focus = tr.dataset.run; renderResults(); }
  });
  on('rTabs', 'click', (e) => { const b = e.target.closest('[data-chart]'); if (b) { S.chart = b.dataset.chart; renderResults(); } });
  on('rModel', 'change', (e) => { S.focus = e.target.value; renderResults(); });
  on('rFeat', 'change', () => drawResultChart());
  on('rImp', 'change', () => drawResultChart());
  on('rRetrain', 'click', () => trainSelected(Object.keys(S.runs)));
  on('rTrainMissing', 'click', () => trainSelected(ORDER.filter((t) => S.cfg.on[t] && !S.runs[t])));
  on('rPng', 'click', () => HC.savePng($('rChart').querySelector('svg.hc') ? $('rChart') : $('rChart').firstElementChild || $('rChart'), 'HydroML_' + S.chart + '_' + (S.focus || ''), S.chart === 'hydro' ? target() : CAT[S.focus].name + ' — ' + S.chart));
  on('rSvg', 'click', () => HC.saveSvg($('rChart').querySelector('svg.hc') ? $('rChart') : $('rChart').firstElementChild || $('rChart'), 'HydroML_' + S.chart + '_' + (S.focus || ''), CAT[S.focus].name));
  on('rCopy', 'click', async () => {
    const rows = $$('#rLb tr').map((tr) => $$('th,td', tr).map(cellText).join('\t')).join('\n');
    try { await navigator.clipboard.writeText(rows); msg('Leaderboard copied — paste it into Excel or Word.', 'ok'); } catch (e) { msg('Copy failed: ' + e.message, 'err'); }
  });
  on('rPrev', 'click', () => { const rs = runList(), i = rs.findIndex((r) => r.type === S.focus); if (rs.length) { S.focus = rs[(i - 1 + rs.length) % rs.length].type; renderResults(); } });
  on('rNext', 'click', () => { const rs = runList(), i = rs.findIndex((r) => r.type === S.focus); if (rs.length) { S.focus = rs[(i + 1) % rs.length].type; renderResults(); } });
  on('rSaveModel', 'click', () => { const r = S.runs[S.focus]; if (r) saveModel(r); });
  on('rUseModel', 'click', () => { S.pickModel = 'run:' + S.focus; renderPredict(); location.hash = '#predict'; });
  on('xZip', 'click', exportZip);
  on('xModels', 'click', saveAllModels);
  on('xXlsx', 'click', exportXlsx);
  on('xMethods', 'click', () => { $('methodsBox').value = methodsText(); $('methodsOv').hidden = false; });
  on('methodsClose', 'click', () => { $('methodsOv').hidden = true; });
  on('methodsCopy', 'click', async () => { try { await navigator.clipboard.writeText($('methodsBox').value); msg('Methods paragraph copied.', 'ok'); } catch (e) { $('methodsBox').select(); } });
  on('xSave', 'click', () => HIO.download(new Blob([settingsJson()], { type: 'application/json' }), 'HydroML_settings_' + stamp() + '.json'));
  on('xLoad', 'click', () => $('jfile').click());
  on('jfile', 'change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text()); if (!j.cfg) throw new Error('Not a Hydro ML Studio settings file');
      const d = defaults();
      S.cfg = Object.assign(d, j.cfg, { params: Object.assign(d.params, j.cfg.params || {}), on: Object.assign(d.on, j.cfg.on || {}), tune: Object.assign(d.tune, j.cfg.tune || {}) });
      S.version++; if (S.table) chooseSheet(Math.min(S.cfg.sheet || 0, S.file.sheets.length - 1), false); else renderAll();
      msg('Settings loaded. Train the models to apply them.', 'ok');
    } catch (err) { msg(err.message, 'err'); }
  });
  // predict
  on('pLoadModel', 'click', () => $('mfile').click());
  on('mfile', 'change', (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) loadModels(fs); });
  on('pFill', 'click', fillGaps);
  on('pNew', 'click', () => $('pfile').click());
  on('pfile', 'change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) predictNewFile(f); });
  on('pXlsx', 'click', exportPredict);
  on('pPng', 'click', () => HC.savePng($('pChart'), 'HydroML_prediction', $('pTitle').textContent));
  // navigation buttons
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); location.hash = '#' + g.dataset.go; } });
  // drop & paste
  let depth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; $('dropOv').hidden = false; $('dropOv').textContent = visible('predict') && modelHandles().length ? 'Drop the file to predict with the selected model' : 'Drop the file to load it'; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('dropOv').hidden = true; } });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; $('dropOv').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files[0]; if (!f) return;
    if (visible('predict') && modelHandles().length) predictNewFile(f); else { loadFile(f); location.hash = '#data'; }
  });
  document.addEventListener('paste', (e) => {
    if (/input|textarea/i.test((e.target && e.target.tagName) || '')) return;
    const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (t.split('\n').length > 3) { e.preventDefault(); loadText(t); location.hash = '#data'; }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('pasteOv').hidden = true; $('methodsOv').hidden = true; } });
  // redraw charts when the tab or the window size changes
  let rz = 0;
  const redraw = () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => {
      renderSteps();
      if (visible('data')) drawDataChart();
      if (visible('features')) drawFeatureCharts();
      if (visible('train')) { drawSplitChart(); renderTuning(); }
      if (visible('results')) renderResults();
      if (visible('predict') && S.predict) drawPredict();
    });
  };
  window.addEventListener('resize', redraw);
  window.addEventListener('hashchange', redraw);

  renderAll();
  msg('Ready. Load a file, paste from Excel, or try the example.');
})();
