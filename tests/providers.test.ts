import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletionsConnection, ollamaConnection } from '../src/providers/index.js';
import type { DecisionContext } from '../src/runner/index.js';
const context: DecisionContext = { runId: 'run:test', requestId: 'request:1', instanceId: 'actor:a', character: { name: 'A' }, stateRevision: 0, intentions: [], memories: [], observations: [], tools: [], outcomes: [], model: { provider: 'ollama', model: 'explicit', settings: {} } };
afterEach(() => vi.unstubAllGlobals());
describe('local and compatible provider transports', () => {
  it('selects a local model explicitly and sends JSON context without authorization', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ choices: [{ message: { content: '{"toolId":null,"arguments":{}}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } })); }));
    const provider = ollamaConnection('chosen-local-model');
    const controller = new AbortController(); const result = await provider.fulfill(context, controller.signal);
    expect(calls[0].url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(calls[0].init.headers).not.toHaveProperty('Authorization');
    expect(calls[0].init.signal).toBe(controller.signal);
    expect(calls[0].init.redirect).toBe('error');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ model: 'chosen-local-model', response_format: { type: 'json_object' } });
    expect(result.usage).toMatchObject({ inputTokens: 5, outputTokens: 3 });
  });
  it('rejects insecure remote endpoints, URL credentials, and omitted models', () => {
    expect(() => ollamaConnection('')).toThrow('explicit');
    const credentialUrl = new URL('https://provider.example/chat'); credentialUrl.username = 'test-user'; credentialUrl.password = 'test-password';
    for (const endpoint of ['http://remote.example/v1/chat/completions', credentialUrl.href, 'file:///tmp/model']) expect(() => chatCompletionsConnection({ provider: 'test', model: 'test', endpoint })).toThrow();
  });
  it('does not retry failed requests or expose the provider response body', async () => {
    const request = vi.fn(async () => new Response('private-provider-response', { status: 429 })); vi.stubGlobal('fetch', request);
    const provider = chatCompletionsConnection({ provider: 'test', model: 'test', endpoint: 'https://provider.example/chat', apiKey: 'local-test-key' });
    await expect(provider.fulfill(context, new AbortController().signal)).rejects.toThrow('HTTP 429');
    expect(request).toHaveBeenCalledTimes(1); expect(JSON.stringify(provider.public)).not.toContain('local-test-key');
  });
});
