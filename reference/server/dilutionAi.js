import { aiChatJson } from './ai.js';

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(Math.trunc(v), min), max);
}

function normalizeEvidenceItems(items, { maxItems = 18 } = {}) {
  if (!Array.isArray(items)) return [];
  return items
    .map((e, idx) => {
      if (!e || typeof e !== 'object') return null;
      const id = `E${idx + 1}`;
      const form = typeof e.form === 'string' ? e.form.trim() : '';
      const date = typeof e.date === 'string' ? e.date.trim() : '';
      const filedAt = typeof e.filedAt === 'string' ? e.filedAt.trim() : '';
      const title = typeof e.title === 'string' ? e.title.trim() : '';
      const url = typeof e.url === 'string' ? e.url.trim() : '';
      const snippet = typeof e.snippet === 'string' ? e.snippet.trim() : '';
      const tags = Array.isArray(e.tags) ? e.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 12) : [];

      return {
        id,
        form,
        date,
        filedAt,
        title: title.slice(0, 140),
        url,
        tags,
        snippet: snippet.length > 700 ? `${snippet.slice(0, 700)}…` : snippet
      };
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function validateAiPayload(payload, { evidenceIds }) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid dilution AI payload returned by model.');
  }

  const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
  const riskFactors = Array.isArray(payload.risk_factors) ? payload.risk_factors : [];
  const watchlist = Array.isArray(payload.watchlist) ? payload.watchlist : [];
  const confidenceRaw = payload.confidence;

  const confidence = typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
    ? Math.min(Math.max(confidenceRaw, 0), 1)
    : null;

  const normalizedRiskFactors = riskFactors
    .map((r) => {
      if (!r || typeof r !== 'object') return null;
      const label = typeof r.label === 'string' ? r.label.trim() : '';
      const severity = typeof r.severity === 'string' ? r.severity.trim().toLowerCase() : '';
      const rationale = typeof r.rationale === 'string' ? r.rationale.trim() : '';
      const evIds = Array.isArray(r.evidence_ids)
        ? r.evidence_ids.map((x) => String(x || '').trim()).filter(Boolean)
        : [];

      const filtered = evIds.filter((id) => evidenceIds.has(id));

      const sev = severity === 'high' || severity === 'medium' || severity === 'low' ? severity : 'medium';
      if (!label) return null;

      return {
        label: label.slice(0, 160),
        severity: sev,
        evidenceIds: filtered.slice(0, 8),
        rationale: rationale ? rationale.slice(0, 400) : ''
      };
    })
    .filter(Boolean)
    .slice(0, 8);

  const normalizedWatchlist = watchlist
    .map((w) => (typeof w === 'string' ? w.trim() : ''))
    .filter(Boolean)
    .slice(0, 8);

  return {
    summary: summary ? summary.slice(0, 1200) : '',
    riskFactors: normalizedRiskFactors,
    watchlist: normalizedWatchlist,
    confidence
  };
}

export async function getDilutionAiSummary({ ticker, company, provider, model, overview }) {
  const score = typeof overview?.score === 'number' ? overview.score : null;
  const bucket = typeof overview?.bucket === 'string' ? overview.bucket : '';
  const baseSummary = typeof overview?.summary === 'string' ? overview.summary : '';

  const companyLine = company?.name ? `Company (resolved): ${company.name}\n` : '';
  const exchangeLine = company?.exchange ? `Exchange (resolved): ${company.exchange}\n` : '';
  const cikLine = company?.cik ? `CIK (resolved): ${company.cik}\n` : '';

  const drivers = Array.isArray(overview?.drivers) ? overview.drivers : [];
  const driverLines = drivers
    .slice(0, 10)
    .map((d) => `- +${d?.weight ?? ''} ${String(d?.label || '').trim()}`)
    .filter((s) => s.trim() && !s.includes('undefined'))
    .join('\n');

  const horizonDays = clampInt(overview?.horizonDays, 7, 365, 90);
  const evidence = normalizeEvidenceItems(overview?.evidence, { maxItems: 18 });

  const evidenceLines = evidence
    .map((e) => {
      const tags = e.tags.length ? ` tags=${e.tags.join(',')}` : '';
      const title = e.title ? ` title=${e.title}` : '';
      const filed = e.filedAt ? ` filed_at=${e.filedAt}` : '';
      return `- id=${e.id} form=${e.form || '—'} date=${e.date || '—'}${filed}${tags}${title}\n  url=${e.url || '—'}\n  snippet=${e.snippet || '—'}`;
    })
    .join('\n');

  const messages = [
    {
      role: 'system',
      content:
        `Ticker: ${ticker}\n` +
        companyLine +
        exchangeLine +
        cikLine +
        'Use ONLY the provided evidence; do not invent facts or fill gaps from training memory. ' +
        'If a resolved company identity is provided above, you MUST treat it as authoritative ground truth and MUST NOT contradict it. ' +
        'Return ONLY valid JSON (no markdown, no extra text).'
    },
    {
      role: 'user',
      content:
        `Ticker: ${ticker}\n` +
        'Identity rule (critical): Use ONLY the resolved company above. Do not mix other entities with similar names/tickers. ' +
        'Do NOT claim the ticker “resolves to” any other company; if evidence conflicts, flag as potential mismatch and do not merge facts.\n\n' +
        (company?.exchange ? `Exchange (resolved): ${company.exchange}\n` : '') +
        (company?.cik ? `CIK (resolved): ${company.cik}\n` : '') +
        `Horizon: ${horizonDays} days\n` +
        `Rules-based score: ${score ?? '—'} / 100 (bucket=${bucket || '—'})\n` +
        (baseSummary ? `Rules-based summary: ${baseSummary}\n\n` : '\n') +
        (driverLines ? `Drivers (rules-based):\n${driverLines}\n\n` : '') +
        'Evidence items (newest first):\n' +
        (evidenceLines || '—') +
        '\n\n' +
        'Identity rule: Use ONLY the resolved company above. If any evidence appears to reference a different entity, flag it as potential mismatch rather than merging facts. ' +
        'Do NOT override the resolved identity based on conflicting evidence.\n\n' +
        'Task: Summarize dilution risk for a trader/investor.\n' +
        'Return JSON with this schema:\n' +
        '{\n' +
        '  "summary": string,\n' +
        '  "risk_factors": [\n' +
        '    {\n' +
        '      "label": string,\n' +
        '      "severity": "low"|"medium"|"high",\n' +
        '      "evidence_ids": string[],\n' +
        '      "rationale": string\n' +
        '    }\n' +
        '  ],\n' +
        '  "watchlist": string[],\n' +
        '  "confidence": number\n' +
        '}\n\n' +
        'Rules:\n' +
        '- Keep summary <= 8 lines.\n' +
        '- Every risk_factors entry must cite evidence_ids like "E1".\n' +
        '- If evidence is weak, say so and lower confidence.\n'
    }
  ];

  const result = await aiChatJson({ provider, model, messages, temperature: 0.2 });
  const evidenceIds = new Set(evidence.map((e) => e.id));
  return validateAiPayload(result, { evidenceIds });
}
