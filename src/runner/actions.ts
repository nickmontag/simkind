import { canonicalJson, validateRecord, validateTime, type ActionEvent, type ActionProposal, type Clock } from '../format/index.js';

export type ActionStatus = 'proposed' | ActionEvent['status'];
interface TrackedAction { proposal: ActionProposal; status: ActionStatus; events: ActionEvent[] }
const terminal = new Set<ActionStatus>(['rejected', 'succeeded', 'failed', 'cancelled']);

/** Correlation and lifecycle validation. Effects remain exclusively host-owned. */
export class ActionLedger {
  private actions = new Map<string, TrackedAction>();
  private eventIds = new Map<string, string>();
  constructor(private readonly runId: string, private readonly clocks: readonly Clock[]) {}

  propose(proposal: ActionProposal): 'new' | 'duplicate' {
    if (validateRecord('ActionProposal', proposal).length || proposal.runId !== this.runId) throw new Error('Invalid action proposal.');
    const existing = this.actions.get(proposal.id);
    if (existing) {
      if (canonicalJson(existing.proposal) !== canonicalJson(proposal)) throw new Error('Conflicting action ID reuse.');
      return 'duplicate';
    }
    this.actions.set(proposal.id, { proposal: structuredClone(proposal), status: 'proposed', events: [] });
    return 'new';
  }

  /** Whole batches validate before mutation; identical redelivered events are no-ops. */
  receive(events: readonly ActionEvent[]): ActionEvent[] {
    const actions = structuredClone(this.actions);
    const ids = new Map(this.eventIds);
    const added: ActionEvent[] = [];
    for (const event of events) {
      if (validateRecord('ActionEvent', event).length || validateTime(event.time, this.clocks).length || event.runId !== this.runId) throw new Error('Invalid action event.');
      const serialized = canonicalJson(event);
      if (ids.has(event.id)) {
        if (ids.get(event.id) !== serialized) throw new Error('Conflicting event ID reuse.');
        continue;
      }
      const action = actions.get(event.actionId);
      if (!action || action.proposal.actor !== event.actor) throw new Error('Action event has no matching actor/proposal.');
      const status = action.status;
      if (event.status === 'cancellation-requested') {
        if (status === 'proposed') throw new Error('Cannot cancel an action before admission.');
      } else if (event.status === 'cancellation-result') {
        if (!event.cancellation || !action.events.some((entry) => entry.status === 'cancellation-requested')) throw new Error('Cancellation result requires a request and an explicit result.');
        if (event.cancellation === 'cancelled' && status !== 'cancelled') throw new Error('Cancellation success requires a cancelled action event.');
      } else {
        if (terminal.has(status)) throw new Error('A terminal outcome cannot be overwritten.');
        if (status === 'proposed' && event.status !== 'accepted' && event.status !== 'rejected') throw new Error('An action must be admitted or rejected first.');
        if (status !== 'proposed' && (event.status === 'accepted' || event.status === 'rejected')) throw new Error('An admitted action cannot be admitted or rejected again.');
        if (event.status === 'rejected' && event.effectRefs.length) throw new Error('A rejected action cannot claim effects.');
        if (['failed', 'rejected', 'unknown'].includes(event.status) && !event.reason) throw new Error('Failure, rejection, and uncertainty require reasons.');
        action.status = event.status;
      }
      action.events.push(structuredClone(event));
      ids.set(event.id, serialized);
      added.push(structuredClone(event));
    }
    this.actions = actions;
    this.eventIds = ids;
    return added;
  }

  get(actionId: string): TrackedAction | undefined { return structuredClone(this.actions.get(actionId)); }
  unresolved(actor?: string): TrackedAction[] {
    return [...this.actions.values()].filter((entry) => !terminal.has(entry.status) && (actor === undefined || entry.proposal.actor === actor)).map((entry) => structuredClone(entry));
  }
  eventsFor(actor: string): ActionEvent[] {
    return [...this.actions.values()].filter((entry) => entry.proposal.actor === actor).flatMap((entry) => structuredClone(entry.events));
  }
}
