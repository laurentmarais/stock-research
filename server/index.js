import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
  activateQuestionGroup,
  createJob,
  createQuestion,
  createQuestionGroup,
  deleteQuestion,
  deleteHistoryByTicker,
  deleteSetting,
  deleteTicker,
  getActiveQuestionGroup,
  getCompanyOverride,
  getInstructions,
  getJob,
  getLatestMarketRun,
  getSetting,
  initDb,
  insertAnswer,
  insertEvaluation,
  insertMarketRun,
  listAnswerKeysForJob,
  listAnswers,
  listExistingEvaluationTickers,
  listExistingAnswerKeys,
  listEvaluations,
  listHistorySummary,
  listJobs,
  listLatestAnswersByTicker,
  listQuestionGroups,
  listQuestions,
  listTickers,
  duplicateQuestionGroup,
  setCompanyOverride,
  setInstructions,
  setSetting,
  updateQuestion,
  updateJob,
  upsertTicker
} from './db.js';
import { chatJson, defaultModelForProvider, listModels, normalizeProvider } from './ai.js';
import { resolveCompany } from './companyResolve.js';
import { asOptionalString, normalizeTicker } from './validate.js';
import { createSecFilingsService } from './secFilings.js';
import { buildMarketSourceContext, buildTickerSourceContext } from './sourceContext.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, 'env.local') });
dotenv.config({ path: path.join(rootDir, '.env') });

initDb();

const app = express();
app.use(express.json({ limit: '100kb' }));

const secFilings = createSecFilingsService();

const jobRuntime = {
  activeJobId: null
};

function sendError(res, err, status = 500) {
  return res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}

function buildMarketPrompt({ instructions, sourceContext }) {
  return [
    {
      role: 'system',
      content: 'You are a market strategist. Use the server-fetched source context below as your primary evidence base and include direct source URLs for important claims. Return only valid JSON.'
    },
    {
      role: 'user',
      content: [
        'Task: Summarize the current market risks and opportunities today in general.',
        'Include downstream repercussions such as war affecting oil, inflation, rates, and sector winners/losers.',
        'Use the retrieved market proxy data below first. If that context is insufficient, say what remains uncertain instead of inventing facts.',
        '',
        'Retrieved source context:',
        sourceContext,
        '',
        'Provide concise markdown in summaryMd and also structured arrays for risks, opportunities, and sectors.',
        'Instructions:',
        instructions,
        'Return JSON with keys:',
        '{',
        '  "summaryMd": string,',
        '  "risks": string[],',
        '  "opportunities": string[],',
        '  "downstreamEffects": string[],',
        '  "favoredSectors": string[],',
        '  "pressuredSectors": string[],',
        '  "sources": string[]',
        '}'
      ].join('\n')
    }
  ];
}

function buildAnswerPrompt({ ticker, company, questionText, market, instructions, sourceContext }) {
  return [
    {
      role: 'system',
      content: 'You are an equity research analyst. Use the server-fetched source context below as your primary evidence base, include source URLs, and return only valid JSON.'
    },
    {
      role: 'user',
      content: [
        `Ticker: ${ticker}`,
        `Resolved company: ${company?.name || 'Unknown'}`,
        `Exchange: ${company?.exchange || 'Unknown'}`,
        `CIK: ${company?.cik || 'Unknown'}`,
        '',
        'Current market context:',
        market?.summaryMd || 'No market sentiment run yet.',
        '',
        'Retrieved ticker source context:',
        sourceContext,
        '',
        'Additional instructions:',
        instructions,
        '',
        `Question: ${questionText}`,
        '',
        'Return JSON with keys:',
        '{',
        '  "answerMd": string,',
        '  "stance": "tailwind" | "neutral" | "headwind",',
        '  "score": number,',
        '  "confidence": number,',
        '  "citations": string[]',
        '}',
        '',
        'Use only cited claims that can be traced to the retrieved source context or to stable discovery URLs already included there.',
        'If the retrieved context is insufficient for a confident claim, say so in answerMd and score conservatively.',
        '',
        'Score meaning: 1 is poor suitability in current conditions, 5 is excellent suitability.'
      ].join('\n')
    }
  ];
}

function buildEvaluationPrompt({ ticker, companyName, answers, market, instructions }) {
  const packedAnswers = answers.map((item) => `Question: ${item.questionText}\nScore: ${item.score}\nStance: ${item.stance}\nAnswer:\n${item.answerMd}`).join('\n\n');
  return [
    {
      role: 'system',
      content: 'You evaluate stock suitability in current conditions. Use the supplied answers and market context. Return only valid JSON.'
    },
    {
      role: 'user',
      content: [
        `Ticker: ${ticker}`,
        `Company: ${companyName || 'Unknown'}`,
        '',
        'Current market context:',
        market?.summaryMd || 'No market sentiment run yet.',
        '',
        'Answer pack:',
        packedAnswers,
        '',
        'Instructions:',
        instructions,
        '',
        'Return JSON with keys:',
        '{',
        '  "score": number,',
        '  "marketAlignment": "tailwind" | "neutral" | "headwind",',
        '  "summaryMd": string,',
        '  "pros": string[],',
        '  "cons": string[]',
        '}',
        '',
        'Score meaning: 1 is very unsuitable now, 5 is highly suitable now.'
      ].join('\n')
    }
  ];
}

async function enrichTicker(ticker) {
  const company = await resolveCompany({ ticker });
  upsertTicker({
    ticker,
    companyName: company.name || '',
    exchange: company.exchange || '',
    cik: company.cik || '',
    resolvedVia: company.resolvedVia || ''
  });
  return company;
}

function collectAnalysisScope({ groupId, targetTicker = '', overwriteAnswers = false, jobId = null }) {
  const activeGroupId = groupId || getActiveQuestionGroup()?.id;
  const questions = listQuestions(activeGroupId);
  const allTickers = listTickers();
  const normalizedTargetTicker = asOptionalString(targetTicker).toUpperCase();
  const tickers = normalizedTargetTicker
    ? allTickers.filter((tickerRow) => tickerRow.ticker === normalizedTargetTicker)
    : allTickers;
  const completedKeys = jobId ? new Set(listAnswerKeysForJob(jobId)) : new Set();
  const questionIds = questions.map((question) => question.id);
  const tickerSymbols = tickers.map((tickerRow) => tickerRow.ticker);
  const existingAnswerKeys = overwriteAnswers
    ? new Set()
    : new Set(listExistingAnswerKeys({ tickers: tickerSymbols, questionIds }));

  const pendingPairs = [];
  let skippedCompleted = 0;
  let skippedExisting = 0;

  for (const tickerRow of tickers) {
    for (const question of questions) {
      const key = `${tickerRow.ticker}::${question.id}`;
      if (completedKeys.has(key)) {
        skippedCompleted += 1;
        continue;
      }
      if (!overwriteAnswers && existingAnswerKeys.has(key)) {
        skippedExisting += 1;
        continue;
      }
      pendingPairs.push({ tickerRow, question });
    }
  }

  return {
    activeGroupId,
    questions,
    tickers,
    pendingPairs,
    completedKeys,
    counts: {
      tickerCount: tickers.length,
      questionCount: questions.length,
      totalPairs: tickers.length * questions.length,
      pendingCount: pendingPairs.length,
      skippedCompleted,
      skippedExisting
    }
  };
}

function collectEvaluationScope({ targetTicker = '', overwriteEvaluations = false }) {
  const answersByTicker = listLatestAnswersByTicker();
  const normalizedTargetTicker = asOptionalString(targetTicker).toUpperCase();
  const answerTickers = [...answersByTicker.keys()];
  const tickers = normalizedTargetTicker
    ? answerTickers.filter((ticker) => ticker === normalizedTargetTicker)
    : answerTickers;
  const existingEvaluationTickers = overwriteEvaluations
    ? new Set()
    : new Set(listExistingEvaluationTickers({ tickers }));

  const pendingTickers = [];
  let skippedExisting = 0;

  for (const ticker of tickers) {
    if (!overwriteEvaluations && existingEvaluationTickers.has(ticker)) {
      skippedExisting += 1;
      continue;
    }
    pendingTickers.push(ticker);
  }

  return {
    answersByTicker,
    tickers,
    pendingTickers,
    counts: {
      tickerCount: tickers.length,
      pendingCount: pendingTickers.length,
      skippedExisting,
      availableAnswerSets: answerTickers.length
    }
  };
}

async function processAnalysisJob(jobId) {
  if (jobRuntime.activeJobId && jobRuntime.activeJobId !== jobId) return;
  jobRuntime.activeJobId = jobId;
  try {
    const job = getJob(jobId);
    if (!job) return;
    const scope = collectAnalysisScope({
      groupId: job.groupId,
      targetTicker: job.targetTicker,
      overwriteAnswers: job.overwriteAnswers,
      jobId
    });
    const { questions, tickers, pendingPairs, completedKeys } = scope;
    const market = getLatestMarketRun();
    const instructions = getInstructions().body;

    let completed = completedKeys.size;
    const total = pendingPairs.length + completed;
    updateJob(jobId, { totalCount: total, status: 'running', progressMessage: 'Processing tickers', pausedAt: null });

    if (!pendingPairs.length) {
      updateJob(jobId, { status: 'completed', finishedAt: new Date().toISOString(), progressMessage: 'No pending questions to run', completedCount: completed, totalCount: total });
      return;
    }

    const tickerContextCache = new Map();
    for (const { tickerRow, question } of pendingPairs) {
      const completionKey = `${tickerRow.ticker}::${question.id}`;
      const latest = getJob(jobId);
      if (!latest) return;
      if (latest.status === 'paused') {
        jobRuntime.activeJobId = null;
        return;
      }

      let context = tickerContextCache.get(tickerRow.ticker);
      if (!context) {
        const company = await enrichTicker(tickerRow.ticker);
        const sourceContext = await buildTickerSourceContext({ ticker: tickerRow.ticker, company, secFilingsService: secFilings });
        context = { company, sourceContext };
        tickerContextCache.set(tickerRow.ticker, context);
      }

      updateJob(jobId, {
        progressMessage: `${tickerRow.ticker}: ${question.prompt}`,
        totalCount: total,
        completedCount: completed
      });
      const answer = await chatJson({
        provider: latest.provider,
        model: latest.model,
        temperature: 0.2,
        messages: buildAnswerPrompt({
          ticker: tickerRow.ticker,
          company: context.company,
          questionText: question.prompt,
          market,
          instructions,
          sourceContext: context.sourceContext.text
        })
      });
      insertAnswer({
        jobId,
        ticker: tickerRow.ticker,
        companyName: context.company.name || tickerRow.companyName || '',
        questionId: question.id,
        questionText: question.prompt,
        answerMd: String(answer?.answerMd || '').trim(),
        stance: String(answer?.stance || 'neutral').trim(),
        score: Number(answer?.score || 0),
        confidence: Number(answer?.confidence || 0),
        citations: Array.isArray(answer?.citations) ? answer.citations : []
      });
      completedKeys.add(completionKey);
      completed += 1;
      updateJob(jobId, { completedCount: completed, totalCount: total, progressMessage: `${tickerRow.ticker} complete ${completed}/${total}` });
    }
    updateJob(jobId, { status: 'completed', finishedAt: new Date().toISOString(), progressMessage: 'Analysis complete', completedCount: completed, totalCount: total });
  } catch (err) {
    updateJob(jobId, { status: 'failed', errorText: err instanceof Error ? err.message : String(err), finishedAt: new Date().toISOString() });
  } finally {
    if (jobRuntime.activeJobId === jobId) jobRuntime.activeJobId = null;
  }
}

app.get('/api/settings', (req, res) => {
  try {
    const xai = getSetting('xai_api_key');
    const gemini = getSetting('gemini_api_key');
    return res.json({
      xai: { configured: Boolean(xai), masked: xai ? `••••${xai.slice(-4)}` : '' },
      gemini: { configured: Boolean(gemini), masked: gemini ? `••••${gemini.slice(-4)}` : '' }
    });
  } catch (err) {
    return sendError(res, err);
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const xaiApiKey = asOptionalString(req.body?.xaiApiKey);
    const geminiApiKey = asOptionalString(req.body?.geminiApiKey);
    if (req.body?.xaiApiKey !== undefined) {
      if (xaiApiKey) setSetting('xai_api_key', xaiApiKey);
      else deleteSetting('xai_api_key');
    }
    if (req.body?.geminiApiKey !== undefined) {
      if (geminiApiKey) setSetting('gemini_api_key', geminiApiKey);
      else deleteSetting('gemini_api_key');
    }
    const xai = getSetting('xai_api_key');
    const gemini = getSetting('gemini_api_key');
    return res.json({
      saved: {
        xai: { configured: Boolean(xai), masked: xai ? `••••${xai.slice(-4)}` : '' },
        gemini: { configured: Boolean(gemini), masked: gemini ? `••••${gemini.slice(-4)}` : '' }
      }
    });
  } catch (err) {
    return sendError(res, err);
  }
});

app.get('/api/models', async (req, res) => {
  try {
    const provider = normalizeProvider(req.query.provider);
    const models = await listModels(provider);
    return res.json({ provider, models });
  } catch (err) {
    return sendError(res, err);
  }
});

app.get('/api/tickers', (req, res) => {
  try {
    return res.json({ items: listTickers() });
  } catch (err) {
    return sendError(res, err);
  }
});

app.post('/api/tickers/bulk', async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
    const symbols = [...new Set(raw.map(normalizeTicker))];
    for (const ticker of symbols) {
      const company = await enrichTicker(ticker);
      upsertTicker({
        ticker,
        companyName: company.name || '',
        exchange: company.exchange || '',
        cik: company.cik || '',
        resolvedVia: company.resolvedVia || ''
      });
    }
    return res.json({ ok: true, count: symbols.length, items: listTickers() });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.delete('/api/tickers/:ticker', (req, res) => {
  try {
    const ticker = normalizeTicker(req.params.ticker);
    deleteTicker(ticker);
    return res.json({ ok: true, ticker });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.get('/api/company', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const company = await enrichTicker(ticker);
    return res.json({ ticker, company });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.get('/api/sec/filings', async (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const forms = typeof req.query.forms === 'string'
      ? req.query.forms.split(',').map((item) => String(item || '').trim()).filter(Boolean)
      : undefined;
    const company = await resolveCompany({ ticker });
    const pack = await secFilings.getRecentFilings({ ticker, cik: company?.cik || null, limit, forms });
    return res.json({ ticker, company, ...pack });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.get('/api/company/override', (req, res) => {
  try {
    const ticker = normalizeTicker(req.query.ticker);
    const override = getCompanyOverride(ticker);
    return res.json({ ok: true, override });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.post('/api/company/override', (req, res) => {
  try {
    const ticker = normalizeTicker(req.body?.ticker);
    const name = asOptionalString(req.body?.name);
    const exchange = asOptionalString(req.body?.exchange);
    const cik = asOptionalString(req.body?.cik);
    setCompanyOverride({ ticker, name, exchange, cik });
    const override = getCompanyOverride(ticker);
    if (override) {
      upsertTicker({
        ticker,
        companyName: override.name || '',
        exchange: override.exchange || '',
        cik: override.cik || '',
        resolvedVia: 'override'
      });
      return res.json({ ok: true, override });
    }

    return resolveCompany({ ticker })
      .then((company) => {
        upsertTicker({
          ticker,
          companyName: company?.name || '',
          exchange: company?.exchange || '',
          cik: company?.cik || '',
          resolvedVia: company?.resolvedVia || ''
        });
        return res.json({ ok: true, override: null, company });
      })
      .catch((err) => sendError(res, err, 400));
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.get('/api/question-groups', (req, res) => {
  try {
    return res.json({ items: listQuestionGroups() });
  } catch (err) {
    return sendError(res, err);
  }
});

app.post('/api/question-groups', (req, res) => {
  try {
    const name = asOptionalString(req.body?.name);
    if (!name) return res.status(400).json({ error: 'name is required' });
    const item = createQuestionGroup(name);
    return res.json({ ok: true, item });
  } catch (err) {
    return sendError(res, err);
  }
});

app.post('/api/question-groups/:id/duplicate', (req, res) => {
  try {
    const item = duplicateQuestionGroup(req.params.id);
    return res.json({ ok: true, item });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.post('/api/question-groups/:id/activate', (req, res) => {
  try {
    activateQuestionGroup(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.get('/api/questions', (req, res) => {
  try {
    const groupId = asOptionalString(req.query.groupId) || getActiveQuestionGroup()?.id;
    if (!groupId) return res.json({ items: [] });
    return res.json({ items: listQuestions(groupId) });
  } catch (err) {
    return sendError(res, err);
  }
});

app.post('/api/questions', (req, res) => {
  try {
    const groupId = asOptionalString(req.body?.groupId);
    const prompt = asOptionalString(req.body?.prompt);
    if (!groupId || !prompt) return res.status(400).json({ error: 'groupId and prompt are required' });
    const id = createQuestion({ groupId, prompt, weight: Number(req.body?.weight || 1) || 1 });
    return res.json({ ok: true, id });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.put('/api/questions/:id', (req, res) => {
  try {
    updateQuestion({
      id: req.params.id,
      prompt: asOptionalString(req.body?.prompt),
      weight: Number(req.body?.weight)
    });
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.delete('/api/questions/:id', (req, res) => {
  try {
    deleteQuestion(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.get('/api/instructions', (req, res) => {
  try {
    return res.json(getInstructions());
  } catch (err) {
    return sendError(res, err);
  }
});

app.post('/api/instructions', (req, res) => {
  try {
    setInstructions(String(req.body?.body || ''));
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, err);
  }
});

app.get('/api/market-sentiment/latest', (req, res) => {
  try {
    return res.json({ item: getLatestMarketRun() });
  } catch (err) {
    return sendError(res, err);
  }
});

app.post('/api/market-sentiment/run', async (req, res) => {
  try {
    const provider = normalizeProvider(req.body?.provider);
    const model = asOptionalString(req.body?.model) || defaultModelForProvider(provider);
    const instructions = getInstructions().body;
    const sourceContext = await buildMarketSourceContext();
    const payload = await chatJson({
      provider,
      model,
      messages: buildMarketPrompt({ instructions, sourceContext: sourceContext.text }),
      temperature: 0.2
    });
    const result = insertMarketRun({
      provider,
      model,
      summaryMd: String(payload?.summaryMd || '').trim(),
      structured: payload,
      sources: [...new Set([...(Array.isArray(payload?.sources) ? payload.sources : []), ...sourceContext.sources])]
    });
    return res.json({ ok: true, id: result.id, item: getLatestMarketRun() });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.get('/api/jobs', (req, res) => {
  try {
    return res.json({ items: listJobs() });
  } catch (err) {
    return sendError(res, err);
  }
});

app.post('/api/analysis/run', async (req, res) => {
  try {
    const provider = normalizeProvider(req.body?.provider);
    const model = asOptionalString(req.body?.model) || defaultModelForProvider(provider);
    const groupId = asOptionalString(req.body?.groupId) || getActiveQuestionGroup()?.id;
    const targetTicker = asOptionalString(req.body?.ticker).toUpperCase();
    const overwriteAnswers = Boolean(req.body?.overwriteAnswers);
    const allTickers = listTickers();
    const tickers = targetTicker ? allTickers.filter((tickerRow) => tickerRow.ticker === targetTicker) : allTickers;
    const questions = listQuestions(groupId);
    if (targetTicker && !tickers.length) return res.status(400).json({ error: 'Selected ticker was not found' });
    if (!tickers.length) return res.status(400).json({ error: 'Add at least one ticker first' });
    if (!questions.length) return res.status(400).json({ error: 'Active question group has no questions' });
    const jobId = createJob({
      type: 'analysis',
      provider,
      model,
      groupId,
      targetTicker,
      overwriteAnswers,
      totalCount: 0
    });
    processAnalysisJob(jobId).catch(() => undefined);
    return res.json({ ok: true, jobId, job: getJob(jobId) });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.get('/api/analysis/preview', (req, res) => {
  try {
    const groupId = asOptionalString(req.query.groupId) || getActiveQuestionGroup()?.id;
    const targetTicker = asOptionalString(req.query.ticker).toUpperCase();
    const overwriteAnswers = String(req.query.overwriteAnswers || '').toLowerCase() === 'true';
    const scope = collectAnalysisScope({ groupId, targetTicker, overwriteAnswers });

    return res.json({
      ok: true,
      groupId: scope.activeGroupId,
      targetTicker: targetTicker || '',
      overwriteAnswers,
      counts: scope.counts
    });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.post('/api/jobs/:id/pause', (req, res) => {
  try {
    const jobId = req.params.id;
    updateJob(jobId, { status: 'paused', pausedAt: new Date().toISOString(), progressMessage: 'Paused by user' });
    return res.json({ ok: true, job: getJob(jobId) });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.post('/api/jobs/:id/resume', (req, res) => {
  try {
    const jobId = req.params.id;
    const job = getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    updateJob(jobId, { status: 'running', pausedAt: null, progressMessage: 'Resuming' });
    if (!jobRuntime.activeJobId) processAnalysisJob(jobId).catch(() => undefined);
    return res.json({ ok: true, job: getJob(jobId) });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.get('/api/answers', (req, res) => {
  try {
    const ticker = asOptionalString(req.query.ticker).toUpperCase();
    return res.json({ items: listAnswers({ ticker }) });
  } catch (err) {
    return sendError(res, err);
  }
});

app.get('/api/evaluations', (req, res) => {
  try {
    return res.json({ items: listEvaluations() });
  } catch (err) {
    return sendError(res, err);
  }
});

app.get('/api/evaluations/preview', (req, res) => {
  try {
    const targetTicker = asOptionalString(req.query.ticker).toUpperCase();
    const overwriteEvaluations = String(req.query.overwriteEvaluations || '').toLowerCase() === 'true';
    const scope = collectEvaluationScope({ targetTicker, overwriteEvaluations });

    return res.json({
      ok: true,
      targetTicker: targetTicker || '',
      overwriteEvaluations,
      counts: scope.counts
    });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.post('/api/evaluations/run', async (req, res) => {
  try {
    const provider = normalizeProvider(req.body?.provider);
    const model = asOptionalString(req.body?.model) || defaultModelForProvider(provider);
    const targetTicker = asOptionalString(req.body?.ticker).toUpperCase();
    const overwriteEvaluations = Boolean(req.body?.overwriteEvaluations);
    const scope = collectEvaluationScope({ targetTicker, overwriteEvaluations });
    const { answersByTicker, pendingTickers, tickers } = scope;
    const market = getLatestMarketRun();
    const instructions = getInstructions().body;
    if (targetTicker && !tickers.length) return res.status(400).json({ error: 'Selected ticker has no answer set to evaluate' });
    if (![...answersByTicker.keys()].length) return res.status(400).json({ error: 'Run answers first' });
    if (!pendingTickers.length) {
      return res.json({ ok: true, skipped: true, items: listEvaluations() });
    }
    for (const ticker of pendingTickers) {
      const answers = answersByTicker.get(ticker) || [];
      if (!answers.length) continue;
      const companyName = answers[0]?.companyName || '';
      const payload = await chatJson({
        provider,
        model,
        temperature: 0.2,
        messages: buildEvaluationPrompt({ ticker, companyName, answers, market, instructions })
      });
      insertEvaluation({
        ticker,
        companyName,
        score: Number(payload?.score || 0),
        marketAlignment: String(payload?.marketAlignment || 'neutral'),
        summaryMd: String(payload?.summaryMd || '').trim(),
        pros: Array.isArray(payload?.pros) ? payload.pros : [],
        cons: Array.isArray(payload?.cons) ? payload.cons : [],
        provider,
        model
      });
    }
    return res.json({ ok: true, items: listEvaluations() });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

app.get('/api/history/summary', (req, res) => {
  try {
    return res.json({ items: listHistorySummary() });
  } catch (err) {
    return sendError(res, err);
  }
});

app.post('/api/history/delete', (req, res) => {
  try {
    const ticker = normalizeTicker(req.body?.ticker);
    deleteHistoryByTicker(ticker);
    return res.json({ ok: true, ticker });
  } catch (err) {
    return sendError(res, err, 400);
  }
});

const clientDistDir = path.join(rootDir, 'client', 'dist');
app.use(express.static(clientDistDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistDir, 'index.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`stock-research server running on http://127.0.0.1:${port}`);
});