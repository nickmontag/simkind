import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CharacterMemory, contextProfile } from '../src/runner/long-memory.js';
import { createSituationalMemoryPolicy, type MemoryPolicy, type MemoryView, type MemoryEmbeddings } from '../src/runner/memory-policy.js';
import { MemoryRunnerStorage, type RunnerStorage } from '../src/runner/storage.js';
import { SqliteRunnerStorage } from '../src/runner/sqlite-storage.js';
import { CharacterRunner, createCharacterRunner, type DecisionContext, type ModelConnection } from '../src/runner/index.js';
import { loadScenario } from '../src/runner/node.js';
import { conversationHost } from '../examples/portable/hosts/conversation.js';
import { compatibleMemoryEmbeddings } from '../src/providers/embeddings.js';
import type { CharacterState, RunConfig } from '../src/format/index.js';

const actor = 'simkin:test';
const settings = { ...contextProfile.defaults.config, recentTurns: 2, batchRecords: 64, batchTurns: 2 };
const state = (): CharacterState => ({ specVersion: '0.2.0-draft.2', kind: 'character-state', id: 'state:test', instanceId: actor, definitionRef: 'character:test', definitionHash: 'a'.repeat(64), revision: 0, context: { memories: [] } });
const base = (): DecisionContext => ({ runId: 'run:test', requestId: 'request:test', instanceId: actor, character: { name: 'Test' }, stateRevision: 0, intentions: [], memories: [], observations: [], outcomes: [], tools: [], model: { provider: 'fixture', model: 'fixture', settings: {} } });
const signal = () => new AbortController().signal;
function observe(context: DecisionContext, text: string) {
  context.observations = [{ id: 'obs:now', runId: context.runId, recipient: actor, source: 'host:test', revision: 1000,
    capturedAt: { clockId: 'clock:simulation', value: 1000 }, deliveredAt: { clockId: 'clock:simulation', value: 1000 }, content: [{ type: 'text', text }] }];
  context.perception = { eventIds: ['obs:now'], currentStateIds: [] };
}
function retain(memory: CharacterMemory, id: string, text: string, turn = 1, recipient = actor) {
  memory.retain(recipient, turn, { id, text, source: { kind: 'observation' } });
}
function compact(memory: CharacterMemory, turn = 1000, concerns?: { text: string; evidenceIds: string[] }[]) {
  const batch = memory.batch(actor, turn, memory.cutoff(actor))!;
  memory.commit(actor, batch, { summary: 'A fallible working account; originals remain available.', episodes: [], ...(concerns ? { concerns } : {}) }, 'run:test');
}

// Orthogonal, explicitly scripted vectors isolate retrieval plumbing from model quality.
const embeddings: MemoryEmbeddings = { id: 'fixture:meaning-v1', embed: async texts => ({ vectors: texts.map(text => /abandon|left before|desert/i.test(text) ? [1, 0, 0] : /gasket|seal|saffron/i.test(text) ? [0, 1, 0] : [0, 0, 1]), usage: { inputTokens: texts.length * 10, cost: 0.001 } }) };

describe.each(['memory', 'sqlite'])('%s scoped situational memory', backend => {
  async function using(work: (store: RunnerStorage) => Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), 'simkind-policy-'));
    const store = backend === 'sqlite' ? new SqliteRunnerStorage(join(dir, 'archive.sqlite')) : new MemoryRunnerStorage();
    try { await work(store); } finally { if (store instanceof SqliteRunnerStorage) store.close(); rmSync(dir, { force: true, recursive: true }); }
  }
  it('recovers a distinctive old detail amid repeated question distractors', () => using(async store => {
    const memory = new CharacterMemory(store, settings, createSituationalMemoryPolicy()); memory.initialise(state());
    retain(memory, 'old', 'The replacement gasket is SAFFRON colored.');
    for (let i = 2; i < 40; i++) retain(memory, `noise:${i}`, 'The earlier question asked what was decided about the current fee and the deadline.', i);
    compact(memory);
    const context = base(); observe(context, 'What color was the replacement gasket?');
    const result = await memory.retrieve(memory.assemble(context, 1000, memory.cutoff(actor)), 1000, memory.cutoff(actor), signal());
    expect(result.memories[0].id).toBe('old'); expect(result.selection.mode).toBe('lexical');
    expect(result.selection.embeddingCalls).toBe(0);
  }));
  it('uses independent semantic candidates for a paraphrase with no lexical overlap and persists the index', () => using(async store => {
    const embed = vi.fn(embeddings.embed), policy = createSituationalMemoryPolicy({ embeddings: { ...embeddings, embed }, indexBatchSize: 2 });
    const memory = new CharacterMemory(store, settings, policy); memory.initialise(state());
    retain(memory, 'hurt', 'Mira left before the request finished.'); retain(memory, 'noise', 'The blue cups are clean.'); compact(memory);
    const context = base(); observe(context, 'Feeling abandoned.');
    const result = await memory.retrieve(memory.assemble(context, 1000, memory.cutoff(actor)), 1000, memory.cutoff(actor), signal());
    expect(result.memories[0].id).toBe('hurt'); expect(result.selection).toMatchObject({ mode: 'hybrid', indexed: 2, indexComplete: true, embeddingCalls: 2 });
    const next = new CharacterMemory(store, settings, policy);
    const repeated = await next.retrieve(next.assemble(context, 1001, next.cutoff(actor)), 1001, next.cutoff(actor), signal());
    expect(repeated.memories[0].id).toBe('hurt'); expect(repeated.selection.indexed).toBe(0); expect(embed).toHaveBeenCalledTimes(3);
  }));
  it('revisits unchanged intentions and source-linked concerns without a new question', () => using(async store => {
    const memory = new CharacterMemory(store, settings, createSituationalMemoryPolicy()); memory.initialise(state());
    retain(memory, 'promise', 'Cleo offered to help Ada with the rehearsal after lunch. No outcome is known.');
    compact(memory, 1000, [{ text: 'An unresolved rehearsal arrangement with Cleo.', evidenceIds: ['promise'] }]);
    const context = base(); context.intentions = [{ id: 'goal:rehearse', description: 'Prepare for the rehearsal.' }];
    for (const turn of [1000, 1001, 1200]) {
      const assembled = memory.assemble(context, turn, memory.cutoff(actor));
      const result = await memory.retrieve(assembled, turn, memory.cutoff(actor), signal());
      expect(result.memories.map(m => m.id)).toContain('promise');
      expect(assembled.memory?.concerns?.[0].text).toContain('unresolved');
      expect(assembled.memory?.temporalScope).toContain('archive sequence, not a turn');
      expect(assembled.memory?.evidenceThrough).toBe(memory.cutoff(actor).head.cursor);
    }
    retain(memory, 'later', 'Ada decided that the rehearsal no longer matters.', 1201);
    compact(memory, 1210, []);
    expect(memory.cutoff(actor).head.concerns).toEqual([]);
    expect(store.entry(`evidence:${actor}`, 'promise')).toBeDefined();
  }));
  it('preserves contradictory testimony and only permits concern citations from supplied or prior evidence', () => using(async store => {
    const memory = new CharacterMemory(store, settings, createSituationalMemoryPolicy()); memory.initialise(state());
    retain(memory, 'claim', 'Bram said that Cleo cheated him. This is Bram’s allegation.');
    retain(memory, 'denial', 'Cleo denied Bram’s allegation.', 2);
    const batch = memory.batch(actor, 1000, memory.cutoff(actor))!;
    expect(() => memory.commit(actor, batch, { summary: 'Disagreement.', episodes: [], concerns: [{ text: 'Unsure what happened.', evidenceIds: ['other:secret'] }] }, 'run:test')).toThrow('unavailable');
    memory.commit(actor, batch, { summary: 'Disagreement.', episodes: [], concerns: [{ text: 'Unsure what happened.', evidenceIds: ['claim', 'denial'] }] }, 'run:test');
    const result = await memory.retrieve(base(), 1000, memory.cutoff(actor), signal(), { query: 'Bram Cleo allegation' });
    expect(result.memories.map(m => m.id).sort()).toEqual(['claim', 'denial']);
    expect(result.memories.find(m => m.id === 'claim')?.source.kind).toBe('observation');
  }));
  it('enforces actor/cutoff/range boundaries and closes capabilities after retrieval', () => using(async store => {
    let captured: MemoryView | undefined;
    const policy: MemoryPolicy = { identity: { id: 'test.scoped', version: '1', settings: {} }, async retrieve({ view }) {
      captured = view;
      expect(view.search('secret future', 10)).toEqual([]);
      expect(view.get({ kind: 'experience', id: 'secret' })).toBeUndefined();
      expect(view.get({ kind: 'experience', id: 'future' })).toBeUndefined();
      const visible = view.get({ kind: 'experience', id: 'visible' })!; visible.memory.text = 'Injected false text';
      return { mode: 'custom', references: [{ kind: 'experience', id: 'visible' }] };
    } };
    const memory = new CharacterMemory(store, settings, policy); memory.initialise(state());
    retain(memory, 'visible', 'Accessible original.'); retain(memory, 'secret', 'Other actor secret.', 1, 'simkin:other'); compact(memory);
    const cutoff = memory.cutoff(actor); retain(memory, 'future', 'Future information.', 1001);
    const result = await memory.retrieve(base(), 1000, cutoff, signal());
    expect(result.memories[0].text).toBe('Accessible original.');
    expect(() => captured!.search('anything', 1)).toThrow('closed');
    const bad = new CharacterMemory(store, settings, { ...policy, retrieve: async () => ({ mode: 'custom', references: [{ kind: 'experience', id: 'secret' }] }) });
    await expect(bad.retrieve(base(), 1000, cutoff, signal())).rejects.toThrow('permitted');
    const badRange = new CharacterMemory(store, settings, { ...policy, retrieve: async () => ({ mode: 'custom', references: [{ kind: 'experience', id: 'visible' }] }) });
    await expect(badRange.retrieve(base(), 1000, cutoff, signal(), { fromTurn: 20 })).rejects.toThrow('permitted');
  }));
  it('exposes incremental index coverage and keeps every selected context bounded', () => using(async store => {
    const memory = new CharacterMemory(store, { ...settings, maxAutomaticRecallChars: 450 }, createSituationalMemoryPolicy({ embeddings, indexBatchSize: 1 })); memory.initialise(state());
    retain(memory, 'first', 'The cups were washed.'); retain(memory, 'second', 'The gasket was saffron.'); compact(memory);
    const context = base(); observe(context, 'Inspect the seal.');
    const first = await memory.retrieve(context, 1000, memory.cutoff(actor), signal());
    expect(first.selection).toMatchObject({ indexed: 1, indexComplete: false, embeddingCalls: 2 });
    const second = await memory.retrieve(context, 1001, memory.cutoff(actor), signal());
    expect(second.selection).toMatchObject({ indexed: 1, indexComplete: true });
    expect(second.memories[0].id).toBe('second');
    expect(JSON.stringify(memory.assemble(context, 1001, memory.cutoff(actor), second.memories)).length).toBeLessThan(settings.maxContextChars);
  }));
});

async function bundle(timeout = 10000) {
  const loaded = await loadScenario(new URL('../examples/portable/scenarios', import.meta.url).pathname, 'shared-decision.json', 'config-continuity.json');
  if (!loaded.ok) throw new Error('Fixture failed.');
  const config = loaded.value.documents[loaded.value.configId] as RunConfig;
  config.profiles![contextProfile.id] = { version: contextProfile.version, required: true };
  config.features![contextProfile.id] = { enabled: true, config: { recentTurns: 2, batchRecords: 3, batchTurns: 2, retrievalTimeoutMs: timeout } };
  config.limits.maxSteps = 10; config.limits.maxRequests = 100;
  return loaded.value;
}
const idle: ModelConnection = { public: { provider: 'fixture', model: 'idle', settings: {} }, capabilities: { text: true, json: true }, fulfill: async context => ({ output: context.purpose === 'consolidation' ? { toolId: 'simkind.compact', arguments: { summary: 'Working notes.', episodes: [] } } : { toolId: null, arguments: {} } }) };

it('records the exact selected model context and does not repeat retrieval on format correction', async () => {
  const contexts: DecisionContext[] = [], retrieve = vi.fn(createSituationalMemoryPolicy().retrieve);
  const model: ModelConnection = { ...idle, fulfill: async context => { contexts.push(structuredClone(context)); return { output: context.feedback ? { toolId: null, arguments: {} } : 'invalid' }; } };
  const made = createCharacterRunner(await bundle(), conversationHost, { primary: model }, 'run:selection', { memoryPolicy: { ...createSituationalMemoryPolicy(), retrieve } });
  if (!made.ok) throw new Error('Fixture failed.');
  made.value.step(); await made.value.settleDecisions();
  expect(retrieve).toHaveBeenCalledTimes(3); expect(contexts).toHaveLength(6);
  const recorded = made.value.events().filter(e => e.type === 'request').map(e => (e.data as unknown as { context: DecisionContext }).context);
  expect(recorded).toEqual(contexts);
  expect(made.value.events().filter(e => e.type === 'memory-retrieval' && (e.data as { phase: string }).phase === 'completed')).toHaveLength(3);
});

it('times out retrieval, preserves occupied slots, rejects late writes, and never starts a late model decision', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), seen: MemoryView[] = [];
  const policy: MemoryPolicy = { identity: { id: 'test.slow', version: '1', settings: {} }, async retrieve({ view }) { seen.push(view); await gate; return { mode: 'custom', references: [] }; } };
  const fulfill = vi.fn(idle.fulfill);
  const made = createCharacterRunner(await bundle(20), conversationHost, { primary: { ...idle, fulfill } }, 'run:slow', { memoryPolicy: policy });
  if (!made.ok) throw new Error('Fixture failed.');
  made.value.step(); await made.value.settleDecisions();
  expect(fulfill).not.toHaveBeenCalled(); expect(made.value.status().activeProviders).toBe(3);
  expect(made.value.events().filter(e => e.type === 'memory-retrieval' && (e.data as { phase: string }).phase === 'timeout')).toHaveLength(3);
  expect(() => seen[0].search('history', 1)).toThrow();
  release(); expect(await made.value.drainProviders(1000)).toBe(true);
  expect(fulfill).not.toHaveBeenCalled(); expect(made.value.events().filter(e => e.type === 'request')).toEqual([]);
});

it('pins memory policy identity across exact restore and retains legacy restore behavior', async () => {
  const store = new MemoryRunnerStorage(), source = await bundle();
  const made = createCharacterRunner(source, conversationHost, { primary: idle }, 'run:restore', { storage: store });
  if (!made.ok) throw new Error('Fixture failed.');
  made.value.step(); await made.value.settleDecisions();
  const checkpoint = made.value.checkpoint();
  expect(checkpoint.memoryPolicy?.id).toBe('simkind.situational');
  const restored = CharacterRunner.restore(checkpoint, conversationHost, { primary: idle }, undefined, { storage: store });
  expect(restored.inspect()).toEqual(made.value.inspect());
  expect(() => CharacterRunner.restore(checkpoint, conversationHost, { primary: idle }, undefined, { storage: store, memoryPolicy: 'legacy' })).toThrow('policy mismatch');
  const legacyStore = new MemoryRunnerStorage();
  const legacy = createCharacterRunner(source, conversationHost, { primary: idle }, 'run:legacy', { storage: legacyStore, memoryPolicy: 'legacy' });
  if (!legacy.ok) throw new Error('Fixture failed.');
  const saved = legacy.value.checkpoint(); expect(saved.memoryPolicy).toBeUndefined();
  const legacyRestored = CharacterRunner.restore(saved, conversationHost, { primary: idle }, undefined, { storage: legacyStore });
  const branch = CharacterRunner.restore(saved, conversationHost, { primary: idle }, 'run:policy-comparison', { storage: legacyStore, memoryPolicy: createSituationalMemoryPolicy() });
  expect(branch.checkpoint().memoryPolicy?.id).toBe('simkind.situational');
  expect(legacyStore.get('checkpoints', saved.id)).toEqual(saved);
  legacyRestored.step(); await legacyRestored.settleDecisions();
  expect(legacyRestored.events().filter(e => e.type === 'memory-retrieval')).toEqual([]);
});

afterEach(() => vi.unstubAllGlobals());
it('validates ordered embedding responses, propagates cancellation and keeps credentials local', async () => {
  const fetcher = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 20, cost: 0.0001 } })));
  vi.stubGlobal('fetch', fetcher);
  const adapter = compatibleMemoryEmbeddings({ id: 'test:space', model: 'explicit', dimensions: 2, endpoint: 'https://example.test/embeddings', apiKey: 'private-key' });
  const abort = signal(), result = await adapter.embed(['one', 'two'], abort);
  expect(result).toEqual({ vectors: [[1, 0], [0, 1]], usage: { inputTokens: 20, cost: 0.0001 } });
  expect(fetcher.mock.calls[0][1].signal).toBe(abort);
  expect(JSON.stringify(adapter)).not.toContain('private-key');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }, { index: 0, embedding: [2] }] }))));
  await expect(adapter.embed(['one', 'two'], signal())).rejects.toThrow();
});

it('records embedding HTTP failure without response bodies and submits no character decision', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('private-provider-response', { status: 429 })));
  const policy = createSituationalMemoryPolicy({ embeddings: compatibleMemoryEmbeddings({ id: 'test:unavailable', model: 'explicit', endpoint: 'https://example.test/embeddings', apiKey: 'private-key' }) });
  const fulfill = vi.fn(idle.fulfill);
  const made = createCharacterRunner(await bundle(), conversationHost, { primary: { ...idle, fulfill } }, 'run:embedding-failure', { memoryPolicy: policy });
  if (!made.ok) throw new Error('Fixture failed.');
  made.value.step(); await made.value.settleDecisions();
  expect(fulfill).not.toHaveBeenCalled();
  const failures = made.value.events().filter(e => e.type === 'memory-retrieval' && (e.data as { phase: string }).phase === 'failed');
  expect(failures).toHaveLength(3);
  expect(failures[0].data).toMatchObject({ diagnostic: { reason: 'HTTP_ERROR', httpStatus: 429 }, embeddingCalls: 1 });
  expect(JSON.stringify(made.value.events())).not.toMatch(/private-provider-response|private-key/);
});
