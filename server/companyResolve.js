import { getCompanyOverride } from './db.js';

const SEC_EXCHANGE_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';

const DAY_MS = 24 * 60 * 60 * 1000;
const secCache = new Map();
const stockAnalysisCache = new Map();

function secUserAgent() {
  const ua = String(process.env.SEC_USER_AGENT || '').trim();
  return ua || 'stock-research (local; contact unknown)';
}

function normalizeTickerLoose(ticker) {
  return typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
}

function getCached(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(map, key, value, ttlMs = DAY_MS) {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': secUserAgent(),
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8'
    }
  });
  if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
  return resp.json().catch(() => null);
}

async function fetchTextWithTimeout(url, { timeoutMs = 9000, headers } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': secUserAgent(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(headers || {})
      }
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    return text.length > 300000 ? text.slice(0, 300000) : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSecExchangeFile() {
  const cached = getCached(secCache, 'sec_exchange');
  if (cached) return cached;

  const json = await fetchJson(SEC_EXCHANGE_URL);
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  const byTicker = new Map();

  for (const row of rows) {
    const ticker = normalizeTickerLoose(row?.ticker);
    if (!ticker) continue;
    const cikNum = row?.cik;
    byTicker.set(ticker, {
      ticker,
      name: typeof row?.title === 'string' ? row.title.trim() : '',
      exchange: typeof row?.exchange === 'string' ? row.exchange.trim() : '',
      cik: typeof cikNum === 'number' && Number.isFinite(cikNum) ? String(Math.trunc(cikNum)).padStart(10, '0') : ''
    });
  }

  const payload = { byTicker };
  setCached(secCache, 'sec_exchange', payload);
  return payload;
}

async function fetchSecTickersFile() {
  const cached = getCached(secCache, 'sec_tickers');
  if (cached) return cached;

  const json = await fetchJson(SEC_TICKERS_URL);
  const byTicker = new Map();
  for (const value of Object.values(json || {})) {
    const ticker = normalizeTickerLoose(value?.ticker);
    if (!ticker) continue;
    const cikValue = value?.cik_str;
    const cik = typeof cikValue === 'number'
      ? String(Math.trunc(cikValue)).padStart(10, '0')
      : typeof cikValue === 'string' && cikValue.trim()
        ? String(cikValue).replace(/\D/g, '').padStart(10, '0')
        : '';
    if (!cik) continue;
    byTicker.set(ticker, { ticker, cik });
  }

  const payload = { byTicker };
  setCached(secCache, 'sec_tickers', payload);
  return payload;
}

async function resolveFromSec(ticker) {
  const { byTicker } = await fetchSecExchangeFile();
  const hit = byTicker.get(ticker);
  if (!hit || !hit.name) return null;
  return {
    ticker,
    name: hit.name,
    exchange: hit.exchange || '',
    cik: hit.cik || '',
    resolvedVia: 'sec',
    sources: [SEC_EXCHANGE_URL]
  };
}

async function resolveCikFallback(ticker, base) {
  if (base?.cik) return base;
  const { byTicker } = await fetchSecTickersFile();
  const hit = byTicker.get(ticker);
  if (!hit?.cik) return base;
  return {
    ticker,
    name: base?.name || '',
    exchange: base?.exchange || '',
    cik: hit.cik,
    resolvedVia: base?.resolvedVia || 'sec-cik',
    sources: [...new Set([...(base?.sources || []), SEC_TICKERS_URL])]
  };
}

async function resolveFromYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const payload = await resp.json().catch(() => null);
  const hit = payload?.quoteResponse?.result?.[0];
  if (!hit) return null;

  const name = String(hit?.longName || hit?.shortName || hit?.displayName || '').trim();
  if (!name) return null;

  return {
    ticker,
    name,
    exchange: String(hit?.fullExchangeName || hit?.exchange || '').trim(),
    cik: '',
    resolvedVia: 'yahoo',
    sources: [`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`]
  };
}

function extractStockAnalysisCompanyName(html) {
  if (typeof html !== 'string' || !html) return '';

  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const type = String(item['@type'] || '').toLowerCase();
        if (type !== 'corporation' && type !== 'organization') continue;
        const legalName = typeof item.legalName === 'string' ? item.legalName.trim() : '';
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (legalName || name) return legalName || name;
      }
    } catch {
      // ignore parse errors
    }
  }

  const meta = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
  const content = meta?.[1] ? String(meta[1]) : '';
  const nameMatch = content.match(/overview of\s+([^()]+)\s*\(/i);
  return nameMatch?.[1] ? nameMatch[1].trim() : '';
}

async function resolveFromStockAnalysis(ticker) {
  const cacheKey = `sa:${ticker}`;
  const cached = getCached(stockAnalysisCache, cacheKey);
  if (cached) return cached;

  const url = `https://stockanalysis.com/stocks/${encodeURIComponent(ticker.toLowerCase())}/`;
  const html = await fetchTextWithTimeout(url);
  if (!html) return null;
  const name = extractStockAnalysisCompanyName(html);
  if (!name) return null;

  const payload = {
    ticker,
    name,
    exchange: '',
    cik: '',
    resolvedVia: 'stockanalysis',
    sources: [url]
  };
  setCached(stockAnalysisCache, cacheKey, payload);
  return payload;
}

export async function resolveCompany({ ticker }) {
  const normalized = normalizeTickerLoose(ticker);
  if (!normalized) throw new Error('ticker is required');

  let override = null;
  try {
    override = getCompanyOverride(normalized);
  } catch {
    override = null;
  }

  let base = null;

  try {
    base = await resolveFromSec(normalized);
  } catch {
    base = null;
  }

  if (!base) {
    try {
      base = await resolveFromYahoo(normalized);
    } catch {
      base = null;
    }
  }

  if (!base) {
    try {
      base = await resolveFromStockAnalysis(normalized);
    } catch {
      base = null;
    }
  }

  try {
    base = await resolveCikFallback(normalized, base);
  } catch {
    // keep base
  }

  if (override) {
    return {
      ticker: normalized,
      name: override.name || base?.name || '',
      exchange: override.exchange || base?.exchange || '',
      cik: override.cik || base?.cik || '',
      resolvedVia: 'override',
      sources: base?.sources || []
    };
  }

  if (base) return base;
  return { ticker: normalized, name: '', exchange: '', cik: '', resolvedVia: 'none', sources: [] };
}