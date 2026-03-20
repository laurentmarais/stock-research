import { XMLParser } from 'fast-xml-parser';

import { aiChatJson } from './ai.js';

function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toArray(maybeArray) {
  if (!maybeArray) return [];
  return Array.isArray(maybeArray) ? maybeArray : [maybeArray];
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(Math.trunc(v), min), max);
}

async function fetchYahooRss({ ticker, timeoutMs = 8000 }) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(
    ticker
  )}&region=US&lang=en-US`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`Yahoo RSS fetch failed (${resp.status})`);
    }
    const xml = await resp.text();
    return { url, xml };
  } finally {
    clearTimeout(t);
  }
}

async function fetchYahooConsensusPriceTargets({ ticker, timeoutMs = 8000 }) {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
    ticker
  )}?modules=financialData`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return { url, targets: null };
    const json = await resp.json().catch(() => null);
    const fin = json?.quoteSummary?.result?.[0]?.financialData;

    const readRaw = (v) => {
      const raw = v?.raw;
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    };

    const targets = {
      lowUsd: readRaw(fin?.targetLowPrice),
      meanUsd: readRaw(fin?.targetMeanPrice),
      highUsd: readRaw(fin?.targetHighPrice),
      medianUsd: readRaw(fin?.targetMedianPrice),
      analystCount: typeof fin?.numberOfAnalystOpinions?.raw === 'number' ? fin.numberOfAnalystOpinions.raw : null
    };

    const hasAny = Object.values(targets).some((v) => typeof v === 'number');
    return { url, targets: hasAny ? targets : null };
  } catch {
    return { url, targets: null };
  } finally {
    clearTimeout(t);
  }
}

function parseYahooRss(xml) {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: true,
    trimValues: true
  });

  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel;
  const items = toArray(channel?.item);

  return items
    .map((it, idx) => {
      const title = typeof it?.title === 'string' ? it.title.trim() : '';
      const link = typeof it?.link === 'string' ? it.link.trim() : '';
      const pubDate = typeof it?.pubDate === 'string' ? it.pubDate.trim() : '';
      const description = stripHtml(typeof it?.description === 'string' ? it.description : '');
      const publishedAt = pubDate ? new Date(pubDate) : null;

      if (!title || !link || !publishedAt || Number.isNaN(publishedAt.getTime())) return null;

      return {
        id: String(idx + 1),
        title,
        url: link,
        summary: description,
        publishedAt: publishedAt.toISOString()
      };
    })
    .filter(Boolean);
}

function analystPrompt({ ticker, company, items }) {
  const trimmed = items.slice(0, 30);

  const companyLine = company?.name ? `Company (resolved): ${company.name}\n` : '';
  const exchangeLine = company?.exchange ? `Exchange (resolved): ${company.exchange}\n` : '';
  const cikLine = company?.cik ? `CIK (resolved): ${company.cik}\n` : '';

  const lines = trimmed
    .map((it) => {
      const summary = it.summary ? ` | ${it.summary}` : '';
      return `- id=${it.id} published_at=${it.publishedAt} url=${it.url}\n  title=${it.title}${summary}`;
    })
    .join('\n');

  return [
    {
      role: 'system',
      content:
        'You analyze stock-related news items and extract analyst rating/price-target signals. ' +
        'Use ONLY the provided news items; do not add external facts or training-memory knowledge. ' +
        'Return ONLY valid JSON. No markdown, no extra text. ' +
        'If a resolved company identity is provided in the prompt, you MUST treat it as authoritative ground truth and MUST NOT contradict it.'
    },
    {
      role: 'user',
      content:
        `Ticker: ${ticker}\n` +
        companyLine +
        exchangeLine +
        cikLine +
        '\n' +
        'Identity rule (critical): Use ONLY the resolved company above. If an item seems to reference a different entity, treat it as not-applicable/uncertain rather than mixing. ' +
        'Do NOT claim the ticker “resolves to” any other company; if you suspect conflicting sources, treat them as irrelevant and proceed with the resolved identity.\n\n' +
        'Task:\n' +
        '1) Identify which items are analyst actions (upgrade/downgrade/price target raise/cut/initiation/reiteration).\n' +
        '2) For each item, classify analyst sentiment about stock price direction (positive/negative/neutral).\n\n' +
        '3) If present, extract the analyst firm and any price target numbers (USD per share).\n\n' +
        'Return JSON with this schema:\n' +
        '{\n' +
        '  "items": [\n' +
        '    {\n' +
        '      "id": string,\n' +
        '      "is_analyst": boolean,\n' +
        '      "sentiment": "positive"|"negative"|"neutral",\n' +
        '      "action": "upgrade"|"downgrade"|"pt_raise"|"pt_cut"|"initiation"|"reiteration"|"none",\n' +
        '      "firm": string|null,\n' +
        '      "price_target_from_usd": number|null,\n' +
        '      "price_target_to_usd": number|null,\n' +
        '      "note": string|null\n' +
        '    }\n' +
        '  ]\n' +
        '}\n\n' +
        'Rules:\n' +
        '- If the item is not analyst-related, set is_analyst=false, action="none", sentiment="neutral", firm=null, price_target_from_usd=null, price_target_to_usd=null, note=null.\n' +
        '- firm should be the analyst firm/bank if explicitly mentioned; otherwise null.\n' +
        '- price_target_* values must be numbers (no $ sign); use null if unknown/absent.\n' +
        '- For pt_raise/pt_cut: fill both from/to when present.\n' +
        '- For initiation/reiteration: it is OK to set only price_target_to_usd when only a single target is mentioned.\n' +
        '- Keep note very short (<= 120 chars) and only when is_analyst=true.\n\n' +
        `News items (most recent first, max ${trimmed.length}):\n` +
        lines
    }
  ];
}

function isSentiment(v) {
  return v === 'positive' || v === 'negative' || v === 'neutral';
}

function isAction(v) {
  return (
    v === 'upgrade' ||
    v === 'downgrade' ||
    v === 'pt_raise' ||
    v === 'pt_cut' ||
    v === 'initiation' ||
    v === 'reiteration' ||
    v === 'none'
  );
}

function toFiniteNumberOrNull(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '');
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractPriceTargetsFromText(text) {
  if (typeof text !== 'string' || !text) return { from: null, to: null };
  const t = text.replace(/\s+/g, ' ').trim();

  const num = (s) => {
    const n = toFiniteNumberOrNull(s);
    return typeof n === 'number' && n > 0 ? n : null;
  };

  // Common: "... price target to $150 from $120" or "from $120 to $150"
  let m = t.match(/\bfrom\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*\bto\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (m) return { from: num(m[1]), to: num(m[2]) };

  m = t.match(/\bto\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*\bfrom\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (m) return { from: num(m[2]), to: num(m[1]) };

  // Single target: require an explicit $ amount to avoid false positives like "1 Year".
  // Examples: "price target $150", "PT $150", "target to $150".
  m = t.match(/\b(?:price\s*target|pt|target)\b[^$]{0,40}\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (m) return { from: null, to: num(m[1]) };

  // Fallback: first two $-amounts in text.
  const all = Array.from(t.matchAll(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/g)).map((x) => num(x[1])).filter(Boolean);
  if (all.length >= 2) return { from: all[0], to: all[1] };
  if (all.length === 1) return { from: null, to: all[0] };
  return { from: null, to: null };
}

function extractDollarAmounts(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const m of text.matchAll(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/g)) {
    const n = toFiniteNumberOrNull(m[1]);
    if (typeof n === 'number') out.push(n);
  }
  return out;
}

function isDollarAmountPresent(text, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const amounts = extractDollarAmounts(text);
  return amounts.some((x) => Math.abs(x - value) < 0.01);
}

async function fetchTextWithTimeout(url, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Avoid overly strict blocks; still a normal browser-ish UA.
        'User-Agent': 'marketmind/1.0'
      }
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    // Hard cap to keep memory under control.
    return text.length > 250_000 ? text.slice(0, 250_000) : text;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractPriceTargetsFromArticleText(text) {
  if (typeof text !== 'string' || !text) return { from: null, to: null };
  const t = text.replace(/\s+/g, ' ').trim();

  // Look near the most relevant phrase to avoid picking up unrelated $ amounts.
  const windows = [];
  for (const m of t.matchAll(/(?:price\s+target|target\s+price)[^]{0,260}/gi)) {
    windows.push(m[0]);
    if (windows.length >= 6) break;
  }

  for (const w of windows) {
    const pt = extractPriceTargetsFromText(w);
    if (typeof pt.from === 'number' || typeof pt.to === 'number') return pt;
  }

  return { from: null, to: null };
}

function validateAnalystLabels(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    throw new Error('Invalid analyst sentiment payload returned by model.');
  }

  const out = new Map();
  for (const row of payload.items) {
    if (!row || typeof row !== 'object') continue;

    const id = typeof row.id === 'string' ? row.id : null;
    const isAnalyst = row.is_analyst;
    const sentiment = row.sentiment;
    const action = row.action;
    const firm = row.firm;
    const priceTargetFromUsd = row.price_target_from_usd;
    const priceTargetToUsd = row.price_target_to_usd;
    const note = row.note;

    if (!id) continue;
    if (typeof isAnalyst !== 'boolean') continue;
    if (!isSentiment(sentiment)) continue;
    if (!isAction(action)) continue;
    if (firm !== null && typeof firm !== 'string') continue;
    if (priceTargetFromUsd !== null && typeof priceTargetFromUsd !== 'number' && typeof priceTargetFromUsd !== 'string') continue;
    if (priceTargetToUsd !== null && typeof priceTargetToUsd !== 'number' && typeof priceTargetToUsd !== 'string') continue;
    if (note !== null && typeof note !== 'string') continue;

    out.set(id, {
      isAnalyst,
      sentiment,
      action,
      firm: typeof firm === 'string' ? firm.slice(0, 120) : null,
      priceTargetFromUsd: toFiniteNumberOrNull(priceTargetFromUsd),
      priceTargetToUsd: toFiniteNumberOrNull(priceTargetToUsd),
      note: typeof note === 'string' ? note.slice(0, 200) : null
    });
  }

  return out;
}

function initBuckets() {
  return {
    '1h': { positive: 0, negative: 0, neutral: 0, total: 0, positivePct: 0 },
    '24h': { positive: 0, negative: 0, neutral: 0, total: 0, positivePct: 0 },
    week: { positive: 0, negative: 0, neutral: 0, total: 0, positivePct: 0 },
    month: { positive: 0, negative: 0, neutral: 0, total: 0, positivePct: 0 }
  };
}

function addToBucket(bucket, sentiment) {
  bucket.total += 1;
  if (sentiment === 'positive') bucket.positive += 1;
  else if (sentiment === 'negative') bucket.negative += 1;
  else bucket.neutral += 1;
  bucket.positivePct = bucket.total ? Math.round((bucket.positive / bucket.total) * 1000) / 10 : 0;
}

function sortByPublishedAtDesc(items) {
  return [...items].sort((a, b) => {
    const ta = a?.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b?.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });
}

export async function getAnalystSentiment({ ticker, company, provider = 'xai', model: modelOverride }) {
  const model =
    typeof modelOverride === 'string' && modelOverride.trim()
      ? modelOverride.trim()
      : provider === 'gemini'
        ? process.env.GEMINI_MODEL || 'models/gemini-2.5-pro'
        : process.env.XAI_MODEL || 'grok-4-1-fast-reasoning';

  const { url: feedUrl, xml } = await fetchYahooRss({ ticker });
  const items = parseYahooRss(xml);

  const enableYahooConsensus = process.env.ENABLE_YAHOO_CONSENSUS === '1';
  const { url: consensusUrl, targets: consensusPriceTargets } = enableYahooConsensus
    ? await fetchYahooConsensusPriceTargets({ ticker })
    : { url: null, targets: null };

  const maxItems = clampInt(process.env.ANALYSTS_MAX_ITEMS || 30, 5, 50);
  const limited = items.slice(0, maxItems);

  const labelsPayload = await aiChatJson({
    provider,
    model,
    messages: analystPrompt({ ticker, company, items: limited }),
    temperature: 0.2
  });
  const labelsById = validateAnalystLabels(labelsPayload);

  const now = Date.now();
  const buckets = initBuckets();

  const allowArticleFetch = process.env.ANALYSTS_FETCH_ARTICLE !== '0';

  const all = await Promise.all(limited.map(async (it) => {
    const label = labelsById.get(it.id) || {
      isAnalyst: false,
      sentiment: 'neutral',
      action: 'none',
      firm: null,
      priceTargetFromUsd: null,
      priceTargetToUsd: null,
      note: null
    };

    // If xAI didn't extract targets, try to infer from the headline/summary.
    const combinedText = `${it.title || ''} ${it.summary || ''}`.trim();

    // Guard against model hallucinating numbers that aren't in the source text.
    const safeLabelFrom =
      typeof label.priceTargetFromUsd === 'number' && isDollarAmountPresent(combinedText, label.priceTargetFromUsd)
        ? label.priceTargetFromUsd
        : null;
    const safeLabelTo =
      typeof label.priceTargetToUsd === 'number' && isDollarAmountPresent(combinedText, label.priceTargetToUsd)
        ? label.priceTargetToUsd
        : null;

    const extracted = extractPriceTargetsFromText(combinedText);
    let mergedFrom = safeLabelFrom ?? extracted.from;
    let mergedTo = safeLabelTo ?? extracted.to;

    // If we still have no targets and the item looks like an analyst action,
    // try the linked article page (RSS summaries often omit the actual target).
    if (
      allowArticleFetch &&
      label.isAnalyst &&
      mergedFrom === null &&
      mergedTo === null &&
      typeof it.url === 'string' &&
      it.url
    ) {
      const html = await fetchTextWithTimeout(it.url, { timeoutMs: 8000 });
      if (html) {
        const articleText = stripHtml(html);
        const pt = extractPriceTargetsFromArticleText(articleText);
        if (typeof pt.from === 'number') mergedFrom = pt.from;
        if (typeof pt.to === 'number') mergedTo = pt.to;
      }
    }

    // If the item is analyst-related but no explicit action was provided, default to reiteration.
    // If we have from/to targets, choose pt_raise/pt_cut heuristically.
    let mergedAction = label.action;
    if (label.isAnalyst && mergedAction === 'none') {
      if (typeof mergedFrom === 'number' && typeof mergedTo === 'number') {
        mergedAction = mergedTo >= mergedFrom ? 'pt_raise' : 'pt_cut';
      } else {
        mergedAction = 'reiteration';
      }
    }

    if (label.isAnalyst) {
      const ageMs = now - new Date(it.publishedAt).getTime();
      if (ageMs <= 60 * 60 * 1000) addToBucket(buckets['1h'], label.sentiment);
      if (ageMs <= 24 * 60 * 60 * 1000) addToBucket(buckets['24h'], label.sentiment);
      if (ageMs <= 7 * 24 * 60 * 60 * 1000) addToBucket(buckets.week, label.sentiment);
      if (ageMs <= 30 * 24 * 60 * 60 * 1000) addToBucket(buckets.month, label.sentiment);
    }

    return {
      ...it,
      isAnalyst: label.isAnalyst,
      sentiment: label.sentiment,
      action: mergedAction,
      firm: label.firm,
      priceTargetFromUsd: mergedFrom,
      priceTargetToUsd: mergedTo,
      note: label.note
    };
  }));

  const analystItems = sortByPublishedAtDesc(all).filter((it) => it.isAnalyst).slice(0, 25);

  return {
    feedUrl,
    consensusUrl,
    consensusPriceTargets,
    sentiment: buckets,
    items: analystItems
  };
}
