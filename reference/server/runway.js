import { aiChatJson } from './ai.js';

function runwayPrompt({ ticker, company }) {
  const companyLine = company?.name ? `Company (resolved): ${company.name}\n` : '';
  const exchangeLine = company?.exchange ? `Exchange (resolved): ${company.exchange}\n` : '';
  const cikLine = company?.cik ? `CIK (resolved): ${company.cik}\n` : '';
  const secBrowse = company?.cik ? `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(company.cik)}` : '';
  const secSearch = `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(String(ticker || '').trim().toUpperCase())}`;

  return [
    {
      role: 'system',
      content:
        'You estimate a public company\'s cash runway from public information. ' +
        'Do not answer from training memory; only use verifiable, current public sources and cite URLs. ' +
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
        'Identity rule (critical): Use ONLY the resolved company above. Do not mix in similarly named tickers/companies. ' +
        'Do NOT claim the ticker “resolves to” any other company; if you suspect conflicting sources, treat them as irrelevant and proceed with the resolved identity.\n\n' +
        'Task: Estimate how many months the company can go without needing more funding (cash runway).\n' +
        'Also provide cash on hand and a monthly cash burn rate that supports the runway estimate.\n' +
        'Use public info you have access to (latest filings, reputable sources).\n\n' +
        'Preferred sources to check first (use direct URLs when you cite):\n' +
        '- https://finance.yahoo.com\n' +
        '- https://simplywall.st\n' +
        '- https://www.macrotrends.net/\n' +
        '- https://seekingalpha.com/\n' +
        '- https://www.stocktitan.net/\n' +
        '- SEC filings / EDGAR and company investor relations pages\n\n' +
        'Output JSON with this exact schema (numbers are USD unless stated):\n' +
        '{\n' +
        '  "accurate": {\n' +
        '    "cash_on_hand_usd": number|null,\n' +
        '    "burn_rate_usd_per_month": number|null,\n' +
        '    "runway_months": number|null\n' +
        '  },\n' +
        '  "estimate": {\n' +
        '    "cash_on_hand_usd": number|null,\n' +
        '    "burn_rate_usd_per_month": number|null,\n' +
        '    "runway_months": number|null\n' +
        '  },\n' +
        '  "sources": string[]\n' +
        '}\n\n' +
        'Definitions:\n' +
        '- "accurate" = values you can directly ground in specific public sources; use null if you cannot find a reliable figure.\n' +
        '- "estimate" = your best-guess values when sources are missing/unclear; you may infer, but keep conservative.\n\n' +
        'Rules:\n' +
        '- Grounding (critical): Do not use prior knowledge/training memory for facts or numbers. If you cannot find current sources, return nulls.\n' +
        '- If you cannot provide at least 2 credible URLs, set ALL numeric fields to null and set sources to [] (or include only the SEC discovery/search link).\n' +
        (secBrowse ? `- SEC discovery (preferred): ${secBrowse}\n` : '') +
        `- SEC search (fallback): ${secSearch}\n` +
        '- Keep the response short. If you cannot confidently find sourced numbers quickly, return nulls in accurate and use conservative estimates or nulls in estimate.\n' +
        '- Provide at least 2 URLs in sources when possible. Prefer the sources listed above. Limit to at most 5 URLs.\n' +
        '- If something is unknown, prefer null in accurate; estimates may still be provided if reasonable.\n' +
        '- runway_months should be consistent with cash_on_hand_usd / burn_rate_usd_per_month when both are present.\n'
    }
  ];
}

function isFiniteNumberOrNull(v) {
  return v === null || (typeof v === 'number' && Number.isFinite(v));
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .slice(0, 10);
}

function validateRunwayPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid runway payload returned by model.');
  }

  const accurate = payload.accurate;
  const estimate = payload.estimate;
  if (!accurate || typeof accurate !== 'object' || !estimate || typeof estimate !== 'object') {
    throw new Error('Invalid runway payload shape (missing accurate/estimate).');
  }

  const fields = ['cash_on_hand_usd', 'burn_rate_usd_per_month', 'runway_months'];
  for (const f of fields) {
    if (!isFiniteNumberOrNull(accurate[f])) throw new Error(`Invalid accurate.${f} returned by model.`);
    if (!isFiniteNumberOrNull(estimate[f])) throw new Error(`Invalid estimate.${f} returned by model.`);
  }

  // Many models represent "burn" as a negative cash flow number. Accept that sign convention and normalize.
  if (typeof accurate.cash_on_hand_usd === 'number' && accurate.cash_on_hand_usd < 0) {
    throw new Error('accurate.cash_on_hand_usd must be >= 0.');
  }
  if (typeof estimate.cash_on_hand_usd === 'number' && estimate.cash_on_hand_usd < 0) {
    throw new Error('estimate.cash_on_hand_usd must be >= 0.');
  }
  if (typeof accurate.runway_months === 'number' && accurate.runway_months < 0) {
    throw new Error('accurate.runway_months must be >= 0.');
  }
  if (typeof estimate.runway_months === 'number' && estimate.runway_months < 0) {
    throw new Error('estimate.runway_months must be >= 0.');
  }

  return {
    accurate: {
      cashOnHandUsd: accurate.cash_on_hand_usd,
      burnRateUsdPerMonth:
        typeof accurate.burn_rate_usd_per_month === 'number'
          ? Math.abs(accurate.burn_rate_usd_per_month)
          : accurate.burn_rate_usd_per_month,
      runwayMonths: accurate.runway_months
    },
    estimate: {
      cashOnHandUsd: estimate.cash_on_hand_usd,
      burnRateUsdPerMonth:
        typeof estimate.burn_rate_usd_per_month === 'number'
          ? Math.abs(estimate.burn_rate_usd_per_month)
          : estimate.burn_rate_usd_per_month,
      runwayMonths: estimate.runway_months
    },
    sources: normalizeSources(payload.sources)
  };
}

function roundMaybe(n, decimals) {
  if (typeof n !== 'number') return n;
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

export async function getCashRunway({ ticker, company, provider = 'xai', model: modelOverride }) {
  const model =
    typeof modelOverride === 'string' && modelOverride.trim()
      ? modelOverride.trim()
      : provider === 'gemini'
        ? process.env.GEMINI_MODEL || 'models/gemini-2.5-pro'
        : process.env.XAI_MODEL || 'grok-4-1-fast-reasoning';

  const result = await aiChatJson({
    provider,
    model,
    messages: runwayPrompt({ ticker, company }),
    temperature: 0.2
  });

  const validated = validateRunwayPayload(result);
  return {
    accurate: {
      cashOnHandUsd: roundMaybe(validated.accurate.cashOnHandUsd, 0),
      burnRateUsdPerMonth: roundMaybe(validated.accurate.burnRateUsdPerMonth, 0),
      runwayMonths: roundMaybe(validated.accurate.runwayMonths, 1)
    },
    estimate: {
      cashOnHandUsd: roundMaybe(validated.estimate.cashOnHandUsd, 0),
      burnRateUsdPerMonth: roundMaybe(validated.estimate.burnRateUsdPerMonth, 0),
      runwayMonths: roundMaybe(validated.estimate.runwayMonths, 1)
    },
    sources: validated.sources
  };
}
