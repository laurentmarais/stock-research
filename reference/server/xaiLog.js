import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

function nowIso() {
  return new Date().toISOString();
}

function truncate(text, maxLen) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

function sanitizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === 'authorization') {
      out[k] = 'Bearer [REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => ({
    role: m?.role,
    content: truncate(String(m?.content ?? ''), 2000)
  }));
}

export function createXaiLogWriter({ logFilePath }) {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });

  // Ensure writes stay ordered even if callers don't await.
  let queue = Promise.resolve();
  function enqueue(op) {
    queue = queue.then(op).catch(() => undefined);
    return queue;
  }

  function clear() {
    return enqueue(async () => {
      try {
        await fsp.writeFile(logFilePath, '', 'utf8');
      } catch {
        // ignore
      }
    });
  }

  function append(entry) {
    const line = JSON.stringify(entry);
    return enqueue(() => fsp.appendFile(logFilePath, line + '\n', 'utf8'));
  }

  function appendRaw(line) {
    return enqueue(() => fsp.appendFile(logFilePath, line + '\n', 'utf8'));
  }

  function header(label) {
    const text = String(label ?? '').toUpperCase();
    return enqueue(async () => {
      await fsp.appendFile(logFilePath, text + '\n', 'utf8');
      await fsp.appendFile(logFilePath, '-'.repeat(text.length) + '\n', 'utf8');
    });
  }

  return {
    clear,
    header,
    async separator({ requestId, model, url }) {
      await appendRaw(
        `-------------------- XAI REQUEST ${requestId} ${model} ${url} --------------------`
      );
    },

    async logRequest({ requestId, url, model, temperature, headers, body }) {
      await append({
        ts: nowIso(),
        type: 'request',
        requestId,
        url,
        model,
        temperature,
        headers: sanitizeHeaders(headers),
        messages: sanitizeMessages(body?.messages)
      });
    },

    async logResponse({ requestId, status, ms, rawText, parsedJson }) {
      await append({
        ts: nowIso(),
        type: 'response',
        requestId,
        status,
        ms,
        rawText: rawText ? truncate(rawText, 6000) : null,
        parsedJson: parsedJson ?? null
      });
    },

    async logError({ requestId, ms, error }) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : null;
      await append({
        ts: nowIso(),
        type: 'error',
        requestId,
        ms,
        message: truncate(message, 2000),
        stack: stack ? truncate(stack, 6000) : null
      });
    }
  };
}
