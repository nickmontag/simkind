import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { loadScenario, saveRun, SqliteRunnerStorage, runDurably } from 'simkind/node';
import { createCharacterRunner, prepareLaunch, contextProfile, type ModelConnection } from 'simkind/runner';
import { compileDataSchema, readJson } from 'simkind/format';
import { installedHost } from './hosts/registry.js';
import { ollamaConnection } from 'simkind/providers';
import { openRouterConnection } from 'simkind/providers';

const { values } = parseArgs({ options: {
  root: { type: 'string', default: 'examples/portable/scenarios' },
  scenario: { type: 'string', default: 'shared-decision.json' },
  config: { type: 'string', default: 'config-continuity.json' }, connections: { type: 'string' },
  output: { type: 'string' }, check: { type: 'boolean', default: false },
  fixture: { type: 'boolean', default: false }, 'structured-outputs': { type: 'boolean', default: false }, 'max-output-tokens': { type: 'string' },
} });

async function main() {
  const loaded = await loadScenario(values.root!, values.scenario!, values.config!);
  if (!loaded.ok) { console.error(JSON.stringify(loaded.diagnostics, null, 2)); process.exitCode = 1; return; }
  const scenario = loaded.value.documents[loaded.value.scenarioId];
  if (scenario.kind !== 'scenario') throw new Error('The scenario entry is not a scenario document.');
  const host = installedHost(scenario.host.contractId);
  const connections: Record<string, ModelConnection> = Object.create(null);
  const settings = values['max-output-tokens'] ? { maxOutputTokens: Number(values['max-output-tokens']) } : {};
  if (values.fixture) {
    connections.primary = { public: { provider: 'fixture', model: 'no-action-v1', settings: {} }, capabilities: { text: true, json: true },
      fulfill: async context => ({ output: context.purpose === 'consolidation' ? { toolId: 'simkind.compact', arguments: { summary: 'Deterministic fixture memory.', episodes: [] } } : { toolId: null, arguments: {} } }) };
  } else {
    let fileEnv: ReturnType<typeof parseEnv> = {};
    try { fileEnv = parseEnv(await readFile('.env', 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const env = { ...fileEnv, ...process.env };
    if (values.connections) {
      const source = readJson(await readFile(values.connections, 'utf8'));
      if (!source.ok) throw new Error('Connections file must contain strict JSON.');
      const schema = { type: 'object', propertyNames: { pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }, additionalProperties: {
        type: 'object', additionalProperties: false, required: ['provider', 'model', 'apiKeyEnv'], properties: {
          provider: { const: 'openrouter' }, model: { type: 'string', minLength: 1 }, apiKeyEnv: { type: 'string', pattern: '^[A-Z_][A-Z0-9_]*$' },
          structuredOutputs: { type: 'boolean' }, settings: { type: 'object', additionalProperties: false, properties: { temperature: { type: 'number', minimum: 0, maximum: 2 }, maxOutputTokens: { type: 'integer', minimum: 1 } } },
        },
      } };
      if (compileDataSchema(schema)(source.value).length) throw new Error('Invalid connection slots. Use provider, explicit model, apiKeyEnv, and optional public settings.');
      for (const [slot, config] of Object.entries(source.value as Record<string, { model: string; apiKeyEnv: string; structuredOutputs?: boolean; settings?: ModelConnection['public']['settings'] }>)) {
        connections[slot] = openRouterConnection(env[config.apiKeyEnv] ?? '', config.model, config.settings, { structuredOutputs: config.structuredOutputs });
      }
    } else connections.primary = env.SIMKIND_PROVIDER === 'ollama' ? ollamaConnection(env.OLLAMA_MODEL ?? '', env.OLLAMA_ENDPOINT || undefined, settings) : openRouterConnection(env.OPENROUTER_API_KEY ?? '', env.OPENROUTER_MODEL ?? '', settings, { structuredOutputs: values['structured-outputs'] });
  }
  const runId = `run:${randomUUID()}`;
  const prepared = prepareLaunch(loaded.value, host, connections, runId);
  if (!prepared.ok) { console.error(JSON.stringify(prepared.diagnostics, null, 2)); process.exitCode = 1; return; }
  console.log(JSON.stringify({ runId, scenario: scenario.id, host: scenario.host, effectiveConfig: prepared.value.effectiveConfig,
    configurationSources: prepared.value.configurationSources, limits: prepared.value.config.limits }, null, 2));
  if (values.check) return;
  const output = values.output ?? resolve('.internal/runs', runId.replace(':', '-'));
  await mkdir(dirname(output), { recursive: true });
  const archived = Object.values(prepared.value.effectiveConfig).some(effective => effective.features[contextProfile.id]?.enabled);
  if (process.env.SIMKIND_SUPERVISED && !archived) throw new Error('Supervised runs require simkind.context and simkind.continuity in the run configuration.');
  if (archived) await writeFile(output + '.active.sqlite', '', { flag: 'wx', mode: 0o600 });
  const storage = archived ? new SqliteRunnerStorage(output + '.active.sqlite') : undefined;
  const result = createCharacterRunner(loaded.value, host, connections, runId, { storage, recordTimings: !values.fixture });
  if (!result.ok) { storage?.close(); throw new Error('Launch compatibility changed.'); }
  const runner = result.value;
  if (storage) {
    const controller = new AbortController(), interrupt = () => controller.abort();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
      const report = await runDurably(runner, storage, output, { signal: controller.signal });
      console.log(JSON.stringify(report));
      if (report.state === 'failed') process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
      if (await runner.drainProviders(5000)) storage.close();
    }
    return;
  }
  const onInterrupt = () => runner.stop();
  process.once('SIGINT', onInterrupt);
  try {
    for (let step = 0; step < prepared.value.config.limits.maxSteps && !runner.status().stopped; step++) {
      runner.step();
      await runner.settleDecisions();
      console.log(JSON.stringify(runner.status()));
    }
  } catch {
    runner.stop();
    process.exitCode = 1;
    console.error('Host execution or protocol validation failed. Saving the incomplete run evidence.');
  } finally { process.removeListener('SIGINT', onInterrupt); }
  const status = runner.status();
  const candidate = !status.stopped && !status.pendingRequests && !status.activeProviders && !status.unresolvedActions ? runner.checkpoint() : undefined;
  const checkpoints = candidate && Buffer.byteLength(JSON.stringify(candidate)) <= 1024 * 1024 ? [candidate] : [];
  if (candidate && !checkpoints.length) console.log('Checkpoint exceeds 1 MiB; saving complete playback evidence without resumability.');
  await saveRun(output, runner.manifest(), runner.events(), loaded.value, checkpoints);
  console.log(JSON.stringify({ saved: output, status: runner.status(), host: runner.inspect().host }));
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : 'Scenario run failed.');
  process.exitCode = 1;
}
