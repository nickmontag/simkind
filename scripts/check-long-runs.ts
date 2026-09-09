/** Deterministic lifecycle/scale evidence. The fixture summarizer is not a cognition benchmark. */
import { mkdtemp, rm, stat, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { createCharacterRunner, CharacterRunner, contextProfile, type ModelConnection } from '../src/runner/index.js';
import { loadScenario, SqliteRunnerStorage } from '../src/runner/node.js';
import { conversationHost, conversationPerceptionHost } from '../examples/portable/hosts/conversation.js';
import { settlementHost, settlementPerceptionHost } from '../examples/portable/hosts/settlement.js';
import type { RunConfig } from '../src/format/index.js';

const { values } = parseArgs({ options: { legacy: { type: 'boolean', default: false }, turns: { type: 'string', default: '100,1000,10000' }, output: { type: 'string', default: '.internal/long-memory/procedural.json' } } });
const reports: unknown[] = [];
for (const scene of ['shared-decision.json', 'pump-crisis.json']) for (const turns of values.turns!.split(',').map(Number)) {
  const directory = await mkdtemp(join(tmpdir(), 'simkind-soak-'));
  const store = new SqliteRunnerStorage(join(directory, 'live.sqlite'));
  let restoredStore: SqliteRunnerStorage | undefined;
  try {
    const loaded = await loadScenario(new URL('../examples/portable/scenarios', import.meta.url).pathname, scene, 'config-continuity.json');
    if (!loaded.ok) throw new Error('Cannot load soak fixture.');
    const config = loaded.value.documents[loaded.value.configId] as RunConfig;
    config.profiles![contextProfile.id] = { version: contextProfile.version, required: true };
    config.features![contextProfile.id] = { enabled: true, config: { batchRecords: 24, recentTurns: 4, batchTurns: 8 } };
    config.limits.maxSteps = turns + 1; config.limits.maxRequests = (turns + 1) * 12;
    const original = scene === 'pump-crisis.json' ? (values.legacy ? settlementHost : settlementPerceptionHost) : (values.legacy ? conversationHost : conversationPerceptionHost);
    const host = { ...original, descriptor: { ...original.descriptor, limits: { ...original.descriptor.limits, maxSteps: turns + 1, maxRequests: (turns + 1) * 12 } } };
    let maximumInput = 0, calls = 0, compactions = 0, lastInput = 0;
    const model: ModelConnection = { public: { provider: 'fixture', model: 'deterministic-memory-v1', settings: {} }, capabilities: { text: true, json: true }, fulfill: async context => {
      calls++; lastInput = JSON.stringify(context).length; maximumInput = Math.max(maximumInput, lastInput);
      if (context.purpose === 'consolidation') { compactions++; return { output: { toolId: 'simkind.compact', arguments: { summary: 'Preserve current goals; original experiences remain searchable.', episodes: [{ text: context.memories[0].text.slice(0, 800), evidenceIds: [context.memories[0].id] }] } } }; }
      if (calls % 10 === 0) return { output: { toolId: 'simkind.revise', arguments: { expectedRevision: context.stateRevision, interpretation: 'I remain uncertain and will preserve my intentions.', evidence: context.recent?.slice(0, 1).map(m => m.id) ?? [] } } };
      return { output: { toolId: null, arguments: {} } };
    } };
    const created = createCharacterRunner(loaded.value, host, { primary: model }, 'run:soak', { storage: store });
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    const runner = created.value, initialIntentions = Object.fromEntries(Object.entries(runner.inspect().launch.states).map(([actor, state]) => [actor, state.context.intentions]));
    const blocks: number[] = []; let block = performance.now(); const started = block;
    for (let turn = 1; turn <= turns; turn++) {
      runner.step(); await runner.settleDecisions();
      if (Object.keys(runner.status().contextFailures ?? {}).length) throw new Error(JSON.stringify(runner.status().contextFailures));
      if (turn % 100 === 0) { blocks.push(performance.now() - block); block = performance.now(); }
      if (turn % 1000 === 0) process.stdout.write(JSON.stringify({ scene, turns, completed: turn, calls, compactions, maximumInput }) + '\n');
    }
    const elapsedMs = performance.now() - started;
    const checkpoint = runner.checkpoint();
    await store.copyTo(join(directory, 'frozen.sqlite'));
    restoredStore = new SqliteRunnerStorage(join(directory, 'frozen.sqlite'));
    const restoreStart = performance.now();
    const restored = CharacterRunner.restore(checkpoint, host, { primary: model }, undefined, { storage: restoredStore });
    const restoreMs = performance.now() - restoreStart;
    if (JSON.stringify(restored.inspect()) !== JSON.stringify(runner.inspect())) throw new Error('Restore mismatch.');
    const final = runner.inspect();
    for (const [actor, state] of Object.entries(final.launch.states)) {
      if (JSON.stringify(state.context.intentions) !== JSON.stringify(initialIntentions[actor]) || state.context.memories?.length) throw new Error('Intentions or resident memory changed unexpectedly.');
    }
    let errors = 0;
    for (let offset = 0;; offset += 256) { const page = runner.events(offset, 256); errors += page.filter(e => e.type === 'model-error' || e.type === 'model-timeout').length; if (page.length < 256) break; }
    if (errors) throw new Error(`Soak recorded ${errors} model failures.`);
    const report = { scene, implementationVersion: original.descriptor.implementationVersion, turnsPerActor: turns, actors: Object.keys(final.launch.states).length, calls, compactions, maximumInputCharacters: maximumInput,
      lastInputCharacters: lastInput, elapsedMs: Math.round(elapsedMs), first100Ms: Math.round(blocks[0] ?? elapsedMs), last100Ms: Math.round(blocks.at(-1) ?? elapsedMs),
      restoreMs: Math.round(restoreMs), checkpointBytes: Buffer.byteLength(JSON.stringify(checkpoint)), archiveBytes: (await stat(join(directory, 'frozen.sqlite'))).size,
      residentProcessBytes: process.memoryUsage().rss, errors, exactRestore: true, intentionsPreserved: true };
    reports.push(report); process.stdout.write(JSON.stringify(report) + '\n');
    await mkdir(join(values.output!, '..'), { recursive: true }); await writeFile(values.output!, JSON.stringify(reports, null, 2) + '\n');
  } finally { restoredStore?.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
}
