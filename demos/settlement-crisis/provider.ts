import type {
  FactId,
  Place,
  Resource,
  SettlementInput,
  SettlementIntent,
  SettlementProvider,
  SettlementRequest,
  SettlementState,
  SimkinId,
} from './types.js';
import { requestFor, stepSettlement } from './engine.js';

const simkinIds: SimkinId[] = ['aya', 'mira', 'sol', 'ivo', 'nia', 'ren'];
const places: Place[] = ['square', 'farm', 'clinic', 'reservoir'];
const resources: Resource[] = ['food', 'medicine', 'parts', 'water'];
const facts: FactId[] = ['bridge-unsafe', 'pump-degrading', 'pump-failed', 'ren-sick', 'nia-sick'];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseIntent(value: unknown): SettlementIntent | undefined {
  if (!record(value) || typeof value.kind !== 'string') return undefined;
  switch (value.kind) {
    case 'Move':
      return places.includes(value.to as Place) ? { kind: 'Move', to: value.to as Place } : undefined;
    case 'Collect':
      return value.resource === 'water' ? { kind: 'Collect', resource: 'water' } : undefined;
    case 'Ask':
      return simkinIds.includes(value.to as SimkinId) && resources.includes(value.resource as Resource)
        ? { kind: 'Ask', to: value.to as SimkinId, resource: value.resource as Resource }
        : undefined;
    case 'Give':
      return simkinIds.includes(value.to as SimkinId) && resources.includes(value.resource as Resource)
        ? { kind: 'Give', to: value.to as SimkinId, resource: value.resource as Resource }
        : undefined;
    case 'Share':
      return simkinIds.includes(value.to as SimkinId) && facts.includes(value.fact as FactId)
        ? { kind: 'Share', to: value.to as SimkinId, fact: value.fact as FactId }
        : undefined;
    case 'PostNotice':
      return facts.includes(value.fact as FactId)
        ? { kind: 'PostNotice', fact: value.fact as FactId }
        : undefined;
    case 'Repair': return value.target === 'pump' ? { kind: 'Repair', target: 'pump' } : undefined;
    case 'Treat':
      return simkinIds.includes(value.target as SimkinId)
        ? { kind: 'Treat', target: value.target as SimkinId }
        : undefined;
    case 'Wait': return { kind: 'Wait' };
    default: return undefined;
  }
}

export async function advanceSettlement(
  state: SettlementState,
  provider: SettlementProvider,
): Promise<SettlementState> {
  const requests = simkinIds.map((id) => requestFor(state, id));
  const settled = await Promise.allSettled(requests.map((request) => provider.decide(request)));
  const inputs: SettlementInput[] = settled.map((result, index) => {
    const request = requests[index];
    if (result.status === 'rejected') {
      return {
        requestId: request.id,
        simkinId: request.simkinId,
        intent: { kind: 'Wait' },
        fallbackReason: 'provider-error',
      };
    }
    const intent = parseIntent(result.value);
    return intent === undefined
      ? {
          requestId: request.id,
          simkinId: request.simkinId,
          intent: { kind: 'Wait' },
          fallbackReason: 'invalid-output',
        }
      : { requestId: request.id, simkinId: request.simkinId, intent };
  });
  return stepSettlement(state, inputs);
}

export async function runSettlement(
  initial: SettlementState,
  provider: SettlementProvider,
  targetTick: number,
): Promise<SettlementState> {
  let state = initial;
  while (state.tick < targetTick) state = await advanceSettlement(state, provider);
  return state;
}

export function requestPrompt(request: SettlementRequest): string {
  return JSON.stringify(request.snapshot, null, 2);
}
