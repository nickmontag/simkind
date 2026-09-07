import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readOpenRouterConfig } from '../examples/openrouter-env.js';
import { createOpenRouterJsonProvider } from '../examples/openrouter-provider.js';
import { createSettlementOpenRouterProvider } from '../demos/settlement-crisis/openrouter.js';
import { createSettlement } from '../demos/settlement-crisis/engine.js';
import { runSettlement } from '../demos/settlement-crisis/provider.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', undefined);
  vi.stubEnv('OPENROUTER_MODEL', undefined);
  vi.mocked(readFile).mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each([
  ['examples', async () => (await readOpenRouterConfig()).model],
  ['settlement', async () => (await createSettlementOpenRouterProvider()).name],
] as const)('%s model configuration', (_name, loadModel) => {
  it('requires an explicit model instead of silently choosing one', async () => {
    vi.mocked(readFile).mockResolvedValue('OPENROUTER_API_KEY=test-key\n');
    await expect(loadModel()).rejects.toThrow('Set OPENROUTER_MODEL');
  });

  it('reads a quoted model ID from .env', async () => {
    vi.mocked(readFile).mockResolvedValue('OPENROUTER_API_KEY=test-key\nOPENROUTER_MODEL="example/chosen-model"\n');
    await expect(loadModel()).resolves.toBe('example/chosen-model');
  });

  it('supports environment overrides and runs without a .env file', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'environment-key');
    vi.stubEnv('OPENROUTER_MODEL', 'example/override');
    vi.mocked(readFile).mockResolvedValue('OPENROUTER_API_KEY=file-key\nOPENROUTER_MODEL=example/file-model\n');
    await expect(loadModel()).resolves.toBe('example/override');
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(loadModel()).resolves.toBe('example/override');
  });

  it('gives setup instructions when no key exists', async () => {
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(loadModel()).rejects.toThrow('Set OPENROUTER_API_KEY');
  });
});

it('sends the selected model through both live adapters without model-specific reasoning settings', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ kind: 'Wait' }) } }],
  }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const provider = createOpenRouterJsonProvider('test-key', 'example/first-model', {
    schemaName: 'test', schema: {}, prompt: () => 'Wait', output: (_request, value) => value,
  });
  await provider.fulfill({});
  vi.mocked(readFile).mockResolvedValue('OPENROUTER_API_KEY=test-key\nOPENROUTER_MODEL=example/second-model\n');
  await runSettlement(createSettlement(), await createSettlementOpenRouterProvider(), 1);
  expect(fetchMock).toHaveBeenCalledTimes(7);
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
  expect(JSON.parse(String(calls[0]![1].body)).model).toBe('example/first-model');
  for (const [, options] of calls.slice(1)) {
    expect(JSON.parse(String(options.body)).model).toBe('example/second-model');
  }
  for (const [, options] of calls) {
    expect(JSON.parse(String(options.body))).not.toHaveProperty('reasoning');
  }
});
