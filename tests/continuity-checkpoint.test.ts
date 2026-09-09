import { describe, it, expect } from 'vitest';
import { loadScenario } from '../src/runner/node.js';
import { CharacterRunner, createCharacterRunner, continuityProfile, reviseState, selectContinuityMemories, type ModelConnection, type DecisionContext } from '../src/runner/index.js';
import { conversationHost } from '../examples/portable/hosts/conversation.js';
import { settlementHost } from '../examples/portable/hosts/settlement.js';
import type { RunConfig, CharacterState, JsonObject } from '../src/format/index.js';

const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
const idle: ModelConnection = { public: { provider: 'fixture', model: 'idle', settings: {} }, capabilities: { text: true, json: true }, fulfill: async () => ({ output: { toolId: null, arguments: {} } }) };
async function setup(scene = 'shared-decision.json', primary = idle, continuity = true, retrieval = true) {
  const loaded = await loadScenario(root, scene, 'config.json'); if (!loaded.ok) throw new Error('fixture');
  const config = loaded.value.documents[loaded.value.configId] as RunConfig;
  if (continuity) { config.profiles![continuityProfile.id] = { version: continuityProfile.version, required: true }; config.features![continuityProfile.id] = { enabled: true }; }
  if (!retrieval) config.features!['simkind.memory-retrieval'].enabled = false;
  const host = scene === 'pump-crisis.json' ? settlementHost : conversationHost;
  const result = createCharacterRunner(loaded.value, host, { primary }, 'run:continuity');
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return { runner: result.value, host, primary };
}
const step = async (runner: CharacterRunner) => { runner.step(); await runner.settleDecisions(); };

describe('optional continuity', () => {
  it('supplies actual delivered evidence, self-report provenance, and revised intentions', async () => {
    const seen: DecisionContext[] = [];
    const primary: ModelConnection = { ...idle, fulfill: async context => {
      seen.push(context);
      return { output: { toolId: 'simkind.revise', arguments: { expectedRevision: context.stateRevision, intentions: [{ id: 'intent:wait', description: 'Wait until I know more.' }], interpretation: 'This remains uncertain.', evidence: [context.memories[0].id] } } };
    } };
    const { runner } = await setup(undefined, primary); await step(runner); await step(runner);
    const context = seen[3];
    expect(context.intentions).toEqual([{ id: 'intent:wait', description: 'Wait until I know more.' }]);
    expect(context.memories.some(m => m.source.kind === 'interpretation' && m.text === 'This remains uncertain.')).toBe(true);
    const experience = context.memories.find(m => m.source.kind === 'observation')!;
    expect(JSON.parse(experience.text).recipient).toBe(context.instanceId);
    expect(experience.eventRefs![0].resolution).toBe('recorded');
    expect(runner.inspect().host).toMatchObject({ revision: 0 });
    expect(runner.events().filter(e => e.type === 'action').every(e => ['accepted', 'succeeded'].includes(String((e.data as JsonObject).status)))).toBe(true);
  });
  it('disabling retrieval retains exported experiences while supplying no memories', async () => {
    const contexts: DecisionContext[] = [];
    const { runner } = await setup(undefined, { ...idle, fulfill: async context => { contexts.push(context); return { output: { toolId: null, arguments: {} } }; } }, true, false);
    await step(runner);
    expect(contexts.every(context => context.memories.length === 0)).toBe(true);
    const checkpoint = runner.checkpoint();
    expect(checkpoint.launch.states['simkin:aya'].context.memories!.length).toBeGreaterThan(1);
    expect(selectContinuityMemories(checkpoint.launch.states['simkin:aya'].context.memories!, 0)).toEqual([]);
  });
  it('rejects stale edits and attempts to supersede observations atomically', async () => {
    const { runner } = await setup(); await step(runner);
    const state = runner.inspect().launch.states['simkin:aya'];
    const before = structuredClone(state);
    expect(() => reviseState(state, { expectedRevision: 0, intentions: [] }, 'run:x', 'memory:x')).toThrow('Stale');
    const observation = state.context.memories!.find(m => m.source.kind === 'observation')!;
    expect(() => reviseState(state, { expectedRevision: state.revision, interpretation: 'Wrong', supersedes: ['intention:unavailable'] }, 'run:x', 'memory:x')).toThrow('supplied interpretation-memory IDs');
    expect(() => reviseState(state, { expectedRevision: state.revision, interpretation: 'Wrong', supersedes: [observation.id] }, 'run:x', 'memory:x')).toThrow('Only interpretations');
    expect(state).toEqual(before);
  });
});

describe('settled restore and branch', () => {
  it.each(['shared-decision.json', 'pump-crisis.json'])('restores complete %s state and continues identically with recorded decisions', async scene => {
    const { runner, host } = await setup(scene);
    await step(runner);
    const checkpoint = runner.checkpoint();
    const resumed = CharacterRunner.restore(checkpoint, host, { primary: idle });
    expect(resumed.inspect()).toEqual(runner.inspect());
    await step(runner); await step(resumed);
    expect(resumed.events()).toEqual(runner.events());
    expect(resumed.inspect()).toEqual(runner.inspect());
  });
  it('branches with recorded intervention and keeps parent state, source, and history immutable', async () => {
    const { runner, host } = await setup(); await step(runner);
    const checkpoint = runner.checkpoint(); const before = structuredClone(checkpoint);
    const child = CharacterRunner.restore(checkpoint, host, { primary: idle }, 'run:child');
    const state = child.inspect().launch.states['simkin:aya'];
    child.intervene('simkin:aya', { expectedRevision: state.revision, intentions: [] }, 'operator:test');
    await step(child);
    expect(checkpoint).toEqual(before); expect(runner.checkpoint()).toEqual(before);
    expect(child.manifest().parent).toMatchObject({ runId: runner.inspect().launch.runId, checkpointId: checkpoint.id, interventionRefs: ['intervention:0'] });
    expect(child.events().every(e => e.runId === 'run:child')).toBe(true);
    expect(child.inspect().launch.states['simkin:aya'].context.intentions).toEqual([]);
    expect(() => child.intervene('simkin:aya', { expectedRevision: 0, intentions: [] }, 'operator:test')).toThrow('rejected');
    expect(child.events().at(-1)?.data).toMatchObject({ status: 'rejected' });
  });
  it('refuses pending providers, unresolved actions, incompatible hosts, and corrupt snapshots', async () => {
    let release!: () => void;
    const primary: ModelConnection = { ...idle, fulfill: () => new Promise(resolve => { release = () => resolve({ output: { toolId: null, arguments: {} } }); }) };
    const { runner } = await setup(undefined, primary); runner.step();
    expect(() => runner.checkpoint()).toThrow('settled'); runner.stop(); release();
    const world = await setup('pump-crisis.json', { ...idle, fulfill: async () => ({ output: { toolId: 'move', arguments: { to: 'reservoir' } } }) });
    await step(world.runner); expect(() => world.runner.checkpoint()).toThrow('settled');
    const safe = await setup(); await step(safe.runner); const checkpoint = safe.runner.checkpoint();
    expect(() => CharacterRunner.restore(checkpoint, { ...safe.host, descriptor: { ...safe.host.descriptor, implementationVersion: '99' } }, { primary: idle })).toThrow('version');
    const corrupted = structuredClone(checkpoint); (corrupted.hostState as JsonObject).state = {};
    expect(() => CharacterRunner.restore(corrupted, safe.host, { primary: idle })).toThrow('match');
    const invalid = structuredClone(checkpoint); invalid.launch.states['simkin:aya'] = {} as CharacterState;
    expect(() => CharacterRunner.restore(invalid, safe.host, { primary: idle })).toThrow();
  });
});
