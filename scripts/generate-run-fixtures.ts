import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadScenario, saveRun, loadRun } from 'simkind/node';
import { createCharacterRunner, replayCheckpoint, type ModelConnection } from 'simkind/runner';
import { conversationHost } from '../examples/portable/hosts/conversation.js';
import { settlementHost } from '../examples/portable/hosts/settlement.js';
import { spatialHost } from '../examples/spatial/host.js';
const checking = process.argv.includes('--check');
const output = checking ? await mkdtemp(join(tmpdir(), 'simkind-fixtures-')) : resolve('fixtures/runs');
await mkdir(output, { recursive: true });
try {
  for (const [scene, host] of [['shared-decision.json', conversationHost], ['pump-crisis.json', settlementHost], ['orbital-greenhouse.json', spatialHost]] as const) {
    const loaded = await loadScenario('examples/portable/scenarios', scene, 'config-continuity.json'); if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    const primary: ModelConnection = { public: { provider: 'fixture', model: 'evidence-v1', settings: {} }, capabilities: { text: true, json: true }, fulfill: async context => ({ output:
      context.requestId === 'request:1' ? { toolId: 'say', arguments: { text: 'What does each of us know that the others might be missing?', ...(host === conversationHost ? { to: null } : {}) } }
        : { toolId: null, arguments: {} } }) };
    const name = scene.replace('.json', '');
    const result = createCharacterRunner(loaded.value, host, { primary }, `run:fixture-${name}`); if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runner = result.value;
    for (let i = 0; i < 2; i++) { runner.step(); await runner.settleDecisions(); }
    const checkpoint = runner.checkpoint();
    replayCheckpoint(checkpoint, host);
    await saveRun(join(output, name), runner.manifest(), runner.events(), loaded.value, [checkpoint]);
    await loadRun(join(output, name));
    if (checking) {
      const compare = async (path: string) => {
        for (const item of await readdir(join(output, path), { withFileTypes: true })) {
          const file = join(path, item.name);
          if (item.isDirectory()) await compare(file);
          else if (!Buffer.from(await readFile(join(output, file))).equals(await readFile(resolve('fixtures/runs', file)))) throw new Error(`Run fixture drift: ${file}`);
        }
      };
      await compare(name);
    }
  }
  console.log(checking ? 'All three run fixtures reproduced exactly.' : 'Wrote three deterministic run fixtures.');
} finally { if (checking) await rm(output, { recursive: true, force: true }); }
