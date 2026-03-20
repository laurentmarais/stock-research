const SEC_DATA_BASE = 'https://data.sec.gov';
const SEC_WWW_BASE = 'https://www.sec.gov';

const DAY_MS = 24 * 60 * 60 * 1000;
const tickerCache = new Map();
const submissionsCache = new Map();

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

function secUserAgent() {
  const ua = typeof process.env.SEC_USER_AGENT === 'string' ? process.env.SEC_USER_AGENT.trim() : '';
  return ua || 'stock-research (local; contact unknown)';
}

function normalizeTicker(input) {
  return typeof input === 'string' ? input.trim().toUpperCase() : '';
}

function formatCik10(cik) {
  return String(cik || '').replace(/\D/g, '').padStart(10, '0');
}

function cikNoLeadingZeros(cik) {
  const digits = String(cik || '').replace(/\D/g, '');
  const n = Number(digits);
  return Number.isFinite(n) ? String(n) : '';
}

function accessionNoDashes(accession) {
  return String(accession || '').replace(/-/g, '');
}

async function secFetch(url, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': secUserAgent(),
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8'
      }
    });
    if (!resp.ok) throw new Error(`SEC fetch failed (${resp.status}) for ${url}`);
    return resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTickerToCik10(symbol) {
  const ticker = normalizeTicker(symbol);
  if (!ticker) throw new Error('ticker is required');

  const cached = getCached(tickerCache, ticker);
  if (cached) return cached;

  const url = `${SEC_WWW_BASE}/files/company_tickers.json`;
  const raw = await secFetch(url);
  let cik = '';
  for (const row of Object.values(raw || {})) {
    const currentTicker = typeof row?.ticker === 'string' ? row.ticker.trim().toUpperCase() : '';
    if (currentTicker !== ticker) continue;
    const currentCik = row?.cik_str;
    cik = typeof currentCik === 'number' ? String(currentCik) : typeof currentCik === 'string' ? currentCik : '';
    break;
  }

  if (!cik) throw new Error(`Failed to resolve CIK for ${ticker}`);

  const normalized = formatCik10(cik);
  setCached(tickerCache, ticker, normalized);
  return normalized;
}

async function fetchSubmissions(cik10) {
  const normalized = formatCik10(cik10);
  const cacheKey = `submissions:${normalized}`;
  const cached = getCached(submissionsCache, cacheKey, 20 * 60 * 1000);
  if (cached) return cached;

  const url = `${SEC_DATA_BASE}/submissions/CIK${normalized}.json`;
  const data = await secFetch(url);
  setCached(submissionsCache, cacheKey, data, 20 * 60 * 1000);
  return data;
}

function buildFilingLinks({ cik10, accession, primaryDocument }) {
  const cik = cikNoLeadingZeros(cik10);
  const accessionCompact = accessionNoDashes(accession);
  const accessionDashed = String(accession || '').trim();
  const document = String(primaryDocument || '').trim();

  return {
    indexUrl: cik && accessionCompact && accessionDashed ? `${SEC_WWW_BASE}/Archives/edgar/data/${cik}/${accessionCompact}/${accessionDashed}-index.html` : '',
    filingUrl: cik && accessionCompact && document ? `${SEC_WWW_BASE}/Archives/edgar/data/${cik}/${accessionCompact}/${document}` : ''
  };
}

export function createSecFilingsService() {
  return {
    async getRecentFilings({ ticker, cik, limit = 10, forms } = {}) {
      const normalizedTicker = normalizeTicker(ticker);
      if (!normalizedTicker) throw new Error('ticker is required');

      const normalizedCik = cik ? formatCik10(cik) : await resolveTickerToCik10(normalizedTicker);
      const submissions = await fetchSubmissions(normalizedCik);
      const recent = submissions?.filings?.recent || {};
      const wantedForms = Array.isArray(forms) && forms.length
        ? new Set(forms.map((form) => String(form || '').trim().toUpperCase()).filter(Boolean))
        : null;

      const output = [];
      const total = Math.min(Array.isArray(recent.form) ? recent.form.length : 0, 200);
      for (let index = 0; index < total; index += 1) {
        const form = typeof recent.form?.[index] === 'string' ? recent.form[index].trim().toUpperCase() : '';
        if (!form) continue;
        if (wantedForms && !wantedForms.has(form)) continue;

        const accessionNumber = typeof recent.accessionNumber?.[index] === 'string' ? recent.accessionNumber[index].trim() : '';
        const filingDate = typeof recent.filingDate?.[index] === 'string' ? recent.filingDate[index].trim() : '';
        const reportDate = typeof recent.reportDate?.[index] === 'string' ? recent.reportDate[index].trim() : '';
        const primaryDocument = typeof recent.primaryDocument?.[index] === 'string' ? recent.primaryDocument[index].trim() : '';
        const title = typeof recent.primaryDocDescription?.[index] === 'string' ? recent.primaryDocDescription[index].trim() : '';
        if (!accessionNumber || !filingDate) continue;

        output.push({
          form,
          filingDate,
          reportDate: reportDate || '',
          accessionNumber,
          primaryDocument: primaryDocument || '',
          title: title || '',
          ...buildFilingLinks({ cik10: normalizedCik, accession: accessionNumber, primaryDocument })
        });

        if (output.length >= Math.max(1, Math.min(Number(limit) || 10, 50))) break;
      }

      return {
        ticker: normalizedTicker,
        cik: normalizedCik,
        sources: {
          submissionsUrl: `${SEC_DATA_BASE}/submissions/CIK${normalizedCik}.json`,
          secBrowseUrl: `${SEC_WWW_BASE}/edgar/browse/?CIK=${encodeURIComponent(normalizedCik)}`
        },
        filings: output
      };
    }
  };
}