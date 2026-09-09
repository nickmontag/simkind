import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CharacterRunner, createCharacterRunner, contextProfile, type ModelConnection } from '../src/runner/index.js';
import { loadScenario, resolveSources, SqliteRunnerStorage, runDurably, recoverArchivedCheckpoint, openArchivedRun } from '../src/runner/node.js';
import { conversationPerceptionHost } from '../examples/portable/hosts/conversation.js';
const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
const idle: ModelConnection = { public: { provider: 'fixture', model: 'durable', settings: {} }, capabilities: { text: true, json: true },
  fulfill: async () => ({ output: { toolId: null, arguments: {} }, usage: { inputTokens: 10, outputTokens: 1, cost: 0.001 } }) };
async function setup(storage: SqliteRunnerStorage, connection = idle) {
  const loaded = await loadScenario(root, 'shared-decision.json', 'config-continuity.json'); if (!loaded.ok) throw new Error('Fixture load failed.');
  const sources = { ...loaded.value.sources }, config = JSON.parse(sources['config-continuity.json']);
  config.profiles[contextProfile.id] = { version: contextProfile.version, required: true };
  config.features[contextProfile.id] = { enabled: true, config: {} };
  config.limits = { maxSteps: 6, maxRequests: 60, maxInFlight: 3, requestTimeoutMs: 200 };
  sources['config-continuity.json'] = JSON.stringify(config);
  const bundle = resolveSources(sources, 'shared-decision.json', 'config-continuity.json'); if (!bundle.ok) throw new Error('Fixture resolve failed.');
  const result = createCharacterRunner(bundle.value, conversationPerceptionHost, { primary: connection }, 'run:durable', { storage });
  if (!result.ok) throw new Error('Fixture launch failed.');
  return result.value;
}

describe('durable sessions', () => {
  it('writes a bounded-horizon report and archive, then recovers an exact checkpoint into a new file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'simkind-durable-')); const storage = new SqliteRunnerStorage(join(directory, 'active.sqlite'));
    let recovered: Awaited<ReturnType<typeof recoverArchivedCheckpoint>> | undefined;
    try {
      const runner = await setup(storage);
      const report = await runDurably(runner, storage, join(directory, 'run'));
      expect(report).toMatchObject({ state: 'limit-reached', status: { steps: 6, completed: false }, usage: { inputTokens: 180, outputTokens: 18 }, archive: { resumable: true } });
      expect(report.usage.cost).toBeCloseTo(0.018);
      expect(JSON.parse(await readFile(join(directory, 'run.report.json'), 'utf8'))).toEqual(report);
      const archive = await openArchivedRun(join(directory, 'run')); expect(archive.checkpoint!.scheduler.steps).toBe(6); archive.close();
      recovered = await recoverArchivedCheckpoint(storage.path, join(directory, 'recovered.sqlite'));
      const restored = CharacterRunner.restore(recovered.checkpoint, conversationPerceptionHost, { primary: idle }, undefined, { storage: recovered.storage });
      expect(restored.inspect().host).toEqual(runner.inspect().host);
      expect(restored.status().requests).toBe(runner.status().requests);
    } finally { recovered?.storage.close(); storage.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it('reports interruption before export and preserves the last checkpoint when a provider is cancelled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'simkind-interrupt-')); const storage = new SqliteRunnerStorage(join(directory, 'active.sqlite'));
    const controller = new AbortController();
    try {
      const connection: ModelConnection = { ...idle, fulfill: async (_c, signal) => {
        await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }); queueMicrotask(() => controller.abort()); });
        return { output: { toolId: null, arguments: {} } };
      } };
      const runner = await setup(storage, connection);
      const report = await runDurably(runner, storage, join(directory, 'run'), { signal: controller.signal });
      expect(report.state).toBe('interrupted'); expect(report.latestCheckpoint).toBeTruthy();
      expect(report.archive?.resumable).toBe(false);
      const archive = await openArchivedRun(join(directory, 'run')); expect(archive.checkpoint).toBeUndefined(); archive.close();
      const recovered = await recoverArchivedCheckpoint(storage.path, join(directory, 'recovered.sqlite'));
      expect(recovered.checkpoint.scheduler.steps).toBe(0); recovered.storage.close();
      expect(JSON.parse(await readFile(join(directory, 'run.report.json'), 'utf8')).state).toBe('interrupted');
    } finally { storage.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
