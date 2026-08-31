const express = require("express");

module.exports = function(app) {
  app.post("/api/llm", async (req, res) => {
    // Authentication
    const token = req.headers['x-geo-token'];
    const TEAM_TOKEN = process.env.TEAM_TOKEN;
    
    if (!token || token !== TEAM_TOKEN) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing token'
      });
    }

    // Test response
    res.json({
      status: 'ok',
      message: 'Proxy is working!',
      provider: req.body?.provider || 'none'
    });
  });
};
