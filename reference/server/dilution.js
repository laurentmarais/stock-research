import { createTtlCache } from './ttlCache.js';
import { normalizeTicker } from './validate.js';

const SEC_DATA_BASE = 'https://data.sec.gov';
const SEC_WWW_BASE = 'https://www.sec.gov';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(Math.trunc(v), min), max);
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
  // SEC asks for a descriptive UA with contact info. Provide a default but surface a warning to the UI.
  return 'marketmind/0.1 (SEC research; set SEC_USER_AGENT env with contact email)';
}

function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSnippet(text, matchIndex, context = 160) {
  if (typeof text !== 'string' || !text) return '';
  const start = Math.max(0, matchIndex - context);
  const end = Math.min(text.length, matchIndex + context);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + text.slice(start, end).trim() + suffix;
}

function parseUsdAmount(text) {
  // Try to find offering caps like "up to $123.4 million".
  // Intentionally conservative to avoid mislabeling operational figures as offering size.
  if (typeof text !== 'string') return null;

  const re = /up to\s*\$\s*([0-9][0-9,]*\.?[0-9]*)\s*(billion|million|thousand)?/i;
  const m = text.match(re);
  if (!m) return null;

  // Require offering-related context near the match.
  const matchIndex = typeof m.index === 'number' ? m.index : -1;
  if (matchIndex >= 0) {
    const window = text.slice(Math.max(0, matchIndex - 240), Math.min(text.length, matchIndex + 240));
    if (!/(offer|offering|prospectus|registration|shelf|at-?the-?market|sales\s+agreement|distribution\s+agreement)/i.test(window)) {
      return null;
    }
  }

  const raw = m[1];
  const unit = (m[2] || '').toLowerCase();
  const base = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const mult = unit === 'billion' ? 1e9 : unit === 'million' ? 1e6 : unit === 'thousand' ? 1e3 : 1;
  return Math.round(base * mult);

  return null;
}

function bucketFromScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'unknown';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function toEvidenceId({ accession, tag }) {
  const a = String(accession || '').trim();
  const t = String(tag || '').trim();
  return cryptoSafeId(`${a}:${t}`);
}

function cryptoSafeId(s) {
  // small deterministic-ish id (not cryptographic) to keep evidence stable across refreshes.
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `e_${(h >>> 0).toString(16)}`;
}

function selectCompanyFactsSeries(companyFacts) {
  const facts = companyFacts?.facts;
  if (!facts || typeof facts !== 'object') return null;

  const candidates = [
    { group: 'us-gaap', tag: 'CommonStockSharesOutstanding', unit: 'shares' },
    { group: 'dei', tag: 'EntityCommonStockSharesOutstanding', unit: 'shares' }
  ];

  for (const c of candidates) {
    const node = facts?.[c.group]?.[c.tag];
    const series = node?.units?.[c.unit];
    if (Array.isArray(series) && series.length) {
      return { group: c.group, tag: c.tag, unit: c.unit, series };
    }
  }

  return null;
}

function normalizeSharesSeries(series, { maxPoints = 40 } = {}) {
  if (!Array.isArray(series)) return [];
  const normalized = series
    .map((p) => {
      const end = typeof p?.end === 'string' ? p.end : typeof p?.fy === 'number' ? String(p.fy) : '';
      const val = typeof p?.val === 'number' ? p.val : Number(p?.val);
      if (!end || !Number.isFinite(val)) return null;
      const d = new Date(end);
      const t = Number.isNaN(d.getTime()) ? 0 : d.getTime();
      return { end, t, val };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);

  // Remove duplicates by end date, keep last.
  const byEnd = new Map();
  for (const p of normalized) byEnd.set(p.end, p);
  const deduped = Array.from(byEnd.values()).sort((a, b) => a.t - b.t);
  return deduped.slice(-maxPoints).map((p) => ({ date: p.end, shares: Math.round(p.val) }));
}

function classifyFilingSignals(text) {
  const t = typeof text === 'string' ? text : '';

  const has = (re) => re.test(t);

  const signals = {
    shelf: has(/\b(shelf\s+registration|registration\s+statement\s+on\s+form\s+s-3|universal\s+shelf|mixed\s+shelf)\b/i),
    atm: has(/\b(at-the-market|at the market|equity\s+distribution\s+agreement|sales\s+agreement|distribution\s+agreement)\b/i),
    takedown: has(/\b(prospectus\s+supplement|424b5|underwritten\s+offering|public\s+offering)\b/i),
    goingConcern: has(/\b(going\s+concern|substantial\s+doubt\s+about\s+.*?ability\s+to\s+continue)\b/i),
    resale: has(/\b(resale\s+of\s+shares|selling\s+stockholders|selling\s+shareholders)\b/i),
    convert: has(/\b(convertible\s+notes?|notes?\s+convertible|conversion\s+price)\b/i),
    warrants: has(/\b(warrants?)\b/i),
    options: has(/\b(stock\s+options?|equity\s+incentive\s+plan)\b/i),
    authorized: has(/\b(increase\s+the\s+number\s+of\s+authorized\s+shares|authorized\s+shares)\b/i)
  };

  const tags = [];
  if (signals.shelf) tags.push('shelf');
  if (signals.atm) tags.push('atm');
  if (signals.takedown) tags.push('takedown');
  if (signals.resale) tags.push('resale');
  if (signals.goingConcern) tags.push('going_concern');
  if (signals.convert) tags.push('convert');
  if (signals.warrants) tags.push('warrants');
  if (signals.options) tags.push('options');
  if (signals.authorized) tags.push('authorized');

  return { signals, tags };
}

function computeScore({ evidenceItems, sharesSeries }) {
  const evidence = Array.isArray(evidenceItems) ? evidenceItems : [];

  const anyTag = (tag) => evidence.some((e) => Array.isArray(e.tags) && e.tags.includes(tag));
  const recentHas = (tag, days) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return evidence.some((e) => {
      if (!Array.isArray(e.tags) || !e.tags.includes(tag)) return false;
      const d = new Date(e.date);
      const t = Number.isNaN(d.getTime()) ? 0 : d.getTime();
      return t >= cutoff;
    });
  };

  const drivers = [];
  let score = 0;

  // Raise readiness
  if (anyTag('atm')) {
    score += 25;
    drivers.push({ key: 'atm', label: 'ATM / sales agreement language detected', weight: 25 });
  }
  if (anyTag('shelf')) {
    score += 20;
    drivers.push({ key: 'shelf', label: 'Shelf registration language detected', weight: 20 });
  }
  if (anyTag('takedown')) {
    score += 20;
    drivers.push({ key: 'takedown', label: 'Prospectus supplement / offering language detected', weight: 20 });
  }
  if (anyTag('resale')) {
    score += 6;
    drivers.push({ key: 'resale', label: 'Resale registration language detected (overhang)', weight: 6 });
  }
  if (recentHas('shelf', 120)) {
    score += 8;
    drivers.push({ key: 'recent_shelf', label: 'Shelf activity appears recent', weight: 8 });
  }

  // Need-to-raise proxy
  if (anyTag('going_concern')) {
    score += 15;
    drivers.push({ key: 'going_concern', label: 'Going concern / substantial doubt language detected', weight: 15 });
  }

  // Overhang
  if (anyTag('convert')) {
    score += 8;
    drivers.push({ key: 'convert', label: 'Convertible notes language detected', weight: 8 });
  }
  if (anyTag('warrants')) {
    score += 5;
    drivers.push({ key: 'warrants', label: 'Warrant language detected', weight: 5 });
  }
  if (anyTag('options')) {
    score += 3;
    drivers.push({ key: 'options', label: 'Stock option / incentive plan language detected', weight: 3 });
  }
  if (anyTag('authorized')) {
    score += 4;
    drivers.push({ key: 'authorized', label: 'Authorized share language detected', weight: 4 });
  }

  // Share count acceleration proxy (rough)
  if (Array.isArray(sharesSeries) && sharesSeries.length >= 3) {
    const last = sharesSeries[sharesSeries.length - 1]?.shares;
    const prev = sharesSeries[sharesSeries.length - 3]?.shares;
    if (typeof last === 'number' && typeof prev === 'number' && prev > 0) {
      const pct = ((last - prev) / prev) * 100;
      if (pct >= 10) {
        score += 8;
        drivers.push({ key: 'share_growth', label: `Shares outstanding up ~${Math.round(pct)}% vs prior periods`, weight: 8 });
      }
    }
  }

  score = Math.min(Math.max(score, 0), 100);
  drivers.sort((a, b) => b.weight - a.weight);

  return { score, drivers: drivers.slice(0, 5) };
}

export function createDilutionService() {
  const tickerCikCache = createTtlCache({ ttlMs: 24 * 60 * 60 * 1000 });
  const submissionsCache = createTtlCache({ ttlMs: 20 * 60 * 1000 });
  const companyFactsCache = createTtlCache({ ttlMs: 60 * 60 * 1000 });
  const filingDocCache = createTtlCache({ ttlMs: 60 * 60 * 1000 });

  // Basic request pacing for SEC endpoints.
  let lastSecFetchAt = 0;

  async function secFetch(url, { timeoutMs = 15000, responseType = 'json' } = {}) {
    const headers = {
      'User-Agent': normalizeSecUserAgent(),
      Accept: responseType === 'json' ? 'application/json' : 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8'
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
        const msg = `SEC fetch failed (${resp.status}) for ${url}`;
        throw new Error(msg);
      }
      if (responseType === 'json') return await resp.json();
      return await resp.text();
    } finally {
      clearTimeout(t);
    }
  }

  async function resolveTickerToCik(symbol) {
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

    if (!cik) {
      throw new Error(`Failed to resolve CIK for ${ticker}`);
    }

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

  async function fetchCompanyFacts(cik10) {
    const cik = formatCik10(cik10);
    const key = `facts:${cik}`;
    const cached = companyFactsCache.get(key);
    if (cached) return cached;

    const url = `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
    const data = await secFetch(url, { responseType: 'json', timeoutMs: 20000 });
    companyFactsCache.set(key, data);
    return data;
  }

  async function fetchPrimaryFilingDoc({ cik10, accession, primaryDocument }) {
    const cikNoZ = cikNoLeadingZeros(cik10);
    if (!cikNoZ) throw new Error('Invalid CIK');

    const acc = String(accession || '').trim();
    const doc = String(primaryDocument || '').trim();
    if (!acc || !doc) throw new Error('Missing filing document info');

    const key = `doc:${cikNoZ}:${acc}:${doc}`;
    const cached = filingDocCache.get(key);
    if (cached) return cached;

    const accNoDash = accessionNoDashes(acc);
    const url = `${SEC_WWW_BASE}/Archives/edgar/data/${cikNoZ}/${accNoDash}/${doc}`;

    const html = await secFetch(url, { responseType: 'text', timeoutMs: 25000 });
    const text = stripHtml(html);
    filingDocCache.set(key, { url, text });
    return { url, text };
  }

  async function buildEvidence({ ticker, cik10, horizonDays }) {
    const submissions = await fetchSubmissions(cik10);

    const recent = submissions?.filings?.recent;
    const forms = Array.isArray(recent?.form) ? recent.form : [];
    const accessionNumbers = Array.isArray(recent?.accessionNumber) ? recent.accessionNumber : [];
    const filingDates = Array.isArray(recent?.filingDate) ? recent.filingDate : [];
    const primaryDocs = Array.isArray(recent?.primaryDocument) ? recent.primaryDocument : [];
    const primaryDescs = Array.isArray(recent?.primaryDocDescription) ? recent.primaryDocDescription : [];

    const allowedForms = new Set([
      'S-1',
      'S-3',
      'F-1',
      'F-3',
      '424B1',
      '424B3',
      '424B4',
      '424B5',
      '8-K',
      '6-K',
      '10-Q',
      '10-K',
      '20-F',
      'DEF 14A',
      'PRE 14A'
    ]);

    const horizonMs = horizonDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - horizonMs;

    const items = [];
    let fetchedDocs = 0;
    const maxDocsToFetch = 18;

    // Only look at the most recent N entries to keep it fast.
    const max = Math.min(forms.length, 80);
    for (let i = 0; i < max; i++) {
      const form = typeof forms[i] === 'string' ? forms[i].trim().toUpperCase() : '';
      const accession = typeof accessionNumbers[i] === 'string' ? accessionNumbers[i].trim() : '';
      const date = typeof filingDates[i] === 'string' ? filingDates[i].trim() : '';
      const primaryDocument = typeof primaryDocs[i] === 'string' ? primaryDocs[i].trim() : '';
      const title = typeof primaryDescs[i] === 'string' ? primaryDescs[i].trim() : '';
      if (!form || !accession || !date || !primaryDocument) continue;
      if (!allowedForms.has(form)) continue;

      const d = new Date(date);
      const t = Number.isNaN(d.getTime()) ? 0 : d.getTime();
      if (!t) continue;

      // Skip older filings beyond our horizon *unless* they are shelves (we keep some context).
      const includeOlderContext = form === 'S-3' || form === 'F-3' || form === 'S-1' || form === 'F-1';
      if (t < cutoff && !includeOlderContext) continue;

      let docText = '';
      let docUrl = '';
      let tags = [];
      let signals = {};
      let snippet = '';
      let offeringAmountUsd = null;

      if (fetchedDocs < maxDocsToFetch) {
        try {
          const { url, text } = await fetchPrimaryFilingDoc({ cik10, accession, primaryDocument });
          fetchedDocs += 1;
          docText = text;
          docUrl = url;

          const classified = classifyFilingSignals(docText);
          tags = classified.tags;
          signals = classified.signals;

          // Choose a representative snippet.
          const matchers = [
            /at-the-market|at the market|equity\s+distribution\s+agreement|sales\s+agreement|distribution\s+agreement/i,
            /shelf\s+registration|universal\s+shelf|mixed\s+shelf|registration\s+statement\s+on\s+form\s+s-3/i,
            /prospectus\s+supplement|underwritten\s+offering|public\s+offering|424b5/i,
            /going\s+concern|substantial\s+doubt\s+about\s+.*?ability\s+to\s+continue/i,
            /selling\s+stockholders|selling\s+shareholders|resale\s+of\s+shares/i
          ];
          for (const re of matchers) {
            const m = docText.match(re);
            if (m && typeof m.index === 'number') {
              snippet = extractSnippet(docText, m.index);
              break;
            }
          }
          const offeringForm =
            form.startsWith('S-') ||
            form.startsWith('F-') ||
            form.startsWith('424') ||
            form === '8-K' ||
            form === '6-K';
          offeringAmountUsd = offeringForm ? parseUsdAmount(docText) : null;
        } catch (_err) {
          // If we can't fetch the doc, still emit a minimal item.
        }
      }

      // Only include filings that have at least some relevant tag, or are key forms.
      const keyForm = form.startsWith('424') || form === 'S-3' || form === 'F-3' || form === 'S-1' || form === 'F-1';
      if (!tags.length && !keyForm) continue;

      items.push({
        id: toEvidenceId({ accession, tag: 'filing' }),
        ticker,
        cik: formatCik10(cik10),
        date,
        form,
        accession,
        title,
        url: docUrl,
        primaryDocument,
        tags,
        facts: {
          offeringAmountUsd,
          signals
        },
        snippet
      });
    }

    // Newest first.
    items.sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      return tb - ta;
    });

    return { submissionsUrl: `${SEC_DATA_BASE}/submissions/CIK${formatCik10(cik10)}.json`, evidence: items };
  }

  async function getOverview({ ticker, horizonDays = 90 }) {
    const symbol = normalizeTicker(ticker);
    if (!symbol) throw new Error('ticker is required');

    const horizon = clampInt(horizonDays, 7, 365, 90);

    const cik = await resolveTickerToCik(symbol);

    const warnings = [];
    if (!process.env.SEC_USER_AGENT || !String(process.env.SEC_USER_AGENT).trim()) {
      warnings.push('SEC_USER_AGENT is not set; set it to a descriptive value with contact email to comply with SEC guidance.');
    }

    let sharesSeries = [];
    try {
      const facts = await fetchCompanyFacts(cik);
      const seriesNode = selectCompanyFactsSeries(facts);
      if (seriesNode?.series) {
        sharesSeries = normalizeSharesSeries(seriesNode.series, { maxPoints: 40 });
      }
    } catch (_err) {
      // optional
    }

    const { submissionsUrl, evidence } = await buildEvidence({ ticker: symbol, cik10: cik, horizonDays: horizon });

    const { score, drivers } = computeScore({ evidenceItems: evidence, sharesSeries });
    const bucket = bucketFromScore(score);

    const latestShares = sharesSeries.length ? sharesSeries[sharesSeries.length - 1].shares : null;

    const flags = {
      shelfDetected: evidence.some((e) => e.tags.includes('shelf')),
      atmDetected: evidence.some((e) => e.tags.includes('atm')),
      takedownDetected: evidence.some((e) => e.tags.includes('takedown')),
      goingConcernDetected: evidence.some((e) => e.tags.includes('going_concern'))
    };

    // A short deterministic summary (rules-based, evidence-first).
    const summaryParts = [];
    if (flags.atmDetected) summaryParts.push('ATM/sales agreement language detected');
    if (flags.shelfDetected) summaryParts.push('shelf registration language detected');
    if (flags.takedownDetected) summaryParts.push('offering/prospectus supplement language detected');
    if (flags.goingConcernDetected) summaryParts.push('going concern language detected');

    const summary = summaryParts.length
      ? `${bucket.toUpperCase()} risk: ${summaryParts.join('; ')}.`
      : 'Insufficient evidence found in the scanned filings set.';

    return {
      symbol,
      cik,
      horizonDays: horizon,
      score,
      bucket,
      summary,
      drivers,
      metrics: {
        sharesOutstanding: latestShares,
        sharesSeriesPoints: sharesSeries.length,
        ...flags
      },
      sources: {
        submissionsUrl,
        companyFactsUrl: `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${formatCik10(cik)}.json`
      },
      warnings,
      evidence
    };
  }

  async function getEvidence({ ticker, horizonDays = 90 }) {
    const overview = await getOverview({ ticker, horizonDays });
    return {
      symbol: overview.symbol,
      cik: overview.cik,
      horizonDays: overview.horizonDays,
      evidence: overview.evidence,
      sources: overview.sources,
      warnings: overview.warnings
    };
  }

  async function getCharts({ ticker }) {
    const symbol = normalizeTicker(ticker);
    if (!symbol) throw new Error('ticker is required');
    const cik = await resolveTickerToCik(symbol);

    let sharesSeries = [];
    try {
      const facts = await fetchCompanyFacts(cik);
      const seriesNode = selectCompanyFactsSeries(facts);
      if (seriesNode?.series) sharesSeries = normalizeSharesSeries(seriesNode.series, { maxPoints: 60 });
    } catch (_err) {
      // optional
    }

    return {
      symbol,
      cik,
      sharesOutstanding: sharesSeries,
      sources: {
        companyFactsUrl: `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${formatCik10(cik)}.json`
      }
    };
  }

  return { getOverview, getEvidence, getCharts };
}
