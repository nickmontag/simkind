export interface DecisionRecord<Input, Request = unknown> {
  id: string;
  appliedTick: number;
  order: number;
  input: Input;
  request?: Request;
}

export function recordDecisionBatch<Input, Request = unknown>(
  existing: readonly DecisionRecord<Input, Request>[],
  tick: number,
  inputs: readonly Input[],
  requestFor?: (input: Input) => Request | undefined,
): DecisionRecord<Input, Request>[] {
  const offset = existing.filter((record) => record.appliedTick === tick).length;
  const added = inputs.map((input, index) => {
    const order = offset + index;
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
  return records
    .filter((record) => record.appliedTick === tick)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((record) => record.input);
}
