import { open, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { readJson, readDocument, canonicalJson, isResourcePath, validateRecord, validateTime, type RunBundle, type RunEvent } from '../format/index.js';
import { validateCheckpoint, type RunnerCheckpoint } from './checkpoint.js';
import { sha256 } from './node.js';

export interface RecordedRun { manifest: RunBundle; events: RunEvent[]; checkpoints: RunnerCheckpoint[] }

/** Read-only verified playback. No host registrations or provider connections are accepted. */
export async function loadRun(directory: string): Promise<RecordedRun> {
  const base = await realpath(directory);
  let total = 0;
  async function read(path: string, hash?: string) {
    if (!isResourcePath(path)) throw new Error('Unsafe run resource path.');
    const actual = await realpath(resolve(base, path));
    const rel = relative(base, actual);
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Run resource escapes its directory.');
    const handle = await open(actual, 'r');
    let source: string;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024 || total + stat.size > 64 * 1024 * 1024) throw new Error('Run resource exceeds playback limits.');
      const buffer = Buffer.alloc(stat.size + 1);
      let count = 0;
      while (count < buffer.length) { const result = await handle.read(buffer, count, buffer.length - count); if (!result.bytesRead) break; count += result.bytesRead; }
      if (count > stat.size) throw new Error('Run resource changed while reading.');
      total += count;
      const bytes = buffer.subarray(0, count);
      if (hash && sha256(bytes) !== hash) throw new Error('Run resource hash mismatch.');
      source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } finally { await handle.close(); }
    return source;
  }
  const parsed = readDocument(await read('run.json'));
  if (!parsed.ok || parsed.value.kind !== 'run-bundle') throw new Error('Invalid run manifest.');
  const manifest = parsed.value;
  if (manifest.profiles?.['simkind.archive']?.required) throw new Error('Use openArchivedRun for paged archive recordings.');
  const events: RunEvent[] = [];
  const ids = new Set<string>();
  for (const stream of manifest.eventStreams) {
    const source = await read(stream.path, stream.sha256);
    const lines = source.endsWith('\n') ? source.slice(0, -1).split('\n') : source.split('\n');
    const records = source === '' ? [] : lines;
    if (records.length !== stream.count) throw new Error('Event count mismatch.');
    for (const line of records) {
      const parsed = readJson(line);
      if (!parsed.ok || validateRecord('RunEvent', parsed.value).length) throw new Error('Invalid recorded event.');
      const event = parsed.value as RunEvent;
      if (event.runId !== manifest.runId || event.sequence !== events.length || ids.has(event.id) || validateTime(event.time, manifest.clocks).length) throw new Error('Invalid recorded event identity, order, or clock.');
      ids.add(event.id); events.push(event);
    }
  }
  for (const input of manifest.inputs) {
    const document = readDocument(await read(input.path, input.sha256), input.path.endsWith('.md') ? 'markdown' : 'json');
    if (!document.ok || document.value.id !== input.documentId) throw new Error('Invalid frozen run input.');
    if (input.compiledPath) {
      const compiled = readDocument(await read(input.compiledPath, input.compiledSha256));
      if (!compiled.ok || canonicalJson(compiled.value) !== canonicalJson(document.value)) throw new Error('Compiled input differs from its source.');
    }
  }
  const checkpoints: RunnerCheckpoint[] = [];
  const checkpointIds = new Set<string>();
  for (const entry of manifest.checkpoints) {
    if (checkpointIds.has(entry.id)) throw new Error('Duplicate checkpoint ID.');
    checkpointIds.add(entry.id);
    const parsed = readJson(await read(entry.path, entry.sha256));
    if (!parsed.ok) throw new Error('Invalid checkpoint JSON (maximum 1 MiB).');
    const checkpoint = parsed.value as RunnerCheckpoint;
    validateCheckpoint(checkpoint);
    if (checkpoint.id !== entry.id || canonicalJson(checkpoint.host) !== canonicalJson(manifest.host)) throw new Error('Checkpoint identity mismatch.');
    if (checkpoint.launch.runId === manifest.runId) {
      if (canonicalJson(checkpoint.events) !== canonicalJson(events.slice(0, checkpoint.events.length))) throw new Error('Checkpoint history differs from run prefix.');
    } else if (checkpoint.launch.runId !== manifest.parent?.runId || checkpoint.id !== manifest.parent.checkpointId) throw new Error('Unrelated parent checkpoint.');
    checkpoints.push(checkpoint);
  }
  if ((manifest.capabilities.restore || manifest.capabilities.branch) && !checkpoints.some(c => c.launch.runId === manifest.runId)) throw new Error('Run claims restoration without a checkpoint.');
  return { manifest, events, checkpoints };
}
