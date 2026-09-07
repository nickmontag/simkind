import type {
  DecisionRecord,
  HostExecutionOutcome,
  MemoryEvidence,
  ModelRequest,
} from 'simkind';

export type SimkinId = 'aya' | 'mira' | 'sol' | 'ivo' | 'nia' | 'ren';
export type Place = 'square' | 'farm' | 'clinic' | 'reservoir';
export type Resource = 'food' | 'medicine' | 'parts' | 'water';
export type FactId = 'bridge-unsafe' | 'pump-degrading' | 'pump-failed' | 'ren-sick' | 'nia-sick';

export type SettlementIntent =
  | { kind: 'Move'; to: Place }
  | { kind: 'Collect'; resource: 'water' }
  | { kind: 'Ask'; to: SimkinId; resource: Resource }
  | { kind: 'Give'; to: SimkinId; resource: Resource }
  | { kind: 'Share'; to: SimkinId; fact: FactId }
  | { kind: 'PostNotice'; fact: FactId }
  | { kind: 'Repair'; target: 'pump' }
  | { kind: 'Treat'; target: SimkinId }
  | { kind: 'Wait' };

export interface SettlementRequest extends ModelRequest {
  simkinId: SimkinId;
  snapshot: SimkinSnapshot;
}

export interface SettlementInput {
  requestId: string;
  simkinId: SimkinId;
  intent: SettlementIntent;
  fallbackReason?: 'invalid-output' | 'provider-error';
}

export interface SimkinState {
  id: SimkinId;
  role: string;
  place: Place;
  inventory: Record<Resource, number>;
  hunger: number;
  thirst: number;
  illness: number;
  memories: MemoryEvidence[];
  trust: Record<SimkinId, number>;
}

export interface ResourceRequest {
  id: string;
  from: SimkinId;
  to: SimkinId;
  resource: Resource;
  createdTick: number;
  resolved: boolean;
}

export type SettlementDecision = DecisionRecord<
  SettlementInput,
  SettlementRequest,
  HostExecutionOutcome
>;

export interface SettlementState {
  tick: number;
  pumpHealth: number;
  bridgeOpen: boolean;
  reservoirWater: number;
  simkins: Record<SimkinId, SimkinState>;
  requests: ResourceRequest[];
  notices: FactId[];
  decisions: SettlementDecision[];
  recentEvents: string[];
  metrics: {
    untreatedIllnessTicks: number;
    foodDeficitTicks: number;
    waterDeficitTicks: number;
    pumpDowntimeTicks: number;
  };
}

export interface SimkinSnapshot {
  tick: number;
  self: SimkinState;
  present: Pick<SimkinState, 'id' | 'role' | 'inventory' | 'hunger' | 'thirst' | 'illness'>[];
  knownFacts: FactId[];
  notices: FactId[];
  requestsToMe: ResourceRequest[];
  myOpenRequests: ResourceRequest[];
  pumpHealth: number | null;
  bridgeOpen: boolean | null;
  reservoirWater: number | null;
  legalDestinations: Place[];
}

export interface SettlementProvider {
  name: string;
  decide(request: SettlementRequest): Promise<unknown>;
  usage?: { requests: number; totalTokens: number; cost: number };
}

export interface SettlementReport {
  tick: number;
  pumpHealth: number;
  bridgeOpen: boolean;
  reservoirWater: number;
  alive: number;
  rejected: number;
  fallbacks: number;
  fulfilledRequests: number;
  factsKnown: Record<FactId, number>;
  trustDelta: number;
  repeatedActions: number;
  metrics: SettlementState['metrics'];
}
