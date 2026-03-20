import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');

function localDayString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

let db = null;

export function getDbFilePath() {
  const configured = process.env.DB_FILE ? path.resolve(rootDir, process.env.DB_FILE) : null;
  if (configured) return configured;
  return path.join(rootDir, 'data', 'marketmind.sqlite');
}

export function initDb() {
  if (db) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS history_meta (
          ticker TEXT PRIMARY KEY,
          favorite INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS research_items (
          id TEXT PRIMARY KEY,
          ticker TEXT NOT NULL,
          md TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      db.exec('CREATE INDEX IF NOT EXISTS idx_research_ticker_updated ON research_items(ticker, updated_at DESC);');
    } catch {
      // ignore
    }
    return db;
  }

  const filePath = getDbFilePath();
  ensureDir(filePath);

  db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA synchronous=NORMAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS queries (
      tab TEXT NOT NULL,
      ticker TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      day TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (tab, ticker, provider, day)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS adhoc_queries (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ticker TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      word_limit INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer_text TEXT NOT NULL
    );
  `);

  // Lightweight migration for older DBs created before the model column existed.
  try {
    const cols = db.prepare('PRAGMA table_info(queries);').all();
    const hasModel = Array.isArray(cols) && cols.some((c) => c?.name === 'model');
    if (!hasModel) {
      db.exec('ALTER TABLE queries ADD COLUMN model TEXT;');
    }
  } catch {
    // ignore
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_queries_tab_day_updated ON queries(tab, day, updated_at DESC);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_queries_tab_ticker_day ON queries(tab, ticker, day);');

  db.exec('CREATE INDEX IF NOT EXISTS idx_adhoc_day_updated ON adhoc_queries(day, updated_at DESC);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_adhoc_ticker_day ON adhoc_queries(ticker, day);');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS company_overrides (
      ticker TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      exchange TEXT,
      cik TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      ticker TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      exchange TEXT,
      cik TEXT,
      resolved_via TEXT NOT NULL,
      sources_json TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS history_meta (
      ticker TEXT PRIMARY KEY,
      favorite INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS research_items (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      md TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_research_ticker_updated ON research_items(ticker, updated_at DESC);');

  return db;
}

function listFavoriteRowsForTickers(tickers = []) {
  initDb();
  const normalized = Array.isArray(tickers)
    ? tickers
        .map((t) => (typeof t === 'string' ? t.trim().toUpperCase() : ''))
        .filter(Boolean)
    : [];
  if (!normalized.length) return [];

  const unique = [...new Set(normalized)];
  const placeholders = unique.map(() => '?').join(',');
  return db
    .prepare(`SELECT ticker, favorite FROM history_meta WHERE ticker IN (${placeholders});`)
    .all(...unique);
}

export function isHistoryFavorite(ticker) {
  initDb();
  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!t) return false;
  const row = db.prepare('SELECT favorite FROM history_meta WHERE ticker=?').get(t);
  return Number(row?.favorite || 0) === 1;
}

export function setHistoryFavorite({ ticker, favorite } = {}) {
  initDb();
  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!t) throw new Error('ticker is required');
  const fav = favorite ? 1 : 0;
  const updatedAt = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO history_meta (ticker, favorite, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET favorite=excluded.favorite, updated_at=excluded.updated_at;`
  );
  stmt.run(t, fav, updatedAt);
  return { ticker: t, favorite: Boolean(fav), updatedAt };
}

export function getCompanyOverride(ticker) {
  initDb();
  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!t) return null;

  // Preferred: unified companies table.
  try {
    const stmt = db.prepare(
      'SELECT ticker, name, exchange, cik, updated_at FROM companies WHERE ticker=? AND resolved_via=\'override\''
    );
    const row = stmt.get(t);
    if (row && typeof row.name === 'string' && row.name.trim()) {
      return {
        ticker: row.ticker,
        name: row.name,
        exchange: typeof row.exchange === 'string' && row.exchange.trim() ? row.exchange.trim() : null,
        cik: typeof row.cik === 'string' && row.cik.trim() ? row.cik.trim() : null,
        updatedAt: row.updated_at
      };
    }
  } catch {
    // ignore
  }

  // Back-compat: old overrides table.
  const stmt2 = db.prepare('SELECT ticker, name, exchange, cik, updated_at FROM company_overrides WHERE ticker=?');
  const row2 = stmt2.get(t);
  if (!row2 || typeof row2.name !== 'string' || !row2.name.trim()) return null;

  // Best-effort migrate legacy override into unified companies table.
  try {
    const updatedAt = typeof row2.updated_at === 'string' && row2.updated_at ? row2.updated_at : new Date().toISOString();
    const stmtNew = db.prepare(
      `INSERT INTO companies (ticker, name, exchange, cik, resolved_via, sources_json, updated_at)
       VALUES (?, ?, ?, ?, 'override', NULL, ?)
       ON CONFLICT(ticker) DO UPDATE SET name=excluded.name, exchange=excluded.exchange, cik=excluded.cik, resolved_via='override', sources_json=NULL, updated_at=excluded.updated_at;`
    );
    stmtNew.run(t, String(row2.name).trim(), row2.exchange || null, row2.cik || null, updatedAt);
  } catch {
    // ignore
  }

  return {
    ticker: row2.ticker,
    name: row2.name,
    exchange: typeof row2.exchange === 'string' && row2.exchange.trim() ? row2.exchange.trim() : null,
    cik: typeof row2.cik === 'string' && row2.cik.trim() ? row2.cik.trim() : null,
    updatedAt: row2.updated_at
  };
}

export function setCompanyOverride({ ticker, name, exchange, cik }) {
  initDb();
  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!t) throw new Error('ticker is required');

  const n = typeof name === 'string' ? name.trim() : '';
  const ex = typeof exchange === 'string' ? exchange.trim() : '';
  const c = typeof cik === 'string' ? cik.trim() : '';
  const updatedAt = new Date().toISOString();

  // Empty name means delete override.
  if (!n) {
    try {
      const delNew = db.prepare('DELETE FROM companies WHERE ticker=? AND resolved_via=\'override\'');
      delNew.run(t);
    } catch {
      // ignore
    }
    const delOld = db.prepare('DELETE FROM company_overrides WHERE ticker=?');
    delOld.run(t);
    return { ticker: t, deleted: true, updatedAt };
  }

  // Store override in unified companies table.
  const stmtNew = db.prepare(
    `INSERT INTO companies (ticker, name, exchange, cik, resolved_via, sources_json, updated_at)
     VALUES (?, ?, ?, ?, 'override', NULL, ?)
     ON CONFLICT(ticker) DO UPDATE SET name=excluded.name, exchange=excluded.exchange, cik=excluded.cik, resolved_via='override', sources_json=NULL, updated_at=excluded.updated_at;`
  );
  stmtNew.run(t, n, ex || null, c || null, updatedAt);

  // Clean up any legacy duplicate override rows (best-effort).
  try {
    const delOld = db.prepare('DELETE FROM company_overrides WHERE ticker=?');
    delOld.run(t);
  } catch {
    // ignore
  }
  return { ticker: t, deleted: false, updatedAt };
}

export function getSetting(name) {
  initDb();
  const key = typeof name === 'string' ? name.trim() : '';
  if (!key) return null;
  const stmt = db.prepare('SELECT value FROM settings WHERE name=?');
  const row = stmt.get(key);
  return row && typeof row.value === 'string' ? row.value : null;
}

export function setSetting(name, value) {
  initDb();
  const key = typeof name === 'string' ? name.trim() : '';
  if (!key) throw new Error('setting name is required');
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) throw new Error('setting value is required');

  const updatedAt = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO settings (name, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;`
  );
  stmt.run(key, v, updatedAt);
  return { name: key, updatedAt };
}

export function deleteSetting(name) {
  initDb();
  const key = typeof name === 'string' ? name.trim() : '';
  if (!key) return;
  const stmt = db.prepare('DELETE FROM settings WHERE name=?');
  stmt.run(key);
}

export function pruneBeforeToday() {
  initDb();
  const today = localDayString();
  const stmt = db.prepare('DELETE FROM queries WHERE day < ?');
  stmt.run(today);

  const stmt2 = db.prepare('DELETE FROM adhoc_queries WHERE day < ?');
  stmt2.run(today);
}

// NOTE: History is intended to persist indefinitely.
// pruneBeforeToday() remains for backwards-compatibility but is no longer called by default.

export function upsertAdhocQuery({ id, ticker, provider, model, wordLimit, question, answerText }) {
  initDb();

  const day = localDayString();
  const updatedAt = new Date().toISOString();

  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) throw new Error('id is required');
  const t = typeof ticker === 'string' ? ticker.trim() : '';
  const p = typeof provider === 'string' ? provider.trim() : '';
  const q = typeof question === 'string' ? question.trim() : '';
  const a = typeof answerText === 'string' ? answerText : '';
  const wl = Math.max(10, Math.min(500, Number(wordLimit) || 100));
  const modelValue = typeof model === 'string' && model.trim() ? model.trim() : null;

  if (!t) throw new Error('ticker is required');
  if (!p) throw new Error('provider is required');
  if (!q) throw new Error('question is required');
  if (!a) throw new Error('answerText is required');

  const stmt = db.prepare(`
    INSERT INTO adhoc_queries (id, day, updated_at, ticker, provider, model, word_limit, question, answer_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      updated_at=excluded.updated_at,
      model=excluded.model,
      word_limit=excluded.word_limit,
      question=excluded.question,
      answer_text=excluded.answer_text;
  `);

  stmt.run(key, day, updatedAt, t, p, modelValue, wl, q, a);
  return { id: key, day, updatedAt };
}

export function listAdhocForToday({ limit = 50 }) {
  initDb();

  const day = localDayString();
  const stmt = db.prepare(`
    SELECT id, ticker, provider, model, word_limit AS wordLimit, question, updated_at AS updatedAt
    FROM adhoc_queries
    WHERE day = ?
    ORDER BY updated_at DESC
    LIMIT ?;
  `);

  const rows = stmt.all(day, Math.max(1, Math.min(Number(limit) || 50, 200)));
  return rows.map((r) => ({
    id: r.id,
    ticker: r.ticker,
    provider: r.provider,
    model: r.model ?? null,
    wordLimit: typeof r.wordLimit === 'number' ? r.wordLimit : Number(r.wordLimit) || 100,
    question: r.question,
    updatedAt: r.updatedAt
  }));
}

export function getAdhocForToday({ id }) {
  initDb();

  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) return null;

  const day = localDayString();
  const stmt = db.prepare(
    'SELECT id, ticker, provider, model, word_limit AS wordLimit, question, answer_text AS answerText, updated_at AS updatedAt FROM adhoc_queries WHERE id=? AND day=?'
  );
  const row = stmt.get(key, day);
  if (!row) return null;
  return {
    id: row.id,
    ticker: row.ticker,
    provider: row.provider,
    model: row.model ?? null,
    wordLimit: typeof row.wordLimit === 'number' ? row.wordLimit : Number(row.wordLimit) || 100,
    question: row.question,
    answerText: row.answerText,
    updatedAt: row.updatedAt,
    day
  };
}

export function listAdhoc({ limit = 50, ticker } = {}) {
  initDb();
  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';

  const lim = Math.max(1, Math.min(Number(limit) || 50, 500));
  if (t) {
    const stmt = db.prepare(`
      SELECT id, ticker, provider, model, word_limit AS wordLimit, question, updated_at AS updatedAt
      FROM adhoc_queries
      WHERE ticker = ?
      ORDER BY updated_at DESC
      LIMIT ?;
    `);
    const rows = stmt.all(t, lim);
    return rows.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      provider: r.provider,
      model: r.model ?? null,
      wordLimit: typeof r.wordLimit === 'number' ? r.wordLimit : Number(r.wordLimit) || 100,
      question: r.question,
      updatedAt: r.updatedAt
    }));
  }

  const stmt = db.prepare(`
    SELECT id, ticker, provider, model, word_limit AS wordLimit, question, updated_at AS updatedAt
    FROM adhoc_queries
    ORDER BY updated_at DESC
    LIMIT ?;
  `);
  const rows = stmt.all(lim);
  return rows.map((r) => ({
    id: r.id,
    ticker: r.ticker,
    provider: r.provider,
    model: r.model ?? null,
    wordLimit: typeof r.wordLimit === 'number' ? r.wordLimit : Number(r.wordLimit) || 100,
    question: r.question,
    updatedAt: r.updatedAt
  }));
}

export function getAdhoc({ id }) {
  initDb();

  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) return null;

  const stmt = db.prepare(
    'SELECT id, day, ticker, provider, model, word_limit AS wordLimit, question, answer_text AS answerText, updated_at AS updatedAt FROM adhoc_queries WHERE id=?'
  );
  const row = stmt.get(key);
  if (!row) return null;
  return {
    id: row.id,
    ticker: row.ticker,
    provider: row.provider,
    model: row.model ?? null,
    wordLimit: typeof row.wordLimit === 'number' ? row.wordLimit : Number(row.wordLimit) || 100,
    question: row.question,
    answerText: row.answerText,
    updatedAt: row.updatedAt,
    day: row.day
  };
}

export function upsertQuery({ tab, ticker, provider, model, payload }) {
  initDb();

  const day = localDayString();
  const updatedAt = new Date().toISOString();
  const payloadJson = JSON.stringify(payload ?? null);
  const modelValue = typeof model === 'string' && model.trim() ? model.trim() : null;

  const stmt = db.prepare(`
    INSERT INTO queries (tab, ticker, provider, model, day, updated_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tab, ticker, provider, day)
    DO UPDATE SET updated_at=excluded.updated_at, payload_json=excluded.payload_json, model=excluded.model;
  `);

  stmt.run(tab, ticker, provider, modelValue, day, updatedAt, payloadJson);
  return { tab, ticker, provider, day, updatedAt };
}

export function listTickersForTabToday({ tab, limit = 50 }) {
  initDb();

  const day = localDayString();
  const stmt = db.prepare(`
    SELECT ticker, MAX(updated_at) AS updatedAt
    FROM queries
    WHERE tab = ? AND day = ?
    GROUP BY ticker
    ORDER BY MAX(updated_at) DESC
    LIMIT ?;
  `);

  const rows = stmt.all(tab, day, Math.max(1, Math.min(Number(limit) || 50, 200)));
  return rows.map((r) => ({ ticker: r.ticker, updatedAt: r.updatedAt }));
}

export function listTickersForTab({ tab, limit = 50 }) {
  initDb();
  const stmt = db.prepare(`
    SELECT ticker, MAX(updated_at) AS updatedAt
    FROM queries
    WHERE tab = ?
    GROUP BY ticker
    ORDER BY MAX(updated_at) DESC
    LIMIT ?;
  `);

  const rows = stmt.all(tab, Math.max(1, Math.min(Number(limit) || 50, 500)));
  return rows.map((r) => ({ ticker: r.ticker, updatedAt: r.updatedAt }));
}

export function getQueryForToday({ tab, ticker, provider }) {
  initDb();

  const day = localDayString();

  if (provider) {
    const stmt = db.prepare(
      'SELECT tab, ticker, provider, model, day, updated_at AS updatedAt, payload_json AS payloadJson FROM queries WHERE tab=? AND ticker=? AND provider=? AND day=?'
    );
    const row = stmt.get(tab, ticker, provider, day);
    if (!row) return null;
    return {
      tab: row.tab,
      ticker: row.ticker,
      provider: row.provider,
      model: row.model ?? null,
      day: row.day,
      updatedAt: row.updatedAt,
      payload: JSON.parse(row.payloadJson)
    };
  }

  const stmt = db.prepare(
    'SELECT tab, ticker, provider, model, day, updated_at AS updatedAt, payload_json AS payloadJson FROM queries WHERE tab=? AND ticker=? AND day=? ORDER BY updated_at DESC LIMIT 1'
  );
  const row = stmt.get(tab, ticker, day);
  if (!row) return null;
  return {
    tab: row.tab,
    ticker: row.ticker,
    provider: row.provider,
    model: row.model ?? null,
    day: row.day,
    updatedAt: row.updatedAt,
    payload: JSON.parse(row.payloadJson)
  };
}

export function getLatestQuery({ tab, ticker, provider }) {
  initDb();

  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!t) throw new Error('ticker is required');

  if (provider) {
    const stmt = db.prepare(
      'SELECT tab, ticker, provider, model, day, updated_at AS updatedAt, payload_json AS payloadJson FROM queries WHERE tab=? AND ticker=? AND provider=? ORDER BY updated_at DESC LIMIT 1'
    );
    const row = stmt.get(tab, t, provider);
    if (!row) return null;
    return {
      tab: row.tab,
      ticker: row.ticker,
      provider: row.provider,
      model: row.model ?? null,
      day: row.day,
      updatedAt: row.updatedAt,
      payload: JSON.parse(row.payloadJson)
    };
  }

  const stmt = db.prepare(
    'SELECT tab, ticker, provider, model, day, updated_at AS updatedAt, payload_json AS payloadJson FROM queries WHERE tab=? AND ticker=? ORDER BY updated_at DESC LIMIT 1'
  );
  const row = stmt.get(tab, t);
  if (!row) return null;
  return {
    tab: row.tab,
    ticker: row.ticker,
    provider: row.provider,
    model: row.model ?? null,
    day: row.day,
    updatedAt: row.updatedAt,
    payload: JSON.parse(row.payloadJson)
  };
}

export function listHistorySummary({ limit = 500 } = {}) {
  initDb();

  const lim = Math.max(1, Math.min(Number(limit) || 500, 5000));
  const rows = db
    .prepare(
      `
      SELECT tab, ticker, MAX(updated_at) AS updatedAt
      FROM queries
      GROUP BY tab, ticker
      ORDER BY MAX(updated_at) DESC
      LIMIT ?;
    `
    )
    .all(lim);

  const byTicker = new Map();
  for (const r of rows) {
    const t = r.ticker;
    const tab = r.tab;
    const updatedAt = r.updatedAt;
    if (!t || !tab) continue;
    if (!byTicker.has(t)) {
      byTicker.set(t, { ticker: t, updatedAt, tabs: {} });
    }
    const entry = byTicker.get(t);
    entry.tabs[tab] = updatedAt;
    if (updatedAt && (!entry.updatedAt || updatedAt > entry.updatedAt)) entry.updatedAt = updatedAt;
  }

  // Merge in adhoc activity as its own tab.
  const adhocRows = db
    .prepare(
      `
      SELECT ticker, MAX(updated_at) AS updatedAt
      FROM adhoc_queries
      GROUP BY ticker
      ORDER BY MAX(updated_at) DESC
      LIMIT ?;
    `
    )
    .all(lim);
  for (const r of adhocRows) {
    const t = r.ticker;
    const updatedAt = r.updatedAt;
    if (!t) continue;
    if (!byTicker.has(t)) {
      byTicker.set(t, { ticker: t, updatedAt, tabs: {} });
    }
    const entry = byTicker.get(t);
    entry.tabs.adhoc = updatedAt;
    if (updatedAt && (!entry.updatedAt || updatedAt > entry.updatedAt)) entry.updatedAt = updatedAt;
  }

  // Merge in research activity as its own tab.
  const researchRows = db
    .prepare(
      `
      SELECT ticker, MAX(updated_at) AS updatedAt
      FROM research_items
      GROUP BY ticker
      ORDER BY MAX(updated_at) DESC
      LIMIT ?;
    `
    )
    .all(lim);
  for (const r of researchRows) {
    const t = r.ticker;
    const updatedAt = r.updatedAt;
    if (!t) continue;
    if (!byTicker.has(t)) {
      byTicker.set(t, { ticker: t, updatedAt, tabs: {} });
    }
    const entry = byTicker.get(t);
    entry.tabs.research = updatedAt;
    if (updatedAt && (!entry.updatedAt || updatedAt > entry.updatedAt)) entry.updatedAt = updatedAt;
  }

  const tickers = [...byTicker.keys()];
  const favorites = new Map();
  for (const r of listFavoriteRowsForTickers(tickers)) {
    const t = r?.ticker;
    if (!t) continue;
    favorites.set(String(t).toUpperCase(), Number(r?.favorite || 0) === 1);
  }

  for (const [t, entry] of byTicker.entries()) {
    entry.favorite = favorites.get(String(t).toUpperCase()) === true;
  }

  return [...byTicker.values()].sort((a, b) => {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });
}

export function deleteHistoryByTicker({ ticker, tab } = {}) {
  initDb();
  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!t) throw new Error('ticker is required');
  const tabKey = typeof tab === 'string' ? tab.trim().toLowerCase() : '';

  if (isHistoryFavorite(t)) {
    throw new Error('Cannot delete a favourite ticker');
  }

  let queriesDeleted = 0;
  let adhocDeleted = 0;
  let researchDeleted = 0;

  if (!tabKey || tabKey === 'adhoc') {
    const stmt = db.prepare('DELETE FROM adhoc_queries WHERE ticker=?');
    const info = stmt.run(t);
    adhocDeleted = Number(info?.changes || 0);
  }

  if (!tabKey || tabKey === 'research') {
    const stmt = db.prepare('DELETE FROM research_items WHERE ticker=?');
    const info = stmt.run(t);
    researchDeleted = Number(info?.changes || 0);
  }

  if (!tabKey || (tabKey !== 'adhoc' && tabKey !== 'research')) {
    if (tabKey) {
      const stmt = db.prepare('DELETE FROM queries WHERE tab=? AND ticker=?');
      const info = stmt.run(tabKey, t);
      queriesDeleted = Number(info?.changes || 0);
    } else {
      const stmt = db.prepare('DELETE FROM queries WHERE ticker=?');
      const info = stmt.run(t);
      queriesDeleted = Number(info?.changes || 0);
    }
  }

  return { ticker: t, tab: tabKey || null, queriesDeleted, adhocDeleted, researchDeleted };
}

export function deleteHistoryByTickers({ tickers, tab } = {}) {
  initDb();
  const tabKey = typeof tab === 'string' ? tab.trim().toLowerCase() : '';

  const normalized = Array.isArray(tickers)
    ? tickers
        .map((t) => (typeof t === 'string' ? t.trim().toUpperCase() : ''))
        .filter(Boolean)
    : [];
  const unique = [...new Set(normalized)];
  if (!unique.length) throw new Error('tickers is required');

  const favoriteSet = new Set(
    listFavoriteRowsForTickers(unique)
      .filter((r) => Number(r?.favorite || 0) === 1)
      .map((r) => String(r.ticker).toUpperCase())
  );

  const deletable = unique.filter((t) => !favoriteSet.has(t));
  const favoritesSkipped = [...favoriteSet.values()].sort((a, b) => a.localeCompare(b));

  if (!deletable.length) {
    return {
      tickersRequested: unique.length,
      tickersDeleted: [],
      favoritesSkipped,
      tab: tabKey || null,
      queriesDeleted: 0,
      adhocDeleted: 0,
      researchDeleted: 0
    };
  }

  const placeholders = deletable.map(() => '?').join(',');

  let queriesDeleted = 0;
  let adhocDeleted = 0;
  let researchDeleted = 0;

  db.exec('BEGIN;');
  try {
    if (!tabKey || tabKey === 'adhoc') {
      const stmt = db.prepare(`DELETE FROM adhoc_queries WHERE ticker IN (${placeholders});`);
      const info = stmt.run(...deletable);
      adhocDeleted = Number(info?.changes || 0);
    }

    if (!tabKey || tabKey === 'research') {
      const stmt = db.prepare(`DELETE FROM research_items WHERE ticker IN (${placeholders});`);
      const info = stmt.run(...deletable);
      researchDeleted = Number(info?.changes || 0);
    }

    if (!tabKey || (tabKey !== 'adhoc' && tabKey !== 'research')) {
      if (tabKey) {
        const stmt = db.prepare(`DELETE FROM queries WHERE tab=? AND ticker IN (${placeholders});`);
        const info = stmt.run(tabKey, ...deletable);
        queriesDeleted = Number(info?.changes || 0);
      } else {
        const stmt = db.prepare(`DELETE FROM queries WHERE ticker IN (${placeholders});`);
        const info = stmt.run(...deletable);
        queriesDeleted = Number(info?.changes || 0);
      }
    }

    db.exec('COMMIT;');
  } catch (e) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // ignore
    }
    throw e;
  }

  return {
    tickersRequested: unique.length,
    tickersDeleted: deletable,
    favoritesSkipped,
    tab: tabKey || null,
    queriesDeleted,
    adhocDeleted,
    researchDeleted
  };
}

export function listResearchItems({ ticker, limit = 200 } = {}) {
  initDb();
  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!t) throw new Error('ticker is required');
  const lim = Math.max(1, Math.min(Number(limit) || 200, 500));

  const stmt = db.prepare(
    `SELECT id, ticker, md, created_at AS createdAt, updated_at AS updatedAt
     FROM research_items
     WHERE ticker=?
     ORDER BY updated_at DESC
     LIMIT ?;`
  );
  const rows = stmt.all(t, lim);
  return rows.map((r) => ({
    id: r.id,
    ticker: r.ticker,
    md: r.md,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }));
}

export function createResearchItem({ id, ticker, md } = {}) {
  initDb();
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) throw new Error('id is required');
  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!t) throw new Error('ticker is required');
  const body = typeof md === 'string' ? md : '';
  if (!body.trim()) throw new Error('md is required');

  const ts = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO research_items (id, ticker, md, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?);`
  );
  stmt.run(key, t, body, ts, ts);
  return { id: key, ticker: t, md: body, createdAt: ts, updatedAt: ts };
}

export function updateResearchItem({ id, ticker, md } = {}) {
  initDb();
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) throw new Error('id is required');
  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!t) throw new Error('ticker is required');
  const body = typeof md === 'string' ? md : '';
  if (!body.trim()) throw new Error('md is required');

  const ts = new Date().toISOString();
  const stmt = db.prepare(
    `UPDATE research_items
     SET md=?, updated_at=?
     WHERE id=? AND ticker=?;`
  );
  const result = stmt.run(body, ts, key, t);
  const changes = Number(result?.changes || 0);
  if (changes < 1) return null;

  const stmt2 = db.prepare(
    `SELECT id, ticker, md, created_at AS createdAt, updated_at AS updatedAt
     FROM research_items
     WHERE id=? AND ticker=?;`
  );
  const row = stmt2.get(key, t);
  if (!row) return null;
  return { id: row.id, ticker: row.ticker, md: row.md, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function deleteResearchItem({ id, ticker } = {}) {
  initDb();
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) throw new Error('id is required');
  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  if (!t) throw new Error('ticker is required');

  const stmt = db.prepare('DELETE FROM research_items WHERE id=? AND ticker=?;');
  const result = stmt.run(key, t);
  const changes = Number(result?.changes || 0);
  return { deleted: changes, id: key, ticker: t };
}

export function listResearchTickers({ limit = 5000 } = {}) {
  initDb();
  const lim = Math.max(1, Math.min(Number(limit) || 5000, 20000));
  const stmt = db.prepare(
    `SELECT DISTINCT ticker
     FROM research_items
     ORDER BY ticker ASC
     LIMIT ?;`
  );
  const rows = stmt.all(lim);
  return rows.map((r) => String(r?.ticker || '').trim().toUpperCase()).filter(Boolean);
}

export function listResearchTickersForHistory({ limit = 200 } = {}) {
  initDb();
  const lim = Math.max(1, Math.min(Number(limit) || 200, 5000));
  const stmt = db.prepare(
    `SELECT ticker, MAX(updated_at) AS updatedAt
     FROM research_items
     GROUP BY ticker
     ORDER BY MAX(updated_at) DESC
     LIMIT ?;`
  );
  const rows = stmt.all(lim);
  return rows.map((r) => ({ ticker: r.ticker, updatedAt: r.updatedAt }));
}
