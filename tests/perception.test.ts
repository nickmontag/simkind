import { describe, it, expect } from 'vitest';
import { PerceptionJournal, MemoryRunnerStorage, createCharacterRunner, contextProfile, type ModelConnection, type DecisionContext } from '../src/runner/index.js';
import { loadScenario, resolveSources } from '../src/runner/node.js';
import { conversationPerceptionHost } from '../examples/portable/hosts/conversation.js';
import { fabricationPerceptionHost, fabricationGuidedHost } from '../examples/fabrication/host.js';
import { economyPerceptionHost } from '../examples/economy/host.js';
import type { JsonObject } from '../src/format/index.js';
const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
const idle = { output: { toolId: null, arguments: {} } };
const time = (value: number) => ({ clockId: 'clock:simulation', value });

async function setup(fulfill: ModelConnection['fulfill'], configOverrides: JsonObject = {}, scenario = 'shared-decision.json') {
  const configPath = scenario === 'shared-decision.json' ? 'config-continuity.json' : scenario === 'small-economy.json' ? 'config-economy-memory.json' : 'config-fabrication.json';
  const loaded = await loadScenario(root, scenario, configPath); if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  const sources = { ...loaded.value.sources }, config = JSON.parse(sources[configPath]);
  config.profiles[contextProfile.id] = { version: contextProfile.version, required: true };
  config.features[contextProfile.id] = { enabled: true, config: { recentTurns: 4, batchRecords: 8, batchTurns: 4, ...configOverrides } };
  config.limits = { maxSteps: 1000, maxRequests: 10000, maxInFlight: 4, requestTimeoutMs: 1000 };
  sources[configPath] = JSON.stringify(config);
  if (scenario === 'fabrication-shop.json') {
    const world = JSON.parse(sources[scenario]); world.initialConditions.turns = 1000; sources[scenario] = JSON.stringify(world);
  }
  const bundle = resolveSources(sources, scenario, configPath); if (!bundle.ok) throw new Error(JSON.stringify(bundle.diagnostics));
  const connection: ModelConnection = { public: { provider: 'fixture', model: 'perception', settings: {} }, capabilities: { text: true, json: true }, fulfill };
  const host = scenario === 'shared-decision.json' ? conversationPerceptionHost : scenario === 'small-economy.json' ? economyPerceptionHost : fabricationGuidedHost;
  const runner = createCharacterRunner(bundle.value, host, { primary: connection }, 'run:perception');
  if (!runner.ok) throw new Error(JSON.stringify(runner.diagnostics));
  return { runner: runner.value, host, connection };
}

describe('scenario-independent perception', () => {
  it('restores each audience in its original order across private and shared events', () => {
    const journal = new PerceptionJournal(['a', 'b'], 'social');
    journal.publish({ id: 'private:1', kind: 'dialogue', authority: 'statement', capturedAt: time(1), recipients: ['b'], text: 'A private warning.' });
    journal.publish({ id: 'shared:2', kind: 'narrative', authority: 'host', capturedAt: time(2), recipients: ['a', 'b'], text: 'The visitor arrived.' });
    const restored = new PerceptionJournal(['a', 'b'], 'social'); restored.restore(journal.snapshot());
    expect(restored.drain('b', 'run:restored', time(3), 0).map(event => event.id)).toEqual(['private:1', 'shared:2']);
    expect(restored.drain('a', 'run:restored', time(3), 0).map(event => event.id)).toEqual(['shared:2']);
  });
  it('keeps identical dialogue occurrences, deduplicates identity, preserves privacy and authority on restore', () => {
    const storage = new MemoryRunnerStorage(), journal = new PerceptionJournal(['a', 'b', 'c'], 'friendship', storage);
    const first = { id: 'event:1', kind: 'dialogue' as const, authority: 'statement' as const, capturedAt: time(1), actor: 'a', recipients: ['a', 'b'], text: "I'll be there tomorrow." };
    journal.publish(first); journal.publish(first);
    journal.publish({ ...first, id: 'event:2', capturedAt: time(2) });
    journal.publish({ id: 'event:3', kind: 'narrative', authority: 'host', capturedAt: time(2), recipients: ['a', 'b'], text: 'B left without answering.' });
    journal.publish({ id: 'event:4', kind: 'interpretation', authority: 'interpretation', capturedAt: time(2), recipients: ['a'], actor: 'a', text: 'I think B is angry.' });
    expect(journal.drain('c', 'run:one', time(3), 1)).toEqual([]);
    const heard = journal.drain('b', 'run:one', time(3), 1);
    expect(heard.map(e => e.id)).toEqual(['event:1', 'event:2', 'event:3']);
    expect(heard[0].capturedAt).toEqual(time(1)); expect(heard[0].deliveredAt).toEqual(time(3));
    expect(() => journal.publish({ ...first, text: 'Changed history' })).toThrow('Conflicting');
    expect(() => journal.publish({ ...first, id: 'lie', authority: 'host' })).toThrow('authority');
    const restored = new PerceptionJournal(['a', 'b', 'c'], 'friendship'); restored.restore(journal.snapshot());
    expect(restored.drain('b', 'run:branch', time(4), 1)).toEqual([]);
    expect(restored.drain('a', 'run:branch', time(4), 1)).toHaveLength(4);
  });
  it('keeps recent dialogue once and current state once; never archives repeated snapshots as experiences', async () => {
    const contexts: DecisionContext[] = [];
    const { runner } = await setup(async context => {
      contexts.push(structuredClone(context));
      if (context.purpose === 'consolidation') return { output: { toolId: 'simkind.compact', arguments: { summary: 'A private invitation remains unresolved.', episodes: [] } } };
      const turn = Number(context.observations[0].capturedAt.value);
      return context.instanceId === 'simkin:aya' && turn <= 2 ? { output: { toolId: 'say', arguments: { text: 'Meet me at the garden tomorrow.', to: 'simkin:sol' } } } : idle;
    });
    for (let i = 0; i < 5; i++) { runner.step(); await runner.settleDecisions(); }
    const sol = contexts.filter(c => c.instanceId === 'simkin:sol' && c.purpose !== 'consolidation').at(-1)!;
    expect(sol.perception?.currentStateIds).toHaveLength(1);
    expect(sol.recent?.filter(m => m.text.includes('Meet me at the garden tomorrow.'))).toHaveLength(2);
    expect(sol.recent?.some(m => m.text.includes('sharedContext'))).toBe(false);
    expect(contexts.filter(c => c.instanceId === 'simkin:mira').some(c => JSON.stringify(c).includes('Meet me at the garden tomorrow.'))).toBe(false);
    const snapshotEvents = runner.events().filter(e => e.type === 'observation' && JSON.stringify(e.data).includes('sharedContext'));
    expect(snapshotEvents).toHaveLength(15); // Full audit remains available.
    runner.stop();
  });
  it('delivers shop counterparty receipts once', async () => {
    const contexts: DecisionContext[] = [];
    let offerId = '';
    const { runner } = await setup(async c => {
      contexts.push(structuredClone(c)); const turn = Number(c.observations[0]?.capturedAt.value);
      if (c.instanceId === 'simkin:ada' && turn === 1) {
        offerId = `action:${c.requestId}`;
        return { output: { toolId: 'offer', arguments: { kind: 'trade', to: 'simkin:bram', give: { cash: 7 }, want: {}, quantity: 0, rentalTurns: 0, minUses: 1, expiresAt: 5 } } };
      }
      if (c.instanceId === 'simkin:bram' && turn === 2) return { output: { toolId: 'accept', arguments: { offerId } } };
      return idle;
    }, {}, 'fabrication-shop.json');
    for (let i = 0; i < 4; i++) { runner.step(); await runner.settleDecisions(); }
    const ada = contexts.find(c => c.instanceId === 'simkin:ada' && c.observations[0]?.capturedAt.value === 3)!;
    expect(JSON.stringify(ada.observations)).toContain('Traded $7 to Bram');
    expect(JSON.stringify(contexts.find(c => c.instanceId === 'simkin:cleo' && c.observations[0]?.capturedAt.value === 3)!.observations)).not.toContain('Traded $7 to Bram');
    const later = contexts.find(c => c.instanceId === 'simkin:ada' && c.observations[0]?.capturedAt.value === 4)!;
    expect(JSON.stringify(later.observations)).not.toContain('Traded $7 to Bram');
    expect(JSON.stringify(later.recent)).toContain('Traded $7 to Bram');
    runner.stop();
  });
  it('preserves a scenario’s public transaction rules when replacing snapshot history with receipts', async () => {
    const contexts: DecisionContext[] = []; let offerId = '';
    const { runner } = await setup(async context => {
      contexts.push(structuredClone(context)); const turn = Number(context.observations[0]?.capturedAt.value);
      if (turn === 1 && context.instanceId === 'simkin:ada') {
        offerId = `action:${context.requestId}`;
        return { output: { toolId: 'offer', arguments: { kind: 'trade', to: 'simkin:bram', give: { coins: 5 }, want: { timber: 1 }, task: null, useTool: false, expiresAt: 6 } } };
      }
      if (turn === 2 && context.instanceId === 'simkin:bram') return { output: { toolId: 'accept', arguments: { offerId } } };
      return idle;
    }, {}, 'small-economy.json');
    for (let turn = 0; turn < 4; turn++) { runner.step(); await runner.settleDecisions(); }
    const bystander = contexts.find(c => c.instanceId === 'simkin:cleo' && c.observations[0]?.capturedAt.value === 3)!;
    expect(bystander.perception?.eventIds).toContain('economy-receipt:0');
    expect(JSON.stringify(bystander.observations)).toContain('"kind":"trade"');
    const later = contexts.find(c => c.instanceId === 'simkin:cleo' && c.observations[0]?.capturedAt.value === 4)!;
    expect(later.perception?.eventIds).not.toContain('economy-receipt:0');
    expect(JSON.stringify(later.recent)).toContain('economy-receipt:0');
    runner.stop();
  });
  it('restores conversation audiences and delivery cursors without replaying an old exchange', async () => {
    const { runner, host } = await setup(async c => Number(c.observations[0]?.capturedAt.value) === 1 && c.instanceId === 'simkin:aya'
      ? { output: { toolId: 'say', arguments: { text: 'Secret invitation', to: 'simkin:sol' } } } : idle);
    runner.step(); await runner.settleDecisions(); runner.step(); await runner.settleDecisions();
    // The core in-memory archive checkpoint can be restored against its original storage via archived tests;
    // host-only replay also preserves delivery cursors for non-archived embeddings.
    const launch = runner.launchSnapshot(); const direct = host.create(launch);
    direct.advance(); direct.submit({ id: 'a:one', runId: launch.runId, actor: 'simkin:aya', requestId: 'r:one', toolId: 'say', toolVersion: '1.0.0', observedRevision: 0, arguments: { text: 'Private', to: 'simkin:sol' } });
    direct.perceive!('simkin:sol');
    const restored = host.restore!(launch, direct.checkpoint!());
    expect(restored.perceive!('simkin:sol').events).toHaveLength(0);
    expect(restored.perceive!('simkin:aya').events).toHaveLength(1);
    expect(restored.perceive!('simkin:mira').events).toHaveLength(0);
    runner.stop();
  });
});

describe('cross-scenario context evaluation', () => {
  it.each(['shared-decision.json', 'fabrication-shop.json'])('keeps state-heavy sessions bounded over 200 turns (%s)', async scenario => {
    let maximum = 0, decisions = 0;
    const { runner } = await setup(async c => { maximum = Math.max(maximum, JSON.stringify(c).length); decisions++;
      if (c.purpose === 'consolidation') return { output: { toolId: 'simkind.compact', arguments: { summary: 'Original events remain searchable.', episodes: [] } } };
      return idle;
    }, {}, scenario);
    for (let i = 0; i < 200; i++) { runner.step(); await runner.settleDecisions(); expect(runner.status().contextFailures).toEqual({}); }
    expect(runner.status().steps).toBe(200);
    expect(decisions).toBeGreaterThan(300);
    expect(maximum).toBeLessThan(30000); // No lifetime snapshot growth, even with large static scenario descriptions.
    for (const memory of Object.values(runner.status().memory ?? {})) expect(memory.evidence).toBeLessThan(10);
    runner.stop();
  }, 20000);
});


it('rejects impossible recipient jobs before escrow in the current shop implementation', async () => {
  const { runner, host } = await setup(async () => idle, {}, 'fabrication-shop.json');
  const direct = host.create(runner.launchSnapshot()); direct.advance();
  const before = direct.inspect();
  const result = direct.submit({ id: 'offer:oversized', runId: runner.manifest().runId, actor: 'simkin:cleo', requestId: 'request:test',
    observedRevision: direct.revision(), toolId: 'offer', toolVersion: '1.0.0', arguments: {
      kind: 'job', to: 'simkin:bram', give: { cash: 10 }, want: {}, quantity: 8, rentalTurns: 0, minUses: 1, expiresAt: 5,
    } });
  expect(result.at(-1)?.reason).toContain('No eligible recipient');
  expect(direct.inspect()).toEqual(before); runner.stop();
});

it('explains separate compensation and inputs without changing legal jobs or legacy feedback', async () => {
  const { runner, host } = await setup(async () => idle, {}, 'fabrication-shop.json');
  const direct = host.create(runner.launchSnapshot()); direct.advance();
  const before = direct.inspect(), proposal = { id: 'job:double', runId: runner.manifest().runId, actor: 'simkin:ada', requestId: 'request:test',
    observedRevision: direct.revision(), toolId: 'offer', toolVersion: '1.0.0', arguments: {
      kind: 'job', to: 'simkin:bram', give: { cash: 10, materials: 4, tools: 1 }, want: {}, quantity: 4, rentalTurns: 0, minUses: 1, expiresAt: 5,
    } };
  const rejected = direct.submit(proposal).at(-1)!;
  expect(rejected.reason).toContain('/arguments/give is compensation');
  expect(rejected.reason).toContain('0 materials and 0 qualifying owned tools');
  expect(rejected.reason).toContain('requires 4 materials and 1 owned tool');
  expect(direct.inspect()).toEqual(before);
  const legacy = fabricationPerceptionHost.create(runner.launchSnapshot()); legacy.advance();
  expect(legacy.submit(proposal).at(-1)?.reason).toBe('Reserve wages plus manufacturing materials and qualifying equipment.');
  const valid = direct.submit({ ...proposal, id: 'job:valid', arguments: { ...proposal.arguments, give: { cash: 10 } } });
  expect(valid.at(-1)?.status).toBe('succeeded');
  const constraints = direct.toolConstraints!('simkin:ada');
  expect(JSON.stringify(constraints.offer)).toContain('compensation');
  expect(JSON.stringify(constraints.offer)).toContain('empty object');
  runner.stop();
});
