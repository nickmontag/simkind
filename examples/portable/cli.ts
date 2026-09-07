import { readFile } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadScenario, saveRun } from 'simkind/node';
import { createCharacterRunner, prepareLaunch, type ModelConnection } from 'simkind/runner';
import { compileDataSchema, readJson } from 'simkind/format';
import { installedHost } from './hosts/registry.js';
import { ollamaConnection } from 'simkind/providers';
import { openRouterConnection } from './openrouter.js';

const { values } = parseArgs({ options: {
  root: { type: 'string', default: 'examples/portable/scenarios' },
  scenario: { type: 'string', default: 'shared-decision.json' },
  config: { type: 'string', default: 'config-continuity.json' }, connections: { type: 'string' },
  output: { type: 'string' }, check: { type: 'boolean', default: false },
  fixture: { type: 'boolean', default: false },
} });

async function main() {
  const loaded = await loadScenario(values.root!, values.scenario!, values.config!);
  if (!loaded.ok) { console.error(JSON.stringify(loaded.diagnostics, null, 2)); process.exitCode = 1; return; }
  const scenario = loaded.value.documents[loaded.value.scenarioId];
  if (scenario.kind !== 'scenario') throw new Error('The scenario entry is not a scenario document.');
  const host = installedHost(scenario.host.contractId);
  const connections: Record<string, ModelConnection> = Object.create(null);
  if (values.fixture) {
    connections.primary = { public: { provider: 'fixture', model: 'no-action-v1', settings: {} }, capabilities: { text: true, json: true },
      fulfill: async () => ({ output: { toolId: null, arguments: {} } }) };
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
          settings: { type: 'object', additionalProperties: false, properties: { temperature: { type: 'number', minimum: 0, maximum: 2 }, maxOutputTokens: { type: 'integer', minimum: 1 } } },
        },
      } };
      if (compileDataSchema(schema)(source.value).length) throw new Error('Invalid connection slots. Use provider, explicit model, apiKeyEnv, and optional public settings.');
      for (const [slot, config] of Object.entries(source.value as Record<string, { model: string; apiKeyEnv: string; settings?: ModelConnection['public']['settings'] }>)) {
        connections[slot] = openRouterConnection(env[config.apiKeyEnv] ?? '', config.model, config.settings);
      }
    } else connections.primary = env.SIMKIND_PROVIDER === 'ollama' ? ollamaConnection(env.OLLAMA_MODEL ?? '', env.OLLAMA_ENDPOINT || undefined) : openRouterConnection(env.OPENROUTER_API_KEY ?? '', env.OPENROUTER_MODEL ?? '');
  }
  const runId = `run:${randomUUID()}`;
  const prepared = prepareLaunch(loaded.value, host, connections, runId);
  if (!prepared.ok) { console.error(JSON.stringify(prepared.diagnostics, null, 2)); process.exitCode = 1; return; }
  console.log(JSON.stringify({ runId, scenario: scenario.id, host: scenario.host, effectiveConfig: prepared.value.effectiveConfig,
    configurationSources: prepared.value.configurationSources, limits: prepared.value.config.limits }, null, 2));
  if (values.check) return;
  const result = createCharacterRunner(loaded.value, host, connections, runId);
  if (!result.ok) throw new Error('Launch compatibility changed.');
  const runner = result.value;
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
  const output = values.output ?? resolve('.internal/runs', runId.replace(':', '-'));
  const { mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(output), { recursive: true });
  const status = runner.status();
  const checkpoints = !status.stopped && !status.pendingRequests && !status.activeProviders && !status.unresolvedActions ? [runner.checkpoint()] : [];
  await saveRun(output, runner.manifest(), runner.events(), loaded.value, checkpoints);
  console.log(JSON.stringify({ saved: output, status: runner.status(), host: runner.inspect().host }));
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : 'Scenario run failed.');
  process.exitCode = 1;
}
