/**
 * Exports du Share of Voice : CSV, PDF, Google Slides (charte Big View)
 *   GET  /api/export?format=csv|pdf|slides&brand=[&run=latest|<run_id>][&days=][&provider=][&type=detail|summary][&shareWith=email]
 *        Avec une marque et sans `days`, l'export porte sur une étude (la dernière par défaut),
 *        comparée à l'étude précédente. Avec `days`, il porte sur toute la période.
 *   POST /api/export  { format, brand, rows[], previousRows?, type?, shareWith?, title? }
 *   GET  /assets/logo-bigview.png (public) : logo utilisé dans les présentations Google Slides
 *
 * CSV  : séparateur « ; » + BOM UTF-8 (ouverture directe dans Excel FR).
 *        type=detail (défaut) : une ligne par réponse, avec l'extrait de réponse et l'évolution ;
 *        type=summary : indicateurs (global, moteurs, semaines) et progression étude par étude.
 * PDF / Slides : synthèse, évolution (dont sentiment), moteurs, résultats par prompt, réponses.
 * Slides : présentation créée via un compte de service.
 *   GOOGLE_SERVICE_ACCOUNT_JSON  clé JSON du compte de service (brute ou base64)
 *   GOOGLE_SLIDES_FOLDER_ID      dossier (Drive partagé conseillé) où créer la présentation
 *   GOOGLE_IMPERSONATE           utilisateur Workspace à emprunter (délégation domaine), optionnel
 *   GOOGLE_SLIDES_SHARE_WITH     e-mails (séparés par des virgules) à qui donner l'accès en écriture
 *                                (défaut : florent.buil@big-view.fr)
 *   PUBLIC_BASE_URL              URL publique du proxy (pour le logo), sinon déduite de la requête
 */
const crypto = require('crypto');
const path = require('path');
const PDFDocument = require('pdfkit');
const { groupRuns, pickRun, buildProgress } = require('./runs.js');

const DEFAULT_SHARE_WITH = 'florent.buil@big-view.fr';
const SENTIMENT_FR = { positive: 'Positif', neutral: 'Neutre', negative: 'Négatif' };
const TAGLINE = "L'IA accélère, l'expérience pilote.";

// Charte Big View
const GREEN = '#04D99D', YELLOW = '#F3D604', GRAY = '#595959', BLACK = '#000000', WHITE = '#FFFFFF', TINT = '#F0FAF6', LINE = '#E0E0E0';
const ASSETS = path.join(__dirname, '..', 'assets');
const LOGO = path.join(ASSETS, 'logo-bigview.png');
const FONTS = {
  title: path.join(ASSETS, 'fonts', 'raleway-latin-800-normal.woff'),
  titleBold: path.join(ASSETS, 'fonts', 'raleway-latin-700-normal.woff'),
  body: path.join(ASSETS, 'fonts', 'roboto-latin-400-normal.woff'),
  bodyBold: path.join(ASSETS, 'fonts', 'roboto-latin-700-normal.woff')
};

module.exports = function(app, { checkAuth, historyConfigured, readSovRows, readRunRows, sovFilters, aggregateShareOfVoice, normalize }) {

  app.get('/assets/logo-bigview.png', (req, res) => res.sendFile(LOGO));

  app.get('/api/export', async (req, res) => {
    if (!checkAuth(req, res)) return;
    if (!historyConfigured()) return res.status(503).json({ error: 'History not configured', configured: false });
    const f = sovFilters(req.query);
    const periodMode = !f.brand || req.query.days != null;
    try {
      let rows, period, runId = null;
      if (periodMode) {
        rows = await readSovRows(f);
        period = `${f.days} derniers jours`;
      } else {
        rows = await readRunRows({ brand: f.brand });
        if (f.provider) rows = rows.filter(r => r.provider === f.provider);
        runId = req.query.run || 'latest';
      }
      await sendExport(res, {
        format: req.query.format, type: req.query.type, shareWith: req.query.shareWith,
        brand: f.brand, rows, period, provider: f.provider, runId, baseUrl: baseUrlOf(req)
      });
    } catch (error) {
      console.error('❌ [ERROR] export:', error.message);
      if (!res.headersSent) res.status(500).json({ error: 'Export Error', message: error.message });
    }
  });

  app.post('/api/export', async (req, res) => {
    if (!checkAuth(req, res)) return;
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 5000) : [];
    const previousRows = Array.isArray(req.body.previousRows) ? req.body.previousRows.slice(0, 5000) : [];
    if (!rows.length) return res.status(400).json({ error: 'Bad Request', message: 'rows[] is required' });
    // Lignes fournies : on les traite comme une étude, éventuellement comparée à previousRows
    const tag = (list, id, fallback) => list.map(r => ({ ...r, run_id: id, created_at: r.created_at || fallback }));
    const all = [...tag(previousRows, 'precedente', new Date(Date.now() - 1000).toISOString()), ...tag(rows, 'courante', new Date().toISOString())];
    try {
      await sendExport(res, {
        format: req.body.format, type: req.body.type, shareWith: req.body.shareWith,
        brand: req.body.brand || null, rows: all, period: req.body.period || null, title: req.body.title,
        runId: 'courante', baseUrl: baseUrlOf(req)
      });
    } catch (error) {
      console.error('❌ [ERROR] export:', error.message);
      if (!res.headersSent) res.status(500).json({ error: 'Export Error', message: error.message });
    }
  });

  async function sendExport(res, opts) {
    const format = String(opts.format || 'csv').toLowerCase();
    const report = buildReport(opts, aggregateShareOfVoice, normalize);
    if (!report.rows.length) return res.status(404).json({ error: 'No data', message: 'Aucune donnée pour cette marque / période' });
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
      const result = await createSlides(report, opts.shareWith, opts.baseUrl);
      return res.json({ status: 'success', ...result });
    }
    return res.status(400).json({ error: 'Bad Request', message: `format '${format}' non supporté (csv, pdf, slides)` });
  }
};

function baseUrlOf(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// =====================================================
// Données du rapport
// =====================================================
function buildReport({ brand, rows, period, provider, title, runId }, aggregate, normalize) {
  const runs = groupRuns(rows);
  let current = rows, progress = null, prevAgg = null, timeline = [], scope = 'period';

  if (runId) {
    const ctx = pickRun(runs, runId);
    if (ctx.current) {
      scope = 'run';
      current = ctx.current.rows;
      if (ctx.previous) prevAgg = aggregate(ctx.previous.rows, brand);
      if (brand) {
        progress = buildProgress(ctx, brand, aggregate, normalize);
        timeline = progress.timeline;
      }
    } else current = [];
  } else if (brand && runs.length) {
    const ctx = pickRun(runs, 'latest');
    progress = buildProgress(ctx, brand, aggregate, normalize);
    timeline = progress.timeline;
  }

  const agg = aggregate(current, brand);
  const focusName = agg.focus ? agg.focus.brand : brand;
  const brands = [...new Set(current.flatMap(r => Object.keys(r.mentions || {})))];
  brands.sort((a, b) => (b === focusName) - (a === focusName));

  const prevFocus = prevAgg && focusName ? prevAgg.ranking.find(x => normalize(x.brand) === normalize(focusName)) || null : null;
  const trends = new Map();
  if (progress) for (const p of progress.prompts) for (const c of p.cells) trends.set(`${p.prompt}|${c.provider}`, c.trend);

  return {
    title: title || `Share of Voice IA${focusName ? ` : ${focusName}` : ''}`,
    brand: focusName,
    scope,
    period: scope === 'run' ? `Étude du ${fmtDate(current[0] && current[0].created_at)}` : (period || periodOf(current)),
    previousLabel: progress && progress.previous ? `étude du ${fmtDate(progress.previous.date)}` : null,
    provider: provider || null,
    generatedAt: new Date(),
    rows: current,
    brands,
    agg,
    prevAgg,
    prevFocus,
    progress,
    timeline,
    trends
  };
}

function periodOf(rows) {
  const dates = rows.map(r => r.created_at).filter(Boolean).sort();
  if (!dates.length) return 'run en cours';
  return dates[0].slice(0, 10) === dates[dates.length - 1].slice(0, 10) ? fmtDate(dates[0]) : `du ${fmtDate(dates[0])} au ${fmtDate(dates[dates.length - 1])}`;
}

function focusIn(ranking, name) { return ranking.find(x => x.brand === name) || null; }
function leaderOf(ranking) { return ranking[0] && ranking[0].mentions > 0 ? ranking[0].brand : '-'; }
function fmtDate(s) { return s ? new Date(s).toLocaleDateString('fr-FR') : '-'; }
function fmtPct(v) { return v == null ? '-' : `${String(v).replace('.', ',')} %`; }
function fmtNum(v) { return v == null ? '-' : String(v).replace('.', ','); }
function fmtScore(v) { return v == null ? '-' : `${v > 0 ? '+' : ''}${fmtNum(v)}`; }
function fmtSent(score) {
  if (score == null) return '-';
  const label = score > 0.2 ? 'Positif' : score < -0.2 ? 'Négatif' : 'Neutre';
  return `${label} (${fmtScore(score)})`;
}
function ordinal(n) { return n === 1 ? '1re' : `${n}e`; }
function slug(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export'; }
function truncate(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Écart entre deux valeurs : texte + sens (better / worse / same). lowerIsBetter pour le rang.
function delta(now, before, { unit = ' pts', lowerIsBetter = false, digits = 1 } = {}) {
  if (now == null || before == null) return null;
  const d = Math.round((now - before) * 10 ** digits) / 10 ** digits;
  const dir = d === 0 ? 'same' : ((d < 0) === lowerIsBetter ? 'better' : 'worse');
  return { value: d, dir, text: d === 0 ? '=' : `${d > 0 ? '+' : ''}${fmtNum(d)}${unit}` };
}

function kpis(report) {
  const f = report.agg.focus;
  if (!f) return [];
  const p = report.prevFocus;
  return [
    { label: 'Part de voix', value: fmtPct(f.shareOfVoice), delta: p && delta(f.shareOfVoice, p.shareOfVoice) },
    { label: 'Taux de mention', value: fmtPct(f.mentionRate), delta: p && delta(f.mentionRate, p.mentionRate) },
    { label: 'Rang moyen', value: fmtNum(f.avgRank), delta: p && delta(f.avgRank, p.avgRank, { unit: '', lowerIsBetter: true }) },
    { label: 'Cité en 1er', value: fmtPct(f.firstCitedRate), delta: p && delta(f.firstCitedRate, p.firstCitedRate) },
    { label: 'Sentiment', value: fmtScore(f.sentimentScore), delta: p && delta(f.sentimentScore, p.sentimentScore, { unit: '', digits: 2 }) }
  ];
}

// Phrase d'accroche factuelle (Bloc Accroche jaune)
function headline(report) {
  const f = report.agg.focus;
  if (!f) return `${report.agg.responses} réponses d'IA analysées.`;
  let s = `${report.brand} est citée dans ${fmtPct(f.mentionRate)} des réponses des IA`;
  const d = report.prevFocus && delta(f.mentionRate, report.prevFocus.mentionRate);
  if (d && d.value !== 0) s += `, ${d.value > 0 ? 'en hausse' : 'en baisse'} de ${fmtNum(Math.abs(d.value))} pts depuis l'${report.previousLabel}`;
  else if (d) s += `, stable depuis l'${report.previousLabel}`;
  s += '.';
  const sd = report.prevFocus && delta(f.sentimentScore, report.prevFocus.sentimentScore, { unit: '', digits: 2 });
  if (sd && sd.value !== 0) s += ` Le sentiment ${sd.value > 0 ? "s'améliore" : 'se dégrade'} (${sd.text}).`;
  return s;
}

const TREND_FR = { 'gagné': 'Gagné', 'perdu': 'Perdu', 'en hausse': 'En hausse', 'en baisse': 'En baisse', 'stable': 'Stable', 'nouveau': 'Nouveau', 'absent': '-' };

// =====================================================
// CSV
// =====================================================
function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(lines) { return lines.map(l => l.map(csvCell).join(';')).join('\r\n'); }

function detailCsv({ rows, brands, brand, trends }) {
  const header = ['Date', 'Étude', 'Marque suivie', 'Moteur', 'Prompt', 'Marque citée', 'Rang', 'Sentiment', 'Score sentiment', 'Évolution vs étude précédente'];
  for (const b of brands) header.push(`${b} - mentions`, `${b} - rang`, `${b} - sentiment`);
  header.push('Réponse', 'Erreur');
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
      TREND_FR[trends.get(`${r.prompt}|${r.provider}`)] || ''
    ];
    for (const b of brands) line.push(r.mentions ? (r.mentions[b] ?? '') : '', ranks[b] ?? '', sents[b] ? SENTIMENT_FR[sents[b].label] : '');
    line.push(r.excerpt || '', r.error || '');
    lines.push(line);
  }
  return toCsv(lines);
}

function summaryCsv({ agg, timeline, brand }) {
  const header = ['Périmètre', 'Marque', 'Part de voix (%)', 'Taux de mention (%)', 'Rang moyen', 'Cité en 1er (%)', 'Score sentiment', 'Positif', 'Neutre', 'Négatif', 'Mentions', 'Réponses'];
  const lines = [header];
  const push = (scope, list, responses) => list.forEach(x => lines.push([
    scope, x.brand, x.shareOfVoice, x.mentionRate, x.avgRank, x.firstCitedRate, x.sentimentScore,
    x.sentiment.positive, x.sentiment.neutral, x.sentiment.negative, x.mentions, responses
  ]));
  push('Global', agg.ranking, agg.responses);
  for (const [prov, v] of Object.entries(agg.byProvider)) push(prov, v.ranking, v.responses);
  for (const w of agg.timeline) push(`Semaine ${w.week}`, w.ranking, w.responses);
  if (timeline.length) {
    lines.push([]);
    lines.push([`Progression de ${brand || 'la marque'} étude par étude`]);
    lines.push(['Date', 'Étude', 'Prompts', 'Réponses', 'Part de voix (%)', 'Évol. part de voix (pts)', 'Taux de mention (%)', 'Évol. mention (pts)', 'Rang moyen', 'Évol. rang', 'Score sentiment', 'Évol. sentiment']);
    for (const t of timeline) {
      const d = t.delta || {};
      lines.push([fmtDate(t.date), t.run_id, t.prompts, t.responses, t.shareOfVoice, d.shareOfVoice, t.mentionRate, d.mentionRate, t.avgRank, d.avgRank, t.sentimentScore, d.sentimentScore]);
    }
  }
  return toCsv(lines);
}

// =====================================================
// PDF (charte Big View)
// =====================================================
const M = 40; // marge

function writePdf(report, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: report.title, Author: 'Big View' } });
  doc.registerFont('Title', FONTS.title);
  doc.registerFont('TitleBold', FONTS.titleBold);
  doc.registerFont('Body', FONTS.body);
  doc.registerFont('BodyBold', FONTS.bodyBold);
  doc.pipe(stream);
  const W = doc.page.width - 2 * M;
  const { agg, brand } = report;

  pdfCover(doc, report);

  // --- Synthèse
  doc.addPage();
  section(doc, 'Synthèse');
  const ks = kpis(report);
  if (ks.length) {
    const cw = W / ks.length, y = doc.y;
    ks.forEach((k, i) => {
      const x = M + i * cw;
      doc.rect(x + 3, y, cw - 6, 70).fill(TINT);
      doc.fillColor(BLACK).font('Title').fontSize(17).text(k.value, x + 3, y + 9, { width: cw - 6, align: 'center' });
      doc.fillColor(GRAY).font('Body').fontSize(8.5).text(k.label, x + 3, y + 33, { width: cw - 6, align: 'center' });
      if (k.delta) {
        doc.fillColor(k.delta.dir === 'better' ? GREEN : k.delta.dir === 'worse' ? BLACK : GRAY).font('BodyBold').fontSize(8.5)
          .text(k.delta.text, x + 3, y + 50, { width: cw - 6, align: 'center' });
      }
    });
    doc.y = y + 78;
    if (report.previousLabel) doc.fillColor(GRAY).font('Body').fontSize(8).text(`Écarts calculés par rapport à l'${report.previousLabel}.`, M, doc.y);
    doc.moveDown(0.6);
  }
  accroche(doc, headline(report));
  if (agg.focus) doc.fillColor(GRAY).font('Body').fontSize(9).text(`${ordinal(agg.focus.position)} position sur ${agg.ranking.length} marques suivies, ${agg.responses} réponses analysées.`, M, doc.y);
  doc.moveDown(0.5);

  subTitle(doc, 'Classement global');
  table(doc, ['Marque', 'Part de voix', 'Taux de mention', 'Rang moyen', 'Cité en 1er', 'Sentiment'],
    agg.ranking.map(x => [x.brand, fmtPct(x.shareOfVoice), fmtPct(x.mentionRate), fmtNum(x.avgRank), fmtPct(x.firstCitedRate), fmtSent(x.sentimentScore)]),
    [0.26, 0.13, 0.15, 0.12, 0.12, 0.22], brand);
  doc.moveDown(0.4);
  bars(doc, agg.ranking.slice(0, 10).map(x => [x.brand, x.shareOfVoice]), brand);

  if (Object.keys(agg.byProvider).length) {
    subTitle(doc, 'Par moteur IA');
    table(doc, ['Moteur', 'Réponses', 'Part de voix', 'Taux de mention', 'Rang moyen', 'Leader'],
      Object.entries(agg.byProvider).map(([p, v]) => {
        const x = focusIn(v.ranking, brand) || {};
        return [p, String(v.responses), fmtPct(x.shareOfVoice), fmtPct(x.mentionRate), fmtNum(x.avgRank), leaderOf(v.ranking)];
      }), [0.2, 0.12, 0.17, 0.17, 0.14, 0.2]);
  }

  // --- Évolution
  doc.addPage();
  section(doc, 'Évolution');
  if (report.timeline.length > 1) {
    subTitle(doc, `Progression de ${brand} étude par étude`);
    table(doc, ['Date', 'Part de voix', 'Évol.', 'Mention', 'Évol.', 'Rang moyen', 'Sentiment', 'Évol.'],
      report.timeline.slice(-12).map(t => {
        const d = t.delta || {};
        return [fmtDate(t.date), fmtPct(t.shareOfVoice), signed(d.shareOfVoice, ' pts'), fmtPct(t.mentionRate), signed(d.mentionRate, ' pts'), fmtNum(t.avgRank), fmtScore(t.sentimentScore), signed(d.sentimentScore, '')];
      }), [0.13, 0.13, 0.11, 0.13, 0.11, 0.13, 0.13, 0.13]);
  } else {
    accroche(doc, "Première étude pour cette marque : elle sert de point de référence. Relancez les mêmes prompts lors de la prochaine étude pour mesurer la progression.");
  }

  subTitle(doc, 'Sentiment des mentions');
  const withSent = agg.ranking.filter(x => x.sentimentScore != null || (report.prevAgg && focusIn(report.prevAgg.ranking, x.brand)));
  if (withSent.length) {
    table(doc, ['Marque', 'Score moyen', 'Évolution', 'Positif', 'Neutre', 'Négatif'],
      withSent.map(x => {
        const prev = report.prevAgg && focusIn(report.prevAgg.ranking, x.brand);
        const d = prev && delta(x.sentimentScore, prev.sentimentScore, { unit: '', digits: 2 });
        return [x.brand, fmtSent(x.sentimentScore), d ? d.text : '-', String(x.sentiment.positive), String(x.sentiment.neutral), String(x.sentiment.negative)];
      }), [0.28, 0.22, 0.14, 0.12, 0.12, 0.12], brand);
  } else {
    doc.fillColor(GRAY).font('Body').fontSize(9).text('Aucune mention de marque dans les réponses : pas de sentiment à mesurer.', M, doc.y);
  }

  if (agg.timeline.length > 1) {
    subTitle(doc, 'Évolution hebdomadaire');
    table(doc, ['Semaine', 'Réponses', 'Part de voix', 'Taux de mention', 'Sentiment', 'Leader'],
      agg.timeline.slice(-12).map(w => {
        const x = focusIn(w.ranking, brand) || {};
        return [w.week, String(w.responses), fmtPct(x.shareOfVoice), fmtPct(x.mentionRate), fmtSent(x.sentimentScore), leaderOf(w.ranking)];
      }), [0.14, 0.12, 0.17, 0.17, 0.2, 0.2]);
  }

  // --- Résultats par prompt
  if (report.progress && report.progress.prompts.length) {
    doc.addPage();
    section(doc, 'Résultats par prompt');
    const provs = report.progress.providers;
    doc.fillColor(GRAY).font('Body').fontSize(8.5).text(`Chaque case indique le rang de ${brand} dans la réponse du moteur (- : non citée)${report.previousLabel ? `, et son évolution depuis l'${report.previousLabel}` : ''}.`, M, doc.y, { width: W });
    doc.moveDown(0.5);
    const pw = 0.34, cw = (1 - pw) / Math.max(provs.length, 1);
    table(doc, ['Prompt', ...provs],
      report.progress.prompts.map(p => [p.prompt, ...p.cells.map(c => cellLabel(c))]),
      [pw, ...provs.map(() => cw)]);
  }

  // --- Réponses détaillées
  const answered = report.rows.filter(r => r.excerpt || r.error);
  doc.addPage();
  section(doc, 'Réponses des IA');
  if (!answered.length) {
    doc.fillColor(GRAY).font('Body').fontSize(9).text("Les textes des réponses n'ont pas été enregistrés pour cette étude.", M, doc.y, { width: W });
  }
  const byPrompt = new Map();
  for (const r of answered) { if (!byPrompt.has(r.prompt)) byPrompt.set(r.prompt, []); byPrompt.get(r.prompt).push(r); }
  for (const [prompt, list] of byPrompt) {
    ensureSpace(doc, 70);
    doc.fillColor(BLACK).font('TitleBold').fontSize(10.5).text(prompt || '(prompt vide)', M, doc.y, { width: W });
    doc.moveDown(0.3);
    for (const r of list) {
      const key = brand && Object.keys(r.mentions || {}).find(k => k === brand);
      const cited = key && r.mentions[key] > 0;
      const s = cited && r.sentiments && r.sentiments[key];
      const meta = [r.provider, cited ? `citée${r.ranks && r.ranks[key] ? ` (rang ${r.ranks[key]})` : ''}` : 'non citée', s ? `sentiment ${SENTIMENT_FR[s.label].toLowerCase()}` : null].filter(Boolean).join(' · ');
      ensureSpace(doc, 40);
      doc.fillColor(cited ? GREEN : GRAY).font('BodyBold').fontSize(8.5).text(meta, M + 8, doc.y, { width: W - 8 });
      doc.fillColor(GRAY).font('Body').fontSize(8.5).text(r.error ? `Erreur : ${r.error}` : truncate(r.excerpt, 900), M + 8, doc.y, { width: W - 8 });
      doc.moveDown(0.4);
    }
    doc.moveDown(0.3);
  }

  // --- Définitions
  ensureSpace(doc, 110);
  subTitle(doc, 'Définitions');
  doc.font('Body').fontSize(8.5).fillColor(GRAY).text(
    'Part de voix : part des mentions de la marque sur le total des mentions de toutes les marques suivies. ' +
    'Taux de mention : part des réponses citant la marque au moins une fois. ' +
    "Rang moyen : ordre moyen d'apparition de la marque parmi les marques citées dans une même réponse (1 = citée en premier). " +
    'Sentiment : ton employé au sujet de la marque, de -1 (négatif) à +1 (positif), évalué par IA sur chaque réponse. ' +
    'Évolution : écart avec l\'étude précédente lancée sur les mêmes prompts.', M, doc.y, { width: W });

  pdfFooters(doc);
  doc.end();
}

function signed(v, unit) { return v == null ? '-' : v === 0 ? '=' : `${v > 0 ? '+' : ''}${fmtNum(v)}${unit}`; }

function cellLabel(c) {
  if (!c.now) return '';
  const base = c.now.error ? 'erreur' : c.now.mentioned ? `#${c.now.rank || '?'}` : '-';
  const t = { 'gagné': ' (gagné)', 'perdu': ' (perdu)', 'en hausse': ' (hausse)', 'en baisse': ' (baisse)' }[c.trend] || '';
  return base + t;
}

function pdfCover(doc, report) {
  const w = doc.page.width, h = doc.page.height;
  doc.rect(0, 0, w, h * 0.35).fill(GREEN);
  doc.fillColor(WHITE).font('Title').fontSize(30).text('Share of Voice IA', M, h * 0.35 - 110, { width: w - 2 * M });
  doc.font('TitleBold').fontSize(16).text('Visibilité de la marque dans les réponses des IA', M, doc.y + 4, { width: w - 2 * M });
  doc.image(LOGO, M - 10, h * 0.35 + 20, { width: 110 });
  doc.fillColor(BLACK).font('Title').fontSize(26).text(report.brand || 'Toutes marques', M, h * 0.35 + 150, { width: w - 2 * M });
  doc.fillColor(GRAY).font('Body').fontSize(12)
    .text(report.period, M, doc.y + 6)
    .text(`${report.agg.responses} réponses analysées${report.provider ? ` · moteur : ${report.provider}` : ''}`)
    .text(`Rapport généré le ${report.generatedAt.toLocaleDateString('fr-FR')}`);
  doc.rect(0, h - 70, w, 70).fill(BLACK);
  doc.page.margins.bottom = 0; // sinon le slogan, sous la marge, ouvre une page vide
  doc.fillColor(WHITE).font('TitleBold').fontSize(13).text(TAGLINE, M, h - 42, { width: w - 2 * M, lineBreak: false });
  doc.page.margins.bottom = M;
}

function pdfFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) { // pas de pied sur la couverture
    doc.switchToPage(i);
    const w = doc.page.width, h = doc.page.height;
    doc.page.margins.bottom = 0;
    doc.fillColor(GRAY).font('Body').fontSize(8).text('Big View — big-view.fr', M, h - 30, { lineBreak: false });
    doc.text(String(i + 1), w - M - 60, h - 30, { width: 20, align: 'right', lineBreak: false });
    doc.image(LOGO, w - M - 34, h - 46, { width: 34 });
  }
}

function ensureSpace(doc, h) {
  if (doc.y + h > doc.page.height - 60) { doc.addPage(); doc.y = M; }
}

function section(doc, title) {
  doc.x = M;
  doc.fillColor(GREEN).font('Title').fontSize(20).text(title, M, M);
  doc.save().lineWidth(2).strokeColor(GREEN).moveTo(M, doc.y + 2).lineTo(M + 50, doc.y + 2).stroke().restore();
  doc.moveDown(1);
}

function subTitle(doc, title) {
  ensureSpace(doc, 60);
  doc.moveDown(0.6);
  doc.x = M;
  doc.fillColor(GREEN).font('Title').fontSize(13).text(title, M, doc.y);
  doc.moveDown(0.4);
}

function accroche(doc, text) {
  const W = doc.page.width - 2 * M;
  doc.font('TitleBold').fontSize(11);
  const h = doc.heightOfString(text, { width: W - 24 }) + 18;
  ensureSpace(doc, h + 10);
  const y = doc.y;
  doc.rect(M, y, W, h).fill(YELLOW);
  doc.fillColor(BLACK).font('TitleBold').fontSize(11).text(text, M + 12, y + 9, { width: W - 24 });
  doc.x = M;
  doc.y = y + h + 8;
}

function table(doc, header, rows, widths, highlight) {
  const W = doc.page.width - 2 * M, rh = 18;
  const cols = widths.map(w => w * W);
  const drawRow = (cells, y, opts = {}) => {
    if (opts.fill) doc.rect(M, y, W, rh).fill(opts.fill);
    let x = M;
    cells.forEach((c, i) => {
      doc.fillColor(opts.color || GRAY).font(opts.bold ? 'BodyBold' : 'Body').fontSize(8.5)
        .text(String(c), x + 4, y + 5, { width: cols[i] - 8, height: rh - 4, ellipsis: true, lineBreak: false });
      x += cols[i];
    });
    doc.save().lineWidth(0.5).strokeColor(LINE).moveTo(M, y + rh).lineTo(M + W, y + rh).stroke().restore();
  };
  ensureSpace(doc, rh * 2);
  // Positions gérées à la main : text() avec lineBreak:false fait bouger doc.y de façon imprévisible
  const top = doc.y;
  const head = (y) => drawRow(header, y, { bold: true, fill: GREEN, color: WHITE });
  head(top);
  let next = top + rh;
  rows.forEach((r, i) => {
    if (next + rh > doc.page.height - 60) {
      doc.addPage();
      next = M;
      head(next);
      next += rh;
    }
    const isFocus = highlight && r[0] === highlight;
    drawRow(r, next, { bold: isFocus, color: isFocus ? BLACK : GRAY, fill: isFocus ? '#FDF6B5' : (i % 2 ? TINT : null) });
    next += rh;
  });
  doc.x = M;
  doc.y = next + 4;
}

function bars(doc, items, highlight) {
  if (!items.length) return;
  const W = doc.page.width - 2 * M, labelW = 130, h = 13, gap = 5;
  ensureSpace(doc, items.length * (h + gap) + 10);
  let y = doc.y;
  const max = Math.max(...items.map(i => i[1]), 1);
  for (const [name, v] of items) {
    doc.fillColor(name === highlight ? BLACK : GRAY).font(name === highlight ? 'BodyBold' : 'Body').fontSize(8.5)
      .text(name, M, y + 2, { width: labelW - 8, ellipsis: true, lineBreak: false });
    const bw = ((W - labelW - 50) * v) / max;
    doc.rect(M + labelW, y, Math.max(bw, 1), h).fill(name === highlight ? GREEN : '#BFEFE0');
    doc.fillColor(GRAY).font('Body').fontSize(8.5).text(fmtPct(v), M + labelW + bw + 6, y + 2, { lineBreak: false });
    y += h + gap;
  }
  doc.x = M;
  doc.y = y + 4;
}

// =====================================================
// Google Slides (compte de service, charte Big View)
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

// Briques de requêtes Slides (unités en points, page 16:9 = 720 x 405)
const PT = v => ({ magnitude: v, unit: 'PT' });
const box = (page, x, y, w, h) => ({ pageObjectId: page, size: { width: PT(w), height: PT(h) }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'PT' } });
function hexRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}
function textBox(id, page, x, y, w, h, text, style = {}) {
  return [
    { createShape: { objectId: id, shapeType: 'TEXT_BOX', elementProperties: box(page, x, y, w, h) } },
    { insertText: { objectId: id, text } },
    { updateTextStyle: { objectId: id, textRange: { type: 'ALL' }, fields: 'fontSize,bold,foregroundColor,fontFamily', style: {
      fontSize: PT(style.size || 10), bold: !!style.bold, fontFamily: style.font || 'Roboto',
      foregroundColor: { opaqueColor: { rgbColor: hexRgb(style.color || GRAY) } }
    } } },
    ...(style.align ? [{ updateParagraphStyle: { objectId: id, textRange: { type: 'ALL' }, fields: 'alignment', style: { alignment: style.align } } }] : [])
  ];
}
function rect(id, page, x, y, w, h, color) {
  return [
    { createShape: { objectId: id, shapeType: 'RECTANGLE', elementProperties: box(page, x, y, w, h) } },
    { updateShapeProperties: { objectId: id, fields: 'shapeBackgroundFill.solidFill.color,outline.propertyState', shapeProperties: {
      shapeBackgroundFill: { solidFill: { color: { rgbColor: hexRgb(color) } } }, outline: { propertyState: 'NOT_RENDERED' }
    } } }
  ];
}
function slideTable(id, page, header, rows, { y = 70, widths = null, highlight = null, fontSize = 9 } = {}) {
  const all = [header, ...rows];
  const reqs = [{ createTable: { objectId: id, rows: all.length, columns: header.length, elementProperties: box(page, 40, y, 640, 22 * all.length) } }];
  // Sur un tableau, l'API Slides exige un style par cellule (cellLocation obligatoire)
  all.forEach((r, ri) => r.forEach((c, ci) => {
    const cellLocation = { rowIndex: ri, columnIndex: ci };
    const isHead = ri === 0, isFocus = !isHead && highlight && r[0] === highlight;
    reqs.push({ insertText: { objectId: id, cellLocation, text: String(c == null || c === '' ? '-' : c) } });
    reqs.push({ updateTextStyle: { objectId: id, cellLocation, textRange: { type: 'ALL' }, fields: 'fontSize,fontFamily,bold,foregroundColor',
      style: { fontSize: PT(fontSize), fontFamily: isHead ? 'Raleway' : 'Roboto', bold: isHead || isFocus,
        foregroundColor: { opaqueColor: { rgbColor: hexRgb(isHead ? WHITE : isFocus ? BLACK : GRAY) } } } } });
  }));
  const fill = (row, color) => ({ updateTableCellProperties: { objectId: id, tableRange: { location: { rowIndex: row, columnIndex: 0 }, rowSpan: 1, columnSpan: header.length },
    fields: 'tableCellBackgroundFill.solidFill.color', tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: hexRgb(color) } } } } } });
  reqs.push(fill(0, GREEN));
  rows.forEach((r, i) => { if (highlight && r[0] === highlight) reqs.push(fill(i + 1, '#FDF6B5')); else if (i % 2) reqs.push(fill(i + 1, TINT)); });
  if (widths) widths.forEach((w, ci) => reqs.push({ updateTableColumnProperties: { objectId: id, columnIndices: [ci], fields: 'columnWidth', tableColumnProperties: { columnWidth: PT(640 * w) } } }));
  return reqs;
}

async function createSlides(report, shareWith, baseUrl) {
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

  const logoUrl = baseUrl ? `${baseUrl}/assets/logo-bigview.png` : null;
  const build = (withLogo) => slidesRequests(report, withLogo ? logoUrl : null, pres.slides || []);

  const run = (reqs) => gapi(token, 'POST', `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, { requests: reqs });
  try {
    try {
      await run(build(true));
    } catch (e) {
      // Le logo est chargé par Google depuis une URL publique : si elle est injoignable, on refait sans logo
      if (!logoUrl || !/image/i.test(e.message)) throw e;
      console.warn('⚠️ [SLIDES] logo non chargé, présentation sans logo :', e.message);
      await run(build(false));
    }
  } catch (e) {
    // Ne pas laisser une présentation vide dans le dossier si la mise en forme échoue
    await gapi(token, 'DELETE', `https://www.googleapis.com/drive/v3/files/${presentationId}?supportsAllDrives=true`).catch(() => {});
    throw e;
  }

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

function slidesRequests(report, logoUrl, defaultSlides) {
  const { agg, brand } = report;
  const reqs = [];
  let n = 0;
  const logo = (page, x, y, size) => logoUrl ? [{ createImage: { objectId: `${page}_logo`, url: logoUrl, elementProperties: box(page, x, y, size, size) } }] : [];
  const newSlide = () => { const id = `sov_s${++n}`; reqs.push({ createSlide: { objectId: id, slideLayoutReference: { predefinedLayout: 'BLANK' } } }); return id; };
  const content = (title) => {
    const s = newSlide();
    reqs.push(...textBox(`${s}_t`, s, 40, 22, 560, 28, title, { size: 14, bold: true, font: 'Raleway', color: GREEN }));
    reqs.push(...rect(`${s}_u`, s, 40, 50, 40, 2, GREEN));
    reqs.push(...textBox(`${s}_f`, s, 40, 380, 300, 16, 'Big View — big-view.fr', { size: 8 }));
    reqs.push(...textBox(`${s}_p`, s, 600, 380, 40, 16, String(n), { size: 8, align: 'END' }));
    reqs.push(...logo(s, 650, 362, 36));
    return s;
  };
  const separator = (title) => {
    const s = newSlide();
    reqs.push(...rect(`${s}_bg`, s, 0, 0, 720, 405, GREEN));
    reqs.push(...textBox(`${s}_t`, s, 50, 170, 620, 60, title, { size: 40, bold: true, font: 'Raleway', color: WHITE }));
    return s;
  };
  const accrocheBox = (s, y, text) => {
    reqs.push(...rect(`${s}_ac`, s, 40, y, 640, 46, YELLOW));
    reqs.push(...textBox(`${s}_act`, s, 52, y + 6, 616, 36, text, { size: 12, bold: true, font: 'Raleway', color: BLACK }));
  };

  // 1. Couverture
  let s = newSlide();
  reqs.push(...rect(`${s}_band`, s, 0, 0, 720, 142, GREEN));
  reqs.push(...textBox(`${s}_t`, s, 40, 40, 640, 44, 'Share of Voice IA', { size: 32, bold: true, font: 'Raleway', color: WHITE }));
  reqs.push(...textBox(`${s}_st`, s, 40, 88, 640, 26, 'Visibilité de la marque dans les réponses des IA', { size: 14, bold: true, font: 'Raleway', color: WHITE }));
  reqs.push(...logo(s, 34, 152, 90));
  reqs.push(...textBox(`${s}_b`, s, 140, 168, 540, 40, brand || 'Toutes marques', { size: 26, bold: true, font: 'Raleway', color: BLACK }));
  reqs.push(...textBox(`${s}_d`, s, 140, 212, 540, 50, `${report.period} · ${agg.responses} réponses analysées\nGénéré le ${report.generatedAt.toLocaleDateString('fr-FR')}`, { size: 11 }));
  reqs.push(...rect(`${s}_foot`, s, 0, 355, 720, 50, BLACK));
  reqs.push(...textBox(`${s}_tag`, s, 40, 368, 640, 24, TAGLINE, { size: 13, bold: true, font: 'Raleway', color: WHITE }));

  // 2. Synthèse
  separator('Synthèse');
  const ks = kpis(report);
  if (ks.length) {
    s = content(`${brand} : indicateurs clés`);
    ks.forEach((k, i) => {
      const x = 40 + i * 130;
      reqs.push(...rect(`${s}_k${i}`, s, x, 72, 120, 118, TINT));
      reqs.push(...textBox(`${s}_kv${i}`, s, x, 86, 120, 34, k.value, { size: 22, bold: true, font: 'Raleway', color: BLACK, align: 'CENTER' }));
      reqs.push(...textBox(`${s}_kl${i}`, s, x, 124, 120, 20, k.label, { size: 10, align: 'CENTER' }));
      if (k.delta) {
        const arrow = k.delta.dir === 'better' ? '▲ ' : k.delta.dir === 'worse' ? '▼ ' : '';
        reqs.push(...textBox(`${s}_kd${i}`, s, x, 152, 120, 22, arrow + k.delta.text, { size: 11, bold: true, color: k.delta.dir === 'better' ? GREEN : k.delta.dir === 'worse' ? BLACK : GRAY, align: 'CENTER' }));
      }
    });
    accrocheBox(s, 206, headline(report));
    const note = [agg.focus ? `${ordinal(agg.focus.position)} position sur ${agg.ranking.length} marques suivies.` : null, report.previousLabel ? `Écarts calculés par rapport à l'${report.previousLabel}.` : null].filter(Boolean).join(' ');
    if (note) reqs.push(...textBox(`${s}_pos`, s, 40, 264, 640, 24, note, { size: 10 }));
  }

  s = content('Classement global');
  reqs.push(...slideTable(`${s}_tb`, s, ['Marque', 'Part de voix', 'Mention', 'Rang moyen', 'Cité en 1er', 'Sentiment'],
    agg.ranking.slice(0, 10).map(x => [x.brand, fmtPct(x.shareOfVoice), fmtPct(x.mentionRate), fmtNum(x.avgRank), fmtPct(x.firstCitedRate), fmtSent(x.sentimentScore)]),
    { highlight: brand }));

  if (Object.keys(agg.byProvider).length) {
    s = content('Par moteur IA');
    reqs.push(...slideTable(`${s}_tb`, s, ['Moteur', 'Réponses', 'Part de voix', 'Mention', 'Rang moyen', 'Leader'],
      Object.entries(agg.byProvider).slice(0, 10).map(([p, v]) => {
        const x = focusIn(v.ranking, brand) || {};
        return [p, v.responses, fmtPct(x.shareOfVoice), fmtPct(x.mentionRate), fmtNum(x.avgRank), leaderOf(v.ranking)];
      })));
  }

  // 3. Évolution
  separator('Évolution');
  s = content(`Progression de ${brand || 'la marque'}`);
  if (report.timeline.length > 1) {
    reqs.push(...slideTable(`${s}_tb`, s, ['Étude', 'Part de voix', 'Évol.', 'Mention', 'Évol.', 'Rang', 'Sentiment', 'Évol.'],
      report.timeline.slice(-10).map(t => {
        const d = t.delta || {};
        return [fmtDate(t.date), fmtPct(t.shareOfVoice), signed(d.shareOfVoice, ' pts'), fmtPct(t.mentionRate), signed(d.mentionRate, ' pts'), fmtNum(t.avgRank), fmtScore(t.sentimentScore), signed(d.sentimentScore, '')];
      })));
  } else {
    accrocheBox(s, 90, 'Première étude pour cette marque : elle sert de référence. Relancez les mêmes prompts à la prochaine étude pour mesurer la progression.');
  }

  s = content('Sentiment des mentions');
  const withSent = agg.ranking.filter(x => x.sentimentScore != null || (report.prevAgg && focusIn(report.prevAgg.ranking, x.brand)));
  if (withSent.length) {
    reqs.push(...slideTable(`${s}_tb`, s, ['Marque', 'Score moyen', 'Évolution', 'Positif', 'Neutre', 'Négatif'],
      withSent.slice(0, 10).map(x => {
        const prev = report.prevAgg && focusIn(report.prevAgg.ranking, x.brand);
        const d = prev && delta(x.sentimentScore, prev.sentimentScore, { unit: '', digits: 2 });
        return [x.brand, fmtSent(x.sentimentScore), d ? (d.dir === 'better' ? '▲ ' : d.dir === 'worse' ? '▼ ' : '') + d.text : '-', x.sentiment.positive, x.sentiment.neutral, x.sentiment.negative];
      }), { highlight: brand }));
  } else {
    reqs.push(...textBox(`${s}_e`, s, 40, 80, 640, 30, 'Aucune mention de marque dans les réponses : pas de sentiment à mesurer.', { size: 11 }));
  }

  // 4. Détail par prompt
  if (report.progress && report.progress.prompts.length) {
    separator('Détail par prompt');
    const provs = report.progress.providers;
    const chunks = [];
    for (let i = 0; i < report.progress.prompts.length; i += 8) chunks.push(report.progress.prompts.slice(i, i + 8));
    chunks.forEach((chunk, ci) => {
      s = content(`Résultats par prompt${chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : ''}`);
      const pw = 0.4, cw = (1 - pw) / Math.max(provs.length, 1);
      reqs.push(...slideTable(`${s}_tb`, s, ['Prompt', ...provs],
        chunk.map(p => [truncate(p.prompt, 90), ...p.cells.map(c => cellLabel(c) || '-')]),
        { widths: [pw, ...provs.map(() => cw)], fontSize: 8 }));
    });

    // Réponses : une diapositive par prompt (15 au maximum)
    const byPrompt = new Map();
    for (const r of report.rows) { if (!byPrompt.has(r.prompt)) byPrompt.set(r.prompt, []); byPrompt.get(r.prompt).push(r); }
    [...byPrompt.entries()].filter(([, list]) => list.some(r => r.excerpt)).slice(0, 15).forEach(([prompt, list]) => {
      s = content(truncate(prompt, 95));
      reqs.push(...slideTable(`${s}_tb`, s, ['Moteur', `${brand || 'Marque'}`, 'Extrait de la réponse'],
        list.slice(0, 6).map(r => {
          const key = brand && Object.keys(r.mentions || {}).find(k => k === brand);
          const cited = key && r.mentions[key] > 0;
          const rank = cited && r.ranks && r.ranks[key];
          return [r.provider, cited ? `citée${rank ? ` #${rank}` : ''}` : 'non citée', r.error ? `Erreur : ${truncate(r.error, 100)}` : truncate(r.excerpt, 210)];
        }), { widths: [0.15, 0.13, 0.72], fontSize: 7 }));
    });
  }

  // Supprime la diapositive vide créée par défaut
  for (const sl of defaultSlides) reqs.push({ deleteObject: { objectId: sl.objectId } });
  return reqs;
}
