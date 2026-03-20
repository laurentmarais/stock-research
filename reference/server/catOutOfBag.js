import { aiChatText } from './ai.js';
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
  lines.push('Pre-fetched SEC filings (server-fetched from SEC submissions JSON; use these links for filings/dilution claims):');
  if (submissionsUrl) lines.push(`- Submissions JSON: ${submissionsUrl}`);
  if (browseUrl) lines.push(`- SEC browse: ${browseUrl}`);

  if (!filings.length) {
    lines.push('- Filings list: (none returned by the SEC submissions endpoint)');
    return lines.join('\n') + '\n\n';
  }

  const max = Math.min(filings.length, 15);
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

  lines.push('Rule: Cite filings using the URLs above. If you need something not listed, cite the SEC browse/search pages instead of guessing a deep EDGAR link.');
  return lines.join('\n') + '\n\n';
}

function catPrompt({ ticker, company, asOf, secFilings }) {
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
        'You are an investigative market researcher focused on catalysts and hidden narratives. ' +
        'You MUST include links (URLs) for claims, and you must clearly separate verified facts from rumors. ' +
        'Do not rely on training memory for factual claims; ground them in current sources you can link. ' +
        'Do not invent sources, filings, accession numbers, quotes, dates, or URLs. ' +
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
        'Task: Research the “cat out of the bag” narrative around this stock across web + social + forums.\n\n' +
        'Identity rule (critical): Use ONLY the company described by the resolved identity above. ' +
        'If the ticker maps to a different similarly-named company than expected, call it out explicitly and proceed with the resolved one. ' +
        'Do NOT claim that the ticker “resolves to” any other company name than the resolved identity given above; if you encounter conflicting sources, label them as (Conflict) and ignore them for the rest of the analysis.\n\n' +
        'You must look for:\n' +
        '- Reasons the stock could tumble\n' +
        '- Reasons the stock could rise\n' +
        '- Secrets / circulating rumors that could influence a buy decision\n' +
        '- Important dates in the next 365 days (scheduled AND rumored timelines)\n' +
        '- Dilution causes/triggers/reasons (ATMs, shelves, convertibles, warrants, reverse splits, financing covenants)\n\n' +
        'Sources to include (use links):\n' +
        '- General web and news\n' +
        '- Reddit, Stocktwits, X/Twitter, Discord/forum threads where possible\n' +
        '- SEC filings / EDGAR and company IR\n\n' +
        'Output format (plain text with headings; URLs inline):\n' +
        '1) Snapshot (bullets only; 5–10 bullets, one line each; no paragraph)\n' +
        '2) Bull Case Narratives (bullets; each bullet ends with 1–2 URLs)\n' +
        '3) Bear Case Narratives (bullets; each bullet ends with 1–2 URLs)\n' +
        '4) Rumors / “Secrets” (explicitly label each as rumor; include where it was seen)\n' +
        '5) Important Dates (next 365 days)\n' +
        '6) Dilution Watch (triggers, mechanisms, what to monitor; cite filings)\n' +
        '7) What to Verify Next (short checklist with URLs)\n' +
        '8) Sources (10–20 links)\n\n' +
        'Rules:\n' +
        '- SOURCE INTEGRITY: Do not invent filings, accession numbers, dates, quotes, or URLs. Never label a source as fictional/illustrative.\n' +
        '- If you cannot verify a specific filing URL, cite stable SEC discovery/search pages instead of making up a deep EDGAR link.\n' +
        (secBrowse ? `- SEC discovery (preferred when citing filings): ${secBrowse}\n` : '') +
        `- SEC search (fallback): ${secSearch}\n` +
        '- Do NOT present rumors as facts; always label (Verified) vs (Rumor).\n' +
        '- For Snapshot, use dash-style bullets ("- ") and do not include URLs there.\n' +
        '- In Snapshot bullet #1, restate the resolved identity exactly (company name + ticker) so it is unambiguous.\n' +
        '- Prefer direct links to posts/threads; if not possible, link to a search query that would find it.\n' +
        '- Be specific: name the claim, why it matters, and what would invalidate it.\n' +
        '- If you cannot verify a claim with current sources, label it clearly as (Unverified) or (Rumor) and avoid adding supporting details from memory.'
    }
  ];
}

export async function getCatOutOfBagReport({ ticker, company, provider = 'xai', model: modelOverride, secFilings }) {
  const model = typeof modelOverride === 'string' && modelOverride.trim() ? modelOverride.trim() : defaultModelForProvider(provider);
  const baseMessages = catPrompt({ ticker, company, asOf: new Date().toISOString().slice(0, 10), secFilings });
  let reportText = await aiChatText({ provider, model, messages: baseMessages, temperature: 0.25 });
  if (hasObviouslyFictionalSources(reportText)) {
    reportText = await aiChatText({
      provider,
      model,
      messages: strictSourceRetryMessages(baseMessages, { ticker, companyName: company?.name }),
      temperature: 0.1
    });
  }

  return { reportText, model };
}
