export function formatUsd(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function formatUsdPrice(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export function formatPriceTarget({ fromUsd, toUsd }) {
  const hasFrom = typeof fromUsd === 'number' && Number.isFinite(fromUsd);
  const hasTo = typeof toUsd === 'number' && Number.isFinite(toUsd);
  if (hasFrom && hasTo) return `PT ${formatUsdPrice(fromUsd)} → ${formatUsdPrice(toUsd)}`;
  if (hasTo) return `PT ${formatUsdPrice(toUsd)}`;
  if (hasFrom) return `PT ${formatUsdPrice(fromUsd)}`;
  return '';
}

export function formatConsensusTargets(consensus) {
  if (!consensus || typeof consensus !== 'object') return '—';
  const parts = [];
  if (typeof consensus.lowUsd === 'number') parts.push(`Low ${formatUsdPrice(consensus.lowUsd)}`);
  if (typeof consensus.meanUsd === 'number') parts.push(`Mean ${formatUsdPrice(consensus.meanUsd)}`);
  if (typeof consensus.medianUsd === 'number') parts.push(`Median ${formatUsdPrice(consensus.medianUsd)}`);
  if (typeof consensus.highUsd === 'number') parts.push(`High ${formatUsdPrice(consensus.highUsd)}`);
  const base = parts.length ? parts.join(' • ') : '—';
  if (typeof consensus.analystCount === 'number') return `${base} (n=${consensus.analystCount})`;
  return base;
}

export function formatMonths(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `${n} months`;
}

export function formatPct(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `${n}%`;
}

export function formatDateTime(iso) {
  if (typeof iso !== 'string' || !iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export function sortByPublishedAtDesc(items) {
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) => {
    const ta = a?.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b?.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });
}
