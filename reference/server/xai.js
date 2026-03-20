import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

import { recordXaiAttempt, recordXaiFailure, recordXaiSuccess } from './xaiMetrics.js';
import { createXaiLogWriter } from './xaiLog.js';
import { parseJsonFromText } from './jsonExtract.js';
import { getSetting } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const xaiLogDir = process.env.LOG_DIR
  ? path.resolve(rootDir, process.env.LOG_DIR)
  : path.join(rootDir, 'logs');
const xaiLogFilePath = process.env.XAI_LOG_FILE
  ? path.resolve(rootDir, process.env.XAI_LOG_FILE)
  : path.join(xaiLogDir, 'xai.log');
const xaiLog = createXaiLogWriter({ logFilePath: xaiLogFilePath });

async function readApiKey() {
  const fromDb = getSetting('xai_api_key');
  if (fromDb && fromDb.trim()) {
    return fromDb.trim();
  }

  throw new Error('xAI API key is not configured. Open Settings and paste your xAI key.');
}

function redactHeaders(headers) {
  const h = headers && typeof headers === 'object' ? { ...headers } : {};
  if (h.Authorization) h.Authorization = 'Bearer [REDACTED]';
  if (h.authorization) h.authorization = 'Bearer [REDACTED]';
  return h;
}

export async function xaiListModels() {
  const apiKey = await readApiKey();
  const baseUrl = process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1';
  const url = `${baseUrl}/models`;

  const controller = new AbortController();
  const timeoutMs = Number(process.env.XAI_TIMEOUT_MS || 120000);
  const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, 15000));

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(
          `xAI authentication failed (${resp.status}). Check your xAI API key in Settings.`
        );
      }
      throw new Error(`xAI models list failed: ${resp.status} ${resp.statusText}${body ? ` - ${body}` : ''}`);
    }

    const payload = await resp.json().catch(() => ({}));
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data
      .map((m) => (typeof m?.id === 'string' ? m.id : null))
      .filter(Boolean);
  } catch (err) {
    if (err && typeof err === 'object' && (err.name === 'AbortError' || String(err).includes('AbortError'))) {
      throw new Error('xAI models list timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function extractTextFromChatCompletion(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

function safeJsonParse(text) {
  return parseJsonFromText(text);
}

export async function xaiChatJson({ model, messages, temperature = 0 }) {
  recordXaiAttempt();
  const apiKey = await readApiKey();
  const apiUrl = process.env.XAI_API_URL || 'https://api.x.ai/v1/chat/completions';

  const requestId = crypto.randomUUID();

  const controller = new AbortController();
  const timeoutMs = Number(process.env.XAI_TIMEOUT_MS || 120000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const requestHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
  const requestBody = {
    model,
    messages,
    temperature
  };

  async function safeLog(promise) {
    try {
      await promise;
    } catch {
      // ignore
    }
  }

  const startedAt = Date.now();
  // Keep only the most recent xAI request in the log file.
  await safeLog(xaiLog.clear());
  await safeLog(xaiLog.header('REQUEST'));
  await safeLog(xaiLog.separator({ requestId, model, url: apiUrl }));
  await safeLog(
    xaiLog.logRequest({
      requestId,
      url: apiUrl,
      model,
      temperature,
      headers: redactHeaders(requestHeaders),
      body: requestBody
    })
  );

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const err =
        resp.status === 401 || resp.status === 403
          ? new Error(`xAI authentication failed (${resp.status}). Check your xAI API key in Settings.`)
          : new Error(`xAI request failed: ${resp.status} ${resp.statusText}${body ? ` - ${body}` : ''}`);
      await safeLog(xaiLog.header('RESPONSE'));
      await safeLog(
        xaiLog.logResponse({ requestId, status: resp.status, ms: Date.now() - startedAt, rawText: body })
      );
      throw err;
    }

    const payload = await resp.json();
    const text = extractTextFromChatCompletion(payload);
    if (!text) throw new Error('xAI response missing message content.');

    const json = safeJsonParse(text);
    if (!json) {
      throw new Error('xAI response was not valid JSON.');
    }

    await safeLog(xaiLog.header('RESPONSE'));
    await safeLog(
      xaiLog.logResponse({
        requestId,
        status: resp.status,
        ms: Date.now() - startedAt,
        rawText: text,
        parsedJson: json
      })
    );

    recordXaiSuccess();
    return json;
  } catch (err) {
    recordXaiFailure(err);
    await safeLog(xaiLog.header('RESPONSE'));
    await safeLog(xaiLog.logError({ requestId, ms: Date.now() - startedAt, error: err }));

    if (err && typeof err === 'object' && (err.name === 'AbortError' || String(err).includes('AbortError'))) {
      throw new Error(`xAI request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function xaiChatText({ model, messages, temperature = 0 }) {
  recordXaiAttempt();
  const apiKey = await readApiKey();
  const apiUrl = process.env.XAI_API_URL || 'https://api.x.ai/v1/chat/completions';

  const requestId = crypto.randomUUID();

  const controller = new AbortController();
  const timeoutMs = Number(process.env.XAI_TIMEOUT_MS || 120000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const requestHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
  const requestBody = {
    model,
    messages,
    temperature
  };

  async function safeLog(promise) {
    try {
      await promise;
    } catch {
      // ignore
    }
  }

  const startedAt = Date.now();
  await safeLog(xaiLog.clear());
  await safeLog(xaiLog.header('REQUEST'));
  await safeLog(xaiLog.separator({ requestId, model, url: apiUrl }));
  await safeLog(
    xaiLog.logRequest({
      requestId,
      url: apiUrl,
      model,
      temperature,
      headers: redactHeaders(requestHeaders),
      body: requestBody
    })
  );

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const err =
        resp.status === 401 || resp.status === 403
          ? new Error(`xAI authentication failed (${resp.status}). Check your xAI API key in Settings.`)
          : new Error(`xAI request failed: ${resp.status} ${resp.statusText}${body ? ` - ${body}` : ''}`);
      await safeLog(xaiLog.header('RESPONSE'));
      await safeLog(
        xaiLog.logResponse({ requestId, status: resp.status, ms: Date.now() - startedAt, rawText: body })
      );
      throw err;
    }

    const payload = await resp.json();
    const text = extractTextFromChatCompletion(payload);
    if (!text) throw new Error('xAI response missing message content.');

    await safeLog(xaiLog.header('RESPONSE'));
    await safeLog(
      xaiLog.logResponse({ requestId, status: resp.status, ms: Date.now() - startedAt, rawText: text })
    );

    recordXaiSuccess();
    return text;
  } catch (err) {
    recordXaiFailure(err);
    await safeLog(xaiLog.header('RESPONSE'));
    await safeLog(xaiLog.logError({ requestId, ms: Date.now() - startedAt, error: err }));

    if (err && typeof err === 'object' && (err.name === 'AbortError' || String(err).includes('AbortError'))) {
      throw new Error(`xAI request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
