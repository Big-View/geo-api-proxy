// Usage : node check_render.mjs <content.html> <dossier_sortie>
// Rend le contenu (images de médiathèque comprises) en 1440 px et 390 px, vérifie l'absence
// de scroll horizontal, compte les H1 et les images cassées, enregistre deux captures.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }

const [, , src, outDir] = process.argv;
const body = readFileSync(src, 'utf8').replace('<!-- wp:html -->', '').replace('<!-- /wp:html -->', '');
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Roboto:wght@400;700&display=block" rel="stylesheet">
<style>body{margin:0;background:#fff}header,footer{background:#131313;color:#fff;padding:20px;font-family:Poppins,Arial}</style></head>
<body><header>En-tête du site (factice)</header><main>${body}</main><footer>Pied de page (factice)</footer></body></html>`;

writeFileSync(outDir + '/apercu.html', html);
const browser = await pw.chromium.launch();
const res = {};
for (const [name, width] of [['desktop', 1440], ['mobile', 390]]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto('file://' + outDir + '/apercu.html', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  // Les images sont en loading="lazy" : forcer leur chargement avant de contrôler.
  await page.evaluate(() => Promise.all([...document.querySelectorAll('main img')].map(i => {
    i.loading = 'eager';
    return i.complete ? null : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 15000); });
  })));
  res[name] = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    h1: document.querySelectorAll('main h1').length,
    images: document.querySelectorAll('main img').length,
    imagesCassees: [...document.querySelectorAll('main img')].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src),
    policeTitres: getComputedStyle(document.querySelector('main h2') || document.body).fontFamily,
  }));
  res[name].debordement = res[name].scrollWidth > res[name].viewport;
  await page.screenshot({ path: `${outDir}/apercu-${name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(res, null, 2));
