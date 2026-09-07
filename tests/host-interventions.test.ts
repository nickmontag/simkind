import { describe, it, expect } from 'vitest';
import { CharacterRunner, compareBranches, createCharacterRunner, type DecisionContext, type HostIntervention, type ModelConnection } from '../src/runner/index.js';
import { loadRun, loadScenario } from '../src/runner/node.js';
import { installedHost } from '../examples/portable/hosts/registry.js';
import type { JsonObject } from '../src/format/index.js';

const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
const idle: ModelConnection = { public: { provider: 'fixture', model: 'idle', settings: {} }, capabilities: { text: true, json: true }, fulfill: async () => ({ output: { toolId: null, arguments: {} } }) };
const message = (expectedRevision = 0): HostIntervention => ({ operator: 'operator:test', operationId: 'operator.message', operationVersion: '1.0.0', expectedRevision, arguments: { text: 'Private update for Aya.', to: 'simkin:aya' } });
async function setup(scene = 'shared-decision.json', primary = idle) {
  const loaded = await loadScenario(root, scene, 'config-continuity.json'); if (!loaded.ok) throw new Error('fixture');
  const scenario = loaded.value.documents[loaded.value.scenarioId]; if (scenario.kind !== 'scenario') throw new Error('fixture');
  const host = installedHost(scenario.host.contractId);
  const result = createCharacterRunner(loaded.value, host, { primary }, 'run:interventions');
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return { runner: result.value, host };
}

describe('host-owned operator interventions', () => {
  it('compares divergent sibling traces after an exact shared prefix and excludes inherited totals', async () => {
    const { runner, host } = await setup(); runner.interveneHost(message());
    const parent = runner.checkpoint();
    const left = CharacterRunner.restore(parent, host, { primary: idle }, 'run:left');
    const right = CharacterRunner.restore(parent, host, { primary: idle }, 'run:right');
    left.interveneHost({ ...message(1), arguments: { text: 'A public announcement.', to: null } });
    right.interveneHost({ ...message(1), operationId: 'operator.context', arguments: { text: 'A changed situation.' } });
    const evidence = (child: CharacterRunner) => ({ manifest: child.manifest(), events: child.events(), parent });
    const a = evidence(left); const b = evidence(right);
    const comparison = compareBranches(a, b);
    expect(comparison.sharedPrefix).toMatchObject({ eventCount: 3, checkpointId: parent.id });
    expect(comparison.left.totals.outcomes).toEqual({ accepted: 1, succeeded: 1 });
    expect(comparison.right.totals.outcomes).toEqual({ accepted: 1, succeeded: 1 });
    expect(comparison.left.events[0].data).toMatchObject({ toolId: 'operator.message' });
    expect(comparison.right.events[0].data).toMatchObject({ toolId: 'operator.context' });
    comparison.left.events[0].data = {};
    expect(a.events[0].data).toMatchObject({ toolId: 'operator.message' });
    const corrupt = structuredClone(b); (corrupt.parent.hostState as JsonObject).state = {};
    expect(() => compareBranches(a, corrupt)).toThrow('exact same parent');
    expect(() => compareBranches(a, a)).toThrow('different');
    expect(() => compareBranches(a, { ...b, events: a.events })).toThrow('Invalid continuation');
  });
  it('previews without mutation and delivers private messages only through recipient observations', async () => {
    const contexts: DecisionContext[] = [];
    const { runner } = await setup(undefined, { ...idle, fulfill: async context => { contexts.push(context); return { output: { toolId: null, arguments: {} } }; } });
    const before = runner.checkpoint();
    expect(runner.previewHostIntervention(message())).toMatchObject({ valid: true, revision: 0, effects: { message: { from: 'operator:test', to: 'simkin:aya' } } });
    expect(runner.checkpoint()).toEqual(before);
    runner.interveneHost(message()); runner.step(); await runner.settleDecisions();
    expect(JSON.stringify(contexts.find(c => c.instanceId === 'simkin:aya'))).toContain('Private update for Aya.');
    for (const context of contexts.filter(c => c.instanceId !== 'simkin:aya')) expect(JSON.stringify(context)).not.toContain('Private update for Aya.');
    expect(contexts.every(c => c.tools.every(t => !t.id.startsWith('operator.')) && c.outcomes.length === 0)).toBe(true);
    expect(runner.events().filter(e => e.type === 'action').map(e => (e.data as JsonObject).status)).toEqual(['accepted', 'succeeded']);
    expect(runner.events().find(e => e.type === 'action' && (e.data as JsonObject).status === 'succeeded')?.data).toMatchObject({ result: { authority: 'operator', operator: 'operator:test' } });
  });
  it('revalidates stale previews, rejects invalid operations and targets, and records atomic failures', async () => {
    const { runner } = await setup();
    expect(runner.previewHostIntervention(message()).valid).toBe(true);
    runner.interveneHost({ ...message(), operationId: 'operator.context', arguments: { text: 'New conditions.' } });
    const before = runner.inspect().host;
    for (const edit of [message(), { ...message(1), arguments: { text: 'X', to: 'simkin:missing' } }, { ...message(1), operationId: 'say' }, { ...message(1), arguments: { text: 12, to: null } }]) {
      expect(runner.previewHostIntervention(edit).valid).toBe(false);
      expect(() => runner.interveneHost(edit)).toThrow('rejected');
      expect(runner.events().at(-1)?.data).toMatchObject({ status: 'rejected', effectRefs: [] });
      expect(runner.inspect().host).toEqual(before);
    }
    expect(() => runner.interveneHost({ ...message(1), operator: 'simkin:aya' })).toThrow('distinct');
    const checkpoint = runner.checkpoint();
    expect(CharacterRunner.restore(checkpoint, installedHost(checkpoint.host.contractId, checkpoint.host.implementationVersion), { primary: idle }).inspect()).toEqual(runner.inspect());
  });
  it('keeps operator capabilities unavailable to a malicious character proposal', async () => {
    const { runner } = await setup(undefined, { ...idle, fulfill: async () => ({ output: { toolId: 'operator.message', arguments: message().arguments } }) });
    runner.step(); await runner.settleDecisions();
    expect(runner.inspect().host).toMatchObject({ revision: 0, world: { messages: [] } });
    expect(runner.events().filter(e => e.type === 'action').every(e => (e.data as JsonObject).status === 'rejected')).toBe(true);
  });
  it('restores and branches successive interventions without inherited ID collisions or parent edits', async () => {
    const { runner, host } = await setup(); runner.interveneHost(message());
    const parent = runner.checkpoint(); const original = structuredClone(parent);
    const child = CharacterRunner.restore(parent, host, { primary: idle }, 'run:child');
    child.interveneHost(message(1));
    const grandchild = CharacterRunner.restore(child.checkpoint(), host, { primary: idle }, 'run:grandchild');
    grandchild.interveneHost(message(2));
    expect(grandchild.inspect().host).toMatchObject({ revision: 3 });
    expect(grandchild.manifest().parent?.interventionRefs).toEqual(['intervention:world:3']);
    expect(parent).toEqual(original); expect(runner.checkpoint()).toEqual(original);
    const restored = CharacterRunner.restore(grandchild.checkpoint(), host, { primary: idle });
    expect(restored.inspect()).toEqual(grandchild.inspect());
    expect(restored.events()).toEqual(grandchild.events());
  });
  it('changes settlement conditions without bypassing local observations or resource bounds', async () => {
    const { runner } = await setup('pump-crisis.json');
    const edit: HostIntervention = { operator: 'operator:test', operationId: 'operator.stock', operationVersion: '1.0.0', expectedRevision: 0, arguments: { place: 'reservoir', resource: 'parts', quantity: 9 } };
    expect(runner.previewHostIntervention(edit)).toMatchObject({ valid: true, effects: { stock: { after: 9 } } });
    runner.interveneHost(edit);
    runner.interveneHost({ ...edit, operationId: 'operator.pump', expectedRevision: 1, arguments: { broken: false } });
    const before = runner.inspect().host;
    expect(() => runner.interveneHost({ ...edit, expectedRevision: 2, arguments: { ...edit.arguments, quantity: -1 } })).toThrow('rejected');
    expect(runner.inspect().host).toEqual(before);
    runner.pauseDispatch(true); runner.step();
    const observations = runner.events().filter(e => e.type === 'observation');
    for (const event of observations) {
      const content = (event.data as unknown as { content: { data: { place: string; stock: JsonObject; pump: unknown } }[] }).content[0].data;
      if (content.place === 'reservoir') { expect(content.stock.parts).toBe(9); expect(content.pump).toMatchObject({ broken: false }); }
      else expect(content.pump).toBeNull();
    }
  });
  it('refuses in-flight decisions and unresolved travel', async () => {
    const { runner } = await setup(undefined, { ...idle, fulfill: async (_context, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
    runner.step(); expect(() => runner.previewHostIntervention(message())).toThrow('settled'); runner.stop();
    const moving = await setup('pump-crisis.json', { ...idle, fulfill: async () => ({ output: { toolId: 'move', arguments: { to: 'reservoir' } } }) });
    moving.runner.step(); await moving.runner.settleDecisions();
    expect(moving.runner.status().unresolvedActions).toBeGreaterThan(0);
    expect(() => moving.runner.interveneHost(message())).toThrow('settled'); moving.runner.stop();
  });
  it('retains exact old recording readers and rejects silently upgraded host identities', async () => {
    const recording = await loadRun(new URL('../fixtures/runs/shared-decision', import.meta.url).pathname);
    const checkpoint = recording.checkpoints[0];
    const models = Object.fromEntries(Object.entries(checkpoint.launch.effectiveConfig).map(([, effective]) => [effective.modelSlot, { ...idle, public: effective.model }]));
    const old = installedHost(checkpoint.host.contractId, checkpoint.host.implementationVersion);
    const restored = CharacterRunner.restore(checkpoint, old, models);
    expect(restored.inspect().host).toEqual((checkpoint.hostState as JsonObject).state);
    expect(restored.hostInterventions().operations).toEqual([]);
    expect(() => CharacterRunner.restore(checkpoint, installedHost(checkpoint.host.contractId), models)).toThrow('version mismatch');
  });
});
