const express = require("express");
const app = express();

// Middleware
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-GEO-Token, x-geo-token");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  
  next();
});

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