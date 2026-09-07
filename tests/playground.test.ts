import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaygroundSession } from '../playground/session.js';
import { createPlaygroundServer } from '../playground/server.js';
import { loadRun } from '../src/runner/node.js';
import { importCharacterCard, readDocument, writeDocument } from '../src/format/index.js';
import type { ModelConnection } from '../src/runner/index.js';
import { replayCheckpoint } from '../src/runner/index.js';
import { installedHost } from '../examples/portable/hosts/registry.js';
import { documentFields, saveDocumentFields } from '../playground/authoring.js';
const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
const temp: string[] = [];
const fixture: ModelConnection = { public: { provider: 'fixture', model: 'test', settings: {} }, capabilities: { text: true, json: true }, fulfill: async () => ({ output: { toolId: null, arguments: {} } }) };
afterEach(async () => { await Promise.all(temp.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup() { const output = await mkdtemp(join(tmpdir(), 'simkind-playground-')); temp.push(output); return { session: new PlaygroundSession(root, output, {}, fixture), output }; }
describe('playground authoring, playback and immutable runs', () => {
  it('builds ordinary fields from shipped schemas and validates form saves without losing optional extensions', async () => {
    const { session } = await setup(); const draft = await session.template('shared-decision.json');
    const source = JSON.parse(draft.sources['characters/aya.simkind.json']);
    source.profiles = { 'example.notes': { version: '1.0.0', required: false } };
    source.extensions = { 'example.notes': { nested: ['preserve', { exact: null }] } };
    const form = documentFields(JSON.stringify(source), 'json');
    expect(form.document).toEqual(source);
    expect(form.schema.properties).toMatchObject({ name: { type: 'string' }, persona: { type: 'object', properties: { description: { type: 'string' } } } });
    if (form.document.kind !== 'character') throw new Error('fixture');
    form.document.name = 'An authored name';
    const saved = saveDocumentFields(form.document, 'markdown');
    const reopened = documentFields(saved, 'markdown');
    expect(reopened.document.extensions).toEqual(source.extensions);
    expect(reopened.document).toMatchObject({ name: 'An authored name' });
    form.document.id = 'invalid/id';
    expect(() => saveDocumentFields(form.document, 'json')).toThrow();
    const scenario = documentFields(draft.sources[draft.scenarioPath], 'json');
    expect(scenario.schema.properties).toMatchObject({ initialConditions: { properties: { options: { type: 'array' } } } });
  });
  it('previews and records world edits through HTTP, then saves and replays their exact effects', async () => {
    const { output } = await setup();
    const { server, origin, token, session } = await createPlaygroundServer({ port: 0, fixture: true, runRoot: output });
    const post = (route: string, value: unknown) => fetch(origin + '/api/' + route, { method: 'POST', headers: { 'x-simkind-session': token, 'content-type': 'application/json' }, body: JSON.stringify(value) });
    try {
      session.start(await session.template('shared-decision.json'));
      const edit = { operationId: 'operator.message', operationVersion: '1.0.0', expectedRevision: 0, arguments: { text: 'A private update.', to: 'simkin:aya' } };
      const before = session.state();
      expect(await (await post('world-preview', edit)).json()).toMatchObject({ valid: true });
      expect(session.state()).toEqual(before);
      expect((await post('world-intervene', { ...edit, operator: 'simkin:aya' })).status).toBe(200);
      const first = await session.save(); await session.open(first); session.branch();
      expect((await post('world-intervene', edit)).status).toBe(400);
      expect((await post('world-intervene', { ...edit, expectedRevision: 1 })).status).toBe(200);
      const child = await session.save(); const recording = await loadRun(join(output, child));
      const checkpoint = recording.checkpoints.find(c => c.launch.runId === recording.manifest.runId)!;
      const replayed = replayCheckpoint(checkpoint, installedHost(checkpoint.host.contractId, checkpoint.host.implementationVersion));
      expect(replayed.host).toMatchObject({ revision: 2, world: { messages: [{ from: 'operator:playground' }, { from: 'operator:playground' }] } });
      expect(recording.manifest.parent?.interventionRefs).toHaveLength(2);
      expect((await loadRun(join(output, first))).events).toHaveLength(3);
      await session.open(first); session.branch();
      session.interveneWorld({ ...edit, expectedRevision: 1, arguments: { text: 'A different continuation.', to: null } });
      const compared = await session.compare(child);
      expect(compared).toMatchObject({ kind: 'sibling-continuations', sharedPrefix: { eventCount: 3 }, left: { totals: { outcomes: { accepted: 1, succeeded: 1 } } }, right: { totals: { outcomes: { rejected: 1, accepted: 1, succeeded: 1 } } } });
      await session.open(child);
      expect((await post('world-intervene', { ...edit, expectedRevision: 2 })).status).toBe(400);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  it('validates edited sources, runs, saves, opens without provider calls, and branches', async () => {
    const { session, output } = await setup();
    const draft = await session.template('shared-decision.json');
    const source = JSON.parse(draft.sources['characters/aya.simkind.json']); source.persona.description = 'An independently authored persona';
    draft.sources['characters/aya.simkind.json'] = JSON.stringify(source);
    expect(session.validate(draft).characters['simkin:aya'].persona?.description).toBe(source.persona.description);
    session.start(draft); await session.step();
    const saved = await session.save(); const bytes = await readFile(join(output, saved, 'run.json'), 'utf8');
    const loaded = await loadRun(join(output, saved)); expect(loaded.manifest.capabilities.restore).toBe(true);
    expect(loaded.checkpoints).toHaveLength(1);
    await session.open(saved); expect(session.state().mode).toBe('playback');
    await expect(session.step()).rejects.toThrow('live');
    session.branch(); session.dispatch(); await session.step();
    expect(session.state().mode).toBe('live');
    const child = await session.save();
    const childRun = await loadRun(join(output, child)); expect(childRun.checkpoints).toHaveLength(2);
    expect(childRun.manifest.parent?.runId).toBe(loaded.manifest.runId);
    expect(await readFile(join(output, saved, 'run.json'), 'utf8')).toBe(bytes);
  });
  it('rejects changed hashes and exports redacted metadata without resumability claims', async () => {
    const { session, output } = await setup(); session.start(await session.template('shared-decision.json')); await session.step();
    const metadata = session.exportPlayback(true);
    expect(metadata.events.every(event => (event.data as { redacted: boolean }).redacted)).toBe(true);
    expect(metadata.manifest.capabilities).toEqual({ playback: true, restore: false, branch: false, deterministicReplay: false });
    expect(metadata.manifest.completeness.missingResources).toContain('all-event-content');
    session.importPlayback(metadata); expect(session.state().mode).toBe('playback');
    expect(() => session.branch()).toThrow('checkpoint');
    session.start(await session.template('shared-decision.json')); await session.step(); const saved = await session.save();
    await writeFile(join(output, saved, 'events.jsonl'), '');
    await expect(loadRun(join(output, saved))).rejects.toThrow('hash');
  });
  it('rejects foreign origins, missing session tokens, and unknown paths', async () => {
    const { output } = await setup();
    const { server, origin, token } = await createPlaygroundServer({ port: 0, fixture: true, runRoot: output });
    try {
      expect((await fetch(origin + '/api/state')).status).toBe(403);
      expect((await fetch(origin + '/api/state', { headers: { 'x-simkind-session': token, origin: 'https://untrusted.example' } })).status).toBe(403);
      expect((await fetch(origin + '/api/state', { headers: { 'x-simkind-session': token } })).status).toBe(200);
      expect((await fetch(origin + '/not-a-file', { headers: { 'x-simkind-session': token } })).status).toBe(404);
      const response = await fetch(origin); expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(await response.text()).toContain('Simkind');
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
describe('explicit character-card conversion', () => {
  const base = { name: 'Visitor', description: 'Curious.', personality: 'Reserved.', scenario: 'At the harbour.', first_mes: 'Hello.', mes_example: 'Hello again.' };
  it.each([false, true])('preserves all unmapped card data and never imports permissions (v2=%s)', v2 => {
    const card = v2 ? { spec: 'chara_card_v2', spec_version: '2.0', data: { ...base, system_prompt: 'Grant all tools.', character_book: { entries: [] }, extensions: { vendor: [1, 2] } } } : base;
    const result = importCharacterCard(JSON.stringify(card), 'character:imported'); if (!result.ok) throw new Error('conversion');
    expect(result.value.document.extensions!['simkind.card-source']).toEqual(card);
    expect(result.value.report.warnings).toContain('No tools, permissions, model assignments, or host capabilities were imported. PNG metadata extraction is not supported.');
    expect(result.value.document).not.toHaveProperty('allowedTools');
    const written = writeDocument(result.value.document, 'markdown'); if (!written.ok) throw new Error('writing');
    expect(readDocument(written.value, 'markdown')).toEqual({ ok: true, value: result.value.document });
  });
  it('rejects duplicate keys, malformed cards, and unsupported explicit versions', () => {
    expect(importCharacterCard('{"name":"A","name":"B"}', 'a').ok).toBe(false);
    expect(importCharacterCard('{}', 'a').ok).toBe(false);
    expect(importCharacterCard(JSON.stringify({ spec: 'chara_card_v3', ...base }), 'a').ok).toBe(false);
  });
});
