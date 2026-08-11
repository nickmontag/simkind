import { compareStrings } from './order.js';

export interface DecisionRecord<Input, Request = unknown> {
  id: string;
  appliedTick: number;
  order: number;
  input: Input;
  request?: Request;
}

function assertTick(tick: number): void {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError(`decision tick must be a non-negative safe integer; received ${tick}`);
  }
}

function validatedRecordsForTick<Input, Request>(
  records: readonly DecisionRecord<Input, Request>[],
  tick: number,
): DecisionRecord<Input, Request>[] {
  assertTick(tick);
  const ids = new Set<string>();
  const orders = new Set<number>();
  const matching: DecisionRecord<Input, Request>[] = [];
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

export function recordDecisionBatch<Input, Request = unknown>(
  existing: readonly DecisionRecord<Input, Request>[],
  tick: number,
  inputs: readonly Input[],
  requestFor?: (input: Input) => Request | undefined,
): DecisionRecord<Input, Request>[] {
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
