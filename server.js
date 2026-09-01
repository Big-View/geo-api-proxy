/**
 * API PROXY MULTI-CHANNEL - Version 2.0
 * Support: OpenAI, Anthropic, Google, Perplexity, Google AI Overviews
 * CommonJS format for Express/Render
 */

module.exports = function(app) {
  app.post("/api/llm", async (req, res) => {
    // 1. AUTHENTIFICATION
    const token = req.headers['x-geo-token'];
    const TEAM_TOKEN = process.env.TEAM_TOKEN;

    if (!token || token !== TEAM_TOKEN) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid or missing authentication token'
      });
    }

    // 2. DÉCODER LA REQUÊTE
    const { provider, payload, query, brands } = req.body;

    if (!provider) {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'Provider parameter is required'
      });
    }

    try {
      // 3. DISPATCHER
      let response;
      
      switch (provider.toLowerCase()) {
        case 'openai':
          response = await callOpenAI(payload);
          break;
        case 'anthropic':
          response = await callAnthropic(payload);
          break;
        case 'google':
          response = await callGoogle(payload);
          break;
        case 'perplexity':
          response = await callPerplexity(payload);
          break;
        case 'google_overviews':
          response = await analyzeGoogleOverviews(query, brands);
          break;
        default:
          return res.status(400).json({ 
            error: 'Unknown provider',
            message: `Provider '${provider}' is not supported`
          });
      }

      return res.status(200).json(response);

    } catch (error) {
      console.error(`[${provider.toUpperCase()}] Error:`, error);
      return res.status(500).json({ 
        error: 'API Error',
        message: error.message,
        provider
      });
    }
  });
};

// =====================================================
// PROVIDER 1: OPENAI (ChatGPT - GPT-4o)
// =====================================================

async function callOpenAI(payload) {
  const apiKey = process.env.API_KEY_OPENAI;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: payload.model || 'gpt-4o',
      messages: payload.messages || [],
      temperature: payload.temperature || 0.7,
      max_tokens: payload.max_tokens || 1000
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI Error: ${error.error.message}`);
  }

  return await response.json();
}

// =====================================================
// PROVIDER 2: ANTHROPIC (Claude - claude-opus-4-8)
// =====================================================

async function callAnthropic(payload) {
  const apiKey = process.env.API_KEY_ANTHROPIC;
  if (!apiKey) throw new Error('Anthropic API key not configured');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: payload.model || 'claude-opus-4-8',
      max_tokens: payload.max_tokens || 1000,
      messages: payload.messages || []
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic Error: ${error.error.message}`);
  }

  return await response.json();
}

// =====================================================
// PROVIDER 3: GOOGLE (Gemini - gemini-pro)
// =====================================================

async function callGoogle(payload) {
  const apiKey = process.env.API_KEY_GOOGLE;
  if (!apiKey) throw new Error('Google API key not configured');

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: payload.contents || [],
      generationConfig: {
        maxOutputTokens: payload.max_tokens || 1000,
        temperature: payload.temperature || 0.7
      }
    }),
  }).then(r => r.ok ? r.json() : (() => { throw new Error('Google API error'); })());

  return response;
}

// =====================================================
// PROVIDER 4: PERPLEXITY (pplx-sonar)
// =====================================================

async function callPerplexity(payload) {
  const apiKey = process.env.API_KEY_PERPLEXITY;
  if (!apiKey) throw new Error('Perplexity API key not configured');

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: payload.model || 'pplx-sonar-pro',
      messages: payload.messages || [],
      max_tokens: payload.max_tokens || 1000,
      temperature: payload.temperature || 0.7
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Perplexity Error: ${error.error.message}`);
  }

  return await response.json();
}

// =====================================================
// PROVIDER 5: GOOGLE AI OVERVIEWS (via Custom Search)
// =====================================================

async function analyzeGoogleOverviews(query, brands) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
  
  if (!apiKey || !cx) {
    throw new Error('Google Search API credentials not configured');
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}`,
      { method: 'GET' }
    );

    if (!response.ok) {
      throw new Error(`Google Custom Search Error: ${response.status}`);
    }

    const data = await response.json();
    
    // Extract snippet from first result (simulates AI Overview)
    const snippet = data.items?.[0]?.snippet || 'No results found';
    
    // Count brand mentions
    const mentions = {};
    if (Array.isArray(brands)) {
      brands.forEach(brand => {
        const regex = new RegExp(brand, 'gi');
        const count = (data.items || []).reduce((sum, item) => {
          const text = (item.snippet || '').match(regex) || [];
          return sum + text.length;
        }, 0);
        mentions[brand] = count;
      });
    }

    return {
      status: 'success',
      provider: 'google_overviews',
      snippet: snippet,
      mentions: mentions,
      totalResults: data.queries?.request?.[0]?.totalResults || 0
    };

  } catch (error) {
    throw new Error(`Google Overviews Analysis failed: ${error.message}`);
  }
}

