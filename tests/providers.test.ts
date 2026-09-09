import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletionsConnection, ollamaConnection } from '../src/providers/index.js';
import type { DecisionContext } from '../src/runner/index.js';
const context: DecisionContext = { runId: 'run:test', requestId: 'request:1', instanceId: 'actor:a', character: { name: 'A' }, stateRevision: 0, intentions: [], memories: [], observations: [], tools: [], outcomes: [], model: { provider: 'ollama', model: 'explicit', settings: {} } };
afterEach(() => vi.unstubAllGlobals());
describe('local and compatible provider transports', () => {
  it('opts into a tool-constrained schema without imposing an output token cap', async () => {
    const request = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: '{"toolId":null,"arguments":{}}' } }] })));
    vi.stubGlobal('fetch', request);
    const provider = chatCompletionsConnection({ provider: 'test', model: 'test', endpoint: 'https://provider.example/chat', structuredOutputs: true });
    await provider.fulfill(context, new AbortController().signal);
    const body = JSON.parse(request.mock.calls[0]![1].body as string);
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true, schema: { additionalProperties: false, required: ['toolId', 'arguments'], properties: { toolId: { enum: [null] } } } } });
    expect(body).not.toHaveProperty('max_tokens');
    expect(provider.capabilities.jsonSchema).toBe(true);
  });
  it.each([
    { payload: { choices: [{ finish_reason: 'length', message: { content: null } }], usage: { completion_tokens: 512, completion_tokens_details: { reasoning_tokens: 512 } } }, reason: 'OUTPUT_LIMIT' },
    { payload: { choices: [{ finish_reason: 'stop', message: { content: null } }] }, reason: 'MISSING_OUTPUT' },
    { payload: { error: { code: 503, message: 'private-provider-response' } }, reason: 'HTTP_ERROR' },
  ])('classifies $reason without leaking the response body', async ({ payload, reason }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload))));
    const provider = ollamaConnection('explicit');
    const error = await provider.fulfill(context, new AbortController().signal).catch(error => error);
    expect(error.diagnostic).toMatchObject({ reason });
    if (reason === 'OUTPUT_LIMIT') expect(error.diagnostic).toMatchObject({ outputTokens: 512, reasoningTokens: 512 });
    expect(JSON.stringify(error)).not.toContain('private-provider-response');
  });
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
    expect(JSON.parse(calls[0].init.body as string)).not.toHaveProperty('max_tokens');
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

it('retains cache, reasoning and provider routing evidence without recording credentials', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'gen-example', provider: 'Example Provider',
    choices: [{ finish_reason: 'stop', message: { content: '{"toolId":null,"arguments":{}}' } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001, prompt_tokens_details: { cached_tokens: 70 }, completion_tokens_details: { reasoning_tokens: 12 } },
  }))));
  const connection = chatCompletionsConnection({ provider: 'test', model: 'explicit', endpoint: 'https://provider.example/chat', apiKey: 'private-test-credential' });
  const result = await connection.fulfill(context, new AbortController().signal);
  expect(result).toMatchObject({ usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 70, reasoningTokens: 12, cost: 0.001 }, telemetry: { provider: 'Example Provider', generationId: 'gen-example', finishReason: 'stop' } });
  expect(JSON.stringify(result)).not.toContain('private-test-credential');
});
