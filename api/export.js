/**
 * Exports du Share of Voice : CSV, PDF, Google Slides
 *   GET  /api/export?format=csv|pdf|slides&brand=&days=&provider=[&type=detail|summary][&shareWith=email]
 *   POST /api/export  { format, brand, rows[], type?, shareWith?, title? }
 *
 * CSV  : séparateur « ; » + BOM UTF-8 (ouverture directe dans Excel FR).
 *        type=detail (défaut) : une ligne par réponse ; type=summary : classement global et par moteur.
 * PDF  : rapport synthétique (KPIs, classement, moteurs, sentiment, évolution hebdo).
 * Slides : présentation Google Slides créée via un compte de service.
 *   GOOGLE_SERVICE_ACCOUNT_JSON  clé JSON du compte de service (brute ou base64)
 *   GOOGLE_SLIDES_FOLDER_ID      dossier (Drive partagé conseillé) où créer la présentation
 *   GOOGLE_IMPERSONATE           utilisateur Workspace à emprunter (délégation domaine), optionnel
 *   GOOGLE_SLIDES_SHARE_WITH     e-mails (séparés par des virgules) à qui donner l'accès en écriture
 *                                (défaut : florent.buil@big-view.fr)
 *   Il faut l'un des deux : un dossier de Drive partagé, ou la délégation domaine, car un compte
 *   de service n'a pas d'espace de stockage propre.
 */
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const DEFAULT_SHARE_WITH = 'florent.buil@big-view.fr';
const SENTIMENT_FR = { positive: 'Positif', neutral: 'Neutre', negative: 'Négatif' };
const GREEN = '#04D99D', INK = '#131313', MUTED = '#7A7A7A', LINE = '#E6E6E6';

module.exports = function(app, { checkAuth, historyConfigured, readSovRows, sovFilters, aggregateShareOfVoice }) {

  app.get('/api/export', async (req, res) => {
    if (!checkAuth(req, res)) return;
    if (!historyConfigured()) return res.status(503).json({ error: 'History not configured', configured: false });
    const f = sovFilters(req.query);
    try {
      const rows = await readSovRows(f);
      await sendExport(res, {
        format: req.query.format, type: req.query.type, shareWith: req.query.shareWith,
        brand: f.brand, rows, period: `${f.days} derniers jours`, provider: f.provider
      });
    } catch (error) {
      console.error('❌ [ERROR] export:', error.message);
      if (!res.headersSent) res.status(500).json({ error: 'Export Error', message: error.message });
    }
  });

  app.post('/api/export', async (req, res) => {
    if (!checkAuth(req, res)) return;
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 5000) : [];
    if (!rows.length) return res.status(400).json({ error: 'Bad Request', message: 'rows[] is required' });
    try {
      await sendExport(res, {
        format: req.body.format, type: req.body.type, shareWith: req.body.shareWith,
        brand: req.body.brand || null, rows, period: req.body.period || null, title: req.body.title
      });
    } catch (error) {
      console.error('❌ [ERROR] export:', error.message);
      if (!res.headersSent) res.status(500).json({ error: 'Export Error', message: error.message });
    }
  });

  async function sendExport(res, opts) {
    const format = String(opts.format || 'csv').toLowerCase();
    const report = buildReport(opts, aggregateShareOfVoice);
    const base = `share-of-voice-${slug(report.brand || 'global')}-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      const csv = opts.type === 'summary' ? summaryCsv(report) : detailCsv(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
      return res.send('﻿' + csv);
    }
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
      return writePdf(report, res);
    }
    if (format === 'slides') {
      if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        return res.status(503).json({ error: 'Slides not configured', message: 'Définir GOOGLE_SERVICE_ACCOUNT_JSON' });
      }
      const result = await createSlides(report, opts.shareWith);
      return res.json({ status: 'success', ...result });
    }
    return res.status(400).json({ error: 'Bad Request', message: `format '${format}' non supporté (csv, pdf, slides)` });
  }
};

// =====================================================
// Données du rapport
// =====================================================
function buildReport({ brand, rows, period, provider, title }, aggregate) {
  const agg = aggregate(rows, brand);
  const focusName = agg.focus ? agg.focus.brand : brand;
  // Marques présentes dans les données, marque suivie en premier
  const brands = [...new Set(rows.flatMap(r => Object.keys(r.mentions || {})))];
  brands.sort((a, b) => (b === focusName) - (a === focusName));
  return {
    title: title || `Share of Voice IA${focusName ? ` : ${focusName}` : ''}`,
    brand: focusName,
    period: period || periodOf(rows),
    provider: provider || null,
    generatedAt: new Date(),
    rows,
    brands,
    agg
  };
}

function periodOf(rows) {
  const dates = rows.map(r => r.created_at).filter(Boolean).sort();
  if (!dates.length) return 'run en cours';
  const d = s => new Date(s).toLocaleDateString('fr-FR');
  return dates[0] === dates[dates.length - 1] ? d(dates[0]) : `du ${d(dates[0])} au ${d(dates[dates.length - 1])}`;
}

function focusIn(ranking, name) {
  return ranking.find(x => x.brand === name) || null;
}

function fmtPct(v) { return v == null ? '-' : `${String(v).replace('.', ',')} %`; }
function fmtNum(v) { return v == null ? '-' : String(v).replace('.', ','); }
function fmtSent(score) {
  if (score == null) return '-';
  const label = score > 0.2 ? 'Positif' : score < -0.2 ? 'Négatif' : 'Neutre';
  return `${label} (${score > 0 ? '+' : ''}${fmtNum(score)})`;
}
function slug(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export'; }

// =====================================================
// CSV
// =====================================================
function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(lines) {
  return lines.map(l => l.map(csvCell).join(';')).join('\r\n');
}

function detailCsv({ rows, brands, brand }) {
  const header = ['Date', 'Run', 'Marque suivie', 'Moteur', 'Prompt', 'Marque citée', 'Rang', 'Sentiment', 'Score sentiment', 'Erreur'];
  for (const b of brands) header.push(`${b} - mentions`, `${b} - rang`, `${b} - sentiment`);
  const lines = [header];
  for (const r of rows) {
    const focus = brand || r.brand;
    const ranks = r.ranks || {}, sents = r.sentiments || {};
    const fs = sents[focus];
    const line = [
      r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '',
      r.run_id || '', r.brand || '', r.provider || '', r.prompt || '',
      r.mentions && r.mentions[focus] > 0 ? 'oui' : 'non',
      ranks[focus] ?? '', fs ? SENTIMENT_FR[fs.label] : '', fs ? fs.score : '',
      r.error || ''
    ];
    for (const b of brands) {
      line.push(r.mentions ? (r.mentions[b] ?? '') : '', ranks[b] ?? '', sents[b] ? SENTIMENT_FR[sents[b].label] : '');
    }
    lines.push(line);
  }
  return toCsv(lines);
}

function summaryCsv({ agg }) {
  const header = ['Périmètre', 'Marque', 'Part de voix (%)', 'Taux de mention (%)', 'Rang moyen', 'Cité en 1er (%)', 'Score sentiment', 'Positif', 'Neutre', 'Négatif', 'Mentions', 'Réponses'];
  const lines = [header];
  const push = (scope, list, responses) => list.forEach(x => lines.push([
    scope, x.brand, x.shareOfVoice, x.mentionRate, x.avgRank, x.firstCitedRate, x.sentimentScore,
    x.sentiment.positive, x.sentiment.neutral, x.sentiment.negative, x.mentions, responses
  ]));
  push('Global', agg.ranking, agg.responses);
  for (const [prov, v] of Object.entries(agg.byProvider)) push(prov, v.ranking, v.responses);
  for (const w of agg.timeline) push(`Semaine ${w.week}`, w.ranking, w.responses);
  return toCsv(lines);
}

// =====================================================
// PDF
// =====================================================
function writePdf(report, stream) {
  const { agg, brand } = report;
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: report.title, Author: 'Big View' } });
  doc.pipe(stream);
  const W = doc.page.width - 80;

  // En-tête
  doc.rect(0, 0, doc.page.width, 6).fill(GREEN);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(report.title, 40, 32);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(`Période : ${report.period}${report.provider ? ` - moteur : ${report.provider}` : ''} - ${agg.responses} réponses analysées - généré le ${report.generatedAt.toLocaleDateString('fr-FR')}`);
  doc.moveDown(1.2);

  // KPIs de la marque suivie
  const f = agg.focus;
  if (f) {
    const kpis = [
      ['Part de voix', fmtPct(f.shareOfVoice)],
      ['Taux de mention', fmtPct(f.mentionRate)],
      ['Rang moyen', fmtNum(f.avgRank)],
      ['Cité en 1er', fmtPct(f.firstCitedRate)],
      ['Sentiment', f.sentimentScore == null ? '-' : `${f.sentimentScore > 0 ? '+' : ''}${fmtNum(f.sentimentScore)}`]
    ];
    const cw = W / kpis.length, y = doc.y;
    kpis.forEach(([label, value], i) => {
      const x = 40 + i * cw;
      doc.roundedRect(x + 3, y, cw - 6, 58, 6).fill('#F0FAF6');
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(17).text(value, x + 3, y + 10, { width: cw - 6, align: 'center' });
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(label, x + 3, y + 36, { width: cw - 6, align: 'center' });
    });
    doc.y = y + 58;
    doc.x = 40;
    doc.fillColor(MUTED).fontSize(9).text(`Position de ${brand} : ${f.position}e sur ${agg.ranking.length} marques suivies.`, 40, doc.y + 8);
    doc.moveDown(1);
  }

  // Classement global + barres de part de voix
  section(doc, 'Classement global');
  table(doc, ['Marque', 'Part de voix', 'Taux de mention', 'Rang moyen', 'Cité en 1er', 'Sentiment'],
    agg.ranking.map(x => [x.brand, fmtPct(x.shareOfVoice), fmtPct(x.mentionRate), fmtNum(x.avgRank), fmtPct(x.firstCitedRate), fmtSent(x.sentimentScore)]),
    [0.26, 0.13, 0.15, 0.12, 0.12, 0.22], brand);
  doc.moveDown(0.6);
  bars(doc, agg.ranking.slice(0, 10).map(x => [x.brand, x.shareOfVoice]), brand);

  // Par moteur
  if (Object.keys(agg.byProvider).length) {
    section(doc, 'Par moteur IA');
    table(doc, ['Moteur', 'Réponses', 'Part de voix', 'Taux de mention', 'Rang moyen', 'Leader'],
      Object.entries(agg.byProvider).map(([p, v]) => {
        const x = focusIn(v.ranking, brand) || {};
        return [p, String(v.responses), fmtPct(x.shareOfVoice), fmtPct(x.mentionRate), fmtNum(x.avgRank), v.ranking[0] ? v.ranking[0].brand : '-'];
      }),
      [0.2, 0.12, 0.18, 0.16, 0.14, 0.2]);
  }

  // Sentiment
  const withSent = agg.ranking.filter(x => x.sentimentScore != null);
  if (withSent.length) {
    section(doc, 'Sentiment des mentions');
    table(doc, ['Marque', 'Score moyen', 'Positif', 'Neutre', 'Négatif'],
      withSent.map(x => [x.brand, fmtSent(x.sentimentScore), String(x.sentiment.positive), String(x.sentiment.neutral), String(x.sentiment.negative)]),
      [0.32, 0.26, 0.14, 0.14, 0.14], brand);
  }

  // Évolution hebdomadaire
  if (agg.timeline.length > 1) {
    section(doc, 'Évolution hebdomadaire');
    table(doc, ['Semaine', 'Réponses', 'Part de voix', 'Taux de mention', 'Sentiment', 'Leader'],
      agg.timeline.slice(-12).map(w => {
        const x = focusIn(w.ranking, brand) || {};
        return [w.week, String(w.responses), fmtPct(x.shareOfVoice), fmtPct(x.mentionRate), fmtSent(x.sentimentScore), w.ranking[0] ? w.ranking[0].brand : '-'];
      }),
      [0.14, 0.12, 0.18, 0.16, 0.2, 0.2]);
  }

  // Définitions
  section(doc, 'Définitions');
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(
    'Part de voix : part des mentions de la marque sur le total des mentions de toutes les marques suivies. ' +
    'Taux de mention : part des réponses citant la marque au moins une fois. ' +
    'Rang moyen : ordre moyen d\'apparition de la marque parmi les marques citées dans une même réponse (1 = citée en premier). ' +
    'Sentiment : ton employé au sujet de la marque, de -1 (négatif) à +1 (positif), évalué par IA sur chaque réponse.',
    40, doc.y, { width: W });

  doc.end();
}

function ensureSpace(doc, h) {
  if (doc.y + h > doc.page.height - 50) { doc.addPage(); doc.y = 40; }
}

function section(doc, title) {
  ensureSpace(doc, 60);
  doc.moveDown(0.8);
  doc.x = 40;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(title);
  doc.save().lineWidth(2).strokeColor(GREEN).moveTo(40, doc.y + 2).lineTo(80, doc.y + 2).stroke().restore();
  doc.moveDown(0.6);
}

function table(doc, header, rows, widths, highlight) {
  const W = doc.page.width - 80, rh = 18;
  const cols = widths.map(w => w * W);
  const drawRow = (cells, y, opts = {}) => {
    if (opts.fill) doc.rect(40, y, W, rh).fill(opts.fill);
    let x = 40;
    cells.forEach((c, i) => {
      doc.fillColor(opts.color || INK).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(String(c), x + 4, y + 5, { width: cols[i] - 8, height: rh - 4, ellipsis: true, lineBreak: false });
      x += cols[i];
    });
    doc.save().lineWidth(0.5).strokeColor(LINE).moveTo(40, y + rh).lineTo(40 + W, y + rh).stroke().restore();
  };
  ensureSpace(doc, rh * 2);
  // Positions gérées à la main : text() avec lineBreak:false fait bouger doc.y de façon imprévisible
  const top = doc.y;
  drawRow(header, top, { bold: true, fill: '#F3F3F3' });
  let next = top + rh;
  for (const r of rows) {
    if (next + rh > doc.page.height - 50) {
      doc.addPage();
      next = 40;
      drawRow(header, next, { bold: true, fill: '#F3F3F3' });
      next += rh;
    }
    const isFocus = highlight && r[0] === highlight;
    drawRow(r, next, { bold: isFocus, fill: isFocus ? '#F0FAF6' : null });
    next += rh;
  }
  doc.x = 40;
  doc.y = next + 4;
}

function bars(doc, items, highlight) {
  if (!items.length) return;
  const W = doc.page.width - 80, labelW = 130, h = 13, gap = 5;
  ensureSpace(doc, items.length * (h + gap) + 10);
  let y = doc.y;
  const max = Math.max(...items.map(i => i[1]), 1);
  for (const [name, v] of items) {
    doc.fillColor(INK).font(name === highlight ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
      .text(name, 40, y + 2, { width: labelW - 8, ellipsis: true, lineBreak: false });
    const bw = ((W - labelW - 50) * v) / max;
    doc.rect(40 + labelW, y, Math.max(bw, 1), h).fill(name === highlight ? GREEN : '#BFEFE0');
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(fmtPct(v), 40 + labelW + bw + 6, y + 2, { lineBreak: false });
    y += h + gap;
  }
  doc.x = 40;
  doc.y = y + 4;
}

// =====================================================
// Google Slides (compte de service)
// =====================================================
function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
  return JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
}

async function googleToken(scopes) {
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const claims = { iss: sa.client_email, scope: scopes.join(' '), aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  if (process.env.GOOGLE_IMPERSONATE) claims.sub = process.env.GOOGLE_IMPERSONATE;
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');

  const response = await fetch(claims.aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google auth ${response.status}: ${data.error_description || data.error}`);
  return data.access_token;
}

async function gapi(token, method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Google API ${response.status}: ${data.error?.message || text}`);
  return data;
}

// Petites briques de requêtes Slides (unités en points, page 16:9 = 720 x 405)
const PT = v => ({ magnitude: v, unit: 'PT' });
function textBox(id, page, x, y, w, h, text, style = {}) {
  return [
    { createShape: { objectId: id, shapeType: 'TEXT_BOX', elementProperties: { pageObjectId: page, size: { width: PT(w), height: PT(h) }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'PT' } } } },
    { insertText: { objectId: id, text } },
    { updateTextStyle: { objectId: id, fields: 'fontSize,bold,foregroundColor,fontFamily', style: {
      fontSize: PT(style.size || 14), bold: !!style.bold, fontFamily: style.font || 'Poppins',
      foregroundColor: { opaqueColor: { rgbColor: hexRgb(style.color || INK) } }
    } } },
    ...(style.align ? [{ updateParagraphStyle: { objectId: id, fields: 'alignment', style: { alignment: style.align } } }] : [])
  ];
}
function rect(id, page, x, y, w, h, color) {
  return [
    { createShape: { objectId: id, shapeType: 'RECTANGLE', elementProperties: { pageObjectId: page, size: { width: PT(w), height: PT(h) }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'PT' } } } },
    { updateShapeProperties: { objectId: id, fields: 'shapeBackgroundFill.solidFill.color,outline.propertyState', shapeProperties: {
      shapeBackgroundFill: { solidFill: { color: { rgbColor: hexRgb(color) } } }, outline: { propertyState: 'NOT_RENDERED' }
    } } }
  ];
}
function slideTable(id, page, header, rows, y = 90) {
  const all = [header, ...rows];
  const reqs = [{ createTable: { objectId: id, rows: all.length, columns: header.length, elementProperties: {
    pageObjectId: page, size: { width: PT(640), height: PT(24 * all.length) }, transform: { scaleX: 1, scaleY: 1, translateX: 40, translateY: y, unit: 'PT' }
  } } }];
  all.forEach((r, ri) => r.forEach((c, ci) => {
    reqs.push({ insertText: { objectId: id, cellLocation: { rowIndex: ri, columnIndex: ci }, text: String(c == null || c === '' ? '-' : c) } });
  }));
  reqs.push({ updateTextStyle: { objectId: id, textRange: { type: 'ALL' }, fields: 'fontSize,fontFamily', style: { fontSize: PT(10), fontFamily: 'Roboto' } } });
  for (let ci = 0; ci < header.length; ci++) {
    reqs.push({ updateTextStyle: { objectId: id, cellLocation: { rowIndex: 0, columnIndex: ci }, textRange: { type: 'ALL' }, fields: 'bold', style: { bold: true } } });
  }
  reqs.push({ updateTableCellProperties: { objectId: id, tableRange: { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: header.length },
    fields: 'tableCellBackgroundFill.solidFill.color', tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: hexRgb('#F0FAF6') } } } } } });
  return reqs;
}
function hexRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

async function createSlides(report, shareWith) {
  const token = await googleToken(['https://www.googleapis.com/auth/presentations', 'https://www.googleapis.com/auth/drive']);
  const name = `${report.title} - ${report.generatedAt.toLocaleDateString('fr-FR')}`;
  const folder = process.env.GOOGLE_SLIDES_FOLDER_ID;

  let presentationId;
  if (folder) {
    const file = await gapi(token, 'POST', 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
      { name, mimeType: 'application/vnd.google-apps.presentation', parents: [folder] });
    presentationId = file.id;
  } else {
    presentationId = (await gapi(token, 'POST', 'https://slides.googleapis.com/v1/presentations', { title: name })).presentationId;
  }
  const pres = await gapi(token, 'GET', `https://slides.googleapis.com/v1/presentations/${presentationId}?fields=slides.objectId`);

  const { agg, brand } = report;
  const f = agg.focus;
  const reqs = [];
  let n = 0;
  const newSlide = () => { const id = `sov_s${++n}`; reqs.push({ createSlide: { objectId: id, slideLayoutReference: { predefinedLayout: 'BLANK' } } }); return id; };
  const header = (page, title) => {
    reqs.push(...rect(`${page}_bar`, page, 0, 0, 720, 6, GREEN));
    reqs.push(...textBox(`${page}_t`, page, 40, 24, 640, 40, title, { size: 22, bold: true }));
  };

  // 1. Couverture
  let s = newSlide();
  reqs.push(...rect(`${s}_bg`, s, 0, 0, 720, 405, INK));
  reqs.push(...rect(`${s}_bar`, s, 40, 150, 60, 5, GREEN));
  reqs.push(...textBox(`${s}_t`, s, 40, 165, 640, 60, report.title, { size: 32, bold: true, color: '#FFFFFF' }));
  reqs.push(...textBox(`${s}_st`, s, 40, 230, 640, 40, `${report.period} - ${agg.responses} réponses analysées`, { size: 14, color: '#BFEFE0', font: 'Roboto' }));

  // 2. KPIs
  if (f) {
    s = newSlide();
    header(s, `${brand} : indicateurs clés`);
    const kpis = [['Part de voix', fmtPct(f.shareOfVoice)], ['Taux de mention', fmtPct(f.mentionRate)], ['Rang moyen', fmtNum(f.avgRank)],
      ['Cité en 1er', fmtPct(f.firstCitedRate)], ['Sentiment', f.sentimentScore == null ? '-' : `${f.sentimentScore > 0 ? '+' : ''}${fmtNum(f.sentimentScore)}`]];
    kpis.forEach(([label, value], i) => {
      const x = 40 + i * 128;
      reqs.push(...rect(`${s}_k${i}`, s, x, 120, 120, 110, '#F0FAF6'));
      reqs.push(...textBox(`${s}_kv${i}`, s, x, 140, 120, 40, value, { size: 24, bold: true, align: 'CENTER' }));
      reqs.push(...textBox(`${s}_kl${i}`, s, x, 190, 120, 24, label, { size: 11, color: MUTED, font: 'Roboto', align: 'CENTER' }));
    });
    reqs.push(...textBox(`${s}_pos`, s, 40, 260, 640, 30, `${f.position}e position sur ${agg.ranking.length} marques suivies`, { size: 13, color: MUTED, font: 'Roboto' }));
  }

  // 3. Classement global
  s = newSlide();
  header(s, 'Classement global');
  reqs.push(...slideTable(`${s}_tb`, s, ['Marque', 'Part de voix', 'Mention', 'Rang moyen', 'Cité en 1er', 'Sentiment'],
    agg.ranking.slice(0, 10).map(x => [x.brand, fmtPct(x.shareOfVoice), fmtPct(x.mentionRate), fmtNum(x.avgRank), fmtPct(x.firstCitedRate), fmtSent(x.sentimentScore)])));

  // 4. Par moteur
  if (Object.keys(agg.byProvider).length) {
    s = newSlide();
    header(s, 'Par moteur IA');
    reqs.push(...slideTable(`${s}_tb`, s, ['Moteur', 'Réponses', 'Part de voix', 'Mention', 'Rang moyen', 'Leader'],
      Object.entries(agg.byProvider).slice(0, 10).map(([p, v]) => {
        const x = focusIn(v.ranking, brand) || {};
        return [p, v.responses, fmtPct(x.shareOfVoice), fmtPct(x.mentionRate), fmtNum(x.avgRank), v.ranking[0] ? v.ranking[0].brand : '-'];
      })));
  }

  // 5. Sentiment
  const withSent = agg.ranking.filter(x => x.sentimentScore != null);
  if (withSent.length) {
    s = newSlide();
    header(s, 'Sentiment des mentions');
    reqs.push(...slideTable(`${s}_tb`, s, ['Marque', 'Score moyen', 'Positif', 'Neutre', 'Négatif'],
      withSent.slice(0, 10).map(x => [x.brand, fmtSent(x.sentimentScore), x.sentiment.positive, x.sentiment.neutral, x.sentiment.negative])));
  }

  // 6. Évolution hebdomadaire
  if (agg.timeline.length > 1) {
    s = newSlide();
    header(s, 'Évolution hebdomadaire');
    reqs.push(...slideTable(`${s}_tb`, s, ['Semaine', 'Réponses', 'Part de voix', 'Mention', 'Sentiment', 'Leader'],
      agg.timeline.slice(-10).map(w => {
        const x = focusIn(w.ranking, brand) || {};
        return [w.week, w.responses, fmtPct(x.shareOfVoice), fmtPct(x.mentionRate), fmtSent(x.sentimentScore), w.ranking[0] ? w.ranking[0].brand : '-'];
      })));
  }

  // Supprime la diapositive vide créée par défaut
  for (const sl of pres.slides || []) reqs.push({ deleteObject: { objectId: sl.objectId } });

  await gapi(token, 'POST', `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, { requests: reqs });

  const emails = [...String(shareWith || '').split(','), ...String(process.env.GOOGLE_SLIDES_SHARE_WITH || DEFAULT_SHARE_WITH).split(',')]
    .map(e => e.trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const shared = [];
  for (const email of [...new Set(emails)]) {
    try {
      await gapi(token, 'POST', `https://www.googleapis.com/drive/v3/files/${presentationId}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
        { type: 'user', role: 'writer', emailAddress: email });
      shared.push(email);
    } catch (e) {
      console.error(`⚠️ [SLIDES] partage ${email}:`, e.message);
    }
  }

  return { presentationId, url: `https://docs.google.com/presentation/d/${presentationId}/edit`, sharedWith: shared };
}
