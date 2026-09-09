import type { ActionProposal, JsonObject, JsonValue } from 'simkind/format';
import type { HostDescriptor, HostRegistration, PreparedLaunch, RunnerStorage } from 'simkind/runner';
import { LocalHost, capabilities, clocks, limits, type WorldEdit } from '../portable/hosts/support.js';
import { economyCatalog } from './catalog.js';
import { affordable, allCoins, closeDay, costs, dayAt, empty, finishWork, nonempty, ownedInventory, put, releaseOffer, take, yieldFor, type EconomyWorld, type Holdings, type Offer, type Person, type Task, type Terms, type Work } from './model.js';
import { economyReport, reportSchemaId } from './report.js';

export class EconomyHost extends LocalHost<EconomyWorld> {
  constructor(launch: PreparedLaunch, storage?: RunnerStorage, descriptor: HostDescriptor = economyHost.descriptor) {
    const initial = structuredClone(launch.scenario.initialConditions) as unknown as Pick<EconomyWorld, 'days' | 'roundsPerDay' | 'foodMultiplier' | 'publicWealth'> & { people: Record<string, Pick<Person, 'inventory' | 'skills'>> };
    const people = Object.fromEntries(Object.entries(initial.people).map(([id, p]) => [id, { ...p, workedDay: 0, hungry: false, missedMeals: 0, selfShifts: 0, paidShifts: 0, earned: 0 }]));
    super(launch, descriptor, { ...initial, people, offers: [], work: {}, messages: [], transactions: [], history: [], initialCoins: Object.values(people).reduce((n, p) => n + p.inventory.coins, 0), completed: false }, storage, descriptor.implementationVersion === '1.2.0');
  }
  isComplete() { return this.world.completed; }
  decisionActors() { return this.world.completed ? [] : super.decisionActors(); }
  private horizon() { return this.world.days * this.world.roundsPerDay; }
  observe(actor: string) {
    const person = this.world.people[actor];
    return this.observation(actor, JSON.parse(JSON.stringify({ day: dayAt(this.world, this.tick), round: this.tick, finalRound: this.horizon(), completed: this.world.completed,
      rules: 'One productive shift per day; 4-use tools; one food consumed at day end. Missed meals halve next-day yield (minimum 1). Coins are conserved. Public offers/trades; private balances unless wealth is revealed. No fixed prices, guaranteed buyers, or automatic wages. Speech is nonbinding.',
      roundsPerDay: this.world.roundsPerDay, you: { ...person, balances: this.balances(actor), shiftAvailable: person.workedDay !== dayAt(this.world, this.tick) },
      productionNow: Object.fromEntries((['food', 'timber', 'tools'] as Task[]).map(task => [task, { withoutTool: yieldFor(this.world, actor, task, false), ...(task !== 'tools' ? { withTool: yieldFor(this.world, actor, task, true) } : {}), timberCost: task === 'tools' ? 2 : 0 }])),
      participants: Object.fromEntries(Object.entries(this.world.people).map(([id, p]) => [id, { skills: p.skills, ...(this.world.publicWealth ? { inventory: p.inventory } : {}) }])),
      offers: this.world.offers.filter(o => o.status === 'open' || o.status === 'working').map(({ escrow: _escrow, materials: _materials, ...o }) => o),
      recentTransactions: this.eventPerception ? [] : this.world.transactions.slice(-6), messages: this.eventPerception ? [] : this.world.messages.filter(m => m.to === null || m.to === actor || m.from === actor).slice(-8),
    })) as JsonValue);
  }
  operatorObservations() {
    return [{ id: `market:${this.tick}:${this.version}`, runId: this.launch.runId, recipient: 'operator:market', source: 'example.economy', capturedAt: this.time(), deliveredAt: this.time(), revision: this.version,
      content: [{ type: 'data' as const, schemaId: reportSchemaId, data: JSON.parse(JSON.stringify(economyReport(this.inspect()))) as JsonValue }] }];
  }
  private transactionCursor = 0;
  protected afterCommit(p: ActionProposal) {
    if (!this.eventPerception) return;
    if (p.toolId === 'say') this.retainMessage({ from: p.actor, to: p.arguments.to as string | null, text: String(p.arguments.text) }, `dialogue:${p.id}`);
    this.publishEvents();
  }
  protected publishEvents() {
    if (!this.eventPerception) return;
    while (this.transactionCursor < this.world.transactions.length) {
      const index = this.transactionCursor++, transaction = this.world.transactions[index];
      this.publishEvent({ id: `economy-receipt:${index}`, kind: 'receipt', authority: 'host',
        recipients: [...this.actors], data: JSON.parse(JSON.stringify(transaction)) },
        { clockId: 'clock:simulation', value: transaction.tick });
    }
  }
  private balances(actor: string) {
    const available = structuredClone(this.world.people[actor].inventory), owned = ownedInventory(this.world, actor);
    const reserved = { coins: owned.coins - available.coins, food: owned.food - available.food, timber: owned.timber - available.timber, tools: owned.tools.length - available.tools.length };
    return { available, reserved, owned, meaning: 'Owned includes escrow and work materials. Available excludes reservations. Reserving goods is not a sale; these are totals, not deltas.' };
  }
  toolConstraints(actor: string): Record<string, JsonObject> {
    const candidates = this.world.offers.filter(o => o.status === 'open' && o.expiresAt > this.tick);
    const choices = (ids: string[]): JsonObject => ids.length ? { enum: ids } : { not: {} };
    return {
      offer: { type: 'object', properties: { expiresAt: { type: 'integer', minimum: this.tick + 1, maximum: Math.min(this.horizon() + 1, this.tick + this.world.roundsPerDay * 3) }, to: { enum: [null, ...this.actors.filter(id => id !== actor)] } } },
      accept: { type: 'object', properties: { offerId: choices(candidates.filter(o => o.owner !== actor && (o.to === null || o.to === actor)).map(o => o.id)) } },
      cancel: { type: 'object', properties: { offerId: choices(candidates.filter(o => o.owner === actor).map(o => o.id)) } },
    };
  }
  private workAllowed(world: EconomyWorld, actor: string, task: Task, useTool: boolean): string | undefined {
    if (world.people[actor].workedDay === dayAt(world, this.tick)) return 'You already spent your productive shift today. Negotiate or wait for tomorrow.';
    if (task === 'tools' && useTool) return 'Tools cannot boost tool crafting.';
    return undefined;
  }
  protected validate(world: EconomyWorld, proposal: ActionProposal): string | undefined {
    if (world.completed || this.tick < 1 || this.tick > this.horizon()) return 'The market is outside its active rounds.';
    const person = world.people[proposal.actor];
    const args = proposal.arguments;
    if (proposal.toolId === 'say') return args.to !== null && (!Object.hasOwn(world.people, String(args.to)) || args.to === proposal.actor) ? 'Choose another participant or everyone.' : undefined;
    if (proposal.toolId === 'produce') return this.workAllowed(world, proposal.actor, args.task as Task, args.useTool as boolean) ?? (!affordable(person.inventory, costs(args.task as Task, args.useTool as boolean)) ? 'Insufficient materials or tool.' : undefined);
    if (proposal.toolId === 'offer') {
      const terms = args as unknown as Terms;
      if (terms.to !== null && (!Object.hasOwn(world.people, terms.to) || terms.to === proposal.actor)) return 'Choose another participant or an open offer.';
      if (terms.giveToolMinUses !== undefined && !terms.give.tools || terms.wantToolMinUses !== undefined && !terms.want.tools) return 'Tool quality requires tools on the corresponding side of a trade.';
      if (!nonempty(terms.give)) return 'Reserve something to give or pay.';
      if (terms.kind === 'trade' && (!nonempty(terms.want) || terms.task !== null || terms.useTool)) return 'Trade needs want resources, task=null and useTool=false.';
      if (terms.kind === 'job' && (nonempty(terms.want) || terms.task === null || terms.task === 'tools' && terms.useTool)) return 'A job names production, uses want={}, and cannot boost tool crafting.';
      if (terms.expiresAt <= this.tick || terms.expiresAt > Math.min(this.horizon() + 1, this.tick + world.roundsPerDay * 3)) return 'Expiration must be a future round within three days and the simulation horizon.';
      if (world.offers.filter(o => o.owner === proposal.actor && o.status === 'open').length >= 3) return 'Cancel an existing offer before posting more than three.';
      if (!affordable(person.inventory, terms.give, terms.giveToolMinUses)) return 'Insufficient available resources for escrow.';
      const remaining = structuredClone(person.inventory); take(remaining, terms.give, terms.giveToolMinUses);
      if (terms.kind === 'job' && !affordable(remaining, costs(terms.task, terms.useTool))) return 'Reserve wages and employer materials separately.';
      return undefined;
    }
    const offer = world.offers.find(o => o.id === args.offerId);
    if (!offer || offer.status !== 'open' || offer.expiresAt <= this.tick) return 'Offer is no longer open.';
    if (proposal.toolId === 'cancel') return offer.owner !== proposal.actor ? 'Only the owner can withdraw an open offer.' : undefined;
    if (offer.owner === proposal.actor || offer.to !== null && offer.to !== proposal.actor) return 'You cannot accept this offer.';
    if (offer.kind === 'trade') return affordable(person.inventory, offer.want, offer.wantToolMinUses) ? undefined : 'Insufficient available resources to accept.';
    return this.workAllowed(world, proposal.actor, offer.task, offer.useTool);
  }
  private beginWork(world: EconomyWorld, proposal: ActionProposal, task: Task, useTool: boolean, owner: string, materials: Holdings, offer?: Offer) {
    const person = world.people[proposal.actor]; person.workedDay = dayAt(world, this.tick);
    if (offer) { person.paidShifts++; offer.status = 'working'; offer.worker = proposal.actor; } else person.selfShifts++;
    const work: Work = { actor: proposal.actor, owner, task, quantity: yieldFor(world, proposal.actor, task, useTool), due: this.tick + 1, materials, actionId: proposal.id, ...(offer ? { offerId: offer.id } : {}) };
    Object.defineProperty(world.work, proposal.actor, { value: work, enumerable: true, configurable: true, writable: true });
  }
  protected apply(world: EconomyWorld, proposal: ActionProposal) {
    const next = structuredClone(world); const args = proposal.arguments; const person = next.people[proposal.actor];
    if (proposal.toolId === 'say') next.messages.push({ tick: this.tick, from: proposal.actor, to: args.to as string | null, text: args.text as string });
    if (proposal.toolId === 'produce') this.beginWork(next, proposal, args.task as Task, args.useTool as boolean, proposal.actor, take(person.inventory, costs(args.task as Task, args.useTool as boolean)));
    if (proposal.toolId === 'offer') {
      const terms = args as unknown as Terms;
      next.offers.push({ ...terms, id: proposal.id, owner: proposal.actor, status: 'open', escrow: take(person.inventory, terms.give, terms.giveToolMinUses), materials: terms.kind === 'job' ? take(person.inventory, costs(terms.task, terms.useTool)) : empty() });
    }
    if (proposal.toolId === 'cancel') releaseOffer(next, next.offers.find(o => o.id === args.offerId)!, 'cancelled');
    if (proposal.toolId === 'accept') {
      const offer = next.offers.find(o => o.id === args.offerId)!;
      if (offer.kind === 'trade') {
        const payment = take(person.inventory, offer.want, offer.wantToolMinUses);
        const transferred = { give: structuredClone(offer.escrow), want: structuredClone(payment) };
        put(next.people[offer.owner].inventory, payment); put(person.inventory, offer.escrow);
        offer.escrow = empty(); offer.status = 'filled';
        next.transactions.push({ tick: this.tick, kind: 'trade', from: offer.owner, to: proposal.actor, give: offer.give, want: offer.want, transferred });
      } else {
        this.beginWork(next, proposal, offer.task, offer.useTool, offer.owner, offer.materials, offer); offer.materials = empty();
      }
    }
    this.check(next); return next;
  }
  protected running(proposal: ActionProposal) { return Object.hasOwn(this.world.work, proposal.actor) && (this.world.work[proposal.actor] as Work).actionId === proposal.id; }
  protected result(proposal: ActionProposal): JsonValue {
    return JSON.parse(JSON.stringify({ toolId: proposal.toolId, arguments: proposal.arguments, inventory: this.world.people[proposal.actor].inventory, balances: this.balances(proposal.actor),
      effect: proposal.toolId === 'offer' ? 'offer-posted-and-resources-reserved; no trade or job completed' : proposal.toolId === 'say' ? 'speech-delivered; contents unverified and nonbinding' : proposal.toolId === 'cancel' ? 'offer-cancelled-and-reservations-returned' : proposal.toolId === 'produce' ? 'production-completed' : 'accepted-contract-completed',
      ...(proposal.toolId === 'offer' ? { offerId: proposal.id, offerStatus: 'open' } : {}),
      ...(proposal.toolId === 'accept' ? { transaction: this.world.transactions.at(-1) } : {}) }));
  }
  protected advanceWorld() {
    if (this.world.completed) return;
    for (const [actor, work] of Object.entries(this.world.work)) {
      if (work.due > this.tick) continue;
      finishWork(this.world, work, this.tick); delete this.world.work[actor]; this.version++;
      this.finish(this.ledger.get((work as Work).actionId)!.proposal);
    }
    for (const offer of this.world.offers) if (offer.status === 'open' && offer.expiresAt <= this.tick) { releaseOffer(this.world, offer, 'expired'); this.version++; }
    if (this.tick > 1 && (this.tick - 1) % this.world.roundsPerDay === 0) {
      const day = (this.tick - 1) / this.world.roundsPerDay;
      if (day === this.world.days) { for (const offer of this.world.offers) if (offer.status === 'open') releaseOffer(this.world, offer, 'expired'); this.world.completed = true; }
      closeDay(this.world, day); this.version++;
    }
    this.check(this.world);
  }
  protected cancelRunning(proposal: ActionProposal) {
    if (!Object.hasOwn(this.world.work, proposal.actor)) return false;
    const work = this.world.work[proposal.actor];
    put(this.world.people[work.owner].inventory, work.materials);
    if (work.offerId) releaseOffer(this.world, this.world.offers.find(o => o.id === work.offerId)!, 'cancelled');
    delete this.world.work[proposal.actor]; this.check(this.world); return true;
  }
  protected editWorld(world: EconomyWorld, proposal: ActionProposal): WorldEdit<EconomyWorld> {
    if (world.completed) return { reason: 'The economy has completed its horizon.' };
    const before = { foodMultiplier: world.foodMultiplier, publicWealth: world.publicWealth };
    if (proposal.toolId === 'operator.harvest') world.foodMultiplier = proposal.arguments.multiplier as number;
    if (proposal.toolId === 'operator.wealth') world.publicWealth = proposal.arguments.visible as boolean;
    return { world, effects: { before, after: { foodMultiplier: world.foodMultiplier, publicWealth: world.publicWealth } } };
  }
  private check(world: EconomyWorld) {
    if (allCoins(world) !== world.initialCoins) throw new Error('Coin conservation violated.');
    const inventories = [...Object.values(world.people).map(p => p.inventory), ...world.offers.flatMap(o => [o.escrow, o.materials]), ...Object.values(world.work).map(w => w.materials)];
    for (const stock of inventories) if (![stock.coins, stock.food, stock.timber].every(n => Number.isSafeInteger(n) && n >= 0) || stock.tools.some(d => !Number.isInteger(d) || d < 1 || d > 4)) throw new Error('Invalid economy inventory.');
  }
}
const quantity = { type: 'integer', minimum: 0, maximum: 1000000 };
const object = (properties: Record<string, JsonObject>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
export const economyHost: HostRegistration = {
  descriptor: { contractId: 'example.economy', version: '1.1.0', implementationVersion: '1.1.0', toolCatalog: economyCatalog, limits: { ...limits, requestTimeoutMs: 300000 }, capabilities, clocks: [...clocks],
    initialConditionsSchema: object({ days: { type: 'integer', minimum: 1, maximum: 30 }, roundsPerDay: { type: 'integer', minimum: 2, maximum: 8 }, foodMultiplier: { type: 'number', minimum: 0.25, maximum: 2 }, publicWealth: { type: 'boolean' }, people: { type: 'object', minProperties: 2, maxProperties: 8, additionalProperties: object({ inventory: object({ coins: quantity, food: quantity, timber: quantity, tools: { type: 'array', maxItems: 100, items: { type: 'integer', minimum: 1, maximum: 4 } } }), skills: object({ food: { type: 'integer', minimum: 1, maximum: 8 }, timber: { type: 'integer', minimum: 1, maximum: 8 }, tools: { type: 'integer', minimum: 1, maximum: 4 } }) }) } }),
    interventions: [
      { id: 'operator.harvest', version: '1.0.0', description: 'Change food productivity for future shifts. Existing jobs keep their admitted yield; change it back later to end a shock.', inputSchema: object({ multiplier: { type: 'number', minimum: 0.25, maximum: 2 } }) },
      { id: 'operator.wealth', version: '1.0.0', description: 'Reveal or hide current inventories in future character observations. Previously learned information is not erased.', inputSchema: object({ visible: { type: 'boolean' } }) },
    ],
  },
  validateInitial(scene) {
    const people = scene.initialConditions.people as JsonObject;
    return JSON.stringify(Object.keys(people).sort()) === JSON.stringify(scene.cast.map(c => c.instanceId).sort()) ? [] : [{ stage: 'referential', code: 'INVALID_ECONOMY_CAST', documentId: scene.id, pointer: '/initialConditions/people', message: 'Supply exactly one inventory and skill set per cast member.' }];
  },
  create: (launch, runtime) => new EconomyHost(launch, runtime?.storage), restore: (launch, snapshot, runtime) => { const host = new EconomyHost(launch, runtime?.storage); host.restore(snapshot); return host; },
};

export const economyPerceptionHost: HostRegistration = { ...economyHost,
  descriptor: { ...economyHost.descriptor, implementationVersion: '1.2.0' },
  create: (launch, runtime) => new EconomyHost(launch, runtime?.storage, economyPerceptionHost.descriptor),
  restore: (launch, snapshot, runtime) => { const host = new EconomyHost(launch, runtime?.storage, economyPerceptionHost.descriptor); host.restore(snapshot); return host; },
};
