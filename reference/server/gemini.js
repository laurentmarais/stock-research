import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

import { recordGeminiAttempt, recordGeminiFailure, recordGeminiSuccess } from './geminiMetrics.js';
import { createGeminiLogWriter } from './geminiLog.js';
import { parseJsonFromText } from './jsonExtract.js';
import { getSetting } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const geminiLogDir = process.env.LOG_DIR ? path.resolve(rootDir, process.env.LOG_DIR) : path.join(rootDir, 'logs');
const geminiLogFilePath = process.env.GEMINI_LOG_FILE
  ? path.resolve(rootDir, process.env.GEMINI_LOG_FILE)
  : path.join(geminiLogDir, 'gemini.log');

const geminiLog = createGeminiLogWriter({ logFilePath: geminiLogFilePath });

async function readApiKey() {
  const fromDb = getSetting('gemini_api_key');
  if (fromDb && fromDb.trim()) {
    return fromDb.trim();
  }

  throw new Error('Gemini API key is not configured. Open Settings and paste your Gemini key.');
}

function redactHeaders(headers) {
  const h = headers && typeof headers === 'object' ? { ...headers } : {};
  if (h['x-goog-api-key']) h['x-goog-api-key'] = '[REDACTED]';
  if (h['X-Goog-Api-Key']) h['X-Goog-Api-Key'] = '[REDACTED]';
  return h;
}

function safeJsonParse(text) {
  return parseJsonFromText(text);
}

function extractTextFromGenerateContent(payload) {
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? text : null;
}

function normalizeModelName(model) {
  const m = typeof model === 'string' ? model.trim() : '';
  if (!m) return '';
  return m.startsWith('models/') ? m.slice('models/'.length) : m;
}

async function listModels({ apiKey, baseUrl, signal }) {
  const url = `${baseUrl}/models`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    signal
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403 || body.toLowerCase().includes('api key')) {
      throw new Error(`Gemini authentication failed (${resp.status}). Check your Gemini API key in Settings.`);
    }
    throw new Error(
      `Gemini ListModels failed: ${resp.status} ${resp.statusText}${body ? ` - ${body}` : ''}`
    );
  }

  const payload = await resp.json().catch(() => ({}));
  const models = Array.isArray(payload?.models) ? payload.models : [];

  return models
    .map((m) => {
      const name = typeof m?.name === 'string' ? m.name : '';
      const supported = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      return {
        name,
        supportedGenerationMethods: supported
      };
    })
    .filter((m) => m.name);
}

export async function geminiListModels() {
  const apiKey = await readApiKey();
  const baseUrl = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta';

  const controller = new AbortController();
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 120000);
  const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, 15000));
  try {
    return await listModels({ apiKey, baseUrl, signal: controller.signal });
  } catch (err) {
    if (err && typeof err === 'object' && (err.name === 'AbortError' || String(err).includes('AbortError'))) {
      throw new Error('Gemini ListModels timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function pickPreferredGenerateContentModel(models) {
  const canGenerate = models.filter((m) =>
    (m.supportedGenerationMethods || []).some((x) => String(x).toLowerCase() === 'generatecontent')
  );
  if (!canGenerate.length) return null;

  const rank = (name) => {
    const n = String(name || '').toLowerCase();
    if (n.includes('gemini-2.5-pro')) return 0;
    if (n.includes('gemini-2.0-flash')) return 1;
    if (n.includes('gemini-1.5-flash')) return 2;
    if (n.includes('gemini-2.0-pro')) return 3;
    if (n.includes('gemini-1.5-pro')) return 4;
    if (n.includes('flash')) return 5;
    if (n.includes('pro')) return 6;
    return 50;
  };

  const sorted = [...canGenerate].sort((a, b) => rank(a.name) - rank(b.name));
  return sorted[0]?.name || null;
}

function toSystemAndUserText(messages) {
  const system = [];
  const user = [];
  for (const m of messages || []) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role;
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content) continue;
    if (role === 'system') system.push(content);
    else user.push(content);
  }
  return {
    systemText: system.join('\n\n').trim(),
    userText: user.join('\n\n').trim()
  };
}

export async function geminiChatJson({ model, messages, temperature = 0 }) {
  recordGeminiAttempt();
  const apiKey = await readApiKey();

  const baseUrl = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta';
  const normalizedModel = normalizeModelName(model);
  const urlForModel = (m) => `${baseUrl}/models/${encodeURIComponent(normalizeModelName(m))}:generateContent`;
  const url = urlForModel(normalizedModel);

  const requestId = crypto.randomUUID();

  const controller = new AbortController();
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 120000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const requestHeaders = {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey
  };

  const { systemText, userText } = toSystemAndUserText(messages);

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userText || '' }]
      }
    ],
    generationConfig: {
      temperature
    }
  };

  if (systemText) {
    requestBody.systemInstruction = {
      parts: [{ text: systemText }]
    };
  }

  async function safeLog(promise) {
    try {
      await promise;
    } catch {
      // ignore
    }
  }

  const startedAt = Date.now();
  await safeLog(geminiLog.clear());
  await safeLog(geminiLog.header('REQUEST'));
  await safeLog(geminiLog.separator({ requestId, model: normalizedModel, url }));
  await safeLog(
    geminiLog.logRequest({
      requestId,
      url,
      model: normalizedModel,
      temperature,
      headers: redactHeaders(requestHeaders),
      body: requestBody,
      messages
    })
  );

  async function doRequest(modelName) {
    const requestUrl = urlForModel(modelName);
    const resp = await fetch(requestUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    return { resp, requestUrl };
  }

  try {
    let activeModel = normalizedModel;
    let { resp, requestUrl } = await doRequest(activeModel);

    // If the model name isn't valid for this key/API version, attempt to auto-pick a supported one.
    if (!resp.ok && resp.status === 404) {
      const bodyText = await resp.text().catch(() => '');
      const models = await listModels({ apiKey, baseUrl, signal: controller.signal }).catch(() => []);
      const picked = pickPreferredGenerateContentModel(models);
      if (picked) {
        activeModel = picked;
        await safeLog(geminiLog.header('RETRY'));
        await safeLog(geminiLog.separator({ requestId, model: activeModel, url: urlForModel(activeModel) }));
        ({ resp, requestUrl } = await doRequest(activeModel));
      } else {
        const err = new Error(
          `Gemini request failed: ${resp.status} ${resp.statusText}${bodyText ? ` - ${bodyText}` : ''}`
        );
        await safeLog(geminiLog.header('RESPONSE'));
        await safeLog(
          geminiLog.logResponse({ requestId, status: resp.status, ms: Date.now() - startedAt, rawText: bodyText })
        );
        throw err;
      }
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const lowerBody = String(body || '').toLowerCase();
      const err =
        resp.status === 401 ||
        resp.status === 403 ||
        lowerBody.includes('api key') ||
        lowerBody.includes('permission_denied')
          ? new Error(`Gemini authentication failed (${resp.status}). Check your Gemini API key in Settings.`)
          : new Error(`Gemini request failed: ${resp.status} ${resp.statusText}${body ? ` - ${body}` : ''}`);
      await safeLog(geminiLog.header('RESPONSE'));
      await safeLog(
        geminiLog.logResponse({ requestId, status: resp.status, ms: Date.now() - startedAt, rawText: body })
      );
      throw err;
    }

    const payload = await resp.json();
    const text = extractTextFromGenerateContent(payload);
    if (!text) throw new Error('Gemini response missing text content.');

    const json = safeJsonParse(text);
    if (!json) {
      throw new Error('Gemini response was not valid JSON.');
    }

    await safeLog(geminiLog.header('RESPONSE'));
    await safeLog(
      geminiLog.logResponse({
        requestId,
        status: resp.status,
        ms: Date.now() - startedAt,
        rawText: text,
        parsedJson: json
      })
    );

    recordGeminiSuccess();
    return json;
  } catch (err) {
    recordGeminiFailure(err);
    await safeLog(geminiLog.header('RESPONSE'));
    await safeLog(geminiLog.logError({ requestId, ms: Date.now() - startedAt, error: err }));

    if (err && typeof err === 'object' && (err.name === 'AbortError' || String(err).includes('AbortError'))) {
      throw new Error(`Gemini request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function geminiChatText({ model, messages, temperature = 0 }) {
  recordGeminiAttempt();
  const apiKey = await readApiKey();

  const baseUrl = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta';
  const normalizedModel = normalizeModelName(model);
  const urlForModel = (m) => `${baseUrl}/models/${encodeURIComponent(normalizeModelName(m))}:generateContent`;
  const url = urlForModel(normalizedModel);

  const requestId = crypto.randomUUID();

  const controller = new AbortController();
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 120000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const requestHeaders = {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey
  };

  const { systemText, userText } = toSystemAndUserText(messages);

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userText || '' }]
      }
    ],
    generationConfig: {
      temperature
    }
  };

  if (systemText) {
    requestBody.systemInstruction = {
      parts: [{ text: systemText }]
    };
  }

  async function safeLog(promise) {
    try {
      await promise;
    } catch {
      // ignore
    }
  }

  const startedAt = Date.now();
  await safeLog(geminiLog.clear());
  await safeLog(geminiLog.header('REQUEST'));
  await safeLog(geminiLog.separator({ requestId, model: normalizedModel, url }));
  await safeLog(
    geminiLog.logRequest({
      requestId,
      url,
      model: normalizedModel,
      temperature,
      headers: redactHeaders(requestHeaders),
      body: requestBody,
      messages
    })
  );

  async function doRequest(modelName) {
    const requestUrl = urlForModel(modelName);
    const resp = await fetch(requestUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    return { resp, requestUrl };
  }

  try {
    let activeModel = normalizedModel;
    let { resp } = await doRequest(activeModel);

    if (!resp.ok && resp.status === 404) {
      const bodyText = await resp.text().catch(() => '');
      const models = await listModels({ apiKey, baseUrl, signal: controller.signal }).catch(() => []);
      const picked = pickPreferredGenerateContentModel(models);
      if (picked) {
        activeModel = picked;
        await safeLog(geminiLog.header('RETRY'));
        await safeLog(geminiLog.separator({ requestId, model: activeModel, url: urlForModel(activeModel) }));
        ({ resp } = await doRequest(activeModel));
      } else {
        const err = new Error(
          `Gemini request failed: ${resp.status} ${resp.statusText}${bodyText ? ` - ${bodyText}` : ''}`
        );
        await safeLog(geminiLog.header('RESPONSE'));
        await safeLog(
          geminiLog.logResponse({ requestId, status: resp.status, ms: Date.now() - startedAt, rawText: bodyText })
        );
        throw err;
      }
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const lowerBody = String(body || '').toLowerCase();
      const err =
        resp.status === 401 ||
        resp.status === 403 ||
        lowerBody.includes('api key') ||
        lowerBody.includes('permission_denied')
          ? new Error(`Gemini authentication failed (${resp.status}). Check your Gemini API key in Settings.`)
          : new Error(`Gemini request failed: ${resp.status} ${resp.statusText}${body ? ` - ${body}` : ''}`);
      await safeLog(geminiLog.header('RESPONSE'));
      await safeLog(
        geminiLog.logResponse({ requestId, status: resp.status, ms: Date.now() - startedAt, rawText: body })
      );
      throw err;
    }

    const payload = await resp.json().catch(() => ({}));
    const text = extractTextFromGenerateContent(payload);
    if (!text) throw new Error('Gemini response missing text content.');

    await safeLog(geminiLog.header('RESPONSE'));
    await safeLog(
      geminiLog.logResponse({ requestId, status: resp.status, ms: Date.now() - startedAt, rawText: text })
    );

    recordGeminiSuccess();
    return text;
  } catch (err) {
    recordGeminiFailure(err);
    await safeLog(geminiLog.header('RESPONSE'));
    await safeLog(geminiLog.logError({ requestId, ms: Date.now() - startedAt, error: err }));

    if (err && typeof err === 'object' && (err.name === 'AbortError' || String(err).includes('AbortError'))) {
      throw new Error(`Gemini request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
