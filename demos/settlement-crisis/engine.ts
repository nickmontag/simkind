import {
  defineCapabilityCatalog,
  executeHostInputs,
  rankMemories,
  recordDecisionBatch,
  recordDecisionOutcomes,
  type CapabilityDefinition,
  type HostValidation,
} from 'simkind';
import type {
  FactId,
  Place,
  Resource,
  SettlementInput,
  SettlementIntent,
  SettlementReport,
  SettlementRequest,
  SettlementState,
  SimkinId,
  SimkinSnapshot,
  SimkinState,
} from './types.js';

export const settlementCapabilities = defineCapabilityCatalog({
  Move: { description: 'Move along an open route.', examples: ['Move to reservoir'] },
  Collect: { description: 'Collect water at the reservoir.', examples: ['Collect water'] },
  Ask: { description: 'Ask a present simkin for one resource.', examples: ['Ask Sol for parts'] },
  Give: { description: 'Give one carried resource to a present simkin.', examples: ['Give food to Ren'] },
  Share: { description: 'Tell a present simkin one known fact.', examples: ['Tell Aya the pump failed'] },
  PostNotice: { description: 'Post one known fact publicly.', examples: ['Post that the bridge is unsafe'] },
  Repair: { description: 'Repair the pump with two parts at the reservoir.', examples: ['Repair pump'] },
  Treat: { description: 'Treat a present ill simkin with medicine.', examples: ['Treat Ren'] },
  Wait: { description: 'Take no action.', examples: ['Wait'] },
} satisfies Record<SettlementIntent['kind'], CapabilityDefinition>);

const simkinIds: SimkinId[] = ['aya', 'mira', 'sol', 'ivo', 'nia', 'ren'];
const resources: Resource[] = ['food', 'medicine', 'parts', 'water'];

function inventory(values: Partial<Record<Resource, number>> = {}): Record<Resource, number> {
  return Object.fromEntries(resources.map((resource) => [resource, values[resource] ?? 0])) as Record<Resource, number>;
}

function trust(values: Partial<Record<SimkinId, number>> = {}): Record<SimkinId, number> {
  return Object.fromEntries(simkinIds.map((id) => [id, values[id] ?? 0])) as Record<SimkinId, number>;
}

function memory(id: string, text: string, fact: FactId, source = 'observation') {
  return {
    id,
    text,
    importance: 5,
    confidence: 1,
    createdTick: 0,
    lastAccessTick: 0,
    about: [],
    tags: ['fact', fact],
    source,
    hops: 0,
  };
}

function simkin(
  id: SimkinId,
  role: string,
  place: Place,
  items: Partial<Record<Resource, number>>,
  memories: ReturnType<typeof memory>[] = [],
  initialTrust: Partial<Record<SimkinId, number>> = {},
): SimkinState {
  return {
    id,
    role,
    place,
    inventory: inventory(items),
    hunger: 0,
    thirst: 0,
    illness: id === 'ren' ? 2 : 0,
    memories,
    trust: trust(initialTrust),
  };
}

export function createSettlement(): SettlementState {
  return {
    tick: 0,
    pumpHealth: 70,
    bridgeOpen: true,
    reservoirWater: 10,
    simkins: {
      aya: simkin('aya', 'mechanic', 'square', { parts: 1, water: 1 }, [
        memory('memory:aya:pump', 'The reservoir pump is degrading.', 'pump-degrading'),
      ], { sol: 2 }),
      mira: simkin('mira', 'medic', 'clinic', { medicine: 2, food: 1 }, [
        memory('memory:mira:ren', 'Ren is ill and needs treatment.', 'ren-sick'),
      ]),
      sol: simkin('sol', 'farmer', 'farm', { food: 8, parts: 1, water: 1 }, [], { aya: 2, ren: -1 }),
      ivo: simkin('ivo', 'courier', 'square', { food: 1, water: 1 }, [
        memory('memory:ivo:bridge', 'The farm bridge is unsafe.', 'bridge-unsafe'),
      ]),
      nia: simkin('nia', 'elder', 'square', { food: 1, water: 4 }),
      ren: simkin('ren', 'newcomer', 'square', {}, [
        memory('memory:ren:sick', 'I feel seriously ill.', 'ren-sick', 'self'),
      ]),
    },
    requests: [],
    notices: [],
    decisions: [],
    recentEvents: ['0: The settlement begins an ordinary morning.'],
    metrics: {
      untreatedIllnessTicks: 0,
      foodDeficitTicks: 0,
      waterDeficitTicks: 0,
      pumpDowntimeTicks: 0,
    },
  };
}

function knownFacts(simkinState: SimkinState): FactId[] {
  return [...new Set(simkinState.memories.flatMap((item) =>
    item.tags[0] === 'fact' ? [item.tags[1] as FactId] : [],
  ))];
}

function addFact(
  state: SettlementState,
  simkinId: SimkinId,
  fact: FactId,
  source: string,
): void {
  const target = state.simkins[simkinId];
  if (knownFacts(target).includes(fact)) return;
  target.memories.push(memory(`memory:${state.tick}:${simkinId}:${fact}`, fact.replaceAll('-', ' '), fact, source));
}

export function legalDestinations(state: SettlementState, from: Place): Place[] {
  if (from === 'square') {
    return ['clinic', 'reservoir', ...(state.bridgeOpen ? ['farm' as const] : [])];
  }
  if (from === 'farm') return state.bridgeOpen ? ['square'] : [];
  return ['square'];
}

export function snapshotFor(state: SettlementState, simkinId: SimkinId): SimkinSnapshot {
  const self = state.simkins[simkinId];
  const recalled = rankMemories(self.memories, state.tick, { text: 'urgent illness pump bridge food water parts', limit: 12 });
  return {
    tick: state.tick,
    self: structuredClone({ ...self, memories: recalled }),
    present: simkinIds
      .filter((id) => id !== simkinId && state.simkins[id].place === self.place)
      .map((id) => {
        const present = state.simkins[id];
        return structuredClone({
          id: present.id,
          role: present.role,
          inventory: present.inventory,
          hunger: present.hunger,
          thirst: present.thirst,
          illness: present.illness,
        });
      }),
    knownFacts: knownFacts(self),
    notices: [...state.notices],
    requestsToMe: structuredClone(state.requests.filter((request) => request.to === simkinId && !request.resolved)),
    myOpenRequests: structuredClone(state.requests.filter((request) => request.from === simkinId && !request.resolved)),
    pumpHealth: self.place === 'reservoir' ? state.pumpHealth : null,
    bridgeOpen: self.place === 'farm' || self.place === 'square' ? state.bridgeOpen : null,
    reservoirWater: self.place === 'reservoir' ? state.reservoirWater : null,
    legalDestinations: legalDestinations(state, self.place),
  };
}

export function requestFor(state: SettlementState, simkinId: SimkinId): SettlementRequest {
  return {
    id: `settlement:${String(state.tick).padStart(2, '0')}:${simkinId}`,
    priority: 10,
    issuedAtTick: state.tick,
    simkinId,
    snapshot: snapshotFor(state, simkinId),
  };
}

function validate(state: SettlementState, input: SettlementInput): HostValidation {
  const actor = state.simkins[input.simkinId];
  const intent = input.intent;
  switch (intent.kind) {
    case 'Move':
      return legalDestinations(state, actor.place).includes(intent.to)
        ? { ok: true }
        : { ok: false, reason: 'route unavailable' };
    case 'Collect':
      if (actor.place !== 'reservoir') return { ok: false, reason: 'water is collected at reservoir' };
      if (state.pumpHealth <= 0 || state.reservoirWater <= 0) return { ok: false, reason: 'water unavailable' };
      return { ok: true };
    case 'Ask':
      if (intent.to === actor.id) return { ok: false, reason: 'cannot ask self' };
      return state.simkins[intent.to].place === actor.place
        ? { ok: true }
        : { ok: false, reason: 'recipient is elsewhere' };
    case 'Give':
      if (state.simkins[intent.to].place !== actor.place) return { ok: false, reason: 'recipient is elsewhere' };
      return actor.inventory[intent.resource] > 0
        ? { ok: true }
        : { ok: false, reason: `no ${intent.resource} carried` };
    case 'Share':
      if (state.simkins[intent.to].place !== actor.place) return { ok: false, reason: 'listener is elsewhere' };
      return knownFacts(actor).includes(intent.fact)
        ? { ok: true }
        : { ok: false, reason: 'fact is not known' };
    case 'PostNotice':
      return knownFacts(actor).includes(intent.fact)
        ? { ok: true }
        : { ok: false, reason: 'fact is not known' };
    case 'Repair':
      if (actor.place !== 'reservoir') return { ok: false, reason: 'pump is at reservoir' };
      if (actor.inventory.parts < 2) return { ok: false, reason: 'repair requires two parts' };
      if (state.pumpHealth >= 100) return { ok: false, reason: 'pump does not need repair' };
      return { ok: true };
    case 'Treat':
      if (state.simkins[intent.target].place !== actor.place) return { ok: false, reason: 'patient is elsewhere' };
      if (actor.inventory.medicine <= 0) return { ok: false, reason: 'no medicine carried' };
      return state.simkins[intent.target].illness > 0
        ? { ok: true }
        : { ok: false, reason: 'patient is not ill' };
    case 'Wait':
      return { ok: true };
  }
}

function applyIntent(state: SettlementState, input: SettlementInput): SettlementState {
  const next = structuredClone(state);
  const actor = next.simkins[input.simkinId];
  const intent = input.intent;
  switch (intent.kind) {
    case 'Move': actor.place = intent.to; break;
    case 'Collect':
      actor.inventory.water += 1;
      next.reservoirWater -= 1;
      break;
    case 'Ask':
      next.requests.push({
        id: `request:${next.tick}:${actor.id}:${intent.to}:${intent.resource}`,
        from: actor.id,
        to: intent.to,
        resource: intent.resource,
        createdTick: next.tick,
        resolved: false,
      });
      break;
    case 'Give': {
      const recipient = next.simkins[intent.to];
      actor.inventory[intent.resource] -= 1;
      recipient.inventory[intent.resource] += 1;
      recipient.trust[actor.id] += 1;
      const request = next.requests.find((item) =>
        !item.resolved && item.from === recipient.id && item.to === actor.id && item.resource === intent.resource,
      );
      if (request !== undefined) request.resolved = true;
      break;
    }
    case 'Share':
      addFact(next, intent.to, intent.fact, `conversation:${actor.id}`);
      next.simkins[intent.to].trust[actor.id] += 1;
      break;
    case 'PostNotice':
      if (!next.notices.includes(intent.fact)) next.notices.push(intent.fact);
      break;
    case 'Repair':
      actor.inventory.parts -= 2;
      next.pumpHealth = 100;
      break;
    case 'Treat':
      actor.inventory.medicine -= 1;
      next.simkins[intent.target].illness = Math.max(0, next.simkins[intent.target].illness - 2);
      next.simkins[intent.target].trust[actor.id] += 2;
      break;
    case 'Wait': break;
  }
  return next;
}

function describe(intent: SettlementIntent): string {
  switch (intent.kind) {
    case 'Move': return `Move(${intent.to})`;
    case 'Collect': return 'Collect(water)';
    case 'Ask': return `Ask(${intent.to}, ${intent.resource})`;
    case 'Give': return `Give(${intent.to}, ${intent.resource})`;
    case 'Share': return `Share(${intent.to}, ${intent.fact})`;
    case 'PostNotice': return `PostNotice(${intent.fact})`;
    case 'Repair': return 'Repair(pump)';
    case 'Treat': return `Treat(${intent.target})`;
    case 'Wait': return 'Wait';
  }
}

function observeLocalFacts(state: SettlementState): void {
  for (const id of simkinIds) {
    const actor = state.simkins[id];
    if (actor.place === 'reservoir' && state.pumpHealth < 50) addFact(state, id, 'pump-failed', 'observation');
    if (actor.place === state.simkins.ren.place && state.simkins.ren.illness > 0) addFact(state, id, 'ren-sick', 'observation');
    if (actor.place === state.simkins.nia.place && state.simkins.nia.illness > 0) addFact(state, id, 'nia-sick', 'observation');
  }
}

function environment(state: SettlementState): SettlementState {
  const next = structuredClone(state);
  const events: string[] = [];
  if (next.tick === 6) {
    next.pumpHealth = 25;
    events.push('The reservoir pump fails under load.');
  }
  if (next.tick === 14) {
    next.bridgeOpen = false;
    events.push('The unsafe farm bridge collapses.');
  }
  if (next.tick === 18) {
    next.simkins.nia.illness = 2;
    events.push('Nia falls ill after drinking stale water.');
  }
  if (next.tick >= 6 && next.pumpHealth < 100) {
    next.pumpHealth = Math.max(0, next.pumpHealth - 4);
    next.metrics.pumpDowntimeTicks += 1;
  }
  if (next.pumpHealth > 0) next.reservoirWater = Math.min(12, next.reservoirWater + 1);

  for (const id of simkinIds) {
    const actor = next.simkins[id];
    if (next.tick > 0 && next.tick % 4 === 0) {
      if (actor.inventory.water > 0) actor.inventory.water -= 1;
      else {
        actor.thirst += 1;
        next.metrics.waterDeficitTicks += 1;
      }
    }
    if (next.tick > 0 && next.tick % 6 === 0) {
      if (actor.inventory.food > 0) actor.inventory.food -= 1;
      else {
        actor.hunger += 1;
        next.metrics.foodDeficitTicks += 1;
      }
    }
    if (actor.illness > 0) next.metrics.untreatedIllnessTicks += 1;
  }
  observeLocalFacts(next);
  next.recentEvents = [...next.recentEvents, ...events.map((event) => `${next.tick}: ${event}`)].slice(-12);
  return next;
}

export function stepSettlement(
  initialState: SettlementState,
  inputs: readonly SettlementInput[],
): SettlementState {
  let state = environment(initialState);
  state = {
    ...state,
    decisions: recordDecisionBatch(
      state.decisions,
      state.tick,
      inputs,
      (input) => requestFor(state, input.simkinId),
    ),
  };
  const execution = executeHostInputs(state, inputs, {
    validate,
    apply: applyIntent,
    fallbackReason: (input) => input.fallbackReason,
  });
  state = {
    ...execution.world,
    decisions: recordDecisionOutcomes(execution.world.decisions, state.tick, execution.outcomes),
  };
  const actionEvents = execution.outcomes.map((outcome, index) => {
    const reason = 'reason' in outcome ? ` — ${outcome.reason}` : '';
    return `${state.tick}: ${inputs[index].simkinId} ${describe(inputs[index].intent)} → ${outcome.status}${reason}`;
  });
  state.recentEvents = [...state.recentEvents, ...actionEvents].slice(-12);
  state.tick += 1;
  return state;
}

export function settlementReport(state: SettlementState): SettlementReport {
  const outcomes = state.decisions.flatMap((decision) => decision.outcome === undefined ? [] : [decision.outcome]);
  const facts = ['bridge-unsafe', 'pump-degrading', 'pump-failed', 'ren-sick', 'nia-sick'] as const;
  let repeatedActions = 0;
  for (const id of simkinIds) {
    const actions = state.decisions
      .filter((decision) => decision.input.simkinId === id)
      .map((decision) => decision.input.intent)
      .filter((intent) => intent.kind !== 'Wait')
      .map((intent) => JSON.stringify(intent));
    for (let index = 1; index < actions.length; index += 1) {
      if (actions[index] === actions[index - 1]) repeatedActions += 1;
    }
  }
  const initialTrust = 3;
  const currentTrust = simkinIds.reduce((sum, id) =>
    sum + simkinIds.reduce((inner, other) => inner + state.simkins[id].trust[other], 0), 0);
  return {
    tick: state.tick,
    pumpHealth: state.pumpHealth,
    bridgeOpen: state.bridgeOpen,
    reservoirWater: state.reservoirWater,
    alive: simkinIds.filter((id) => state.simkins[id].illness < 5).length,
    rejected: outcomes.filter((outcome) => outcome.status === 'rejected').length,
    fallbacks: outcomes.filter((outcome) => outcome.status === 'fallback').length,
    fulfilledRequests: state.requests.filter((request) => request.resolved).length,
    factsKnown: Object.fromEntries(facts.map((fact) => [
      fact,
      simkinIds.filter((id) => knownFacts(state.simkins[id]).includes(fact)).length,
    ])) as Record<FactId, number>,
    trustDelta: currentTrust - initialTrust,
    repeatedActions,
    metrics: { ...state.metrics },
  };
}
