import { mkdirSync } from 'node:fs';
import { observerEvent } from './evidence.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CharacterRunner, createCharacterRunner, prepareLaunch, compareRuns, compareBranches, type HostIntervention, type ModelConnection, type ResolvedBundle, type RunnerCheckpoint, type StateEdit, CharacterMemory, contextProfile, type ContextSettings } from 'simkind/runner';
import { loadScenario, resolveSources, saveRun, loadRun, SqliteRunnerStorage, saveArchivedRun, openArchivedRun, isArchivedRun } from 'simkind/node';
import { validateDocument, validateRecord, validateTime, type RunEvent, type RunBundle } from 'simkind/format';
import { openRouterConnection, ollamaConnection, chatCompletionsConnection } from 'simkind/providers';
import { installedHost } from '../examples/portable/hosts/registry.js';
import { shopReport, recordedShopReports } from '../examples/fabrication/report.js';
import { economyReport, recordedEconomyReports } from '../examples/economy/report.js';

export interface Slot { structuredOutputs?: boolean; provider: 'openrouter' | 'ollama' | 'compatible'; model: string; apiKeyEnv?: string; endpoint?: string; settings?: ModelConnection['public']['settings'] }
export interface Draft { scenarioPath: string; configPath: string; sources: Record<string, string>; slots: Record<string, Slot> }
const templates = ['shared-decision.json', 'workshop.json', 'pump-crisis.json', 'orbital-greenhouse.json', 'small-economy.json', 'fabrication-shop.json'];
export class PlaygroundSession {
  private runner?: CharacterRunner;
  private storage?: SqliteRunnerStorage;
  private archived?: Awaited<ReturnType<typeof openArchivedRun>>;
  private bundle?: ResolvedBundle;
  private connections: Record<string, ModelConnection> = {};
  private parent?: RunnerCheckpoint;
  private playback?: Awaited<ReturnType<typeof loadRun>>;
  private branchComparison?: ReturnType<typeof compareRuns>;
  private automatic = false;
  private busy = false;
  private failure?: string;
  private savedRecording?: string;
  private savedAtStep = -1;
  private saving = false;
  private saveNote?: string;
  constructor(private readonly scenarioRoot: string, private readonly runRoot: string, private readonly env: Record<string, string | undefined>, private readonly fixtureConnection?: ModelConnection) {}
  async catalog() {
    await mkdir(this.runRoot, { recursive: true });
    return { templates, recordings: (await readdir(this.runRoot, { withFileTypes: true })).filter(e => e.isDirectory() && /^recording-[a-f0-9-]+$/.test(e.name)).map(e => e.name),
      connection: { openrouterKey: !!this.env.OPENROUTER_API_KEY, model: this.env.OPENROUTER_MODEL ?? '' } };
  }
  async template(name: string): Promise<Draft> {
    if (!templates.includes(name)) throw new Error('Choose an installed scenario.');
    const configPath = name === 'fabrication-shop.json' ? 'config-fabrication.json' : name === 'small-economy.json' ? 'config-economy-memory.json' : 'config-continuity.json';
    const loaded = await loadScenario(this.scenarioRoot, name, configPath);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    return { sources: loaded.value.sources, scenarioPath: name, configPath,
      slots: { primary: { provider: 'openrouter', model: this.env.OPENROUTER_MODEL ?? '', structuredOutputs: this.env.SIMKIND_STRUCTURED_OUTPUTS === '1', apiKeyEnv: 'OPENROUTER_API_KEY' } } };
  }
  private prepare(draft: Draft) {
    const loaded = resolveSources(draft.sources, draft.scenarioPath, draft.configPath);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    const scene = loaded.value.documents[loaded.value.scenarioId];
    if (scene.kind !== 'scenario') throw new Error('Choose a scenario document.');
    const host = installedHost(scene.host.contractId);
    const connections: Record<string, ModelConnection> = Object.create(null);
    for (const [slot, config] of Object.entries(draft.slots)) {
      if (this.fixtureConnection) { const fixture = this.fixtureConnection; connections[slot] = { ...fixture, fulfill: (context, signal) => context.purpose === 'consolidation' ? Promise.resolve({ output: { toolId: 'simkind.compact', arguments: { summary: 'Deterministic fixture; original experiences remain searchable.', episodes: [] } } }) : fixture.fulfill(context, signal) }; continue; }
      const key = this.env[config.apiKeyEnv ?? 'OPENROUTER_API_KEY'] ?? '';
      if (config.provider === 'openrouter') connections[slot] = openRouterConnection(key, config.model, config.settings, { structuredOutputs: config.structuredOutputs });
      else if (config.provider === 'ollama') connections[slot] = ollamaConnection(config.model, config.endpoint || undefined, config.settings);
      else if (config.provider === 'compatible') {
        if (!config.endpoint) throw new Error('Supply the compatible chat-completions endpoint.');
        connections[slot] = chatCompletionsConnection({ provider: 'compatible', model: config.model, endpoint: config.endpoint, apiKey: key, settings: config.settings, structuredOutputs: config.structuredOutputs });
      } else throw new Error('Unknown provider.');
    }
    const runId = `run:${randomUUID()}`;
    const prepared = prepareLaunch(loaded.value, host, connections, runId);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.diagnostics));
    return { bundle: loaded.value, host, connections, runId, launch: prepared.value };
  }
  validate(draft: Draft) { return this.prepare(draft).launch; }
  start(draft: Draft) {
    if (this.busy || this.saving) throw new Error('Wait for the current boundary or save.');
    const prepared = this.prepare(draft);
    const enabled = Object.values(prepared.launch.effectiveConfig).some(config => config.features[contextProfile.id]?.enabled);
    let storage: SqliteRunnerStorage | undefined;
    if (enabled) { mkdirSync(join(this.runRoot, '.active'), { recursive: true, mode: 0o700 }); storage = new SqliteRunnerStorage(join(this.runRoot, '.active', `${randomUUID()}.sqlite`)); }
    const result = createCharacterRunner(prepared.bundle, prepared.host, prepared.connections, prepared.runId, { storage, recordTimings: !this.fixtureConnection });
    if (!result.ok) { storage?.close(); throw new Error(JSON.stringify(result.diagnostics)); }
    this.runner?.stop(); this.storage?.close(); this.archived?.close(); this.archived = undefined; this.storage = storage; this.automatic = false; this.failure = undefined;
    this.runner = result.value; this.bundle = prepared.bundle; this.connections = prepared.connections;
    this.parent = undefined; this.playback = undefined; this.branchComparison = undefined;
    this.savedRecording = undefined; this.saveNote = undefined; this.savedAtStep = -1;
  }
  state(cursor?: { runId: string; after: number; summary?: boolean }) {
    const runId = this.archived?.manifest.runId ?? this.playback?.manifest.runId ?? this.runner?.manifest().runId;
    const eventsOffset = cursor && cursor.runId === runId && Number.isSafeInteger(cursor.after) && cursor.after >= 0 ? cursor.after : 0;
    if (this.archived) {
      const events = this.archived.events(eventsOffset, 256);
      const last = this.archived.events(Math.max(0, this.archived.eventCount - 128), 128);
      return { mode: 'playback', memoryEnabled: true, manifest: this.archived.manifest, events: cursor?.summary ? events.map(observerEvent) : events, eventsOffset, economy: recordedEconomyReports(last).at(-1), shop: recordedShopReports(last).at(-1),
        launch: this.archived.launch, checkpoints: this.archived.checkpoint ? [{ id: this.archived.checkpoint.id, runId }] : [], busy: false };
    }
    if (this.playback) return { mode: 'playback', manifest: this.playback.manifest, events: this.playback.events.slice(eventsOffset), eventsOffset, economy: recordedEconomyReports(this.playback.events).at(-1), shop: recordedShopReports(this.playback.events).at(-1), checkpoints: this.playback.checkpoints.map(c => ({ id: c.id, runId: c.launch.runId })), busy: false };
    if (!this.runner) return { mode: 'authoring', busy: this.busy };
    const inspection = this.runner.inspect(); const status = inspection.status;
    return { mode: 'live', ...inspection, manifest: this.runner.manifest(), events: this.runner.events(eventsOffset, this.storage ? 256 : undefined).map(event => cursor?.summary && this.storage ? observerEvent(event) : event), eventsOffset, memoryEnabled: !!this.storage, interventions: this.runner.hostInterventions(), automatic: this.automatic, busy: this.busy || this.saving,
      ...(this.runner.manifest().host.contractId === 'example.fabrication' ? { shop: shopReport(inspection.host) } : {}),
      ...(this.runner.manifest().host.contractId === 'example.economy' ? { economy: economyReport(inspection.host) } : {}), savedRecording: this.savedRecording, saveNote: this.saveNote,
      canCheckpoint: !this.busy && !status.stopped && !status.pendingRequests && !status.activeProviders && !status.unresolvedActions,
      ...(this.failure ? { failure: this.failure } : {}), ...(this.branchComparison ? { comparison: this.branchComparison } : {}) };
  }
  private active() { if (!this.runner || this.playback || this.archived) throw new Error('Start or resume a live run.'); return this.runner; }
  async step() {
    if (this.busy || this.saving) throw new Error('A boundary or save is already in progress.');
    const runner = this.active(); this.busy = true;
    try { runner.step(); await runner.settleDecisions(); }
    catch { runner.stop(); this.automatic = false; this.failure = 'Execution failed. Inspect and save the incomplete evidence.'; }
    finally { this.busy = false; }
    if (this.storage && !runner.status().stopped && !runner.status().activeProviders && !runner.status().unresolvedActions && !runner.status().pendingRequests) runner.checkpoint();
    if (runner === this.runner && !runner.status().stopped && runner.status().steps >= runner.inspect().launch.config.limits.maxSteps && this.savedAtStep !== runner.status().steps) {
      try { await this.save(); } catch { this.failure = 'Run reached its limit but automatic saving failed. Use Save to retry.'; }
    }
  }
  run() {
    const runner = this.active(); if (this.automatic) return;
    if (this.busy || this.saving || runner.status().stopped) throw new Error('Wait for the boundary or start a new run.');
    runner.pauseDispatch(false); this.automatic = true;
    const loop = async () => {
      while (this.automatic && !runner.status().stopped && runner.status().steps < runner.inspect().launch.config.limits.maxSteps) {
        await this.step(); await new Promise(resolve => setTimeout(resolve, 30));
      }
      this.automatic = false;
    };
    void loop().catch(() => { this.automatic = false; this.failure = 'Run loop failed.'; });
  }
  pause() { this.automatic = false; this.active().pauseDispatch(true); }
  stop() { this.automatic = false; this.runner?.stop(); }
  dispose() { this.stop(); this.archived?.close(); this.storage?.close(); this.archived = undefined; this.storage = undefined; }
  dispatch() { this.active().pauseDispatch(false); }
  intervene(actor: string, edit: StateEdit) { if (this.busy) throw new Error('Wait for the settled boundary.'); this.active().intervene(actor, edit, 'operator:playground'); }
  private worldEdit(edit: Omit<HostIntervention, 'operator'>): HostIntervention {
    if (this.busy || this.saving || this.automatic) throw new Error('Pause and wait for the settled boundary.');
    return { ...edit, operator: 'operator:playground' };
  }
  previewWorld(edit: Omit<HostIntervention, 'operator'>) { return this.active().previewHostIntervention(this.worldEdit(edit)); }
  interveneWorld(edit: Omit<HostIntervention, 'operator'>) { this.active().interveneHost(this.worldEdit(edit)); }
  async save() {
    if (this.busy || this.saving) throw new Error('Pause and wait for the current boundary or save.');
    const runner = this.active(); const checkpoints: RunnerCheckpoint[] = [];
    if (this.storage) {
      const name = `recording-${randomUUID()}`; this.saving = true;
      try { await mkdir(this.runRoot, { recursive: true }); const saved = await saveArchivedRun(join(this.runRoot, name), runner, this.bundle!, this.storage); this.saveNote = saved.resumable ? undefined : 'Evidence and playback saved. Provider cleanup or unresolved work prevents resuming this boundary.'; this.savedRecording = name; this.savedAtStep = runner.status().steps; } finally { this.saving = false; }
      return name;
    }
    if (this.parent && Buffer.byteLength(JSON.stringify(this.parent)) <= 1024 * 1024) checkpoints.push(this.parent);
    const status = runner.status();
    this.saveNote = undefined;
    if (!status.stopped && !status.activeProviders && !status.unresolvedActions && !status.pendingRequests) {
      const checkpoint = runner.checkpoint(`checkpoint:${randomUUID()}`);
      if (Buffer.byteLength(JSON.stringify(checkpoint)) <= 1024 * 1024) checkpoints.push(checkpoint);
      else this.saveNote = 'Full playback saved; checkpoint exceeds 1 MiB, so this boundary cannot resume. Earlier small checkpoints can still branch.';
    }
    const name = `recording-${randomUUID()}`;
    const manifest = runner.manifest(), events = runner.events(), bundle = this.bundle!;
    this.saving = true;
    try {
      await mkdir(this.runRoot, { recursive: true });
      await saveRun(join(this.runRoot, name), manifest, events, bundle, checkpoints);
      if (this.runner === runner) { this.savedRecording = name; this.savedAtStep = status.steps; }
    } finally { this.saving = false; }
    return name;
  }
  async open(name: string) {
    if (!/^recording-[a-f0-9-]+$/.test(name) || this.busy || this.saving) throw new Error('Choose a saved recording at a settled boundary.');
    if (await isArchivedRun(join(this.runRoot, name))) {
      const archived = await openArchivedRun(join(this.runRoot, name)); this.stop(); this.archived?.close(); this.archived = archived; this.playback = undefined; return;
    }
    const recording = await loadRun(join(this.runRoot, name));
    this.archived?.close(); this.archived = undefined;
    this.stop(); this.playback = recording;
  }
  branch() {
    if (this.busy || this.saving) throw new Error('Wait for a settled boundary and any active save.');
    const checkpoint = this.archived ? this.archived.checkpoint : (this.playback ? this.playback.checkpoints.filter(c => c.launch.runId === this.playback!.manifest.runId).at(-1) : this.active().checkpoint(`checkpoint:${randomUUID()}`));
    if (!checkpoint) throw new Error('This recording contains no resumable checkpoint.');
    const host = installedHost(checkpoint.host.contractId, checkpoint.host.implementationVersion);
    // Exact model identity is required for restore; credentials remain local.
    const connections: Record<string, ModelConnection> = Object.create(null);
    for (const effective of Object.values(checkpoint.launch.effectiveConfig)) {
      if (this.fixtureConnection) connections[effective.modelSlot] = this.fixtureConnection;
      else if (effective.model.provider === 'openrouter') connections[effective.modelSlot] = openRouterConnection(this.env.OPENROUTER_API_KEY ?? '', effective.model.model, effective.model.settings, { structuredOutputs: checkpoint.modelCapabilities?.[effective.modelSlot]?.jsonSchema });
      else if (effective.model.provider === 'ollama') connections[effective.modelSlot] = ollamaConnection(effective.model.model, undefined, effective.model.settings);
      else if (this.connections[effective.modelSlot]) connections[effective.modelSlot] = this.connections[effective.modelSlot];
      else throw new Error('Configure this provider connection in a live session before branching.');
    }
    if (checkpoint.version === 'simkind.checkpoint/2') return this.branchArchived(checkpoint, host, connections);
    const child = CharacterRunner.restore(checkpoint, host, connections, `run:${randomUUID()}`);
    this.stop(); this.runner = child; this.connections = connections;
    this.bundle = checkpoint.launch.bundle; this.parent = checkpoint; this.playback = undefined;
    this.branchComparison = compareRuns(checkpoint.events, []);
    this.savedRecording = undefined; this.saveNote = undefined; this.savedAtStep = -1;
  }
  private async branchArchived(checkpoint: RunnerCheckpoint, host: ReturnType<typeof installedHost>, connections: Record<string, ModelConnection>) {
    const source = this.archived?.storage ?? this.storage;
    if (!source) throw new Error('Missing checkpoint archive.');
    this.automatic = false; this.busy = true;
    mkdirSync(join(this.runRoot, '.active'), { recursive: true, mode: 0o700 });
    const path = join(this.runRoot, '.active', `${randomUUID()}.sqlite`);
    try {
      await source.copyTo(path);
      const storage = new SqliteRunnerStorage(path);
      let child: CharacterRunner;
      try { child = CharacterRunner.restore(checkpoint, host, connections, `run:${randomUUID()}`, { storage, recordTimings: !this.fixtureConnection }); }
      catch (error) { storage.close(); throw error; }
      this.stop(); this.storage?.close(); this.archived?.close(); this.archived = undefined; this.playback = undefined;
      this.storage = storage; this.runner = child; this.connections = connections; this.bundle = checkpoint.launch.bundle; this.parent = checkpoint;
      this.savedRecording = undefined; this.savedAtStep = -1; this.branchComparison = undefined;
    } finally { this.busy = false; }
  }
  evidence(sequence: number) {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Choose a recorded event.');
    const events = (after: number, limit = 1) => this.archived ? this.archived.events(after, limit) : this.playback ? this.playback.events.slice(after, after + limit) : this.active().events(after, limit);
    const selected = events(sequence)[0];
    if (!selected) throw new Error('Recorded event is unavailable.');
    const storage = this.archived?.storage ?? this.storage, data = selected.data as Record<string, unknown>;
    const actionId = selected.type === 'proposal' ? String(data.id) : selected.type === 'action' ? String(data.actionId) : undefined;
    const proposalSequence = actionId && storage?.get<number>(`proposal-index:${selected.runId}`, actionId);
    const proposal = typeof proposalSequence === 'number' ? events(proposalSequence)[0] : undefined;
    const requestId = (proposal && (proposal.data as { requestId: string }).requestId) || (typeof data.requestId === 'string' ? data.requestId : undefined);
    const requestSequence = requestId && storage?.get<number>(`request-index:${selected.runId}`, requestId);
    return { selected, proposal, originalRequest: typeof requestSequence === 'number' ? events(requestSequence)[0] : undefined,
      outcomes: actionId && storage ? storage.read(`ledger:${selected.runId}:action:${actionId}`, { limit: 128 }).map(row => row.value) : undefined };
  }
  economySnapshot(tick: number) {
    const storage = this.archived?.storage ?? this.storage;
    const runId = this.archived?.manifest.runId ?? this.runner?.manifest().runId;
    if (!storage || !runId || !Number.isSafeInteger(tick) || tick < 0) throw new Error('Choose an archived economy turn.');
    const events = storage.read<RunEvent>(`events:${runId}`, { fromTurn: tick, toTurn: tick, limit: 10000 }).map(row => row.value);
    const report = recordedEconomyReports(events).at(-1);
    if (!report) throw new Error('No economy report at this turn.');
    return report;
  }
  memory(actor: string, query: unknown = {}) {
    const storage = this.archived?.storage ?? this.storage;
    const launch = this.archived?.launch ?? this.active().inspect().launch;
    const config = launch.effectiveConfig[actor]?.features[contextProfile.id];
    if (!storage || !config?.enabled) throw new Error('Choose a character using archived memory.');
    const manager = new CharacterMemory(storage, { ...contextProfile.defaults.config, ...config.config } as ContextSettings);
    const cutoff = manager.cutoff(actor), versions = storage.count(`memory-versions:${actor}`);
    return { actor, currentIntentions: launch.states[actor].context.intentions, memory: cutoff.head,
      versions: storage.read(`memory-versions:${actor}`, { after: Math.max(-1, versions - 11), limit: 10 }).map(row => row.value), evidence: manager.recall(actor, cutoff, query) };
  }
  async compare(name?: string) {
    if (!this.parent) throw new Error('Create a branch to compare its continuation.');
    if (name) {
      if (!/^recording-[a-f0-9-]+$/.test(name)) throw new Error('Choose a saved recording.');
      const runner = this.active();
      const left = { manifest: runner.manifest(), events: [...this.eventPages()].map(observerEvent), parent: structuredClone(this.parent) };
      if (await isArchivedRun(join(this.runRoot, name))) {
        const right = await openArchivedRun(join(this.runRoot, name));
        try {
          const parent = right.storage.get<RunnerCheckpoint>('checkpoints', right.manifest.parent?.checkpointId ?? '');
          if (!parent) throw new Error('Choose a saved sibling continuation with a parent checkpoint.');
          const events: RunEvent[] = [];
          for (let offset = 0;; offset += 256) { const page = right.events(offset, 256); events.push(...page.map(observerEvent)); if (page.length < 256) break; }
          return compareBranches(left, { manifest: right.manifest, events, parent });
        } finally { right.close(); }
      }
      const right = await loadRun(join(this.runRoot, name));
      const parent = right.checkpoints.find(c => c.id === right.manifest.parent?.checkpointId && c.launch.runId === right.manifest.parent?.runId);
      if (!parent) throw new Error('Choose a saved sibling continuation with a parent checkpoint.');
      return compareBranches(left, { ...right, parent });
    }
    this.branchComparison = compareRuns(this.parent.version === 'simkind.checkpoint/2' ? this.eventPages(this.parent.launch.runId, this.parent.archive!.eventCount) : this.parent.events, this.eventPages());
    return this.branchComparison;
  }
  private *eventPages(runId = this.archived?.manifest.runId ?? this.runner?.manifest().runId, count = Infinity): Generator<RunEvent> {
    const storage = this.playback ? undefined : this.archived?.storage ?? this.storage;
    for (let offset = 0; offset < count; offset += 128) {
      const page = storage && runId ? storage.read<RunEvent>(`events:${runId}`, { after: offset - 1, limit: Math.min(128, count - offset) }).map(row => row.value)
        : this.playback ? this.playback.events.slice(offset, offset + 128) : this.active().events(offset, 128);
      yield* page;
      if (page.length < 128) break;
    }
  }
  importPlayback(value: { format: string; manifest: RunBundle; events: RunEvent[] }) {
    if (this.busy) throw new Error('Wait for the current boundary.');
    if (value.format !== 'simkind.playback/1' || !validateDocument(value.manifest).ok || value.manifest.kind !== 'run-bundle' || !Array.isArray(value.events)) throw new Error('Invalid playback bundle.');
    const ids = new Set<string>();
    for (const [index, event] of value.events.entries()) {
      if (validateRecord('RunEvent', event).length || event.runId !== value.manifest.runId || event.sequence !== index || ids.has(event.id) || validateTime(event.time, value.manifest.clocks).length) throw new Error('Invalid playback event.');
      ids.add(event.id);
    }
    const manifest = structuredClone(value.manifest);
    manifest.capabilities = { playback: true, restore: false, branch: false, deterministicReplay: false };
    manifest.inputs = []; manifest.checkpoints = []; manifest.eventStreams = [];
    if (manifest.profiles) delete manifest.profiles['simkind.archive'];
    if (manifest.extensions) delete manifest.extensions['simkind.archive'];
    manifest.completeness.status = 'truncated'; manifest.completeness.missingResources.push('imported-playback-only');
    this.stop(); this.archived?.close(); this.archived = undefined; this.playback = { manifest, events: structuredClone(value.events), checkpoints: [] };
  }
  exportPlayback(redact = false): { format: string; manifest: RunBundle; events: RunEvent[] } {
    const manifest = structuredClone(this.archived?.manifest ?? this.playback?.manifest ?? this.active().manifest());
    const events: RunEvent[] = []; let bytes = 0;
    for (const original of this.eventPages()) {
      const event = redact ? { ...original, data: { redacted: true } } : original;
      bytes += Buffer.byteLength(JSON.stringify(event));
      if (bytes > 32 * 1024 * 1024) throw new Error('Single-file playback export exceeds 32 MiB. Use the saved archive directory for this run.');
      events.push(event);
    }
    manifest.inputs = []; manifest.checkpoints = []; manifest.eventStreams = [];
    if (manifest.profiles) delete manifest.profiles['simkind.archive'];
    if (manifest.extensions) delete manifest.extensions['simkind.archive'];
    manifest.capabilities = { playback: true, deterministicReplay: false, restore: false, branch: false };
    manifest.completeness.status = 'truncated'; manifest.completeness.missingResources.push('frozen-inputs', 'checkpoints');
    if (redact) {
      for (const event of events) event.data = { redacted: true };
      manifest.effectiveConfig = {}; manifest.completeness.missingResources.push('all-event-content', 'effective-configuration');
    }
    return { format: 'simkind.playback/1', manifest, events };
  }
}
