import type { MemoryEmbeddings } from '../runner/memory-policy.js';
import { ProviderFailure } from '../runner/provider-error.js';

/** Optional HTTP adapter. No implicit model selection, retries, or downloads. */
export function compatibleMemoryEmbeddings(options: {
  id: string; model: string; endpoint: string; apiKey?: string; dimensions?: number;
}): MemoryEmbeddings {
  const selected = { ...options }, url = new URL(selected.endpoint);
  if (!selected.id.trim() || selected.id.length > 256 || !selected.model.trim()) throw new Error('Explicit embedding identity and model are required.');
  if (url.username || url.password || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS or loopback HTTP without URL credentials.');
  if (selected.dimensions !== undefined && (!Number.isSafeInteger(selected.dimensions) || selected.dimensions < 1 || selected.dimensions > 4096)) throw new Error('Embedding dimensions must be between 1 and 4096.');
  return {
    id: selected.id,
    async embed(texts, signal) {
      if (!Array.isArray(texts) || !texts.length || texts.length > 64 || texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 6000)) throw new Error('Invalid bounded embedding batch.');
      const response = await fetch(url, { method: 'POST', signal, redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...(selected.apiKey ? { Authorization: `Bearer ${selected.apiKey}` } : {}) },
        body: JSON.stringify({ model: selected.model, input: texts, encoding_format: 'float', ...(selected.dimensions ? { dimensions: selected.dimensions } : {}) }),
      }).catch(() => { throw new ProviderFailure('NETWORK_ERROR'); });
      if (!response.ok) throw new ProviderFailure('HTTP_ERROR', { httpStatus: response.status });
      const payload = await response.json().catch(() => { throw new ProviderFailure('INVALID_RESPONSE'); }) as {
        data?: { index: number; embedding: number[] }[]; usage?: { prompt_tokens?: number; cost?: number };
      } | null;
      if (!payload || !Array.isArray(payload.data) || payload.data.length !== texts.length || payload.data.some(row => !row || typeof row !== 'object')) throw new ProviderFailure('INVALID_RESPONSE');
      const rows = [...payload.data].sort((a, b) => a.index - b.index);
      if (rows.some((row, index) => !row || row.index !== index || !Array.isArray(row.embedding) || !row.embedding.length || row.embedding.length > 4096
        || row.embedding.some(n => typeof n !== 'number' || !Number.isFinite(n)) || selected.dimensions && row.embedding.length !== selected.dimensions
        || row.embedding.length !== rows[0].embedding.length)) throw new ProviderFailure('INVALID_RESPONSE');
      return { vectors: rows.map(row => row.embedding), usage: { inputTokens: payload.usage?.prompt_tokens, cost: payload.usage?.cost } };
    },
  };
}
