import type { SimkinRuntime } from './runtime.js';
import type { ModelCompletion, ModelRequest } from './model-runtime.js';

export type HostValidation =
  | { ok: true }
  | { ok: false; reason: string };

export type HostExecutionOutcome =
  | { status: 'applied' }
  | { status: 'rejected'; reason: string }
  | { status: 'fallback'; reason: string };

export interface HostInputExecutor<World, Input> {
  validate(world: World, input: Input): HostValidation;
  apply(world: World, input: Input): World;
  fallbackReason?(input: Input): string | undefined;
}

export interface HostExecutionBatch<World> {
  world: World;
  outcomes: HostExecutionOutcome[];
}

export type ModelFallbackReason = 'invalid-output' | 'provider-error';

export type ModelInputResolution<Input> =
  | { status: 'parsed'; input: Input }
  | { status: 'fallback'; reason: ModelFallbackReason; input: Input };

export function resolveModelCompletion<Request extends ModelRequest, Raw, Input>(
  completion: ModelCompletion<Request, Raw>,
  parse: (request: Request, input: Raw) => Input | undefined,
  fallback: (request: Request, reason: ModelFallbackReason) => Input,
): ModelInputResolution<Input> {
  if (completion.status === 'rejected') {
    return {
      status: 'fallback',
      reason: 'provider-error',
      input: fallback(completion.request, 'provider-error'),
    };
  }
  const parsed = parse(completion.request, completion.input);
  return parsed === undefined
    ? {
        status: 'fallback',
        reason: 'invalid-output',
        input: fallback(completion.request, 'invalid-output'),
      }
    : { status: 'parsed', input: parsed };
}

export function executeHostInputs<World, Input>(
  initialWorld: World,
  inputs: readonly Input[],
  executor: HostInputExecutor<World, Input>,
): HostExecutionBatch<World> {
  let world = initialWorld;
  const outcomes: HostExecutionOutcome[] = [];
  for (const input of inputs) {
    const validation = executor.validate(world, input);
    if (!validation.ok) {
      outcomes.push({ status: 'rejected', reason: validation.reason });
      continue;
    }
    world = executor.apply(world, input);
    const fallbackReason = executor.fallbackReason?.(input);
    outcomes.push(fallbackReason === undefined
      ? { status: 'applied' }
      : { status: 'fallback', reason: fallbackReason });
  }
  return { world, outcomes };
}

export function advanceSimkinTick<World, Context, Input>(
  runtime: SimkinRuntime<World, Context, Input>,
  world: World,
  context: Context,
  inputs: readonly Input[],
  advanceHost: (world: World, context: Context) => World = (current) => current,
): World {
  world = runtime.applyInputs(world, context, inputs);
  world = runtime.advanceInteractions(world, context);
  world = advanceHost(world, context);
  return runtime.advanceCognition(world, context);
}
