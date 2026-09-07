import type {
  FactId,
  Place,
  SettlementIntent,
  SettlementProvider,
  SettlementRequest,
  SimkinId,
  SimkinSnapshot,
} from './types.js';

function present(snapshot: SimkinSnapshot, id: SimkinId) {
  return snapshot.present.find((simkin) => simkin.id === id);
}

function move(snapshot: SimkinSnapshot, destination: Place): SettlementIntent {
  if (snapshot.legalDestinations.includes(destination)) return { kind: 'Move', to: destination };
  if (snapshot.self.place !== 'square' && snapshot.legalDestinations.includes('square')) {
    return { kind: 'Move', to: 'square' };
  }
  return { kind: 'Wait' };
}

function knows(snapshot: SimkinSnapshot, fact: FactId): boolean {
  return snapshot.knownFacts.includes(fact) || snapshot.notices.includes(fact);
}

function fulfillRequest(snapshot: SimkinSnapshot): SettlementIntent | undefined {
  const request = snapshot.requestsToMe.find((candidate) =>
    snapshot.self.inventory[candidate.resource] > 0 && present(snapshot, candidate.from) !== undefined,
  );
  if (request === undefined) return undefined;
  const requester = present(snapshot, request.from)!;
  const trust = snapshot.self.trust[request.from];
  const urgent = requester.hunger > 0 || requester.thirst > 0 || request.resource === 'parts';
  return trust >= 0 || urgent
    ? { kind: 'Give', to: request.from, resource: request.resource }
    : { kind: 'Wait' };
}

function aya(snapshot: SimkinSnapshot): SettlementIntent {
  const fulfillment = fulfillRequest(snapshot);
  if (fulfillment !== undefined) return fulfillment;
  if (snapshot.self.inventory.parts < 2) {
    if (present(snapshot, 'sol') !== undefined) {
      if (!snapshot.myOpenRequests.some((request) => request.to === 'sol' && request.resource === 'parts')) {
        return { kind: 'Ask', to: 'sol', resource: 'parts' };
      }
      return { kind: 'Wait' };
    }
    if (snapshot.myOpenRequests.some((request) => request.to === 'sol' && request.resource === 'parts')) {
      return move(snapshot, 'square');
    }
    return move(snapshot, 'farm');
  }
  if (snapshot.self.place !== 'reservoir') return move(snapshot, 'reservoir');
  if ((snapshot.pumpHealth ?? 100) < 100) return { kind: 'Repair', target: 'pump' };
  return { kind: 'Wait' };
}

function mira(snapshot: SimkinSnapshot): SettlementIntent {
  const ill = snapshot.present.find((simkin) => simkin.illness > 0);
  if (ill !== undefined && snapshot.self.inventory.medicine > 0) return { kind: 'Treat', target: ill.id };
  if (knows(snapshot, 'ren-sick') && snapshot.self.inventory.medicine > 0) {
    return snapshot.self.place === 'square' ? { kind: 'Wait' } : move(snapshot, 'square');
  }
  if (knows(snapshot, 'nia-sick') && snapshot.self.inventory.medicine > 0) return move(snapshot, 'square');
  return { kind: 'Wait' };
}

function sol(snapshot: SimkinSnapshot): SettlementIntent {
  const fulfillment = fulfillRequest(snapshot);
  if (fulfillment !== undefined) return fulfillment;
  if (snapshot.self.place === 'farm' && knows(snapshot, 'bridge-unsafe')) return move(snapshot, 'square');
  const needy = snapshot.present.find((simkin) => simkin.hunger > 0);
  if (needy !== undefined && snapshot.self.inventory.food > 0 && snapshot.self.trust[needy.id] >= 0) {
    return { kind: 'Give', to: needy.id, resource: 'food' };
  }
  return { kind: 'Wait' };
}

function ivo(snapshot: SimkinSnapshot): SettlementIntent {
  if (snapshot.knownFacts.includes('bridge-unsafe') && !snapshot.notices.includes('bridge-unsafe')) {
    return { kind: 'PostNotice', fact: 'bridge-unsafe' };
  }
  if (snapshot.knownFacts.includes('pump-failed') && !snapshot.notices.includes('pump-failed')) {
    return { kind: 'PostNotice', fact: 'pump-failed' };
  }
  if (snapshot.tick >= 4 && snapshot.tick < 8 && snapshot.self.place !== 'reservoir') return move(snapshot, 'reservoir');
  if (snapshot.self.place === 'reservoir' && snapshot.self.inventory.water === 0) {
    return { kind: 'Collect', resource: 'water' };
  }
  return { kind: 'Wait' };
}

function nia(snapshot: SimkinSnapshot): SettlementIntent {
  const fulfillment = fulfillRequest(snapshot);
  if (fulfillment !== undefined) return fulfillment;
  const thirsty = snapshot.present.find((simkin) => simkin.thirst > 0);
  if (thirsty !== undefined && snapshot.self.inventory.water > 0) {
    return { kind: 'Give', to: thirsty.id, resource: 'water' };
  }
  return { kind: 'Wait' };
}

function ren(snapshot: SimkinSnapshot): SettlementIntent {
  if (snapshot.self.illness > 0) {
    if (present(snapshot, 'mira') !== undefined) return { kind: 'Wait' };
    return snapshot.tick === 0 ? { kind: 'Wait' } : move(snapshot, 'clinic');
  }
  const resource = snapshot.self.inventory.water === 0 ? 'water' : 'food';
  const target = snapshot.present.find((simkin) => simkin.inventory[resource] > 0);
  if (
    target !== undefined &&
    !snapshot.myOpenRequests.some((request) => request.to === target.id && request.resource === resource)
  ) {
    return { kind: 'Ask', to: target.id, resource };
  }
  return { kind: 'Wait' };
}

export function chooseScripted(request: SettlementRequest): SettlementIntent {
  switch (request.simkinId) {
    case 'aya': return aya(request.snapshot);
    case 'mira': return mira(request.snapshot);
    case 'sol': return sol(request.snapshot);
    case 'ivo': return ivo(request.snapshot);
    case 'nia': return nia(request.snapshot);
    case 'ren': return ren(request.snapshot);
  }
}

export const scriptedProvider: SettlementProvider = {
  name: 'deterministic settlement policy',
  decide: async (request) => chooseScripted(request),
};
