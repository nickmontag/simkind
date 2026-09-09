import { MemoryRunnerStorage, type RunnerStorage } from './storage.js';
import { canonicalJson, validateRecord, validateTime, type ActionEvent, type ActionProposal, type Clock } from '../format/index.js';

export type ActionStatus = 'proposed' | ActionEvent['status'];
interface TrackedAction { proposal: ActionProposal; status: ActionStatus; events: ActionEvent[] }
const terminal = new Set<ActionStatus>(['rejected', 'succeeded', 'failed', 'cancelled']);

/** Correlation and lifecycle validation. Effects remain exclusively host-owned. */
export class ActionLedger {
  private active = new Set<string>();
  constructor(private readonly runId: string, private readonly clocks: readonly Clock[], private readonly storage: RunnerStorage = new MemoryRunnerStorage()) {
    this.active = new Set(storage.get<string[]>('ledger', 'active') ?? []);
  }
  private metadata(id: string) { return this.storage.get<{ proposal: ActionProposal; status: ActionStatus; cancellationRequested?: boolean }>('actions', id); }

  propose(proposal: ActionProposal): 'new' | 'duplicate' {
    if (validateRecord('ActionProposal', proposal).length || proposal.runId !== this.runId) throw new Error('Invalid action proposal.');
    const existing = this.metadata(proposal.id);
    if (existing) {
      if (canonicalJson(existing.proposal) !== canonicalJson(proposal)) throw new Error('Conflicting action ID reuse.');
      return 'duplicate';
    }
    this.storage.transaction(() => {
      this.storage.set('actions', proposal.id, { proposal, status: 'proposed' });
      this.storage.set('ledger', 'active', [...this.active, proposal.id]);
    });
    this.active.add(proposal.id);
    return 'new';
  }

  /** Whole batches validate before mutation; identical redelivered events are no-ops. */
  receive(events: readonly ActionEvent[]): ActionEvent[] {
    const actions = new Map<string, NonNullable<ReturnType<ActionLedger['metadata']>>>();
    const ids = new Map<string, string>();
    const added: ActionEvent[] = [];
    for (const event of events) {
      if (validateRecord('ActionEvent', event).length || validateTime(event.time, this.clocks).length || event.runId !== this.runId) throw new Error('Invalid action event.');
      const serialized = canonicalJson(event);
      const prior = ids.get(event.id) ?? this.storage.get<string>('action-event-ids', event.id);
      if (prior !== undefined) {
        if (prior !== serialized) throw new Error('Conflicting event ID reuse.');
        continue;
      }
      const action = actions.get(event.actionId) ?? this.metadata(event.actionId);
      if (!action || action.proposal.actor !== event.actor) throw new Error('Action event has no matching actor/proposal.');
      const status = action.status;
      if (event.status === 'cancellation-requested') {
        if (status === 'proposed') throw new Error('Cannot cancel an action before admission.');
        action.cancellationRequested = true;
      } else if (event.status === 'cancellation-result') {
        if (!event.cancellation || !action.cancellationRequested) throw new Error('Cancellation result requires a request and an explicit result.');
        if (event.cancellation === 'cancelled' && status !== 'cancelled') throw new Error('Cancellation success requires a cancelled action event.');
      } else {
        if (terminal.has(status)) throw new Error('A terminal outcome cannot be overwritten.');
        if (status === 'proposed' && event.status !== 'accepted' && event.status !== 'rejected') throw new Error('An action must be admitted or rejected first.');
        if (status !== 'proposed' && (event.status === 'accepted' || event.status === 'rejected')) throw new Error('An admitted action cannot be admitted or rejected again.');
        if (event.status === 'rejected' && event.effectRefs.length) throw new Error('A rejected action cannot claim effects.');
        if (['failed', 'rejected', 'unknown'].includes(event.status) && !event.reason) throw new Error('Failure, rejection, and uncertainty require reasons.');
        action.status = event.status;
      }
      actions.set(event.actionId, action);
      ids.set(event.id, serialized);
      added.push(structuredClone(event));
    }
    const active = new Set(this.active);
    this.storage.transaction(() => {
      for (const [id, action] of actions) {
        this.storage.set('actions', id, action);
        if (terminal.has(action.status)) active.delete(id); else active.add(id);
      }
      for (const event of added) {
        this.storage.set('action-event-ids', event.id, ids.get(event.id));
        this.storage.append(`action:${event.actionId}`, { id: event.id, turn: typeof event.time.value === 'number' ? event.time.value : 0, text: '', value: event });
        this.storage.append(`actor-actions:${event.actor}`, { id: event.id, turn: typeof event.time.value === 'number' ? event.time.value : 0, text: '', value: event });
      }
      this.storage.set('ledger', 'active', [...active]);
    });
    this.active = active;
    return added;
  }

  get(actionId: string, includeEvents = true): TrackedAction | undefined {
    const action = this.metadata(actionId);
    return action && { proposal: action.proposal, status: action.status,
      events: includeEvents ? this.storage.read<ActionEvent>(`action:${actionId}`, { limit: this.storage.count(`action:${actionId}`) }).map(row => row.value) : [] };
  }
  unresolved(actor?: string): TrackedAction[] {
    return [...this.active].map(id => this.get(id, false)!).filter(action => actor === undefined || action.proposal.actor === actor);
  }
  eventsFor(actor: string, limit = this.storage.count(`actor-actions:${actor}`)): ActionEvent[] {
    const stream = `actor-actions:${actor}`;
    return this.storage.read<ActionEvent>(stream, { after: Math.max(-1, this.storage.count(stream) - limit - 1), limit }).map(row => row.value);
  }
}
