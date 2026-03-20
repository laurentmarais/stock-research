const QUOTE_CACHE_MS = 5 * 60 * 1000;
const quoteCache = new Map();
const marketFallbackCache = new Map();

const FRED_BASE_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=';
const STOOQ_DAILY_URL = 'https://stooq.com/q/d/l/?i=d&s=';

function getCached(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(map, key, value, ttlMs) {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function fetchText(url) {
  const resp = await fetch(url, {
    headers: {
      Accept: 'text/plain,text/csv;q=0.9,*/*;q=0.8'
    }
  });
  if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
  return resp.text();
}

function quoteUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function formatNumber(value, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function formatLargeNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return `${Math.round(value)}`;
}

async function fetchYahooQuotes(symbols) {
  const list = Array.isArray(symbols)
    ? [...new Set(symbols.map((symbol) => String(symbol || '').trim()).filter(Boolean))]
    : [];
  if (!list.length) return [];

  const cacheKey = list.join(',');
  const cached = getCached(quoteCache, cacheKey);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(list.join(','))}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const error = new Error(`Yahoo quote fetch failed (${resp.status})`);
    error.status = resp.status;
    throw error;
  }
  const payload = await resp.json().catch(() => ({}));
  const rows = Array.isArray(payload?.quoteResponse?.result) ? payload.quoteResponse.result : [];
  setCached(quoteCache, cacheKey, rows, QUOTE_CACHE_MS);
  return rows;
}

function parseCsvRows(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function fetchStooqDailySnapshot(symbol) {
  const normalized = String(symbol || '').trim().toLowerCase();
  if (!normalized) throw new Error('stooq symbol is required');
  const cacheKey = `stooq:${normalized}`;
  const cached = getCached(marketFallbackCache, cacheKey);
  if (cached) return cached;

  const text = await fetchText(`${STOOQ_DAILY_URL}${encodeURIComponent(normalized)}`);
  const rows = parseCsvRows(text);
  if (rows.length < 3) throw new Error('Stooq returned insufficient rows');

  const parseRow = (line) => {
    const [date, open, high, low, close] = line.split(',');
    const closeValue = Number(close);
    return {
      date: String(date || '').trim(),
      close: Number.isFinite(closeValue) ? closeValue : null,
      open: Number.isFinite(Number(open)) ? Number(open) : null,
      high: Number.isFinite(Number(high)) ? Number(high) : null,
      low: Number.isFinite(Number(low)) ? Number(low) : null
    };
  };

  const latest = parseRow(rows[rows.length - 1]);
  const prior = parseRow(rows[rows.length - 2]);
  if (!Number.isFinite(latest.close)) throw new Error('Stooq latest close missing');
  const changePct = Number.isFinite(prior.close) && prior.close !== 0
    ? ((latest.close - prior.close) / prior.close) * 100
    : null;

  const result = {
    price: latest.close,
    changePct,
    asOf: latest.date,
    source: `${STOOQ_DAILY_URL}${encodeURIComponent(normalized)}`,
    marketState: 'historical-close'
  };
  setCached(marketFallbackCache, cacheKey, result, QUOTE_CACHE_MS);
  return result;
}

async function fetchFredLatestValue(seriesId) {
  const normalized = String(seriesId || '').trim().toUpperCase();
  if (!normalized) throw new Error('FRED seriesId is required');
  const cacheKey = `fred:${normalized}`;
  const cached = getCached(marketFallbackCache, cacheKey);
  if (cached) return cached;

  const text = await fetchText(`${FRED_BASE_URL}${encodeURIComponent(normalized)}`);
  const rows = parseCsvRows(text).slice(1);
  const values = rows
    .map((line) => {
      const [date, value] = line.split(',');
      const parsed = Number(value);
      return {
        date: String(date || '').trim(),
        value: Number.isFinite(parsed) ? parsed : null
      };
    })
    .filter((row) => Number.isFinite(row.value));

  if (values.length < 1) throw new Error('FRED returned no numeric values');
  const latest = values[values.length - 1];
  const prior = values.length > 1 ? values[values.length - 2] : null;
  const changePct = prior && Number.isFinite(prior.value) && prior.value !== 0
    ? ((latest.value - prior.value) / prior.value) * 100
    : null;

  const result = {
    price: latest.value,
    changePct,
    asOf: latest.date,
    source: `${FRED_BASE_URL}${encodeURIComponent(normalized)}`,
    marketState: 'historical-series'
  };
  setCached(marketFallbackCache, cacheKey, result, QUOTE_CACHE_MS);
  return result;
}

async function fetchMarketProxyFallback(proxy) {
  if (proxy?.fallback?.kind === 'stooq') {
    return fetchStooqDailySnapshot(proxy.fallback.symbol);
  }
  if (proxy?.fallback?.kind === 'fred') {
    return fetchFredLatestValue(proxy.fallback.seriesId);
  }
  throw new Error('No fallback configured');
}

export async function buildMarketSourceContext() {
  const proxies = [
    { symbol: '^GSPC', label: 'S&P 500', fallback: { kind: 'stooq', symbol: 'spy.us' } },
    { symbol: '^IXIC', label: 'Nasdaq Composite', fallback: { kind: 'stooq', symbol: 'qqq.us' } },
    { symbol: '^DJI', label: 'Dow Jones Industrial Average', fallback: { kind: 'stooq', symbol: 'dia.us' } },
    { symbol: '^TNX', label: 'US 10Y Treasury Yield', fallback: { kind: 'fred', seriesId: 'DGS10' } },
    { symbol: 'CL=F', label: 'WTI Crude Oil', fallback: { kind: 'fred', seriesId: 'DCOILWTICO' } },
    { symbol: 'GC=F', label: 'Gold Proxy ETF', fallback: { kind: 'stooq', symbol: 'gld.us' } },
    { symbol: 'XLE', label: 'Energy Sector ETF', fallback: { kind: 'stooq', symbol: 'xle.us' } },
    { symbol: 'XLF', label: 'Financials Sector ETF', fallback: { kind: 'stooq', symbol: 'xlf.us' } },
    { symbol: 'XLK', label: 'Technology Sector ETF', fallback: { kind: 'stooq', symbol: 'xlk.us' } },
    { symbol: 'XLV', label: 'Healthcare Sector ETF', fallback: { kind: 'stooq', symbol: 'xlv.us' } },
    { symbol: 'ITA', label: 'Aerospace & Defense ETF', fallback: { kind: 'stooq', symbol: 'ita.us' } }
  ];

  const lines = [`Server-fetched market proxy snapshot from Yahoo Finance quote API (${new Date().toISOString()}):`];
  const sources = [];

  let bySymbol = new Map();
  try {
    const rows = await fetchYahooQuotes(proxies.map((proxy) => proxy.symbol));
    bySymbol = new Map(rows.map((row) => [String(row?.symbol || '').trim().toUpperCase(), row]));
  } catch (error) {
    lines.push(`- Yahoo market proxy snapshot unavailable (${error instanceof Error ? error.message : 'request failed'}). Falling back to alternate public market data sources where possible.`);
  }

  for (const proxy of proxies) {
    let price = null;
    let changePct = null;
    let state = 'unknown';
    let sourceUrl = quoteUrl(proxy.symbol);

    const row = bySymbol.get(proxy.symbol.toUpperCase());
    if (row) {
      price = row?.regularMarketPrice;
      changePct = row?.regularMarketChangePercent;
      state = row?.marketState || row?.exchange || 'yahoo-quote';
    } else {
      try {
        const fallback = await fetchMarketProxyFallback(proxy);
        price = fallback.price;
        changePct = fallback.changePct;
        state = `${fallback.marketState} asOf=${fallback.asOf}`;
        sourceUrl = fallback.source;
      } catch (error) {
        state = `unavailable (${error instanceof Error ? error.message : 'request failed'})`;
      }
    }

    sources.push(sourceUrl);
    lines.push(`- ${proxy.label} (${proxy.symbol}): price=${formatNumber(price)} changePct=${formatNumber(changePct)} marketState=${state} source=${sourceUrl}`);
  }

  return {
    text: lines.join('\n'),
    sources: [...new Set(sources)]
  };
}

export async function buildTickerSourceContext({ ticker, company, secFilingsService }) {
  const normalizedTicker = String(ticker || '').trim().toUpperCase();
  let quote = null;
  const lines = [`Server-fetched ticker context for ${normalizedTicker} (${new Date().toISOString()}):`];
  const sources = [];

  try {
    const rows = await fetchYahooQuotes([normalizedTicker]);
    quote = rows[0] || null;
  } catch (error) {
    lines.push(`- Yahoo quote snapshot unavailable (${error instanceof Error ? error.message : 'request failed'}).`);
  }

  if (quote) {
    const yahooUrl = quoteUrl(normalizedTicker);
    sources.push(yahooUrl);
    lines.push(
      `- Yahoo quote: price=${formatNumber(quote?.regularMarketPrice)} changePct=${formatNumber(quote?.regularMarketChangePercent)} marketCap=${formatLargeNumber(quote?.marketCap)} volume=${formatLargeNumber(quote?.regularMarketVolume)} avgVolume=${formatLargeNumber(quote?.averageDailyVolume3Month)} source=${yahooUrl}`
    );
  }

  if (Array.isArray(company?.sources)) {
    for (const source of company.sources) {
      if (typeof source === 'string' && source.trim()) sources.push(source.trim());
    }
  }

  if (company?.cik && secFilingsService) {
    try {
      const filingsPack = await secFilingsService.getRecentFilings({
        ticker: normalizedTicker,
        cik: company.cik,
        limit: 8,
        forms: ['10-K', '10-Q', '8-K', '20-F', '6-K', 'DEF 14A', 'S-3', 'S-1', '424B5']
      });

      if (filingsPack?.sources?.submissionsUrl) sources.push(filingsPack.sources.submissionsUrl);
      if (filingsPack?.sources?.secBrowseUrl) sources.push(filingsPack.sources.secBrowseUrl);

      lines.push('Recent SEC filings (server-fetched):');
      for (const filing of filingsPack?.filings || []) {
        const url = filing?.filingUrl || filing?.indexUrl || '';
        if (url) sources.push(url);
        lines.push(`- ${filing?.filingDate || 'n/a'} ${filing?.form || 'n/a'} ${filing?.title || ''} ${url ? `source=${url}` : ''}`.trim());
      }
    } catch {
      lines.push('Recent SEC filings: unavailable');
    }
  }

  return {
    text: lines.join('\n'),
    sources: [...new Set(sources)]
  };
}