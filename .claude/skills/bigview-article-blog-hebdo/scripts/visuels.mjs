#!/usr/bin/env node
// Génère les visuels d'un article big-view.fr (charte Big View) en WebP.
//
// Usage : node visuels.mjs spec.json dossier_sortie
// spec.json : { "slug": "...", "visuels": [ { "id": "...", "type": "...", ... } ] }
// Types : couverture, chiffres, barres, frise, etapes, cartes (voir references/visuels.md).
// Sortie : <dossier>/<slug>-<id>.webp + manifeste.json (fichier, alt, légende, largeur, hauteur).
// Le rendu passe par Chromium (Playwright) puis Pillow pour la conversion WebP.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [, , specPath, outDir] = process.argv;
if (!specPath || !outDir) {
  console.error('Usage : node visuels.mjs spec.json dossier_sortie');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
mkdirSync(outDir, { recursive: true });

const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// [[mot]] dans un titre = mot surligné en vert
const accent = (s = '') => esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="g">$1</span>');

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@500;700;800&family=Roboto:wght@400;500;700&display=block');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#fff;font-family:Roboto,Arial,sans-serif;color:#595959}
#v{width:1200px;background:#fff;padding:56px 64px 40px;position:relative}
.k{display:inline-block;background:#F3D604;color:#131313;font-family:Poppins;font-weight:700;font-size:20px;padding:6px 18px;border-radius:20px;margin-bottom:18px}
h1{font-family:Poppins;font-weight:800;color:#131313;font-size:46px;line-height:1.15;margin-bottom:24px}
.g{color:#04D99D}
.sub{font-size:24px;line-height:1.45;color:#595959;margin-bottom:34px;max-width:1000px}
.foot{display:flex;justify-content:space-between;align-items:flex-end;margin-top:34px;padding-top:16px;border-top:2px solid #E6E6E6;font-size:17px;color:#7A7A7A}
.brand{font-family:Poppins;font-weight:700;color:#131313;font-size:19px}
.brand b{color:#04D99D}
/* chiffres */
.stats{display:grid;gap:22px}
.stat{background:#F0FAF6;border-radius:20px;padding:30px 28px;border-top:6px solid #04D99D}
.stat:nth-child(2n){border-top-color:#29D5F2}
.stat .n{font-family:Poppins;font-weight:800;font-size:var(--fs,60px);white-space:nowrap;line-height:1;color:#131313;margin-bottom:14px}
.stat .l{font-size:22px;line-height:1.4;color:#333}
/* barres */
.bar{margin-bottom:28px}
.bar .t{display:flex;justify-content:space-between;font-family:Poppins;font-weight:700;font-size:24px;color:#131313;margin-bottom:10px}
.bar .tr{background:#F3F3F3;border-radius:14px;height:46px;overflow:hidden}
.bar .f{height:100%;border-radius:14px}
/* frise */
.fr{position:relative;display:grid;gap:0}
.fr .it{display:grid;grid-template-columns:200px 40px 1fr;align-items:start;min-height:84px}
.fr .d{font-family:Poppins;font-weight:700;font-size:22px;color:#131313;text-align:right;padding-right:18px;padding-top:4px}
.fr .dot{position:relative;height:100%}
.fr .dot:before{content:"";position:absolute;left:18px;top:0;bottom:0;width:4px;background:#E6E6E6}
.fr .dot:after{content:"";position:absolute;left:9px;top:8px;width:22px;height:22px;border-radius:50%;background:#04D99D;border:4px solid #fff;box-shadow:0 0 0 2px #04D99D}
.fr .it.hl .dot:after{background:#F3D604;box-shadow:0 0 0 2px #F3D604}
.fr .x{font-size:22px;line-height:1.4;color:#333;padding:4px 0 22px 14px}
.fr .x b{color:#131313}
/* étapes */
.st{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.sp{display:flex;gap:18px;background:#F3F3F3;border-radius:20px;padding:24px}
.sp .no{flex:none;width:58px;height:58px;border-radius:50%;background:linear-gradient(106deg,#04D99D,#29D5F2);color:#131313;font-family:Poppins;font-weight:800;font-size:26px;display:flex;align-items:center;justify-content:center}
.sp .tt{font-family:Poppins;font-weight:700;font-size:23px;color:#131313;margin-bottom:6px;line-height:1.25}
.sp .ds{font-size:19px;line-height:1.4;color:#595959}
/* cartes */
.cs{display:grid;gap:22px}
.c{border:2px solid #E6E6E6;border-radius:20px;padding:28px 26px;background:#fff}
.c .h{display:inline-block;background:#04D99D;color:#131313;font-family:Poppins;font-weight:700;font-size:22px;border-radius:14px;padding:6px 14px;margin-bottom:16px}
.c:nth-child(2) .h{background:#29D5F2}.c:nth-child(3) .h{background:#F3D604}
.c .r{font-size:20px;line-height:1.45;color:#333;margin-bottom:10px}
.c .r b{color:#131313}
/* couverture */
#v.cv{height:630px;padding:64px 72px;background:linear-gradient(135deg,#FFFFFF 0%,#F0FAF6 100%);display:flex;flex-direction:column;justify-content:space-between}
#v.cv h1{font-size:58px;max-width:840px}
#v.cv .sub{font-size:28px;margin:0}
#v.cv .deco{position:absolute;right:-90px;top:-90px;width:360px;height:360px;border-radius:50%;background:linear-gradient(106deg,#04D99D,#29D5F2);opacity:.9}
#v.cv .deco2{position:absolute;right:150px;top:150px;width:90px;height:90px;border-radius:50%;background:#F3D604}
`;

function foot(v) {
  return `<div class="foot"><span>${v.source ? 'Source : ' + esc(v.source) : ''}</span><span class="brand"><b>●</b> Big View · big-view.fr</span></div>`;
}
function head(v) {
  return `${v.kicker ? `<div class="k">${esc(v.kicker)}</div>` : ''}<h1>${accent(v.titre)}</h1>${v.sous_titre ? `<p class="sub">${esc(v.sous_titre)}</p>` : ''}`;
}

const R = {
  couverture: (v) => `<div id="v" class="cv"><div class="deco"></div><div class="deco2"></div>
    <div>${v.kicker ? `<div class="k">${esc(v.kicker)}</div>` : ''}<h1>${accent(v.titre)}</h1></div>
    <div><p class="sub">${esc(v.sous_titre || '')}</p><div class="foot" style="border:0;padding:0;margin-top:22px"><span>${esc(v.auteur || 'Florent Buil, fondateur de Big View')}</span><span class="brand"><b>●</b> Big View · big-view.fr</span></div></div></div>`,
  chiffres: (v) => `<div id="v">${head(v)}<div class="stats" style="--fs:${Math.min(v.items.length, v.colonnes || 4) >= 4 ? 46 : 60}px;grid-template-columns:repeat(${Math.min(v.items.length, v.colonnes || 4)},1fr)">${v.items.map((i) => `<div class="stat"><div class="n">${esc(i.valeur)}</div><div class="l">${esc(i.libelle)}</div></div>`).join('')}</div>${foot(v)}</div>`,
  barres: (v) => {
    const max = Math.max(...v.items.map((i) => Math.abs(i.valeur)));
    const cols = ['#04D99D', '#29D5F2', '#F3D604', '#131313'];
    return `<div id="v">${head(v)}${v.items.map((i, k) => `<div class="bar"><div class="t"><span>${esc(i.libelle)}</span><span>${esc(i.affichage ?? i.valeur)}</span></div><div class="tr"><div class="f" style="width:${Math.max(4, (Math.abs(i.valeur) / max) * 100)}%;background:${i.couleur || cols[k % cols.length]}"></div></div></div>`).join('')}${foot(v)}</div>`;
  },
  frise: (v) => `<div id="v">${head(v)}<div class="fr">${v.items.map((i) => `<div class="it${i.important ? ' hl' : ''}"><div class="d">${esc(i.date)}</div><div class="dot"></div><div class="x">${i.titre ? `<b>${esc(i.titre)}</b> ` : ''}${esc(i.texte || '')}</div></div>`).join('')}</div>${foot(v)}</div>`,
  etapes: (v) => `<div id="v">${head(v)}<div class="st">${v.items.map((i, k) => `<div class="sp"><div class="no">${k + 1}</div><div><div class="tt">${esc(i.titre)}</div><div class="ds">${esc(i.texte || '')}</div></div></div>`).join('')}</div>${foot(v)}</div>`,
  cartes: (v) => `<div id="v">${head(v)}<div class="cs" style="grid-template-columns:repeat(${v.items.length},1fr)">${v.items.map((i) => `<div class="c"><div class="h">${esc(i.titre)}</div>${(i.lignes || []).map((l) => `<p class="r">${l.startsWith('+') ? '<b>Voit :</b> ' + esc(l.slice(1).trim()) : l.startsWith('-') ? '<b>Rate :</b> ' + esc(l.slice(1).trim()) : esc(l)}</p>`).join('')}</div>`).join('')}</div>${foot(v)}</div>`,
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
const manifeste = [];
for (const v of spec.visuels) {
  if (!R[v.type]) throw new Error(`Type inconnu : ${v.type}`);
  await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${R[v.type](v)}</body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$('#v');
  const png = join(outDir, `${spec.slug}-${v.id}.png`);
  await el.screenshot({ path: png });
  const webp = png.replace(/\.png$/, '.webp');
  const dims = execFileSync('python3', ['-I', '-c',
    'import sys;from PIL import Image;i=Image.open(sys.argv[1]).convert("RGB");i.save(sys.argv[2],"WEBP",quality=86,method=6);print(i.width,i.height)', png, webp]).toString().trim().split(' ');
  manifeste.push({ id: v.id, type: v.type, fichier: webp, alt: v.alt, legende: v.legende || '', largeur: +dims[0], hauteur: +dims[1] });
  console.log(`OK ${webp} (${dims.join('x')})`);
}
await browser.close();
writeFileSync(join(outDir, 'manifeste.json'), JSON.stringify(manifeste, null, 1));
