// Usage : node svg_to_png.mjs <fichier.svg> <sortie.png>
// Rend un SVG inline en PNG (2x) avec Chromium, polices Poppins/Roboto chargées depuis Google Fonts.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }

const [, , src, out] = process.argv;
const svg = readFileSync(src, 'utf8');
const vb = (svg.match(/viewBox="([\d.\s-]+)"/) || [])[1]?.trim().split(/\s+/).map(Number) || [0, 0, 900, 300];
const [w, h] = [vb[2], vb[3]];
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Roboto:wght@400;700&display=block" rel="stylesheet">
<style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style></head>
<body>${svg}</body></html>`;

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.evaluate(() => document.fonts.ready);
await page.locator('svg').first().screenshot({ path: out, omitBackground: true });
await browser.close();
console.log(JSON.stringify({ out, width: w, height: h }));
