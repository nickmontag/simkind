import { readFile, mkdir } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { loadRun, saveRun } from 'simkind/node';
import { CharacterRunner, replayCheckpoint, type ModelConnection } from 'simkind/runner';
import { openRouterConnection, ollamaConnection } from 'simkind/providers';
import { installedHost } from './hosts/registry.js';
const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' }, branch: { type: 'boolean' }, replay: { type: 'boolean' }, fixture: { type: 'boolean' } } });
if (!values.input) throw new Error('Supply --input with a saved run directory.');
const recording = await loadRun(values.input);
const checkpoint = recording.checkpoints.filter(c => c.launch.runId === recording.manifest.runId).at(-1);
if (!checkpoint) throw new Error('This run has no resumable checkpoint.');
const host = installedHost(checkpoint.host.contractId, checkpoint.host.implementationVersion);
if (values.replay) console.log(JSON.stringify({ replayVerified: true, ...replayCheckpoint(checkpoint, host) }, null, 2));
else {
  let fileEnv: ReturnType<typeof parseEnv> = {};
  try { fileEnv = parseEnv(await readFile('.env', 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const env = { ...fileEnv, ...process.env };
  const connections: Record<string, ModelConnection> = Object.create(null);
  for (const effective of Object.values(checkpoint.launch.effectiveConfig)) {
    const model = effective.model;
    if (values.fixture && model.provider === 'fixture') connections[effective.modelSlot] = { public: model, capabilities: { text: true, json: true }, fulfill: async () => ({ output: { toolId: null, arguments: {} } }) };
    else if (model.provider === 'openrouter') connections[effective.modelSlot] = openRouterConnection(env.OPENROUTER_API_KEY ?? '', model.model, model.settings);
    else if (model.provider === 'ollama') connections[effective.modelSlot] = ollamaConnection(model.model, env.OLLAMA_ENDPOINT || undefined, model.settings);
    else throw new Error('Use the embedding API to supply this exact provider connection.');
  }
  const runner = CharacterRunner.restore(checkpoint, host, connections, values.branch ? `run:${randomUUID()}` : undefined);
  runner.pauseDispatch(false);
  while (runner.status().steps < runner.inspect().launch.config.limits.maxSteps && !runner.status().stopped) { runner.step(); await runner.settleDecisions(); }
  const status = runner.status(); const checkpoints = values.branch ? [checkpoint] : [];
  if (!status.activeProviders && !status.pendingRequests && !status.unresolvedActions && !status.stopped) checkpoints.push(runner.checkpoint(`checkpoint:${randomUUID()}`));
  const directory = values.output ?? resolve('.internal/runs', `continuation-${randomUUID()}`);
  await mkdir(dirname(directory), { recursive: true });
  await saveRun(directory, runner.manifest(), runner.events(), runner.inspect().launch.bundle, checkpoints);
  console.log(JSON.stringify({ saved: directory, status, parent: runner.manifest().parent }));
}
