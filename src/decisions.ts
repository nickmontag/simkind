import { compareStrings } from './order.js';

export interface DecisionRecord<Input, Request = unknown, Outcome = unknown> {
  id: string;
  appliedTick: number;
  order: number;
  input: Input;
  request?: Request;
  outcome?: Outcome;
}

function assertTick(tick: number): void {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError(`decision tick must be a non-negative safe integer; received ${tick}`);
  }
}

function validatedRecordsForTick<Input, Request, Outcome>(
  records: readonly DecisionRecord<Input, Request, Outcome>[],
  tick: number,
): DecisionRecord<Input, Request, Outcome>[] {
  assertTick(tick);
  const ids = new Set<string>();
  const orders = new Set<number>();
  const matching: DecisionRecord<Input, Request, Outcome>[] = [];
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`duplicate decision id: ${record.id}`);
    ids.add(record.id);
    if (record.appliedTick !== tick) continue;
    if (!Number.isSafeInteger(record.order) || record.order < 0) {
      throw new RangeError(`decision order must be a non-negative safe integer; received ${record.order}`);
    }
    if (orders.has(record.order)) {
      throw new Error(`duplicate decision order ${record.order} at tick ${tick}`);
    }
    orders.add(record.order);
    matching.push(record);
  }
  return matching;
}

export function recordDecisionBatch<Input, Request = unknown, Outcome = unknown>(
  existing: readonly DecisionRecord<Input, Request, Outcome>[],
  tick: number,
  inputs: readonly Input[],
  requestFor?: (input: Input) => Request | undefined,
): DecisionRecord<Input, Request, Outcome>[] {
  const recordsAtTick = validatedRecordsForTick(existing, tick);
  const offset = recordsAtTick.reduce((highest, record) => Math.max(highest, record.order), -1) + 1;
  const added = inputs.map((input, index) => {
    const order = offset + index;
    if (!Number.isSafeInteger(order)) throw new RangeError('decision order exceeds safe integer range');
    const request = requestFor?.(input);
    return {
      id: `decision:${String(tick).padStart(8, '0')}:${String(order).padStart(3, '0')}`,
      appliedTick: tick,
      order,
      input: structuredClone(input),
      ...(request === undefined ? {} : { request: structuredClone(request) }),
    };
  });
  return [...existing, ...added];
}

export function replayInputsForTick<Input, Request = unknown>(
  records: readonly DecisionRecord<Input, Request>[],
  tick: number,
): Input[] {
  return validatedRecordsForTick(records, tick)
    .sort((a, b) => a.order - b.order || compareStrings(a.id, b.id))
    .map((record) => structuredClone(record.input));
}

export function recordDecisionOutcomes<Input, Request, Outcome>(
  records: readonly DecisionRecord<Input, Request, Outcome>[],
  tick: number,
  outcomes: readonly Outcome[],
): DecisionRecord<Input, Request, Outcome>[] {
  const unresolved = validatedRecordsForTick(records, tick)
    .filter((record) => record.outcome === undefined)
    .sort((a, b) => a.order - b.order || compareStrings(a.id, b.id));
  if (unresolved.length !== outcomes.length) {
    throw new Error(
      `decision outcome count mismatch at tick ${tick}: ${unresolved.length} unresolved decisions, ${outcomes.length} outcomes`,
    );
  }
  const outcomeById = new Map(
    unresolved.map((record, index) => [record.id, structuredClone(outcomes[index])]),
  );
  return records.map((record) => {
    const outcome = outcomeById.get(record.id);
    return outcome === undefined ? record : { ...record, outcome };
  });
}
