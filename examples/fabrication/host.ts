import type { ActionProposal, JsonObject, JsonValue } from 'simkind/format';
import type { HostDescriptor, HostRegistration, PreparedLaunch, RunnerStorage } from 'simkind/runner';
import { LocalHost, capabilities, clocks, limits, type WorldEdit } from '../portable/hosts/support.js';
import { fabricationCatalog, integer, object, orderSchema, stockSchema } from './catalog.js';
import { affordable, check, dayAt, describe, empty, name, nonempty, owned, put, release, take, visibleOrder, type OfferTerms, type Order, type OrderTerms, type Person, type ShopWorld, type Work } from './model.js';
import { shopReport, shopReportSchemaId } from './report.js';

export class FabricationHost extends LocalHost<ShopWorld> {
  constructor(launch: PreparedLaunch, storage?: RunnerStorage, descriptor: HostDescriptor = fabricationHost.descriptor) {
    const initial = structuredClone(launch.scenario.initialConditions) as unknown as Pick<ShopWorld, 'turns' | 'rentEvery' | 'rent' | 'till'> & { people: Record<string, Omit<Person, 'workedDay'>>; orders: OrderTerms[] };
    const people = Object.fromEntries(Object.entries(initial.people).map(([id, p]) => [id, { ...p, workedDay: 0 }]));
    super(launch, descriptor, { ...initial, people, orders: initial.orders.map(order => ({ ...order, status: 'open', revision: 1, claimant: null })),
      arrears: 0, paidRent: 0, initialCash: initial.till + Object.values(people).reduce((n, p) => n + p.inventory.cash, 0), customerRevenue: 0, supplierCosts: 0,
      completed: false, offers: [], loans: [], work: {}, messages: [], activity: [] }, storage, ['1.1.0', '1.2.0'].includes(descriptor.implementationVersion));
  }
  private get guided() { return this.descriptor.implementationVersion === '1.2.0'; }
  isComplete() { return this.world.completed; }
  decisionActors() { return this.world.completed ? [] : super.decisionActors(); }
  observe(actor: string) {
    const w = this.world, person = w.people[actor];
    const orders = w.orders.filter(order => visibleOrder(order, actor));
    return this.observation(actor, JSON.parse(JSON.stringify({ turn: this.tick, finalTurn: w.turns, day: dayAt(this.tick),
      rules: 'Fabrication shop. One productive shift per 4-turn day: manufacture, repair, or source. Other actions do not consume a shift. One material per product; one equipment use per batch. Quality is premium at 3–4 equipment uses on admission, standard at 1–2. Work finishes next turn. Orders pay their claimant only on full delivery. Deadlines are inclusive; amendments require a current order revision. Private leads are visible only to their recipient until published. Customer revenue and supplier/rent payments are external cash flows. Spoken promises, commissions and equity are nonbinding. Current facts below supersede remembered balances.',
      shop: { till: w.till, arrears: w.arrears, rent: w.rent, rentEvery: w.rentEvery, nextRent: (Math.floor(Math.max(0, this.tick - 1) / w.rentEvery) + 1) * w.rentEvery + 1, productionAvailable: w.arrears === 0 },
      you: { ...person, owned: owned(w, actor), shiftAvailable: person.workedDay !== dayAt(this.tick), inventoryMeaning: 'inventory is available stock; owned also includes reserved goods and equipment on loan. Totals, not deltas.' },
      participants: Object.fromEntries(Object.entries(w.people).map(([id, p]) => [id, { fabrication: p.fabrication, repair: p.repair, sourcingPrice: p.sourcingPrice }])),
      orders: [...orders.filter(o => o.status === 'open' || o.status === 'claimed'), ...orders.filter(o => o.status === 'delivered' || o.status === 'expired').slice(-4)],
      offers: w.offers.filter(o => o.status === 'open' || o.status === 'working').map(({ escrow: _e, inputs: _i, ...o }) => o),
      loans: w.loans, work: Object.values(w.work).map(({ inputs: _i, ...work }) => work),
      messages: this.eventPerception ? [] : w.messages.filter(m => m.to === null || m.to === actor || m.from === actor).slice(-12),
    })) as JsonValue);
  }
  private activityCursor = 0;
  protected afterCommit(p: ActionProposal) {
    if (!this.eventPerception) return;
    if (p.toolId === 'say') this.retainMessage({ from: p.actor, to: p.arguments.to as string | null, text: String(p.arguments.text) }, `dialogue:${p.id}`);
    if (['operator.add_order', 'operator.amend_order'].includes(p.toolId)) {
      const order = this.world.orders.find(o => o.id === p.arguments.id)!;
      this.publishEvent({ id: `order:${p.id}`, kind: 'receipt', authority: 'host',
        recipients: order.recipient ? [order.recipient] : this.actors, data: JSON.parse(JSON.stringify(order)), references: [p.id] });
    }
    this.publishEvents();
  }
  protected publishEvents() {
    if (!this.eventPerception) return;
    while (this.activityCursor < this.world.activity.length) {
      const index = this.activityCursor++, event = this.world.activity[index];
      // Operator market reports can contain private leads; only explicitly scoped receipts are delivered.
      if (event.quote || !this.actors.includes(event.actor)) continue;
      this.publishEvent({ id: `shop-receipt:${index}`, kind: 'receipt', authority: 'host', actor: event.actor,
        recipients: [event.actor], text: event.text, ...(event.actionId ? { references: [event.actionId] } : {}) },
        { clockId: 'clock:simulation', value: event.tick });
    }
  }
  operatorObservations() {
    return [{ id: `shop:${this.tick}:${this.version}`, runId: this.launch.runId, recipient: 'operator:shop', source: 'example.fabrication', capturedAt: this.time(), deliveredAt: this.time(), revision: this.version,
      content: [{ type: 'data' as const, schemaId: shopReportSchemaId, data: JSON.parse(JSON.stringify(shopReport(this.inspect()))) as JsonValue }] }];
  }
  toolConstraints(actor: string): Record<string, JsonObject> {
    const w = this.world;
    const choices = (ids: string[]): JsonObject => ids.length ? { enum: ids } : { not: {} };
    const field = (key: string, ids: string[]): JsonObject => ({ type: 'object', properties: { [key]: choices(ids) } });
    const workers = this.actors.filter(worker => worker !== actor);
    const jobLimits = workers.map(worker => ({
      if: { type: 'object', properties: { kind: { const: 'job' }, to: { const: worker } }, required: ['kind', 'to'] },
      then: { type: 'object', properties: { quantity: { type: 'integer', maximum: w.people[worker].fabrication } } },
    }));
    const orders = w.orders.filter(o => visibleOrder(o, actor) && o.deadline >= this.tick);
    return {
      claim_order: field('orderId', orders.filter(o => o.status === 'open').map(o => o.id)),
      deliver: field('orderId', orders.filter(o => o.status === 'claimed' && o.claimant === actor).map(o => o.id)),
      release_order: field('orderId', orders.filter(o => o.status === 'claimed' && o.claimant === actor).map(o => o.id)),
      publish_lead: field('orderId', orders.filter(o => o.recipient === actor && ['open', 'claimed'].includes(o.status)).map(o => o.id)),
      make: {
        ...field('equipment', ['owned', ...w.loans.filter(l => l.borrower === actor && !l.busy && l.uses > 0 && l.returnAt > this.tick).map(l => l.id)]),
        ...(this.eventPerception ? { allOf: [{ type: 'object', properties: { quantity: { type: 'integer', maximum: w.people[actor].fabrication } } }] } : {}),
      },
      say: { type: 'object', properties: { to: { enum: [null, ...workers] } } },
      offer: {
        type: 'object', ...(this.eventPerception ? { allOf: jobLimits } : {}),
        ...(this.guided ? { description: 'Posting reserves resources; it does not pay anyone or complete work. For a job, the employer supplies production inputs separately from compensation. A future customer payment cannot fund current escrow.' } : {}),
        properties: {
          ...(this.eventPerception ? { quantity: { type: 'integer', maximum: Math.max(...workers.map(worker => w.people[worker].fabrication)) } } : {}),
          ...(this.guided ? {
            give: { description: 'Resources paid to the recipient. For jobs these are wages, not production inputs: the host additionally reserves quantity materials and one qualifying owned tool from your remaining available stock. Non-cash wages are allowed but add to those separate requirements.' },
            want: { description: 'Resources received from the recipient in a trade or rental. Jobs require an empty object; their manufactured output goes to the employer automatically.' },
            minUses: { description: 'Minimum remaining uses guaranteed for selected equipment. This is not the number of batches promised. A job requires your available owned equipment; a worker’s rented equipment cannot be reserved by you.' },
          } : {}),
          to: { enum: [null, ...workers] },
          expiresAt: { type: 'integer', minimum: this.tick + 1, maximum: Math.min(w.turns + 1, this.tick + 12) },
        },
      },
      accept: field('offerId', w.offers.filter(o => o.status === 'open' && o.expiresAt > this.tick && o.owner !== actor && (o.to === null || o.to === actor)).map(o => o.id)),
      cancel: field('offerId', w.offers.filter(o => o.status === 'open' && o.owner === actor).map(o => o.id)),
      return_tool: field('loanId', w.loans.filter(l => l.borrower === actor && !l.busy).map(l => l.id)),
    };
  }
  private shift(w: ShopWorld, actor: string) { return w.people[actor].workedDay === dayAt(this.tick) || w.work[actor] ? 'Productive shift already spent today.' : undefined; }
  protected validate(w: ShopWorld, p: ActionProposal): string | undefined {
    if (w.completed || this.tick < 1 || this.tick > w.turns) return 'Outside the active shop turns.';
    const a = p.arguments, actor = p.actor, person = w.people[actor];
    if (p.toolId === 'say') return a.to !== null && (a.to === actor || !Object.hasOwn(w.people, String(a.to))) ? 'Unknown recipient or self message.' : undefined;
    if (['claim_order', 'deliver', 'release_order', 'publish_lead'].includes(p.toolId)) {
      const o = w.orders.find(o => o.id === a.orderId && visibleOrder(o, actor));
      if (!o || o.deadline < this.tick || !['open', 'claimed'].includes(o.status)) return 'Order is unavailable to you.';
      if (p.toolId === 'publish_lead') return o.recipient !== actor ? 'This is not your private lead.' : undefined;
      if (p.toolId === 'release_order') return o.claimant !== actor ? 'You do not hold this order.' : undefined;
      if (o.revision !== a.orderRevision) return 'Order terms changed. Read its current revision before acting.';
      if (p.toolId === 'claim_order') return o.status !== 'open' ? 'Order already claimed.' : undefined;
      if (o.claimant !== actor) return 'Only the claimant can deliver.';
      if (person.inventory.premium + (o.quality === 'standard' ? person.inventory.standard : 0) < o.quantity) return 'Insufficient available finished products of the required quality.';
    }
    if (['make', 'repair', 'source'].includes(p.toolId)) {
      const reason = this.shift(w, actor); if (reason) return reason;
      if (p.toolId !== 'source' && w.arrears > 0) return 'Production suspended until shared rent arrears are paid.';
      if (p.toolId === 'source') return person.inventory.cash < Number(a.quantity) * person.sourcingPrice ? 'Insufficient cash for supplier.' : undefined;
      if (p.toolId === 'repair') return !person.inventory.materials || !person.inventory.tools.some(n => n < 4) ? 'Repair needs one material and a worn owned tool.' : undefined;
      if (Number(a.quantity) > person.fabrication || person.inventory.materials < Number(a.quantity)) return 'Batch exceeds your skill or available materials.';
      if (a.equipment === 'owned') return !person.inventory.tools.length ? 'No available owned equipment.' : undefined;
      const loan = w.loans.find(l => l.id === a.equipment && l.borrower === actor);
      return !loan || loan.busy || loan.uses < 1 || loan.returnAt <= this.tick ? 'Rental is unavailable.' : undefined;
    }
    if (p.toolId === 'offer') {
      const t = a as unknown as OfferTerms;
      if (t.to !== null && (t.to === actor || !Object.hasOwn(w.people, t.to))) return 'Unknown recipient or self offer.';
      if (t.expiresAt <= this.tick || t.expiresAt > Math.min(w.turns + 1, this.tick + 12)) return 'Offer deadline must be within the next 12 turns.';
      if (w.offers.filter(o => o.owner === actor && o.status === 'open').length >= 3) return 'Maximum three open offers per owner.';
      if (!nonempty(t.give) || !affordable(person.inventory, t.give, t.minUses)) return this.guided
        ? '/arguments/give: reserve nonempty compensation from your available inventory now, using /arguments/minUses for tool quality. Owned-but-reserved stock and future receipts are unavailable. Nothing was reserved.'
        : 'Offer needs available give resources of the specified quality.';
      if (this.eventPerception && t.kind === 'job' && !this.actors.some(worker => worker !== actor && (t.to === null || t.to === worker) && w.people[worker].fabrication >= t.quantity)) return 'No eligible recipient can manufacture this batch; split it into smaller jobs.';
      if (t.kind === 'trade') return t.quantity || t.rentalTurns ? 'Trade quantity/rentalTurns must be zero.' : undefined;
      if (t.kind === 'rental') return t.quantity || t.rentalTurns < 1 || t.give.tools !== 1 || Object.entries(t.give).some(([g, n]) => g !== 'tools' && n > 0) || Object.entries(t.want).some(([g, n]) => g !== 'cash' && n > 0) ? 'Rental lends exactly one tool for cash; set rentalTurns and quantity=0.' : undefined;
      if (nonempty(t.want) || t.quantity < 1 || t.rentalTurns) return 'Job needs quantity, want={}, rentalTurns=0.';
      const disposable = structuredClone(person.inventory); take(disposable, t.give, t.minUses);
      if (!affordable(disposable, { materials: t.quantity, tools: 1 }, t.minUses)) return this.guided
        ? `/arguments/give is compensation, separate from production inputs. After reserving it, you would have ${disposable.materials} materials and ${disposable.tools.filter(uses => uses >= t.minUses).length} qualifying owned tools available. This job additionally requires ${t.quantity} materials and 1 owned tool with at least ${t.minUses} uses. Materials or tools in give count as extra compensation, not those inputs. Nothing was reserved.`
        : 'Reserve wages plus manufacturing materials and qualifying equipment.';
      return undefined;
    }
    if (p.toolId === 'accept' || p.toolId === 'cancel') {
      const o = w.offers.find(o => o.id === a.offerId);
      if (!o || o.status !== 'open' || o.expiresAt <= this.tick) return 'Offer no longer open.';
      if (p.toolId === 'cancel') return o.owner !== actor ? 'Not your offer.' : undefined;
      if (o.owner === actor || o.to !== null && o.to !== actor) return 'Offer is not addressed to you.';
      if (o.kind === 'job') return this.shift(w, actor) ?? (w.arrears ? 'Production suspended for rent arrears.' : person.fabrication < o.quantity ? 'Job exceeds your fabrication skill.' : undefined);
      return !affordable(person.inventory, o.want, o.minUses) ? 'Insufficient qualifying payment resources.' : undefined;
    }
    if (p.toolId === 'return_tool') return !w.loans.some(l => l.id === a.loanId && l.borrower === actor && !l.busy) ? 'No idle rental with that ID.' : undefined;
    if (p.toolId === 'fund_rent') return person.inventory.cash < Number(a.amount) ? 'Insufficient cash.' : undefined;
    return undefined;
  }
  private note(w: ShopWorld, actor: string, text: string, actionId?: string, quote?: string) { w.activity.push({ tick: this.tick, actor, text, ...(actionId ? { actionId } : {}), ...(quote ? { quote } : {}) }); }
  private startWork(w: ShopWorld, p: ActionProposal, work: Omit<Work, 'actor' | 'actionId' | 'due'>) {
    w.people[p.actor].workedDay = dayAt(this.tick);
    w.work[p.actor] = { ...work, actor: p.actor, actionId: p.id, due: this.tick + 1 };
    this.note(w, p.actor, work.kind === 'repair' ? 'Started repairing equipment; due next turn.' : `Started ${work.quantity} ${work.quality} units${work.owner === p.actor ? '' : ` for ${name(work.owner)}`}; due next turn.`, p.id);
  }
  private returnLoan(w: ShopWorld, id: string, actionId?: string) {
    const loan = w.loans.find(l => l.id === id)!;
    if (loan.uses > 0) w.people[loan.owner].inventory.tools.push(loan.uses);
    this.note(w, loan.owner, `${name(loan.borrower)} returned rented equipment with ${loan.uses} uses remaining${loan.uses ? '' : ' (spent)'}.`, actionId);
    this.note(w, loan.borrower, `Returned ${name(loan.owner)}’s equipment with ${loan.uses} uses remaining.`, actionId);
    w.loans = w.loans.filter(l => l.id !== id);
  }
  private payRent(w: ShopWorld) { const paid = Math.min(w.till, w.arrears); w.till -= paid; w.arrears -= paid; w.paidRent += paid; }
  protected apply(world: ShopWorld, p: ActionProposal): ShopWorld {
    const w = structuredClone(world), actor = p.actor, a = p.arguments, person = w.people[actor];
    if (p.toolId === 'say') { w.messages.push({ tick: this.tick, from: actor, to: a.to as string | null, text: String(a.text) }); this.note(w, actor, `Said to ${a.to ? `${name(String(a.to))} privately` : 'everyone'}:`, p.id, String(a.text)); }
    const order = w.orders.find(o => o.id === a.orderId);
    if (p.toolId === 'claim_order' && order) { order.status = 'claimed'; order.claimant = actor; this.note(w, actor, `Claimed ${order.customer}’s order ${order.id}: ${order.quantity} ${order.quality} units for $${order.payment}, due turn ${order.deadline}. No delivery or payment yet.`, p.id); }
    if (p.toolId === 'publish_lead' && order) { order.recipient = null; this.note(w, actor, `Published the private lead ${order.id} for everyone.`, p.id); }
    if (p.toolId === 'release_order' && order) { order.claimant = null; order.status = 'open'; this.note(w, actor, `Released order ${order.id}.`, p.id); }
    if (p.toolId === 'deliver' && order) {
      const standard = order.quality === 'standard' ? Math.min(order.quantity, person.inventory.standard) : 0;
      person.inventory.standard -= standard; person.inventory.premium -= order.quantity - standard; person.inventory.cash += order.payment;
      order.status = 'delivered'; order.deliveredAt = this.tick; w.customerRevenue += order.payment;
      this.note(w, actor, `Delivered ${order.quantity} units to ${order.customer} (${order.id}) and received $${order.payment}.`, p.id);
    }
    if (p.toolId === 'source') { const quantity = Number(a.quantity), paid = quantity * person.sourcingPrice; person.inventory.cash -= paid; person.inventory.materials += quantity; person.workedDay = dayAt(this.tick); w.supplierCosts += paid; this.note(w, actor, `Bought ${quantity} materials from the supplier for $${paid}.`, p.id); }
    if (p.toolId === 'repair') {
      const uses = Math.min(...person.inventory.tools); const index = person.inventory.tools.indexOf(uses);
      person.inventory.tools.splice(index, 1); person.inventory.materials--;
      this.startWork(w, p, { owner: actor, kind: 'repair', quantity: Math.min(4, uses + person.repair), quality: 'standard', inputs: { ...empty(), materials: 1, tools: [uses] } });
    }
    if (p.toolId === 'make') {
      const quantity = Number(a.quantity), loan = w.loans.find(l => l.id === a.equipment);
      const inputs = take(person.inventory, { materials: quantity });
      const uses = loan ? loan.uses : Math.max(...person.inventory.tools);
      if (loan) loan.busy = true;
      else inputs.tools.push(...person.inventory.tools.splice(person.inventory.tools.indexOf(uses), 1));
      this.startWork(w, p, { owner: actor, kind: 'make', quantity, quality: uses >= 3 ? 'premium' : 'standard', inputs, ...(loan ? { loanId: loan.id } : {}) });
    }
    if (p.toolId === 'offer') {
      const terms = a as unknown as OfferTerms;
      const escrow = take(person.inventory, terms.give, terms.minUses);
      const inputs = terms.kind === 'job' ? take(person.inventory, { materials: terms.quantity, tools: 1 }, terms.minUses) : empty();
      w.offers.push({ ...structuredClone(terms), id: p.id, owner: actor, status: 'open', escrow, inputs });
      this.note(w, actor, terms.kind === 'trade' ? `Proposed ${describe(terms.give)} for ${describe(terms.want)}${terms.to ? ` with ${name(terms.to)}` : ''}; goods reserved, no exchange yet.` : terms.kind === 'job' ? `Offered ${describe(terms.give)} for manufacturing ${terms.quantity} units; wages and inputs reserved.` : `Offered equipment rental (at least ${terms.minUses} uses) for ${describe(terms.want)}, ${terms.rentalTurns} turns.`, p.id);
    }
    if (p.toolId === 'cancel') { release(w, w.offers.find(o => o.id === a.offerId)!, 'cancelled'); this.note(w, actor, 'Withdrew an offer and reclaimed reserved resources.', p.id); }
    if (p.toolId === 'accept') {
      const o = w.offers.find(o => o.id === a.offerId)!;
      if (o.kind === 'job') {
        this.startWork(w, p, { owner: o.owner, kind: 'make', quantity: o.quantity, quality: o.inputs.tools[0] >= 3 ? 'premium' : 'standard', inputs: o.inputs, offerId: o.id }); o.inputs = empty(); o.status = 'working';
      } else {
        const payment = take(person.inventory, o.want, o.minUses); put(w.people[o.owner].inventory, payment);
        if (o.kind === 'trade') {
          put(person.inventory, o.escrow);
          this.note(w, actor, `Traded ${describe(o.want)} to ${name(o.owner)} for ${describe(o.give)}.`, p.id);
          this.note(w, o.owner, `Traded ${describe(o.give)} to ${name(actor)} for ${describe(o.want)}.`, p.id);
        } else {
          const returnAt = Math.min(w.turns + 1, this.tick + o.rentalTurns);
          w.loans.push({ id: o.id, owner: o.owner, borrower: actor, uses: o.escrow.tools[0], returnAt, busy: false });
          this.note(w, actor, `Rented ${name(o.owner)}’s equipment (${o.escrow.tools[0]} uses) for ${describe(o.want)}; returns turn ${returnAt}.`, p.id);
          this.note(w, o.owner, `Lent equipment to ${name(actor)} until turn ${returnAt}, receiving ${describe(o.want)}.`, p.id);
        }
        o.escrow = empty(); o.status = 'filled';
      }
    }
    if (p.toolId === 'return_tool') this.returnLoan(w, String(a.loanId), p.id);
    if (p.toolId === 'fund_rent') { person.inventory.cash -= Number(a.amount); w.till += Number(a.amount); this.payRent(w); this.note(w, actor, `Contributed $${a.amount} to rent; shared fund $${w.till}, arrears $${w.arrears}.`, p.id); }
    check(w); return w;
  }
  protected running(p: ActionProposal) { return this.world.work[p.actor]?.actionId === p.id; }
  protected result(p: ActionProposal): JsonValue {
    return JSON.parse(JSON.stringify({ operation: p.toolId, effect: p.toolId === 'say' ? 'speech-delivered; contents unverified and nonbinding' : p.toolId === 'offer' ? 'offer-posted; no exchange or work completed' : p.toolId === 'claim_order' ? 'order-claimed; no delivery or payment' : 'named-operation-completed',
      activity: this.world.activity.filter(a => a.actionId === p.id && a.tick === this.tick), available: this.world.people[p.actor].inventory, owned: owned(this.world, p.actor), balanceMeaning: 'Current totals, not changes.' }));
  }
  protected advanceWorld() {
    const w = this.world; if (w.completed) return;
    for (const [actor, work] of Object.entries(w.work)) {
      if (work.due > this.tick) continue;
      const owner = w.people[work.owner];
      if (work.kind === 'repair') { owner.inventory.tools.push(work.quantity); this.note(w, actor, `Repaired equipment to ${work.quantity} uses remaining.`, work.actionId); }
      else {
        owner.inventory[work.quality] += work.quantity;
        if (work.loanId) { const loan = w.loans.find(l => l.id === work.loanId)!; loan.uses--; loan.busy = false; }
        else if (work.inputs.tools[0] > 1) owner.inventory.tools.push(work.inputs.tools[0] - 1);
        this.note(w, actor, `Manufactured ${work.quantity} ${work.quality} units${actor === work.owner ? '' : ` for ${name(work.owner)}`}.`, work.actionId);
        if (work.offerId) {
          const offer = w.offers.find(o => o.id === work.offerId)!;
          put(w.people[actor].inventory, offer.escrow); offer.escrow = empty(); offer.status = 'filled';
          this.note(w, actor, `Received ${describe(offer.give)} from ${name(work.owner)} for the completed job.`, work.actionId);
          this.note(w, work.owner, `Received ${work.quantity} ${work.quality} units and paid ${name(actor)} ${describe(offer.give)}.`, work.actionId);
        }
      }
      delete w.work[actor]; this.version++; this.finish(this.ledger.get(work.actionId)!.proposal);
    }
    for (const loan of [...w.loans]) if (loan.returnAt <= this.tick && !loan.busy) this.returnLoan(w, loan.id);
    for (const offer of w.offers) if (offer.status === 'open' && offer.expiresAt <= this.tick) { release(w, offer, 'expired'); this.note(w, offer.owner, 'An offer expired; its reserved resources were returned.'); }
    for (const order of w.orders) if (['open', 'claimed'].includes(order.status) && order.deadline < this.tick) { order.status = 'expired'; this.note(w, order.claimant ?? 'operator:shop', `Order ${order.id} expired without delivery; no customer payment.`); }
    if (this.tick > 1 && (this.tick - 1) % w.rentEvery === 0) { w.arrears += w.rent; this.payRent(w); this.note(w, 'operator:shop', `Rent due: $${w.rent}. Shared fund $${w.till}; arrears $${w.arrears}${w.arrears ? '; production suspended' : ''}.`); }
    if (this.tick > w.turns) {
      for (const offer of w.offers) if (offer.status === 'open') release(w, offer, 'expired');
      for (const loan of [...w.loans]) this.returnLoan(w, loan.id);
      w.completed = true;
    }
    this.version++; check(w);
  }
  protected cancelRunning(p: ActionProposal) {
    const work = this.world.work[p.actor]; if (!work || work.actionId !== p.id) return false;
    put(this.world.people[work.owner].inventory, work.inputs);
    if (work.loanId) this.world.loans.find(l => l.id === work.loanId)!.busy = false;
    if (work.offerId) release(this.world, this.world.offers.find(o => o.id === work.offerId)!, 'cancelled');
    delete this.world.work[p.actor]; check(this.world); return true;
  }
  protected editWorld(w: ShopWorld, p: ActionProposal): WorldEdit<ShopWorld> {
    if (w.completed) return { reason: 'The shop trial is complete.' };
    if (p.toolId === 'operator.add_order' || p.toolId === 'operator.amend_order') {
      const terms = p.arguments as unknown as OrderTerms;
      if (terms.deadline <= this.tick || terms.deadline > w.turns) return { reason: 'Order deadline must be after the current turn and within the trial.' };
      if (terms.recipient !== null && !Object.hasOwn(w.people, terms.recipient)) return { reason: 'Unknown private lead recipient.' };
      const existing = w.orders.find(o => o.id === terms.id);
      if (p.toolId === 'operator.add_order') {
        if (existing || w.orders.length >= 250) return { reason: 'Use a unique order ID; maximum 250 orders per trial.' };
        const order: Order = { ...terms, revision: 1, status: 'open', claimant: null }; w.orders.push(order);
        this.note(w, 'operator:shop', `${terms.customer} sent ${terms.id}: ${terms.quantity} ${terms.quality} units, $${terms.payment}, due turn ${terms.deadline}${terms.recipient ? ` (private lead for ${name(terms.recipient)})` : ''}.`);
        return { world: w, effects: { order: JSON.parse(JSON.stringify(order)) } };
      }
      if (!existing || !['open', 'claimed'].includes(existing.status)) return { reason: 'Only an open or claimed order can be amended.' };
      if (terms.recipient !== existing.recipient) return { reason: 'Amendments cannot change visibility; publish the lead explicitly.' };
      const before = structuredClone(existing); Object.assign(existing, terms, { revision: existing.revision + 1 });
      this.note(w, 'operator:shop', `Customer amended ${terms.id} to revision ${existing.revision}: ${terms.quantity} ${terms.quality} units, $${terms.payment}, due turn ${terms.deadline}.`);
      return { world: w, effects: JSON.parse(JSON.stringify({ before, after: existing })) };
    }
    if (p.toolId === 'operator.damage_equipment') {
      const person = w.people[String(p.arguments.actor)], index = Number(p.arguments.index);
      if (!person || index >= person.inventory.tools.length) return { reason: 'Choose an available owned tool; reserved or rented tools cannot be damaged by this operation.' };
      const before = person.inventory.tools[index], after = Math.max(0, before - Number(p.arguments.uses));
      if (after) person.inventory.tools[index] = after; else person.inventory.tools.splice(index, 1);
      this.note(w, String(p.arguments.actor), `Equipment damaged: ${before} → ${after} uses remaining.`);
      return { world: w, effects: { before, after } };
    }
    return { reason: 'Unknown shop operation.' };
  }
}

export const fabricationHost: HostRegistration = {
  descriptor: { contractId: 'example.fabrication', version: '1.0.0', implementationVersion: '1.0.0', toolCatalog: fabricationCatalog, capabilities, clocks: [...clocks], limits,
    initialConditionsSchema: object({ turns: integer(4, 100000), rentEvery: integer(4, 1000), rent: integer(0, 100000), till: integer(), orders: { type: 'array', maxItems: 250, items: orderSchema },
      people: { type: 'object', minProperties: 2, maxProperties: 8, additionalProperties: object({ inventory: stockSchema, fabrication: integer(1, 8), repair: integer(1, 4), sourcingPrice: integer(1, 10) }) } }),
    interventions: [
      { id: 'operator.add_order', version: '1.0.0', description: 'Deliver a new customer order publicly or as a private lead. Characters learn it through their next observations.', inputSchema: orderSchema },
      { id: 'operator.amend_order', version: '1.0.0', description: 'Replace the terms of an open or claimed order. Keep its ID and recipient; revision increments. Existing claims remain, but delivery requires the revised terms.', inputSchema: orderSchema },
      { id: 'operator.damage_equipment', version: '1.0.0', description: 'Damage available owned equipment at a settled boundary. Existing work, reservations, and rentals are unchanged.', inputSchema: object({ actor: { type: 'string' }, index: integer(0, 99), uses: integer(1, 4) }) },
    ],
  },
  validateInitial(scene) {
    const initial = scene.initialConditions as unknown as ShopWorld;
    const validCast = JSON.stringify(Object.keys(initial.people).sort()) === JSON.stringify(scene.cast.map(c => c.instanceId).sort());
    const validOrders = new Set(initial.orders.map(o => o.id)).size === initial.orders.length && initial.orders.every(o => o.deadline <= initial.turns && (o.recipient === null || Object.hasOwn(initial.people, o.recipient)));
    return validCast && validOrders ? [] : [{ stage: 'referential', code: 'INVALID_SHOP_SETUP', documentId: scene.id, pointer: '/initialConditions', message: 'Match people to the cast; use unique order IDs, valid recipients, and deadlines within the trial.' }];
  },
  create: (launch, runtime) => new FabricationHost(launch, runtime?.storage),
  restore: (launch, snapshot, runtime) => { const host = new FabricationHost(launch, runtime?.storage); host.restore(snapshot); return host; },
};

export const fabricationPerceptionHost: HostRegistration = { ...fabricationHost,
  descriptor: { ...fabricationHost.descriptor, implementationVersion: '1.1.0' },
  create: (launch, runtime) => new FabricationHost(launch, runtime?.storage, fabricationPerceptionHost.descriptor),
  restore: (launch, snapshot, runtime) => { const host = new FabricationHost(launch, runtime?.storage, fabricationPerceptionHost.descriptor); host.restore(snapshot); return host; },
};

/** Clearer field roles and failure feedback; action shapes and economic effects are unchanged. */
export const fabricationGuidedHost: HostRegistration = { ...fabricationPerceptionHost,
  descriptor: { ...fabricationPerceptionHost.descriptor, implementationVersion: '1.2.0' },
  create: (launch, runtime) => new FabricationHost(launch, runtime?.storage, fabricationGuidedHost.descriptor),
  restore: (launch, snapshot, runtime) => { const host = new FabricationHost(launch, runtime?.storage, fabricationGuidedHost.descriptor); host.restore(snapshot); return host; },
};
