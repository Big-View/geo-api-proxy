const express = require("express");
const { cors, rateLimit } = require("./api/security.js");
const app = express();

// Render place le service derrière un proxy : l'IP du client est dans X-Forwarded-For
app.set("trust proxy", 1);
app.disable("x-powered-by");

// CORS limité à l'outil (big-view.fr), puis limite de débit par IP
app.use(cors);
app.use(rateLimit);

// Corps JSON : un run complet (prompts × canaux avec les réponses) dépasse la limite par défaut de 100 Ko
app.use(express.json({ limit: "5mb" }));

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "GEO API Proxy running" });
});

// Load LLM API
try {
  require("./api/llm.js")(app);
  console.log("✅ API LLM loaded successfully");
} catch (error) {
  console.error("❌ Error loading API:", error.message);
  process.exit(1);
}

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});