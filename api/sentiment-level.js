/**
 * Niveaux de sentiment (5 paliers, à partir du score -1..+1 donné par l'analyse)
 * et « œil Big View » (favicon) dont le regard traduit le sentiment général.
 *
 * Le même dessin est repris dans front/outil-geo.html (eyeSvg) : garder les deux en phase.
 * Les PNG utilisés par le PDF et Google Slides sont générés depuis eyeSvg() :
 *   node scripts/build-eyes.js
 */

const LEVELS = [
  { key: 'tres_positif', label: 'Très positif', min: 0.6 },
  { key: 'positif', label: 'Positif', min: 0.2 },
  { key: 'neutre', label: 'Neutre / informatif', min: -0.2 },
  { key: 'negatif', label: 'Négatif', min: -0.6 },
  { key: 'tres_negatif', label: 'Très négatif', min: -Infinity }
];

// Bornes : >= 0,6 très positif ; >= 0,2 positif ; > -0,2 neutre ; > -0,6 négatif ; sinon très négatif
function levelOf(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const s = Number(score);
  if (s >= 0.6) return LEVELS[0];
  if (s >= 0.2) return LEVELS[1];
  if (s > -0.2) return LEVELS[2];
  if (s > -0.6) return LEVELS[3];
  return LEVELS[4];
}

const emptyLevels = () => Object.fromEntries(LEVELS.map(l => [l.key, 0]));

// Œil Big View : cercle vert, iris, pupille noire. Le regard (position de la pupille, paupières, couleur) suit le niveau.
function eyeSvg(levelKey, size = 100) {
  const E = {
    tres_positif: { ring: '#04D99D', px: 59, py: 41, pr: 15, sparkle: true, halo: true },
    positif: { ring: '#04D99D', px: 61, py: 39, pr: 13 },
    neutre: { ring: '#04D99D', px: 50, py: 50, pr: 12 },
    negatif: { ring: '#F3D604', px: 42, py: 58, pr: 12, lid: 'M10 44 L90 44 L90 0 L10 0 Z', lidLine: 'M19 44 L81 44' },
    tres_negatif: { ring: '#595959', px: 47, py: 64, pr: 11, lid: 'M10 18 L50 46 L90 18 L90 0 L10 0 Z', lidLine: 'M24 28 L50 46 L76 28' }
  }[levelKey] || { ring: '#E0E0E0', px: 50, py: 50, pr: 12, empty: true };
  const iris = E.empty ? '#F0FAF6' : '#4FB39B';
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img">`;
  s += `<defs><clipPath id="eyeClip-${levelKey}"><circle cx="50" cy="50" r="31"/></clipPath></defs>`;
  s += `<circle cx="50" cy="50" r="48" fill="${E.ring}"/>`;
  s += `<circle cx="49" cy="52" r="32" fill="#000"/>`; // ombre du contour, comme sur le favicon
  s += `<circle cx="50" cy="50" r="31" fill="${iris}"/>`;
  s += `<g clip-path="url(#eyeClip-${levelKey})">`;
  if (!E.empty) s += `<circle cx="${E.px}" cy="${E.py}" r="${E.pr}" fill="#000"/>`;
  if (E.sparkle) s += `<circle cx="${E.px + 5}" cy="${E.py - 5}" r="4" fill="#fff"/><circle cx="${E.px - 5}" cy="${E.py + 6}" r="1.8" fill="#fff"/>`;
  if (E.lid) s += `<path d="${E.lid}" fill="${E.ring}"/>`;
  s += `</g>`;
  if (E.lidLine) s += `<path d="${E.lidLine}" stroke="#000" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  if (E.halo) s += `<circle cx="50" cy="50" r="45" fill="none" stroke="#F3D604" stroke-width="4"/><path d="M80 10 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 z" fill="#F3D604"/>`;
  if (E.empty) s += `<text x="50" y="58" font-family="Arial" font-size="22" text-anchor="middle" fill="#595959">?</text>`;
  return s + `</svg>`;
}

module.exports = { LEVELS, levelOf, emptyLevels, eyeSvg };
