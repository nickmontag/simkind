import { continuityProfile, reviseTool, reviseState, retainObservation, selectContinuityMemories, type StateEdit } from './continuity.js';
import { validateCheckpoint, ledgerFromEvents, type RunnerCheckpoint } from './checkpoint.js';
import { ModelRuntime, type ModelRequest, type ModelCompletion } from '../model-runtime.js';
import { compileDataSchema, validateRecord, validateTime, type ActionEvent, type ActionProposal,
  canonicalJson, type FormatResult, type JsonValue, type RunBundle, type RunEvent } from '../format/index.js';
import { readMappedCharacter, object, checkJsonValue } from '../format/character.js';
import { ActionLedger } from './actions.js';
import { memoryRetrievalProfile, prepareLaunch } from './launch.js';
import type { CharacterHost, DecisionContext, HostIntervention, HostRegistration, ModelConnection, PreparedLaunch, ProviderResult, ResolvedBundle } from './contracts.js';

interface Request extends ModelRequest {
  actor: string;
  context: DecisionContext;
  revision: number;
  deadline: number;
  controller: AbortController;
  finishedAt?: number;
}

function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }

/** Optional scheduler: no host-world branches and no prescribed character strategy. */
export class CharacterRunner {
  private readonly host: CharacterHost;
  private readonly ledger: ActionLedger;
  private parent?: RunBundle['parent'];
  private readonly runtime: ModelRuntime<Request, ProviderResult>;
  private readonly pending = new Map<string, Request>();
  private readonly history: RunEvent[] = [];
  private readonly toolValidators = new Map<string, ReturnType<typeof compileDataSchema>>();
  private readonly outputValidators = new Map<string, ReturnType<typeof compileDataSchema>>();
  private requestCount = 0;
  private requestSequence = 0;
  private steps = 0;
  private activeProviders = 0;
  private paused = false;
  private stopped = false;
  private nextActor = 0;
  private wakeWait?: () => void;

  private constructor(
    private readonly launch: PreparedLaunch,
    private readonly registration: HostRegistration,
    connections: Readonly<Record<string, ModelConnection>>,
    checkpoint?: RunnerCheckpoint,
  ) {
    this.host = checkpoint ? registration.restore!(structuredClone(launch), structuredClone(checkpoint.hostState)) : registration.create(structuredClone(launch));
    this.ledger = checkpoint ? ledgerFromEvents(launch.runId, registration.descriptor.clocks, checkpoint.events) : new ActionLedger(launch.runId, registration.descriptor.clocks);
    if (checkpoint) {
      this.history.push(...structuredClone(checkpoint.events));
      this.steps = checkpoint.scheduler.steps; this.requestCount = checkpoint.scheduler.requests; this.requestSequence = checkpoint.scheduler.requestSequence;
      this.nextActor = checkpoint.scheduler.nextActor; this.paused = checkpoint.scheduler.paused;
      this.parent = structuredClone(checkpoint.parent);
    }
    for (const tool of registration.descriptor.toolCatalog.tools) {
      this.toolValidators.set(tool.id, compileDataSchema(tool.inputSchema));
      if (tool.outputSchema !== undefined) this.outputValidators.set(tool.id, compileDataSchema(tool.outputSchema));
    }
    this.toolValidators.set(reviseTool.id, compileDataSchema(reviseTool.inputSchema));
    this.runtime = new ModelRuntime(async (request) => {
      this.activeProviders++;
      try {
        const slot = launch.effectiveConfig[request.actor].modelSlot;
        // Providers get their own permitted context copy and no host/operator state.
        return await connections[slot].fulfill(structuredClone(request.context), request.controller.signal);
      } finally { request.finishedAt = Date.now(); this.activeProviders--; }
    }, launch.config.limits.maxInFlight);
    this.assertTime();
  }

  static create(bundle: ResolvedBundle, registration: HostRegistration, connections: Readonly<Record<string, ModelConnection>>, runId: string): FormatResult<CharacterRunner> {
    const snapshot = { ...registration, descriptor: structuredClone(registration.descriptor) };
    const launch = prepareLaunch(bundle, snapshot, connections, runId);
    return launch.ok ? { ok: true, value: new CharacterRunner(launch.value, snapshot, { ...connections }) } : launch;
  }

  /** Exact compatible restore; supplying a new run ID creates a fresh continuation. */
  static restore(checkpoint: RunnerCheckpoint, registration: HostRegistration, connections: Readonly<Record<string, ModelConnection>>, branchRunId?: string): CharacterRunner {
    validateCheckpoint(checkpoint);
    const descriptor = registration.descriptor;
    if (!descriptor.capabilities.restore || !registration.restore || branchRunId && !descriptor.capabilities.branch) throw new Error('Host does not support this restore mode.');
    if (canonicalJson(checkpoint.host) !== canonicalJson({ contractId: descriptor.contractId, version: descriptor.version, implementationVersion: descriptor.implementationVersion })) throw new Error('Checkpoint host version mismatch.');
    const launch = prepareLaunch(checkpoint.launch.bundle, registration, connections, branchRunId ?? checkpoint.launch.runId);
    if (!launch.ok) throw new Error(JSON.stringify(launch.diagnostics));
    if (canonicalJson(launch.value.effectiveConfig) !== canonicalJson(checkpoint.launch.effectiveConfig)
      || canonicalJson(launch.value.scenario) !== canonicalJson(checkpoint.launch.scenario)
      || canonicalJson(launch.value.config) !== canonicalJson(checkpoint.launch.config)
      || canonicalJson(launch.value.characters) !== canonicalJson(checkpoint.launch.characters)) throw new Error('Checkpoint launch configuration mismatch.');
    ledgerFromEvents(checkpoint.launch.runId, descriptor.clocks, checkpoint.events);
    const copy = structuredClone(checkpoint);
    launch.value.states = structuredClone(checkpoint.launch.states);
    if (canonicalJson(Object.keys(launch.value.states).sort()) !== canonicalJson(launch.value.scenario.cast.map(m => m.instanceId).sort())) throw new Error('Checkpoint cast mismatch.');
    for (const [actor, state] of Object.entries(launch.value.states)) {
      if (state.definitionHash !== launch.value.bundle.artifacts.find(a => a.documentId === launch.value.characters[actor].id)?.sha256) throw new Error('Checkpoint definition hash mismatch.');
    }
    if (branchRunId) {
      if (branchRunId === checkpoint.launch.runId) throw new Error('A branch requires a new run ID.');
      copy.events = [];
      copy.scheduler.steps = 0; copy.scheduler.requests = 0; copy.scheduler.paused = true;
      copy.parent = { runId: checkpoint.launch.runId, checkpointId: checkpoint.id, interventionRefs: [] };
    }
    copy.launch = launch.value;
    return new CharacterRunner(launch.value, { ...registration, descriptor: structuredClone(descriptor) }, { ...connections }, copy);
  }

  checkpoint(id = `checkpoint:${this.history.length}`): RunnerCheckpoint {
    this.poll();
    if (!this.registration.descriptor.capabilities.restore || !this.registration.restore || !this.host.checkpoint) throw new Error('Host does not support checkpoints.');
    if (this.stopped || this.pending.size || this.activeProviders || this.ledger.unresolved().length) throw new Error('Checkpoint requires a settled, non-stopped boundary.');
    const checkpoint: RunnerCheckpoint = { version: 'simkind.checkpoint/1', id, host: this.manifest().host,
      launch: structuredClone(this.launch), hostState: structuredClone(this.host.checkpoint()), events: this.events(),
      scheduler: { steps: this.steps, requests: this.requestCount, requestSequence: this.requestSequence, nextActor: this.nextActor, paused: this.paused },
      ...(this.parent ? { parent: structuredClone(this.parent) } : {}) };
    validateCheckpoint(checkpoint);
    return checkpoint;
  }

  /** Operator edit to character state, distinct from a host-defined world intervention. */
  intervene(actor: string, edit: StateEdit, operator: string): void {
    if (!operator.trim() || !Object.hasOwn(this.launch.states, actor)) throw new Error('Name an operator and an existing character.');
    if (this.stopped || this.pending.size || this.activeProviders || this.ledger.unresolved().length) throw new Error('Intervention requires a settled boundary.');
    const id = `intervention:${this.history.length}`;
    const proposal: ActionProposal = { id, runId: this.launch.runId, actor, requestId: id, toolId: reviseTool.id,
      toolVersion: reviseTool.version, observedRevision: this.host.revision(), arguments: json(edit) as ActionProposal['arguments'] };
    this.ledger.propose(proposal); this.record('proposal', proposal);
    const applied = this.applyStateEdit(proposal, edit, undefined, operator);
    if (this.parent) this.parent.interventionRefs.push(id);
    if (!applied) throw new Error('State intervention rejected; inspect the recorded reason.');
  }

  hostInterventions() {
    return { revision: this.host.revision(), operations: structuredClone(this.registration.descriptor.interventions ?? []) };
  }

  private interventionProposal(edit: HostIntervention): ActionProposal {
    if (!this.host.previewIntervention || !this.host.intervene || !this.registration.descriptor.interventions?.length) throw new Error('Host does not support world interventions.');
    if (this.stopped || this.pending.size || this.activeProviders || this.ledger.unresolved().length) throw new Error('Intervention requires a settled boundary.');
    if (Object.hasOwn(this.launch.states, edit.operator)) throw new Error('Operator identity must be distinct from the cast.');
    const id = `intervention:world:${this.requestSequence + 1}`;
    const proposal: ActionProposal = { id, runId: this.launch.runId, actor: edit.operator, requestId: id,
      toolId: edit.operationId, toolVersion: edit.operationVersion, observedRevision: edit.expectedRevision, arguments: structuredClone(edit.arguments) };
    if (validateRecord('ActionProposal', proposal).length) throw new Error('Invalid intervention envelope.');
    return proposal;
  }

  previewHostIntervention(edit: HostIntervention) {
    return structuredClone(this.host.previewIntervention!(this.interventionProposal(edit)));
  }

  /** Host-owned atomic condition change; observation delivery retains normal projections. */
  interveneHost(edit: HostIntervention): void {
    const proposal = this.interventionProposal(edit);
    this.requestSequence++; // Preserve uniqueness across restored host command logs and branches.
    this.ledger.propose(proposal); this.record('proposal', proposal);
    this.receive(this.host.intervene!(structuredClone(proposal)));
    if (this.parent) this.parent.interventionRefs.push(proposal.id);
    const outcome = this.ledger.get(proposal.id)!;
    if (outcome.status === 'rejected') throw new Error('World intervention rejected; inspect the recorded reason.');
    if (outcome.status !== 'succeeded') throw new Error('Host intervention must finish atomically.');
  }

  private applyStateEdit(proposal: ActionProposal, edit: StateEdit, visible?: string[], operator?: string): boolean {
    let next;
    try { next = reviseState(this.launch.states[proposal.actor], edit, this.launch.runId, `interpretation:${this.history.length}`, visible); }
    catch (error) {
      this.receive([{ id: `state-rejected:${this.history.length}`, runId: this.launch.runId, actor: proposal.actor, actionId: proposal.id,
        status: 'rejected', revision: this.host.revision(), time: this.host.time(), effectRefs: [], reason: (error as Error).message }]);
      return false;
    }
    this.receive([{ id: `state-accepted:${this.history.length}`, runId: this.launch.runId, actor: proposal.actor, actionId: proposal.id,
      status: 'accepted', revision: this.host.revision(), time: this.host.time(), effectRefs: [] }, { id: `state-applied:${this.history.length}`, runId: this.launch.runId, actor: proposal.actor, actionId: proposal.id,
      status: 'succeeded', revision: this.host.revision(), time: this.host.time(), effectRefs: [],
      result: json({ state: next, authority: operator ? 'operator' : 'character-self-report', ...(operator ? { operator } : {}) }) }]);
    this.launch.states[proposal.actor] = next;
    return true;
  }

  private assertTime(): void {
    if (validateTime(this.host.time(), this.registration.descriptor.clocks).length || !Number.isSafeInteger(this.host.revision()) || this.host.revision() < 0) throw new Error('Host returned an invalid clock or revision.');
  }

  private record(type: RunEvent['type'], data: unknown): void {
    this.assertTime();
    const sequence = this.history.length;
    this.history.push({ id: `event:${sequence}`, runId: this.launch.runId, sequence, time: structuredClone(this.host.time()), type, data: json(data) });
  }

  private receive(events: readonly ActionEvent[]): void {
    for (const event of events) {
      const action = this.ledger.get(event.actionId);
      const tool = action && this.registration.descriptor.toolCatalog.tools.find((candidate) => candidate.id === action.proposal.toolId);
      if ((event.status === 'running' || event.status === 'unknown') && tool && !tool.lifecycle.asynchronous) throw new Error('Host emitted an asynchronous status for an immediate tool.');
      if (event.status === 'succeeded' && action && this.outputValidators.get(action.proposal.toolId)?.(event.result).length) throw new Error('Host result violates the tool output schema.');
    }
    for (const event of this.ledger.receive(events)) this.record('action', event);
  }

  private complete(completion: ModelCompletion<Request, ProviderResult>): void {
    const request = this.pending.get(completion.request.id);
    if (!request || this.stopped) return; // expired/reset results never reach the host
    this.pending.delete(request.id);
    if ((request.finishedAt ?? Date.now()) > request.deadline) {
      request.controller.abort();
      this.record('model-timeout', { requestId: request.id, actor: request.actor });
      return;
    }
    if (completion.status === 'rejected') {
      // Provider error text can contain request headers or credentials. Never record it.
      this.record('model-error', { requestId: request.id, actor: request.actor, code: 'PROVIDER_ERROR' });
      return;
    }
    const response = completion.input;
    if (!object(response)) {
      this.record('model-error', { requestId: request.id, actor: request.actor, code: 'INVALID_OUTPUT' });
      return;
    }
    let output: unknown = response.output;
    if (typeof output === 'string') {
      const parsed = readMappedCharacter(output);
      output = parsed.ok ? parsed.value : undefined;
    }
    try { checkJsonValue(output); }
    catch { output = undefined; }
    const usage = response.usage;
    const safeUsage = Object.fromEntries(['inputTokens', 'outputTokens', 'cost'].flatMap((key) => {
      const amount = usage?.[key as keyof typeof usage];
      return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? [[key, amount]] : [];
    }));
    if (!object(output) || Object.keys(output).some((key) => key !== 'toolId' && key !== 'arguments')
      || !(typeof output.toolId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(output.toolId) || output.toolId === null) || !object(output.arguments)
      || output.toolId === null && Object.keys(output.arguments).length > 0) {
      this.record('model-error', { requestId: request.id, actor: request.actor, code: 'INVALID_OUTPUT', usage: safeUsage });
      return;
    }
    this.record('model-result', { requestId: request.id, actor: request.actor, output, usage: safeUsage });
    if (output.toolId === null) return; // Legal refusal/no action, without manufactured effects.
    const tool = request.context.tools.find((candidate) => candidate.id === output.toolId);
    const proposal: ActionProposal = { id: `action:${request.id}`, runId: this.launch.runId, actor: request.actor,
      requestId: request.id, toolId: output.toolId, toolVersion: tool?.version ?? 'unknown', observedRevision: request.revision, arguments: json(output.arguments) as ActionProposal['arguments'] };
    this.ledger.propose(proposal);
    this.record('proposal', proposal);
    const invalid = !tool || this.toolValidators.get(tool.id)!(proposal.arguments).length > 0;
    if (!invalid && proposal.toolId === reviseTool.id) {
      this.applyStateEdit(proposal, output.arguments as unknown as StateEdit, request.context.memories.map(m => m.id));
      return;
    }
    const unavailable = !this.host.availableTools(request.actor).includes(proposal.toolId);
    const stale = this.registration.descriptor.capabilities.revisionPolicy === 'reject' && this.host.revision() !== request.revision;
    if (invalid || unavailable || stale) {
      this.receive([{ id: `rejected:${request.id}`, runId: this.launch.runId, actionId: proposal.id, actor: request.actor,
        status: 'rejected', time: this.host.time(), revision: this.host.revision(), effectRefs: [],
        reason: invalid ? 'Tool or arguments were not permitted by the request contract.' : unavailable ? 'Tool is no longer available.' : 'Observed host revision is stale.' }]);
      return;
    }
    // Admission and effects are validated by the host again against current state.
    this.receive(this.host.submit(structuredClone(proposal)));
  }

  private poll(): void {
    // Completion time, rather than the caller's polling latency, decides timeout.
    for (const completion of this.runtime.poll([])) this.complete(completion);
    const now = Date.now();
    for (const request of this.pending.values()) {
      if (now >= request.deadline) {
        request.controller.abort();
        this.pending.delete(request.id);
        this.record('model-timeout', { requestId: request.id, actor: request.actor });
      }
    }
    this.receive(this.host.drainEvents());
  }

  /** One host-defined opportunity boundary. Provider work remains asynchronous. */
  step(): void {
    if (this.stopped) return;
    this.poll();
    if (this.steps >= this.launch.config.limits.maxSteps) return;
    this.host.advance();
    this.steps++;
    this.receive(this.host.drainEvents());
    const perspectives = new Map<string, DecisionContext['observations']>();
    // Observation delivery continues while actions are unresolved or dispatch is paused.
    for (const actor of Object.keys(this.launch.states)) {
      const observations = this.host.observe(actor);
      for (const observation of observations) {
        if (validateRecord('Observation', observation).length || observation.recipient !== actor || observation.runId !== this.launch.runId
          || validateTime(observation.capturedAt, this.registration.descriptor.clocks).length
          || validateTime(observation.deliveredAt, this.registration.descriptor.clocks).length) throw new Error('Host observation violates the recipient, clock, or schema contract.');
        this.record('observation', observation);
        if (this.launch.effectiveConfig[actor].features[continuityProfile.id]?.enabled) retainObservation(this.launch.states[actor], observation);
      }
      perspectives.set(actor, structuredClone(observations));
    }
    if (this.paused) return;
    const limits = this.launch.config.limits;
    const actors = [...new Set(this.host.decisionActors())];
    const ordered = [...actors.slice(this.nextActor), ...actors.slice(0, this.nextActor)];
    for (const actor of ordered) {
      if (!Object.hasOwn(this.launch.states, actor)) throw new Error('Host scheduled an unknown instance.');
      if (this.requestCount >= limits.maxRequests || this.activeProviders >= limits.maxInFlight) break;
      if ([...this.pending.values()].some((entry) => entry.actor === actor) || this.ledger.unresolved(actor).length) continue;
      const effective = this.launch.effectiveConfig[actor];
      const observations = perspectives.get(actor)!;
      const available = this.host.availableTools(actor);
      const tools = this.registration.descriptor.toolCatalog.tools.filter((tool) => effective.allowedTools.includes(tool.id) && available.includes(tool.id));
      const continuity = effective.features[continuityProfile.id]?.enabled;
      if (continuity) tools.push(structuredClone(reviseTool));
      this.requestCount++;
      const id = `request:${++this.requestSequence}`;
      this.nextActor = (actors.indexOf(actor) + 1) % actors.length;
      const feature = effective.features[memoryRetrievalProfile.id];
      const stored = this.launch.states[actor].context.memories ?? [];
      const memories = feature?.enabled ? continuity ? selectContinuityMemories(stored, Number(feature.config?.maxItems))
        : [...stored].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, Number(feature.config?.maxItems)) : [];
      const character = this.launch.characters[actor];
      const context: DecisionContext = { runId: this.launch.runId, requestId: id, instanceId: actor,
        character: { name: character.name, ...(character.persona ? { persona: structuredClone(character.persona) } : {}) },
        stateRevision: this.launch.states[actor].revision,
        intentions: structuredClone(this.launch.states[actor].context.intentions ?? []), memories: structuredClone(memories),
        observations: structuredClone(observations), tools: structuredClone(tools), outcomes: this.ledger.eventsFor(actor), model: structuredClone(effective.model) };
      const request: Request = { id, actor, context, revision: this.host.revision(), issuedAtTick: this.steps,
        priority: 0, deadline: Date.now() + limits.requestTimeoutMs, controller: new AbortController() };
      this.pending.set(id, request);
      this.record('request', { context, observedRevision: request.revision });
      for (const completion of this.runtime.poll([request])) this.complete(completion);
    }
  }

  /** Waits only to local request deadlines; abort-ignoring provider work retains concurrency. */
  async settleDecisions(): Promise<void> {
    if (this.pending.size) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = Math.max(...[...this.pending.values()].map((request) => request.deadline));
        await Promise.race([this.runtime.settled(), new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now())); }),
          new Promise<void>((resolve) => { this.wakeWait = resolve; })]);
      } finally { if (timer) clearTimeout(timer); this.wakeWait = undefined; }
    }
    this.poll();
  }

  pauseDispatch(paused = true): void { this.paused = paused; }
  cancel(actionId: string): void {
    if (!this.ledger.get(actionId)) throw new Error('Unknown action ID.');
    this.receive(this.host.cancel(actionId));
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const request of this.pending.values()) request.controller.abort();
    const pendingRequests = this.pending.size;
    this.pending.clear();
    this.runtime.reset();
    this.wakeWait?.();
    this.record('stopped', { pendingRequests, unresolvedActions: this.ledger.unresolved().length });
  }
  events(): RunEvent[] { return structuredClone(this.history); }
  inspect(): { host: JsonValue; launch: PreparedLaunch; status: ReturnType<CharacterRunner['status']> } {
    return { host: structuredClone(this.host.inspect()), launch: structuredClone(this.launch), status: this.status() };
  }
  status() { return { steps: this.steps, requests: this.requestCount, pendingRequests: this.pending.size,
    activeProviders: this.activeProviders, unresolvedActions: this.ledger.unresolved().length, paused: this.paused, stopped: this.stopped }; }
  manifest(): RunBundle {
    const status = this.status();
    const descriptor = this.registration.descriptor;
    return { specVersion: '0.2.0-draft.2', kind: 'run-bundle', id: 'bundle:run', runId: this.launch.runId,
      scenarioRef: this.launch.scenario.id, configRef: this.launch.config.id,
      host: { contractId: descriptor.contractId, version: descriptor.version, implementationVersion: descriptor.implementationVersion },
      profiles: Object.fromEntries(Object.entries(this.launch.profileVersions).map(([id, version]) => [id, { version, required: false }])),
      clocks: structuredClone(descriptor.clocks), inputs: structuredClone(this.launch.bundle.artifacts),
      effectiveConfig: structuredClone(this.launch.effectiveConfig), limits: structuredClone(this.launch.config.limits),
      eventStreams: [], checkpoints: [], completeness: { status: status.pendingRequests || status.unresolvedActions || status.activeProviders || this.stopped ? 'truncated' : 'complete',
        missingResources: [], pendingRequests: status.pendingRequests, inFlightProviders: status.activeProviders, unresolvedActions: status.unresolvedActions },
      ...(this.parent ? { parent: structuredClone(this.parent) } : {}),
      capabilities: { playback: true, deterministicReplay: false, restore: false, branch: false } };
  }
}

/** All document/configuration compatibility gates precede host construction. */
export function createCharacterRunner(
  bundle: ResolvedBundle, registration: HostRegistration, connections: Readonly<Record<string, ModelConnection>>, runId: string,
): FormatResult<CharacterRunner> {
  return CharacterRunner.create(bundle, registration, connections, runId);
}

/** Deterministic simulated-host verification, with no provider calls or continuation. */
export function replayCheckpoint(checkpoint: RunnerCheckpoint, registration: HostRegistration) {
  if (!registration.descriptor.capabilities.deterministicReplay) throw new Error('Host does not advertise deterministic replay.');
  const connections: Record<string, ModelConnection> = Object.create(null);
  for (const effective of Object.values(checkpoint.launch.effectiveConfig)) connections[effective.modelSlot] = {
    public: structuredClone(effective.model), capabilities: { text: true, json: true },
    fulfill: async () => { throw new Error('Replay never calls a model.'); },
  };
  return CharacterRunner.restore(checkpoint, registration, connections).inspect();
}
