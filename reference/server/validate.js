export function normalizeTicker(input) {
  if (typeof input !== 'string') {
    throw new Error('ticker is required');
  }

  const ticker = input.trim().toUpperCase();
  if (!ticker) throw new Error('ticker is required');

  // US exchange tickers (Nasdaq/NYSE/NYSE Arca/Cboe) commonly include letters, digits, and sometimes '.' or '-'
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    throw new Error('ticker has invalid format');
  }

  return ticker;
}
