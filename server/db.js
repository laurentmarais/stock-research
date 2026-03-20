import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let db = null;

const DEFAULT_QUESTIONS = [
  'Is the company fundamentally profitable or clearly moving toward durable profitability?',
  'Is the stock undervalued relative to current fundamentals and realistic forward expectations?',
  'Do current macro conditions create a headwind, tailwind, or neutral backdrop for this company?',
  'Which current market risks could hurt this stock in the next 3 to 12 months?',
  'Which current market opportunities could help this stock outperform in the next 3 to 12 months?',
  'How sensitive is this business to interest rates, inflation, oil prices, and geopolitical shocks?',
  'What is the balance-sheet risk and dilution risk for shareholders today?',
  'What near-term catalysts or dates matter most for this stock?',
  'How reliable are the sources supporting the bullish and bearish cases?',
  'Given today\'s market conditions, how suitable is this stock as a buy candidate right now?'
];

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function getDbPath() {
  return path.join(rootDir, 'data', 'stock-research.sqlite');
}

export function initDb() {
  if (db) return db;
  const filePath = getDbPath();
  ensureDir(filePath);
  db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA foreign_keys=ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickers (
      ticker TEXT PRIMARY KEY,
      company_name TEXT,
      exchange TEXT,
      cik TEXT,
      resolved_via TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS company_overrides (
      ticker TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      exchange TEXT,
      cik TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (group_id) REFERENCES question_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS instructions (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_runs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      summary_md TEXT NOT NULL,
      structured_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      group_id TEXT,
      total_count INTEGER NOT NULL DEFAULT 0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      progress_message TEXT,
      error_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      paused_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      company_name TEXT,
      question_id TEXT NOT NULL,
      question_text TEXT NOT NULL,
      answer_md TEXT NOT NULL,
      stance TEXT,
      score REAL,
      confidence REAL,
      citations_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      company_name TEXT,
      score REAL,
      market_alignment TEXT,
      summary_md TEXT NOT NULL,
      pros_json TEXT NOT NULL,
      cons_json TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_answers_ticker_created ON answers(ticker, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_answers_job_ticker_question ON answers(job_id, ticker, question_id);
    CREATE INDEX IF NOT EXISTS idx_evaluations_ticker_created ON evaluations(ticker, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
  `);

  seed();
  return db;
}

function seed() {
  initDb();
  const count = db.prepare('SELECT COUNT(*) AS count FROM question_groups').get()?.count || 0;
  if (!count) {
    const groupId = crypto.randomUUID();
    const ts = nowIso();
    db.prepare('INSERT INTO question_groups (id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(groupId, 'Default Market Suitability', ts, ts);
    const insertQuestion = db.prepare('INSERT INTO questions (id, group_id, prompt, weight, sort_order, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)');
    DEFAULT_QUESTIONS.forEach((prompt, index) => insertQuestion.run(crypto.randomUUID(), groupId, prompt, index, ts, ts));
  }

  const instructions = db.prepare('SELECT id FROM instructions WHERE id=1').get();
  if (!instructions) {
    db.prepare('INSERT INTO instructions (id, body, updated_at) VALUES (1, ?, ?)').run(
      [
        'Use current public information and clearly distinguish verified facts from estimates.',
        'Prefer SEC filings, investor relations pages, Yahoo Finance, Benzinga, and reputable financial media.',
        'Always include direct source URLs when claims depend on current facts.',
        'Do not mix similarly named companies or tickers.',
        'State whether current market conditions are a headwind, tailwind, or neutral for the stock.'
      ].join('\n'),
      nowIso()
    );
  }
}

function parseJson(jsonText, fallback) {
  try {
    return JSON.parse(jsonText);
  } catch {
    return fallback;
  }
}

export function getSetting(name) {
  initDb();
  const row = db.prepare('SELECT value FROM settings WHERE name=?').get(name);
  return row?.value || '';
}

export function setSetting(name, value) {
  initDb();
  db.prepare(
    `INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).run(name, value, nowIso());
}

export function deleteSetting(name) {
  initDb();
  db.prepare('DELETE FROM settings WHERE name=?').run(name);
}

export function listTickers() {
  initDb();
  return db.prepare('SELECT ticker, company_name, exchange, cik, resolved_via, created_at, updated_at FROM tickers ORDER BY ticker').all().map((row) => ({
    ticker: row.ticker,
    companyName: row.company_name || '',
    exchange: row.exchange || '',
    cik: row.cik || '',
    resolvedVia: row.resolved_via || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function upsertTicker({ ticker, companyName = '', exchange = '', cik = '', resolvedVia = '' }) {
  initDb();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO tickers (ticker, company_name, exchange, cik, resolved_via, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET
       company_name=CASE WHEN excluded.company_name <> '' THEN excluded.company_name ELSE tickers.company_name END,
       exchange=CASE WHEN excluded.exchange <> '' THEN excluded.exchange ELSE tickers.exchange END,
       cik=CASE WHEN excluded.cik <> '' THEN excluded.cik ELSE tickers.cik END,
       resolved_via=CASE WHEN excluded.resolved_via <> '' THEN excluded.resolved_via ELSE tickers.resolved_via END,
       updated_at=excluded.updated_at`
  ).run(ticker, companyName, exchange, cik, resolvedVia, ts, ts);
}

export function getCompanyOverride(ticker) {
  initDb();
  const normalized = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!normalized) return null;
  const row = db.prepare('SELECT ticker, name, exchange, cik, updated_at FROM company_overrides WHERE ticker=?').get(normalized);
  if (!row || !row.name) return null;
  return {
    ticker: row.ticker,
    name: row.name,
    exchange: row.exchange || '',
    cik: row.cik || '',
    updatedAt: row.updated_at
  };
}

export function setCompanyOverride({ ticker, name, exchange = '', cik = '' }) {
  initDb();
  const normalized = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!normalized) throw new Error('ticker is required');

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    db.prepare('DELETE FROM company_overrides WHERE ticker=?').run(normalized);
    return { ticker: normalized, deleted: true, updatedAt: nowIso() };
  }

  const updatedAt = nowIso();
  db.prepare(
    `INSERT INTO company_overrides (ticker, name, exchange, cik, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET
       name=excluded.name,
       exchange=excluded.exchange,
       cik=excluded.cik,
       updated_at=excluded.updated_at`
  ).run(normalized, trimmedName, typeof exchange === 'string' ? exchange.trim() : '', typeof cik === 'string' ? cik.trim() : '', updatedAt);

  return { ticker: normalized, deleted: false, updatedAt };
}

export function deleteTicker(ticker) {
  initDb();
  db.prepare('DELETE FROM tickers WHERE ticker=?').run(ticker);
}

export function listQuestionGroups() {
  initDb();
  return db.prepare(
    `SELECT qg.id, qg.name, qg.is_active, qg.created_at, qg.updated_at, COUNT(q.id) AS question_count
     FROM question_groups qg
     LEFT JOIN questions q ON q.group_id = qg.id
     GROUP BY qg.id
     ORDER BY qg.is_active DESC, qg.updated_at DESC`
  ).all().map((row) => ({
    id: row.id,
    name: row.name,
    isActive: Number(row.is_active) === 1,
    questionCount: Number(row.question_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function getActiveQuestionGroup() {
  initDb();
  const row = db.prepare('SELECT id, name FROM question_groups WHERE is_active=1 ORDER BY updated_at DESC LIMIT 1').get();
  return row ? { id: row.id, name: row.name } : null;
}

export function createQuestionGroup(name) {
  initDb();
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare('INSERT INTO question_groups (id, name, is_active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(id, name, ts, ts);
  return { id, name };
}

export function duplicateQuestionGroup(id) {
  initDb();
  const source = db.prepare('SELECT id, name FROM question_groups WHERE id=?').get(id);
  if (!source) throw new Error('Question group not found');
  const next = createQuestionGroup(`${source.name} Copy`);
  const rows = db.prepare('SELECT prompt, weight, sort_order FROM questions WHERE group_id=? ORDER BY sort_order, created_at').all(id);
  const stmt = db.prepare('INSERT INTO questions (id, group_id, prompt, weight, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const ts = nowIso();
  rows.forEach((row) => stmt.run(crypto.randomUUID(), next.id, row.prompt, row.weight, row.sort_order, ts, ts));
  return next;
}

export function activateQuestionGroup(id) {
  initDb();
  db.exec('UPDATE question_groups SET is_active=0');
  db.prepare('UPDATE question_groups SET is_active=1, updated_at=? WHERE id=?').run(nowIso(), id);
}

export function listQuestions(groupId) {
  initDb();
  return db.prepare('SELECT id, group_id, prompt, weight, sort_order, created_at, updated_at FROM questions WHERE group_id=? ORDER BY sort_order, created_at').all(groupId).map((row) => ({
    id: row.id,
    groupId: row.group_id,
    prompt: row.prompt,
    weight: row.weight,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function createQuestion({ groupId, prompt, weight = 1 }) {
  initDb();
  const nextOrder = Number(db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM questions WHERE group_id=?').get(groupId)?.next_order || 0);
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare('INSERT INTO questions (id, group_id, prompt, weight, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, groupId, prompt, weight, nextOrder, ts, ts);
  return id;
}

export function updateQuestion({ id, prompt, weight }) {
  initDb();
  const current = db.prepare('SELECT id, prompt, weight FROM questions WHERE id=?').get(id);
  if (!current) throw new Error('Question not found');
  db.prepare('UPDATE questions SET prompt=?, weight=?, updated_at=? WHERE id=?').run(
    typeof prompt === 'string' && prompt.trim() ? prompt.trim() : current.prompt,
    typeof weight === 'number' && Number.isFinite(weight) ? weight : current.weight,
    nowIso(),
    id
  );
}

export function deleteQuestion(id) {
  initDb();
  db.prepare('DELETE FROM questions WHERE id=?').run(id);
}

export function getInstructions() {
  initDb();
  const row = db.prepare('SELECT body, updated_at FROM instructions WHERE id=1').get();
  return { body: row?.body || '', updatedAt: row?.updated_at || '' };
}

export function setInstructions(body) {
  initDb();
  db.prepare('UPDATE instructions SET body=?, updated_at=? WHERE id=1').run(body, nowIso());
}

export function insertMarketRun({ provider, model, summaryMd, structured, sources }) {
  initDb();
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  db.prepare('INSERT INTO market_runs (id, provider, model, summary_md, structured_json, sources_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    provider,
    model,
    summaryMd,
    JSON.stringify(structured || {}),
    JSON.stringify(Array.isArray(sources) ? sources : []),
    createdAt
  );
  return { id, createdAt };
}

export function getLatestMarketRun() {
  initDb();
  const row = db.prepare('SELECT * FROM market_runs ORDER BY created_at DESC LIMIT 1').get();
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    summaryMd: row.summary_md,
    structured: parseJson(row.structured_json, {}),
    sources: parseJson(row.sources_json, []),
    createdAt: row.created_at
  };
}

export function createJob({ type, provider, model, groupId = null, totalCount = 0 }) {
  initDb();
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare(
    'INSERT INTO jobs (id, type, status, provider, model, group_id, total_count, completed_count, progress_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)'
  ).run(id, type, 'running', provider, model, groupId, totalCount, 'Queued', ts, ts);
  return id;
}

export function updateJob(jobId, changes) {
  initDb();
  const current = getJob(jobId);
  if (!current) throw new Error('Job not found');
  const next = {
    status: changes.status ?? current.status,
    completedCount: changes.completedCount ?? current.completedCount,
    totalCount: changes.totalCount ?? current.totalCount,
    progressMessage: changes.progressMessage ?? current.progressMessage,
    errorText: changes.errorText ?? current.errorText,
    pausedAt: changes.pausedAt ?? current.pausedAt,
    finishedAt: changes.finishedAt ?? current.finishedAt,
    updatedAt: nowIso()
  };
  db.prepare(
    `UPDATE jobs
     SET status=?, completed_count=?, total_count=?, progress_message=?, error_text=?, paused_at=?, finished_at=?, updated_at=?
     WHERE id=?`
  ).run(next.status, next.completedCount, next.totalCount, next.progressMessage, next.errorText, next.pausedAt, next.finishedAt, next.updatedAt, jobId);
}

export function getJob(jobId) {
  initDb();
  const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    provider: row.provider,
    model: row.model,
    groupId: row.group_id,
    totalCount: row.total_count,
    completedCount: row.completed_count,
    progressMessage: row.progress_message || '',
    errorText: row.error_text || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pausedAt: row.paused_at || '',
    finishedAt: row.finished_at || ''
  };
}

export function listJobs() {
  initDb();
  return db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 20').all().map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    provider: row.provider,
    model: row.model,
    groupId: row.group_id,
    totalCount: row.total_count,
    completedCount: row.completed_count,
    progressMessage: row.progress_message || '',
    errorText: row.error_text || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pausedAt: row.paused_at || '',
    finishedAt: row.finished_at || ''
  }));
}

export function insertAnswer({ jobId, ticker, companyName, questionId, questionText, answerMd, stance, score, confidence, citations }) {
  initDb();
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO answers (id, job_id, ticker, company_name, question_id, question_text, answer_md, stance, score, confidence, citations_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id, ticker, question_id) DO UPDATE SET
       company_name=excluded.company_name,
       question_text=excluded.question_text,
       answer_md=excluded.answer_md,
       stance=excluded.stance,
       score=excluded.score,
       confidence=excluded.confidence,
       citations_json=excluded.citations_json,
       updated_at=excluded.updated_at`
  ).run(id, jobId, ticker, companyName, questionId, questionText, answerMd, stance, score, confidence, JSON.stringify(Array.isArray(citations) ? citations : []), ts, ts);
  return id;
}

export function listAnswerKeysForJob(jobId) {
  initDb();
  return db
    .prepare('SELECT ticker, question_id FROM answers WHERE job_id=?')
    .all(jobId)
    .map((row) => `${row.ticker}::${row.question_id}`);
}

export function listAnswers({ ticker = '' } = {}) {
  initDb();
  const rows = ticker
    ? db.prepare('SELECT * FROM answers WHERE ticker=? ORDER BY created_at DESC LIMIT 500').all(ticker)
    : db.prepare('SELECT * FROM answers ORDER BY created_at DESC LIMIT 500').all();
  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    ticker: row.ticker,
    companyName: row.company_name || '',
    questionId: row.question_id,
    questionText: row.question_text,
    answerMd: row.answer_md,
    stance: row.stance || '',
    score: row.score,
    confidence: row.confidence,
    citations: parseJson(row.citations_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function listLatestAnswersByTicker() {
  initDb();
  const rows = db.prepare('SELECT * FROM answers ORDER BY ticker ASC, created_at DESC').all();
  const byTicker = new Map();
  const latestJobByTicker = new Map();
  for (const row of rows) {
    if (!latestJobByTicker.has(row.ticker)) {
      latestJobByTicker.set(row.ticker, row.job_id);
    }
    if (latestJobByTicker.get(row.ticker) !== row.job_id) continue;
    if (!byTicker.has(row.ticker)) byTicker.set(row.ticker, []);
    byTicker.get(row.ticker).push({
      id: row.id,
      ticker: row.ticker,
      companyName: row.company_name || '',
      questionText: row.question_text,
      answerMd: row.answer_md,
      stance: row.stance || '',
      score: row.score,
      confidence: row.confidence,
      citations: parseJson(row.citations_json, []),
      createdAt: row.created_at
    });
  }
  return byTicker;
}

export function insertEvaluation({ ticker, companyName, score, marketAlignment, summaryMd, pros, cons, provider, model }) {
  initDb();
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO evaluations (id, ticker, company_name, score, market_alignment, summary_md, pros_json, cons_json, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, ticker, companyName, score, marketAlignment, summaryMd, JSON.stringify(pros || []), JSON.stringify(cons || []), provider, model, nowIso());
  return id;
}

export function listEvaluations() {
  initDb();
  return db.prepare('SELECT * FROM evaluations ORDER BY score DESC, created_at DESC LIMIT 500').all().map((row) => ({
    id: row.id,
    ticker: row.ticker,
    companyName: row.company_name || '',
    score: row.score,
    marketAlignment: row.market_alignment || '',
    summaryMd: row.summary_md,
    pros: parseJson(row.pros_json, []),
    cons: parseJson(row.cons_json, []),
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at
  }));
}

export function listHistorySummary() {
  initDb();
  const rows = db.prepare(
    `SELECT
       t.ticker,
       t.company_name,
       MAX(COALESCE(a.updated_at, e.created_at, t.updated_at)) AS updated_at,
       COUNT(DISTINCT a.id) AS answer_count,
       COUNT(DISTINCT e.id) AS evaluation_count
     FROM tickers t
     LEFT JOIN answers a ON a.ticker = t.ticker
     LEFT JOIN evaluations e ON e.ticker = t.ticker
     GROUP BY t.ticker, t.company_name
     ORDER BY updated_at DESC, t.ticker ASC`
  ).all();
  return rows.map((row) => ({
    ticker: row.ticker,
    companyName: row.company_name || '',
    updatedAt: row.updated_at || '',
    answerCount: Number(row.answer_count || 0),
    evaluationCount: Number(row.evaluation_count || 0)
  }));
}

export function deleteHistoryByTicker(ticker) {
  initDb();
  db.prepare('DELETE FROM answers WHERE ticker=?').run(ticker);
  db.prepare('DELETE FROM evaluations WHERE ticker=?').run(ticker);
  db.prepare('DELETE FROM tickers WHERE ticker=?').run(ticker);
}