import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { canonicalJson, readDocument, validateDocument, validateRecord, validateTime, isResourcePath, type RunBundle, type RunEvent, type JsonObject } from '../format/index.js';
import { validateCheckpoint, type RunnerCheckpoint } from './checkpoint.js';
import { SqliteRunnerStorage } from './sqlite-storage.js';
import type { CharacterRunner } from './runner.js';
import type { PreparedLaunch, ResolvedBundle } from './contracts.js';
import { parseJson } from '../format/character.js';

const profile = 'simkind.archive';
interface ArchiveDescriptor { path: string; sha256: string; checkpointPath?: string; checkpointSha256?: string; launchPath?: string; launchSha256?: string; eventCount: number }
async function digest(path: string) { const hash = createHash('sha256'); for await (const part of createReadStream(path)) hash.update(part); return hash.digest('hex'); }
function hash(source: string) { return createHash('sha256').update(source).digest('hex'); }

/** Immutable, disk-backed recording. JSONL chunks permit independent evidence readers. */
export async function saveArchivedRun(directory: string, runner: CharacterRunner, bundle: ResolvedBundle, storage: SqliteRunnerStorage): Promise<{ resumable: boolean }> {
  // Poll cancellation cleanup for a bounded interval; never manufacture a settled boundary.
  await runner.drainProviders();
  const status = runner.status();
  const settled = !status.stopped && !status.activeProviders && !status.pendingRequests && !status.unresolvedActions;
  const checkpoint = settled ? runner.checkpoint() : undefined;
  const launch = runner.launchSnapshot();
  const manifest = runner.manifest();
  const eventCount = storage.count(`events:${manifest.runId}`);
  if (checkpoint && checkpoint.version !== 'simkind.checkpoint/2') throw new Error('Archived saves require the context profile.');
  if (canonicalJson(bundle) !== canonicalJson(launch.bundle)) throw new Error('Save requires the exact launched source bundle.');
  for (const artifact of bundle.artifacts) {
    const content = bundle.sources[artifact.path];
    if (!isResourcePath(artifact.path) || content === undefined || hash(content) !== artifact.sha256) throw new Error('Frozen source mismatch.');
    const parsed = readDocument(content, artifact.path.endsWith('.md') ? 'markdown' : 'json');
    if (!parsed.ok || canonicalJson(parsed.value) !== canonicalJson(bundle.documents[artifact.documentId])) throw new Error('Compiled source differs from launched document.');
    if (artifact.compiledPath && (!isResourcePath(artifact.compiledPath) || hash(canonicalJson(parsed.value)) !== artifact.compiledSha256)) throw new Error('Compiled source hash mismatch.');
  }
  const source = canonicalJson(checkpoint ?? launch);
  if (Buffer.byteLength(source) > 16 * 1024 * 1024) throw new Error('Host/current-state checkpoint exceeds the archive profile allowance.');
  await mkdir(directory); // Never overwrite a published recording.
  await storage.copyTo(join(directory, 'archive.sqlite'));
  const frozen = new SqliteRunnerStorage(join(directory, 'archive.sqlite'), { readOnly: true });
  try {
    if (checkpoint && canonicalJson(frozen.get('checkpoints', checkpoint.id)) !== source || frozen.count(`events:${manifest.runId}`) !== eventCount) throw new Error('Run changed while saving; retry at a settled boundary.');
    await writeFile(join(directory, checkpoint ? 'checkpoint.json' : 'launch.json'), source, { flag: 'wx' });
    manifest.profiles = { ...manifest.profiles, [profile]: { version: checkpoint ? '1.0.0' : '1.1.0', required: true } };
    manifest.extensions = { ...manifest.extensions, [profile]: { path: 'archive.sqlite', sha256: await digest(join(directory, 'archive.sqlite')),
      ...(checkpoint ? { checkpointPath: 'checkpoint.json', checkpointSha256: hash(source) } : { launchPath: 'launch.json', launchSha256: hash(source) }), eventCount } };
    manifest.checkpoints = checkpoint ? [{ id: checkpoint.id, path: 'checkpoint.json', sha256: hash(source), boundary: 'settled' }] : [];
    manifest.capabilities = { ...manifest.capabilities, restore: !!checkpoint, branch: !!checkpoint && runner.hostCapabilities().branch };
    manifest.eventStreams = [];
    let chunk = '', chunkBytes = 0, index = 0, count = 0;
    const flush = async () => {
      if (!count) return;
      const path = `events-${index++}.jsonl`; await writeFile(join(directory, path), chunk, { flag: 'wx' });
      manifest.eventStreams.push({ path, sha256: hash(chunk), count }); chunk = ''; chunkBytes = 0; count = 0;
    };
    for (let cursor = 0; cursor < eventCount;) {
      const page = frozen.read<RunEvent>(`events:${manifest.runId}`, { after: cursor - 1, limit: 128 });
      if (!page.length) throw new Error('Archive event stream is incomplete.');
      for (const row of page) {
        if (row.sequence !== cursor || row.value.sequence !== cursor) throw new Error('Archive event sequence has a gap.');
        const line = JSON.stringify(row.value) + '\n';
        const bytes = Buffer.byteLength(line);
        if (chunkBytes + bytes > 8 * 1024 * 1024) await flush();
        chunk += line; chunkBytes += bytes; count++; cursor++;
      }
    }
    await flush();
    manifest.inputs = bundle.artifacts.map(artifact => ({ ...artifact, path: `inputs/${artifact.path}` }));
    for (const artifact of bundle.artifacts) {
      const content = bundle.sources[artifact.path];
      if (!isResourcePath(artifact.path) || content === undefined || hash(content) !== artifact.sha256) throw new Error('Frozen source mismatch.');
      await mkdir(join(directory, 'inputs', artifact.path, '..'), { recursive: true });
      await writeFile(join(directory, 'inputs', artifact.path), content, { flag: 'wx' });
      if (artifact.compiledPath) {
        await mkdir(join(directory, artifact.compiledPath, '..'), { recursive: true });
        await writeFile(join(directory, artifact.compiledPath), canonicalJson(bundle.documents[artifact.documentId]), { flag: 'wx' });
      }
    }
    if (!validateDocument(manifest).ok) throw new Error('Invalid archived manifest.');
    await writeFile(join(directory, 'run.json'), canonicalJson(manifest), { flag: 'wx' });
  } finally { frozen.close(); }
  return { resumable: !!checkpoint };
}

/** Verifies hashes with bounded reads, then serves indexed pages without loading lifetime history. */
export async function openArchivedRun(directory: string): Promise<{ manifest: RunBundle; checkpoint?: RunnerCheckpoint; launch: PreparedLaunch; eventCount: number; storage: SqliteRunnerStorage; events(after?: number, limit?: number): RunEvent[]; close(): void }> {
  const base = await realpath(directory);
  const file = async (path: string, expected?: string) => {
    if (!isResourcePath(path)) throw new Error('Unsafe archive path.');
    const actual = await realpath(resolve(base, path)), rel = relative(base, actual);
    if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('Archive escapes recording.');
    if (!(await stat(actual)).isFile() || expected && await digest(actual) !== expected) throw new Error('Archive resource hash mismatch.');
    return actual;
  };
  const readSmall = async (path: string, max: number, expected?: string) => {
    const actual = await file(path, expected);
    if ((await stat(actual)).size > max) throw new Error('Archive metadata exceeds its profile allowance.');
    return parseJson(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(actual)));
  };
  const checked = validateDocument(await readSmall('run.json', 1024 * 1024));
  if (!checked.ok || checked.value.kind !== 'run-bundle') throw new Error('Invalid run manifest.');
  const manifest = checked.value, descriptor = manifest.extensions?.[profile] as unknown as ArchiveDescriptor;
  const version = manifest.profiles?.[profile]?.version;
  if (!['1.0.0', '1.1.0'].includes(version ?? '') || !descriptor || !Number.isSafeInteger(descriptor.eventCount) || descriptor.eventCount < 0
    || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error('Unsupported archive profile.');
  let checkpoint: RunnerCheckpoint | undefined;
  let launch: PreparedLaunch;
  if (descriptor.checkpointPath && descriptor.checkpointSha256) {
    checkpoint = await readSmall(descriptor.checkpointPath, 16 * 1024 * 1024, descriptor.checkpointSha256) as RunnerCheckpoint;
    validateCheckpoint(checkpoint);
    if (checkpoint.version !== 'simkind.checkpoint/2' || checkpoint.launch.runId !== manifest.runId || checkpoint.archive!.eventCount !== descriptor.eventCount) throw new Error('Archived checkpoint mismatch.');
    if (canonicalJson(checkpoint.host) !== canonicalJson(manifest.host)
      || !manifest.checkpoints.some(item => item.id === checkpoint!.id && item.path === descriptor.checkpointPath && item.sha256 === descriptor.checkpointSha256)) throw new Error('Manifest does not describe its archived checkpoint.');
    launch = checkpoint.launch;
  } else {
    if (version !== '1.1.0' || !descriptor.launchPath || !descriptor.launchSha256 || manifest.capabilities.restore || manifest.capabilities.branch || manifest.checkpoints.length) throw new Error('Invalid evidence-only archive.');
    launch = await readSmall(descriptor.launchPath, 16 * 1024 * 1024, descriptor.launchSha256) as PreparedLaunch;
    if (!launch || launch.runId !== manifest.runId || !launch.states || !launch.bundle || !validateDocument(launch.scenario).ok || !validateDocument(launch.config).ok
      || !Object.values(launch.states).every(state => validateDocument(state).ok)) throw new Error('Invalid archived launch.');
  }
  if (canonicalJson(launch.effectiveConfig) !== canonicalJson(manifest.effectiveConfig)
    || manifest.eventStreams.reduce((sum, stream) => sum + stream.count, 0) !== descriptor.eventCount) throw new Error('Manifest does not describe its archive.');
  for (const input of manifest.inputs) { await file(input.path, input.sha256); if (input.compiledPath) await file(input.compiledPath, input.compiledSha256); }
  for (const stream of manifest.eventStreams) await file(stream.path, stream.sha256);
  const storage = new SqliteRunnerStorage(await file(descriptor.path, descriptor.sha256), { readOnly: true });
  try {
    if (storage.count(`events:${manifest.runId}`) !== descriptor.eventCount || checkpoint && canonicalJson(storage.get('checkpoints', checkpoint.id)) !== canonicalJson(checkpoint)) throw new Error('Archive contents do not match checkpoint.');
  } catch (error) { storage.close(); throw error; }
  return { manifest, checkpoint, launch, eventCount: descriptor.eventCount, storage, close: () => storage.close(), events(after = 0, limit = 128) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 0 || limit > 10000) throw new Error('Invalid evidence page.');
    return storage.read<RunEvent>(`events:${manifest.runId}`, { after: after - 1, limit }).map((row, index) => {
      const event = row.value;
      if (event.sequence !== after + index || event.sequence !== row.sequence || event.runId !== manifest.runId || validateRecord('RunEvent', event).length || validateTime(event.time, manifest.clocks).length) throw new Error('Invalid archived event.');
      return event;
    });
  } };
}

/** Read only enough metadata to choose the recording reader. */
export async function isArchivedRun(directory: string): Promise<boolean> {
  const path = join(directory, 'run.json');
  if ((await stat(path)).size > 1024 * 1024) throw new Error('Run manifest too large.');
  const manifest = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path))) as { profiles?: Record<string, JsonObject> };
  return ['1.0.0', '1.1.0'].includes(String(manifest.profiles?.[profile]?.version));
}

/** Recovers a simulated host's last settled state into a new file, retaining the interrupted source. */
export async function recoverArchivedCheckpoint(sourcePath: string, destinationPath: string): Promise<{ checkpoint: RunnerCheckpoint; storage: SqliteRunnerStorage }> {
  const source = new SqliteRunnerStorage(sourcePath, { readOnly: true });
  let checkpoint: RunnerCheckpoint;
  try {
    const id = source.get<string>('runner', 'latestCheckpoint');
    const saved = id && source.get<RunnerCheckpoint>('checkpoints', id);
    if (!saved || saved.version !== 'simkind.checkpoint/2' || saved.archive?.revision === undefined) throw new Error('No recoverable settled checkpoint.');
    checkpoint = saved; validateCheckpoint(checkpoint);
    // Exclusive creation prevents a recovery from overwriting another session.
    await writeFile(destinationPath, '', { flag: 'wx' });
    await source.copyTo(destinationPath);
  } finally { source.close(); }
  const storage = new SqliteRunnerStorage(destinationPath);
  try {
    storage.rewind(checkpoint.archive!.revision!);
    storage.set('checkpoints', checkpoint.id, checkpoint);
    storage.set('runner', 'latestCheckpoint', checkpoint.id);
    return { checkpoint, storage };
  } catch (error) { storage.close(); throw error; }
}
