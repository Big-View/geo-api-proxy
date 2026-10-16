/**
 * Études (runs) et progression d'une marque
 * Une étude = toutes les lignes d'historique partageant le même run_id.
 *
 *   GET /api/runs?brand=&limit=        → liste des études de la marque avec leurs indicateurs
 *   GET /api/runs/last?brand=          → prompts, concurrents, secteur, angle de la dernière étude
 *                                        (pour relancer exactement la même étude)
 *   GET /api/progress?brand=&run=      → étude choisie (défaut : la dernière) comparée à la précédente,
 *                                        globalement et prompt par prompt
 */

module.exports = function(app, { checkAuth, historyConfigured, readRunRows, aggregateShareOfVoice, normalize }) {

  const needBrand = (req, res) => {
    if (!checkAuth(req, res)) return null;
    if (!historyConfigured()) { res.status(503).json({ error: 'History not configured', configured: false }); return null; }
    const brand = req.query.brand ? String(req.query.brand) : '';
    if (!brand) { res.status(400).json({ error: 'Bad Request', message: 'brand is required' }); return null; }
    return brand;
  };

  app.get('/api/runs', async (req, res) => {
    const brand = needBrand(req, res); if (!brand) return;
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);
    try {
      const runs = groupRuns(await readRunRows({ brand }));
      const out = runs.slice(-limit).map(r => runSummary(r, brand, aggregateShareOfVoice));
      return res.json({ status: 'success', brand, runs: addDeltas(out).reverse() });
    } catch (error) {
      console.error('❌ [ERROR] runs:', error.message);
      return res.status(500).json({ error: 'Runs Error', message: error.message });
    }
  });

  app.get('/api/runs/last', async (req, res) => {
    const brand = needBrand(req, res); if (!brand) return;
    try {
      const runs = groupRuns(await readRunRows({ brand }));
      const last = runs[runs.length - 1];
      if (!last) return res.json({ status: 'success', brand, found: false });
      return res.json({ status: 'success', brand, found: true, ...runSetup(last) });
    } catch (error) {
      console.error('❌ [ERROR] runs/last:', error.message);
      return res.status(500).json({ error: 'Runs Error', message: error.message });
    }
  });

  app.get('/api/progress', async (req, res) => {
    const brand = needBrand(req, res); if (!brand) return;
    try {
      const runs = groupRuns(await readRunRows({ brand, withExcerpt: false }));
      const ctx = pickRun(runs, req.query.run);
      if (!ctx.current) return res.json({ status: 'success', brand, found: false });
      return res.json({ status: 'success', brand, found: true, ...buildProgress(ctx, brand, aggregateShareOfVoice, normalize) });
    } catch (error) {
      console.error('❌ [ERROR] progress:', error.message);
      return res.status(500).json({ error: 'Progress Error', message: error.message });
    }
  });
};

// =====================================================
// Fonctions partagées (aussi utilisées par les exports)
// =====================================================

// Regroupe les lignes par run_id, études triées de la plus ancienne à la plus récente
function groupRuns(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const id = r.run_id || `sans-id-${String(r.created_at || '').slice(0, 10)}`;
    if (!map.has(id)) map.set(id, { run_id: id, rows: [] });
    map.get(id).rows.push(r);
  }
  const runs = [...map.values()];
  for (const run of runs) {
    run.rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    run.date = run.rows[0] && run.rows[0].created_at;
  }
  return runs.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Étude demandée (id ou « latest ») et celle qui la précède
function pickRun(runs, runId) {
  let idx = runs.length - 1;
  if (runId && runId !== 'latest') idx = runs.findIndex(r => r.run_id === runId);
  return { current: idx >= 0 ? runs[idx] : null, previous: idx > 0 ? runs[idx - 1] : null, history: idx >= 0 ? runs.slice(0, idx + 1) : [] };
}

// Configuration réutilisable d'une étude : prompts dans l'ordre, concurrents, secteur, angle
function runSetup(run) {
  const prompts = [];
  for (const r of run.rows) if (r.prompt && !prompts.includes(r.prompt)) prompts.push(r.prompt);
  const first = run.rows.find(r => Array.isArray(r.competitors) && r.competitors.length) || run.rows[0] || {};
  return {
    run_id: run.run_id,
    date: run.date,
    prompts,
    competitors: Array.isArray(first.competitors) ? first.competitors : [],
    sector: first.sector || null,
    angle: first.angle || null,
    providers: [...new Set(run.rows.map(r => r.provider).filter(Boolean))]
  };
}

function runSummary(run, brand, aggregate) {
  const agg = aggregate(run.rows, brand);
  const f = agg.focus || {};
  return {
    run_id: run.run_id,
    date: run.date,
    prompts: new Set(run.rows.map(r => r.prompt)).size,
    responses: agg.responses,
    shareOfVoice: f.shareOfVoice ?? 0,
    mentionRate: f.mentionRate ?? 0,
    avgRank: f.avgRank ?? null,
    firstCitedRate: f.firstCitedRate ?? null,
    sentimentScore: f.sentimentScore ?? null,
    position: f.position ?? null
  };
}

// Ajoute à chaque étude l'écart avec la précédente (en points ou en valeur)
function addDeltas(summaries) {
  return summaries.map((s, i) => {
    const p = summaries[i - 1];
    const d = (k) => (p && s[k] != null && p[k] != null) ? Math.round((s[k] - p[k]) * 100) / 100 : null;
    return { ...s, delta: p ? { shareOfVoice: d('shareOfVoice'), mentionRate: d('mentionRate'), avgRank: d('avgRank'), firstCitedRate: d('firstCitedRate'), sentimentScore: d('sentimentScore') } : null };
  });
}

// Résultat de la marque pour un prompt et un moteur dans une étude
function cellResult(rows, prompt, provider, brand, normalize) {
  const r = rows.find(x => x.prompt === prompt && x.provider === provider);
  if (!r) return null;
  const key = Object.keys(r.mentions || {}).find(k => normalize(k) === normalize(brand)) || brand;
  const count = Number((r.mentions || {})[key]) || 0;
  const rank = count > 0 ? (parseInt((r.ranks || {})[key], 10) || null) : null;
  const sent = count > 0 ? (r.sentiments || {})[key] || null : null;
  return { mentioned: count > 0, count, rank, sentiment: sent ? sent.label : null, score: sent ? sent.score : null, error: r.error || null, excerpt: r.excerpt || null };
}

function trendOf(before, now) {
  if (!now) return 'absent';
  if (!before) return 'nouveau';
  if (now.mentioned && !before.mentioned) return 'gagné';
  if (!now.mentioned && before.mentioned) return 'perdu';
  if (now.mentioned && before.mentioned && now.rank && before.rank) {
    if (now.rank < before.rank) return 'en hausse';
    if (now.rank > before.rank) return 'en baisse';
  }
  return 'stable';
}

function buildProgress({ current, previous, history }, brand, aggregate, normalize) {
  const summaries = addDeltas(history.map(r => runSummary(r, brand, aggregate)));
  const now = summaries[summaries.length - 1];
  const setup = runSetup(current);
  const prevRows = previous ? previous.rows : [];
  const providers = [...new Set(current.rows.map(r => r.provider).filter(Boolean))];

  const prompts = setup.prompts.map(prompt => {
    const cells = providers.map(provider => {
      const n = cellResult(current.rows, prompt, provider, brand, normalize);
      const b = previous ? cellResult(prevRows, prompt, provider, brand, normalize) : null;
      return { provider, now: n, before: b, trend: trendOf(b, n) };
    });
    const mentionedNow = cells.filter(c => c.now && c.now.mentioned).length;
    const mentionedBefore = cells.filter(c => c.before && c.before.mentioned).length;
    return { prompt, mentionedNow, mentionedBefore, providers: cells.length, cells };
  });

  return {
    run: { run_id: current.run_id, date: current.date },
    previous: previous ? { run_id: previous.run_id, date: previous.date } : null,
    summary: now,
    timeline: summaries,
    providers,
    prompts
  };
}

module.exports.groupRuns = groupRuns;
module.exports.pickRun = pickRun;
module.exports.runSetup = runSetup;
module.exports.runSummary = runSummary;
module.exports.addDeltas = addDeltas;
module.exports.buildProgress = buildProgress;
