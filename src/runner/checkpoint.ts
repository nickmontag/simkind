import { canonicalJson, validateDocument, validateRecord, validateTime, type JsonValue, type RunBundle, type RunEvent } from '../format/index.js';
import { ActionLedger } from './actions.js';
import type { PreparedLaunch } from './contracts.js';
import type { RunnerStorage } from './storage.js';

export interface RunnerCheckpoint {
  version: 'simkind.checkpoint/1' | 'simkind.checkpoint/2';
  id: string;
  host: RunBundle['host'];
  launch: PreparedLaunch;
  hostState: JsonValue;
  events: RunEvent[];
  scheduler: { steps: number; requests: number; requestSequence: number; nextActor: number; paused: boolean; memoryTurnOffset?: number };
  archive?: { eventCount: number; revision?: number; actors: Record<string, { evidence: number; episodes: number; version: number }> };
  parent?: RunBundle['parent'];
  modelCapabilities?: Record<string, { text: boolean; json: boolean; jsonSchema?: boolean }>;
}

/** Validates persisted evidence before a host restore hook can run. */
export function validateCheckpoint(value: RunnerCheckpoint): void {
  canonicalJson(value);
  if (!['simkind.checkpoint/1', 'simkind.checkpoint/2'].includes(value.version) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.id)) throw new Error('Unsupported checkpoint.');
  if (value.version === 'simkind.checkpoint/2' && (!value.archive || value.events.length || !Number.isSafeInteger(value.archive.eventCount) || value.archive.eventCount < 0)) throw new Error('Invalid archived checkpoint.');
  const { scheduler, launch } = value;
  if (scheduler.memoryTurnOffset !== undefined && (!Number.isSafeInteger(scheduler.memoryTurnOffset) || scheduler.memoryTurnOffset < 0)) throw new Error('Invalid lifetime turn offset.');
  if (value.archive) {
    if (value.archive.revision !== undefined && (!Number.isSafeInteger(value.archive.revision) || value.archive.revision < 0)) throw new Error('Invalid archive revision.');
    for (const [actor, counts] of Object.entries(value.archive.actors)) {
      if (!launch.states[actor] || !counts || ['evidence', 'episodes', 'version'].some(key => !Number.isSafeInteger(counts[key as keyof typeof counts]) || counts[key as keyof typeof counts] < 0)) throw new Error('Invalid actor archive cutoff.');
    }
  }
  for (const field of ['steps', 'requests', 'requestSequence', 'nextActor'] as const) if (!Number.isSafeInteger(scheduler[field]) || scheduler[field] < 0) throw new Error('Invalid checkpoint scheduler.');
  if (scheduler.requestSequence < scheduler.requests) throw new Error('Checkpoint request sequence is invalid.');
  if (typeof scheduler.paused !== 'boolean' || scheduler.steps > launch.config.limits.maxSteps || scheduler.requests > launch.config.limits.maxRequests
    || scheduler.nextActor >= launch.scenario.cast.length) throw new Error('Checkpoint scheduler exceeds launch limits.');
  for (const [actor, state] of Object.entries(launch.states)) {
    if (!validateDocument(state).ok || state.instanceId !== actor || state.definitionRef !== launch.characters[actor]?.id) throw new Error('Invalid checkpoint character state.');
  }
  const ids = new Set<string>();
  // Host-specific clock declarations are checked again by the runner.
  for (const [index, event] of value.events.entries()) {
    if (validateRecord('RunEvent', event).length || event.sequence !== index || event.runId !== launch.runId || ids.has(event.id)) throw new Error('Invalid checkpoint event history.');
    ids.add(event.id);
  }
}

export function ledgerFromEvents(runId: string, clocks: RunBundle['clocks'], events: readonly RunEvent[], storage?: RunnerStorage): ActionLedger {
  const ledger = new ActionLedger(runId, clocks, storage);
  for (const event of events) {
    if (validateTime(event.time, clocks).length) throw new Error('Invalid checkpoint event clock.');
    if (event.type === 'proposal') ledger.propose(event.data as unknown as import('../format/index.js').ActionProposal);
    if (event.type === 'action') ledger.receive([event.data as unknown as import('../format/index.js').ActionEvent]);
  }
  if (ledger.unresolved().length) throw new Error('Checkpoint contains unresolved actions.');
  const requests = new Set<string>();
  for (const event of events) {
    const data = event.data as Record<string, JsonValue>;
    if (event.type === 'request') requests.add((data.context as Record<string, JsonValue>).requestId as string);
    if (['model-result', 'model-error', 'model-timeout'].includes(event.type)) requests.delete(data.requestId as string);
    if (event.type === 'stopped') throw new Error('Stopped histories cannot resume.');
  }
  if (requests.size) throw new Error('Checkpoint contains pending requests.');
  return ledger;
}

/** Branch comparison reports recorded availability and outcomes, never causal influence. */
export function compareRuns(left: Iterable<RunEvent>, right: Iterable<RunEvent>) {
  const summarize = (events: Iterable<RunEvent>) => {
    let requests = 0, inputTokens = 0, outputTokens = 0, reportedCost = 0, usageReports = 0, costReports = 0;
    const outcomes: Record<string, number> = {};
    for (const event of events) {
      const data = event.data as Record<string, JsonValue>;
      if (event.type === 'request') requests++;
      if (event.type === 'action') { const status = String(data.status); outcomes[status] = (outcomes[status] ?? 0) + 1; }
      if (event.type === 'model-result' || event.type === 'model-error') {
        const usage = data.usage as Record<string, number> | undefined;
        if (usage && ('inputTokens' in usage || 'outputTokens' in usage)) usageReports++;
        if (usage && 'cost' in usage) costReports++;
        inputTokens += usage?.inputTokens ?? 0; outputTokens += usage?.outputTokens ?? 0; reportedCost += usage?.cost ?? 0;
      }
    }
    return { requests, inputTokens, outputTokens, reportedCost, usageReports, costReports, outcomes };
  };
  return { left: summarize(left), right: summarize(right) };
}
