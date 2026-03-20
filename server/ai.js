import { getSetting } from './db.js';

export function normalizeProvider(raw) {
  const provider = String(raw || '').trim().toLowerCase();
  if (!provider || provider === 'gemini' || provider === 'google') return 'gemini';
  if (provider === 'xai' || provider === 'grok') return 'xai';
  throw new Error('Invalid provider. Use gemini or xai.');
}

export function defaultModelForProvider(provider) {
  return provider === 'xai'
    ? process.env.XAI_MODEL || 'grok-4-1-fast-reasoning'
    : process.env.GEMINI_MODEL || 'models/gemini-2.5-pro';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function readErrorBody(resp) {
  return resp.text().catch(() => '');
}

async function fetchWithRetry(url, options, { label, maxAttempts = 3, baseDelayMs = 1200 } = {}) {
  let lastResp = null;
  let lastBody = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const resp = await fetch(url, options);
    if (resp.ok) return resp;

    lastResp = resp;
    lastBody = await readErrorBody(resp);
    if (!isRetryableStatus(resp.status) || attempt >= maxAttempts) break;
    await sleep(baseDelayMs * attempt);
  }

  const detail = lastBody ? `: ${lastBody}` : '';
  throw new Error(`${label} request failed (${lastResp?.status || 'unknown'})${detail}`);
}

function parseJsonFromText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function getGeminiKey() {
  const apiKey = String(getSetting('gemini_api_key') || '').trim();
  if (!apiKey) throw new Error('Gemini API key is not configured. Open Settings and paste your Gemini key.');
  return apiKey;
}

async function getXaiKey() {
  const apiKey = String(getSetting('xai_api_key') || '').trim();
  if (!apiKey) throw new Error('xAI API key is not configured. Open Settings and paste your xAI key.');
  return apiKey;
}

export async function listModels(provider) {
  const normalized = normalizeProvider(provider);
  if (normalized === 'xai') {
    const apiKey = await getXaiKey();
    const baseUrl = process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1';
    const resp = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    if (!resp.ok) throw new Error('Failed to load xAI models');
    const payload = await resp.json().catch(() => ({}));
    return (Array.isArray(payload?.data) ? payload.data : []).map((item) => item?.id).filter(Boolean);
  }

  const apiKey = await getGeminiKey();
  const baseUrl = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta';
  const resp = await fetch(`${baseUrl}/models`, {
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) throw new Error('Failed to load Gemini models');
  const payload = await resp.json().catch(() => ({}));
  return (Array.isArray(payload?.models) ? payload.models : []).map((item) => item?.name).filter(Boolean);
}

async function geminiChatText({ model, messages, temperature = 0.2 }) {
  const apiKey = await getGeminiKey();
  const baseUrl = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta';
  const modelName = String(model || '').replace(/^models\//, '') || 'gemini-2.5-pro';
  const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const userText = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n');
  const resp = await fetchWithRetry(`${baseUrl}/models/${encodeURIComponent(modelName)}:generateContent`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { temperature }
    })
  }, {
    label: 'Gemini',
    maxAttempts: 3,
    baseDelayMs: 1500
  });
  const payload = await resp.json().catch(() => ({}));
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text');
  return text;
}

async function xaiChatText({ model, messages, temperature = 0.2 }) {
  const apiKey = await getXaiKey();
  const apiUrl = process.env.XAI_API_URL || 'https://api.x.ai/v1/chat/completions';
  const resp = await fetchWithRetry(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, messages, temperature })
  }, {
    label: 'xAI',
    maxAttempts: 3,
    baseDelayMs: 1500
  });
  const payload = await resp.json().catch(() => ({}));
  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error('xAI returned no text');
  return text;
}

export async function chatText({ provider, model, messages, temperature = 0.2 }) {
  const normalized = normalizeProvider(provider);
  const pickedModel = model || defaultModelForProvider(normalized);
  if (normalized === 'xai') return xaiChatText({ model: pickedModel, messages, temperature });
  return geminiChatText({ model: pickedModel, messages, temperature });
}

export async function chatJson({ provider, model, messages, temperature = 0.2 }) {
  const text = await chatText({ provider, model, messages, temperature });
  const json = parseJsonFromText(text);
  if (!json || typeof json !== 'object') throw new Error('Model did not return valid JSON');
  return json;
}