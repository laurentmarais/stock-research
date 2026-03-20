import { createTtlCache } from './ttlCache.js';
import { normalizeTicker } from './validate.js';

const SEC_DATA_BASE = 'https://data.sec.gov';
const SEC_WWW_BASE = 'https://www.sec.gov';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCik10(cik) {
  const digits = String(cik || '').replace(/\D/g, '');
  return digits.padStart(10, '0');
}

function cikNoLeadingZeros(cik) {
  const digits = String(cik || '').replace(/\D/g, '');
  const n = Number(digits);
  if (!Number.isFinite(n)) return '';
  return String(n);
}

function accessionNoDashes(accession) {
  return String(accession || '').replace(/-/g, '');
}

function normalizeSecUserAgent() {
  const env = typeof process.env.SEC_USER_AGENT === 'string' ? process.env.SEC_USER_AGENT.trim() : '';
  if (env) return env;
  return 'marketmind/0.1 (SEC research; set SEC_USER_AGENT env with contact email)';
}

export function createSecFilingsService() {
  const tickerCikCache = createTtlCache({ ttlMs: 24 * 60 * 60 * 1000 });
  const submissionsCache = createTtlCache({ ttlMs: 20 * 60 * 1000 });

  let lastSecFetchAt = 0;

  async function secFetch(url, { timeoutMs = 20000, responseType = 'json' } = {}) {
    const headers = {
      'User-Agent': normalizeSecUserAgent(),
      Accept: responseType === 'json' ? 'application/json' : 'text/plain,*/*;q=0.8'
    };

    const now = Date.now();
    const delta = now - lastSecFetchAt;
    if (delta < 200) await sleep(200 - delta);
    lastSecFetchAt = Date.now();

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { headers, signal: controller.signal });
      if (!resp.ok) {
        throw new Error(`SEC fetch failed (${resp.status}) for ${url}`);
      }
      if (responseType === 'json') return await resp.json();
      return await resp.text();
    } finally {
      clearTimeout(t);
    }
  }

  async function resolveTickerToCik10(symbol) {
    const ticker = normalizeTicker(symbol);
    if (!ticker) throw new Error('ticker is required');

    const cached = tickerCikCache.get(ticker);
    if (cached) return cached;

    // SEC file contains thousands of tickers; cache in memory for a day.
    const url = `${SEC_WWW_BASE}/files/company_tickers.json`;
    const raw = await secFetch(url, { responseType: 'json', timeoutMs: 20000 });

    let cik = '';
    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(raw)) {
        const row = raw[key];
        const t = typeof row?.ticker === 'string' ? row.ticker.trim().toUpperCase() : '';
        if (t !== ticker) continue;
        const c = row?.cik_str;
        cik = typeof c === 'number' ? String(c) : typeof c === 'string' ? c : '';
        break;
      }
    }

    if (!cik) throw new Error(`Failed to resolve CIK for ${ticker}`);

    const normalized = formatCik10(cik);
    tickerCikCache.set(ticker, normalized);
    return normalized;
  }

  async function fetchSubmissions(cik10) {
    const cik = formatCik10(cik10);
    const key = `submissions:${cik}`;
    const cached = submissionsCache.get(key);
    if (cached) return cached;

    const url = `${SEC_DATA_BASE}/submissions/CIK${cik}.json`;
    const data = await secFetch(url, { responseType: 'json', timeoutMs: 20000 });
    submissionsCache.set(key, data);
    return data;
  }

  function buildFilingLinks({ cik10, accession, primaryDocument }) {
    const cikNoZ = cikNoLeadingZeros(cik10);
    const accNoDash = accessionNoDashes(accession);
    const accDash = String(accession || '').trim();
    const doc = String(primaryDocument || '').trim();

    const indexUrl = cikNoZ && accNoDash && accDash ? `${SEC_WWW_BASE}/Archives/edgar/data/${cikNoZ}/${accNoDash}/${accDash}-index.html` : '';
    const filingUrl = cikNoZ && accNoDash && doc ? `${SEC_WWW_BASE}/Archives/edgar/data/${cikNoZ}/${accNoDash}/${doc}` : '';

    return { indexUrl: indexUrl || null, filingUrl: filingUrl || null };
  }

  async function getRecentFilings({ ticker, cik, limit = 25, forms } = {}) {
    const symbol = normalizeTicker(ticker);
    if (!symbol) throw new Error('ticker is required');

    const wantForms = Array.isArray(forms) && forms.length ? new Set(forms.map((f) => String(f || '').trim().toUpperCase()).filter(Boolean)) : null;

    const cik10 = cik ? formatCik10(cik) : await resolveTickerToCik10(symbol);

    const warnings = [];
    if (!process.env.SEC_USER_AGENT || !String(process.env.SEC_USER_AGENT).trim()) {
      warnings.push('SEC_USER_AGENT is not set; set it to a descriptive value with contact email to comply with SEC guidance.');
    }

    const submissions = await fetchSubmissions(cik10);
    const recent = submissions?.filings?.recent;

    const formsArr = Array.isArray(recent?.form) ? recent.form : [];
    const accessionNumbers = Array.isArray(recent?.accessionNumber) ? recent.accessionNumber : [];
    const filingDates = Array.isArray(recent?.filingDate) ? recent.filingDate : [];
    const reportDates = Array.isArray(recent?.reportDate) ? recent.reportDate : [];
    const primaryDocs = Array.isArray(recent?.primaryDocument) ? recent.primaryDocument : [];
    const primaryDescs = Array.isArray(recent?.primaryDocDescription) ? recent.primaryDocDescription : [];

    const out = [];
    const max = Math.min(formsArr.length, 200);
    for (let i = 0; i < max; i++) {
      const form = typeof formsArr[i] === 'string' ? formsArr[i].trim().toUpperCase() : '';
      if (!form) continue;
      if (wantForms && !wantForms.has(form)) continue;

      const accession = typeof accessionNumbers[i] === 'string' ? accessionNumbers[i].trim() : '';
      const filingDate = typeof filingDates[i] === 'string' ? filingDates[i].trim() : '';
      const reportDate = typeof reportDates[i] === 'string' ? reportDates[i].trim() : '';
      const primaryDocument = typeof primaryDocs[i] === 'string' ? primaryDocs[i].trim() : '';
      const title = typeof primaryDescs[i] === 'string' ? primaryDescs[i].trim() : '';
      if (!accession || !filingDate) continue;

      const links = buildFilingLinks({ cik10, accession, primaryDocument });
      out.push({
        form,
        filingDate,
        reportDate: reportDate || null,
        accessionNumber: accession,
        primaryDocument: primaryDocument || null,
        title: title || null,
        ...links
      });

      if (out.length >= Math.max(1, Math.min(100, Number(limit) || 25))) break;
    }

    return {
      ticker: symbol,
      cik: formatCik10(cik10),
      sources: {
        submissionsUrl: `${SEC_DATA_BASE}/submissions/CIK${formatCik10(cik10)}.json`,
        secBrowseUrl: `${SEC_WWW_BASE}/edgar/browse/?CIK=${encodeURIComponent(formatCik10(cik10))}`
      },
      warnings,
      filings: out
    };
  }

  return { getRecentFilings };
}
