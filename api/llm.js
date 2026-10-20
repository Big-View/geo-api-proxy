/**
 * API PROXY MULTI-CHANNEL - Version 2.6
 * Routes :
 *   POST /api/llm      → interroge un canal (openai, anthropic, google, perplexity, google_overviews)
 *   POST /api/suggest  → suggère des prompts (brand, sector, angle) via Claude
 *   POST /api/history  → enregistre les résultats d'un run (Supabase)
 *   GET  /api/history  → lit l'historique (?brand=&days=&limit=)
 *   GET  /api/sov      → Share of Voice agrégé depuis l'historique (?brand=&days=&provider=)
 *   POST /api/sov      → Share of Voice agrégé sur des lignes fournies ({ brand, rows[] })
 *   GET  /api/export   → export ?format=csv|pdf|slides&brand= (&run=latest|<id> par défaut, ou &days=)
 *   GET  /api/runs     → études d'une marque et leurs indicateurs (?brand=&limit=)
 *   GET  /api/runs/last → prompts / concurrents de la dernière étude, pour la relancer (?brand=)
 *   GET  /api/progress → étude comparée à la précédente, global et par prompt (?brand=&run=)
 *   POST /api/export   → export { format, brand, rows[] } sur des lignes fournies
 *   GET  /api/health   → état de la config
 *
 * Marques (champ `brands`) : chaînes ou objets { name, aliases?: [], domain? }.
 *   Détection par mot entier, insensible casse/accents, tolérante aux séparateurs
 *   (« Big View » = « BigView » = « big-view »). Le domaine sert aux citations.
 *
 * Sentiment : /api/llm analyse le ton employé pour chaque marque citée (Claude, sortie JSON
 *   structurée). Désactivable par requête avec `sentiment: false`. Modèle : SENTIMENT_MODEL.
 * Historique : colonnes `ranks` et `sentiments` (jsonb), voir supabase/migrations/.
 * Google Slides : GOOGLE_SERVICE_ACCOUNT_JSON (+ GOOGLE_SLIDES_FOLDER_ID, GOOGLE_IMPERSONATE,
 *   GOOGLE_SLIDES_SHARE_WITH optionnels), voir api/export.js.
 *
 * Variables d'environnement :
 *   TEAM_TOKEN, API_KEY_OPENAI, API_KEY_ANTHROPIC, API_KEY_GOOGLE, API_KEY_PERPLEXITY
 *   GEMINI_MODEL (défaut gemini-3.6-flash), SERPAPI_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (optionnels : sans eux, l'historique est désactivé)
 */

module.exports = function(app) {

  // ---------- Auth commune ----------
  function checkAuth(req, res) {
    let token = req.headers['x-geo-token'];
    const TEAM_TOKEN = process.env.TEAM_TOKEN;
    if (token) token = decodeURIComponent(token);
    if (!token || !TEAM_TOKEN || token !== TEAM_TOKEN) {
      console.log("❌ [UNAUTHORIZED] token", token ? "présent mais invalide" : "manquant");
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing authentication token' });
      return false;
    }
    return true;
  }

  // ---------- Health ----------
  app.get("/api/health", async (req, res) => {
    res.json({
      serpapi: await getSerpApiQuota(),
      ok: true,
      providers: {
        openai: !!process.env.API_KEY_OPENAI,
        anthropic: !!process.env.API_KEY_ANTHROPIC,
        google: !!process.env.API_KEY_GOOGLE,
        perplexity: !!process.env.API_KEY_PERPLEXITY,
        google_overviews: !!(process.env.SERPAPI_KEY || (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID))
      },
      history: historyConfigured(),
      sentiment: !!process.env.API_KEY_ANTHROPIC,
      exports: { csv: true, pdf: true, slides: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON }
    });
  });

  // ---------- LLM ----------
  app.post("/api/llm", async (req, res) => {
    if (!checkAuth(req, res)) return;
    const { provider, query, brands, location, sentiment } = req.body;
    console.log(`📤 [DISPATCHING] Provider: ${provider}`);

    if (!provider) return res.status(400).json({ error: 'Bad Request', message: 'Provider parameter is required' });
    if (!query)    return res.status(400).json({ error: 'Bad Request', message: 'Query parameter is required' });

    try {
      let response;
      switch (provider.toLowerCase()) {
        case 'openai':           response = await callOpenAI(query); break;
        case 'anthropic':        response = await callAnthropic(query); break;
        case 'google':           response = await callGoogle(query); break;
        case 'perplexity':       response = await callPerplexity(query); break;
        case 'google_overviews': response = await analyzeGoogleOverviews(query, brands, location); break;
        default:
          return res.status(400).json({ error: 'Unknown provider', message: `Provider '${provider}' is not supported` });
      }
      enrichWithShareOfVoice(response, brands);
      if (sentiment !== false) await enrichWithSentiment(response, query);
      console.log(`✅ [SUCCESS] ${provider}`);
      return res.status(200).json(response);
    } catch (error) {
      console.error(`❌ [ERROR] ${provider}:`, error.message);
      return res.status(error.status || 500).json({ error: error.code || 'API Error', message: error.message, provider });
    }
  });

  // ---------- Suggestion de prompts ----------
  app.post("/api/suggest", async (req, res) => {
    if (!checkAuth(req, res)) return;
    const { brand, sector, angle, count, language } = req.body;
    if (!brand) return res.status(400).json({ error: 'Bad Request', message: 'brand is required' });

    try {
      const prompts = await suggestPrompts({ brand, sector, angle, count, language });
      return res.json({ status: 'success', angle: angle || 'direct', prompts });
    } catch (error) {
      console.error("❌ [ERROR] suggest:", error.message);
      return res.status(500).json({ error: 'API Error', message: error.message });
    }
  });

  // ---------- Historique ----------
  app.post("/api/history", async (req, res) => {
    if (!checkAuth(req, res)) return;
    if (!historyConfigured()) return res.status(503).json({ error: 'History not configured', configured: false });

    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'Bad Request', message: 'rows[] is required' });

    const clean = rows.map(r => ({
      ...historyExtras(r),
      run_id: String(r.run_id || ''),
      brand: String(r.brand || '').slice(0, 200),
      competitors: Array.isArray(r.competitors) ? r.competitors.slice(0, 20) : [],
      sector: r.sector ? String(r.sector).slice(0, 200) : null,
      angle: r.angle ? String(r.angle).slice(0, 50) : null,
      prompt: String(r.prompt || '').slice(0, 2000),
      provider: String(r.provider || '').slice(0, 50),
      mentioned: !!r.mentioned,
      mentions: r.mentions && typeof r.mentions === 'object' ? r.mentions : {},
      has_ai_overview: r.has_ai_overview === true ? true : (r.has_ai_overview === false ? false : null),
      excerpt: r.excerpt ? String(r.excerpt).slice(0, 4000) : null,
      error: r.error ? String(r.error).slice(0, 500) : null
    }));

    try {
      try {
        await supabase('POST', 'geo_runs', clean, { Prefer: 'return=minimal' });
      } catch (e) {
        if (!isMissingColumnError(e)) throw e;
        // Migration rang/sentiment pas encore appliquée : on enregistre sans ces colonnes
        console.warn("⚠️ [HISTORY] colonnes ranks/sentiments absentes, enregistrement sans");
        await supabase('POST', 'geo_runs', clean.map(({ ranks, sentiments, ...rest }) => rest), { Prefer: 'return=minimal' });
        return res.json({ status: 'success', saved: clean.length, warning: 'ranks/sentiments non enregistrés : appliquer la migration supabase' });
      }
      return res.json({ status: 'success', saved: clean.length });
    } catch (error) {
      console.error("❌ [ERROR] history save:", error.message);
      return res.status(500).json({ error: 'History Error', message: error.message });
    }
  });

  app.get("/api/history", async (req, res) => {
    if (!checkAuth(req, res)) return;
    if (!historyConfigured()) return res.status(503).json({ error: 'History not configured', configured: false });

    const brand = req.query.brand ? String(req.query.brand) : null;
    const days = Math.min(parseInt(req.query.days || '90', 10) || 90, 365);
    const limit = Math.min(parseInt(req.query.limit || '2000', 10) || 2000, 5000);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    try {
      const rows = await readHistory({
        select: 'id,created_at,run_id,brand,competitors,sector,angle,prompt,provider,mentioned,mentions,has_ai_overview,error',
        order: 'created_at.desc', limit, since, brand
      });
      return res.json({ status: 'success', configured: true, rows });
    } catch (error) {
      console.error("❌ [ERROR] history read:", error.message);
      return res.status(500).json({ error: 'History Error', message: error.message });
    }
  });

  // ---------- Share of Voice agrégé ----------
  app.get("/api/sov", async (req, res) => {
    if (!checkAuth(req, res)) return;
    if (!historyConfigured()) return res.status(503).json({ error: 'History not configured', configured: false });

    const { brand, provider, days } = sovFilters(req.query);

    try {
      const rows = await readSovRows({ brand, provider, days });
      return res.json({ status: 'success', days, ...aggregateShareOfVoice(rows, brand) });
    } catch (error) {
      console.error("❌ [ERROR] sov:", error.message);
      return res.status(500).json({ error: 'SoV Error', message: error.message });
    }
  });

  app.post("/api/sov", (req, res) => {
    if (!checkAuth(req, res)) return;
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 5000) : [];
    if (!rows.length) return res.status(400).json({ error: 'Bad Request', message: 'rows[] is required' });
    return res.json({ status: 'success', ...aggregateShareOfVoice(rows, req.body.brand || null) });
  });

  // ---------- Exports CSV / PDF / Google Slides ----------
  require('./export.js')(app, { checkAuth, historyConfigured, readSovRows, readRunRows, sovFilters, aggregateShareOfVoice, normalize });

  // ---------- Études : relancer les mêmes prompts, progression ----------
  require('./runs.js')(app, { checkAuth, historyConfigured, readRunRows, aggregateShareOfVoice, normalize });
};

// =====================================================
// Lecture historique (avec repli si la migration rang/sentiment n'est pas appliquée)
// =====================================================
function sovFilters(q) {
  return {
    brand: q.brand ? String(q.brand) : null,
    provider: q.provider ? String(q.provider) : null,
    days: Math.min(parseInt(q.days || '90', 10) || 90, 365)
  };
}

function isMissingColumnError(e) {
  return /PGRST204|42703|column .* does not exist|Could not find the '.*' column/i.test(String(e && e.message));
}

async function readHistory({ select, order, limit, since, brand, provider }) {
  const build = (sel) => {
    const params = new URLSearchParams({ select: sel, order, limit: String(limit), created_at: `gte.${since}` });
    if (brand) params.set('brand', `eq.${brand}`);
    if (provider) params.set('provider', `eq.${provider}`);
    return `geo_runs?${params}`;
  };
  try {
    return await supabase('GET', build(`${select},ranks,sentiments`));
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    return supabase('GET', build(select));
  }
}

// Toutes les lignes d'une marque sur 1 an, pour reconstituer ses études (run_id)
function readRunRows({ brand, withExcerpt = true }) {
  return readHistory({
    select: `created_at,run_id,brand,competitors,sector,angle,prompt,provider,mentioned,mentions,has_ai_overview,error${withExcerpt ? ',excerpt' : ''}`,
    order: 'created_at.asc', limit: 5000,
    since: new Date(Date.now() - 365 * 86400000).toISOString(),
    brand
  });
}

function readSovRows({ brand, provider, days }) {
  return readHistory({
    select: 'created_at,run_id,brand,competitors,prompt,provider,mentioned,mentions,has_ai_overview,error,excerpt',
    order: 'created_at.asc', limit: 5000,
    since: new Date(Date.now() - days * 86400000).toISOString(),
    brand, provider
  });
}

// ranks { marque: rang|null } et sentiments { marque: { label, score } } d'une ligne d'historique.
// Acceptés tels quels, ou dérivés de brandStats (réponse brute de /api/llm).
function historyExtras(r) {
  const ranks = {}, sentiments = {};
  const src = r.brandStats && typeof r.brandStats === 'object' ? r.brandStats : null;
  if (r.ranks && typeof r.ranks === 'object') Object.assign(ranks, r.ranks);
  else if (src) for (const [k, v] of Object.entries(src)) ranks[k] = v && v.rank != null ? v.rank : null;
  if (r.sentiments && typeof r.sentiments === 'object') Object.assign(sentiments, r.sentiments);
  else if (src) for (const [k, v] of Object.entries(src)) if (v && v.sentiment) sentiments[k] = v.sentiment;

  const cleanRanks = {}, cleanSent = {};
  for (const [k, v] of Object.entries(ranks).slice(0, 25)) {
    const n = parseInt(v, 10);
    cleanRanks[String(k).slice(0, 200)] = Number.isFinite(n) && n > 0 ? n : null;
  }
  for (const [k, v] of Object.entries(sentiments).slice(0, 25)) {
    if (!v || !SENTIMENT_LABELS.includes(v.label)) continue;
    const score = Math.max(-1, Math.min(1, Number(v.score) || 0));
    cleanSent[String(k).slice(0, 200)] = { label: v.label, score: Math.round(score * 100) / 100, ...(v.reason ? { reason: String(v.reason).slice(0, 300) } : {}) };
  }
  return { ranks: cleanRanks, sentiments: cleanSent };
}

// =====================================================
// Utilitaires
// =====================================================
async function readError(response) {
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return json.error?.message || json.message || json.error || text;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

// =====================================================
// Détection des mentions & Share of Voice
// =====================================================
function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// { name, aliases[], domain } normalisé ; accepte une chaîne ou un objet
function toBrandSpec(b) {
  if (typeof b === 'string') return b.trim() ? { name: b.trim(), aliases: [], domain: null } : null;
  if (!b || !b.name) return null;
  const aliases = Array.isArray(b.aliases) ? b.aliases.map(a => String(a).trim()).filter(Boolean).slice(0, 10) : [];
  const domain = b.domain ? normalize(b.domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') : null;
  return { name: String(b.name).trim(), aliases, domain };
}

// Regex d'une marque : mot entier, séparateurs (espace, tiret, point, rien) interchangeables
const brandRegexCache = new Map();
function brandRegex(spec) {
  const key = JSON.stringify(spec);
  if (brandRegexCache.has(key)) return brandRegexCache.get(key);
  const variants = [spec.name, ...spec.aliases, ...(spec.domain ? [spec.domain] : [])]
    .map(v => normalize(v).trim())
    .filter(Boolean)
    .map(v => v.split(/[\s\-_.']+/).filter(Boolean).map(escapeRe).join("[\\s\\-_.']?"))
    .sort((a, b) => b.length - a.length);
  const re = variants.length ? new RegExp(`(?<![a-z0-9])(?:${variants.join('|')})(?![a-z0-9])`, 'g') : null;
  if (brandRegexCache.size > 500) brandRegexCache.clear();
  brandRegexCache.set(key, re);
  return re;
}

// Analyse un texte : nombre de mentions, position de 1re mention, rang d'apparition
function analyzeMentions(text, brands) {
  const counts = {}, stats = {};
  if (!Array.isArray(brands)) return { counts, stats };
  const hay = normalize(text);
  for (const spec of brands.map(toBrandSpec).filter(Boolean)) {
    const re = brandRegex(spec);
    let count = 0, first = -1;
    if (re && hay) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(hay)) !== null) {
        if (first === -1) first = m.index;
        count++;
      }
    }
    counts[spec.name] = count;
    stats[spec.name] = { count, mentioned: count > 0, firstPosition: first === -1 ? null : first, rank: null };
  }
  Object.entries(stats)
    .filter(([, st]) => st.mentioned)
    .sort((a, b) => a[1].firstPosition - b[1].firstPosition)
    .forEach(([, st], i) => { st.rank = i + 1; });
  return { counts, stats };
}

function hostnameOf(link) {
  try { return new URL(link).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

// Citations / sources attribuées à chaque marque (domaine déclaré, sinon nom compacté dans le domaine)
function attributeSources(sources, brands) {
  const out = {};
  if (!Array.isArray(brands)) return out;
  const specs = brands.map(toBrandSpec).filter(Boolean);
  for (const spec of specs) out[spec.name] = 0;
  for (const src of sources || []) {
    const host = hostnameOf(src.link || src.url || '');
    if (!host) continue;
    const compactHost = host.replace(/[^a-z0-9]/g, '');
    for (const spec of specs) {
      const keys = [spec.name, ...spec.aliases].map(v => normalize(v).replace(/[^a-z0-9]/g, '')).filter(k => k.length >= 4);
      const hit = spec.domain
        ? (host === spec.domain || host.endsWith('.' + spec.domain))
        : keys.some(k => compactHost.includes(k));
      if (hit) out[spec.name]++;
    }
  }
  return out;
}

function shareOf(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const out = {};
  for (const [k, v] of Object.entries(counts)) out[k] = total ? Math.round((v / total) * 1000) / 10 : 0;
  return out;
}

// Ajoute brandMentions / brandStats / shareOfVoice / sourceMentions à une réponse de provider
function enrichWithShareOfVoice(response, brands) {
  const text = response.mentionText != null ? response.mentionText : response.content;
  delete response.mentionText;
  const { counts, stats } = analyzeMentions(text, brands);
  response.brandMentions = counts;
  response.brandStats = stats;
  response.shareOfVoice = shareOf(counts);
  if (Array.isArray(response.sources)) {
    response.sourceMentions = attributeSources(response.sources, brands);
    response.citationShare = shareOf(response.sourceMentions);
  }
  return response;
}

// Agrégation multi-réponses. Lignes au format geo_runs : { brand, provider, prompt, mentions{}, error, created_at }
function aggregateShareOfVoice(rows, focusBrand) {
  const valid = (rows || []).filter(r => r && !r.error && r.mentions && typeof r.mentions === 'object');
  const blank = () => ({ mentions: 0, responsesWithMention: 0, mostMentioned: 0, rankSum: 0, rankCount: 0, citedFirst: 0, sentSum: 0, sentCount: 0, positive: 0, neutral: 0, negative: 0, levels: emptyLevels() });
  const totals = {}, byProvider = {}, byWeek = {};
  let responsesWithAnyBrand = 0;

  const add = (bucket, name, n, isLeader, rank, sent) => {
    const b = bucket[name] || (bucket[name] = blank());
    b.mentions += n;
    if (n > 0) b.responsesWithMention++;
    if (isLeader) b.mostMentioned++;
    if (rank) { b.rankSum += rank; b.rankCount++; if (rank === 1) b.citedFirst++; }
    if (sent && SENTIMENT_LABELS.includes(sent.label)) {
      b[sent.label]++;
      b.sentSum += Number(sent.score) || 0;
      b.sentCount++;
      const lv = levelOf(Number(sent.score) || 0);
      if (lv) b.levels[lv.key]++;
    }
  };

  for (const r of valid) {
    const counts = Object.fromEntries(Object.entries(r.mentions).map(([k, v]) => [k, Number(v) || 0]));
    const leader = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const leaderName = leader && leader[1] > 0 ? leader[0] : null;
    if (leaderName) responsesWithAnyBrand++;
    const prov = String(r.provider || 'unknown');
    const week = r.created_at ? isoWeek(new Date(r.created_at)) : 'n/a';
    byProvider[prov] = byProvider[prov] || { responses: 0, brands: {} };
    byProvider[prov].responses++;
    byWeek[week] = byWeek[week] || { responses: 0, brands: {} };
    byWeek[week].responses++;
    const ranks = r.ranks && typeof r.ranks === 'object' ? r.ranks : {};
    const sents = r.sentiments && typeof r.sentiments === 'object' ? r.sentiments : {};
    for (const [name, n] of Object.entries(counts)) {
      const rank = n > 0 ? parseInt(ranks[name], 10) || null : null;
      const args = [name, n, name === leaderName, rank, n > 0 ? sents[name] : null];
      add(totals, ...args);
      add(byProvider[prov].brands, ...args);
      add(byWeek[week].brands, ...args);
    }
  }

  const finalize = (brandsMap, responses) => {
    const totalMentions = Object.values(brandsMap).reduce((a, b) => a + b.mentions, 0);
    return Object.entries(brandsMap)
      .map(([name, b]) => ({
        brand: name,
        mentions: b.mentions,
        shareOfVoice: totalMentions ? round1((b.mentions / totalMentions) * 100) : 0,
        mentionRate: responses ? round1((b.responsesWithMention / responses) * 100) : 0,
        leadRate: responses ? round1((b.mostMentioned / responses) * 100) : 0,
        responsesWithMention: b.responsesWithMention,
        avgRank: b.rankCount ? round1(b.rankSum / b.rankCount) : null,
        firstCitedRate: b.rankCount ? round1((b.citedFirst / b.rankCount) * 100) : null,
        sentimentScore: b.sentCount ? Math.round((b.sentSum / b.sentCount) * 100) / 100 : null,
        sentiment: { positive: b.positive, neutral: b.neutral, negative: b.negative },
        // 5 niveaux (très positif → très négatif) et niveau du sentiment général
        sentimentLevels: b.levels,
        sentimentLevel: b.sentCount ? levelOf(b.sentSum / b.sentCount).key : null
      }))
      .sort((a, b) => b.shareOfVoice - a.shareOfVoice || b.mentionRate - a.mentionRate);
  };

  const ranking = finalize(totals, valid.length);
  const focus = focusBrand ? ranking.find(x => normalize(x.brand) === normalize(focusBrand)) || null : null;

  return {
    responses: valid.length,
    errors: (rows || []).length - valid.length,
    responsesWithAnyBrand,
    focus: focus ? { ...focus, position: ranking.indexOf(focus) + 1 } : null,
    ranking,
    byProvider: Object.fromEntries(Object.entries(byProvider).map(([p, v]) => [p, { responses: v.responses, ranking: finalize(v.brands, v.responses) }])),
    timeline: Object.keys(byWeek).sort().map(w => ({ week: w, responses: byWeek[w].responses, ranking: finalize(byWeek[w].brands, byWeek[w].responses) }))
  };
}

function round1(x) { return Math.round(x * 10) / 10; }
function isoWeek(d) {
  if (isNaN(d)) return 'n/a';
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const wk = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}

// =====================================================
// Sentiment par marque (Claude, sortie JSON structurée)
// =====================================================
const SENTIMENT_LABELS = ['positive', 'neutral', 'negative'];
const { levelOf, emptyLevels } = require('./sentiment-level.js');

async function analyzeSentiment(text, brandNames, query) {
  const apiKey = process.env.API_KEY_ANTHROPIC;
  if (!apiKey) throw new Error('Anthropic API key not configured');

  const system = `Tu analyses la façon dont une réponse d'assistant IA ou de moteur de recherche parle de marques. Pour chaque marque demandée, évalue le ton employé À SON SUJET dans la réponse, pas le ton général : positive (recommandée, mise en avant, qualités soulignées), neutral (simplement citée, listée sans jugement), negative (critiquée, déconseillée, défauts soulignés). score va de -1 à 1 selon cette échelle : très positif ≥ 0,6 (recommandée en priorité, éloges appuyés) ; positif 0,2 à 0,6 (présentée favorablement) ; neutre / informatif entre -0,2 et 0,2 (citée de façon factuelle, sans jugement) ; négatif -0,6 à -0,2 (réserves, points faibles) ; très négatif ≤ -0,6 (critiquée, déconseillée). reason : une phrase courte en français citant l'élément du texte qui justifie le jugement.`;
  const user = `Question posée : ${String(query || '').slice(0, 500)}

Marques à évaluer : ${brandNames.join(', ')}

<reponse>
${String(text || '').slice(0, 12000)}
</reponse>`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.SENTIMENT_MODEL || 'claude-opus-5-5',
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              brands: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    brand: { type: 'string' },
                    label: { type: 'string', enum: SENTIMENT_LABELS },
                    score: { type: 'number' },
                    reason: { type: 'string' }
                  },
                  required: ['brand', 'label', 'score', 'reason'],
                  additionalProperties: false
                }
              }
            },
            required: ['brands'],
            additionalProperties: false
          }
        }
      }
    })
  });
  if (!response.ok) throw new Error(`Anthropic Error ${response.status}: ${await readError(response)}`);
  const data = await response.json();
  if (data.stop_reason === 'refusal') throw new Error('Analyse de sentiment refusée par le modèle');
  const textBlock = (data.content || []).find(b => b.type === 'text');
  const parsed = JSON.parse(textBlock?.text || '{}');

  const out = {};
  for (const item of parsed.brands || []) {
    const name = brandNames.find(n => normalize(n) === normalize(item.brand));
    if (!name || !SENTIMENT_LABELS.includes(item.label)) continue;
    const score = Math.max(-1, Math.min(1, Number(item.score) || 0));
    out[name] = { label: item.label, score: Math.round(score * 100) / 100, reason: String(item.reason || '').slice(0, 300) };
  }
  return out;
}

// Ajoute brandStats[marque].sentiment et sentiments{} aux marques citées ; non bloquant en cas d'erreur
async function enrichWithSentiment(response, query) {
  const cited = Object.entries(response.brandStats || {}).filter(([, st]) => st.mentioned).map(([name]) => name);
  response.sentiments = {};
  if (!cited.length || !process.env.API_KEY_ANTHROPIC) return response;
  const text = [response.content, response.aiOverview && response.aiOverview !== response.content ? response.aiOverview : '']
    .filter(Boolean).join('\n\n');
  try {
    response.sentiments = await analyzeSentiment(text, cited, query);
    for (const [name, sent] of Object.entries(response.sentiments)) response.brandStats[name].sentiment = sent;
  } catch (error) {
    console.error("⚠️ [SENTIMENT]", error.message);
    response.sentimentError = error.message;
  }
  return response;
}

// =====================================================
// Supabase (REST PostgREST)
// =====================================================
function historyConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}
async function supabase(method, path, body, extraHeaders = {}) {
  const url = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await readError(response)}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// =====================================================
// Suggestion de prompts (Claude)
// =====================================================
const ANGLES = {
  direct: "questions simples et neutres, telles qu'un utilisateur lambda les taperait (ex. « quelle agence SEO choisir à Nantes ? »)",
  expert: "questions d'un décideur exigeant qui cherche de la crédibilité et des critères de choix (ex. « quels critères pour choisir une agence GEO sérieuse ? »)",
  data: "questions orientées chiffres, comparatifs, benchmarks, preuves de performance (ex. « quelles agences SEO affichent les meilleurs résultats mesurés ? »)",
  recommendation: "demandes de recommandation ou d'avis personnel (ex. « que me conseilles-tu comme agence pour… », « laquelle recommanderais-tu ? »)",
  comparison: "questions de comparaison directe entre acteurs ou solutions (ex. « X ou Y, lequel choisir ? », « compare les principales agences… »)",
  custom: "un mélange varié de formulations naturelles couvrant les intentions découverte, comparaison, recommandation et achat"
};

async function suggestPrompts({ brand, sector, angle, count, language }) {
  const apiKey = process.env.API_KEY_ANTHROPIC;
  if (!apiKey) throw new Error('Anthropic API key not configured');

  const n = Math.min(Math.max(parseInt(count || '6', 10) || 6, 3), 12);
  const angleDesc = ANGLES[angle] || ANGLES.direct;
  const lang = language || 'français';

  const system = `Tu es un expert en GEO (Generative Engine Optimization). Tu génères des requêtes que de vrais utilisateurs poseraient à ChatGPT, Gemini, Perplexity ou Google pour trouver un prestataire, un produit ou une réponse dans un secteur donné. Les requêtes doivent être NON biaisées : elles ne doivent PAS contenir le nom de la marque à surveiller, sauf pour l'angle comparaison où elle peut apparaître face à des concurrents génériques. Réponds UNIQUEMENT avec un tableau JSON de chaînes, sans texte autour, sans markdown.`;

  const user = `Marque à surveiller : ${brand}
Secteur / offre : ${sector || 'non précisé, déduis-le du nom de la marque si possible'}
Angle : ${angleDesc}
Langue : ${lang}
Génère ${n} requêtes distinctes, réalistes, de longueur variée (courtes et longues), formulées comme des questions complètes.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.SUGGEST_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1000,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!response.ok) throw new Error(`Anthropic Error ${response.status}: ${await readError(response)}`);

  const data = await response.json();
  const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
  let prompts;
  try { prompts = JSON.parse(text); } catch { prompts = text.split('\n').map(l => l.replace(/^[-\d.)\s"]+|["]+$/g, '').trim()).filter(Boolean); }
  if (!Array.isArray(prompts)) throw new Error('Suggestion invalide');
  return prompts.map(p => String(p).trim()).filter(Boolean).slice(0, n);
}

// =====================================================
// PROVIDER 1: OPENAI
// =====================================================
async function callOpenAI(query) {
  const apiKey = process.env.API_KEY_OPENAI;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [{ role: 'user', content: query }],
      temperature: 0.7,
      max_tokens: 600
    })
  });
  if (!response.ok) throw new Error(`OpenAI Error ${response.status}: ${await readError(response)}`);
  const data = await response.json();
  return { status: 'success', provider: 'openai', content: data.choices?.[0]?.message?.content || 'No response' };
}

// =====================================================
// PROVIDER 2: ANTHROPIC
// =====================================================
async function callAnthropic(query) {
  const apiKey = process.env.API_KEY_ANTHROPIC;
  if (!apiKey) throw new Error('Anthropic API key not configured');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      max_tokens: 600,
      messages: [{ role: 'user', content: query }]
    })
  });
  if (!response.ok) throw new Error(`Anthropic Error ${response.status}: ${await readError(response)}`);
  const data = await response.json();
  return { status: 'success', provider: 'anthropic', content: data.content?.[0]?.text || 'No response' };
}

// =====================================================
// PROVIDER 3: GOOGLE GEMINI
// =====================================================
async function callGoogle(query) {
  const apiKey = process.env.API_KEY_GOOGLE;
  if (!apiKey) throw new Error('Google API key not configured');

  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: query }] }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.7 }
      })
    }
  );
  if (!response.ok) throw new Error(`Google Error ${response.status}: ${await readError(response)}`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || 'No response';
  return { status: 'success', provider: 'google', content: text };
}

// =====================================================
// PROVIDER 4: PERPLEXITY
// =====================================================
async function callPerplexity(query) {
  const apiKey = process.env.API_KEY_PERPLEXITY;
  if (!apiKey) throw new Error('Perplexity API key not configured');

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.PERPLEXITY_MODEL || 'sonar',
      messages: [{ role: 'user', content: query }],
      max_tokens: 600,
      temperature: 0.7
    })
  });
  if (!response.ok) throw new Error(`Perplexity Error ${response.status}: ${await readError(response)}`);
  const data = await response.json();
  const sources = Array.isArray(data.search_results) && data.search_results.length
    ? data.search_results.map(r => ({ title: r.title || '', link: r.url }))
    : (data.citations || []).map(url => ({ title: '', link: url }));
  return { status: 'success', provider: 'perplexity', content: data.choices?.[0]?.message?.content || 'No response', sources };
}

// =====================================================
// PROVIDER 5: GOOGLE OVERVIEWS (SerpAPI, repli Custom Search)
// =====================================================
async function analyzeGoogleOverviews(query, brands, location) {
  if (process.env.SERPAPI_KEY) return analyzeViaSerpApi(query, brands, location);
  return analyzeViaCustomSearch(query, brands);
}

// Domaines emploi/RH : exclus du comptage organique (offres d'emploi ≠ visibilité commerciale)
const JOB_DOMAINS = /indeed|hellowork|glassdoor|welcometothejungle|linkedin\.com\/jobs|jobteaser|apec\.fr|francetravail|pole-emploi|meteojob|jobijoba|monster\.fr|regionsjob|studentjob/i;

// Quota SerpAPI épuisé : erreur 429 dédiée, pour que le front arrête d'appeler ce canal
const SERPAPI_QUOTA = /run out of searches|searches? (limit|quota)|plan.*limit/i;
function serpApiQuotaError() {
  const e = new Error('Quota SerpAPI épuisé : plus de recherches Google disponibles sur le forfait. Les autres canaux ne sont pas concernés.');
  e.status = 429; e.code = 'quota_exceeded';
  return e;
}

// Recherches restantes (account.json ne consomme pas de recherche), cache 10 min
let serpQuotaCache = { at: 0, value: null };
async function getSerpApiQuota() {
  if (!process.env.SERPAPI_KEY) return null;
  if (Date.now() - serpQuotaCache.at < 600000) return serpQuotaCache.value;
  try {
    const r = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(process.env.SERPAPI_KEY)}`, { signal: AbortSignal.timeout(5000) });
    const d = r.ok ? await r.json() : null;
    const left = d ? (d.total_searches_left ?? d.plan_searches_left) : undefined;
    serpQuotaCache = { at: Date.now(), value: Number.isFinite(left) ? { searchesLeft: left, perMonth: d.searches_per_month ?? null } : null };
  } catch {
    serpQuotaCache = { at: Date.now(), value: null };
  }
  return serpQuotaCache.value;
}

async function analyzeViaSerpApi(query, brands, location) {
  const apiKey = process.env.SERPAPI_KEY;
  const params = new URLSearchParams({
    engine: 'google', q: query,
    hl: process.env.SERP_HL || 'fr', gl: process.env.SERP_GL || 'fr',
    google_domain: process.env.SERP_DOMAIN || 'google.fr',
    api_key: apiKey
  });
  if (location && String(location).trim()) params.set('location', String(location).trim().slice(0, 120));
  const response = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!response.ok) {
    const msg = await readError(response);
    if (response.status === 429 || SERPAPI_QUOTA.test(msg)) throw serpApiQuotaError();
    throw new Error(`SerpAPI Error ${response.status}: ${msg}`);
  }
  const data = await response.json();
  if (data.error) {
    if (SERPAPI_QUOTA.test(data.error)) throw serpApiQuotaError();
    throw new Error(`SerpAPI Error: ${data.error}`);
  }

  let aio = data.ai_overview || null;
  if (aio?.page_token && !aio.text_blocks) {
    const p2 = new URLSearchParams({ engine: 'google_ai_overview', page_token: aio.page_token, api_key: apiKey });
    const r2 = await fetch(`https://serpapi.com/search.json?${p2}`);
    if (r2.ok) { const d2 = await r2.json(); aio = d2.ai_overview || aio; }
  }

  const aioText = extractAioText(aio);
  const aioSources = (aio?.references || []).map(r => ({ title: r.title, link: r.link, source: r.source }));
  const organic = (data.organic_results || []).slice(0, 10).map(r => ({
    position: r.position, title: r.title, link: r.link, snippet: r.snippet || '', isJob: JOB_DOMAINS.test(r.link || '')
  }));
  const organicClean = organic.filter(o => !o.isJob);
  const content = aioText || (organic.length ? organic.map(o => `${o.title}\n${o.snippet}`).join('\n\n') : 'No results found');

  return {
    status: 'success', provider: 'google_overviews', source: 'serpapi',
    hasAiOverview: Boolean(aioText), content,
    aiOverview: aioText || null, aiOverviewSources: aioSources, organic,
    location: location || null,
    sources: [...aioSources, ...organicClean.map(o => ({ title: o.title, link: o.link }))],
    mentionText: `${aioText || ''}\n${organicClean.map(o => o.title + ' ' + o.snippet).join(' ')}`
  };
}

function extractAioText(aio) {
  if (!aio?.text_blocks) return '';
  const parts = [];
  const walk = (block) => {
    if (!block) return;
    if (block.snippet) parts.push(block.snippet);
    if (Array.isArray(block.list)) block.list.forEach(item => {
      if (item.title) parts.push(item.title);
      if (item.snippet) parts.push(item.snippet);
      if (Array.isArray(item.list)) item.list.forEach(walk);
    });
    if (Array.isArray(block.text_blocks)) block.text_blocks.forEach(walk);
  };
  aio.text_blocks.forEach(walk);
  return parts.join('\n');
}

async function analyzeViaCustomSearch(query, brands) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
  if (!apiKey || !cx) throw new Error('Google Overviews: définir SERPAPI_KEY, ou GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID');

  const params = new URLSearchParams({ q: query, key: apiKey, cx, gl: 'fr', hl: 'fr', num: '10' });
  const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
  if (!response.ok) throw new Error(`Google Custom Search Error ${response.status}: ${await readError(response)}`);
  const data = await response.json();
  const organic = (data.items || []).map((it, i) => ({ position: i + 1, title: it.title, link: it.link, snippet: it.snippet || '' }));
  const content = organic.length ? organic.map(o => `${o.title}\n${o.snippet}`).join('\n\n') : 'No results found';
  return {
    status: 'success', provider: 'google_overviews', source: 'custom_search',
    hasAiOverview: false, content, aiOverview: null, organic,
    totalResults: data.searchInformation?.totalResults || 0,
    sources: organic.map(o => ({ title: o.title, link: o.link }))
  };
}

