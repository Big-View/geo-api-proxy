// Génère assets/eye-<niveau>.png (PDF et Google Slides) depuis eyeSvg(), avec Chromium (Playwright)
// Usage : node scripts/build-eyes.js
const path = require('path');
const { chromium } = require('playwright');
const { LEVELS, eyeSvg } = require('../api/sentiment-level.js');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 240, height: 240 } });
  for (const key of [...LEVELS.map(l => l.key), 'inconnu']) {
    await page.setContent(`<html><body style="margin:0;background:transparent">${eyeSvg(key, 240)}</body></html>`);
    await page.locator('svg').screenshot({ path: path.join(__dirname, '..', 'assets', `eye-${key}.png`), omitBackground: true });
  }
  await browser.close();
  console.log('ok');
})();
