import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), 'simkind-consumer-'));
let archive;
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', directory], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  archive = join(directory, packed[0].filename);
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'simkind-external-consumer', private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], { cwd: directory, stdio: 'inherit' });
  await writeFile(join(directory, 'consumer.ts'), `
import { rankMemories } from 'simkind';
import { readDocument, importCharacterCard } from 'simkind/format';
import { createCharacterRunner, CharacterRunner, continuityProfile, replayCheckpoint } from 'simkind/runner';
import { loadScenario, loadRun, saveRun, resolveSources } from 'simkind/node';
import { ollamaConnection, openRouterConnection } from 'simkind/providers';
import { toWorld, worldFrame } from 'simkind/spatial';
void [rankMemories, readDocument, importCharacterCard, createCharacterRunner, CharacterRunner, continuityProfile, replayCheckpoint, loadScenario, loadRun, saveRun, resolveSources, ollamaConnection, openRouterConnection, toWorld, worldFrame];
`);
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', target: 'ES2022', strict: true, noEmit: true, skipLibCheck: true }, files: ['consumer.ts'] }));
  execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], { cwd: directory, stdio: 'inherit' });
  await cp(resolve(root, 'fixtures/runs/shared-decision'), join(directory, 'recorded'), { recursive: true });
  await writeFile(join(directory, 'consumer.mjs'), `
import { strict as assert } from 'node:assert';
import { loadRun } from 'simkind/node';
import { importCharacterCard } from 'simkind/format';
import { toWorld, worldFrame } from 'simkind/spatial';
import { ollamaConnection } from 'simkind/providers';
const recording = await loadRun('./recorded');
assert.equal(recording.manifest.capabilities.restore, true);
assert.ok(recording.events.some(event => event.type === 'action'));
assert.deepEqual(toWorld([1,2,3], worldFrame), [1,2,3]);
assert.equal(ollamaConnection('explicit-model').public.model, 'explicit-model');
assert.equal(importCharacterCard(JSON.stringify({name:'A',description:'B',personality:'C',scenario:'D',first_mes:'E',mes_example:'F'}),'character:a').ok, true);
console.log('External tarball imports, TypeScript declarations, verified playback, spatial and provider APIs passed.');
`);
  execFileSync('node', ['consumer.mjs'], { cwd: directory, stdio: 'inherit' });
  const packageInfo = JSON.parse(await readFile(join(directory, 'node_modules/simkind/package.json'), 'utf8'));
  if (packageInfo.version !== '0.2.0-alpha.1') throw new Error('Unexpected release version.');
} finally { await rm(directory, { recursive: true, force: true }); }
