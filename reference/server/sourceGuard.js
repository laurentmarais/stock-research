function extractUrls(text) {
  const s = typeof text === 'string' ? text : '';
  if (!s) return [];
  const re = /https?:\/\/[^\s)\]}>"']+/gi;
  const found = s.match(re) || [];
  // Trim common trailing punctuation.
  return found
    .map((u) => u.replace(/[\s"'”’]+$/g, '').replace(/[\]\)}>,.;:!?]+$/g, ''))
    .filter(Boolean);
}

export function hasObviouslyFictionalSources(text) {
  const s = String(text || '');
  if (!s) return false;

  if (/\bfictional\b/i.test(s)) return true;
  if (/edgar\/data\/fictional/i.test(s)) return true;

  const urls = extractUrls(s);
  return urls.some((u) => /\/fictional\//i.test(u));
}

export function strictSourceRetryMessages(messages, { ticker, companyName } = {}) {
  const t = String(ticker || '').trim().toUpperCase();
  const c = String(companyName || '').trim();

  const extra = {
    role: 'system',
    content:
      'SOURCE INTEGRITY (critical): Do not invent sources, filings, accession numbers, or URLs. ' +
      'Never use placeholder paths (e.g., /fictional/) or label sources as fictional. ' +
      'If you cannot verify a specific filing URL, cite only stable discovery pages instead (SEC EDGAR search/browse pages, ticker quote pages). ' +
      (t || c ? `You are writing about ${c || 'the resolved company'} (${t || 'ticker'}). ` : '')
  };

  return Array.isArray(messages) ? [extra, ...messages] : [extra];
}
