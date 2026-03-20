import { xaiChatJson, xaiChatText } from './xai.js';
import { geminiChatJson, geminiChatText } from './gemini.js';

export function normalizeProvider(raw) {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!v) return 'xai';
  if (v === 'xai' || v === 'grok') return 'xai';
  if (v === 'gemini' || v === 'google') return 'gemini';
  throw new Error('Invalid provider. Use provider=xai or provider=gemini.');
}

export async function aiChatJson({ provider, model, messages, temperature = 0 }) {
  if (provider === 'gemini') {
    return geminiChatJson({ model, messages, temperature });
  }
  return xaiChatJson({ model, messages, temperature });
}

export async function aiChatText({ provider, model, messages, temperature = 0 }) {
  if (provider === 'gemini') {
    return geminiChatText({ model, messages, temperature });
  }
  return xaiChatText({ model, messages, temperature });
}
