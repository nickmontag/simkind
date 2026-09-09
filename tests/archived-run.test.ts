import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaygroundSession } from '../playground/session.js';
import { openArchivedRun, loadRun } from '../src/runner/node.js';
import type { ModelConnection } from '../src/runner/index.js';

const fixture: ModelConnection = { public: { provider: 'fixture', model: 'archive-test', settings: {} }, capabilities: { text: true, json: true },
  fulfill: async context => ({ output: context.purpose === 'consolidation' ? { toolId: 'simkind.compact', arguments: { summary: 'Fixture memory.', episodes: [] } } : { toolId: null, arguments: {} } }) };

describe('archived playground recordings', () => {
  it('saves, pages, inspects original requests, branches without future leakage, and rejects tampering', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'simkind-archive-'));
    const session = new PlaygroundSession(new URL('../examples/portable/scenarios', import.meta.url).pathname, directory, {}, fixture);
    let opened: Awaited<ReturnType<typeof openArchivedRun>> | undefined;
    try {
      session.start(await session.template('small-economy.json'));
      for (let turn = 0; turn < 16; turn++) await session.step();
      const snapshot = session.state();
      expect(snapshot).toMatchObject({ memoryEnabled: true, status: { steps: 16, pendingRequests: 0, contextFailures: {} } });
      const name = await session.save();
      opened = await openArchivedRun(join(directory, name));
      expect(opened.events(0, 3)).toHaveLength(3);
      expect(opened.checkpoint!.version).toBe('simkind.checkpoint/2');
      expect(opened.checkpoint!.archive!.eventCount).toBeGreaterThan(128);
      await expect(loadRun(join(directory, name))).rejects.toThrow('openArchivedRun');
      await session.open(name);
      const page = session.state({ runId: opened.manifest.runId, after: 0, summary: true });
      const request = page.events!.find(event => event.type === 'request')!;
      expect(request.data).toMatchObject({ projection: 'observer-summary' });
      expect(session.evidence(request.sequence).selected.data).toHaveProperty('context.observations');
      const modelResult = page.events!.find(event => event.type === 'model-result')!;
      expect(session.evidence(modelResult.sequence).originalRequest?.data).toHaveProperty('context.observations');
      const memory = session.memory('simkin:ada', { fromTurn: 0, toTurn: 1 });
      expect(memory.evidence.length).toBeGreaterThan(0);
      expect(memory.memory.version).toBeGreaterThan(0);
      const exported = session.exportPlayback(true);
      expect(exported.events).toHaveLength(opened.checkpoint!.archive!.eventCount);
      expect(exported.manifest.profiles).not.toHaveProperty('simkind.archive');
      await session.branch(); session.dispatch(); await session.step();
      expect(session.state()).toMatchObject({ mode: 'live', memoryEnabled: true, status: { steps: 1, contextFailures: {} } });
      expect(opened.checkpoint!.archive!.eventCount).toBe(opened.storage.count(`events:${opened.manifest.runId}`));
      const comparison = await session.compare();
      expect(comparison).toHaveProperty('left.requests', (snapshot as { status: { requests: number } }).status.requests);
      const sibling = await session.save();
      await session.open(name); await session.branch(); session.dispatch(); await session.step();
      const siblings = await session.compare(sibling);
      expect(siblings).toHaveProperty('sharedPrefix.eventCount', opened.checkpoint!.archive!.eventCount);
      opened.close(); opened = undefined;
      await appendFile(join(directory, name, 'checkpoint.json'), ' ');
      await expect(openArchivedRun(join(directory, name))).rejects.toThrow('hash mismatch');
    } finally { session.dispose(); opened?.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
