/**
 * API PROXY MULTI-CHANNEL - Version 2.1
 * - Gemini : modèle gemini-2.5-flash (gemini-pro est retiré)
 * - Google Overviews : SerpAPI (vrai bloc AI Overview), repli Custom Search
 * - Logs sans token en clair
 */

module.exports = function(app) {
  app.post("/api/llm", async (req, res) => {
    // 1. AUTHENTIFICATION
    let token = req.headers['x-geo-token'];
    const TEAM_TOKEN = process.env.TEAM_TOKEN;
    if (token) token = decodeURIComponent(token);

    if (!token || !TEAM_TOKEN || token !== TEAM_TOKEN) {
      console.log("❌ [UNAUTHORIZED] token", token ? "présent mais invalide" : "manquant");
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing authentication token'
      });
    }

    // 2. DÉCODER LA REQUÊTE
    const { provider, query, brands } = req.body;
    console.log(`📤 [DISPATCHING] Provider: ${provider}`);

    if (!provider) {
      return res.status(400).json({ error: 'Bad Request', message: 'Provider parameter is required' });
    }
    if (!query) {
      return res.status(400).json({ error: 'Bad Request', message: 'Query parameter is required' });
    }

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
      console.log(`✅ [SUCCESS] ${provider}`);
      return res.status(200).json(response);
    } catch (error) {
      console.error(`❌ [ERROR] ${provider}:`, error.message);
      return res.status(500).json({ error: 'API Error', message: error.message, provider });
    }
  });
};

// Lit le message d'erreur d'une réponse HTTP, JSON ou texte
async function readError(response) {
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return json.error?.message || json.error || text;
  } catch {
    return text || `HTTP ${response.status}`;
  }
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
      model: 'gpt-4o',
      messages: [{ role: 'user', content: query }],
      temperature: 0.7,
      max_tokens: 500
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
      model: 'claude-opus-4-8',
      max_tokens: 500,
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

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: query }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
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
      model: 'sonar',
      messages: [{ role: 'user', content: query }],
      max_tokens: 500,
      temperature: 0.7
    })
  });
  if (!response.ok) throw new Error(`Perplexity Error ${response.status}: ${await readError(response)}`);

  const data = await response.json();
  return { status: 'success', provider: 'perplexity', content: data.choices?.[0]?.message?.content || 'No response' };
}

// =====================================================
// PROVIDER 5: GOOGLE OVERVIEWS
// SerpAPI si SERPAPI_KEY est définie, sinon Custom Search
// =====================================================
async function analyzeGoogleOverviews(query, brands) {
  if (process.env.SERPAPI_KEY) return analyzeViaSerpApi(query, brands);
  return analyzeViaCustomSearch(query, brands);
}

// --- SerpAPI : renvoie le vrai bloc AI Overview + organiques ---
async function analyzeViaSerpApi(query, brands) {
  const apiKey = process.env.SERPAPI_KEY;
  const params = new URLSearchParams({
    engine: 'google',
    q: query,
    hl: process.env.SERP_HL || 'fr',
    gl: process.env.SERP_GL || 'fr',
    google_domain: process.env.SERP_DOMAIN || 'google.fr',
    api_key: apiKey
  });

  const response = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!response.ok) throw new Error(`SerpAPI Error ${response.status}: ${await readError(response)}`);
  const data = await response.json();
  if (data.error) throw new Error(`SerpAPI Error: ${data.error}`);

  // Le bloc AI Overview est parfois renvoyé inline, parfois via un page_token à rappeler
  let aio = data.ai_overview || null;
  if (aio?.page_token && !aio.text_blocks) {
    const p2 = new URLSearchParams({ engine: 'google_ai_overview', page_token: aio.page_token, api_key: apiKey });
    const r2 = await fetch(`https://serpapi.com/search.json?${p2}`);
    if (r2.ok) {
      const d2 = await r2.json();
      aio = d2.ai_overview || aio;
    }
  }

  const aioText = extractAioText(aio);
  const aioSources = (aio?.references || []).map(r => ({ title: r.title, link: r.link, source: r.source }));

  const organic = (data.organic_results || []).slice(0, 10).map(r => ({
    position: r.position, title: r.title, link: r.link, snippet: r.snippet || ''
  }));

  const content = aioText
    ? aioText
    : (organic.length ? organic.map(o => `${o.title}\n${o.snippet}`).join('\n\n') : 'No results found');

  return {
    status: 'success',
    provider: 'google_overviews',
    source: 'serpapi',
    hasAiOverview: Boolean(aioText),
    content,
    aiOverview: aioText || null,
    aiOverviewSources: aioSources,
    organic,
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

// --- Custom Search (repli) : organiques uniquement ---
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
    status: 'success',
    provider: 'google_overviews',
    source: 'custom_search',
    hasAiOverview: false,
    content,
    aiOverview: null,
    organic,
    totalResults: data.searchInformation?.totalResults || 0,
    brandMentions: countMentions(content, brands)
  };
}

// Comptage simple des mentions de marques (insensible à la casse)
function countMentions(text, brands) {
  if (!Array.isArray(brands) || !text) return {};
  const lower = text.toLowerCase();
  const out = {};
  for (const b of brands) {
    const name = typeof b === 'string' ? b : b?.name;
    if (!name) continue;
    const needle = name.toLowerCase();
    let count = 0, idx = 0;
    while ((idx = lower.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
    out[name] = count;
  }
  return out;
}
