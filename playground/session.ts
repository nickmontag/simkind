import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CharacterRunner, createCharacterRunner, prepareLaunch, compareRuns, compareBranches, type HostIntervention, type ModelConnection, type ResolvedBundle, type RunnerCheckpoint, type StateEdit } from 'simkind/runner';
import { loadScenario, resolveSources, saveRun, loadRun } from 'simkind/node';
import { validateDocument, validateRecord, validateTime, type RunEvent, type RunBundle } from 'simkind/format';
import { openRouterConnection, ollamaConnection, chatCompletionsConnection } from 'simkind/providers';
import { installedHost } from '../examples/portable/hosts/registry.js';

export interface Slot { provider: 'openrouter' | 'ollama' | 'compatible'; model: string; apiKeyEnv?: string; endpoint?: string }
export interface Draft { scenarioPath: string; configPath: string; sources: Record<string, string>; slots: Record<string, Slot> }
const templates = ['shared-decision.json', 'workshop.json', 'pump-crisis.json', 'orbital-greenhouse.json'];
export class PlaygroundSession {
  private runner?: CharacterRunner;
  private bundle?: ResolvedBundle;
  private connections: Record<string, ModelConnection> = {};
  private parent?: RunnerCheckpoint;
  private playback?: Awaited<ReturnType<typeof loadRun>>;
  private branchComparison?: ReturnType<typeof compareRuns>;
  private automatic = false;
  private busy = false;
  private failure?: string;
  constructor(private readonly scenarioRoot: string, private readonly runRoot: string, private readonly env: Record<string, string | undefined>, private readonly fixtureConnection?: ModelConnection) {}
  async catalog() {
    await mkdir(this.runRoot, { recursive: true });
    return { templates, recordings: (await readdir(this.runRoot, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name),
      connection: { openrouterKey: !!this.env.OPENROUTER_API_KEY, model: this.env.OPENROUTER_MODEL ?? '' } };
  }
  async template(name: string): Promise<Draft> {
    if (!templates.includes(name)) throw new Error('Choose an installed scenario.');
    const loaded = await loadScenario(this.scenarioRoot, name, 'config-continuity.json');
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    return { sources: loaded.value.sources, scenarioPath: name, configPath: 'config-continuity.json',
      slots: { primary: { provider: 'openrouter', model: this.env.OPENROUTER_MODEL ?? '', apiKeyEnv: 'OPENROUTER_API_KEY' } } };
  }
  private prepare(draft: Draft) {
    const loaded = resolveSources(draft.sources, draft.scenarioPath, draft.configPath);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    const scene = loaded.value.documents[loaded.value.scenarioId];
    if (scene.kind !== 'scenario') throw new Error('Choose a scenario document.');
    const host = installedHost(scene.host.contractId);
    const connections: Record<string, ModelConnection> = Object.create(null);
    for (const [slot, config] of Object.entries(draft.slots)) {
      if (this.fixtureConnection) { connections[slot] = this.fixtureConnection; continue; }
      const key = this.env[config.apiKeyEnv ?? 'OPENROUTER_API_KEY'] ?? '';
      if (config.provider === 'openrouter') connections[slot] = openRouterConnection(key, config.model);
      else if (config.provider === 'ollama') connections[slot] = ollamaConnection(config.model, config.endpoint || undefined);
      else if (config.provider === 'compatible') {
        if (!config.endpoint) throw new Error('Supply the compatible chat-completions endpoint.');
        connections[slot] = chatCompletionsConnection({ provider: 'compatible', model: config.model, endpoint: config.endpoint, apiKey: key });
      } else throw new Error('Unknown provider.');
    }
    const runId = `run:${randomUUID()}`;
    const prepared = prepareLaunch(loaded.value, host, connections, runId);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.diagnostics));
    return { bundle: loaded.value, host, connections, runId, launch: prepared.value };
  }
  validate(draft: Draft) { return this.prepare(draft).launch; }
  start(draft: Draft) {
    if (this.busy) throw new Error('Wait for the current boundary or stop.');
    const prepared = this.prepare(draft);
    const result = createCharacterRunner(prepared.bundle, prepared.host, prepared.connections, prepared.runId);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    this.runner?.stop(); this.automatic = false; this.failure = undefined;
    this.runner = result.value; this.bundle = prepared.bundle; this.connections = prepared.connections;
    this.parent = undefined; this.playback = undefined; this.branchComparison = undefined;
  }
  state() {
    if (this.playback) return { mode: 'playback', manifest: this.playback.manifest, events: this.playback.events, checkpoints: this.playback.checkpoints.map(c => ({ id: c.id, runId: c.launch.runId })), busy: false };
    if (!this.runner) return { mode: 'authoring', busy: this.busy };
    const inspection = this.runner.inspect(); const status = inspection.status;
    return { mode: 'live', ...inspection, manifest: this.runner.manifest(), events: this.runner.events(), interventions: this.runner.hostInterventions(), automatic: this.automatic, busy: this.busy,
      canCheckpoint: !this.busy && !status.stopped && !status.pendingRequests && !status.activeProviders && !status.unresolvedActions,
      ...(this.failure ? { failure: this.failure } : {}), ...(this.branchComparison ? { comparison: this.branchComparison } : {}) };
  }
  private active() { if (!this.runner || this.playback) throw new Error('Start or resume a live run.'); return this.runner; }
  async step() {
    if (this.busy) throw new Error('A boundary is already in progress.');
    const runner = this.active(); this.busy = true;
    try { runner.step(); await runner.settleDecisions(); }
    catch { runner.stop(); this.automatic = false; this.failure = 'Execution failed. Inspect and save the incomplete evidence.'; }
    finally { this.busy = false; }
  }
  run() {
    const runner = this.active(); if (this.automatic) return;
    if (this.busy || runner.status().stopped) throw new Error('Wait for the boundary or start a new run.');
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
  dispatch() { this.active().pauseDispatch(false); }
  intervene(actor: string, edit: StateEdit) { if (this.busy) throw new Error('Wait for the settled boundary.'); this.active().intervene(actor, edit, 'operator:playground'); }
  private worldEdit(edit: Omit<HostIntervention, 'operator'>): HostIntervention {
    if (this.busy || this.automatic) throw new Error('Pause and wait for the settled boundary.');
    return { ...edit, operator: 'operator:playground' };
  }
  previewWorld(edit: Omit<HostIntervention, 'operator'>) { return this.active().previewHostIntervention(this.worldEdit(edit)); }
  interveneWorld(edit: Omit<HostIntervention, 'operator'>) { this.active().interveneHost(this.worldEdit(edit)); }
  async save() {
    if (this.busy) throw new Error('Pause and wait for the current boundary before saving.');
    const runner = this.active(); const checkpoints: RunnerCheckpoint[] = [];
    if (this.parent) checkpoints.push(this.parent);
    const status = runner.status();
    if (!status.stopped && !status.activeProviders && !status.unresolvedActions && !status.pendingRequests) checkpoints.push(runner.checkpoint(`checkpoint:${randomUUID()}`));
    const name = `recording-${randomUUID()}`;
    await mkdir(this.runRoot, { recursive: true });
    await saveRun(join(this.runRoot, name), runner.manifest(), runner.events(), this.bundle!, checkpoints);
    return name;
  }
  async open(name: string) {
    if (!/^recording-[a-f0-9-]+$/.test(name) || this.busy) throw new Error('Choose a saved recording at a settled boundary.');
    const recording = await loadRun(join(this.runRoot, name));
    this.stop(); this.playback = recording;
  }
  branch() {
    if (this.busy) throw new Error('Wait for a settled boundary.');
    const checkpoint = this.playback ? this.playback.checkpoints.filter(c => c.launch.runId === this.playback!.manifest.runId).at(-1) : this.active().checkpoint(`checkpoint:${randomUUID()}`);
    if (!checkpoint) throw new Error('This recording contains no resumable checkpoint.');
    const host = installedHost(checkpoint.host.contractId, checkpoint.host.implementationVersion);
    // Exact model identity is required for restore; credentials remain local.
    const connections: Record<string, ModelConnection> = Object.create(null);
    for (const effective of Object.values(checkpoint.launch.effectiveConfig)) {
      if (this.fixtureConnection) connections[effective.modelSlot] = this.fixtureConnection;
      else if (effective.model.provider === 'openrouter') connections[effective.modelSlot] = openRouterConnection(this.env.OPENROUTER_API_KEY ?? '', effective.model.model, effective.model.settings);
      else if (effective.model.provider === 'ollama') connections[effective.modelSlot] = ollamaConnection(effective.model.model, undefined, effective.model.settings);
      else if (this.connections[effective.modelSlot]) connections[effective.modelSlot] = this.connections[effective.modelSlot];
      else throw new Error('Configure this provider connection in a live session before branching.');
    }
    const child = CharacterRunner.restore(checkpoint, host, connections, `run:${randomUUID()}`);
    this.stop(); this.runner = child; this.connections = connections;
    this.bundle = checkpoint.launch.bundle; this.parent = checkpoint; this.playback = undefined;
    this.branchComparison = compareRuns(checkpoint.events, []);
  }
  async compare(name?: string) {
    if (!this.parent) throw new Error('Create a branch to compare its continuation.');
    if (name) {
      if (!/^recording-[a-f0-9-]+$/.test(name)) throw new Error('Choose a saved recording.');
      const runner = this.active();
      const left = { manifest: runner.manifest(), events: runner.events(), parent: structuredClone(this.parent) };
      const right = await loadRun(join(this.runRoot, name));
      const parent = right.checkpoints.find(c => c.id === right.manifest.parent?.checkpointId && c.launch.runId === right.manifest.parent?.runId);
      if (!parent) throw new Error('Choose a saved sibling continuation with a parent checkpoint.');
      return compareBranches(left, { ...right, parent });
    }
    this.branchComparison = compareRuns(this.parent.events, this.active().events());
    return this.branchComparison;
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
    manifest.completeness.status = 'truncated'; manifest.completeness.missingResources.push('imported-playback-only');
    this.stop(); this.playback = { manifest, events: structuredClone(value.events), checkpoints: [] };
  }
  exportPlayback(redact = false): { format: string; manifest: RunBundle; events: RunEvent[] } {
    const manifest = structuredClone(this.playback?.manifest ?? this.active().manifest());
    const events = structuredClone(this.playback?.events ?? this.active().events());
    manifest.inputs = []; manifest.checkpoints = []; manifest.eventStreams = [];
    manifest.capabilities = { playback: true, deterministicReplay: false, restore: false, branch: false };
    manifest.completeness.status = 'truncated'; manifest.completeness.missingResources.push('frozen-inputs', 'checkpoints');
    if (redact) {
      for (const event of events) event.data = { redacted: true };
      manifest.effectiveConfig = {}; manifest.completeness.missingResources.push('all-event-content', 'effective-configuration');
    }
    return { format: 'simkind.playback/1', manifest, events };
  }
}
