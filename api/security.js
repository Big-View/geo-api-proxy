/**
 * Sécurité du proxy
 *  - CORS limité aux origines de l'outil (ALLOWED_ORIGINS, séparées par des virgules ;
 *    défaut : https://big-view.fr et https://www.big-view.fr). Les appels sans Origin
 *    (Google Slides qui charge les images, scripts, curl) restent possibles mais exigent le jeton.
 *  - Limite de débit par adresse IP sur /api (RATE_LIMIT_PER_MIN, défaut 120 requêtes / minute)
 *  - Blocage temporaire après des jetons invalides répétés (10 échecs en 15 min → 15 min de blocage)
 *  - Comparaison du jeton à temps constant
 */
const crypto = require('crypto');

const DEFAULT_ORIGINS = ['https://big-view.fr', 'https://www.big-view.fr'];
const allowedOrigins = () => (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : DEFAULT_ORIGINS)
  .map(o => o.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);

function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin) {
    if (!allowedOrigins().includes(origin.toLowerCase())) {
      console.warn(`⛔ [CORS] origine refusée : ${origin}`);
      return res.status(403).json({ error: 'Forbidden', message: 'Origin not allowed' });
    }
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-GEO-Token, x-geo-token');
    res.header('Access-Control-Max-Age', '600');
    res.header('Access-Control-Expose-Headers', 'X-Drive-Url, X-Drive-Error');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

// Compteurs en mémoire (une seule instance Render) : fenêtre glissante simple par IP
const hits = new Map();      // ip -> [timestamps]
const failures = new Map();  // ip -> { count, first, blockedUntil }
const WINDOW = 60 * 1000, FAIL_WINDOW = 15 * 60 * 1000, MAX_FAILS = 10;

setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) if (!list.length || now - list[list.length - 1] > WINDOW) hits.delete(ip);
  for (const [ip, f] of failures) if (now - f.first > FAIL_WINDOW && (!f.blockedUntil || now > f.blockedUntil)) failures.delete(ip);
}, 5 * 60 * 1000).unref();

function rateLimit(req, res, next) {
  if (!req.path.startsWith('/api/') || req.path === '/api/health') return next();
  const ip = req.ip, now = Date.now();
  const f = failures.get(ip);
  if (f && f.blockedUntil && now < f.blockedUntil) {
    return res.status(429).json({ error: 'Too Many Requests', message: 'Trop de jetons invalides : réessayez dans quelques minutes' });
  }
  const limit = parseInt(process.env.RATE_LIMIT_PER_MIN || '120', 10) || 120;
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  if (list.length >= limit) {
    res.header('Retry-After', '60');
    return res.status(429).json({ error: 'Too Many Requests', message: 'Trop de requêtes : réessayez dans une minute' });
  }
  list.push(now);
  hits.set(ip, list);
  next();
}

function recordFailure(ip) {
  const now = Date.now();
  let f = failures.get(ip);
  if (!f || now - f.first > FAIL_WINDOW) f = { count: 0, first: now, blockedUntil: 0 };
  f.count++;
  if (f.count >= MAX_FAILS) {
    f.blockedUntil = now + FAIL_WINDOW;
    console.warn(`⛔ [AUTH] ${ip} bloquée 15 min après ${f.count} jetons invalides`);
  }
  failures.set(ip, f);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkAuth(req, res) {
  let token = req.headers['x-geo-token'];
  const TEAM_TOKEN = process.env.TEAM_TOKEN;
  try { if (token) token = decodeURIComponent(token); } catch { /* jeton mal encodé : comparé tel quel */ }
  if (!token || !TEAM_TOKEN || !safeEqual(token, TEAM_TOKEN)) {
    console.log('❌ [UNAUTHORIZED] token', token ? 'présent mais invalide' : 'manquant');
    if (token) recordFailure(req.ip);
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing authentication token' });
    return false;
  }
  return true;
}

// Partage des présentations : uniquement vers les domaines autorisés (SHARE_DOMAINS, défaut big-view.fr)
function allowedShareEmail(email) {
  const domains = String(process.env.SHARE_DOMAINS || 'big-view.fr').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
  const m = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(String(email).trim().toLowerCase());
  return !!m && domains.includes(m[1]);
}

module.exports = { cors, rateLimit, checkAuth, allowedShareEmail };
