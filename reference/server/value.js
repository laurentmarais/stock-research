import { aiChatText } from './ai.js';
import { parseJsonFromText } from './jsonExtract.js';
import { hasObviouslyFictionalSources, strictSourceRetryMessages } from './sourceGuard.js';

function defaultModelForProvider(provider) {
  return provider === 'gemini'
    ? process.env.GEMINI_MODEL || 'models/gemini-2.5-pro'
    : process.env.XAI_MODEL || 'grok-4-1-fast-reasoning';
}

function renderSecFilingsPack(secFilings) {
  const filings = Array.isArray(secFilings?.filings) ? secFilings.filings : [];
  const submissionsUrl = typeof secFilings?.sources?.submissionsUrl === 'string' ? secFilings.sources.submissionsUrl : '';
  const browseUrl = typeof secFilings?.sources?.secBrowseUrl === 'string' ? secFilings.sources.secBrowseUrl : '';

  if (!filings.length && !submissionsUrl && !browseUrl) return '';

  const lines = [];
  lines.push('Pre-fetched SEC filings (server-fetched from SEC submissions JSON; use these links for citations):');
  if (submissionsUrl) lines.push(`- Submissions JSON: ${submissionsUrl}`);
  if (browseUrl) lines.push(`- SEC browse: ${browseUrl}`);

  if (!filings.length) {
    lines.push('- Filings list: (none returned by the SEC submissions endpoint)');
    return lines.join('\n') + '\n\n';
  }

  const max = Math.min(filings.length, 18);
  for (let i = 0; i < max; i++) {
    const f = filings[i];
    const date = typeof f?.filingDate === 'string' ? f.filingDate : '';
    const form = typeof f?.form === 'string' ? f.form : '';
    const title = typeof f?.title === 'string' ? f.title : '';
    const indexUrl = typeof f?.indexUrl === 'string' ? f.indexUrl : '';
    const filingUrl = typeof f?.filingUrl === 'string' ? f.filingUrl : '';
    const parts = [];
    if (date) parts.push(date);
    if (form) parts.push(form);
    if (title) parts.push(title);
    const head = parts.length ? parts.join(' • ') : 'Filing';
    const linkParts = [];
    if (indexUrl) linkParts.push(`Index: ${indexUrl}`);
    if (filingUrl) linkParts.push(`Primary doc: ${filingUrl}`);
    lines.push(`- ${head}${linkParts.length ? ' | ' + linkParts.join(' | ') : ''}`);
  }

  lines.push('Rule: If you cite an SEC filing, prefer one of the URLs above. If you need a filing not listed, cite the SEC browse/search pages instead of guessing a deep EDGAR link.');
  return lines.join('\n') + '\n\n';
}

function valuePrompt({ ticker, company, asOf, secFilings }) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const companyLine = company?.name ? `Company (resolved): ${company.name}\n` : '';
  const exchangeLine = company?.exchange ? `Exchange (resolved): ${company.exchange}\n` : '';
  const cikLine = company?.cik ? `CIK (resolved): ${company.cik}\n` : '';
  const secBrowse = company?.cik ? `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(company.cik)}` : '';
  const secSearch = `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(String(ticker || '').trim().toUpperCase())}`;
  const secPack = renderSecFilingsPack(secFilings);

  return [
    {
      role: 'system',
      content:
        'You are a meticulous equity research analyst. ' +
        'You MUST include source links (URLs) for key figures and claims. ' +
        'Do not rely on training memory for facts or numbers; ground claims in current public sources you can cite. ' +
        'Do not invent sources, filings, accession numbers, dates, or URLs. ' +
        'Write clearly and show calculations. ' +
        'If a resolved company identity is provided in the prompt, you MUST treat it as authoritative ground truth and MUST NOT contradict it.'
    },
    {
      role: 'user',
      content:
        `Ticker: ${ticker}\n` +
        companyLine +
        exchangeLine +
        cikLine +
        `As-of date: ${today}\n\n` +
        secPack +
        'Goal: Estimate the underlying intrinsic value per share using the latest publicly available information.\n\n' +
        'Identity rule (critical): Use ONLY the company described by the resolved identity above. ' +
        'If there are similarly named companies or tickers, explicitly note the potential confusion and avoid mixing facts. ' +
        'Do NOT claim the ticker “resolves to” any other company name; if sources conflict, label (Conflict) and proceed with the resolved identity.\n\n' +
        'Requirements:\n' +
        '- Provide BOTH a point estimate AND a range (bear/base/bull).\n' +
        '- Give a confidence label for the range (e.g., low/medium/high) and explain why.\n' +
        '- Use whatever valuation methods are necessary, but include these if applicable:\n' +
        '  1) Liquidation / asset-based value (what equity holders might get if liquidated today)\n' +
        '  2) DCF (with explicit assumptions)\n' +
        '  3) Comps / multiples (identify peers and show the math)\n' +
        '  4) Sum-of-the-parts (if business segments justify it)\n' +
        '- Show each method separately, then compute an average/summary value and explain weighting if you do any weighting.\n' +
        '- Include why the market might be discounting the stock vs intrinsic value (key risks and narrative).\n' +
        '- Include risks that devalue the company (at least 5) and future upside drivers (at least 5).\n' +
        '- Include a short section on dilution risk / capital structure (convertibles, ATM/shelf, warrants) when relevant.\n' +
        '- Provide clickable links: SEC filings, investor relations, reputable finance sites, and anything used for numbers.\n\n' +
        'Output format (plain text with headings; include URLs inline):\n' +
        '1) Executive Summary\n' +
        '2) Current Price & Share Count (include timestamp / source)\n' +
        '3) Valuation Methods (Liquidation, DCF, Comps, SOTP)\n' +
        '   - For each: assumptions, calculation steps, per-share value, and sources\n' +
        '4) Range (Bear/Base/Bull) + Confidence\n' +
        '5) Why Discounted (Market skepticism)\n' +
        '6) Key Risks\n' +
        '7) Upside Catalysts\n' +
        '8) Sources (5–12 links)\n\n' +
        'Rules:\n' +
        '- SOURCE INTEGRITY: Do not invent filings, accession numbers, dates, or URLs. Never label a source as fictional/illustrative.\n' +
        '- If you cannot provide a specific filing URL with confidence, cite stable discovery pages instead.\n' +
        (secBrowse ? `- SEC discovery (preferred when citing filings): ${secBrowse}\n` : '') +
        `- SEC search (fallback): ${secSearch}\n` +
        '- If a figure cannot be verified, state it as an estimate and explain how you inferred it.\n' +
        '- If you cannot find current sources for key inputs (price, shares, cash/debt), explicitly say you could not verify them and keep the affected outputs as null/unknown where appropriate.\n' +
        '- Prefer recent filings (10-K/10-Q/8-K) and direct IR pages.\n' +
        '- Keep the response information-dense but readable.\n\n' +
        'Machine-readable summary (required):\n' +
        '- After the report, output a line with exactly: JSON_SUMMARY\n' +
        '- Then output a single ```json code block containing ONLY a JSON object (no extra commentary).\n' +
        '- The JSON object MUST use these keys and numeric USD per-share values (NOT market cap, EV, or total company valuation):\n' +
        '  - pointEstimatePerShareUsd\n' +
        '  - bearCasePerShareUsd\n' +
        '  - baseCasePerShareUsd\n' +
        '  - bullCasePerShareUsd\n' +
        '  - currency (always "USD")\n' +
        '  - asOfDate (YYYY-MM-DD; match the As-of date above)\n' +
        '- If a value is truly not knowable, use null.\n' +
        '- Do not use curly braces { } anywhere else in the report (reserve them for the JSON).'
    }
  ];
}

function extractValueEstimates(reportText) {
  const text = typeof reportText === 'string' ? reportText : '';
  if (!text.trim()) return null;

  const markerIndex = text.lastIndexOf('JSON_SUMMARY');
  const tail = markerIndex !== -1 ? text.slice(markerIndex) : text;

  let parsed = null;
  // Prefer parsing from the tail after JSON_SUMMARY.
  parsed = parseJsonFromText(tail);

  if (!parsed || typeof parsed !== 'object') return null;

  const pickNumOrNull = (v) => {
    if (v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return v;
  };

  const out = {
    pointEstimatePerShareUsd: pickNumOrNull(parsed.pointEstimatePerShareUsd),
    bearCasePerShareUsd: pickNumOrNull(parsed.bearCasePerShareUsd),
    baseCasePerShareUsd: pickNumOrNull(parsed.baseCasePerShareUsd),
    bullCasePerShareUsd: pickNumOrNull(parsed.bullCasePerShareUsd),
    currency: parsed.currency === 'USD' ? 'USD' : 'USD',
    asOfDate: typeof parsed.asOfDate === 'string' && parsed.asOfDate.trim() ? parsed.asOfDate.trim() : null
  };

  const hasAny = Object.values(out).some((v) => typeof v === 'number');
  return hasAny ? out : null;
}

export async function getValueReport({ ticker, company, provider = 'xai', model: modelOverride, secFilings }) {
  const model = typeof modelOverride === 'string' && modelOverride.trim() ? modelOverride.trim() : defaultModelForProvider(provider);
  const baseMessages = valuePrompt({ ticker, company, asOf: new Date().toISOString().slice(0, 10), secFilings });
  let reportText = await aiChatText({ provider, model, messages: baseMessages, temperature: 0.2 });
  if (hasObviouslyFictionalSources(reportText)) {
    reportText = await aiChatText({
      provider,
      model,
      messages: strictSourceRetryMessages(baseMessages, { ticker, companyName: company?.name }),
      temperature: 0.1
    });
  }

  const estimates = extractValueEstimates(reportText);
  return { reportText, model, estimates };
}
