import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRunnerStorage, CharacterRunner, createCharacterRunner, contextProfile, type ModelConnection } from '../src/runner/index.js';
import { loadScenario, resolveSources } from '../src/runner/node.js';
import { conversationHost } from '../examples/portable/hosts/conversation.js';
import { chatCompletionsConnection, type ResponseMode } from '../src/providers/index.js';
afterEach(() => vi.unstubAllGlobals());
const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
async function setup(maxRequests = 15, target = 3, malformed = false, responseMode?: ResponseMode) {
  const loaded = await loadScenario(root, 'shared-decision.json', 'config-continuity.json');
  if (!loaded.ok) throw new Error('load');
  const sources = { ...loaded.value.sources }, config = JSON.parse(sources['config-continuity.json']);
  config.profiles[contextProfile.id] = { version: contextProfile.version, required: true };
  config.features[contextProfile.id] = { enabled: true, config: { recentTurns: 1, batchRecords: 2, batchTurns: 1 } };
  config.limits = { maxSteps: 20, maxRequests, maxDecisionOpportunitiesPerActor: target, maxInFlight: 3, requestTimeoutMs: 1000 };
  sources['config-continuity.json'] = JSON.stringify(config);
  const bundle = resolveSources(sources, 'shared-decision.json', 'config-continuity.json');
  if (!bundle.ok) throw new Error(JSON.stringify(bundle.diagnostics));
  const connection: ModelConnection = responseMode ? chatCompletionsConnection({ provider: 'test', model: 'test', endpoint: 'https://provider.example/chat', responseMode }) : { public: { provider: 'fixture', model: 'budget', settings: {} }, capabilities: { text: true, json: true },
    fulfill: async context => malformed && context.instanceId === 'simkin:aya' ? { output: 'bad JSON' } : { output: context.purpose === 'consolidation' ? { toolId: 'simkind.compact', arguments: { summary: 'Evidence remains accessible.', episodes: [] } } : { toolId: null, arguments: {} } } };
  const storage = new MemoryRunnerStorage();
  return { storage, result: createCharacterRunner(bundle.value, conversationHost, { primary: connection }, 'run:budget', { memoryPolicy: 'legacy', storage }), connection };
}
describe('reserved decision opportunities', () => {
  it('rejects a target the total request ceiling cannot cover', async () => {
    const { result } = await setup(8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.some(d => d.code === 'INSUFFICIENT_DECISION_BUDGET')).toBe(true);
  });
  it('completes equal decisions with aggressive compaction and stops admission at the target', async () => {
    const { result } = await setup(); if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runner = result.value;
    for (let i = 0; i < 4; i++) { runner.step(); await runner.settleDecisions(); }
    const status = runner.status();
    expect(status.opportunityLimitReached).toBe(true);
    expect(Object.values(status.decisionBudget!).map(c => c.primaryRequests)).toEqual([3, 3, 3]);
    expect(Object.values(status.decisionBudget!).map(c => c.completedDecisions)).toEqual([3, 3, 3]);
    expect(status.requests).toBeLessThanOrEqual(15);
    expect(status.contextFailures).toEqual({});
    expect(runner.events().filter(e => e.type === 'model-result' && (e.data as any).output.toolId === null)).toHaveLength(9);
    expect(runner.events().some(e => e.type === 'model-result' && (e.data as any).purpose === 'consolidation')).toBe(true);
    runner.stop();
  });
  it('does not let malformed output retries spend another actor’s reserved requests', async () => {
    const { result } = await setup(12, 3, true); if (!result.ok) throw new Error('launch');
    const runner = result.value;
    for (let i = 0; i < 3; i++) { runner.step(); await runner.settleDecisions(); }
    expect(runner.status().requests).toBeLessThanOrEqual(12);
    expect(Object.values(runner.status().decisionBudget!).map(c => c.primaryRequests)).toEqual([3, 3, 3]);
    expect(runner.events().filter(e => e.type === 'model-result' && (e.data as any).output.toolId === null)).toHaveLength(6);
    expect(runner.status().decisionBudget!['simkin:aya'].budgetExhaustions).toBe(3);
    expect(runner.status().contextFailures).toEqual({});
    runner.stop();
  });
  it('restores counters exactly and resets them only on a branch', async () => {
    const { result, connection, storage } = await setup(); if (!result.ok) throw new Error('launch');
    const runner = result.value;
    runner.step(); await runner.settleDecisions();
    const checkpoint = runner.checkpoint('checkpoint:budget');
    const restored = CharacterRunner.restore(checkpoint, conversationHost, { primary: connection }, undefined, { memoryPolicy: 'legacy', storage });
    expect(restored.status().decisionBudget).toEqual(runner.status().decisionBudget);
    const branch = CharacterRunner.restore(checkpoint, conversationHost, { primary: connection }, 'run:branch', { memoryPolicy: 'legacy', storage });
    expect(Object.values(branch.status().decisionBudget!).every(c => c.opportunities === 0 && c.primaryRequests === 0)).toBe(true);
    expect(checkpoint.scheduler.decisionBudget).toEqual(runner.status().decisionBudget);
    const bad = structuredClone(checkpoint); bad.scheduler.decisionBudget!['simkin:aya'].primaryRequests = 100;
    expect(() => CharacterRunner.restore(bad, conversationHost, { primary: connection })).toThrow('budget');
    runner.stop(); restored.stop(); branch.stop();
  });
});

it.each(['schema', 'json', 'text'] as const)('keeps local dynamic tool validation in %s mode', async mode => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
    const context = JSON.parse(JSON.parse(init.body as string).messages[1].content);
    const output = context.feedback ? { toolId: null, arguments: {} } : { toolId: 'vote', arguments: { option: 'invented' } };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
  }));
  const { result, connection, storage } = await setup(6, 1, false, mode); if (!result.ok) throw new Error('launch');
  const runner = result.value;
  runner.step(); await runner.settleDecisions();
  expect(runner.events().filter(e => e.type === 'model-error' && (e.data as any).code === 'INVALID_TOOL_OUTPUT')).toHaveLength(3);
  expect(runner.events().filter(e => e.type === 'proposal')).toHaveLength(0);
  expect(Object.values(runner.status().decisionBudget!).map(c => c.completedDecisions)).toEqual([1, 1, 1]);
  const checkpoint = runner.checkpoint('checkpoint:transport');
  expect(checkpoint.modelCapabilities?.primary.responseMode).toBe(mode);
  const wrong = { ...connection, capabilities: { ...connection.capabilities, responseMode: mode === 'text' ? 'json' as const : 'text' as const } };
  expect(() => CharacterRunner.restore(checkpoint, conversationHost, { primary: wrong }, undefined, { storage })).toThrow('capabilities mismatch');
  runner.stop();
});
