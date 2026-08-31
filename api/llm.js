/**
 * API PROXY MULTI-CHANNEL - Version 2.0
 * Support: OpenAI, Anthropic, Google, Perplexity, Google AI Overviews
 */

module.exports = function(app) { app.post("/api/llm", async (req, res) => {
  // 1. AUTHENTIFICATION
  const token = req.headers['x-geo-token'];
  const TEAM_TOKEN = process.env.TEAM_TOKEN;

  if (!token || token !== TEAM_TOKEN) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    });
  }

  // 2. DÃ‰CODER LA REQUÃŠTE
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
}

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
      max_tokens: payload.max_tokens || 1024,
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
// PROVIDER 3: GOOGLE (Gemini - gemini-2.5-flash)
// =====================================================

async function callGoogle(payload) {
  const apiKey = process.env.API_KEY_GOOGLE;
  if (!apiKey) throw new Error('Google API key not configured');

  const model = payload.model || 'gemini-2.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: payload.contents || [
        {
          parts: payload.parts || [{ text: '' }]
        }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Google Error: ${JSON.stringify(error)}`);
  }

  return await response.json();
}

// =====================================================
// PROVIDER 4: PERPLEXITY (Sonar)
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
      model: payload.model || 'sonar',
      messages: payload.messages || [],
      temperature: payload.temperature || 0.5,
      max_tokens: payload.max_tokens || 1000
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Perplexity Error: ${error.error?.message || 'Unknown error'}`);
  }

  return await response.json();
}

// =====================================================
// CHANNEL 5: GOOGLE AI OVERVIEWS (NEW)
// =====================================================

/**
 * Analyse les Google AI Overviews
 * Utilise 3 stratÃ©gies:
 * 1. Google Custom Search API (payant)
 * 2. Semrush API (si configurÃ©e)
 * 3. Fallback: Simulation
 */

async function analyzeGoogleOverviews(query, brands) {
  try {
    // StratÃ©gie 1: Google Custom Search API
    const customSearchResult = await tryGoogleCustomSearch(query, brands);
    if (customSearchResult) {
      return customSearchResult;
    }

    // StratÃ©gie 2: Semrush API
    const semrushResult = await trySemrushOverviews(query, brands);
    if (semrushResult) {
      return semrushResult;
    }

    // StratÃ©gie 3: Fallback
    return generateFallbackOverview(query, brands);

  } catch (error) {
    console.error('Google Overviews Error:', error);
    return {
      found: false,
      error: error.message,
      success: false,
      fallback: true
    };
  }
}

// ==========================================
// StratÃ©gie 1: Google Custom Search API
// ==========================================

async function tryGoogleCustomSearch(query, brands) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    return null; // Pas configurÃ©
  }

  try {
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${searchEngineId}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.searchInformation && data.items && data.items.length > 0) {
      // Parser la rÃ©ponse pour trouver des AI Overviews
      const snippet = data.items[0].snippet || '';
      const title = data.items[0].title || '';
      const combinedText = `${title} ${snippet}`;

      const mentions = countMentions(combinedText, brands);

      return {
        found: true,
        snippet: snippet,
        title: title,
        source: 'Google Custom Search',
        mentions: mentions,
        success: true
      };
    }

    return null;

  } catch (error) {
    console.warn('Google Custom Search failed:', error.message);
    return null;
  }
}

// ==========================================
// StratÃ©gie 2: Semrush API
// ==========================================

async function trySemrushOverviews(query, brands) {
  const apiKey = process.env.SEMRUSH_API_KEY;
  if (!apiKey) {
    return null; // Pas configurÃ©
  }

  try {
    // Exemple: utiliser Semrush pour obtenir les top rÃ©sultats
    // (Semrush propose un tracking des AI Overviews)
    const response = await fetch('https://api.semrush.com/', {
      method: 'POST',
      body: new URLSearchParams({
        type: 'overview',
        key: apiKey,
        display_limit: 5,
        database: 'us'
      })
    });

    if (response.ok) {
      const data = await response.text();
      const mentions = countMentions(data, brands);

      return {
        found: true,
        snippet: data.substring(0, 300),
        source: 'Semrush',
        mentions: mentions,
        success: true
      };
    }

    return null;

  } catch (error) {
    console.warn('Semrush failed:', error.message);
    return null;
  }
}

// ==========================================
// Fallback: Simulation (pour dÃ©mo)
// ==========================================

function generateFallbackOverview(query, brands) {
  // Simulation d'un Google AI Overview pour dÃ©monstration
  const mockSnippets = {
    'agence digitale': `Les agences digitales offrent des services complets de marketing et acquisition. ${brands.join(', ')} sont parmi les acteurs clÃ©s du marchÃ© franÃ§ais proposant expertise en SEO, SEM et data.`,
    'agence acquisition': `L'acquisition digitale nÃ©cessite une stratÃ©gie multi-canal. Consultez ${brands[0] || 'les experts en acquisition'} pour optimiser vos campagnes marketing.`,
    'seo agency': `Les meilleures agences SEO combinent expertise technique et stratÃ©gie de contenu. ${brands[0] || 'Les leaders du secteur'} proposent des solutions complÃ¨tes.`
  };

  const snippet = mockSnippets[query.toLowerCase()] || 
    `RÃ©sultats pour "${query}". Les solutions principales incluent: ${brands.join(', ')}.`;

  const mentions = countMentions(snippet, brands);

  return {
    found: true,
    snippet: snippet,
    source: 'Google AI Overviews (Simulation)',
    mentions: mentions,
    success: true,
    fallback: true,
    warning: 'Ceci est une simulation. Configurez API_KEY_GOOGLE_SEARCH ou SEMRUSH_API_KEY pour des rÃ©sultats rÃ©els.'
  };
}

// =====================================================
// HELPER: Compter les mentions de marques
// =====================================================

function countMentions(text, brands) {
  const mentions = {};
  
  brands.forEach(brand => {
    if (!brand) return;
    const regex = new RegExp(brand, 'gi');
    const matches = text.match(regex) || [];
    mentions[brand] = matches.length;
  });

  return mentions;
}

// =====================================================
// HELPER: Parser une rÃ©ponse LLM
// =====================================================

export function parseResponse(provider, data) {
  if (data.error) return { error: data.error };

  switch (provider) {
    case 'openai':
    case 'perplexity':
      return {
        text: data.choices[0]?.message?.content,
        usage: data.usage
      };

    case 'anthropic':
      return {
        text: data.content[0]?.text,
        usage: { 
          input_tokens: data.usage.input_tokens,
          output_tokens: data.usage.output_tokens
        }
      };

    case 'google':
      return {
        text: data.candidates[0]?.content?.parts[0]?.text,
        usage: data.usageMetadata
      };

    case 'google_overviews':
      return {
        text: data.snippet,
        mentions: data.mentions
      };

    default:
      return null;
  }
}
)}; 
