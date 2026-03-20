import { aiChatText } from './ai.js';

function clampWordLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.max(10, Math.min(500, Math.round(n)));
}

function defaultModelForProvider(provider) {
  return provider === 'gemini'
    ? process.env.GEMINI_MODEL || 'models/gemini-2.5-pro'
    : process.env.XAI_MODEL || 'grok-4-1-fast-reasoning';
}

export async function getAdhocAnswer({ ticker, company, provider = 'xai', model: modelOverride, question, wordLimit }) {
  const q = typeof question === 'string' ? question.trim() : '';
  if (!q) throw new Error('question is required');

  const limit = clampWordLimit(wordLimit);
  const model = typeof modelOverride === 'string' && modelOverride.trim() ? modelOverride.trim() : defaultModelForProvider(provider);

  const companyLine = company?.name ? `Company (resolved): ${company.name}\n` : '';
  const exchangeLine = company?.exchange ? `Exchange (resolved): ${company.exchange}\n` : '';
  const cikLine = company?.cik ? `CIK (resolved): ${company.cik}\n` : '';
  const secBrowse = company?.cik ? `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(company.cik)}` : '';
  const secSearch = `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(String(ticker || '').trim().toUpperCase())}`;

  const messages = [
    {
      role: 'system',
      content:
        `Answer in less than ${limit} words. ` +
        'Do not answer factual/company-specific questions from training memory. ' +
        'If the question requires up-to-date facts, only answer using current public sources and include URLs. ' +
        'If you cannot find/verify sources, say you cannot verify and provide what to check next. ' +
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
        'Identity rule (critical): Use ONLY the resolved company above. If there is ticker/company confusion, call it out and proceed with the resolved identity. ' +
        'Do NOT claim the ticker “resolves to” any other company; if you see conflicts, label (Conflict) and continue with the resolved identity.\n\n' +
        'Grounding rule (critical): If you make factual claims (numbers, dates, events, filings), include 1–3 URLs. If you cannot, say "Unable to verify with current sources" and stop after listing next steps/links.\n' +
        (secBrowse ? `SEC discovery: ${secBrowse}\n` : '') +
        `SEC search: ${secSearch}\n\n` +
        q
    }
  ];

  const text = await aiChatText({ provider, model, messages, temperature: 0.2 });
  return { answerText: text, wordLimit: limit, model };
}
