/**
 * API PROXY MULTI-CHANNEL - Version 2.2
 * Routes :
 *   POST /api/llm      → interroge un canal (openai, anthropic, google, perplexity, google_overviews)
 *   POST /api/suggest  → suggère des prompts (brand, sector, angle) via Claude
 *   POST /api/history  → enregistre les résultats d'un run (Supabase)
 *   GET  /api/history  → lit l'historique (?brand=&days=&limit=)
 *   GET  /api/health   → état de la config
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
  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      providers: {
        openai: !!process.env.API_KEY_OPENAI,
        anthropic: !!process.env.API_KEY_ANTHROPIC,
        google: !!process.env.API_KEY_GOOGLE,
        perplexity: !!process.env.API_KEY_PERPLEXITY,
        google_overviews: !!(process.env.SERPAPI_KEY || (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID))
      },
      history: historyConfigured()
    });
  });

  // ---------- LLM ----------
  app.post("/api/llm", async (req, res) => {
    if (!checkAuth(req, res)) return;
    const { provider, query, brands } = req.body;
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
        case 'google_overviews': response = await analyzeGoogleOverviews(query, brands); break;
        default:
          return res.status(400).json({ error: 'Unknown provider', message: `Provider '${provider}' is not supported` });
      }
      if (!response.brandMentions) response.brandMentions = countMentions(response.content, brands);
      console.log(`✅ [SUCCESS] ${provider}`);
      return res.status(200).json(response);
    } catch (error) {
      console.error(`❌ [ERROR] ${provider}:`, error.message);
      return res.status(500).json({ error: 'API Error', message: error.message, provider });
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
      await supabase('POST', 'geo_runs', clean, { Prefer: 'return=minimal' });
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

    const params = new URLSearchParams({
      select: 'id,created_at,run_id,brand,competitors,sector,angle,prompt,provider,mentioned,mentions,has_ai_overview,error',
      order: 'created_at.desc',
      limit: String(limit),
      created_at: `gte.${since}`
    });
    if (brand) params.set('brand', `eq.${brand}`);

    try {
      const rows = await supabase('GET', `geo_runs?${params}`);
      return res.json({ status: 'success', configured: true, rows });
    } catch (error) {
      console.error("❌ [ERROR] history read:", error.message);
      return res.status(500).json({ error: 'History Error', message: error.message });
    }
  });
};

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

// Comptage des mentions (insensible à la casse et aux accents)
function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function countMentions(text, brands) {
  if (!Array.isArray(brands) || !text) return {};
  const hay = normalize(text);
  const out = {};
  for (const b of brands) {
    const name = typeof b === 'string' ? b : b?.name;
    if (!name) continue;
    const needle = normalize(name);
    let count = 0, idx = 0;
    while (needle && (idx = hay.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
    out[name] = count;
  }
  return out;
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
  return { status: 'success', provider: 'perplexity', content: data.choices?.[0]?.message?.content || 'No response' };
}

// =====================================================
// PROVIDER 5: GOOGLE OVERVIEWS (SerpAPI, repli Custom Search)
// =====================================================
async function analyzeGoogleOverviews(query, brands) {
  if (process.env.SERPAPI_KEY) return analyzeViaSerpApi(query, brands);
  return analyzeViaCustomSearch(query, brands);
}

async function analyzeViaSerpApi(query, brands) {
  const apiKey = process.env.SERPAPI_KEY;
  const params = new URLSearchParams({
    engine: 'google', q: query,
    hl: process.env.SERP_HL || 'fr', gl: process.env.SERP_GL || 'fr',
    google_domain: process.env.SERP_DOMAIN || 'google.fr',
    api_key: apiKey
  });
  const response = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!response.ok) throw new Error(`SerpAPI Error ${response.status}: ${await readError(response)}`);
  const data = await response.json();
  if (data.error) throw new Error(`SerpAPI Error: ${data.error}`);

  let aio = data.ai_overview || null;
  if (aio?.page_token && !aio.text_blocks) {
    const p2 = new URLSearchParams({ engine: 'google_ai_overview', page_token: aio.page_token, api_key: apiKey });
    const r2 = await fetch(`https://serpapi.com/search.json?${p2}`);
    if (r2.ok) { const d2 = await r2.json(); aio = d2.ai_overview || aio; }
  }

  const aioText = extractAioText(aio);
  const aioSources = (aio?.references || []).map(r => ({ title: r.title, link: r.link, source: r.source }));
  const organic = (data.organic_results || []).slice(0, 10).map(r => ({
    position: r.position, title: r.title, link: r.link, snippet: r.snippet || ''
  }));
  const content = aioText || (organic.length ? organic.map(o => `${o.title}\n${o.snippet}`).join('\n\n') : 'No results found');

  return {
    status: 'success', provider: 'google_overviews', source: 'serpapi',
    hasAiOverview: Boolean(aioText), content,
    aiOverview: aioText || null, aiOverviewSources: aioSources, organic,
    brandMentions: countMentions(`${aioText || ''}\n${organic.map(o => o.title + ' ' + o.snippet).join(' ')}`, brands)
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
    brandMentions: countMentions(content, brands)
  };
}
