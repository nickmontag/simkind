/** Pure economy rules. No prices, employers, or strategies are selected here. */
export const goods = ['coins', 'food', 'timber', 'tools'] as const;
export type Good = typeof goods[number];
export type Task = 'food' | 'timber' | 'tools';
export type Bundle = Partial<Record<Good, number>>;
export interface Holdings { coins: number; food: number; timber: number; tools: number[] }
export interface Person { inventory: Holdings; skills: Record<Task, number>; workedDay: number; hungry: boolean; missedMeals: number; selfShifts: number; paidShifts: number; earned: number }
export type Terms = { to: string | null; give: Bundle; want: Bundle; expiresAt: number; giveToolMinUses?: number; wantToolMinUses?: number } & ({ kind: 'trade'; task: null; useTool: false } | { kind: 'job'; task: Task; useTool: boolean });
export type Offer = Terms & { id: string; owner: string; status: 'open' | 'working' | 'filled' | 'cancelled' | 'expired'; escrow: Holdings; materials: Holdings; worker?: string }
export interface Work { actor: string; owner: string; task: Task; quantity: number; due: number; materials: Holdings; actionId: string; offerId?: string }
export interface Transaction { tick: number; kind: 'trade' | 'wage'; from: string; to: string; give: Bundle; want: Bundle; task?: Task; quantity?: number; transferred?: { give: Holdings; want: Holdings } }
export interface DaySummary { day: number; balances: Record<string, Holdings>; missedMeals: Record<string, number>; trades: number; jobs: number; conservedCoins: number }
export interface EconomyWorld {
  days: number; roundsPerDay: number; foodMultiplier: number; publicWealth: boolean; people: Record<string, Person>;
  offers: Offer[]; work: Record<string, Work>; messages: { tick: number; from: string; to: string | null; text: string }[];
  transactions: Transaction[]; history: DaySummary[]; initialCoins: number; completed: boolean;
}
export const empty = (): Holdings => ({ coins: 0, food: 0, timber: 0, tools: [] });
export const amount = (stock: Holdings, good: Good) => good === 'tools' ? stock.tools.length : stock[good];
export const affordable = (stock: Holdings, bundle: Bundle, toolMinUses = 1) => goods.every(g => (g === 'tools' ? stock.tools.filter(uses => uses >= toolMinUses).length : amount(stock, g)) >= (bundle[g] ?? 0));
export const nonempty = (bundle: Bundle) => goods.some(g => (bundle[g] ?? 0) > 0);
export function take(stock: Holdings, bundle: Bundle, toolMinUses = 1): Holdings {
  if (!affordable(stock, bundle, toolMinUses)) throw new Error('Insufficient available resources.');
  const moved = empty();
  for (const good of goods) {
    const count = bundle[good] ?? 0;
    if (good === 'tools') {
      for (let remaining = count; remaining > 0; remaining--) {
        const index = stock.tools.findIndex(uses => uses >= toolMinUses);
        moved.tools.push(...stock.tools.splice(index, 1));
      }
    }
    else { stock[good] -= count; moved[good] = count; }
  }
  return moved;
}
export function put(stock: Holdings, moved: Holdings) { stock.coins += moved.coins; stock.food += moved.food; stock.timber += moved.timber; stock.tools.push(...moved.tools); }
export function costs(task: Task, useTool: boolean): Bundle { return { timber: task === 'tools' ? 2 : 0, tools: useTool ? 1 : 0 }; }
export function dayAt(world: EconomyWorld, tick: number) { return Math.min(world.days, Math.max(1, Math.floor((tick - 1) / world.roundsPerDay) + 1)); }
export function yieldFor(world: EconomyWorld, actor: string, task: Task, useTool: boolean) {
  const person = world.people[actor];
  return Math.max(1, Math.floor((person.skills[task] + (useTool ? 2 : 0)) * (person.hungry ? 0.5 : 1) * (task === 'food' ? world.foodMultiplier : 1)));
}
export function allCoins(world: EconomyWorld) {
  return Object.values(world.people).reduce((n, p) => n + p.inventory.coins, 0) + world.offers.reduce((n, o) => n + o.escrow.coins + o.materials.coins, 0) + Object.values(world.work).reduce((n, w) => n + w.materials.coins, 0);
}
export function releaseOffer(world: EconomyWorld, offer: Offer, status: 'cancelled' | 'expired') {
  put(world.people[offer.owner].inventory, offer.escrow); put(world.people[offer.owner].inventory, offer.materials);
  offer.escrow = empty(); offer.materials = empty(); offer.status = status;
}
export function finishWork(world: EconomyWorld, work: Work, tick: number) {
  const output = empty();
  if (work.task === 'tools') output.tools = Array(work.quantity).fill(4); else output[work.task] = work.quantity;
  // Timber is consumed only on successful crafting; borrowed tools return with one use spent.
  if (work.materials.tools.length) { const durability = work.materials.tools[0] - 1; if (durability > 0) output.tools.push(durability); }
  put(world.people[work.owner].inventory, output);
  if (work.offerId) {
    const offer = world.offers.find(o => o.id === work.offerId)!;
    world.people[work.actor].earned += offer.escrow.coins;
    put(world.people[work.actor].inventory, offer.escrow); offer.escrow = empty(); offer.status = 'filled';
    world.transactions.push({ tick, kind: 'wage', from: work.owner, to: work.actor, give: offer.give, want: {}, task: work.task, quantity: work.quantity });
  }
}
export function ownedInventory(world: EconomyWorld, actor: string): Holdings {
  const owned = structuredClone(world.people[actor].inventory);
  for (const offer of world.offers.filter(o => o.owner === actor)) { put(owned, offer.escrow); put(owned, offer.materials); }
  for (const work of Object.values(world.work).filter(w => w.owner === actor)) put(owned, work.materials);
  return owned;
}
export function closeDay(world: EconomyWorld, day: number) {
  for (const person of Object.values(world.people)) {
    person.hungry = person.inventory.food < 1;
    if (person.hungry) person.missedMeals++; else person.inventory.food--;
  }
  world.history.push({ day, balances: Object.fromEntries(Object.entries(world.people).map(([id]) => [id, ownedInventory(world, id)])),
    missedMeals: Object.fromEntries(Object.entries(world.people).map(([id, p]) => [id, p.missedMeals])),
    trades: world.transactions.filter(t => t.kind === 'trade').length, jobs: world.transactions.filter(t => t.kind === 'wage').length, conservedCoins: allCoins(world) });
}
