import type { Observation, RunEvent } from 'simkind/format';
import { cashTotal, owned, type ShopWorld } from './model.js';
export const shopReportSchemaId = 'example.fabrication.report:1';
export function shopReport(snapshot: unknown) {
  const { tick, revision, world: w } = snapshot as { tick: number; revision: number; world: ShopWorld };
  return { schema: shopReportSchemaId, tick, revision, turns: w.turns, completed: w.completed,
    till: w.till, arrears: w.arrears, rent: w.rent, rentEvery: w.rentEvery, paidRent: w.paidRent,
    initialCash: w.initialCash, customerRevenue: w.customerRevenue, supplierCosts: w.supplierCosts, cash: cashTotal(w),
    people: Object.fromEntries(Object.entries(w.people).map(([id, p]) => [id, { ...structuredClone(p), owned: owned(w, id), working: structuredClone(w.work[id] ?? null) }])),
    orders: structuredClone(w.orders), offers: structuredClone(w.offers.filter(o => o.status === 'open' || o.status === 'working')), loans: structuredClone(w.loans),
    activity: structuredClone(w.activity.filter(a => a.tick === tick)),
  };
}
export type ShopReport = ReturnType<typeof shopReport>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const stock = (v: unknown) => object(v) && ['cash', 'materials', 'standard', 'premium'].every(g => count(v[g])) && Array.isArray(v.tools) && v.tools.every(n => count(n) && n >= 1 && n <= 4);
const bundle = (v: unknown) => object(v) && Object.entries(v).every(([g, n]) => ['cash', 'materials', 'standard', 'premium', 'tools'].includes(g) && count(n));
function valid(v: unknown): v is ShopReport {
  if (!object(v) || v.schema !== shopReportSchemaId || !['tick', 'revision', 'turns', 'till', 'arrears', 'rent', 'rentEvery', 'paidRent', 'initialCash', 'customerRevenue', 'supplierCosts', 'cash'].every(k => count(v[k])) || typeof v.completed !== 'boolean') return false;
  if (!object(v.people) || !Object.values(v.people).every(p => object(p) && stock(p.inventory) && stock(p.owned) && (p.working === null || object(p.working) && count(p.working.due) && typeof p.working.kind === 'string'))) return false;
  if (!Array.isArray(v.orders) || !v.orders.every(o => object(o) && ['id', 'customer', 'brief'].every(k => typeof o[k] === 'string') && ['quantity', 'payment', 'deadline', 'revision'].every(k => count(o[k])) && ['standard', 'premium'].includes(String(o.quality)) && ['open', 'claimed', 'delivered', 'expired'].includes(String(o.status)) && (o.recipient === null || typeof o.recipient === 'string') && (o.claimant === null || typeof o.claimant === 'string'))) return false;
  if (!Array.isArray(v.offers) || !v.offers.every(o => object(o) && typeof o.owner === 'string' && typeof o.kind === 'string' && typeof o.status === 'string' && bundle(o.give) && bundle(o.want) && count(o.expiresAt) && count(o.quantity))) return false;
  if (!Array.isArray(v.loans) || !v.loans.every(l => object(l) && typeof l.owner === 'string' && typeof l.borrower === 'string' && count(l.uses) && count(l.returnAt))) return false;
  return Array.isArray(v.activity) && v.activity.every(a => object(a) && count(a.tick) && typeof a.actor === 'string' && typeof a.text === 'string' && (a.quote === undefined || typeof a.quote === 'string') && (a.actionId === undefined || typeof a.actionId === 'string'));
}
/** Operator snapshots are separate from character-visible observations. */
export function recordedShopReports(events: readonly RunEvent[]): ShopReport[] {
  return events.flatMap(event => {
    if (event.type !== 'observation') return [];
    const o = event.data as unknown as Observation;
    if (o.recipient !== 'operator:shop' || !Array.isArray(o.content)) return [];
    return o.content.flatMap(c => c.type === 'data' && c.schemaId === shopReportSchemaId && valid(c.data) ? [structuredClone(c.data)] : []);
  });
}
