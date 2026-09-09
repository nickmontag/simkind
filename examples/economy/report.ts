import type { Observation, RunEvent } from 'simkind/format';
import { allCoins, dayAt, empty, ownedInventory, type EconomyWorld } from './model.js';
export const reportSchemaId = 'example.economy.report:1';
export function economyReport(snapshot: unknown) {
  const state = snapshot as { tick: number; revision: number; world: EconomyWorld };
  const world = state.world;
  return { schema: reportSchemaId, tick: state.tick, revision: state.revision, day: dayAt(world, state.tick), round: state.tick ? (state.tick - 1) % world.roundsPerDay + 1 : 0,
    days: world.days, roundsPerDay: world.roundsPerDay, completed: world.completed, foodMultiplier: world.foodMultiplier, publicWealth: world.publicWealth,
    initialCoins: world.initialCoins, conservedCoins: allCoins(world),
    people: Object.fromEntries(Object.entries(world.people).map(([id, p]) => [id, { ...structuredClone(p), owned: ownedInventory(world, id), working: world.work[id] ?? null }])),
    offers: structuredClone(world.offers.filter(o => o.status === 'open' || o.status === 'working')),
    transactions: structuredClone(world.transactions), messages: structuredClone(world.messages.slice(-24)), history: structuredClone(world.history),
  };
}
export type EconomyReport = ReturnType<typeof economyReport>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const stock = (value: unknown) => object(value) && count(value.coins) && count(value.food) && count(value.timber) && Array.isArray(value.tools) && value.tools.every(d => count(d) && d >= 1 && d <= 4);
const bundle = (value: unknown) => object(value) && Object.entries(value).every(([g, n]) => ['coins', 'food', 'timber', 'tools'].includes(g) && count(n));
/** Malformed/free-form observation data cannot masquerade as a usable dashboard snapshot. */
function validReport(value: unknown): value is EconomyReport {
  if (!object(value) || value.schema !== reportSchemaId || !count(value.tick) || !count(value.day) || !count(value.days) || !count(value.round) || !count(value.roundsPerDay) || !count(value.initialCoins) || !count(value.conservedCoins) || !object(value.people)) return false;
  if (!Object.entries(value.people).every(([id, p]) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) && object(p) && stock(p.inventory) && stock(p.owned) && count(p.missedMeals) && count(p.selfShifts) && count(p.paidShifts))) return false;
  if (!Array.isArray(value.history) || !value.history.every(d => object(d) && count(d.day) && object(d.balances) && Object.values(d.balances).every(stock) && object(d.missedMeals) && Object.values(d.missedMeals).every(count) && count(d.trades) && count(d.jobs))) return false;
  if (!Array.isArray(value.messages) || !value.messages.every(m => object(m) && typeof m.from === 'string' && (m.to === null || typeof m.to === 'string') && typeof m.text === 'string' && count(m.tick))) return false;
  if (!Array.isArray(value.offers) || !value.offers.every(o => object(o) && typeof o.owner === 'string' && (o.to === null || typeof o.to === 'string') && bundle(o.give) && bundle(o.want) && count(o.expiresAt))) return false;
  return Array.isArray(value.transactions) && value.transactions.every(t => object(t) && typeof t.from === 'string' && typeof t.to === 'string' && ['trade', 'wage'].includes(String(t.kind)) && bundle(t.give) && bundle(t.want) && count(t.tick)
    && (t.transferred === undefined || object(t.transferred) && stock(t.transferred.give) && stock(t.transferred.want)));
}
/** Reads recorded operator observations only; never instantiates a host or provider. */
export function recordedEconomyReports(events: readonly RunEvent[]): EconomyReport[] {
  const reports: EconomyReport[] = [];
  for (const event of events) {
    if (event.type !== 'observation') continue;
    const observation = event.data as unknown as Observation;
    if (observation.recipient !== 'operator:market' || !Array.isArray(observation.content)) continue;
    for (const content of observation.content) {
      if (content.type !== 'data' || content.schemaId !== reportSchemaId || !content.data || typeof content.data !== 'object') continue;
      const report = content.data as unknown as EconomyReport;
      if (validReport(report)) reports.push(structuredClone(report));
    }
  }
  return reports;
}
export function economyCsv(report: EconomyReport): string {
  const quote = (value: string | number) => '"' + String(value).replaceAll('"', '""') + '"';
  const rows: (string | number)[][] = [['day', 'character', 'coins_owned', 'food_owned', 'timber_owned', 'tools_owned', 'missed_meals', 'completed_trades', 'completed_jobs']];
  for (const day of report.history) for (const [id, stock] of Object.entries(day.balances)) rows.push([day.day, id, stock.coins, stock.food, stock.timber, stock.tools.length, day.missedMeals[id], day.trades, day.jobs]);
  // A run stopped before its first day closes still exports its available snapshot.
  if (!report.history.length) for (const [id, person] of Object.entries(report.people)) { const stock = person.owned ?? empty(); rows.push([0, id, stock.coins, stock.food, stock.timber, stock.tools.length, person.missedMeals, 0, 0]); }
  return rows.map(row => row.map(quote).join(',')).join('\n') + '\n';
}
