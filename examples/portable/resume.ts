import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { loadRun, saveRun, isArchivedRun, openArchivedRun, SqliteRunnerStorage, recoverArchivedCheckpoint, runDurably } from 'simkind/node';
import { CharacterRunner, replayCheckpoint, type ModelConnection } from 'simkind/runner';
import { openRouterConnection, ollamaConnection } from 'simkind/providers';
import { memoryPolicyFromEnvironment } from './memory-options.js';
import { installedHost } from './hosts/registry.js';
const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' }, branch: { type: 'boolean' }, replay: { type: 'boolean' }, fixture: { type: 'boolean' }, recover: { type: 'boolean' } } });
if (!values.input) throw new Error('Supply --input with a saved run directory or an active SQLite file with --recover.');
if (values.replay && values.recover) throw new Error('Recovery restores an archive checkpoint; it does not use legacy command replay.');
const destination = values.output ?? resolve('.internal/runs', `continuation-${randomUUID()}`);
await mkdir(dirname(destination), { recursive: true });
const recovered = values.recover ? await recoverArchivedCheckpoint(values.input, destination + '.active.sqlite') : undefined;
const archived = !recovered && await isArchivedRun(values.input) ? await openArchivedRun(values.input) : undefined;
const recording = archived || recovered ? undefined : await loadRun(values.input);
const checkpoint = recovered ? recovered.checkpoint : archived ? archived.checkpoint : recording!.checkpoints.filter(c => c.launch.runId === recording!.manifest.runId).at(-1);
if (!checkpoint) throw new Error('This run has no resumable checkpoint.');
const host = installedHost(checkpoint.host.contractId, checkpoint.host.implementationVersion);
if (values.replay && archived) { archived.close(); throw new Error('Archive profiles support verified playback and exact restore; command-replay verification is a legacy operation.'); }
if (values.replay) console.log(JSON.stringify({ replayVerified: true, ...replayCheckpoint(checkpoint, host) }, null, 2));
else {
  let fileEnv: ReturnType<typeof parseEnv> = {};
  try { fileEnv = parseEnv(await readFile('.env', 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const env = { ...fileEnv, ...process.env };
  const connections: Record<string, ModelConnection> = Object.create(null);
  for (const effective of Object.values(checkpoint.launch.effectiveConfig)) {
    const model = effective.model;
    if (values.fixture && model.provider === 'fixture') connections[effective.modelSlot] = { public: model, capabilities: { text: true, json: true }, fulfill: async context => ({ output: context.purpose === 'consolidation' ? { toolId: 'simkind.compact', arguments: { summary: 'Deterministic fixture memory.', episodes: [] } } : { toolId: null, arguments: {} } }) };
    else if (model.provider === 'openrouter') connections[effective.modelSlot] = openRouterConnection(env.OPENROUTER_API_KEY ?? '', model.model, model.settings, { responseMode: checkpoint.modelCapabilities?.[effective.modelSlot]?.responseMode, structuredOutputs: checkpoint.modelCapabilities?.[effective.modelSlot]?.jsonSchema });
    else if (model.provider === 'ollama') connections[effective.modelSlot] = ollamaConnection(model.model, env.OLLAMA_ENDPOINT || undefined, model.settings, { responseMode: checkpoint.modelCapabilities?.[effective.modelSlot]?.responseMode });
    else throw new Error('Use the embedding API to supply this exact provider connection.');
  }
  const directory = destination;
  await mkdir(dirname(directory), { recursive: true });
  let storage: SqliteRunnerStorage | undefined = recovered?.storage;
  if (archived) {
    await writeFile(directory + '.active.sqlite', '', { flag: 'wx', mode: 0o600 });
    await archived.storage.copyTo(directory + '.active.sqlite'); archived.close();
    storage = new SqliteRunnerStorage(directory + '.active.sqlite');
  }
  let runner: CharacterRunner | undefined;
  try {
  runner = CharacterRunner.restore(checkpoint, host, connections, values.branch ? `run:${randomUUID()}` : undefined, { storage, recordTimings: !values.fixture, memoryPolicy: !values.fixture && checkpoint.memoryPolicy ? memoryPolicyFromEnvironment(env, checkpoint.memoryPolicy) : undefined });
  runner.pauseDispatch(false);
  if (storage) {
    const controller = new AbortController(), interrupt = () => controller.abort();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
      const report = await runDurably(runner, storage, directory, { signal: controller.signal });
      console.log(JSON.stringify(report));
      if (report.state === 'failed') process.exitCode = 1;
    }
    finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
  } else {
  if (process.env.SIMKIND_SUPERVISED) throw new Error('Supervised resume requires a SQLite archive or active database with --recover.');
  while (runner.status().steps < runner.inspect().launch.config.limits.maxSteps && !runner.status().stopped) { runner.step(); await runner.settleDecisions(); }
  const status = runner.status(); const checkpoints = values.branch ? [checkpoint] : [];
  if (!status.activeProviders && !status.pendingRequests && !status.unresolvedActions && !status.stopped) checkpoints.push(runner.checkpoint(`checkpoint:${randomUUID()}`));
  await saveRun(directory, runner.manifest(), runner.events(), runner.inspect().launch.bundle, checkpoints);
  console.log(JSON.stringify({ saved: directory, status, parent: runner.manifest().parent }));
  }
  } finally { if (!runner || await runner.drainProviders(5000)) storage?.close(); }
}
