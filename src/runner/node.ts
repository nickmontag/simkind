import { validateCheckpoint, type RunnerCheckpoint } from './checkpoint.js';
import { createHash } from 'node:crypto';
import { open, realpath, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { isResourcePath, readDocument, writeDocument, canonicalJson, validateDocument, validateRecord, validateTime,
  type FormatResult, type RunBundle, type RunEvent } from '../format/index.js';
import { diagnostic } from '../format/character.js';
import type { ResolvedBundle } from './contracts.js';

export function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }

/** Local-only resolver: all catalog paths are relative to this explicit bundle root. */
export async function loadScenario(root: string, scenarioPath: string, configPath: string): Promise<FormatResult<ResolvedBundle>> {
  const bundle: ResolvedBundle = { scenarioId: '', configId: '', documents: Object.create(null), artifacts: [], sources: Object.create(null) };
  const paths = new Map<string, string>();
  const realPaths = new Map<string, string>();
  const visiting = new Set<string>();
  let bytes = 0;
  class Failure extends Error { constructor(readonly code: string, message: string) { super(message); } }
  try {
    const base = await realpath(root);
    async function load(path: string, expectedId?: string, expectedHash?: string): Promise<string> {
      if (!isResourcePath(path)) throw new Failure('INVALID_RESOURCE_PATH', 'Use a bundle-relative path without traversal or URI syntax.');
      if (visiting.has(path)) throw new Failure('REFERENCE_CYCLE', 'Remove cyclic resource dependencies.');
      if (paths.has(path)) {
        const id = paths.get(path)!;
        if (expectedId && id !== expectedId) throw new Failure('REFERENCE_MISMATCH', 'Resource ID does not match its document.');
        if (expectedHash && sha256(bundle.sources[path]) !== expectedHash) throw new Failure('HASH_MISMATCH', 'Resource bytes differ from the declared hash.');
        return id;
      }
      if (paths.size >= 128) throw new Failure('BUNDLE_TOO_LARGE', 'Use at most 128 documents in a bundle.');
      const actual = await realpath(resolve(base, path));
      const rel = relative(base, actual);
      if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Failure('PATH_ESCAPE', 'The resolved resource (including symlinks) must stay inside the bundle root.');
      if (realPaths.has(actual)) throw new Failure('CONFLICTING_RESOURCE', 'One physical source must have one authoritative resource path.');
      const handle = await open(actual, 'r');
      let content: Uint8Array;
      try {
        // Bounded read even if a file grows after stat; directories are rejected.
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Failure('DOCUMENT_TOO_LARGE', 'Use regular UTF-8 files at or below 1 MiB.');
        const buffer = Buffer.alloc(1024 * 1024 + 1);
        let count = 0;
        while (count < buffer.length) { const read = await handle.read(buffer, count, buffer.length - count); if (!read.bytesRead) break; count += read.bytesRead; }
        if (count > 1024 * 1024) throw new Failure('DOCUMENT_TOO_LARGE', 'Keep each document at or below 1 MiB.');
        content = buffer.subarray(0, count);
      } finally { await handle.close(); }
      bytes += content.byteLength;
      if (bytes > 16 * 1024 * 1024) throw new Failure('BUNDLE_TOO_LARGE', 'Keep total authored input at or below 16 MiB.');
      const hash = sha256(content);
      if (expectedHash && hash !== expectedHash) throw new Failure('HASH_MISMATCH', 'Resource bytes differ from the declared hash.');
      const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
      const parsed = readDocument(source, path.endsWith('.md') ? 'markdown' : 'json');
      if (!parsed.ok) throw Object.assign(new Failure('INVALID_DOCUMENT', 'Correct the referenced document.'), { diagnostics: parsed.diagnostics });
      const doc = parsed.value;
      if (expectedId && doc.id !== expectedId) throw new Failure('REFERENCE_MISMATCH', 'Resource ID does not match its document.');
      if (Object.hasOwn(bundle.documents, doc.id)) throw new Failure('DUPLICATE_DOCUMENT_ID', 'Each document ID must have one authoritative source.');
      bundle.documents[doc.id] = doc;
      bundle.sources[path] = source;
      paths.set(path, doc.id);
      realPaths.set(actual, path);
      bundle.artifacts.push({ documentId: doc.id, path, sha256: hash,
        ...(path.endsWith('.md') ? { compiledPath: `compiled/${bundle.artifacts.length}.json`, compiledSha256: sha256(canonicalJson(doc)) } : {}) });
      visiting.add(path);
      for (const [id, descriptor] of Object.entries(doc.resources ?? {})) await load(descriptor.path, id, descriptor.sha256);
      visiting.delete(path);
      return doc.id;
    }
    bundle.scenarioId = await load(scenarioPath);
    bundle.configId = await load(configPath);
    return { ok: true, value: bundle };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, diagnostics: 'diagnostics' in error ? error.diagnostics as import('../format/index.js').FormatDiagnostic[] : [diagnostic('referential', error.code, '', error.message)] };
    return { ok: false, diagnostics: [diagnostic('referential', 'RESOURCE_READ_FAILED', '', 'Supply readable local UTF-8 files within the bundle root.')] };
  }
}

/** Writes a new directory only. Never overwrites a parent run or previous export. */
export async function saveRun(directory: string, manifest: RunBundle, events: readonly RunEvent[], bundle: ResolvedBundle, checkpoints: readonly RunnerCheckpoint[] = []): Promise<void> {
  if (manifest.scenarioRef !== bundle.scenarioId || manifest.configRef !== bundle.configId) throw new Error('Run input references do not match the resolved bundle.');
  const eventIds = new Set<string>();
  for (const [index, event] of events.entries()) {
    if (validateRecord('RunEvent', event).length || validateTime(event.time, manifest.clocks).length
      || event.runId !== manifest.runId || event.sequence !== index || eventIds.has(event.id)) throw new Error('Invalid run event order, clock, or identity.');
    eventIds.add(event.id);
  }
  const stream = events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '');
  const copy = structuredClone(manifest);
  copy.eventStreams = [{ path: 'events.jsonl', sha256: sha256(stream), count: events.length }];
  if (manifest.checkpoints.length) throw new Error('Supply checkpoint values; descriptors are generated by saveRun.');
  const checkpointFiles = checkpoints.map((checkpoint, index) => {
    validateCheckpoint(checkpoint);
    if (checkpoint.launch.runId !== manifest.runId && (checkpoint.launch.runId !== manifest.parent?.runId || checkpoint.id !== manifest.parent.checkpointId)) throw new Error('Checkpoint does not belong to this run or its parent.');
    if (canonicalJson(checkpoint.host) !== canonicalJson(manifest.host)) throw new Error('Checkpoint host mismatch.');
    if (checkpoint.launch.runId === manifest.runId && canonicalJson(checkpoint.events) !== canonicalJson(events.slice(0, checkpoint.events.length))) throw new Error('Checkpoint history is not a run prefix.');
    const source = canonicalJson(checkpoint);
    if (Buffer.byteLength(source) > 1024 * 1024) throw new Error('Checkpoint exceeds the 1 MiB profile limit; save a playback-only run instead.');
    return { source, descriptor: { id: checkpoint.id, path: `checkpoints/${index}.json`, sha256: sha256(source), boundary: 'settled' as const } };
  });
  if (new Set(checkpoints.map(c => c.id)).size !== checkpoints.length) throw new Error('Duplicate checkpoint ID.');
  copy.checkpoints = checkpointFiles.map(file => file.descriptor);
  const resumable = checkpoints.some(c => c.launch.runId === manifest.runId);
  copy.capabilities = { ...copy.capabilities, restore: resumable, branch: resumable };
  copy.inputs = bundle.artifacts.map((artifact) => ({ ...artifact, path: `inputs/${artifact.path}` }));
  const valid = validateDocument(copy);
  if (!valid.ok) throw new Error(JSON.stringify(valid.diagnostics));
  const targets = new Set(['events.jsonl', 'run.json']);
  const reserve = (path: string) => {
    if (!isResourcePath(path) || targets.has(path)) throw new Error('Unsafe or conflicting output path.');
    targets.add(path);
  };
  for (const file of checkpointFiles) reserve(file.descriptor.path);
  for (const artifact of bundle.artifacts) {
    reserve(`inputs/${artifact.path}`);
    const source = bundle.sources[artifact.path];
    if (source === undefined || sha256(source) !== artifact.sha256) throw new Error('Source bytes do not match the recorded hash.');
    const parsed = readDocument(source, artifact.path.endsWith('.md') ? 'markdown' : 'json');
    if (!parsed.ok || canonicalJson(parsed.value) !== canonicalJson(bundle.documents[artifact.documentId])) throw new Error('Launched document differs from its frozen source.');
    if (artifact.compiledPath) {
      reserve(artifact.compiledPath);
      if (sha256(canonicalJson(bundle.documents[artifact.documentId])) !== artifact.compiledSha256) throw new Error('Compiled document differs from its recorded hash.');
    }
  }
  if (Object.keys(bundle.sources).length !== bundle.artifacts.length) throw new Error('Every source must have a recorded artifact.');
  await mkdir(directory); // EEXIST is intentional: finalized exports are immutable.
  for (const [path, source] of Object.entries(bundle.sources)) {
    if (!isResourcePath(path)) throw new Error('Unsafe source path.');
    const target = resolve(directory, 'inputs', path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source, { flag: 'wx' });
  }
  for (const artifact of bundle.artifacts) {
    if (artifact.compiledPath) {
      const target = resolve(directory, artifact.compiledPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, canonicalJson(bundle.documents[artifact.documentId]), { flag: 'wx' });
    }
  }
  for (const file of checkpointFiles) {
    const path = resolve(directory, file.descriptor.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.source, { flag: 'wx' });
  }
  await writeFile(resolve(directory, 'events.jsonl'), stream, { flag: 'wx' });
  const written = writeDocument(copy);
  if (!written.ok) throw new Error(JSON.stringify(written.diagnostics));
  await writeFile(resolve(directory, 'run.json'), written.value, { flag: 'wx' });
}

export { loadRun } from './recording.js';

/** Resolve an edited in-memory bundle using the same strict document boundary. */
export function resolveSources(sources: Readonly<Record<string, string>>, scenarioPath: string, configPath: string): FormatResult<ResolvedBundle> {
  const bundle: ResolvedBundle = { scenarioId: '', configId: '', documents: Object.create(null), sources: Object.create(null), artifacts: [] };
  const visited = new Map<string, string>();
  const visiting = new Set<string>();
  let bytes = 0;
  try {
    const visit = (path: string, expectedId?: string, expectedHash?: string): string => {
      if (!isResourcePath(path) || !Object.hasOwn(sources, path)) throw new Error('Resolve every resource to a supplied bundle-relative source.');
      if (visiting.has(path)) throw new Error('Cyclic resource dependency.');
      const source = sources[path];
      if (typeof source !== 'string') throw new Error('Sources must be UTF-8 strings.');
      const hash = sha256(source);
      if (expectedHash && expectedHash !== hash) throw new Error('Edited resource no longer matches its pinned hash. Update the authoring reference explicitly.');
      const known = visited.get(path);
      if (known) { if (expectedId && expectedId !== known) throw new Error('Resource ID mismatch.'); return known; }
      bytes += Buffer.byteLength(source);
      if (visited.size >= 128 || bytes > 16 * 1024 * 1024) throw new Error('Bundle exceeds authoring limits.');
      const parsed = readDocument(source, path.endsWith('.md') ? 'markdown' : 'json');
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
      const doc = parsed.value;
      if (expectedId && expectedId !== doc.id || Object.hasOwn(bundle.documents, doc.id)) throw new Error('Duplicate or mismatched document ID.');
      bundle.sources[path] = source; bundle.documents[doc.id] = doc; visited.set(path, doc.id);
      bundle.artifacts.push({ documentId: doc.id, path, sha256: hash, ...(path.endsWith('.md') ? { compiledPath: `compiled/${bundle.artifacts.length}.json`, compiledSha256: sha256(canonicalJson(doc)) } : {}) });
      visiting.add(path);
      for (const [id, resource] of Object.entries(doc.resources ?? {})) visit(resource.path, id, resource.sha256);
      visiting.delete(path); return doc.id;
    };
    bundle.scenarioId = visit(scenarioPath); bundle.configId = visit(configPath);
    return { ok: true, value: bundle };
  } catch (error) { return { ok: false, diagnostics: [diagnostic('referential', 'SOURCE_RESOLUTION_FAILED', '', (error as Error).message)] }; }
}

export { SqliteRunnerStorage } from './sqlite-storage.js';
export { saveArchivedRun, openArchivedRun, isArchivedRun, recoverArchivedCheckpoint } from './archived-run.js';
export * from './durable-session.js';
