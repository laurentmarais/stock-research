import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';

import { getCashRunway } from './runway.js';
import { getNewsAnalysis } from './news.js';
import { getAnalystSentiment } from './analysts.js';
import { createLogger } from './logger.js';
import { createTtlCache } from './ttlCache.js';
import { normalizeTicker } from './validate.js';
import { getXaiMetrics } from './xaiMetrics.js';
import { getGeminiMetrics } from './geminiMetrics.js';
import { normalizeProvider } from './ai.js';
import {
  createResearchItem,
  deleteResearchItem,
  deleteSetting,
  deleteHistoryByTicker,
  deleteHistoryByTickers,
  getAdhoc,
  getLatestQuery,
  getSetting,
  listResearchItems,
  listResearchTickers,
  listResearchTickersForHistory,
  listAdhoc,
  listHistorySummary,
  listTickersForTab,
  setHistoryFavorite,
  setSetting,
  updateResearchItem,
  upsertAdhocQuery,
  upsertQuery
} from './db.js';
import { geminiListModels } from './gemini.js';
import { xaiListModels } from './xai.js';
import { getAdhocAnswer } from './adhoc.js';
import { createDiscordWatcher } from './discord.js';
import { createDilutionService } from './dilution.js';
import { getDilutionAiSummary } from './dilutionAi.js';
import { getValueReport } from './value.js';
import { getCatOutOfBagReport } from './catOutOfBag.js';
import { resolveCompany } from './companyResolve.js';
import { getCompanyOverride, setCompanyOverride } from './db.js';
import { createSecFilingsService } from './secFilings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local dev convenience: load env.local from repo root (no-op if missing).
// We also try `.env` for compatibility, but some environments restrict creating that file.
const rootDirForEnv = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDirForEnv, 'env.local') });
dotenv.config({ path: path.join(rootDirForEnv, '.env') });

const app = express();

app.use(express.json({ limit: '50kb' }));

const port = Number(process.env.PORT || 3000);
const rootDir = path.resolve(__dirname, '..');
const clientDistDir = path.join(rootDir, 'client', 'dist');

const logDir = process.env.LOG_DIR
  ? path.resolve(rootDir, process.env.LOG_DIR)
  : path.join(rootDir, 'logs');
const logFilePath = process.env.LOG_FILE
  ? path.resolve(rootDir, process.env.LOG_FILE)
  : path.join(logDir, 'server.log');
const logger = createLogger({ logFilePath });

async function readLastLogLines({ lines }) {
  const maxBytes = 512 * 1024; // avoid pulling huge logs into memory
  const raw = await fsp.readFile(logFilePath, 'utf8').catch(() => '');
  const clipped = raw.length > maxBytes ? raw.slice(raw.length - maxBytes) : raw;

  const all = clipped.split(/\r?\n/).filter(Boolean);
  const tail = all.slice(-lines);

  // Redact anything that looks like a bearer token, just in case.
  return tail.map((line) => line.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]'));
}

async function readLastLinesFromFile({ filePath, lines }) {
  const maxBytes = 512 * 1024;
  const raw = await fsp.readFile(filePath, 'utf8').catch(() => '');
  const clipped = raw.length > maxBytes ? raw.slice(raw.length - maxBytes) : raw;
  const all = clipped.split(/\r?\n/).filter(Boolean);
  const tail = all.slice(-lines);
  return tail.map((line) => line.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]'));
}

const cacheEnabled = process.env.ENABLE_CACHE === '1';
const runwayCache = createTtlCache({ ttlMs: 60 * 60 * 1000 });

const discord = createDiscordWatcher({ rootDir });
const dilution = createDilutionService();
const secFilings = createSecFilingsService();

app.use((req, res, next) => {
  if (
    req.path === '/api/logs' ||
    req.path === '/api/metrics' ||
    req.path === '/api/xai-logs' ||
    req.path === '/api/gemini-logs' ||
    req.path.startsWith('/api/discord') ||
    req.path.startsWith('/api/history') ||
    req.path === '/api/models' ||
    req.path.startsWith('/api/settings') ||
    req.path.startsWith('/api/pushover')
  ) {
    return next();
  }

  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  // Keep only the most recent request in the log file.
  logger.clear();
  logger.header('REQUEST');
  logger.separator(`REQUEST START ${requestId} ${req.method} ${req.originalUrl}`);

  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.header('RESPONSE');
    logger.info('http', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms
    });
  });
  next();
});

function maskKey(key) {
  if (typeof key !== 'string') return '';
  const s = key.trim();
  if (!s) return '';
  const tail = s.slice(-4);
  return `••••••••${tail}`;
}

async function sendPushoverMessage({ title, message }) {
  const token = String(getSetting('pushover_app_token') || '').trim();
  const user = String(getSetting('pushover_user_key') || '').trim();
  if (!token || !user) {
    return { ok: false, detail: { error: 'Pushover is not configured. Open Settings and paste your token + user key.' } };
  }

  const msg = String(message || '').trim();
  if (!msg) return { ok: false, detail: { error: 'Message is required' } };

  const params = new URLSearchParams();
  params.set('token', token);
  params.set('user', user);
  params.set('message', msg.slice(0, 1024));
  if (title) params.set('title', String(title).slice(0, 250));

  const resp = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = Array.isArray(data?.errors) && data.errors.length ? data.errors.join('; ') : `Pushover request failed (${resp.status})`;
    return { ok: false, detail: { error: err } };
  }

  return { ok: true, detail: { status: data?.status, request: data?.request } };
}

async function testProviderConnection(provider) {
  const raw = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  if (raw === 'pushover') {
    return sendPushoverMessage({ title: 'MarketMind', message: 'Test notification from MarketMind settings.' });
  }

  const p = normalizeProvider(provider);
  if (p === 'xai') {
    const models = await xaiListModels();
    return { ok: true, detail: { modelsCount: Array.isArray(models) ? models.length : 0 } };
  }
  if (p === 'gemini') {
    const models = await geminiListModels();
    const count = Array.isArray(models) ? models.length : 0;
    return { ok: true, detail: { modelsCount: count } };
  }
  return { ok: false, detail: { error: `Unsupported provider: ${provider}` } };
}

app.get('/api/settings', async (req, res) => {
  try {
    const xaiKey = getSetting('xai_api_key');
    const geminiKey = getSetting('gemini_api_key');
    const pushoverToken = getSetting('pushover_app_token');
    const pushoverUser = getSetting('pushover_user_key');
    return res.json({
      xai: { configured: Boolean(xaiKey && xaiKey.trim()), masked: xaiKey ? maskKey(xaiKey) : '' },
      gemini: { configured: Boolean(geminiKey && geminiKey.trim()), masked: geminiKey ? maskKey(geminiKey) : '' },
      pushover: {
        configured: Boolean(pushoverToken && String(pushoverToken).trim() && pushoverUser && String(pushoverUser).trim()),
        tokenMasked: pushoverToken ? maskKey(String(pushoverToken)) : '',
        userMasked: pushoverUser ? maskKey(String(pushoverUser)) : ''
      }
    });
  } catch (err) {
    logger.error('settings_get_failed', err);
    return res.status(500).json({ error: 'Failed to load settings' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const xaiApiKey = typeof req.body?.xaiApiKey === 'string' ? req.body.xaiApiKey : undefined;
    const geminiApiKey = typeof req.body?.geminiApiKey === 'string' ? req.body.geminiApiKey : undefined;
    const pushoverAppToken = typeof req.body?.pushoverAppToken === 'string' ? req.body.pushoverAppToken : undefined;
    const pushoverUserKey = typeof req.body?.pushoverUserKey === 'string' ? req.body.pushoverUserKey : undefined;
    const test = Boolean(req.body?.test);

    // Save/clear keys.
    if (xaiApiKey !== undefined) {
      if (xaiApiKey.trim()) setSetting('xai_api_key', xaiApiKey);
      else deleteSetting('xai_api_key');
    }
    if (geminiApiKey !== undefined) {
      if (geminiApiKey.trim()) setSetting('gemini_api_key', geminiApiKey);
      else deleteSetting('gemini_api_key');
    }

    if (pushoverAppToken !== undefined) {
      if (pushoverAppToken.trim()) setSetting('pushover_app_token', pushoverAppToken);
      else deleteSetting('pushover_app_token');
    }
    if (pushoverUserKey !== undefined) {
      if (pushoverUserKey.trim()) setSetting('pushover_user_key', pushoverUserKey);
      else deleteSetting('pushover_user_key');
    }

    const xaiKey = getSetting('xai_api_key');
    const geminiKey = getSetting('gemini_api_key');
    const pushoverToken = getSetting('pushover_app_token');
    const pushoverUser = getSetting('pushover_user_key');

    const response = {
      saved: {
        xai: { configured: Boolean(xaiKey && xaiKey.trim()), masked: xaiKey ? maskKey(xaiKey) : '' },
        gemini: { configured: Boolean(geminiKey && geminiKey.trim()), masked: geminiKey ? maskKey(geminiKey) : '' },
        pushover: {
          configured: Boolean(pushoverToken && String(pushoverToken).trim() && pushoverUser && String(pushoverUser).trim()),
          tokenMasked: pushoverToken ? maskKey(String(pushoverToken)) : '',
          userMasked: pushoverUser ? maskKey(String(pushoverUser)) : ''
        }
      }
    };

    if (test) {
      const tests = {};
      if (xaiKey && xaiKey.trim()) {
        try {
          tests.xai = await testProviderConnection('xai');
        } catch (e) {
          tests.xai = { ok: false, detail: { error: e instanceof Error ? e.message : 'xAI test failed' } };
        }
      }
      if (geminiKey && geminiKey.trim()) {
        try {
          tests.gemini = await testProviderConnection('gemini');
        } catch (e) {
          tests.gemini = { ok: false, detail: { error: e instanceof Error ? e.message : 'Gemini test failed' } };
        }
      }
      response.tests = tests;
    }

    return res.json(response);
  } catch (err) {
    logger.error('settings_save_failed', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save settings' });
  }
});

app.post('/api/pushover/notify', async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title : '';
    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    const result = await sendPushoverMessage({ title, message });
    return res.json(result);
  } catch (err) {
    logger.error('pushover_notify_failed', err);
    return res.json({ ok: false, detail: { error: err instanceof Error ? err.message : 'Failed to send notification' } });
  }
});

app.post('/api/settings/test', async (req, res) => {
  try {
    const provider = typeof req.body?.provider === 'string' ? req.body.provider : '';
    if (!provider) return res.status(400).json({ error: 'provider is required' });
    const result = await testProviderConnection(provider);
    const normalized = String(provider || '').trim().toLowerCase() === 'pushover' ? 'pushover' : normalizeProvider(provider);
    return res.json({ provider: normalized, ...result });
  } catch (err) {
    return res.status(500).json({
      provider: typeof req.body?.provider === 'string' ? req.body.provider : '',
      ok: false,
      detail: { error: err instanceof Error ? err.message : 'Test failed' }
    });
  }
});

app.get('/api/company', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const company = await resolveCompany({ ticker });
    return res.json({ ticker, company });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();

    if (lower.includes('ticker')) {
      return res.status(400).json({ error: message });
    }

    // Resolver dependencies (SEC/Yahoo) can be rate-limited; don't break the UI.
    const t = typeof req.query.ticker === 'string' ? req.query.ticker.trim().toUpperCase() : '';
    return res.json({
      ticker: t,
      company: { ticker: t, name: '', exchange: null, cik: null, resolvedVia: 'none', sources: [] },
      resolutionError: message
    });
  }
});

app.get('/api/sec/filings', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const formsRaw = typeof req.query.forms === 'string' ? req.query.forms : '';
    const forms = formsRaw
      ? formsRaw
          .split(',')
          .map((s) => String(s || '').trim())
          .filter(Boolean)
      : undefined;

    const company = await resolveCompany({ ticker });
    const pack = await secFilings.getRecentFilings({ ticker, cik: company?.cik || null, limit, forms });
    return res.json({ ticker, company, ...pack });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status = lower.includes('ticker') || lower.includes('cik') || lower.includes('sec') ? 400 : 500;
    logger.error('sec_filings_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/company/override', (req, res) => {
  try {
    const ticker = String(req.query.ticker || '').trim().toUpperCase();
    if (!ticker) return res.status(400).json({ error: 'ticker is required' });
    const o = getCompanyOverride(ticker);
    return res.json({
      ok: true,
      override: o && o.name ? { ticker, name: o.name, exchange: o.exchange, cik: o.cik } : null
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/company/override', (req, res) => {
  try {
    const ticker = String(req.body?.ticker || '').trim().toUpperCase();
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const exchange = typeof req.body?.exchange === 'string' ? req.body.exchange.trim() : null;
    const cik = typeof req.body?.cik === 'string' ? req.body.cik.trim() : null;
    if (!ticker) return res.status(400).json({ error: 'ticker is required' });

    setCompanyOverride({ ticker, name, exchange, cik });
    const o = getCompanyOverride(ticker);
    return res.json({
      ok: true,
      override: o && o.name ? { ticker, name: o.name, exchange: o.exchange, cik: o.cik } : null
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/research', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const items = listResearchItems({ ticker, limit: 500 });
    return res.json({ ticker, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status = lower.includes('ticker') ? 400 : 500;
    return res.status(status).json({ error: message });
  }
});

app.get('/api/research/tickers', async (req, res) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const tickers = listResearchTickers({ limit: Number.isFinite(limit) ? limit : 5000 });
    return res.json({ tickers });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load research tickers' });
  }
});

app.post('/api/research', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.body?.ticker);
    const md = typeof req.body?.md === 'string' ? req.body.md : '';
    if (!md.trim()) return res.status(400).json({ error: 'md is required' });
    const id = crypto.randomUUID();
    const item = createResearchItem({ id, ticker, md });
    return res.json({ ok: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status = lower.includes('ticker') || lower.includes('md') ? 400 : 500;
    return res.status(status).json({ error: message });
  }
});

app.put('/api/research/:id', async (req, res) => {
  try {
    const id = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
    if (!id) return res.status(400).json({ error: 'id is required' });
    const ticker = normalizeTicker(req.body?.ticker);
    const md = typeof req.body?.md === 'string' ? req.body.md : '';
    if (!md.trim()) return res.status(400).json({ error: 'md is required' });

    const item = updateResearchItem({ id, ticker, md });
    if (!item) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status = lower.includes('ticker') || lower.includes('md') || lower.includes('id') ? 400 : 500;
    return res.status(status).json({ error: message });
  }
});

app.delete('/api/research/:id', async (req, res) => {
  try {
    const id = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
    if (!id) return res.status(400).json({ error: 'id is required' });
    const ticker = normalizeTicker(req.query.ticker);

    const result = deleteResearchItem({ id, ticker });
    if (!result.deleted) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status = lower.includes('ticker') || lower.includes('id') ? 400 : 500;
    return res.status(status).json({ error: message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const tab = typeof req.query.tab === 'string' ? req.query.tab : '';
    if (!['runway', 'news', 'analysts', 'dilution', 'adhoc', 'value', 'catout', 'research'].includes(tab)) {
      return res.status(400).json({ error: 'Invalid tab. Use tab=runway|news|analysts|dilution|value|catout|adhoc|research' });
    }

    if (tab === 'adhoc') {
      const items = listAdhoc({ limit: 200 }).map((it) => ({
        ...it,
        label: `${it.ticker} • ${String(it.question || '').slice(0, 80)}${String(it.question || '').length > 80 ? '…' : ''}`
      }));
      return res.json({ tab, items });
    }

    if (tab === 'research') {
      const items = listResearchTickersForHistory({ limit: 200 });
      return res.json({ tab, items });
    }

    const items = listTickersForTab({ tab, limit: 200 });
    return res.json({ tab, items });
  } catch (err) {
    logger.error('history_failed', err);
    return res.status(500).json({ error: 'Failed to load history' });
  }
});

app.get('/api/history/item', async (req, res) => {
  try {
    const tab = typeof req.query.tab === 'string' ? req.query.tab : '';

    if (tab === 'adhoc') {
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      if (!id.trim()) return res.status(400).json({ error: 'id is required' });
      const row = getAdhoc({ id });
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.json({
        tab: 'adhoc',
        id: row.id,
        ticker: row.ticker,
        provider: row.provider,
        model: row.model ?? null,
        wordLimit: row.wordLimit,
        question: row.question,
        answerText: row.answerText,
        updatedAt: row.updatedAt
      });
    }

    if (!['runway', 'news', 'analysts', 'dilution', 'value', 'catout'].includes(tab)) {
      return res.status(400).json({ error: 'Invalid tab. Use tab=runway|news|analysts|dilution|value|catout|adhoc' });
    }

    const ticker = normalizeTicker(req.query.ticker);
    const provider = typeof req.query.provider === 'string' && req.query.provider.trim()
      ? normalizeProvider(req.query.provider)
      : null;

    const row = getLatestQuery({ tab, ticker, provider: provider || undefined });
    if (!row) return res.status(404).json({ error: 'Not found' });

    return res.json({
      tab: row.tab,
      ticker: row.ticker,
      provider: row.provider,
      model: row.model ?? null,
      updatedAt: row.updatedAt,
      payload: row.payload
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status = lower.includes('ticker') || lower.includes('provider') || lower.includes('tab') ? 400 : 500;
    logger.error('history_item_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/history/summary', async (req, res) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const items = listHistorySummary({ limit: Number.isFinite(limit) ? limit : 1000 });
    return res.json({ items });
  } catch (err) {
    logger.error('history_summary_failed', err);
    return res.status(500).json({ error: 'Failed to load history summary' });
  }
});

app.post('/api/history/delete', async (req, res) => {
  try {
    const tab = typeof req.body?.tab === 'string' ? req.body.tab : undefined;
    const tickers = Array.isArray(req.body?.tickers) ? req.body.tickers : null;

    if (tickers && tickers.length) {
      const result = deleteHistoryByTickers({ tickers, tab });
      return res.json({ ok: true, ...result });
    }

    const ticker = normalizeTicker(req.body?.ticker);
    const result = deleteHistoryByTicker({ ticker, tab });
    return res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status = lower.includes('ticker') || lower.includes('tickers') || lower.includes('favourite') || lower.includes('favorite') ? 400 : 500;
    return res.status(status).json({ error: message });
  }
});

app.post('/api/history/favorite', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.body?.ticker);
    const favorite = Boolean(req.body?.favorite);
    const result = setHistoryFavorite({ ticker, favorite });
    return res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status = lower.includes('ticker') ? 400 : 500;
    return res.status(status).json({ error: message });
  }
});

app.post('/api/adhoc', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.body?.ticker);
    const provider = normalizeProvider(req.body?.provider);
    const model = typeof req.body?.model === 'string' ? req.body.model : '';
    const question = typeof req.body?.question === 'string' ? req.body.question : '';
    const wordLimit = req.body?.wordLimit;

    if (!question.trim()) return res.status(400).json({ error: 'question is required' });

    const company = await resolveCompany({ ticker });

    const { answerText, wordLimit: normalizedWordLimit, model: effectiveModel } = await getAdhocAnswer({
      ticker,
      company,
      provider,
      model,
      question,
      wordLimit
    });

    const id = crypto
      .createHash('sha1')
      .update(`${new Date().toISOString().slice(0, 10)}|${provider}|${ticker}|${effectiveModel}|${normalizedWordLimit}|${question.trim()}`)
      .digest('hex');

    const saved = upsertAdhocQuery({
      id,
      ticker,
      provider,
      model: effectiveModel,
      wordLimit: normalizedWordLimit,
      question: question.trim(),
      answerText
    });

    return res.json({
      tab: 'adhoc',
      id,
      ticker,
      company,
      provider,
      model: effectiveModel,
      wordLimit: normalizedWordLimit,
      question: question.trim(),
      answerText,
      updatedAt: saved.updatedAt
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status =
      lower.includes('ticker') ||
      lower.includes('provider') ||
      lower.includes('question') ||
      lower.includes('api key') ||
      lower.includes('authentication failed') ||
      lower.includes('unauthorized')
        ? 400
        : 500;
    logger.error('adhoc_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/models', async (req, res) => {
  try {
    const provider = normalizeProvider(req.query.provider);

    const fallback = {
      xai: ['grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning', 'grok-4-0709', 'grok-3', 'grok-3-mini'],
      gemini: {
        models: ['models/gemini-2.5-pro', 'models/gemini-2.5-flash', 'models/gemini-2.0-flash'],
        generateContentModels: ['models/gemini-2.5-pro', 'models/gemini-2.5-flash', 'models/gemini-2.0-flash']
      }
    };

    if (provider === 'gemini') {
      try {
        const models = await geminiListModels();
        const names = models.map((m) => m.name);
        const generateContent = models
          .filter((m) =>
            (m.supportedGenerationMethods || []).some((x) => String(x).toLowerCase() === 'generatecontent')
          )
          .map((m) => m.name);
        return res.json({ provider, models: names, generateContentModels: generateContent });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (message.toLowerCase().includes('api key is not configured')) {
          return res.json({
            provider,
            models: fallback.gemini.models,
            generateContentModels: fallback.gemini.generateContentModels,
            warning: 'Gemini key not configured; returning fallback model list.'
          });
        }
        throw err;
      }
    }

    try {
      const models = await xaiListModels();
      return res.json({ provider, models });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.toLowerCase().includes('api key is not configured')) {
        return res.json({ provider, models: fallback.xai, warning: 'xAI key not configured; returning fallback model list.' });
      }
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.toLowerCase().includes('provider') ? 400 : 500;
    logger.error('models_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/logs', async (req, res) => {
  try {
    // Allow disabling in case you don't want to expose logs.
    if (process.env.DISABLE_LOGS_UI === '1') {
      return res.status(404).json({ error: 'Not found' });
    }

    const linesRaw = typeof req.query.lines === 'string' ? req.query.lines : '';
    const lines = Math.min(Math.max(Number(linesRaw || 200) || 200, 10), 2000);

    const logLines = await readLastLogLines({ lines });
    return res.json({ logFilePath, lines: logLines });
  } catch (err) {
    logger.error('logs_failed', err);
    return res.status(500).json({ error: 'Failed to read logs' });
  }
});

app.get('/api/xai-logs', async (req, res) => {
  try {
    if (process.env.DISABLE_LOGS_UI === '1') {
      return res.status(404).json({ error: 'Not found' });
    }

    const linesRaw = typeof req.query.lines === 'string' ? req.query.lines : '';
    const lines = Math.min(Math.max(Number(linesRaw || 200) || 200, 10), 2000);

    const xaiLogFile = process.env.XAI_LOG_FILE
      ? path.resolve(rootDir, process.env.XAI_LOG_FILE)
      : path.join(logDir, 'xai.log');

    const logLines = await readLastLinesFromFile({ filePath: xaiLogFile, lines });
    return res.json({ logFilePath: xaiLogFile, lines: logLines });
  } catch (err) {
    logger.error('xai_logs_failed', err);
    return res.status(500).json({ error: 'Failed to read xAI logs' });
  }
});

app.get('/api/gemini-logs', async (req, res) => {
  try {
    if (process.env.DISABLE_LOGS_UI === '1') {
      return res.status(404).json({ error: 'Not found' });
    }

    const linesRaw = typeof req.query.lines === 'string' ? req.query.lines : '';
    const lines = Math.min(Math.max(Number(linesRaw || 200) || 200, 10), 2000);

    const geminiLogFile = process.env.GEMINI_LOG_FILE
      ? path.resolve(rootDir, process.env.GEMINI_LOG_FILE)
      : path.join(logDir, 'gemini.log');

    const logLines = await readLastLinesFromFile({ filePath: geminiLogFile, lines });
    return res.json({ logFilePath: geminiLogFile, lines: logLines });
  } catch (err) {
    logger.error('gemini_logs_failed', err);
    return res.status(500).json({ error: 'Failed to read Gemini logs' });
  }
});

app.get('/api/metrics', (_req, res) => {
  if (process.env.DISABLE_LOGS_UI === '1') {
    // same flag disables the diagnostics UI surface area
    return res.status(404).json({ error: 'Not found' });
  }

  return res.json({
    xai: getXaiMetrics(),
    gemini: getGeminiMetrics()
  });
});

app.get('/api/discord/status', (_req, res) => {
  return res.json(discord.getStatus());
});

app.post('/api/discord/start', async (req, res) => {
  try {
    const showBrowser = req.body?.showBrowser;
    const headless = showBrowser === false;
    const status = await discord.start({ headless });
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start Discord session' });
  }
});

app.post('/api/discord/stop', async (_req, res) => {
  try {
    const status = await discord.stop();
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to stop Discord session' });
  }
});

app.post('/api/discord/reset-auth', async (_req, res) => {
  try {
    const result = await discord.resetAuth();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to reset auth' });
  }
});

app.post('/api/discord/wait-login', async (req, res) => {
  try {
    const timeoutMs = typeof req.body?.timeoutMs === 'number' ? req.body.timeoutMs : undefined;
    const status = await discord.waitForLogin({ timeoutMs });
    return res.json(status);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to wait for login' });
  }
});

app.get('/api/discord/guilds', async (_req, res) => {
  try {
    const guilds = await discord.listGuilds();
    return res.json({ guilds });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to list guilds' });
  }
});

app.get('/api/discord/debug', async (_req, res) => {
  try {
    const info = await discord.debugDom();
    return res.json(info);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to debug Discord DOM' });
  }
});

app.get('/api/discord/channels', async (req, res) => {
  try {
    const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : '';
    const channels = await discord.listTextChannels({ guildId });
    return res.json({ guildId, channels });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to list channels' });
  }
});

app.post('/api/discord/select', async (req, res) => {
  try {
    const guildId = typeof req.body?.guildId === 'string' ? req.body.guildId : '';
    const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId : '';
    const status = await discord.selectChannel({ guildId, channelId });
    return res.json(status);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to select channel' });
  }
});

app.post('/api/discord/clear', (_req, res) => {
  discord.clearRecentMessages();
  return res.json({ ok: true });
});

app.post('/api/discord/fetch-today', async (req, res) => {
  try {
    const maxScrolls = typeof req.body?.maxScrolls === 'number' ? req.body.maxScrolls : undefined;
    const result = await discord.fetchToday({ maxScrolls });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to fetch today\'s messages' });
  }
});

app.get('/api/discord/recent', (_req, res) => {
  return res.json({ messages: discord.getRecentMessages() });
});

app.get('/api/discord/stream', (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('status', discord.getStatus());

  const onMessage = (msg) => send('message', msg);
  discord.on('message', onMessage);

  const hb = setInterval(() => {
    send('ping', { t: Date.now() });
  }, 20_000);

  req.on('close', () => {
    clearInterval(hb);
    discord.off('message', onMessage);
  });
});

app.get('/api/runway', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const provider = normalizeProvider(req.query.provider);
    const model = typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : null;

    const company = await resolveCompany({ ticker });

    const cacheKey = `${provider}:${ticker}`;

    if (cacheEnabled) {
      const cached = runwayCache.get(cacheKey);
      if (cached) {
        return res.json({
          ticker,
          company: cached.company || company,
          runway: cached.runway,
          insufficientData: cached.insufficientData,
          cached: true
        });
      }
    }

    const runway = await getCashRunway({ ticker, provider, model: model || undefined, company });

    const insufficientData =
      runway?.accurate?.runwayMonths === null && runway?.estimate?.runwayMonths === null;
    if (insufficientData) {
      logger.warn('runway_insufficient_data', { ticker });
    }

    if (cacheEnabled) {
      runwayCache.set(cacheKey, { runway, insufficientData, company });
    }

    upsertQuery({ tab: 'runway', ticker, provider, model, payload: { company, runway } });

    return res.json({ ticker, company, runway, insufficientData, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status =
      lower.includes('ticker') ||
      lower.includes('api key') ||
      lower.includes('authentication failed') ||
      lower.includes('unauthorized')
        ? 400
        : 500;
    logger.error('runway_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/news', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const provider = normalizeProvider(req.query.provider);
    const model = typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : null;

    const company = await resolveCompany({ ticker });
    const news = await getNewsAnalysis({ ticker, provider, model: model || undefined, company });

    upsertQuery({ tab: 'news', ticker, provider, model, payload: { company, news } });
    return res.json({ ticker, company, news });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status =
      lower.includes('ticker') ||
      lower.includes('api key') ||
      lower.includes('authentication failed') ||
      lower.includes('unauthorized')
        ? 400
        : 500;
    logger.error('news_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/analysts', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const provider = normalizeProvider(req.query.provider);
    const model = typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : null;
    const company = await resolveCompany({ ticker });
    const analysts = await getAnalystSentiment({ ticker, provider, model: model || undefined, company });

    upsertQuery({ tab: 'analysts', ticker, provider, model, payload: { company, analysts } });
    return res.json({ ticker, company, analysts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status =
      lower.includes('ticker') ||
      lower.includes('api key') ||
      lower.includes('authentication failed') ||
      lower.includes('unauthorized')
        ? 400
        : 500;
    logger.error('analysts_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/value', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const provider = normalizeProvider(req.query.provider);
    const model = typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : null;

    const company = await resolveCompany({ ticker });
    let secFilingsPack = null;
    try {
      secFilingsPack = await secFilings.getRecentFilings({
        ticker,
        cik: company?.cik || null,
        limit: 30,
        forms: ['10-K', '10-Q', '8-K', '6-K', '20-F', 'S-1', 'S-3', 'F-1', 'F-3', '424B1', '424B3', '424B4', '424B5', 'DEF 14A', 'PRE 14A']
      });
    } catch (e) {
      // optional; proceed without SEC pack if rate-limited/unavailable
      secFilingsPack = null;
    }
    const { reportText, model: effectiveModel, estimates } = await getValueReport({
      ticker,
      provider,
      model: model || undefined,
      company,
      secFilings: secFilingsPack,
    });

    upsertQuery({ tab: 'value', ticker, provider, model: effectiveModel, payload: { company, secFilings: secFilingsPack, reportText, estimates } });
    return res.json({ ticker, company, provider, model: effectiveModel, reportText, estimates });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status =
      lower.includes('ticker') ||
      lower.includes('api key') ||
      lower.includes('authentication failed') ||
      lower.includes('unauthorized')
        ? 400
        : 500;
    logger.error('value_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/catout', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const provider = normalizeProvider(req.query.provider);
    const model = typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : null;

    const company = await resolveCompany({ ticker });
    let secFilingsPack = null;
    try {
      secFilingsPack = await secFilings.getRecentFilings({
        ticker,
        cik: company?.cik || null,
        limit: 30,
        forms: ['10-K', '10-Q', '8-K', '6-K', '20-F', 'S-1', 'S-3', 'F-1', 'F-3', '424B1', '424B3', '424B4', '424B5', 'DEF 14A', 'PRE 14A']
      });
    } catch (_e) {
      secFilingsPack = null;
    }
    const { reportText, model: effectiveModel } = await getCatOutOfBagReport({
      ticker,
      provider,
      model: model || undefined,
      company,
      secFilings: secFilingsPack,
    });

    upsertQuery({ tab: 'catout', ticker, provider, model: effectiveModel, payload: { company, secFilings: secFilingsPack, reportText } });
    return res.json({ ticker, company, provider, model: effectiveModel, reportText });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status =
      lower.includes('ticker') ||
      lower.includes('api key') ||
      lower.includes('authentication failed') ||
      lower.includes('unauthorized')
        ? 400
        : 500;
    logger.error('catout_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/dilution/overview', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const horizonDays = typeof req.query.horizonDays === 'string' ? Number(req.query.horizonDays) : undefined;
    const overview = await dilution.getOverview({ ticker, horizonDays });
    return res.json(overview);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status = lower.includes('ticker') || lower.includes('cik') || lower.includes('sec') ? 400 : 500;
    logger.error('dilution_overview_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/dilution/evidence', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const horizonDays = typeof req.query.horizonDays === 'string' ? Number(req.query.horizonDays) : undefined;
    const evidence = await dilution.getEvidence({ ticker, horizonDays });
    return res.json(evidence);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status = lower.includes('ticker') || lower.includes('cik') || lower.includes('sec') ? 400 : 500;
    logger.error('dilution_evidence_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/dilution/charts', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const charts = await dilution.getCharts({ ticker });
    return res.json(charts);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status = lower.includes('ticker') || lower.includes('cik') || lower.includes('sec') ? 400 : 500;
    logger.error('dilution_charts_failed', err);
    return res.status(status).json({ error: message });
  }
});

app.get('/api/dilution/analyze', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const provider = normalizeProvider(req.query.provider);
    const model = typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : null;
    const horizonDaysRaw = typeof req.query.horizonDays === 'string' ? Number(req.query.horizonDays) : undefined;
    const horizonDays = Number.isFinite(horizonDaysRaw) ? Math.min(Math.max(Math.trunc(horizonDaysRaw), 7), 365) : undefined;

    const company = await resolveCompany({ ticker });

    const overview = await dilution.getOverview({ ticker, horizonDays });
    const charts = await dilution.getCharts({ ticker });

    const effectiveModel =
      typeof model === 'string' && model.trim()
        ? model.trim()
        : provider === 'gemini'
          ? process.env.GEMINI_MODEL || 'models/gemini-2.5-pro'
          : process.env.XAI_MODEL || 'grok-4-1-fast-reasoning';

    const ai = await getDilutionAiSummary({
      ticker,
      company,
      provider,
      model: effectiveModel,
      overview
    });

    const payload = {
      horizonDays: overview?.horizonDays ?? horizonDays ?? 90,
      overview,
      charts,
      ai
    };

    upsertQuery({ tab: 'dilution', ticker, provider, model: effectiveModel, payload: { company, dilution: payload } });

    return res.json({ ticker, company, provider, model: effectiveModel, ...payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const lower = message.toLowerCase();
    const status =
      lower.includes('ticker') ||
      lower.includes('provider') ||
      lower.includes('api key') ||
      lower.includes('unauthorized') ||
      lower.includes('authentication failed') ||
      lower.includes('sec')
        ? 400
        : 500;
    logger.error('dilution_analyze_failed', err);
    return res.status(status).json({ error: message });
  }
});

// Serve the app logo from repo root.
app.get('/logo.png', (_req, res) => {
  const logoPath = path.join(rootDir, 'logo.png');
  if (!fs.existsSync(logoPath)) {
    return res.status(404).end();
  }
  return res.sendFile(logoPath);
});

// Serve the app favicon from repo root.
app.get('/favicon.png', (_req, res) => {
  const faviconPath = path.join(rootDir, 'favicon.png');
  if (!fs.existsSync(faviconPath)) {
    return res.status(404).end();
  }
  return res.sendFile(faviconPath);
});

// Many browsers still probe /favicon.ico by default.
app.get('/favicon.ico', (_req, res) => {
  return res.redirect(302, '/favicon.png');
});

// Serve built frontend (single-container prod)
const clientIndex = path.join(clientDistDir, 'index.html');
if (fs.existsSync(clientIndex)) {
  app.use(express.static(clientDistDir));
  app.get('*', (_req, res) => {
    res.sendFile(clientIndex);
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('text')
      .send('Client not built. Run `npm run dev:client` for dev UI or `npm run build` for production.');
  });
}

app.listen(port, () => {
  logger.info('server_started', {
    url: `http://localhost:${port}`,
    logFilePath
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', err);
  process.exitCode = 1;
});
