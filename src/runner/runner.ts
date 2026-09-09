import { continuityProfile, reviseTool, decisionReviseTool, reviseState, retainObservation, selectContinuityMemories, type StateEdit } from './continuity.js';
import { CharacterMemory, contextProfile, compactTool, recallTool, ContextCapacityError, type ContextSettings, type MemoryCutoff, type ConsolidationBatch } from './long-memory.js';
import { createSituationalMemoryPolicy, MemoryRetrievalFailure, type MemoryPolicy, type MemoryQuery } from './memory-policy.js';
import { MemoryRunnerStorage, ScopedRunnerStorage, type RunnerStorage } from './storage.js';
import { validateCheckpoint, ledgerFromEvents, type RunnerCheckpoint } from './checkpoint.js';
import { ModelRuntime, type ModelRequest, type ModelCompletion } from '../model-runtime.js';
import { compileDataSchema, validateRecord, validateTime, type ActionEvent, type ActionProposal,
  canonicalJson, type FormatResult, type JsonValue, type RunBundle, type RunEvent } from '../format/index.js';
import { readMappedCharacter, object, checkJsonValue } from '../format/character.js';
import { ActionLedger } from './actions.js';
import { ProviderFailure } from './provider-error.js';
import { memoryRetrievalProfile, prepareLaunch } from './launch.js';
import type { CharacterHost, DecisionContext, HostIntervention, HostRegistration, ModelConnection, PreparedLaunch, ProviderResult, ResolvedBundle } from './contracts.js';

interface Request extends ModelRequest {
  actor: string;
  primaryStarted?: boolean;
  context: DecisionContext;
  revision: number;
  deadline: number;
  opportunityDeadline?: number;
  startedAt?: number;
  controller: AbortController;
  finishedAt?: number;
  retrieving?: boolean;
  memory?: { base: DecisionContext; cutoff: MemoryCutoff; turn: number; calls: number; batch?: ConsolidationBatch; retrievalDone?: boolean; query?: MemoryQuery };
}

export interface RunnerOptions { storage?: RunnerStorage; recordTimings?: boolean; memoryPolicy?: MemoryPolicy | 'legacy' }

function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }

/** Optional scheduler: no host-world branches and no prescribed character strategy. */
export class CharacterRunner {
  private readonly host: CharacterHost;
  private readonly ledger: ActionLedger;
  private parent?: RunBundle['parent'];
  private readonly runtime: ModelRuntime<Request, ProviderResult>;
  private readonly pending = new Map<string, Request>();
  private readonly storage: RunnerStorage;
  private readonly memories = new Map<string, CharacterMemory>();
  private readonly memoryPolicy?: MemoryPolicy;
  private readonly contextFailures = new Map<string, string>();
  private get eventStream() { return `events:${this.launch.runId}`; }
  private get eventCount() { return this.storage.count(this.eventStream); }
  private readonly operatorObservationIds = new Map<string, string>();
  private readonly inputValidators = new Map<string, ReturnType<typeof compileDataSchema>>();
  private readonly outputValidators = new Map<string, ReturnType<typeof compileDataSchema>>();
  private decisionBudget?: Record<string, { opportunities: number; primaryRequests: number; completedDecisions: number; budgetExhaustions: number }>;
  private requestCount = 0;
  private requestSequence = 0;
  private steps = 0;
  private memoryTurnOffset = 0;
  private get memoryTurn() { return this.steps + this.memoryTurnOffset; }
  private activeProviders = 0;
  private paused = false;
  private stopped = false;
  private nextActor = 0;
  private wakeWait?: () => void;

  private constructor(
    private readonly launch: PreparedLaunch,
    private readonly registration: HostRegistration,
    private readonly connections: Readonly<Record<string, ModelConnection>>,
    checkpoint?: RunnerCheckpoint,
    private readonly options: RunnerOptions = {},
  ) {
    if (launch.config.limits.maxDecisionOpportunitiesPerActor !== undefined) this.decisionBudget = structuredClone(checkpoint?.scheduler.decisionBudget ?? Object.fromEntries(Object.keys(launch.states).map(actor => [actor, { opportunities: 0, primaryRequests: 0, completedDecisions: 0, budgetExhaustions: 0 }])));
    this.storage = options.storage ?? new MemoryRunnerStorage();
    const selectedPolicy = options.memoryPolicy === 'legacy' || checkpoint && !checkpoint.memoryPolicy && options.memoryPolicy === undefined
      ? undefined : options.memoryPolicy ?? createSituationalMemoryPolicy();
    if (selectedPolicy && (typeof selectedPolicy.identity?.id !== 'string' || typeof selectedPolicy.identity.version !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(selectedPolicy.identity.id) || !selectedPolicy.identity.version.length || selectedPolicy.identity.version.length > 128 || !object(selectedPolicy.identity.settings)
      || canonicalJson(selectedPolicy.identity).length > 4096)) throw new Error('Invalid memory policy identity.');
    if (checkpoint && canonicalJson(checkpoint.memoryPolicy ?? null) !== canonicalJson(selectedPolicy?.identity ?? null)) throw new Error('Checkpoint memory policy mismatch. Supply the original policy and adapters.');
    this.memoryPolicy = selectedPolicy ? { identity: structuredClone(selectedPolicy.identity), retrieve: selectedPolicy.retrieve.bind(selectedPolicy),
      consolidationInstruction: selectedPolicy.consolidationInstruction, shouldConsolidate: selectedPolicy.shouldConsolidate?.bind(selectedPolicy) } : undefined;
    const runtime = Object.values(launch.effectiveConfig).some(config => config.features[contextProfile.id]?.enabled) ? { storage: this.storage } : undefined;
    this.host = checkpoint ? registration.restore!(structuredClone(launch), structuredClone(checkpoint.hostState), runtime) : registration.create(structuredClone(launch), runtime);
    const ledgerStorage = new ScopedRunnerStorage(this.storage, `ledger:${launch.runId}:`);
    this.ledger = checkpoint?.version === 'simkind.checkpoint/1' ? ledgerFromEvents(launch.runId, registration.descriptor.clocks, checkpoint.events, ledgerStorage) : new ActionLedger(launch.runId, registration.descriptor.clocks, ledgerStorage);
    if (checkpoint) {
      for (const event of checkpoint.events) this.storage.append(this.eventStream, { id: event.id, turn: 0, text: '', value: event });
      for (const event of checkpoint.events) if (event.type === 'observation') {
        const observation = event.data as unknown as import('../format/index.js').Observation;
        if (!Object.hasOwn(launch.states, observation.recipient)) this.operatorObservationIds.set(observation.id, canonicalJson(observation));
      }
      this.memoryTurnOffset = checkpoint.scheduler.memoryTurnOffset ?? 0;
      this.steps = checkpoint.scheduler.steps; this.requestCount = checkpoint.scheduler.requests; this.requestSequence = checkpoint.scheduler.requestSequence;
      this.nextActor = checkpoint.scheduler.nextActor; this.paused = checkpoint.scheduler.paused;
      this.parent = structuredClone(checkpoint.parent);
    }
    for (const [actor, effective] of Object.entries(launch.effectiveConfig)) if (effective.features[contextProfile.id]?.enabled) {
      const memory = new CharacterMemory(this.storage, { ...contextProfile.defaults.config, ...effective.features[contextProfile.id].config } as ContextSettings, this.memoryPolicy);
      memory.initialise(launch.states[actor]); this.memories.set(actor, memory);
    }
    for (const tool of registration.descriptor.toolCatalog.tools) {
      this.validateInput(tool.inputSchema);
      if (tool.outputSchema !== undefined) this.outputValidators.set(tool.id, compileDataSchema(tool.outputSchema));
    }

    this.runtime = new ModelRuntime(async (request) => {
      this.activeProviders++;
      try {
        const slot = launch.effectiveConfig[request.actor].modelSlot;
        if (this.needsRetrieval(request)) await this.retrieveMemory(request);
        if (request.controller.signal.aborted || !this.pending.has(request.id)) throw new Error('Request expired.');
        // Providers get their own permitted context copy and no host/operator state.
        return await connections[slot].fulfill(structuredClone(request.context), request.controller.signal);
      } finally { request.finishedAt = Date.now(); this.activeProviders--; }
    }, launch.config.limits.maxInFlight);
    this.assertTime();
  }

  static create(bundle: ResolvedBundle, registration: HostRegistration, connections: Readonly<Record<string, ModelConnection>>, runId: string, options: RunnerOptions = {}): FormatResult<CharacterRunner> {
    const snapshot = { ...registration, descriptor: structuredClone(registration.descriptor) };
    const launch = prepareLaunch(bundle, snapshot, connections, runId);
    return launch.ok ? { ok: true, value: new CharacterRunner(launch.value, snapshot, { ...connections }, undefined, options) } : launch;
  }

  /** Exact compatible restore; supplying a new run ID creates a fresh continuation. */
  static restore(checkpoint: RunnerCheckpoint, registration: HostRegistration, connections: Readonly<Record<string, ModelConnection>>, branchRunId?: string, options: RunnerOptions = {}): CharacterRunner {
    validateCheckpoint(checkpoint);
    const descriptor = registration.descriptor;
    if (!descriptor.capabilities.restore || !registration.restore || branchRunId && !descriptor.capabilities.branch) throw new Error('Host does not support this restore mode.');
    if (canonicalJson(checkpoint.host) !== canonicalJson({ contractId: descriptor.contractId, version: descriptor.version, implementationVersion: descriptor.implementationVersion })) throw new Error('Checkpoint host version mismatch.');
    const launch = prepareLaunch(checkpoint.launch.bundle, registration, connections, branchRunId ?? checkpoint.launch.runId);
    if (!launch.ok) throw new Error(JSON.stringify(launch.diagnostics));
    if (checkpoint.modelCapabilities) for (const [slot, capabilities] of Object.entries(checkpoint.modelCapabilities)) {
      if (canonicalJson(connections[slot]?.capabilities) !== canonicalJson(capabilities)) throw new Error('Checkpoint model capabilities mismatch.');
    }
    if (canonicalJson(launch.value.effectiveConfig) !== canonicalJson(checkpoint.launch.effectiveConfig)
      || canonicalJson(launch.value.scenario) !== canonicalJson(checkpoint.launch.scenario)
      || canonicalJson(launch.value.config) !== canonicalJson(checkpoint.launch.config)
      || canonicalJson(launch.value.characters) !== canonicalJson(checkpoint.launch.characters)) throw new Error('Checkpoint launch configuration mismatch.');
    if (checkpoint.version === 'simkind.checkpoint/1') ledgerFromEvents(checkpoint.launch.runId, descriptor.clocks, checkpoint.events);
    else {
      const storage = options.storage;
      if (!storage || canonicalJson(storage.get('checkpoints', checkpoint.id)) !== canonicalJson(checkpoint)
        || storage.count(`events:${checkpoint.launch.runId}`) !== checkpoint.archive!.eventCount) throw new Error('Supply the exact frozen checkpoint archive.');
      for (const [actor, expected] of Object.entries(checkpoint.archive!.actors)) {
        if (storage.count(`evidence:${actor}`) !== expected.evidence || storage.count(`episodes:${actor}`) !== expected.episodes
          || storage.get<{ version: number }>('memory-head', actor)?.version !== expected.version) throw new Error('Checkpoint memory archive mismatch.');
      }
    }
    const copy = structuredClone(checkpoint);
    launch.value.states = structuredClone(checkpoint.launch.states);
    if (canonicalJson(Object.keys(launch.value.states).sort()) !== canonicalJson(launch.value.scenario.cast.map(m => m.instanceId).sort())) throw new Error('Checkpoint cast mismatch.');
    for (const [actor, state] of Object.entries(launch.value.states)) {
      if (state.definitionHash !== launch.value.bundle.artifacts.find(a => a.documentId === launch.value.characters[actor].id)?.sha256) throw new Error('Checkpoint definition hash mismatch.');
    }
    if (branchRunId) {
      if (branchRunId === checkpoint.launch.runId) throw new Error('A branch requires a new run ID.');
      copy.events = [];
      copy.scheduler.memoryTurnOffset = (checkpoint.scheduler.memoryTurnOffset ?? 0) + checkpoint.scheduler.steps;
      if (copy.scheduler.decisionBudget) for (const counts of Object.values(copy.scheduler.decisionBudget)) { counts.opportunities = 0; counts.primaryRequests = 0; counts.completedDecisions = 0; counts.budgetExhaustions = 0; }
      copy.scheduler.steps = 0; copy.scheduler.requests = 0; copy.scheduler.paused = true;
      copy.parent = { runId: checkpoint.launch.runId, checkpointId: checkpoint.id, interventionRefs: [] };
      // An explicit branch may compare a different strategy; exact restore never silently changes it.
      if (options.memoryPolicy !== undefined) {
        if (options.memoryPolicy === 'legacy') delete copy.memoryPolicy;
        else copy.memoryPolicy = structuredClone(options.memoryPolicy.identity);
      }
    }
    copy.launch = launch.value;
    return new CharacterRunner(launch.value, { ...registration, descriptor: structuredClone(descriptor) }, { ...connections }, copy, options);
  }

  checkpoint(id?: string): RunnerCheckpoint {
    this.poll();
    this.recordOperatorObservations();
    if (!this.registration.descriptor.capabilities.restore || !this.registration.restore || !this.host.checkpoint) throw new Error('Host does not support checkpoints.');
    if (this.stopped || this.pending.size || this.activeProviders || this.ledger.unresolved().length) throw new Error('Checkpoint requires a settled, non-stopped boundary.');
    if (id === undefined) {
      if (this.memories.size) {
        const sequence = (this.storage.get<number>('runner', 'checkpoint-sequence') ?? 0) + 1;
        this.storage.set('runner', 'checkpoint-sequence', sequence);
        id = `checkpoint:${this.eventCount}:${sequence}`;
      } else id = `checkpoint:${this.eventCount}`;
    } else if (this.memories.size && this.storage.get('checkpoints', id)) throw new Error('Checkpoint IDs are immutable; choose a new ID.');
    const checkpoint: RunnerCheckpoint = { version: this.memories.size ? 'simkind.checkpoint/2' : 'simkind.checkpoint/1', id, host: this.manifest().host,
      launch: structuredClone(this.launch), hostState: structuredClone(this.host.checkpoint()), events: this.memories.size ? [] : this.events(),
      ...(this.memories.size ? { archive: { eventCount: this.eventCount, ...(this.storage.revision ? { revision: this.storage.revision() } : {}), actors: Object.fromEntries([...this.memories].map(([actor, manager]) => { const cutoff = manager.cutoff(actor); return [actor, { evidence: cutoff.evidence, episodes: cutoff.episodes, version: cutoff.head.version }]; })) } } : {}),
      ...(this.memories.size || Object.values(this.connections).some(connection => connection.capabilities.responseMode) ? { modelCapabilities: Object.fromEntries(Object.entries(this.connections).map(([slot, connection]) => [slot, { text: connection.capabilities.text, json: connection.capabilities.json, ...(connection.capabilities.responseMode ? { responseMode: connection.capabilities.responseMode } : {}), ...(connection.capabilities.jsonSchema !== undefined ? { jsonSchema: connection.capabilities.jsonSchema } : {}) }])) } : {}),
      scheduler: { ...(this.decisionBudget ? { decisionBudget: structuredClone(this.decisionBudget) } : {}), steps: this.steps, requests: this.requestCount, requestSequence: this.requestSequence, nextActor: this.nextActor, paused: this.paused, ...(this.memories.size ? { memoryTurnOffset: this.memoryTurnOffset } : {}) },
      ...(this.memoryPolicy && this.memories.size ? { memoryPolicy: structuredClone(this.memoryPolicy.identity) } : {}),
      ...(this.parent ? { parent: structuredClone(this.parent) } : {}) };
    validateCheckpoint(checkpoint);
    if (this.memories.size) { this.storage.set('checkpoints', id, checkpoint); this.storage.set('runner', 'latestCheckpoint', id); }
    return checkpoint;
  }

  /** Operator edit to character state, distinct from a host-defined world intervention. */
  intervene(actor: string, edit: StateEdit, operator: string): void {
    if (!operator.trim() || !Object.hasOwn(this.launch.states, actor)) throw new Error('Name an operator and an existing character.');
    if (this.stopped || this.pending.size || this.activeProviders || this.ledger.unresolved().length) throw new Error('Intervention requires a settled boundary.');
    const id = `intervention:${this.eventCount}`;
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
    this.recordOperatorObservations();
    if (this.parent) this.parent.interventionRefs.push(proposal.id);
    const outcome = this.ledger.get(proposal.id)!;
    if (outcome.status === 'rejected') throw new Error('World intervention rejected; inspect the recorded reason.');
    if (outcome.status !== 'succeeded') throw new Error('Host intervention must finish atomically.');
  }

  private applyStateEdit(proposal: ActionProposal, edit: StateEdit, visible?: string[], operator?: string): boolean {
    let next;
    const manager = this.memories.get(proposal.actor);
    const state = this.launch.states[proposal.actor];
    const supplied = manager ? { ...state, context: { ...state.context, memories: manager.evidenceById(proposal.actor, visible ?? [...(edit.evidence ?? []), ...(edit.supersedes ?? [])]) } } : state;
    try { next = reviseState(supplied, edit, this.launch.runId, `interpretation:${this.eventCount}`, visible); }
    catch (error) {
      this.receive([{ id: `state-rejected:${this.eventCount}`, runId: this.launch.runId, actor: proposal.actor, actionId: proposal.id,
        status: 'rejected', revision: this.host.revision(), time: this.host.time(), effectRefs: [], reason: (error as Error).message }]);
      return false;
    }
    const interpretation = manager && next.context.memories?.find(memory => memory.id === `interpretation:${this.eventCount}`);
    if (manager) {
      if (interpretation) manager.retain(proposal.actor, this.memoryTurn, interpretation);
      next.context.memories = [];
    }
    this.receive([{ id: `state-accepted:${this.eventCount}`, runId: this.launch.runId, actor: proposal.actor, actionId: proposal.id,
      status: 'accepted', revision: this.host.revision(), time: this.host.time(), effectRefs: [] }, { id: `state-applied:${this.eventCount}`, runId: this.launch.runId, actor: proposal.actor, actionId: proposal.id,
      status: 'succeeded', revision: this.host.revision(), time: this.host.time(), effectRefs: [],
      result: json({ ...(manager ? { revision: next.revision, intentions: next.context.intentions, interpretation } : { state: next }), authority: operator ? 'operator' : 'character-self-report', ...(operator ? { operator } : {}) }) }]);
    this.launch.states[proposal.actor] = next;
    return true;
  }

  private assertTime(): void {
    if (validateTime(this.host.time(), this.registration.descriptor.clocks).length || !Number.isSafeInteger(this.host.revision()) || this.host.revision() < 0) throw new Error('Host returned an invalid clock or revision.');
  }

  private record(type: RunEvent['type'], data: unknown, retain = true): void {
    this.assertTime();
    const sequence = this.eventCount;
    const event: RunEvent = { id: `event:${sequence}`, runId: this.launch.runId, sequence, time: structuredClone(this.host.time()), type, data: json(data) };
    this.storage.append(this.eventStream, { id: event.id, turn: this.memoryTurn, text: '', value: event });
    if (type === 'request') this.storage.set(`request-index:${this.launch.runId}`, String((event.data as { context: { requestId: string } }).context.requestId), sequence);
    if (type === 'proposal') this.storage.set(`proposal-index:${this.launch.runId}`, String((event.data as { id: string }).id), sequence);
    if (type === 'observation' || type === 'proposal' || type === 'action') {
      const payload = event.data as Record<string, JsonValue>;
      const actor = String(type === 'observation' ? payload.recipient : payload.actor), memory = this.memories.get(actor);
      if (memory) {
        if (type === 'observation') {
          const key = `${this.launch.runId}:${String(payload.id)}`;
          const prior = this.storage.get<string>(`observed:${actor}`, key), content = canonicalJson(payload);
          if (prior !== undefined) { if (prior !== content) throw new Error('Conflicting observation redelivery.'); return; }
          this.storage.set(`observed:${actor}`, key, content);
          this.launch.states[actor].revision++;
        }
        if (!retain) return;
        let id = `experience:${this.storage.count(`evidence:${actor}`)}`;
        while (this.storage.entry(`evidence:${actor}`, id)) id += ':next';
        memory.retain(actor, this.memoryTurn, { id, text: canonicalJson({ type, ...payload, ...(type === 'action' ? { action: this.ledger.get(String(payload.actionId), false)?.proposal } : {}) }),
          source: { kind: type === 'observation' ? 'observation' : 'report', origin: this.launch.runId },
          eventRefs: [{ id: String(payload.id), origin: this.launch.runId, resolution: 'recorded' }] });
      }
    }
  }

  private recordOperatorObservations(): void {
    for (const observation of this.host.operatorObservations?.() ?? []) {
      if (validateRecord('Observation', observation).length || observation.runId !== this.launch.runId || Object.hasOwn(this.launch.states, observation.recipient)
        || validateTime(observation.capturedAt, this.registration.descriptor.clocks).length || validateTime(observation.deliveredAt, this.registration.descriptor.clocks).length) throw new Error('Invalid operator-only observation.');
      const content = canonicalJson(observation);
      const previous = this.operatorObservationIds.get(observation.id);
      if (previous !== undefined) { if (previous !== content) throw new Error('Conflicting operator observation.'); continue; }
      this.operatorObservationIds.set(observation.id, content); this.record('observation', observation);
    }
  }

  private receive(events: readonly ActionEvent[]): void {
    for (const event of events) {
      const action = this.ledger.get(event.actionId, false);
      const tool = action && this.registration.descriptor.toolCatalog.tools.find((candidate) => candidate.id === action.proposal.toolId);
      if ((event.status === 'running' || event.status === 'unknown') && tool && !tool.lifecycle.asynchronous) throw new Error('Host emitted an asynchronous status for an immediate tool.');
      if (event.status === 'succeeded' && action && this.outputValidators.get(action.proposal.toolId)?.(event.result).length) throw new Error('Host result violates the tool output schema.');
    }
    for (const event of this.ledger.receive(events)) this.record('action', event);
  }

  private needsRetrieval(request: Request): boolean {
    return !!this.memories.get(request.actor)?.policy && !!request.memory && !request.memory.retrievalDone && request.context.purpose !== 'consolidation';
  }

  private recordRequest(request: Request): void {
    if (this.needsRetrieval(request)) return; // Record the actual model-facing context after asynchronous retrieval.
    this.record('request', { context: request.context, observedRevision: request.revision,
      ...(request.memory && (this.memoryPolicy || request.memory.calls > 0) ? { opportunityTurn: request.memory.turn } : {}),
      ...(this.options.recordTimings ? { deadline: request.deadline, opportunityDeadline: request.opportunityDeadline } : {}),
      stage: request.context.purpose === 'consolidation' ? 'maintenance' : 'decision' });
  }

  private async retrieveMemory(request: Request): Promise<void> {
    const manager = this.memories.get(request.actor)!, memory = request.memory!;
    const decisionDeadline = request.deadline;
    request.retrieving = true;
    request.deadline = Math.min(decisionDeadline, Date.now() + (manager.settings.retrievalTimeoutMs ?? 10000));
    const started = Date.now();
    this.record('memory-retrieval', { requestId: request.id, actor: request.actor, phase: 'started', policy: manager.policy!.identity,
      cutoff: { evidence: memory.cutoff.evidence, episodes: memory.cutoff.episodes, version: memory.cutoff.head.version },
      explicit: !!memory.query });
    const result = await manager.retrieve(request.context, memory.turn, memory.cutoff, request.controller.signal, memory.query);
    // An adapter that ignored cancellation must not publish a late context or start a model call.
    if (request.controller.signal.aborted || !this.pending.has(request.id) || Date.now() >= request.deadline) throw new Error('Retrieval expired.');
    const context = manager.assemble(memory.base, memory.turn, memory.cutoff, result.memories, c => this.bindTools(c));
    context.requestId = request.id;
    if (request.context.purpose) context.purpose = request.context.purpose;
    if (request.context.feedback) context.feedback = request.context.feedback;
    if (JSON.stringify(context).length > manager.settings.maxContextChars) throw new ContextCapacityError();
    const selection = result.selection;
    const usage = Object.fromEntries(['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens', 'cost'].flatMap(key => {
      const n = selection.usage?.[key as keyof NonNullable<typeof selection.usage>];
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? [[key, n]] : [];
    }));
    this.record('memory-retrieval', { requestId: request.id, actor: request.actor, phase: 'completed', policy: manager.policy!.identity,
      mode: selection.mode, references: selection.references.map(ref => ({ kind: ref.kind, id: ref.id })),
      injectedIds: context.memories.map(m => m.id),
      queries: (selection.queries ?? []).filter(q => typeof q === 'string').slice(0, 12).map(q => q.slice(0, 4000)), usage,
      ...(typeof selection.indexComplete === 'boolean' ? { indexComplete: selection.indexComplete } : {}),
      ...Object.fromEntries(['embeddingCalls', 'indexed'].flatMap(key => { const n = selection[key as 'embeddingCalls' | 'indexed']; return Number.isSafeInteger(n) && n! >= 0 ? [[key, n]] : []; })),
      ...(this.options.recordTimings ? { durationMs: Date.now() - started } : {}) });
    request.context = context; memory.retrievalDone = true; request.retrieving = false; request.deadline = decisionDeadline; request.startedAt = Date.now();
    this.recordRequest(request);
  }

  private canSpend(primary: boolean): boolean {
    if (!this.decisionBudget) return this.requestCount < this.launch.config.limits.maxRequests;
    const reserved = Object.values(this.decisionBudget).reduce((sum, counts) => sum + this.launch.config.limits.maxDecisionOpportunitiesPerActor! - counts.primaryRequests, 0);
    return this.launch.config.limits.maxRequests - this.requestCount > reserved - (primary ? 1 : 0);
  }

  private continueRequest(request: Request, context: DecisionContext, memory: NonNullable<Request['memory']>): void {
    const manager = this.memories.get(request.actor)!;
    this.bindTools(context);
    if (JSON.stringify(context).length > manager.settings.maxContextChars) { this.contextFailures.set(request.actor, 'Protected character context exceeds its configured capacity.'); return; }
    const deadline = request.context.purpose === 'consolidation' && context.purpose !== 'consolidation' && (manager.settings.maintenanceTimeoutMs ?? 0) > 0
      ? Math.min(request.opportunityDeadline!, Date.now() + this.launch.config.limits.requestTimeoutMs) : request.deadline;
    const primary = !request.primaryStarted && context.purpose !== 'consolidation';
    if (memory.calls >= manager.settings.maxInternalCalls || !this.canSpend(primary)
      || Date.now() >= deadline) {
      if (this.decisionBudget) this.decisionBudget[request.actor].budgetExhaustions++;
      else this.contextFailures.set(request.actor, 'Internal call or opportunity budget exhausted.');
      return;
    }
    const id = `request:${++this.requestSequence}`;
    context.requestId = id;
    this.requestCount++;
    if (primary && this.decisionBudget) this.decisionBudget[request.actor].primaryRequests++;
    const next: Request = { ...request, primaryStarted: request.primaryStarted || primary, id, context, deadline, startedAt: Date.now(), finishedAt: undefined, retrieving: false, memory: { ...memory, calls: memory.calls + 1 }, controller: new AbortController() };
    this.pending.set(id, next);
    this.recordRequest(next);
  }

  private expireRequest(request: Request): void {
    if (request.retrieving) {
      this.record('memory-retrieval', { requestId: request.id, actor: request.actor, phase: 'timeout' });
      this.contextFailures.set(request.actor, 'Memory retrieval exceeded its opportunity allowance.');
    } else this.record('model-timeout', { ...this.requestEvidence(request) });
  }

  private requestEvidence(request: Request) {
    return { requestId: request.id, actor: request.actor, stage: request.context.purpose === 'consolidation' ? 'maintenance' : 'decision',
      ...(this.options.recordTimings ? { durationMs: Math.max(0, (request.finishedAt ?? Date.now()) - (request.startedAt ?? Date.now())) } : {}) };
  }

  private retryOutput(request: Request, feedback: string): void {
    if (!request.memory) return;
    this.continueRequest(request, { ...request.context, feedback }, request.memory);
  }

  private complete(completion: ModelCompletion<Request, ProviderResult>): void {
    const request = this.pending.get(completion.request.id);
    if (!request || this.stopped) return; // expired/reset results never reach the host
    this.pending.delete(request.id);
    if ((request.finishedAt ?? Date.now()) > request.deadline) {
      request.controller.abort();
      this.expireRequest(request);
      return;
    }
    if (completion.status === 'rejected') {
      if (request.retrieving) {
        const failure = completion.error instanceof MemoryRetrievalFailure ? completion.error : undefined;
        const usage = Object.fromEntries(Object.entries(failure?.usage ?? {}).filter(([key, n]) => ['inputTokens', 'outputTokens', 'cost'].includes(key) && typeof n === 'number' && Number.isFinite(n) && n >= 0));
        this.record('memory-retrieval', { requestId: request.id, actor: request.actor, phase: 'failed', code: 'MEMORY_RETRIEVAL_FAILED', usage, ...(failure ? { embeddingCalls: failure.embeddingCalls } : {}),
          ...(failure?.diagnostic ? { diagnostic: new ProviderFailure(failure.diagnostic.reason, failure.diagnostic).diagnostic } : {}) });
        this.contextFailures.set(request.actor, 'Memory retrieval failed; no world action was submitted.');
        return;
      }
      // Provider error text can contain request headers or credentials. Never record it.
      const diagnostic = completion.error instanceof ProviderFailure
        ? new ProviderFailure(completion.error.diagnostic.reason, completion.error.diagnostic).diagnostic : undefined;
      const usage = diagnostic && { inputTokens: diagnostic.inputTokens, outputTokens: diagnostic.outputTokens, cachedInputTokens: diagnostic.cachedInputTokens, reasoningTokens: diagnostic.reasoningTokens, cost: diagnostic.cost };
      this.record('model-error', { ...this.requestEvidence(request), code: 'PROVIDER_ERROR',
        ...(diagnostic ? { diagnostic, usage } : {}) });
      return;
    }
    const response = completion.input;
    if (!object(response)) {
      this.record('model-error', { ...this.requestEvidence(request), code: 'INVALID_OUTPUT' });
      return;
    }
    const rawOutput = request.memory && typeof response.output === 'string' ? { rawOutput: response.output } : {};
    let output: unknown = response.output;
    let normalization: 'code-fence' | undefined;
    if (typeof output === 'string') {
      let parsed = readMappedCharacter(output);
      // Some JSON-mode providers append a closing Markdown fence (occasionally
      // only two backticks). Remove presentation only; never repair JSON itself.
      if (!parsed.ok) {
        const unfenced = output.replace(/^\s*```(?:json)?[ \t]*\r?\n/, '').replace(/\r?\n`{2,3}\s*$/, '');
        if (unfenced !== output) {
          parsed = readMappedCharacter(unfenced);
          if (parsed.ok) normalization = 'code-fence';
        }
      }
      output = parsed.ok ? parsed.value : undefined;
    }
    try { checkJsonValue(output); }
    catch { output = undefined; }
    const usage = response.usage;
    const telemetry = Object.fromEntries(Object.entries(response.telemetry ?? {}).filter(([key, value]) => ['provider', 'generationId', 'finishReason'].includes(key) && typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,127}$/.test(value)));
    const safeUsage = Object.fromEntries(['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens', 'cost'].flatMap((key) => {
      const amount = usage?.[key as keyof typeof usage];
      return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? [[key, amount]] : [];
    }));
    if (!object(output) || Object.keys(output).some((key) => key !== 'toolId' && key !== 'arguments')
      || !(typeof output.toolId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(output.toolId) || output.toolId === null) || !object(output.arguments)
      || output.toolId === null && Object.keys(output.arguments).length > 0) {
      this.record('model-error', { ...this.requestEvidence(request), code: 'INVALID_OUTPUT', usage: safeUsage, telemetry, ...rawOutput });
      this.retryOutput(request, 'The previous response was not exactly one JSON decision. Return one object with toolId and arguments only, matching an available tool schema.');
      return;
    }
    if (request.memory && (request.context.purpose === 'consolidation' || output.toolId === recallTool.id)) {
      const manager = this.memories.get(request.actor)!, memory = request.memory;
      let context: DecisionContext;
      let committed = false;
      try {
        if (request.context.purpose === 'consolidation') {
          if (output.toolId !== compactTool.id || !memory.batch) throw new Error('Use the consolidation tool.');
          manager.commit(request.actor, memory.batch, output.arguments, this.launch.runId);
          committed = true;
          const next = manager.cutoff(request.actor);
          memory.cutoff = { ...next, evidence: memory.cutoff.evidence };
          context = this.prepareMemoryContext(manager, memory, memory.calls + 1 < manager.settings.maxInternalCalls && (this.decisionBudget ? this.canSpend(false) : this.requestCount + 1 < this.launch.config.limits.maxRequests));
        } else {
          if (manager.policy) {
            if (this.validateInput(recallTool.inputSchema)(output.arguments).length) throw new Error('Invalid recall query.');
            memory.query = structuredClone(output.arguments) as MemoryQuery; memory.retrievalDone = false;
          }
          const recalled = manager.policy ? [] : manager.recall(request.actor, memory.cutoff, output.arguments);
          context = manager.assemble(memory.base, memory.turn, memory.cutoff, recalled, context => this.bindTools(context));
          context.purpose = 'recall';
          context.feedback = manager.policy ? 'Inspect the retrieved memories and original evidence, search again if needed, or choose your action. Absence of a match is not proof that nothing happened.' : recalled.length ? 'Recall results are in memories. Read their sources or choose your world action.' : 'No matching accessible history was found. Try other words or a time range, or decide with uncertainty.';
        }
      } catch (error) {
        if (committed) this.record('model-result', { ...this.requestEvidence(request), output, usage: safeUsage, telemetry, purpose: 'consolidation', memoryVersion: memory.cutoff.head.version });
        else this.record('model-error', { ...this.requestEvidence(request), code: 'INVALID_MEMORY_OPERATION', usage: safeUsage, telemetry, output, ...rawOutput });
        if (error instanceof ContextCapacityError) this.contextFailures.set(request.actor, error.message);
        else this.retryOutput(request, 'Memory operation rejected: use only the supplied evidence IDs and tool schema, and respect the summary allowance.');
        return;
      }
      this.record('model-result', { ...this.requestEvidence(request), output, usage: safeUsage, telemetry, purpose: request.context.purpose ?? 'recall', memoryVersion: memory.cutoff.head.version });
      this.continueRequest(request, context, memory);
      return;
    }
    if (request.memory && output.toolId !== null) {
      const permitted = request.context.tools.find(tool => tool.id === output.toolId);
      const diagnostics = permitted ? this.validateInput(permitted.inputSchema)(output.arguments).slice(0, 3) : [];
      if (!permitted || diagnostics.length) {
        this.record('model-error', { ...this.requestEvidence(request), code: 'INVALID_TOOL_OUTPUT', diagnostics, usage: safeUsage, telemetry, output, ...rawOutput });
        const detail = permitted ? diagnostics.map(item => `/arguments${item.pointer}: ${item.message}`).join(' ') : '/toolId: Choose an available tool ID.';
        this.retryOutput(request, `No world action was submitted. ${detail.slice(0, 1000)} Correct these fields or choose another available action.`);
        return;
      }
    }
    if (this.decisionBudget) this.decisionBudget[request.actor].completedDecisions++;
    this.record('model-result', { ...this.requestEvidence(request), output, usage: safeUsage, telemetry, ...(normalization ? { normalization } : {}) });
    if (output.toolId === null) return; // Legal refusal/no action, without manufactured effects.
    const tool = request.context.tools.find((candidate) => candidate.id === output.toolId);
    const proposal: ActionProposal = { id: `action:${request.id}`, runId: this.launch.runId, actor: request.actor,
      requestId: request.id, toolId: output.toolId, toolVersion: tool?.version ?? 'unknown', observedRevision: request.revision, arguments: json(output.toolId === reviseTool.id ? { ...output.arguments, expectedRevision: request.context.stateRevision } : output.arguments) as ActionProposal['arguments'] };
    this.ledger.propose(proposal);
    this.record('proposal', proposal);
    const invalid = !tool || this.validateInput(tool.inputSchema)(output.arguments).length > 0;
    if (!invalid && proposal.toolId === reviseTool.id) {
      this.applyStateEdit(proposal, proposal.arguments as unknown as StateEdit, [...request.context.memories, ...(request.context.recent ?? [])].map(m => m.id));
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
    for (const completion of this.runtime.poll([...this.pending.values()])) this.complete(completion);
    const now = Date.now();
    for (const request of this.pending.values()) {
      if (now >= request.deadline) {
        request.controller.abort();
        this.pending.delete(request.id);
        this.expireRequest(request);
      }
    }
    this.receive(this.host.drainEvents());
  }

  /** One host-defined opportunity boundary. Provider work remains asynchronous. */
  step(): void {
    if (this.stopped) return;
    this.poll();
    if (this.steps >= this.launch.config.limits.maxSteps) return;
    if (this.host.isComplete?.()) return;
    this.host.advance();
    this.steps++;
    this.receive(this.host.drainEvents());
    const perspectives = new Map<string, DecisionContext['observations']>();
    const perceptions = new Map<string, NonNullable<DecisionContext['perception']>>();
    // Observation delivery continues while actions are unresolved or dispatch is paused.
    for (const actor of Object.keys(this.launch.states)) {
      const perception = this.host.perceive?.(actor);
      const observations = perception ? [...perception.current, ...perception.events] : this.host.observe(actor);
      const snapshots = new Set(perception?.current.map(o => o.id));
      if (perception) {
        if (new Set(observations.map(o => o.id)).size !== observations.length) throw new Error('Perception state and events must have distinct IDs.');
        perceptions.set(actor, { currentStateIds: [...snapshots], eventIds: perception.events.map(o => o.id) });
      }
      for (const observation of observations) {
        if (validateRecord('Observation', observation).length || observation.recipient !== actor || observation.runId !== this.launch.runId
          || validateTime(observation.capturedAt, this.registration.descriptor.clocks).length
          || validateTime(observation.deliveredAt, this.registration.descriptor.clocks).length) throw new Error('Host observation violates the recipient, clock, or schema contract.');
        this.record('observation', observation, !snapshots.has(observation.id));
        if (!snapshots.has(observation.id) && this.launch.effectiveConfig[actor].features[continuityProfile.id]?.enabled) if (!this.memories.has(actor)) retainObservation(this.launch.states[actor], observation);
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
      if (this.decisionBudget && this.decisionBudget[actor].opportunities >= limits.maxDecisionOpportunitiesPerActor!) continue;
      const effective = this.launch.effectiveConfig[actor];
      const observations = perspectives.get(actor)!;
      const available = this.host.availableTools(actor);
      const tools = this.registration.descriptor.toolCatalog.tools.filter((tool) => effective.allowedTools.includes(tool.id) && available.includes(tool.id));
      const constraints = this.host.toolConstraints?.(actor) ?? {};
      for (let index = 0; index < tools.length; index++) {
        const tool = tools[index], constraint = constraints[tool.id];
        if (constraint) {
          this.validateInput(constraint); // Fail before provider dispatch on a malformed host schema.
          tools[index] = { ...tool, inputSchema: { allOf: [tool.inputSchema, structuredClone(constraint)] } };
        }
      }
      const continuity = effective.features[continuityProfile.id]?.enabled;
      if (continuity) tools.push(structuredClone(reviseTool));
      const id = `request:${++this.requestSequence}`;
      this.nextActor = (actors.indexOf(actor) + 1) % actors.length;
      const feature = effective.features[memoryRetrievalProfile.id];
      const stored = this.launch.states[actor].context.memories ?? [];
      const memories = feature?.enabled ? continuity ? selectContinuityMemories(stored, Number(feature.config?.maxItems))
        : [...stored].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, Number(feature.config?.maxItems)) : [];
      const character = this.launch.characters[actor];
      let context: DecisionContext = { runId: this.launch.runId, requestId: id, instanceId: actor,
        character: { name: character.name, ...(character.persona ? { persona: structuredClone(character.persona) } : {}) },
        stateRevision: this.launch.states[actor].revision,
        intentions: structuredClone(this.launch.states[actor].context.intentions ?? []), memories: structuredClone(memories),
        observations: structuredClone(observations), ...(perceptions.has(actor) ? { perception: perceptions.get(actor) } : {}), tools: structuredClone(tools), outcomes: this.memories.has(actor) ? [] : this.ledger.eventsFor(actor), model: structuredClone(effective.model) };
      let memoryState: Request['memory'];
      const manager = this.memories.get(actor);
      if (manager) {
        const cutoff = manager.cutoff(actor), base = structuredClone(context);
        memoryState = { base, cutoff, turn: this.memoryTurn, calls: 0 };
        try {
          context = this.prepareMemoryContext(manager, memoryState, this.decisionBudget ? this.canSpend(false) : this.requestCount + 1 < limits.maxRequests);
          this.contextFailures.delete(actor);
        } catch (error) {
          if (!(error instanceof ContextCapacityError)) throw error;
          this.contextFailures.set(actor, error.message); continue;
        }
      }
      this.bindTools(context);
      if (manager && JSON.stringify(context).length > manager.settings.maxContextChars) { this.contextFailures.set(actor, 'Protected character context exceeds its configured capacity.'); continue; }
      const primary = context.purpose !== 'consolidation';
      if (!this.canSpend(primary)) continue;
      if (this.decisionBudget) { this.decisionBudget[actor].opportunities++; if (primary) this.decisionBudget[actor].primaryRequests++; }
      this.requestCount++;
      const startedAt = Date.now();
      const maintenanceMs = context.purpose === 'consolidation' ? manager?.settings.maintenanceTimeoutMs ?? 0 : 0;
      const request: Request = { id, actor, primaryStarted: primary, context, memory: memoryState, startedAt, opportunityDeadline: startedAt + maintenanceMs + limits.requestTimeoutMs, revision: this.host.revision(), issuedAtTick: this.steps,
        priority: 0, deadline: startedAt + (maintenanceMs || limits.requestTimeoutMs), controller: new AbortController() };
      this.pending.set(id, request);
      this.recordRequest(request);
      for (const completion of this.runtime.poll([request])) this.complete(completion);
    }
  }

  private prepareMemoryContext(manager: CharacterMemory, memory: NonNullable<Request['memory']>, canConsolidate: boolean): DecisionContext {
    const { base, turn, cutoff } = memory;
    memory.batch = canConsolidate ? manager.batch(base.instanceId, turn, cutoff) : undefined;
    memory.retrievalDone = false; memory.query = undefined;
    const assemble = () => {
      const context = memory.batch ? manager.consolidationContext(base, memory.batch, cutoff)
        : manager.assemble(base, turn, cutoff, undefined, context => this.bindTools(context));
      this.bindTools(context);
      if (JSON.stringify(context).length > manager.settings.maxContextChars) throw new ContextCapacityError();
      return context;
    };
    try { return assemble(); }
    catch (error) {
      if (!(error instanceof ContextCapacityError) || memory.batch || !canConsolidate) throw error;
      // Under byte pressure, do not wait for a full routine batch. Recent turns,
      // original evidence, and the existing internal-call/deadline limits stay intact.
      memory.batch = manager.batch(base.instanceId, turn, cutoff, true);
      if (!memory.batch) throw error;
      return assemble();
    }
  }

  private validateInput(schema: object | boolean): ReturnType<typeof compileDataSchema> {
    const key = canonicalJson(schema);
    let validate = this.inputValidators.get(key);
    if (!validate) {
      validate = compileDataSchema(schema);
      if (this.inputValidators.size >= 128) this.inputValidators.delete(this.inputValidators.keys().next().value!);
      this.inputValidators.set(key, validate);
    }
    return validate;
  }

  private bindTools(context: DecisionContext): void {
    const ids = [...context.memories, ...(context.recent ?? [])].map(m => m.id);
    context.tools = context.tools.map(tool => tool.id === reviseTool.id ? decisionReviseTool(context.stateRevision, ids) : tool);
    if (context.contextSize) { context.contextSize.sections.tools = JSON.stringify(context.tools).length; context.contextSize.characters = JSON.stringify({ ...context, contextSize: undefined }).length; }
  }

  /** Waits only to local request deadlines; abort-ignoring provider work retains concurrency. */
  async settleDecisions(): Promise<void> {
    while (this.pending.size) {
      this.poll();
      if (!this.pending.size) break;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = new AbortController();
      try {
        const deadline = Math.min(...[...this.pending.values()].map((request) => request.deadline));
        await Promise.race([this.runtime.nextCompletion(wait.signal), new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now())); }),
          new Promise<void>((resolve) => { this.wakeWait = resolve; })]);
      } finally { if (timer) clearTimeout(timer); wait.abort(); this.wakeWait = undefined; }
      this.poll();
    }
    this.poll();
    this.recordOperatorObservations();
  }

  /** Bounded cancellation cleanup. Never frees slots occupied by abort-ignoring work. */
  async drainProviders(timeoutMs = 1000): Promise<boolean> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 60000) throw new Error('Cleanup timeout must be between 0 and 60000ms.');
    const until = Date.now() + timeoutMs;
    while (this.activeProviders && Date.now() < until) {
      this.poll();
      const wait = new AbortController();
      const timer = setTimeout(() => wait.abort(), Math.max(0, until - Date.now()));
      try { await this.runtime.nextCompletion(wait.signal); }
      finally { clearTimeout(timer); wait.abort(); }
    }
    this.poll();
    return this.activeProviders === 0;
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
    this.recordOperatorObservations();
    this.record('stopped', { pendingRequests, unresolvedActions: this.ledger.unresolved().length });
  }
  events(afterSequence = 0, limit = this.eventCount): RunEvent[] {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error('Invalid event cursor.');
    return this.storage.read<RunEvent>(this.eventStream, { after: afterSequence - 1, limit }).map(row => row.value);
  }
  launchSnapshot(): PreparedLaunch { return structuredClone(this.launch); }
  inspect(): { host: JsonValue; launch: PreparedLaunch; status: ReturnType<CharacterRunner['status']> } {
    return { host: structuredClone(this.host.inspect()), launch: this.launchSnapshot(), status: this.status() };
  }
  hostCapabilities() { return structuredClone(this.registration.descriptor.capabilities); }
  status() { return { ...(this.decisionBudget ? { decisionBudget: structuredClone(this.decisionBudget), opportunityLimitReached: Object.values(this.decisionBudget).every(counts => counts.opportunities >= this.launch.config.limits.maxDecisionOpportunitiesPerActor!) } : {}), completed: this.host.isComplete?.() ?? false, steps: this.steps, requests: this.requestCount, pendingRequests: this.pending.size,
    activeProviders: this.activeProviders, unresolvedActions: this.ledger.unresolved().length, paused: this.paused, stopped: this.stopped, ...(this.memories.size ? { contextFailures: Object.fromEntries(this.contextFailures), memory: Object.fromEntries([...this.memories].map(([actor, manager]) => [actor, manager.cutoff(actor)])) } : {}) }; }
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
  bundle: ResolvedBundle, registration: HostRegistration, connections: Readonly<Record<string, ModelConnection>>, runId: string, options: RunnerOptions = {},
): FormatResult<CharacterRunner> {
  return CharacterRunner.create(bundle, registration, connections, runId, options);
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
