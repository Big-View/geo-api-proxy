/**
 * API PROXY MULTI-CHANNEL - Version 2.0 WITH DEBUG LOGS
 */

module.exports = function(app) {
  app.post("/api/llm", async (req, res) => {
    console.log("📩 [REQUEST RECEIVED]");
    console.log("  Body:", JSON.stringify(req.body).substring(0, 100));
    console.log("  Headers:", JSON.stringify(req.headers).substring(0, 200));
    
    // 1. AUTHENTIFICATION
    let token = req.headers['x-geo-token'];
    const TEAM_TOKEN = process.env.TEAM_TOKEN;

    // DECODE %2B to + if needed
    if (token) {
      token = decodeURIComponent(token);
    }

    console.log("🔐 [AUTH CHECK]");
    console.log("  Token received:", token || "MISSING");
    console.log("  Token expected:", TEAM_TOKEN || "NOT SET");
    console.log("  Match:", token === TEAM_TOKEN);
    if (token && TEAM_TOKEN && token !== TEAM_TOKEN) {
      console.log("  MISMATCH DETAILS:");
      console.log("    Received length:", token.length);
      console.log("    Expected length:", TEAM_TOKEN.length);
      console.log("    Received bytes:", Buffer.from(token).toString('hex'));
      console.log("    Expected bytes:", Buffer.from(TEAM_TOKEN).toString('hex'));
    }

    if (!token || token !== TEAM_TOKEN) {
      console.log("❌ [UNAUTHORIZED]");
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid or missing authentication token'
      });
    }

    console.log("✅ [AUTHORIZED]");

    // 2. DÉCODER LA REQUÊTE
    const { provider, payload, query, brands } = req.body;

    console.log(`📤 [DISPATCHING] Provider: ${provider}`);

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
          console.log("  → Calling OpenAI...");
          response = await callOpenAI(query);
          break;
        case 'anthropic':
          console.log("  → Calling Anthropic...");
          response = await callAnthropic(query);
          break;
        case 'google':
          console.log("  → Calling Google...");
          response = await callGoogle(query);
          break;
        case 'perplexity':
          console.log("  → Calling Perplexity...");
          response = await callPerplexity(query);
          break;
        case 'google_overviews':
          console.log("  → Analyzing Google Overviews...");
          response = await analyzeGoogleOverviews(query, brands);
          break;
        default:
          return res.status(400).json({ 
            error: 'Unknown provider',
            message: `Provider '${provider}' is not supported`
          });
      }

      console.log(`✅ [SUCCESS] ${provider} responded`);
      return res.status(200).json(response);

    } catch (error) {
      console.error(`❌ [ERROR] ${provider}:`, error.message);
      return res.status(500).json({ 
        error: 'API Error',
        message: error.message,
        provider
      });
    }
  });
};

// =====================================================
// PROVIDER 1: OPENAI
// =====================================================

async function callOpenAI(query) {
  const apiKey = process.env.API_KEY_OPENAI;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: query }
      ],
      temperature: 0.7,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI Error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return {
    status: 'success',
    provider: 'openai',
    content: data.choices?.[0]?.message?.content || 'No response'
  };
}

// =====================================================
// PROVIDER 2: ANTHROPIC
// =====================================================

async function callAnthropic(query) {
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
      model: 'claude-opus-4-8',
      max_tokens: 500,
      messages: [
        { role: 'user', content: query }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic Error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return {
    status: 'success',
    provider: 'anthropic',
    content: data.content?.[0]?.text || 'No response'
  };
}

// =====================================================
// PROVIDER 3: GOOGLE
// =====================================================

async function callGoogle(query) {
  const apiKey = process.env.API_KEY_GOOGLE;
  if (!apiKey) throw new Error('Google API key not configured');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: query }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0.7
        }
      })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Google Error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return {
    status: 'success',
    provider: 'google',
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response'
  };
}

// =====================================================
// PROVIDER 4: PERPLEXITY
// =====================================================

async function callPerplexity(query) {
  const apiKey = process.env.API_KEY_PERPLEXITY;
  if (!apiKey) throw new Error('Perplexity API key not configured');

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'pplx-sonar-pro',
      messages: [
        { role: 'user', content: query }
      ],
      max_tokens: 500,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Perplexity Error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return {
    status: 'success',
    provider: 'perplexity',
    content: data.choices?.[0]?.message?.content || 'No response'
  };
}

// =====================================================
// PROVIDER 5: GOOGLE OVERVIEWS
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
    
    const snippet = data.items?.[0]?.snippet || 'No results found';
    const title = data.items?.[0]?.title || 'No title';
    
    return {
      status: 'success',
      provider: 'google_overviews',
      title: title,
      content: snippet,
      totalResults: data.queries?.request?.[0]?.totalResults || 0
    };

  } catch (error) {
    throw new Error(`Google Overviews Analysis failed: ${error.message}`);
  }
}

