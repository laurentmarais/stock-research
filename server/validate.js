export function normalizeTicker(input) {
  if (typeof input !== 'string') throw new Error('ticker is required');
  const ticker = input.trim().toUpperCase();
  if (!ticker) throw new Error('ticker is required');
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) throw new Error('ticker has invalid format');
  return ticker;
}

export function asOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}