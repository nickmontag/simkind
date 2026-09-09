import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryRunnerStorage, type RunnerStorage } from '../src/runner/storage.js';
import { SqliteRunnerStorage } from '../src/runner/sqlite-storage.js';
import { memoryEvidence } from '../src/runner/evidence.js';
import { CharacterMemory, contextProfile, compactTool } from '../src/runner/long-memory.js';
import { createCharacterRunner, CharacterRunner, type ModelConnection, type DecisionContext } from '../src/runner/index.js';
import { loadScenario, recoverArchivedCheckpoint } from '../src/runner/node.js';
import { conversationHost } from '../examples/portable/hosts/conversation.js';
import type { CharacterState, RunConfig } from '../src/format/index.js';

const state = (): CharacterState => ({ specVersion: '0.2.0-draft.2', kind: 'character-state', id: 'state:test', instanceId: 'simkin:test', definitionRef: 'character:test', definitionHash: 'a'.repeat(64), revision: 0, context: { memories: [] } });
const settings = { ...contextProfile.defaults.config, recentTurns: 2, batchRecords: 3, batchTurns: 2 };
const base = (): DecisionContext => ({ runId: 'run:test', requestId: 'request:test', instanceId: 'simkin:test', character: { name: 'Test' }, stateRevision: 0, intentions: [], memories: [], observations: [], outcomes: [], tools: [], model: { provider: 'fixture', model: 'fixture', settings: {} } });

describe.each(['memory', 'sqlite'])('%s selective automatic recall', backend => {
  it('offers small direct reminders without expanding citations, keeps explicit recall, and does not repeat unchanged goal searches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'simkind-selective-'));
    const store: RunnerStorage = backend === 'sqlite' ? new SqliteRunnerStorage(join(dir, 'archive.db')) : new MemoryRunnerStorage();
    try {
      const memory = new CharacterMemory(store, { ...settings, batchRecords: 24 }); memory.initialise(state());
      for (let turn = 1; turn <= 12; turn++) memory.retain('simkin:test', turn, {
        id: `invitation:${turn}`, text: `Ceremony invitation ${turn}. ` + 'The visitor described an unresolved personal concern. '.repeat(25), source: { kind: 'observation' },
      });
      const batch = memory.batch('simkin:test', 20, memory.cutoff('simkin:test'))!;
      memory.commit('simkin:test', batch, { summary: 'Invitations and concerns remain unresolved.', episodes: [{ text: 'Ceremony invitations and personal concerns.', evidenceIds: batch.records.map(r => r.id) }] }, 'run:test');
      const current = base(); current.intentions = [{ id: 'intent:visit', description: 'Consider the ceremony invitation.' }];
      const first = memory.assemble(current, 20, memory.cutoff('simkin:test'));
      expect(first.memories.length).toBeGreaterThan(0); expect(first.memories.length).toBeLessThanOrEqual(3);
      expect(JSON.stringify(first.memories).length).toBeLessThan(6000);
      const explicit = memory.recall('simkin:test', memory.cutoff('simkin:test'), { ids: ['episode:1:0'] });
      expect(explicit).toHaveLength(13); // Twelve intact originals plus their interpreted episode.
      expect(memory.assemble(current, 21, memory.cutoff('simkin:test')).memories).toEqual([]);
      memory.retain('simkin:test', 21, { id: 'later', text: 'The ceremony invitation is still unresolved.', source: { kind: 'observation' } });
      memory.commit('simkin:test', memory.batch('simkin:test', 26, memory.cutoff('simkin:test'))!, { summary: 'Another historical reminder.', episodes: [] }, 'run:test');
      expect(memory.assemble(current, 26, memory.cutoff('simkin:test')).memories).toEqual([]); // A new summary alone is not a new retrieval cue.
      const disabled = new CharacterMemory(store, { ...settings, maxAutomaticRecallChars: 0 });
      current.intentions[0].description = 'Read the ceremony invitation again.';
      expect(disabled.assemble(current, 27, disabled.cutoff('simkin:test')).memories).toEqual([]);
      expect(disabled.recall('simkin:test', disabled.cutoff('simkin:test'), { ids: ['invitation:1'] })).toHaveLength(1);
    } finally { if (store instanceof SqliteRunnerStorage) store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('finds a distant private fact from new dialogue despite verbose current state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'simkind-dialogue-cue-'));
    const store: RunnerStorage = backend === 'sqlite' ? new SqliteRunnerStorage(join(dir, 'archive.db')) : new MemoryRunnerStorage();
    try {
      const memory = new CharacterMemory(store, settings); memory.initialise(state());
      memory.retain('simkin:test', 1, { id: 'code', text: 'The locker code is PINE-482.', source: { kind: 'observation' } });
      memory.retain('simkin:other', 1, { id: 'secret', text: 'The locker code is ASH-761.', source: { kind: 'observation' } });
      memory.commit('simkin:test', memory.batch('simkin:test', 8, memory.cutoff('simkin:test'))!, { summary: 'There was an old code.', episodes: [] }, 'run:test');
      const current = base(), envelope = { runId: current.runId, recipient: current.instanceId, source: 'host:test', revision: 8, capturedAt: { clockId: 'clock:simulation', value: 8 }, deliveredAt: { clockId: 'clock:simulation', value: 8 } };
      current.observations = [{ ...envelope, id: 'state', content: Array.from({ length: 20 }, (_, index) => ({ type: 'text' as const, text: `Static instruction about task operations number ${index}.` })) }];
      current.perception = { currentStateIds: ['state'], eventIds: [] };
      memory.assemble(current, 8, memory.cutoff('simkin:test'));
      const cutoff = memory.cutoff('simkin:test');
      memory.retain('simkin:test', 10, { id: 'future', text: 'The locker code will change to BIRCH-333.', source: { kind: 'observation' } });
      current.observations.push({ ...envelope, id: 'question', content: [{ type: 'text', text: 'What is your locker code?' }] });
      current.perception.eventIds = ['question'];
      const answer = memory.assemble(current, 9, cutoff);
      expect(answer.memories.map(m => m.id)).toEqual(['code']);
      expect(JSON.stringify(answer)).not.toContain('ASH-761'); expect(JSON.stringify(answer)).not.toContain('BIRCH-333');
    } finally { if (store instanceof SqliteRunnerStorage) store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('context pressure', () => {
  it('fits optional retrieval around intact recent evidence and goals without deleting originals', () => {
    const store = new MemoryRunnerStorage();
    const memory = new CharacterMemory(store, { ...settings, maxContextChars: 5000 }); memory.initialise(state());
    const old = { id: 'old', text: 'Old agreement. '.repeat(220), source: { kind: 'observation' as const } };
    memory.retain('simkin:test', 1, old);
    const batch = memory.batch('simkin:test', 8, memory.cutoff('simkin:test'))!;
    memory.commit('simkin:test', batch, { summary: 'An older agreement remains available.', episodes: [] }, 'run:test');
    const recent = { id: 'recent', text: 'Current evidence. '.repeat(110), source: { kind: 'observation' as const } };
    memory.retain('simkin:test', 9, recent);
    const current = base(); current.intentions = [{ id: 'intent:keep', description: 'Preserve this goal exactly.' }];
    const context = memory.assemble(current, 9, memory.cutoff('simkin:test'), [old]);
    expect(context.recent).toEqual([recent]); expect(context.intentions).toEqual(current.intentions);
    expect(context.memories).toEqual([]); expect(JSON.stringify(context).length).toBeLessThanOrEqual(5000);
    expect(memory.recall('simkin:test', memory.cutoff('simkin:test'), { ids: ['old'] })).toEqual([old]);
    memory.retain('simkin:test', 9, { id: 'huge-current', text: 'x'.repeat(6000), source: { kind: 'observation' } });
    expect(() => memory.assemble(current, 9, memory.cutoff('simkin:test'), [])).toThrow('Protected');
  });
  it('compacts eligible history under pressure before the routine record or age thresholds', async () => {
    const loaded = await loadScenario(new URL('../examples/portable/scenarios', import.meta.url).pathname, 'shared-decision.json', 'config-continuity.json');
    if (!loaded.ok) throw new Error('fixture');
    const config = loaded.value.documents[loaded.value.configId] as RunConfig;
    const limits = { ...contextProfile.defaults.config, recentTurns: 3, batchRecords: 100, batchTurns: 100, maxContextChars: 12000, maxBatchChars: 8000, maxRecallChars: 500 };
    config.profiles![contextProfile.id] = { version: contextProfile.version, required: true };
    config.features![contextProfile.id] = { enabled: true, config: limits }; config.limits.maxSteps = 12; config.limits.maxRequests = 100;
    const seen: DecisionContext[] = [];
    const model: ModelConnection = { public: { provider: 'fixture', model: 'pressure', settings: {} }, capabilities: { text: true, json: true }, fulfill: async context => {
      seen.push(context); return { output: context.purpose === 'consolidation' ? { toolId: 'simkind.compact', arguments: { summary: 'Older evidence compacted; originals retained.', episodes: [] } } : { toolId: null, arguments: {} } };
    } };
    const store = new MemoryRunnerStorage(), memory = new CharacterMemory(store, limits);
    const created = createCharacterRunner(loaded.value, conversationHost, { primary: model }, 'run:pressure', { storage: store });
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    const runner = created.value;
    for (let turn = 1; turn <= 10; turn++) {
      memory.retain('simkin:aya', turn - 1, { id: `pressure:${turn}`, text: `Evidence ${turn}. ` + 'x'.repeat(1400), source: { kind: 'observation' } });
      runner.step(); await runner.settleDecisions();
      expect(runner.status().contextFailures).toEqual({});
    }
    expect(seen.filter(c => c.instanceId === 'simkin:aya' && c.purpose === 'consolidation').length).toBeGreaterThan(0);
    expect(seen.filter(c => c.instanceId === 'simkin:aya' && c.purpose !== 'consolidation')).toHaveLength(10);
    expect(seen.every(c => JSON.stringify(c).length <= limits.maxContextChars)).toBe(true);
    expect(memory.recall('simkin:aya', memory.cutoff('simkin:aya'), { ids: ['pressure:1'] })).toHaveLength(0); // Too large for this test's recall allowance, still archived.
    expect(memory.evidenceById('simkin:aya', ['pressure:1'])[0].text).toContain('Evidence 1.');
  });
});

describe.each(['memory', 'sqlite'])('%s archive', backend => {
  it('rolls back batches, indexes original text and enforces history/actor cutoffs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'simkind-memory-'));
    const store: RunnerStorage = backend === 'sqlite' ? new SqliteRunnerStorage(join(dir, 'archive.db')) : new MemoryRunnerStorage();
    try {
      expect(() => store.transaction(() => { store.set('test', 'x', 1); store.append('test', { id: 'x', turn: 0, text: 'secret', value: 1 }); throw new Error('rollback'); })).toThrow('rollback');
      expect(store.get('test', 'x')).toBeUndefined(); expect(store.count('test')).toBe(0);
      const memory = new CharacterMemory(store, settings); memory.initialise(state());
      for (let turn = 1; turn <= 8; turn++) memory.retain('simkin:test', turn, { id: `e:${turn}`, text: turn === 1 ? 'Cleo agreed to seven silver coins, not eight.' : `Routine turn ${turn}`, source: { kind: 'observation' } });
      const cutoff = memory.cutoff('simkin:test');
      memory.retain('simkin:other', 1, { id: 'private', text: 'Cleo secret password', source: { kind: 'observation' } });
      memory.retain('simkin:test', 9, { id: 'future', text: 'Cleo future password', source: { kind: 'observation' } });
      expect(memory.recall('simkin:test', cutoff, { query: 'Cleo' }).map(m => m.id)).toEqual(['e:1']);
      expect(memory.recall('simkin:test', cutoff, { ids: ['private', 'future'] })).toEqual([]);
      const batch = memory.batch('simkin:test', 8, cutoff)!;
      expect(batch.records.map(row => row.id)).toEqual(['e:1', 'e:2', 'e:3']);
      const compaction = memory.consolidationContext(base(), batch, cutoff);
      expect(compaction.tools[0].inputSchema).toMatchObject({ properties: { episodes: { items: { properties: { evidenceIds: { items: { enum: ['e:1', 'e:2', 'e:3'] } } } } } } });
      expect(() => memory.commit('simkin:test', batch, { summary: 'x', episodes: [{ text: 'x', evidenceIds: ['private'] }] }, 'run:test')).toThrow('unavailable');
      memory.commit('simkin:test', batch, { summary: 'A negotiated agreement.', episodes: [{ text: 'Negotiated seven silver coins with Cleo.', evidenceIds: ['e:1'] }] }, 'run:test');
      expect(() => memory.commit('simkin:test', batch, { summary: '', episodes: [] }, 'run:test')).toThrow('Stale');
      expect(memory.recall('simkin:test', memory.cutoff('simkin:test'), { ids: ['e:1'] })[0].text).toContain('not eight');
      const context = memory.assemble(base(), 8, memory.cutoff('simkin:test'));
      expect(context.recent?.map(m => m.id)).toContain('e:8');
      expect(context.recent?.map(m => m.id)).not.toContain('e:1');
      expect(context.memory?.summary).toBe('A negotiated agreement.');
      const question = base();
      question.observations = [{ id: 'question:1', runId: 'run:test', recipient: 'simkin:test', source: 'host:test', revision: 8,
        capturedAt: { clockId: 'clock:simulation', value: 8 }, deliveredAt: { clockId: 'clock:simulation', value: 8 },
        content: [{ type: 'text', text: 'How many silver coins did Cleo agree to?' }] }];
      expect(memory.assemble(question, 8, memory.cutoff('simkin:test')).memories.some(item => item.id === 'e:1')).toBe(true);
      const small = new CharacterMemory(store, { ...settings, maxContextChars: 100 });
      expect(() => small.assemble(base(), 8, cutoff)).toThrow('capacity');
      expect(() => small.consolidationContext(base(), batch, cutoff)).toThrow('capacity');
      expect(memory.evidenceById('simkin:test', ['e:8'])).toHaveLength(1);
    } finally { if (store instanceof SqliteRunnerStorage) store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('runner context lifecycle', () => {
  it('records bounded correction attempts and never admits malformed tool output to the host', async () => {
    const loaded = await loadScenario(new URL('../examples/portable/scenarios', import.meta.url).pathname, 'shared-decision.json', 'config-continuity.json');
    if (!loaded.ok) throw new Error('fixture');
    const config = loaded.value.documents[loaded.value.configId] as RunConfig;
    config.profiles![contextProfile.id] = { version: contextProfile.version, required: true };
    config.features![contextProfile.id] = { enabled: true, config: { maxInternalCalls: 1 } };
    const seen: DecisionContext[] = [];
    const model: ModelConnection = { public: { provider: 'fixture', model: 'invalid', settings: {} }, capabilities: { text: true, json: true }, fulfill: async context => {
      seen.push(context); return { output: { toolId: 'say', arguments: { text: 123, to: null } } };
    } };
    const created = createCharacterRunner(loaded.value, conversationHost, { primary: model }, 'run:invalid');
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    created.value.step(); await created.value.settleDecisions();
    expect(seen).toHaveLength(6);
    expect(seen.filter(context => context.feedback)).toHaveLength(3);
    expect(seen.filter(context => context.feedback).every(context => context.feedback!.includes('/arguments/text'))).toBe(true);
    expect(created.value.events().filter(event => event.type === 'proposal')).toEqual([]);
    expect(created.value.events().filter(event => event.type === 'model-error')).toHaveLength(6);
    expect(Object.keys(created.value.status().contextFailures!)).toHaveLength(3);
    expect(created.value.status().pendingRequests).toBe(0);
  });
  it('consolidates and recalls inside an opportunity, preserves goals and resumes a frozen disk archive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simkind-context-'));
    const store = new SqliteRunnerStorage(join(dir, 'live.db'));
    let saved: SqliteRunnerStorage | undefined;
    try {
      const loaded = await loadScenario(new URL('../examples/portable/scenarios', import.meta.url).pathname, 'shared-decision.json', 'config-continuity.json');
      if (!loaded.ok) throw new Error('fixture');
      const config = loaded.value.documents[loaded.value.configId] as RunConfig;
      config.profiles![contextProfile.id] = { version: contextProfile.version, required: true };
      config.features![contextProfile.id] = { enabled: true, config: { recentTurns: 2, batchRecords: 3, batchTurns: 2 } };
      config.limits.maxSteps = 20; config.limits.maxRequests = 200;
      const seen: DecisionContext[] = [];
      const model: ModelConnection = { public: { provider: 'fixture', model: 'memory', settings: {} }, capabilities: { text: true, json: true }, fulfill: async context => {
        seen.push(context);
        if (context.purpose === 'consolidation') return { output: { toolId: compactTool.id, arguments: { summary: 'Remember the original situation.', episodes: [{ text: context.memories[0].text.slice(0, 1000), evidenceIds: [context.memories[0].id] }] } } };
        if (context.memory!.version > 0 && context.purpose !== 'recall') return { output: { toolId: 'simkind.recall', arguments: { fromTurn: 0, toTurn: 1 } } };
        return { output: { toolId: null, arguments: {} } };
      } };
      const created = createCharacterRunner(loaded.value, conversationHost, { primary: model }, 'run:long', { storage: store });
      if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
      const runner = created.value, goals = structuredClone(runner.inspect().launch.states);
      for (let i = 0; i < 10; i++) { runner.step(); await runner.settleDecisions(); }
      expect(seen.some(c => c.purpose === 'consolidation')).toBe(true);
      expect(seen.some(c => c.purpose === 'recall')).toBe(true);
      expect(runner.status().pendingRequests).toBe(0);
      expect(runner.events().filter(e => e.type === 'model-error')).toEqual([]);
      for (const [actor, value] of Object.entries(runner.inspect().launch.states)) {
        expect(value.context.intentions).toEqual(goals[actor].context.intentions);
        expect(value.context.memories).toEqual([]);
      }
      const checkpoint = runner.checkpoint();
      expect(checkpoint.version).toBe('simkind.checkpoint/2'); expect(checkpoint.events).toEqual([]);
      await store.copyTo(join(dir, 'frozen.db')); saved = new SqliteRunnerStorage(join(dir, 'frozen.db'));
      const restored = CharacterRunner.restore(checkpoint, conversationHost, { primary: model }, undefined, { storage: saved });
      expect(restored.inspect()).toEqual(runner.inspect());
      runner.step(); await runner.settleDecisions();
      expect(() => CharacterRunner.restore(checkpoint, conversationHost, { primary: model }, undefined, { storage: store })).toThrow('exact frozen');
      restored.step(); await restored.settleDecisions();
      expect(restored.inspect()).toEqual(runner.inspect());
      const recovered = await recoverArchivedCheckpoint(join(dir, 'live.db'), join(dir, 'recovered.db'));
      try {
        const branch = CharacterRunner.restore(recovered.checkpoint, conversationHost, { primary: model }, 'run:recovered', { storage: recovered.storage });
        expect(branch.inspect().host).toEqual(checkpoint.hostState && (checkpoint.hostState as { state: unknown }).state);
        expect(branch.events()).toEqual([]);
        branch.pauseDispatch(false); branch.step(); await branch.settleDecisions();
        expect(branch.status().contextFailures).toEqual({});
        expect(store.count('events:run:long')).toBeGreaterThan(checkpoint.archive!.eventCount);
      } finally { recovered.storage.close(); }
    } finally { saved?.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});


describe('memory provenance and verification', () => {
  it('keeps misleading summaries fallible and retrieves their original, actor-private receipts', () => {
    const store = new MemoryRunnerStorage(), memory = new CharacterMemory(store, settings);
    memory.initialise(state());
    memory.retain('simkin:test', 1, { id: 'offer', text: JSON.stringify({ type: 'action', actionId: 'a:offer', status: 'succeeded', action: { toolId: 'offer' }, result: { effect: 'offer-posted; no exchange completed' } }), source: { kind: 'report' } });
    memory.retain('simkin:test', 2, { id: 'cancel', text: JSON.stringify({ type: 'action', actionId: 'a:cancel', status: 'succeeded', action: { toolId: 'cancel' }, result: { effect: 'offer-cancelled; reservations returned' } }), source: { kind: 'report' } });
    memory.retain('simkin:test', 3, { id: 'claim', text: 'Ada said the price was seven. This claim is unverified.', source: { kind: 'observation' } });
    const cutoff = memory.cutoff('simkin:test'), batch = memory.batch('simkin:test', 8, cutoff)!;
    memory.commit('simkin:test', batch, { summary: 'A sale happened.', episodes: [{ text: 'Sold the equipment to Ada.', evidenceIds: ['offer', 'cancel'] }] }, 'run:test');
    const now = memory.cutoff('simkin:test');
    memory.retain('simkin:other', 1, { id: 'secret', text: 'Private counterparty fact', source: { kind: 'report' } });
    memory.retain('simkin:test', 9, { id: 'future', text: 'Future agreement', source: { kind: 'report' } });
    const recalled = memory.recall('simkin:test', now, { ids: ['episode:1:0', 'secret', 'future'] });
    expect(recalled.map(m => m.id)).toEqual(['offer', 'cancel', 'episode:1:0']);
    expect(memoryEvidence(recalled[0])).toMatchObject({ kind: 'action-receipt', status: 'succeeded', toolId: 'offer' });
    expect(memoryEvidence(recalled[2])).toMatchObject({ kind: 'interpretation', sourceIds: ['offer', 'cancel'] });
    const current = base(); current.observations = [{ id: 'current', runId: 'run:test', recipient: 'simkin:test', source: 'host:test', revision: 9, capturedAt: { clockId: 'clock:simulation', value: 9 }, deliveredAt: { clockId: 'clock:simulation', value: 9 }, content: [{ type: 'text', text: 'No sale is recorded; the offer was cancelled.' }] }];
    const assembled = memory.assemble(current, 9, now, recalled);
    expect(assembled.memory).toMatchObject({ authority: 'interpretation', summary: 'A sale happened.', evidenceThrough: batch.through });
    expect(assembled.observations).toEqual(current.observations);
    expect(assembled.memoryEvidence?.find(e => e.memoryId === 'offer')?.toolId).toBe('offer');
    expect(JSON.stringify(assembled).length).toBeLessThan(settings.maxContextChars);
  });
});
