import { describe, expect, it, vi } from 'vitest';
import { ActionLedger, createCharacterRunner, prepareLaunch, overlayConfiguration, upgradeCharacter,
  type DecisionContext, type HostRegistration, type ModelConnection, type PreparedLaunch, type ResolvedBundle } from '../src/runner/index.js';
import { loadScenario } from '../src/runner/node.js';
import { canonicalJson, readCharacter, readDocument, readJson, validateDocument, validateRecord, validateTime, writeDocument,
  type ActionEvent, type ActionProposal, type JsonObject, type JsonValue, type RunConfig, type Scenario } from '../src/format/index.js';
import { conversationHost } from '../examples/portable/hosts/conversation.js';
import { settlementHost } from '../examples/portable/hosts/settlement.js';
import { ollamaConnection } from '../src/providers/index.js';

const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
async function bundle(path = 'shared-decision.json') {
  const result = await loadScenario(root, path, 'config.json');
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function config(data: ResolvedBundle) { return data.documents[data.configId] as RunConfig; }
function scenario(data: ResolvedBundle) { return data.documents[data.scenarioId] as Scenario; }
function connection(fulfill: ModelConnection['fulfill'] = async () => ({ output: { toolId: null, arguments: {} } })): ModelConnection {
  return { public: { provider: 'fixture', model: 'test-model-v1', settings: {} }, capabilities: { text: true, json: true }, fulfill };
}
function launch(data: ResolvedBundle, host = conversationHost, primary = connection()): PreparedLaunch {
  const result = prepareLaunch(data, host, { primary }, 'run:test');
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function runner(data: ResolvedBundle, host = conversationHost, primary = connection()) {
  const result = createCharacterRunner(data, host, { primary }, 'run:test');
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function proposal(id: string, actor: string, toolId: string, args: JsonObject = {}, revision = 0): ActionProposal {
  return { id, runId: 'run:test', actor, toolId, arguments: args, requestId: 'request:test', observedRevision: revision, toolVersion: '1.0.0' };
}
const clocks = [{ id: 'clock:simulation', kind: 'tick', unit: 'tick', origin: 'zero' }] as const;
function event(id: string, status: ActionEvent['status'], extra: Partial<ActionEvent> = {}): ActionEvent {
  return { id, runId: 'run:test', actionId: 'action:test', actor: 'simkin:aya', status, time: { clockId: 'clock:simulation', value: 0 }, revision: 0, effectRefs: [], ...extra };
}

 describe('portable contracts and launch gates', () => {
  it('reads and writes all six document kinds against the generated schema', async () => {
    const data = await bundle();
    const prepared = launch(data);
    const instance = runner(data);
    const docs = [...Object.values(data.documents), ...Object.values(prepared.states), instance.manifest()];
    expect(new Set(docs.map(doc => doc.kind)).size).toBe(6);
    for (const doc of docs) {
      const written = writeDocument(doc);
      expect(written.ok).toBe(true);
      if (written.ok) expect(readDocument(written.value)).toEqual({ ok: true, value: doc });
      expect(validateDocument({ ...doc, typo: true }).ok).toBe(false);
    }
    const character = prepared.characters['simkin:aya'];
    const markdown = writeDocument(character, 'markdown');
    if (!markdown.ok) throw new Error('Markdown failed');
    expect(readDocument(markdown.value, 'markdown')).toEqual({ ok: true, value: character });
    expect(writeDocument(prepared.config, 'markdown').ok).toBe(false);
    expect(readJson('{"x":1,"x":2}').ok).toBe(false);
  });

  it('F08 preserves explicitly unresolved imported historical context', async () => {
    const doc = launch(await bundle()).characters['simkin:aya'];
    doc.startingState!.memories![0].subjectRefs = [{ id: 'entity:old-friend', origin: 'world:previous', resolution: 'unresolved' }];
    doc.startingState!.memories![0].formedAt = { clockId: 'clock:previous-world', value: 100 };
    doc.startingState!.memories![0].source.origin = 'world:previous';
    expect(validateDocument(doc)).toEqual({ ok: true, value: doc });
  });

  it('F15 explicitly upgrades a draft.1 character without changing its content', () => {
    const old = readCharacter('{"specVersion":"0.2.0-draft.1","kind":"character","id":"character:aya","name":"Aya"}');
    if (!old.ok) throw new Error('fixture');
    const migrated = upgradeCharacter(old.value);
    expect(migrated).toMatchObject({ ok: true, value: { document: { specVersion: '0.2.0-draft.2', name: 'Aya' }, changes: [expect.any(String)] } });
    expect(old.value.specVersion).toBe('0.2.0-draft.1');
    expect(upgradeCharacter({ ...old.value, specVersion: '0.3.0' } as unknown as typeof old.value)).toMatchObject({ ok: false, diagnostics: [{ code: 'UNSUPPORTED_VERSION' }] });
  });

  it('F11 checks declared clocks, UTC formats, and safe integer ticks', () => {
    expect(validateTime({ clockId: 'clock:simulation', value: 1 }, clocks)).toEqual([]);
    for (const value of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1, '2026-09-07T00:00:00.000Z']) expect(validateTime({ clockId: 'clock:simulation', value }, clocks)).not.toEqual([]);
    expect(validateTime({ clockId: 'missing', value: 1 }, clocks)).not.toEqual([]);
    const utc = [{ id: 'wall', kind: 'utc', unit: 'iso8601', origin: 'UTC' }] as const;
    expect(validateTime({ clockId: 'wall', value: '2026-09-07T00:00:00.000Z' }, utc)).toEqual([]);
    expect(validateTime({ clockId: 'wall', value: '2026-02-30T00:00:00.000Z' }, utc)).not.toEqual([]);
  });

  it.each(['missing-character', 'missing-slot', 'unknown-instance', 'required-profile', 'enabled-feature', 'host-version', 'host-limit', 'tool-contract', 'permissions'])('blocks %s before creating the host or calling a provider', async (failure) => {
    const data = await bundle();
    const cfg = config(data);
    const scene = scenario(data);
    if (failure === 'missing-character') scene.cast[0].characterRef = 'missing';
    if (failure === 'missing-slot') cfg.modelAssignments['simkin:aya'] = 'missing';
    if (failure === 'unknown-instance') cfg.modelAssignments.ghost = 'primary';
    if (failure === 'required-profile') cfg.profiles!['unknown.profile'] = { version: '1', required: true };
    if (failure === 'enabled-feature') { cfg.profiles!['unknown.profile'] = { version: '1', required: false }; cfg.features!['unknown.profile'] = { enabled: true }; }
    if (failure === 'host-version') scene.host.version = '2.0.0';
    if (failure === 'host-limit') cfg.limits.maxRequests = conversationHost.descriptor.limits.maxRequests + 1;
    if (failure === 'tool-contract') { const catalog = data.documents[scene.toolCatalogRef]; if (catalog.kind === 'tool-catalog') catalog.tools[0].description = 'different semantics'; }
    if (failure === 'permissions') { scene.cast[0].allowedTools = ['say']; cfg.perInstance = { 'simkin:aya': { allowedTools: ['vote'] } }; }
    const create = vi.fn(conversationHost.create);
    const fulfill = vi.fn(connection().fulfill);
    expect(createCharacterRunner(data, { ...conversationHost, create }, { primary: connection(fulfill) }, 'run:test').ok).toBe(false);
    expect(create).not.toHaveBeenCalled(); expect(fulfill).not.toHaveBeenCalled();
  });

  it('F12 resolves defaults, scenario, run, and per-instance overlays with inspectable models', async () => {
    const data = await bundle();
    config(data).perInstance = { 'simkin:aya': { modelSlot: 'secondary', features: { 'simkind.memory-retrieval': { config: { maxItems: 1 } } }, allowedTools: ['say'] } };
    const primary = connection();
    const secondary = connection(); secondary.public.model = 'other-explicit-model';
    const prepared = prepareLaunch(data, conversationHost, { primary, secondary }, 'run:test');
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.diagnostics));
    expect(prepared.value.effectiveConfig['simkin:aya']).toMatchObject({ modelSlot: 'secondary', model: { model: 'other-explicit-model' }, allowedTools: ['say'], features: { 'simkind.memory-retrieval': { enabled: true, config: { maxItems: 1 } } } });
    expect(prepared.value.effectiveConfig['simkin:mira'].features['simkind.memory-retrieval'].config?.maxItems).toBe(8);
    expect(prepared.value.configurationSources['simkin:aya']).toMatchObject({ featureLayers: [expect.any(Object), expect.any(Object), expect.any(Object), expect.any(Object)] });
    expect(overlayConfiguration({ list: [1, 2], nested: { first: 1 } }, { list: [3], nested: { second: 2 } })).toEqual({ list: [3], nested: { first: 1, second: 2 } });
    expect(() => overlayConfiguration({ count: 1 }, { count: '1' })).toThrow();
  });

  it('F13 disables supplied memories without deleting stored experiences', async () => {
    const data = await bundle();
    config(data).features!['simkind.memory-retrieval'].enabled = false;
    const contexts: DecisionContext[] = [];
    const instance = runner(data, conversationHost, connection(async context => { contexts.push(context); return { output: { toolId: null, arguments: {} } }; }));
    instance.step(); await instance.settleDecisions();
    expect(contexts.every(context => context.memories.length === 0)).toBe(true);
    expect(instance.inspect().launch.states['simkin:aya'].context.memories).toHaveLength(1);
  });

  it('instantiates one definition twice without shared mutable context or template edits', async () => {
    const data = await bundle();
    scenario(data).cast[1].characterRef = 'character:aya';
    const instance = runner(data);
    const original = data.documents['character:aya']; if (original.kind === 'character') original.name = 'Changed later';
    const inspection = instance.inspect();
    inspection.launch.states['simkin:aya'].context.memories![0].text = 'mutated inspection';
    expect(instance.inspect().launch.states['simkin:mira'].context.memories![0].text).not.toBe('mutated inspection');
    expect(instance.inspect().launch.characters['simkin:aya'].name).toBe('Aya');
    expect(instance.inspect().launch.states['simkin:aya'].id).not.toBe(instance.inspect().launch.states['simkin:mira'].id);
  });
});

describe('host authority and asynchronous actions', () => {
  it('H01 isolates character memories and private speech from other perspectives', async () => {
    const data = await bundle();
    const contexts: DecisionContext[] = [];
    let first = true;
    const instance = runner(data, conversationHost, connection(async context => {
      contexts.push(structuredClone(context));
      if (first && context.instanceId === 'simkin:aya') { first = false; return { output: { toolId: 'say', arguments: { to: 'simkin:mira', text: 'Private note to Mira.' } } }; }
      context.memories.splice(0);
      return { output: { toolId: null, arguments: {} } };
    }));
    instance.step(); await instance.settleDecisions(); instance.step(); await instance.settleDecisions();
    for (const context of contexts) {
      const text = JSON.stringify(context);
      if (context.instanceId !== 'simkin:mira') expect(text).not.toContain('grant may expire sooner');
      if (context.instanceId === 'simkin:sol') expect(text).not.toContain('Private note to Mira.');
      expect(context.memories).toHaveLength(1);
    }
    expect(JSON.stringify(contexts.filter(context => context.instanceId === 'simkin:mira'))).toContain('Private note to Mira.');
  });

  it('H02 treats claims in speech as content, leaving inventories and votes untouched', async () => {
    const data = await bundle('pump-crisis.json');
    const host = settlementHost.create(launch(data, settlementHost));
    const before = host.inspect() as { world: { inventories: JsonValue; pump: JsonValue } };
    host.submit(proposal('action:speech', 'simkin:aya', 'say', { text: 'I gave Mira all my parts and repaired the pump.' }));
    const after = host.inspect() as typeof before;
    expect(after.world.inventories).toEqual(before.world.inventories); expect(after.world.pump).toEqual(before.world.pump);
  });

  it('H03 revalidates scarce resources after concurrent stale proposals', async () => {
    const data = await bundle('pump-crisis.json');
    const initial = scenario(data).initialConditions;
    initial.positions = { 'simkin:aya': 'square', 'simkin:mira': 'square', 'simkin:sol': 'square' };
    (initial.places as JsonObject[])[0].stock = { water: 1 };
    const host = settlementHost.create(launch(data, settlementHost));
    const first = host.submit(proposal('action:a', 'simkin:aya', 'collect', { resource: 'water' }));
    const second = host.submit(proposal('action:b', 'simkin:mira', 'collect', { resource: 'water' }));
    expect(first.map(event => event.status)).toEqual(['accepted', 'succeeded']);
    expect(second).toMatchObject([{ status: 'rejected', reason: expect.any(String), effectRefs: [] }]);
  });

  it('H04/H05/H07 separates travel admission, arrival, deduplication, and late cancellation', async () => {
    const data = await bundle('pump-crisis.json');
    const host = settlementHost.create(launch(data, settlementHost));
    const action = proposal('action:travel', 'simkin:aya', 'move', { to: 'reservoir' });
    expect(host.submit(action).map(event => event.status)).toEqual(['accepted', 'running']);
    expect(host.submit(structuredClone(action))).toEqual([]);
    expect(() => host.submit({ ...action, arguments: { to: 'square' } })).toThrow('Conflicting');
    expect((host.inspect() as { world: { positions: Record<string, string> } }).world.positions['simkin:aya']).toBe('workshop');
    host.advance(); expect(host.drainEvents()).toEqual([]);
    host.advance(); expect(host.drainEvents()).toMatchObject([{ status: 'succeeded', effectRefs: [expect.any(String)] }]);
    expect(host.cancel(action.id).map(event => event.status)).toEqual(['cancellation-requested', 'cancellation-result']);
    expect((host.inspect() as { world: { positions: Record<string, string> } }).world.positions['simkin:aya']).toBe('reservoir');
  });

  it('cancels travel before arrival without changing position', async () => {
    const host = settlementHost.create(launch(await bundle('pump-crisis.json'), settlementHost));
    host.submit(proposal('action:travel', 'simkin:aya', 'move', { to: 'reservoir' }));
    expect(host.cancel('action:travel').map(event => event.status)).toEqual(['cancellation-requested', 'cancelled', 'cancellation-result']);
    host.advance(); host.advance(); expect(host.drainEvents()).toEqual([]);
    expect((host.inspect() as { world: { positions: Record<string, string> } }).world.positions['simkin:aya']).toBe('workshop');
  });

  it('H06/H08 preserves uncertainty, partial effects, and terminal outcomes atomically', () => {
    const ledger = new ActionLedger('run:test', clocks);
    ledger.propose(proposal('action:test', 'simkin:aya', 'move', { to: 'reservoir' }));
    ledger.receive([event('a', 'accepted'), event('b', 'unknown', { reason: 'Remote result has not arrived.' })]);
    expect(ledger.unresolved()).toHaveLength(1);
    const partial = event('c', 'failed', { reason: 'Stopped halfway.', effectRefs: ['effect:partial'], result: { distance: 2 } });
    expect(() => ledger.receive([partial, event('d', 'succeeded')])).toThrow();
    expect(ledger.get('action:test')?.status).toBe('unknown');
    ledger.receive([partial]);
    expect(ledger.unresolved()).toEqual([]); expect(ledger.eventsFor('simkin:aya').at(-1)).toEqual(partial);
    expect(ledger.receive([structuredClone(partial)])).toEqual([]);
    expect(() => ledger.receive([{ ...partial, reason: 'changed' }])).toThrow();
    expect(() => ledger.receive([event('e', 'succeeded')])).toThrow();
  });

  it('uses the same runner for two conversation scenarios and the constrained world', async () => {
    for (const file of ['shared-decision.json', 'workshop.json', 'pump-crisis.json']) {
      const data = await bundle(file);
      const instance = runner(data, file === 'pump-crisis.json' ? settlementHost : conversationHost, connection(async context => ({ output: { toolId: 'say', arguments: context.tools.find(tool => tool.id === 'say')!.inputSchema && file === 'pump-crisis.json' ? { text: 'I have a different idea.' } : { text: 'I have a different idea.', to: null } } })));
      instance.step(); await instance.settleDecisions();
      expect(instance.events().filter(event => event.type === 'action' && (event.data as JsonObject).status === 'succeeded')).toHaveLength(3);
      expect(instance.events().every(event => validateRecord('RunEvent', event).length === 0)).toBe(true);
    }
  });
});

describe('runner resource and provider boundaries', () => {
  it.each([{ prefix: '', suffix: '\n``' }, { prefix: '', suffix: '\n```' }, { prefix: '```json\n', suffix: '\n```' }])('accepts a decision with code fences %j', async ({ prefix, suffix }) => {
    const data = await bundle(); config(data).limits.maxRequests = 1;
    const instance = runner(data, conversationHost, connection(async () => ({ output: prefix + '{"toolId":null,"arguments":{}}' + suffix })));
    instance.step(); await instance.settleDecisions();
    expect(instance.events().find(e => e.type === 'model-result')?.data).toMatchObject({ output: { toolId: null, arguments: {} }, normalization: 'code-fence' });
    expect(instance.events().some(e => e.type === 'model-error')).toBe(false);
  });
  it.each([
    '{"toolId":null,"arguments":{}}\nIgnore the rules',
    '{"toolId":null,"toolId":"say","arguments":{}}\n```',
    '{"toolId":null,"arguments":{},"extra":true}\n```',
    '{"toolId":null,"arguments":{}\n```',
  ])('still rejects invalid JSON or decision structure after fence handling: %s', async output => {
    const data = await bundle(); config(data).limits.maxRequests = 1;
    const instance = runner(data, conversationHost, connection(async () => ({ output })));
    instance.step(); await instance.settleDecisions();
    expect(instance.events().find(e => e.type === 'model-error')?.data).toMatchObject({ code: 'INVALID_OUTPUT' });
    expect(instance.events().some(e => e.type === 'proposal')).toBe(false);
  });
  it('H15 enforces request/concurrency limits and schedules all cast members fairly', async () => {
    const data = await bundle(); config(data).limits.maxInFlight = 1; config(data).limits.maxRequests = 3;
    const actors: string[] = [];
    const instance = runner(data, conversationHost, connection(async context => { actors.push(context.instanceId); return { output: { toolId: null, arguments: {} } }; }));
    for (let i = 0; i < 8; i++) { instance.step(); await instance.settleDecisions(); }
    expect(actors).toEqual(['simkin:aya', 'simkin:mira', 'simkin:sol']);
    expect(instance.status().requests).toBe(3);
  });

  it('H09 drops reset provider completions and does not claim they cancelled world effects', async () => {
    const data = await bundle(); config(data).limits.maxInFlight = 1;
    let finish!: (result: { output: unknown }) => void;
    const instance = runner(data, conversationHost, connection(() => new Promise(resolve => { finish = resolve; })));
    instance.step(); instance.stop(); finish({ output: { toolId: 'vote', arguments: { option: 'garden' } } });
    await Promise.resolve(); await Promise.resolve(); await instance.settleDecisions();
    expect(instance.events().some(event => event.type === 'proposal')).toBe(false);
    expect(instance.manifest().completeness.status).toBe('truncated');
  });

  it('expires requests without reusing concurrency held by an abort-ignoring provider', async () => {
    const data = await bundle(); config(data).limits.maxInFlight = 1; config(data).limits.requestTimeoutMs = 5;
    let finish!: (result: { output: unknown }) => void;
    let signal!: AbortSignal;
    const fulfill = vi.fn((_context: DecisionContext, abort: AbortSignal) => { signal = abort; return new Promise<{ output: unknown }>(resolve => { finish = resolve; }); });
    const instance = runner(data, conversationHost, connection(fulfill));
    instance.step(); await instance.settleDecisions(); instance.step();
    expect(signal.aborted).toBe(true); expect(fulfill).toHaveBeenCalledTimes(1);
    expect(instance.status()).toMatchObject({ pendingRequests: 0, activeProviders: 1 });
    finish({ output: { toolId: 'vote', arguments: { option: 'garden' } } });
    await Promise.resolve(); await Promise.resolve(); await instance.settleDecisions();
    expect(instance.events().some(event => event.type === 'proposal')).toBe(false);
  });

  it('retains timely results even when the caller polls after the deadline', async () => {
    const data = await bundle(); config(data).limits.maxInFlight = 1; config(data).limits.requestTimeoutMs = 10;
    const instance = runner(data, conversationHost, connection(async () => ({ output: { toolId: 'vote', arguments: { option: 'garden' } } })));
    instance.step(); await new Promise(resolve => setTimeout(resolve, 15)); await instance.settleDecisions();
    expect(instance.events().some(event => event.type === 'proposal')).toBe(true);
    expect(instance.events().some(event => event.type === 'model-timeout')).toBe(false);
  });

  it.each([undefined, { toolId: 'vote', arguments: {} }, { toolId: 'forged', arguments: {} }, { toolId: null, arguments: {}, extra: true }, '{"toolId":null,"toolId":"vote","arguments":{}}'])('contains malformed or illegal model output %j', async output => {
    const data = await bundle(); config(data).limits.maxRequests = 1;
    const instance = runner(data, conversationHost, connection(async () => ({ output })));
    instance.step(); await instance.settleDecisions();
    expect(instance.events().some(event => event.type === 'model-error' || event.type === 'action' && (event.data as JsonObject).status === 'rejected')).toBe(true);
    expect(instance.events().some(event => event.type === 'action' && (event.data as JsonObject).status === 'succeeded')).toBe(false);
  });

  it('redacts provider exceptions and preserves optional metadata without exposing it to characters', async () => {
    const data = await bundle(); config(data).limits.maxRequests = 1;
    const character = data.documents['character:aya'];
    character.profiles = { 'example.opaque': { version: '1', required: false } };
    character.extensions = { 'example.opaque': { arbitrary: 'operator-only extension' } };
    const contexts: DecisionContext[] = [];
    const primary = connection(async context => { contexts.push(context); throw new Error('credential-not-for-recording'); });
    const instance = runner(data, conversationHost, primary);
    instance.step(); await instance.settleDecisions();
    expect(JSON.stringify(instance.events())).not.toContain('credential-not-for-recording');
    expect(JSON.stringify(contexts)).not.toContain('operator-only extension');
    expect(instance.inspect().launch.characters['simkin:aya'].extensions).toEqual(character.extensions);
  });

  it('records transport failure evidence without executing an action or leaking provider text', async () => {
    const data = await bundle(); config(data).limits.maxRequests = 1;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'length', message: { content: null, reasoning: 'private-provider-text' } }],
      usage: { completion_tokens: 512, completion_tokens_details: { reasoning_tokens: 512 }, cost: 0.001 },
    }))));
    try {
      const instance = runner(data, conversationHost, ollamaConnection('explicit'));
      instance.step(); await instance.settleDecisions();
      expect(instance.events().find(e => e.type === 'model-error')?.data).toMatchObject({
        code: 'PROVIDER_ERROR', diagnostic: { reason: 'OUTPUT_LIMIT', outputTokens: 512, reasoningTokens: 512, cost: 0.001 },
        usage: { outputTokens: 512, cost: 0.001 },
      });
      expect(instance.events().some(e => e.type === 'proposal')).toBe(false);
      expect(JSON.stringify(instance.events())).not.toContain('private-provider-text');
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects a host observation addressed to another character', async () => {
    const data = await bundle();
    const host: HostRegistration = { ...conversationHost, create: launch => {
      const instance = conversationHost.create(launch);
      instance.observe = () => [{ id: 'obs', runId: launch.runId, recipient: 'somebody-else', source: 'host', capturedAt: { clockId: 'clock:simulation', value: 0 }, deliveredAt: { clockId: 'clock:simulation', value: 0 }, revision: 0, content: [] }];
      return instance;
    } };
    expect(() => runner(data, host).step()).toThrow('observation');
  });

  it('pauses dispatch without inventing a resumable checkpoint', async () => {
    const instance = runner(await bundle()); instance.pauseDispatch(); instance.step();
    expect(instance.status().requests).toBe(0);
    expect(instance.manifest().capabilities).toEqual({ playback: true, deterministicReplay: false, restore: false, branch: false });
    instance.pauseDispatch(false); instance.step(); await instance.settleDecisions();
    expect(instance.status().requests).toBe(3);
  });

  it('canonical deduplication treats key order as nonsemantic', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

describe('unresolved work and dispatch controls', () => {
  it('H06 keeps an uncertain action unresolved, receives observations, and never blindly resubmits it', async () => {
    const data = await bundle('pump-crisis.json'); config(data).limits.maxInFlight = 1;
    const actors: string[] = [];
    const host: HostRegistration = { ...settlementHost, create: launch => {
      const instance = settlementHost.create(launch);
      instance.submit = action => [
        { id: 'remote:accepted', runId: launch.runId, actionId: action.id, actor: action.actor, status: 'accepted', time: instance.time(), revision: instance.revision(), effectRefs: [] },
        { id: 'remote:unknown', runId: launch.runId, actionId: action.id, actor: action.actor, status: 'unknown', time: instance.time(), revision: instance.revision(), effectRefs: [], reason: 'Remote acknowledgement was lost.' },
      ];
      return instance;
    } };
    const instance = runner(data, host, connection(async context => {
      actors.push(context.instanceId);
      return { output: context.instanceId === 'simkin:aya' ? { toolId: 'move', arguments: { to: 'reservoir' } } : { toolId: null, arguments: {} } };
    }));
    for (let i = 0; i < 4; i++) { instance.step(); await instance.settleDecisions(); }
    expect(actors.filter(actor => actor === 'simkin:aya')).toHaveLength(1);
    expect(instance.status().unresolvedActions).toBe(1);
    expect(instance.events().filter(event => event.type === 'observation' && (event.data as JsonObject).recipient === 'simkin:aya')).toHaveLength(4);
    expect(instance.manifest().completeness.status).toBe('truncated');
  });

  it('pauseDispatch still lets the host finish travel and records arrival', async () => {
    const data = await bundle('pump-crisis.json'); config(data).limits.maxRequests = 1;
    const instance = runner(data, settlementHost, connection(async () => ({ output: { toolId: 'move', arguments: { to: 'reservoir' } } })));
    instance.step(); await instance.settleDecisions(); instance.pauseDispatch(); instance.step(); instance.step();
    expect(instance.status()).toMatchObject({ requests: 1, unresolvedActions: 0 });
    expect(instance.events().some(event => event.type === 'action' && (event.data as JsonObject).status === 'succeeded')).toBe(true);
  });

  it('stop wakes a caller waiting on a provider that ignores abort', async () => {
    const data = await bundle(); config(data).limits.maxInFlight = 1;
    let finish!: (value: { output: unknown }) => void;
    const instance = runner(data, conversationHost, connection(() => new Promise(resolve => { finish = resolve; })));
    instance.step(); const settled = instance.settleDecisions(); instance.stop(); await settled;
    expect(instance.status().stopped).toBe(true);
    finish({ output: { toolId: null, arguments: {} } });
  });
});
