let total = 0;
let success = 0;
let failure = 0;
let lastSuccessAt = null;
let lastFailureAt = null;
let lastFailureMessage = null;

function nowIso() {
  return new Date().toISOString();
}

export function recordXaiAttempt() {
  total += 1;
}

export function recordXaiSuccess() {
  success += 1;
  lastSuccessAt = nowIso();
}

export function recordXaiFailure(err) {
  failure += 1;
  lastFailureAt = nowIso();

  const message = err instanceof Error ? err.message : String(err);
  // Keep this short so we don't accidentally log huge payloads.
  lastFailureMessage = message.length > 300 ? message.slice(0, 300) + '…' : message;
}

export function getXaiMetrics() {
  return {
    total,
    success,
    failure,
    lastSuccessAt,
    lastFailureAt,
    lastFailureMessage
  };
}
