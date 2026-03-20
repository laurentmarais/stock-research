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

function newsPrompt({ ticker, company, items }) {
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
        'You analyze stock-related news items and classify them. ' +
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
        'Identity rule (critical): Use ONLY the resolved company above. If an item seems about another entity, treat it as irrelevant/uncertain rather than mixing. ' +
        'Do NOT claim the ticker “resolves to” any other company; if you suspect conflicting sources, treat them as irrelevant and proceed with the resolved identity.\n\n' +
        'Task:\n' +
        '1) Identify any items that indicate a stock split OR dilution (equity offering/ATM/convertible/etc) scheduled/expected within the next 30 days.\n' +
        '2) For each item, classify sentiment about stock price direction (positive/negative/neutral).\n\n' +
        'Return JSON with this schema:\n' +
        '{\n' +
        '  "items": [\n' +
        '    {\n' +
        '      "id": string,\n' +
        '      "sentiment": "positive"|"negative"|"neutral",\n' +
        '      "corporate_action": "split"|"reverse_split"|"dilution"|"none",\n' +
        '      "within_next_month": boolean,\n' +
        '      "note": string|null\n' +
        '    }\n' +
        '  ]\n' +
        '}\n\n' +
        'Rules:\n' +
        '- Sentiment is about stock price direction implied by the news item.\n' +
        '- Mark corporate_action="none" if it does not mention split/reverse split/dilution.\n' +
        '- within_next_month should be true only if the item suggests the action is expected/scheduled within ~30 days.\n' +
        '- Keep note very short (<= 120 chars) and only when corporate_action != "none".\n\n' +
        `News items (most recent first, max ${trimmed.length}):\n` +
        lines
    }
  ];
}

function isSentiment(v) {
  return v === 'positive' || v === 'negative' || v === 'neutral';
}

function isCorporateAction(v) {
  return v === 'split' || v === 'reverse_split' || v === 'dilution' || v === 'none';
}

function validateNewsLabels(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    throw new Error('Invalid news analysis payload returned by model.');
  }

  const out = new Map();
  for (const row of payload.items) {
    if (!row || typeof row !== 'object') continue;
    const id = typeof row.id === 'string' ? row.id : null;
    const sentiment = row.sentiment;
    const corporateAction = row.corporate_action;
    const withinNextMonth = row.within_next_month;
    const note = row.note;

    if (!id) continue;
    if (!isSentiment(sentiment)) continue;
    if (!isCorporateAction(corporateAction)) continue;
    if (typeof withinNextMonth !== 'boolean') continue;
    if (note !== null && typeof note !== 'string') continue;

    out.set(id, {
      sentiment,
      corporateAction,
      withinNextMonth,
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

export async function getNewsAnalysis({ ticker, company, provider = 'xai', model: modelOverride }) {
  const model =
    typeof modelOverride === 'string' && modelOverride.trim()
      ? modelOverride.trim()
      : provider === 'gemini'
        ? process.env.GEMINI_MODEL || 'models/gemini-2.5-pro'
        : process.env.XAI_MODEL || 'grok-4-1-fast-reasoning';

  const { url: feedUrl, xml } = await fetchYahooRss({ ticker });
  const items = parseYahooRss(xml);

  const maxItems = clampInt(process.env.NEWS_MAX_ITEMS || 30, 5, 50);
  const limited = items.slice(0, maxItems);

  const labelsPayload = await aiChatJson({
    provider,
    model,
    messages: newsPrompt({ ticker, company, items: limited }),
    temperature: 0.2
  });
  const labelsById = validateNewsLabels(labelsPayload);

  const now = Date.now();
  const buckets = initBuckets();

  const articles = limited.map((it) => {
    const label = labelsById.get(it.id) || {
      sentiment: 'neutral',
      corporateAction: 'none',
      withinNextMonth: false,
      note: null
    };

    const ageMs = now - new Date(it.publishedAt).getTime();

    if (ageMs <= 60 * 60 * 1000) addToBucket(buckets['1h'], label.sentiment);
    if (ageMs <= 24 * 60 * 60 * 1000) addToBucket(buckets['24h'], label.sentiment);
    if (ageMs <= 7 * 24 * 60 * 60 * 1000) addToBucket(buckets.week, label.sentiment);
    if (ageMs <= 30 * 24 * 60 * 60 * 1000) addToBucket(buckets.month, label.sentiment);

    return {
      ...it,
      sentiment: label.sentiment,
      corporateAction: label.corporateAction,
      withinNextMonth: label.withinNextMonth,
      note: label.note
    };
  });

  const sortedArticles = sortByPublishedAtDesc(articles);

  const splitDilutionNextMonth = sortedArticles
    .filter((a) => a.corporateAction !== 'none' && a.withinNextMonth)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .map((a) => ({
      corporateAction: a.corporateAction,
      headline: a.title,
      url: a.url,
      publishedAt: a.publishedAt,
      note: a.note
    }));

  return {
    feedUrl,
    positivity: buckets,
    splitDilutionNextMonth,
    articles: sortedArticles.slice(0, 20)
  };
}
