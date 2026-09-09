import { executeHostInputs } from 'simkind';
import { ActionLedger, PerceptionJournal, ScopedRunnerStorage, type RunnerStorage, type PerceivedEvent, type HostPerception, type CharacterHost, type HostDescriptor, type InterventionPreview, type PreparedLaunch } from 'simkind/runner';
import { canonicalJson, compileDataSchema, validateRecord, type ActionEvent, type ActionProposal, type JsonValue, type Observation } from 'simkind/format';

type DeliveredMessage = { from: string; to?: string | null; recipients?: string[]; text: string }

export type WorldEdit<World> = { world: World; effects: JsonValue } | { reason: string };

/** Shared local-host mechanics. Domain constraints and state remain in each host. */
export abstract class LocalHost<World> implements CharacterHost {
  protected tick = 0;
  protected version = 0;
  protected readonly ledger: ActionLedger;
  private eventCount = 0;
  private operations: ({ type: 'advance' } | { type: 'submit' | 'intervene'; proposal: ActionProposal } | { type: 'cancel'; actionId: string })[] = [];
  private readonly queue: ActionEvent[] = [];
  protected readonly actors: string[];
  protected readonly perceptions: PerceptionJournal;
  readonly perceive?: (actor: string) => HostPerception;

  constructor(protected readonly launch: PreparedLaunch, protected readonly descriptor: HostDescriptor, protected world: World, protected readonly storage?: RunnerStorage, protected readonly eventPerception = false) {
    this.actors = launch.scenario.cast.map((member) => member.instanceId);
    this.perceptions = new PerceptionJournal(this.actors, descriptor.contractId, storage);
    if (eventPerception) this.perceive = actor => {
      this.publishEvents();
      return { current: this.observe(actor), events: this.perceptions.drain(actor, this.launch.runId, this.time(), this.version) };
    };
    this.ledger = new ActionLedger(launch.runId, descriptor.clocks, storage && new ScopedRunnerStorage(storage, 'host-ledger:'));
  }
  private recordOperation(operation: LocalHost<World>['operations'][number]) {
    if (this.storage) this.storage.append('host-operations', { id: String(this.storage.count('host-operations')), turn: this.tick, text: '', value: operation });
    else this.operations.push(operation);
  }
  time() { return { clockId: 'clock:simulation', value: this.tick }; }
  revision() { return this.version; }
  decisionActors() { return [...this.actors]; }
  availableTools(actor: string) { return this.actors.includes(actor) ? this.launch.effectiveConfig[actor].allowedTools : []; }
  inspect(): JsonValue { return JSON.parse(JSON.stringify({ tick: this.tick, revision: this.version, world: this.world })); }
  protected observation(actor: string, data: JsonValue): Observation[] {
    return [{ id: `observation:${this.tick}:${this.actors.indexOf(actor)}:${this.version}`, runId: this.launch.runId, recipient: actor,
      source: this.descriptor.contractId, capturedAt: this.time(), deliveredAt: this.time(), revision: this.version,
      content: [{ type: 'data', schemaId: this.descriptor.contractId, data }] }];
  }
  abstract observe(actor: string): Observation[];
  protected abstract validate(world: World, proposal: ActionProposal): string | undefined;
  protected abstract apply(world: World, proposal: ActionProposal): World;
  protected abstract result(proposal: ActionProposal): JsonValue;
  protected running(_proposal: ActionProposal): boolean { return false; }
  protected cancelRunning(_proposal: ActionProposal): boolean { return false; }
  protected advanceWorld(): void {}
  protected afterCommit(_proposal: ActionProposal): void {}
  protected publishEvents(): void {}
  protected publishEvent(event: Omit<PerceivedEvent, 'capturedAt'>, capturedAt = this.time()): void {
    if (this.eventPerception) this.perceptions.publish({ ...event, capturedAt });
  }
  protected retainMessage(message: DeliveredMessage, id?: string): void {
    if (this.eventPerception) {
      if (!id) throw new Error('Dialogue requires an occurrence ID.');
      this.publishEvent({ id, kind: 'dialogue', authority: 'statement', actor: message.from, text: message.text,
        recipients: message.recipients ?? this.actors.filter(actor => message.to === null || message.to === actor || message.from === actor) });
      return;
    }
    if (!this.storage) return;
    for (const actor of this.actors) if (message.recipients ? message.recipients.includes(actor) : message.to === null || message.to === actor || message.from === actor) {
      const stream = `host-delivery:${actor}`;
      this.storage.append(stream, { id: `message:${this.storage.count(stream)}`, turn: this.tick, text: '', value: message });
    }
  }
  protected newMessages(actor: string): DeliveredMessage[] {
    const stream = `host-delivery:${actor}`, after = this.storage!.get<number>('host-delivered', actor) ?? -1;
    const rows = this.storage!.read<DeliveredMessage>(stream, { after, limit: this.storage!.count(stream) - after - 1 });
    if (rows.length) this.storage!.set('host-delivered', actor, rows.at(-1)!.sequence);
    return rows.map(row => row.value);
  }
  /** Receives a disposable copy; rejected edits cannot mutate the live world. */
  protected editWorld(_world: World, _proposal: ActionProposal): WorldEdit<World> { return { reason: 'World interventions are not supported.' }; }

  private planIntervention(proposal: ActionProposal): WorldEdit<World> {
    const operation = this.descriptor.interventions?.find(op => op.id === proposal.toolId && op.version === proposal.toolVersion);
    if (validateRecord('ActionProposal', proposal).length || proposal.runId !== this.launch.runId || this.actors.includes(proposal.actor)) return { reason: 'Invalid operator intervention.' };
    if (!operation || compileDataSchema(operation.inputSchema)(proposal.arguments).length) return { reason: 'Operation or arguments are not permitted.' };
    if (this.queue.length || this.ledger.unresolved().some(action => action.proposal.id !== proposal.id)) return { reason: 'World intervention requires settled actions.' };
    if (proposal.observedRevision !== this.version) return { reason: 'Stale host revision. Preview the current world again.' };
    return this.editWorld(structuredClone(this.world), structuredClone(proposal));
  }

  previewIntervention(proposal: ActionProposal): InterventionPreview {
    const plan = this.planIntervention(proposal);
    return { valid: !('reason' in plan), revision: this.version, expectedRevision: proposal.observedRevision,
      ...('reason' in plan ? { reason: plan.reason } : { effects: structuredClone(plan.effects) }) };
  }

  intervene(proposal: ActionProposal): ActionEvent[] {
    if (!this.descriptor.interventions?.length) throw new Error('World interventions are not supported.');
    if (this.ledger.propose(proposal) === 'duplicate') return [];
    this.recordOperation({ type: 'intervene', proposal: structuredClone(proposal) });
    const plan = this.planIntervention(proposal);
    if ('reason' in plan) return [this.emit(proposal, 'rejected', { reason: plan.reason })];
    const accepted = this.emit(proposal, 'accepted');
    this.world = plan.world; this.version++; this.afterCommit(proposal);
    return [accepted, this.emit(proposal, 'succeeded', { result: { authority: 'operator', operator: proposal.actor, effects: plan.effects } })];
  }

  protected emit(proposal: ActionProposal, status: ActionEvent['status'], extra: Partial<ActionEvent> = {}): ActionEvent {
    const id = `host-event:${++this.eventCount}`;
    const event: ActionEvent = { id, runId: this.launch.runId, actionId: proposal.id, actor: proposal.actor,
      status, time: this.time(), revision: this.version, effectRefs: status === 'succeeded' ? [id] : [], ...extra };
    this.ledger.receive([event]);
    return event;
  }
  protected finish(proposal: ActionProposal): void { this.queue.push(this.emit(proposal, 'succeeded', { result: this.result(proposal) })); }

  submit(proposal: ActionProposal): ActionEvent[] {
    this.recordOperation({ type: 'submit', proposal: structuredClone(proposal) });
    if (this.ledger.propose(proposal) === 'duplicate') return [];
    const tool = this.descriptor.toolCatalog.tools.find((candidate) => candidate.id === proposal.toolId && candidate.version === proposal.toolVersion);
    const invalid = !tool || !this.availableTools(proposal.actor).includes(proposal.toolId)
      || compileDataSchema(tool.inputSchema)(proposal.arguments).length;
    const reason = invalid ? 'Tool or arguments are not permitted.'
      : proposal.observedRevision > this.version ? 'Observed revision is ahead of this host.' : this.validate(this.world, proposal);
    if (reason) return [this.emit(proposal, 'rejected', { reason })];
    const accepted = this.emit(proposal, 'accepted');
    const batch = executeHostInputs(this.world, [proposal], {
      validate: (world, input) => { const failure = this.validate(world, input); return failure ? { ok: false, reason: failure } : { ok: true }; },
      apply: (world, input) => this.apply(world, input),
    });
    this.world = batch.world;
    this.version++;
    this.afterCommit(proposal);
    return [accepted, this.running(proposal) ? this.emit(proposal, 'running') : this.emit(proposal, 'succeeded', { result: this.result(proposal) })];
  }
  cancel(actionId: string): ActionEvent[] {
    this.recordOperation({ type: 'cancel', actionId });
    const action = this.ledger.get(actionId);
    if (!action) throw new Error('Unknown action.');
    const requested = this.emit(action.proposal, 'cancellation-requested');
    const terminal = ['succeeded', 'failed', 'rejected', 'cancelled'].includes(action.status);
    if (terminal) return [requested, this.emit(action.proposal, 'cancellation-result', { cancellation: 'too-late' })];
    if (!this.cancelRunning(action.proposal)) return [requested, this.emit(action.proposal, 'cancellation-result', { cancellation: 'unsupported' })];
    this.version++;
    return [requested, this.emit(action.proposal, 'cancelled'), this.emit(action.proposal, 'cancellation-result', { cancellation: 'cancelled' })];
  }
  drainEvents() { return this.queue.splice(0); }
  advance() { this.recordOperation({ type: 'advance' }); this.tick++; this.advanceWorld(); }

  checkpoint(): JsonValue {
    if (this.queue.length || this.ledger.unresolved().length) throw new Error('Host checkpoint requires drained, settled actions.');
    if (this.storage) {
      const snapshot = JSON.parse(JSON.stringify({ version: 3, state: this.inspect(), eventCount: this.eventCount, operationCount: this.storage.count('host-operations') }));
      this.storage.set('host-current', 'snapshot', snapshot);
      return snapshot;
    }

    return JSON.parse(JSON.stringify({ version: this.descriptor.interventions?.length ? 2 : 1, state: this.inspect(), operations: this.operations, ...(this.eventPerception ? { perception: this.perceptions.snapshot() } : {}) }));
  }

  /** Reconstructs this deterministic local simulation from its complete command log. */
  restore(snapshot: JsonValue): void {
    if (this.storage && (snapshot as { version?: number }).version === 3) {
      if (canonicalJson(snapshot) !== canonicalJson(this.storage.get('host-current', 'snapshot'))) throw new Error('Host snapshot does not match frozen archive.');
      const current = snapshot as unknown as { state: { tick: number; revision: number; world: World }; eventCount: number; operationCount: number };
      if (this.storage.count('host-operations') !== current.operationCount || this.ledger.unresolved().length) throw new Error('Host archive is not settled at this snapshot.');
      this.tick = current.state.tick; this.version = current.state.revision; this.world = structuredClone(current.state.world); this.eventCount = current.eventCount;
      return;
    }
    const checked = compileDataSchema({ type: 'object', additionalProperties: false, required: ['version', 'state', 'operations'], properties: {
      version: { const: this.descriptor.interventions?.length ? 2 : 1 }, state: {}, perception: { type: 'array' }, operations: { type: 'array', maxItems: 100000, items: { oneOf: [
        { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'advance' } } },
        { type: 'object', additionalProperties: false, required: ['type', 'proposal'], properties: { type: { const: 'submit' }, proposal: { type: 'object' } } },
        ...(this.descriptor.interventions?.length ? [{ type: 'object', additionalProperties: false, required: ['type', 'proposal'], properties: { type: { const: 'intervene' }, proposal: { type: 'object' } } }] : []),
        { type: 'object', additionalProperties: false, required: ['type', 'actionId'], properties: { type: { const: 'cancel' }, actionId: { type: 'string' } } },
      ] } },
    } });
    if (checked(snapshot).length) throw new Error('Invalid local host checkpoint.');
    const operations = this.operations;
    const data = snapshot as unknown as { state: JsonValue; operations: typeof operations };
    for (const operation of data.operations) {
      if (operation.type === 'advance') this.advance();
      if (operation.type === 'submit') this.submit({ ...structuredClone(operation.proposal), runId: this.launch.runId });
      if (operation.type === 'intervene') this.intervene({ ...structuredClone(operation.proposal), runId: this.launch.runId });
      if (operation.type === 'cancel') this.cancel(operation.actionId);
      this.drainEvents();
    }
    if (this.eventPerception && (snapshot as { perception?: JsonValue }).perception) this.perceptions.restore((snapshot as { perception: JsonValue }).perception);
    if (canonicalJson(this.inspect()) !== canonicalJson(data.state) || this.ledger.unresolved().length) throw new Error('Host checkpoint replay does not match recorded state.');
  }
}

// Admission ceilings; each authored run keeps its own much smaller request/turn budget.
export const limits = { maxRequests: 1000000, maxInFlight: 16, maxSteps: 100000, requestTimeoutMs: 300000 };
export const capabilities = { pause: true, playback: true, deterministicReplay: true, restore: true, branch: true,
  deduplication: 'run-memory', revisionPolicy: 'revalidate' } as const;
export const clocks = [{ id: 'clock:simulation', kind: 'tick', unit: 'tick', origin: 'Run initialization is tick zero.' }] as const;
