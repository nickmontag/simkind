import type { HostDescriptor, HostRegistration, PreparedLaunch, RunnerStorage } from 'simkind/runner';
import type { ActionProposal, JsonObject, JsonValue, ToolCatalog } from 'simkind/format';
import { LocalHost, limits, capabilities, clocks, type WorldEdit } from './support.js';

const input = (properties: Record<string, JsonObject>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
export const settlementCatalog: ToolCatalog = {
  specVersion: '0.2.0-draft.2', kind: 'tool-catalog', id: 'catalog:settlement', host: { contractId: 'example.settlement', version: '1.0.0' },
  tools: [
    { id: 'move', version: '1.0.0', description: 'Travel along an open edge. Arrival occurs after the configured travel ticks; cancellation leaves you at the origin.', inputSchema: input({ to: { type: 'string' } }), lifecycle: { asynchronous: true, cancellable: true } },
    { id: 'collect', version: '1.0.0', description: 'Collect one unit from the stock at your current location.', inputSchema: input({ resource: { type: 'string' } }), lifecycle: { asynchronous: false, cancellable: false } },
    { id: 'give', version: '1.0.0', description: 'Give one carried unit to a participant at your location.', inputSchema: input({ resource: { type: 'string' }, to: { type: 'string' } }), lifecycle: { asynchronous: false, cancellable: false } },
    { id: 'say', version: '1.0.0', description: 'Speak to everyone currently at your location. Claims in speech do not move resources or repair anything.', inputSchema: input({ text: { type: 'string', maxLength: 4000 } }), lifecycle: { asynchronous: false, cancellable: false } },
    { id: 'repair', version: '1.0.0', description: 'Repair the pump at its location by consuming the configured number of parts.', inputSchema: input({}), lifecycle: { asynchronous: false, cancellable: false } },
  ],
};
interface Place { id: string; neighbors: string[]; stock: Record<string, number> }
interface World {
  sharedContext: string; places: Place[]; positions: Record<string, string>; inventories: Record<string, Record<string, number>>;
  pump: { location: string; broken: boolean; partsRequired: number }; travelTicks: number;
  travelling: Record<string, { proposal: ActionProposal; due: number; to: string }>;
  messages: { from: string; recipients: string[]; text: string }[];
}
class SettlementHost extends LocalHost<World> {
  constructor(launch: PreparedLaunch, descriptor = settlementHost.descriptor, storage?: RunnerStorage) {
    const initial = structuredClone(launch.scenario.initialConditions);
    super(launch, descriptor, { ...initial, travelling: {}, messages: [] } as unknown as World, storage, descriptor.implementationVersion === '1.2.0');
  }
  observe(actor: string) {
    const place = this.world.places.find((entry) => entry.id === this.world.positions[actor])!;
    return this.observation(actor, { sharedContext: this.world.sharedContext, place: place.id, destinations: place.neighbors,
      stock: place.stock, inventory: this.world.inventories[actor],
      present: this.actors.filter((other) => this.world.positions[other] === place.id),
      pump: this.world.pump.location === place.id ? this.world.pump : null,
      travelling: Object.hasOwn(this.world.travelling, actor) ? { to: this.world.travelling[actor].to, due: this.world.travelling[actor].due } : null,
      messages: this.eventPerception ? [] : this.storage ? this.newMessages(actor) : this.world.messages.filter((message) => message.recipients.includes(actor)) });
  }
  protected validate(world: World, proposal: ActionProposal) {
    const actor = proposal.actor;
    if (Object.hasOwn(world.travelling, actor)) return 'Finish or cancel your travel before another action.';
    const place = world.places.find((entry) => entry.id === world.positions[actor])!;
    if (proposal.toolId === 'move' && !place.neighbors.includes(proposal.arguments.to as string)) return 'Route is unavailable.';
    if (proposal.toolId === 'collect' && !(place.stock[proposal.arguments.resource as string] > 0)) return 'No such resource remains here.';
    if (proposal.toolId === 'collect' && proposal.arguments.resource === 'water' && place.id === world.pump.location && world.pump.broken) return 'Repair the pump before drawing reservoir water.';
    if (proposal.toolId === 'give') {
      if (!this.actors.includes(proposal.arguments.to as string) || proposal.arguments.to === actor || world.positions[proposal.arguments.to as string] !== place.id) return 'Recipient must be another participant at your location.';
      if (!(world.inventories[actor][proposal.arguments.resource as string] > 0)) return 'You do not carry that resource.';
    }
    if (proposal.toolId === 'repair' && (place.id !== world.pump.location || !world.pump.broken || !(world.inventories[actor].parts >= world.pump.partsRequired))) return 'Repair needs a broken local pump and enough carried parts.';
    return undefined;
  }
  protected apply(world: World, proposal: ActionProposal) {
    const next = structuredClone(world);
    const actor = proposal.actor;
    const resource = proposal.arguments.resource as string;
    const place = next.places.find((entry) => entry.id === next.positions[actor])!;
    if (proposal.toolId === 'move') Object.defineProperty(next.travelling, actor, { value: { proposal, to: proposal.arguments.to, due: this.tick + next.travelTicks }, enumerable: true, configurable: true });
    if (proposal.toolId === 'collect') { place.stock[resource]--; next.inventories[actor][resource] = (Object.hasOwn(next.inventories[actor], resource) ? next.inventories[actor][resource] : 0) + 1; }
    if (proposal.toolId === 'give') { next.inventories[actor][resource]--; const recipient = next.inventories[proposal.arguments.to as string]; recipient[resource] = (Object.hasOwn(recipient, resource) ? recipient[resource] : 0) + 1; }
    if (proposal.toolId === 'say') next.messages.push({ from: actor, text: proposal.arguments.text as string, recipients: this.actors.filter((other) => next.positions[other] === place.id) });
    if (proposal.toolId === 'repair') { next.inventories[actor].parts -= next.pump.partsRequired; next.pump.broken = false; }
    if (this.storage) next.messages = next.messages.slice(-32);
    return next;
  }
  protected afterCommit(proposal: ActionProposal) {
    if (proposal.toolId === 'say') this.retainMessage(this.world.messages.at(-1)!, `dialogue:${proposal.id}`);
  }
  protected result(proposal: ActionProposal): JsonValue { return { toolId: proposal.toolId, ...proposal.arguments, location: this.world.positions[proposal.actor], inventory: this.world.inventories[proposal.actor], inventoryMeaning: 'Current total holdings, not amounts produced or transferred.', effect: proposal.toolId === 'say' ? 'speech-delivered; contents are unverified' : proposal.toolId === 'move' ? 'travel-completed; arrived at location' : 'named-operation-completed' }; }
  protected running(proposal: ActionProposal) { return proposal.toolId === 'move'; }
  protected advanceWorld() {
    for (const [actor, travel] of Object.entries(this.world.travelling)) {
      if (travel.due > this.tick) continue;
      this.world.positions[actor] = travel.to;
      delete this.world.travelling[actor];
      this.version++;
      this.finish(travel.proposal);
    }
  }
  protected cancelRunning(proposal: ActionProposal) {
    if (!Object.hasOwn(this.world.travelling, proposal.actor)) return false;
    delete this.world.travelling[proposal.actor];
    return true;
  }
  protected editWorld(world: World, proposal: ActionProposal): WorldEdit<World> {
    if (proposal.toolId === 'operator.pump') {
      const before = world.pump.broken;
      world.pump.broken = proposal.arguments.broken as boolean;
      return { world, effects: { pump: { location: world.pump.location, before, after: world.pump.broken } } };
    }
    const place = world.places.find(p => p.id === proposal.arguments.place);
    if (!place) return { reason: 'Choose an existing place.' };
    const resource = proposal.arguments.resource as string;
    const before = Object.hasOwn(place.stock, resource) ? place.stock[resource] : null;
    const quantity = proposal.arguments.quantity as number;
    Object.defineProperty(place.stock, resource, { value: quantity, enumerable: true, writable: true, configurable: true });
    return { world, effects: { stock: { place: place.id, resource, before, after: quantity } } };
  }
}
const quantities = { type: 'object', propertyNames: { pattern: '^[A-Za-z][A-Za-z0-9_-]*$' }, additionalProperties: { type: 'integer', minimum: 0, maximum: 1000000 } };
export const settlementHost: HostRegistration = {
  descriptor: { contractId: 'example.settlement', version: '1.0.0', implementationVersion: '1.0.0', toolCatalog: settlementCatalog,
    limits, capabilities, clocks: [...clocks], initialConditionsSchema: {
      type: 'object', additionalProperties: false, required: ['sharedContext', 'places', 'positions', 'inventories', 'pump', 'travelTicks'], properties: {
        sharedContext: { type: 'string' },
        places: { type: 'array', minItems: 1, items: input({ id: { type: 'string' }, neighbors: { type: 'array', uniqueItems: true, items: { type: 'string' } }, stock: quantities }) },
        positions: { type: 'object', additionalProperties: { type: 'string' } }, inventories: { type: 'object', additionalProperties: quantities },
        pump: input({ location: { type: 'string' }, broken: { type: 'boolean' }, partsRequired: { type: 'integer', minimum: 1, maximum: 1000000 } }),
        travelTicks: { type: 'integer', minimum: 1, maximum: 100 },
      },
    } },
  validateInitial(scenario) {
    const initial = scenario.initialConditions as unknown as World;
    const actors = scenario.cast.map((member) => member.instanceId).sort();
    const places = initial.places.map((place) => place.id);
    const invalid = new Set(places).size !== places.length || !places.includes(initial.pump.location)
      || initial.places.some((place) => place.neighbors.some((neighbor) => !places.includes(neighbor)))
      || JSON.stringify(Object.keys(initial.positions).sort()) !== JSON.stringify(actors)
      || JSON.stringify(Object.keys(initial.inventories).sort()) !== JSON.stringify(actors)
      || Object.values(initial.positions).some((place) => !places.includes(place));
    return invalid ? [{ stage: 'referential', code: 'INVALID_WORLD_BINDING', documentId: scenario.id, pointer: '/initialConditions', message: 'Bind every cast instance once, and resolve all place, route, and pump references.' }] : [];
  },
  create: (launch, runtime) => new SettlementHost(launch, undefined, runtime?.storage),
  restore: (launch, snapshot, runtime) => { const host = new SettlementHost(launch, undefined, runtime?.storage); host.restore(snapshot); return host; },
};

const interventionDescriptor: HostDescriptor = { ...settlementHost.descriptor, implementationVersion: '1.1.0', interventions: [
  { id: 'operator.pump', version: '1.0.0', description: 'Change whether the pump is broken. Only characters at the pump observe its state.',
    inputSchema: input({ broken: { type: 'boolean', title: 'Pump broken' } }) },
  { id: 'operator.stock', version: '1.0.0', description: 'Set resource stock at an existing place. Characters learn it through local observations.',
    inputSchema: input({ place: { type: 'string', title: 'Place', minLength: 1 }, resource: { type: 'string', title: 'Resource', pattern: '^[A-Za-z][A-Za-z0-9_-]*$' }, quantity: { type: 'integer', title: 'Quantity', minimum: 0, maximum: 1000000 } }) },
] };
export const settlementInterventionHost: HostRegistration = {
  descriptor: interventionDescriptor, validateInitial: settlementHost.validateInitial,
  create: (launch, runtime) => new SettlementHost(launch, interventionDescriptor, runtime?.storage),
  restore: (launch, snapshot, runtime) => { const host = new SettlementHost(launch, interventionDescriptor, runtime?.storage); host.restore(snapshot); return host; },
};

export const settlementPerceptionHost: HostRegistration = { ...settlementInterventionHost,
  descriptor: { ...settlementInterventionHost.descriptor, implementationVersion: '1.2.0' },
  create: (launch, runtime) => new SettlementHost(launch, settlementPerceptionHost.descriptor, runtime?.storage),
  restore: (launch, snapshot, runtime) => { const host = new SettlementHost(launch, settlementPerceptionHost.descriptor, runtime?.storage); host.restore(snapshot); return host; },
};
