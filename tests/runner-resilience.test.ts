import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCharacterRunner, contextProfile, type DecisionContext, type ModelConnection, type HostRegistration } from '../src/runner/index.js';
import { loadScenario, resolveSources, SqliteRunnerStorage, saveArchivedRun, openArchivedRun } from '../src/runner/node.js';
import { conversationHost } from '../examples/portable/hosts/conversation.js';
import { settlementHost } from '../examples/portable/hosts/settlement.js';
import { PlaygroundSession } from '../playground/session.js';
import { compileDataSchema, type JsonObject } from '../src/format/index.js';
const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
const idle = { output: { toolId: null, arguments: {} } };
async function setup(fulfill: ModelConnection['fulfill'], host: HostRegistration = conversationHost, storage?: SqliteRunnerStorage, timeout = 1000, memoryConfig: JsonObject = {}) {
  const path = host === settlementHost ? 'pump-crisis.json' : 'shared-decision.json';
  const loaded = await loadScenario(root, path, 'config-continuity.json');
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  const sources = { ...loaded.value.sources }, config = JSON.parse(sources['config-continuity.json']);
  config.profiles[contextProfile.id] = { version: contextProfile.version, required: true };
  config.features[contextProfile.id] = { enabled: true, config: { recentTurns: 1, batchRecords: 2, batchTurns: 1, ...memoryConfig } };
  config.limits = { maxSteps: 20, maxRequests: 200, maxInFlight: 3, requestTimeoutMs: timeout };
  sources['config-continuity.json'] = JSON.stringify(config);
  const bundle = resolveSources(sources, path, 'config-continuity.json'); if (!bundle.ok) throw new Error(JSON.stringify(bundle.diagnostics));
  const connection: ModelConnection = { public: { provider: 'fixture', model: 'resilience', settings: {} }, capabilities: { text: true, json: true }, fulfill };
  const result = createCharacterRunner(bundle.value, host, { primary: connection }, 'run:resilience', { storage });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return { runner: result.value, bundle: bundle.value };
}
function compact(_context: DecisionContext) { return { output: { toolId: 'simkind.compact', arguments: { summary: 'Facts are in originals.', episodes: [] } } }; }

describe('independent opportunities and request-bound edits', () => {
  it.each([conversationHost, settlementHost])('continues a fast compactor while another actor remains pending ($descriptor.contractId)', async host => {
    let slow = false, blocked = false, continued = false;
    let release: (() => void) | undefined;
    const { runner } = await setup(async (context, signal) => {
      if (slow && !blocked && context.instanceId === 'simkin:mira') {
        blocked = true;
        await new Promise<void>(resolve => { release = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
      }
      if (slow && blocked && context.instanceId === 'simkin:aya' && context.purpose !== 'consolidation') { continued = true; release?.(); }
      return context.purpose === 'consolidation' ? compact(context) : idle;
    }, host, undefined, 500);
    try {
      runner.step(); await runner.settleDecisions();
      slow = true; runner.step(); await runner.settleDecisions();
      expect(continued).toBe(true);
      expect(runner.events().filter(e => e.type === 'model-timeout')).toEqual([]);
      expect(runner.status().contextFailures).toEqual({});
    } finally { release?.(); runner.stop(); }
  });
  it('attaches the original character revision to edits and rejects intervening changes even after a correction retry', async () => {
    let finish: ((value: typeof idle | { output: unknown }) => void) | undefined;
    let saved: DecisionContext | undefined;
    const { runner } = await setup(async context => {
      if (context.instanceId !== 'simkin:aya') return idle;
      saved = context;
      if (!context.feedback) return { output: 'malformed' };
      return new Promise(resolve => { finish = resolve; });
    });
    runner.step(); const settled = runner.settleDecisions();
    for (let i = 0; i < 100 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 1));
    expect(finish).toBeDefined();
    const original = saved!.stateRevision;
    const intentions = runner.inspect().launch.states['simkin:aya'].context.intentions;
    runner.pauseDispatch(true); runner.step(); // A newer observation changes character state while the old decision is pending.
    expect(runner.inspect().launch.states['simkin:aya'].revision).toBeGreaterThan(original);
    finish!({ output: { toolId: 'simkind.revise', arguments: { intentions: [{ id: 'intent:old', description: 'Outdated plan' }] } } });
    await settled;
    const proposal = runner.events().find(e => e.type === 'proposal' && (e.data as JsonObject).toolId === 'simkind.revise' && (e.data as JsonObject).requestId !== undefined && String((e.data as JsonObject).requestId).startsWith('request:'))!;
    expect(proposal.data).toMatchObject({ arguments: { expectedRevision: original } });
    expect(runner.inspect().launch.states['simkin:aya'].context.intentions).toEqual(intentions);
    expect(runner.events().some(e => e.type === 'action' && (e.data as JsonObject).reason === 'Stale character state revision.')).toBe(true);
    runner.stop();
  });
  it('accepts omitted bookkeeping and freezes host constraints without broadening the catalog', async () => {
    const contexts: DecisionContext[] = [];
    const { runner } = await setup(async context => {
      contexts.push(context);
      return { output: { toolId: 'simkind.revise', arguments: { intentions: [{ id: 'intent:new', description: 'Choose independently' }] } } };
    });
    runner.step(); await runner.settleDecisions();
    for (const context of contexts) {
      const vote = context.tools.find(t => t.id === 'vote')!;
      const valid = compileDataSchema(vote.inputSchema);
      expect(valid({ option: 'invented' }).length).toBeGreaterThan(0);
      expect(valid({ option: 'garden', extra: true }).length).toBeGreaterThan(0);
      const revise = compileDataSchema(context.tools.find(t => t.id === 'simkind.revise')!.inputSchema);
      expect(revise({ interpretation: 'My plan' })).toEqual([]);
      expect(revise({ expectedRevision: context.stateRevision + 10, interpretation: 'My plan' }).length).toBeGreaterThan(0);
      expect(runner.inspect().launch.states[context.instanceId].context.intentions?.[0].id).toBe('intent:new');
    }
    runner.stop();
  });
});

describe('bounded cleanup and evidence-only archives', () => {
  it('saves playable evidence for an abort-ignoring provider, then allows a checkpoint after cleanup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'simkind-resilience-'));
    const storage = new SqliteRunnerStorage(join(directory, 'live.sqlite'));
    const releases: (() => void)[] = [];
    let runner: Awaited<ReturnType<typeof setup>>['runner'] | undefined;
    try {
      const result = await setup(async () => new Promise(resolve => releases.push(() => resolve(idle))), conversationHost, storage, 100);
      runner = result.runner; runner.step(); await runner.settleDecisions();
      expect(await runner.drainProviders(5)).toBe(false);
      expect(() => runner!.checkpoint()).toThrow('settled');
      const saved = await saveArchivedRun(join(directory, 'recording-0000'), runner, result.bundle, storage);
      expect(saved.resumable).toBe(false);
      const trace = await openArchivedRun(join(directory, 'recording-0000'));
      try {
        expect(trace.checkpoint).toBeUndefined();
        expect(trace.manifest.capabilities).toMatchObject({ playback: true, restore: false, branch: false });
        expect(trace.events().filter(e => e.type === 'model-timeout')).toHaveLength(3);
      } finally { trace.close(); }
      const session = new PlaygroundSession(root, directory, {});
      try {
        await session.open('recording-0000');
        expect(session.state()).toMatchObject({ mode: 'playback', checkpoints: [] });
        expect(() => session.branch()).toThrow('no resumable checkpoint');
        expect(session.exportPlayback().events.some(e => e.type === 'model-timeout')).toBe(true);
      } finally { session.dispose(); }
      releases.forEach(release => release());
      expect(await runner.drainProviders(100)).toBe(true);
      expect(runner.events().some(e => e.type === 'proposal')).toBe(false);
      expect((await saveArchivedRun(join(directory, 'settled'), runner, result.bundle, storage)).resumable).toBe(true);
    } finally { releases.forEach(release => release()); runner?.stop(); storage.close(); await rm(directory, { recursive: true, force: true }); }
  });
});


describe('bounded maintenance timing', () => {
  it('reserves decision time after slow compaction without changing the shared legacy deadline', async () => {
    vi.useFakeTimers();
    try {
      for (const separate of [false, true]) {
        let slow = false, maintenance = 0;
        const { runner } = await setup(async c => {
          if (slow) await new Promise(resolve => setTimeout(resolve, c.purpose === 'consolidation' ? 70 : 60));
          if (c.purpose === 'consolidation') { maintenance++; return compact(c); }
          return idle;
        }, conversationHost, undefined, 100, { maintenanceTimeoutMs: separate ? 100 : 0 });
        runner.step(); await vi.advanceTimersByTimeAsync(1); await runner.settleDecisions();
        slow = true; runner.step(); const settled = runner.settleDecisions();
        await vi.advanceTimersByTimeAsync(250); await settled;
        expect(maintenance).toBeGreaterThan(0);
        const timeouts = runner.events().filter(e => e.type === 'model-timeout');
        if (separate) expect(timeouts).toEqual([]);
        else expect(timeouts.length).toBeGreaterThan(0);
        runner.stop(); await runner.drainProviders(0);
      }
    } finally { vi.useRealTimers(); }
  });
});
