export function sentimentToBadge(sentiment) {
  const s = String(sentiment || '').trim().toLowerCase();
  if (s === 'positive') return { label: 'positive', color: 'green', textColor: 'var(--mantine-color-green-3)' };
  if (s === 'negative') return { label: 'negative', color: 'red', textColor: 'var(--mantine-color-red-3)' };
  if (s === 'neutral') return { label: 'neutral', color: 'gray', textColor: 'var(--mantine-color-white)' };
  return { label: sentiment || 'unknown', color: 'gray', textColor: 'var(--mantine-color-white)' };
}
