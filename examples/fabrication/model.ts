/** Fabrication-shop rules and accounting; characters choose all commercial strategies. */
export const goods = ['cash', 'materials', 'standard', 'premium', 'tools'] as const;
export type Bundle = Partial<Record<typeof goods[number], number>>;
export interface Stock { cash: number; materials: number; standard: number; premium: number; tools: number[] }
export interface Person { inventory: Stock; fabrication: number; repair: number; sourcingPrice: number; workedDay: number }
export interface OrderTerms { id: string; customer: string; quantity: number; quality: 'standard' | 'premium'; payment: number; deadline: number; recipient: string | null; brief: string }
export interface Order extends OrderTerms { revision: number; status: 'open' | 'claimed' | 'delivered' | 'expired'; claimant: string | null; deliveredAt?: number }
export interface OfferTerms { kind: 'trade' | 'job' | 'rental'; to: string | null; give: Bundle; want: Bundle; expiresAt: number; minUses: number; quantity: number; rentalTurns: number }
export interface Offer extends OfferTerms { id: string; owner: string; status: 'open' | 'working' | 'filled' | 'cancelled' | 'expired'; escrow: Stock; inputs: Stock }
export interface Loan { id: string; owner: string; borrower: string; uses: number; returnAt: number; busy: boolean }
export interface Work { actionId: string; actor: string; owner: string; kind: 'make' | 'repair'; quantity: number; quality: 'standard' | 'premium'; due: number; inputs: Stock; loanId?: string; offerId?: string }
export interface Activity { tick: number; actor: string; text: string; quote?: string; actionId?: string }
export interface ShopWorld {
  turns: number; rentEvery: number; rent: number; till: number; arrears: number; paidRent: number;
  initialCash: number; customerRevenue: number; supplierCosts: number; completed: boolean;
  people: Record<string, Person>; orders: Order[]; offers: Offer[]; loans: Loan[]; work: Record<string, Work>;
  messages: { tick: number; from: string; to: string | null; text: string }[]; activity: Activity[];
}
export const empty = (): Stock => ({ cash: 0, materials: 0, standard: 0, premium: 0, tools: [] });
export const name = (actor: string) => actor.replace('simkin:', '').replace(/^./, c => c.toUpperCase());
export const dayAt = (tick: number) => Math.max(1, Math.floor((tick - 1) / 4) + 1);
export const count = (s: Stock, g: typeof goods[number]) => g === 'tools' ? s.tools.length : s[g];
export const nonempty = (b: Bundle) => goods.some(g => (b[g] ?? 0) > 0);
export const affordable = (s: Stock, b: Bundle, minUses = 1) => goods.every(g => (g === 'tools' ? s.tools.filter(n => n >= minUses).length : s[g]) >= (b[g] ?? 0));
export function take(s: Stock, b: Bundle, minUses = 1): Stock {
  if (!affordable(s, b, minUses)) throw new Error('Insufficient available stock.');
  const moved = empty();
  for (const g of goods) {
    const n = b[g] ?? 0;
    if (g === 'tools') for (let i = 0; i < n; i++) moved.tools.push(...s.tools.splice(s.tools.findIndex(uses => uses >= minUses), 1));
    else { s[g] -= n; moved[g] = n; }
  }
  return moved;
}
export function put(s: Stock, moved: Stock) { for (const g of goods) { if (g === 'tools') s.tools.push(...moved.tools); else s[g] += moved[g]; } }
export function release(w: ShopWorld, offer: Offer, status: 'cancelled' | 'expired') {
  put(w.people[offer.owner].inventory, offer.escrow); put(w.people[offer.owner].inventory, offer.inputs);
  offer.escrow = empty(); offer.inputs = empty(); offer.status = status;
}
export function owned(w: ShopWorld, actor: string) {
  const s = structuredClone(w.people[actor].inventory);
  for (const offer of w.offers.filter(o => o.owner === actor)) { put(s, offer.escrow); put(s, offer.inputs); }
  for (const work of Object.values(w.work).filter(work => work.owner === actor)) put(s, work.inputs);
  s.tools.push(...w.loans.filter(l => l.owner === actor && l.uses > 0).map(l => l.uses));
  return s;
}
export function cashTotal(w: ShopWorld) { return w.till + Object.keys(w.people).reduce((total, actor) => total + owned(w, actor).cash, 0); }
export function check(w: ShopWorld) {
  if (cashTotal(w) + w.supplierCosts + w.paidRent !== w.initialCash + w.customerRevenue) throw new Error('Fabrication cash accounting mismatch.');
  for (const s of [...Object.values(w.people).map(p => p.inventory), ...w.offers.flatMap(o => [o.escrow, o.inputs]), ...Object.values(w.work).map(work => work.inputs)]) {
    if (!goods.filter(g => g !== 'tools').every(g => Number.isSafeInteger(s[g]) && s[g] >= 0) || s.tools.some(n => !Number.isInteger(n) || n < 1 || n > 4)) throw new Error('Invalid fabrication stock.');
  }
}
export function visibleOrder(order: Order, actor: string) { return order.recipient === null || order.recipient === actor; }
export function describe(b: Bundle) { return goods.filter(g => (b[g] ?? 0) > 0).map(g => g === 'cash' ? `$${b[g]}` : `${b[g]} ${g}`).join(', ') || 'nothing'; }
