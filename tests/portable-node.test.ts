import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario, saveRun, sha256 } from '../src/runner/node.js';
import { createCharacterRunner, type ModelConnection } from '../src/runner/index.js';
import { readDocument, readJson, validateRecord, type Scenario, type JsonObject } from '../src/format/index.js';
import { conversationHost } from '../examples/portable/hosts/conversation.js';
import { openRouterConnection } from '../examples/portable/openrouter.js';
import { vi } from 'vitest';

const temp: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), 'simkind-portable-')); temp.push(path); return path; }
const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
const envelope = { specVersion: '0.2.0-draft.2', kind: 'character', id: 'character:a', name: 'A' };
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(temp.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function write(root: string, path: string, value: unknown) { await writeFile(join(root, path), JSON.stringify(value)); }

describe('local resolution and immutable run artifacts', () => {
  it('hashes exact UTF-8 bytes and separately records compiled Markdown', async () => {
    const dir = await directory();
    const source = '```simkind\r\n' + JSON.stringify(envelope) + '\r\n```\r\nBody\r\n';
    await writeFile(join(dir, 'a.md'), source);
    const loaded = await loadScenario(dir, 'a.md', 'a.md');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.artifacts[0]).toMatchObject({ sha256: sha256(Buffer.from(source)), compiledPath: expect.any(String), compiledSha256: expect.any(String) });
    expect(loaded.value.artifacts[0].compiledSha256).not.toBe(loaded.value.artifacts[0].sha256);
    expect(loaded.value.sources['a.md']).toBe(source);
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it.each(['duplicate-id', 'mismatched-id', 'cycle', 'hash-mismatch', 'missing', 'utf8', 'oversized', 'symlink'])('rejects %s during resolution', async failure => {
    const dir = await directory();
    const child = { ...envelope, id: 'character:b' };
    const first = { ...envelope, resources: { 'character:b': { path: 'b.json' } } };
    if (failure === 'duplicate-id') {
      await write(dir, 'a.json', envelope); await write(dir, 'b.json', envelope);
      const result = await loadScenario(dir, 'a.json', 'b.json');
      expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'DUPLICATE_DOCUMENT_ID' }] }); return;
    }
    await write(dir, 'a.json', first);
    if (failure === 'mismatched-id') await write(dir, 'b.json', { ...child, id: 'character:c' });
    if (failure === 'cycle') await write(dir, 'b.json', { ...child, resources: { 'character:a': { path: 'a.json' } } });
    if (failure === 'hash-mismatch') { await write(dir, 'b.json', child); await write(dir, 'a.json', { ...first, resources: { 'character:b': { path: 'b.json', sha256: '0'.repeat(64) } } }); }
    if (failure === 'utf8') await writeFile(join(dir, 'b.json'), Buffer.from([0xff]));
    if (failure === 'oversized') await writeFile(join(dir, 'b.json'), ' '.repeat(1024 * 1024 + 1));
    if (failure === 'symlink') { const outside = await directory(); await write(outside, 'b.json', child); await symlink(join(outside, 'b.json'), join(dir, 'b.json')); }
    const expected = { 'mismatched-id': 'REFERENCE_MISMATCH', cycle: 'REFERENCE_CYCLE', 'hash-mismatch': 'HASH_MISMATCH', missing: 'RESOURCE_READ_FAILED', utf8: 'RESOURCE_READ_FAILED', oversized: 'DOCUMENT_TOO_LARGE', symlink: 'PATH_ESCAPE' }[failure];
    expect(await loadScenario(dir, 'a.json', 'a.json')).toMatchObject({ ok: false, diagnostics: [{ code: expected }] });
  });

  it('M2 adds a cast member and changes private knowledge through files alone', async () => {
    const dir = await directory(); await cp(root, dir, { recursive: true });
    const scene = JSON.parse(await readFile(join(dir, 'shared-decision.json'), 'utf8')) as Scenario;
    scene.cast.push({ instanceId: 'simkin:guest', characterRef: 'character:aya', initialState: { memories: [{ id: 'memory:guest', text: 'Only the guest knows this.', source: { kind: 'authored' } }] }, allowedTools: ['say'] });
    await write(dir, 'shared-decision.json', scene);
    const config = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    config.modelAssignments['simkin:guest'] = 'primary'; config.limits.maxInFlight = 4;
    await write(dir, 'config.json', config);
    const loaded = await loadScenario(dir, 'shared-decision.json', 'config.json'); if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    const seen: Record<string, string> = {};
    const primary: ModelConnection = { public: { provider: 'fixture', model: 'explicit', settings: {} }, capabilities: { text: true, json: true },
      fulfill: async context => { seen[context.instanceId] = JSON.stringify(context); return { output: { toolId: null, arguments: {} } }; } };
    const created = createCharacterRunner(loaded.value, conversationHost, { primary }, 'run:edited'); if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    created.value.step(); await created.value.settleDecisions();
    expect(Object.keys(seen)).toHaveLength(4); expect(seen['simkin:guest']).toContain('Only the guest knows this.'); expect(seen['simkin:aya']).not.toContain('Only the guest knows this.');
  });

  it('writes verifiable source/event hashes and refuses to overwrite an existing run', async () => {
    const loaded = await loadScenario(root, 'shared-decision.json', 'config.json'); if (!loaded.ok) throw new Error('fixture');
    const primary: ModelConnection & { apiKey: string } = { apiKey: 'test-private-connection-value', public: { provider: 'fixture', model: 'explicit', settings: {} }, capabilities: { text: true, json: true }, fulfill: async () => ({ output: { toolId: null, arguments: {} } }) };
    const created = createCharacterRunner(loaded.value, conversationHost, { primary }, 'run:save'); if (!created.ok) throw new Error('fixture');
    created.value.step(); await created.value.settleDecisions();
    const dir = join(await directory(), 'recorded');
    await saveRun(dir, created.value.manifest(), created.value.events(), loaded.value);
    const source = await readFile(join(dir, 'run.json'), 'utf8');
    const manifest = readDocument(source); if (!manifest.ok || manifest.value.kind !== 'run-bundle') throw new Error('manifest');
    const stream = await readFile(join(dir, 'events.jsonl'), 'utf8');
    expect(source + stream).not.toContain(primary.apiKey);
    expect(sha256(stream)).toBe(manifest.value.eventStreams[0].sha256);
    const events = stream.trim().split('\n').map(line => { const parsed = readJson(line); if (!parsed.ok) throw new Error('event'); return parsed.value; });
    expect(events.every(event => validateRecord('RunEvent', event).length === 0)).toBe(true);
    for (const input of manifest.value.inputs) expect(sha256(await readFile(join(dir, input.path)))).toBe(input.sha256);
    await expect(saveRun(dir, created.value.manifest(), created.value.events(), loaded.value)).rejects.toThrow();
    expect(await readFile(join(dir, 'run.json'), 'utf8')).toBe(source);
  });
});

describe('OpenRouter transport without paid calls', () => {
  it('keeps keys in transport, selects the exact model, requests JSON, and forwards cancellation', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, request: RequestInit) => {
      calls.push(request);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"toolId":null,"arguments":{}}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } }));
    }));
    const primary = openRouterConnection('test-key-for-header', 'explicit/provider-model', { temperature: 0.4, maxOutputTokens: 64 });
    const loaded = await loadScenario(root, 'shared-decision.json', 'config.json'); if (!loaded.ok) throw new Error('fixture');
    const created = createCharacterRunner(loaded.value, conversationHost, { primary }, 'run:provider'); if (!created.ok) throw new Error('fixture');
    created.value.step(); await created.value.settleDecisions();
    expect(calls).toHaveLength(3);
    const request = JSON.parse(calls[0].body as string);
    expect(request).toMatchObject({ model: 'explicit/provider-model', response_format: { type: 'json_object' }, provider: { require_parameters: true }, temperature: 0.4, max_tokens: 64 });
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer test-key-for-header' });
    expect(JSON.stringify(created.value.inspect()) + JSON.stringify(created.value.events())).not.toContain('test-key-for-header');
    expect((created.value.events().find(event => event.type === 'model-result')!.data as JsonObject).usage).toEqual({ inputTokens: 10, outputTokens: 5, cost: 0.001 });
    expect(() => openRouterConnection('key', '')).toThrow('explicit');
  });
});
