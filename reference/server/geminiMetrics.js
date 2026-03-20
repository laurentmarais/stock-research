let total = 0;
let success = 0;
let failure = 0;
let lastSuccessAt = null;
let lastFailureAt = null;
let lastFailureMessage = null;

function nowIso() {
  return new Date().toISOString();
}

export function recordGeminiAttempt() {
  total += 1;
}

export function recordGeminiSuccess() {
  success += 1;
  lastSuccessAt = nowIso();
}

export function recordGeminiFailure(err) {
  failure += 1;
  lastFailureAt = nowIso();

  const message = err instanceof Error ? err.message : String(err);
  lastFailureMessage = message.length > 300 ? message.slice(0, 300) + '…' : message;
}

export function getGeminiMetrics() {
  return {
    total,
    success,
    failure,
    lastSuccessAt,
    lastFailureAt,
    lastFailureMessage
  };
}
