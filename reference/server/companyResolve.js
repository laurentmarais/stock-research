import { createTtlCache } from './ttlCache.js';
import { getCompanyOverride } from './db.js';

const SEC_EXCHANGE_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';

const secCache = createTtlCache({ ttlMs: 24 * 60 * 60 * 1000 });
const stockAnalysisCache = createTtlCache({ ttlMs: 24 * 60 * 60 * 1000 });

function secUserAgent() {
  const ua = String(process.env.SEC_USER_AGENT || '').trim();
  // SEC asks for a descriptive User-Agent.
  return ua || 'MarketMind (local dev; contact: unknown)';
}

function normalizeTickerLoose(ticker) {
  return typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
}

async function fetchTextWithTimeout(url, { timeoutMs = 8000, headers } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
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
    return text.length > 300_000 ? text.slice(0, 300_000) : text;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractStockAnalysisCompanyName(html) {
  if (typeof html !== 'string' || !html) return '';

  // Prefer JSON-LD Corporation block.
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    try {
      const json = JSON.parse(raw);
      const arr = Array.isArray(json) ? json : [json];
      for (const it of arr) {
        if (!it || typeof it !== 'object') continue;
        const type = String(it['@type'] || '').toLowerCase();
        if (type !== 'corporation' && type !== 'organization') continue;
        const legal = typeof it.legalName === 'string' ? it.legalName.trim() : '';
        const name = typeof it.name === 'string' ? it.name.trim() : '';
        const out = legal || name;
        if (out) return out;
      }
    } catch {
      // ignore JSON parse errors
    }
  }

  // Fallback: meta description often includes "<Company>, Inc. (TICKER)".
  const md = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
  const content = md && md[1] ? String(md[1]) : '';
  const m2 = content.match(/overview of\s+([^()]+)\s*\(/i);
  return m2 && m2[1] ? m2[1].trim() : '';
}

async function resolveFromStockAnalysis(ticker) {
  const t = normalizeTickerLoose(ticker);
  if (!t) return null;

  const cached = stockAnalysisCache.get(`sa:${t}`);
  if (cached) return cached;

  const url = `https://stockanalysis.com/stocks/${encodeURIComponent(t.toLowerCase())}/`;
  const html = await fetchTextWithTimeout(url, { timeoutMs: 9000 });
  if (!html) return null;

  const name = extractStockAnalysisCompanyName(html);
  if (!name) return null;

  const payload = {
    ticker: t,
    name,
    exchange: null,
    cik: null,
    resolvedVia: 'stockanalysis',
    sources: [url]
  };
  stockAnalysisCache.set(`sa:${t}`, payload);
  return payload;
}

async function fetchSecExchangeFile() {
  const cached = secCache.get('sec_exchange');
  if (cached) return cached;

  const resp = await fetch(SEC_EXCHANGE_URL, {
    headers: {
      'User-Agent': secUserAgent(),
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8'
    }
  });

  if (!resp.ok) {
    throw new Error(`SEC tickers exchange fetch failed (${resp.status})`);
  }

  const json = await resp.json();
  const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
  if (!arr) throw new Error('SEC tickers exchange JSON shape unexpected');

  /** @type {Map<string, {ticker: string, name: string, exchange: string|null, cik: string|null}>} */
  const byTicker = new Map();
  for (const row of arr) {
    const t = normalizeTickerLoose(row?.ticker);
    if (!t) continue;
    const name = typeof row?.title === 'string' ? row.title.trim() : '';
    const exchange = typeof row?.exchange === 'string' ? row.exchange.trim() : '';
    const cikNum = row?.cik;
    const cik = typeof cikNum === 'number' && Number.isFinite(cikNum) ? String(Math.trunc(cikNum)).padStart(10, '0') : null;
    byTicker.set(t, { ticker: t, name, exchange: exchange || null, cik });
  }

  const payload = { byTicker, fetchedAt: new Date().toISOString() };
  secCache.set('sec_exchange', payload);
  return payload;
}

async function fetchSecTickersFile() {
  const cached = secCache.get('sec_tickers');
  if (cached) return cached;

  const resp = await fetch(SEC_TICKERS_URL, {
    headers: {
      'User-Agent': secUserAgent(),
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8'
    }
  });

  if (!resp.ok) {
    throw new Error(`SEC tickers fetch failed (${resp.status})`);
  }

  const json = await resp.json().catch(() => null);
  if (!json || typeof json !== 'object') throw new Error('SEC tickers JSON shape unexpected');

  /** @type {Map<string, {ticker: string, cik: string}>} */
  const byTicker = new Map();
  for (const key of Object.keys(json)) {
    const row = json[key];
    const t = normalizeTickerLoose(row?.ticker);
    if (!t) continue;
    const cikNum = row?.cik_str;
    const cik =
      typeof cikNum === 'number' && Number.isFinite(cikNum)
        ? String(Math.trunc(cikNum)).padStart(10, '0')
        : typeof cikNum === 'string' && cikNum.trim()
          ? String(cikNum).replace(/\D/g, '').padStart(10, '0')
          : '';
    if (!cik) continue;
    byTicker.set(t, { ticker: t, cik });
  }

  const payload = { byTicker, fetchedAt: new Date().toISOString() };
  secCache.set('sec_tickers', payload);
  return payload;
}

async function resolveFromYahooQuote(ticker) {
  const t = normalizeTickerLoose(ticker);
  if (!t) return null;

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(t)}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;

  const json = await resp.json().catch(() => null);
  const q = json?.quoteResponse?.result?.[0];
  if (!q) return null;

  const name =
    (typeof q.longName === 'string' && q.longName.trim()) ||
    (typeof q.shortName === 'string' && q.shortName.trim()) ||
    (typeof q.displayName === 'string' && q.displayName.trim()) ||
    '';

  if (!name) return null;

  const exchange =
    (typeof q.fullExchangeName === 'string' && q.fullExchangeName.trim()) ||
    (typeof q.exchange === 'string' && q.exchange.trim()) ||
    null;

  return {
    ticker: t,
    name,
    exchange,
    cik: null,
    resolvedVia: 'yahoo',
    sources: [`https://finance.yahoo.com/quote/${encodeURIComponent(t)}`]
  };
}

export async function resolveCompany({ ticker }) {
  const t = normalizeTickerLoose(ticker);
  if (!t) throw new Error('ticker is required');

  // 0) Read manual override (highest priority for fields it sets), but do not short-circuit.
  // Reason: an override that only sets name should still be allowed to inherit SEC-derived CIK/exchange
  // so downstream flows (e.g., SEC filings) don't incorrectly conclude there are no filings.
  /** @type {{ticker: string, name: string, exchange: string|null, cik: string|null}|null} */
  let override = null;
  try {
    const o = getCompanyOverride(t);
    if (o && o.name) {
      override = {
        ticker: t,
        name: o.name,
        exchange: o.exchange ?? null,
        cik: o.cik ?? null
      };
    }
  } catch {
    // ignore override read errors
  }

  /** @type {{ticker: string, name: string, exchange: string|null, cik: string|null, resolvedVia: string, sources: string[]}|null} */
  let base = null;

  // 1) SEC file (best for US-listed tickers).
  try {
    const { byTicker } = await fetchSecExchangeFile();
    const hit = byTicker.get(t);
    if (hit && hit.name) {
      base = {
        ticker: hit.ticker,
        name: hit.name,
        exchange: hit.exchange,
        cik: hit.cik,
        resolvedVia: 'sec',
        sources: [SEC_EXCHANGE_URL]
      };
    }
  } catch {
    // fallthrough
  }

  // 2) Yahoo quote fallback.
  if (!base) {
    try {
      const yahoo = await resolveFromYahooQuote(t);
      if (yahoo) base = yahoo;
    } catch {
      // fallthrough
    }
  }

  // 3) StockAnalysis HTML fallback.
  if (!base) {
    try {
      const sa = await resolveFromStockAnalysis(t);
      if (sa) base = sa;
    } catch {
      // fallthrough
    }
  }

  // 3b) If we still don't have a CIK, try SEC's ticker->CIK file (no exchange info, but good for filings).
  if (!base?.cik) {
    try {
      const { byTicker } = await fetchSecTickersFile();
      const hit = byTicker.get(t);
      if (hit?.cik) {
        base = {
          ticker: t,
          name: base?.name || '',
          exchange: base?.exchange ?? null,
          cik: hit.cik,
          resolvedVia: base?.resolvedVia || 'sec',
          sources: Array.from(new Set([...(base?.sources || []), SEC_TICKERS_URL]))
        };
      }
    } catch {
      // optional
    }
  }

  // 4) Merge override on top of base (override wins where specified).
  if (override) {
    return {
      ticker: t,
      name: override.name || base?.name || '',
      exchange: override.exchange ?? base?.exchange ?? null,
      cik: override.cik ?? base?.cik ?? null,
      resolvedVia: 'override',
      sources: base?.sources || []
    };
  }

  if (base) return base;

  // 5) Unknown.
  return { ticker: t, name: '', exchange: null, cik: null, resolvedVia: 'none', sources: [] };
}
