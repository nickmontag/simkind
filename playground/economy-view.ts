import { toolQuality } from './economy-terms.js';
import { economyCsv, recordedEconomyReports, type EconomyReport } from '../examples/economy/report.js';
import type { RunEvent } from 'simkind/format';
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
const name = (id: string) => id.replace('simkin:', '').replace(/^./, c => c.toUpperCase());
const resources = (value: Record<string, unknown>, minimum?: unknown, delivered?: unknown) => Object.entries(value).filter(([, n]) => Array.isArray(n) ? n.length : Number(n) > 0).map(([g, n]) => `${Array.isArray(n) ? n.length : n} ${g}${g === 'tools' ? toolQuality(minimum, delivered) : ''}`).join(', ') || 'nothing';
function table(headers: string[], rows: (string | number)[][]) {
  const wrap = element('div'); wrap.className = 'market-table'; const table = element('table'); const head = element('thead'); const title = element('tr');
  for (const label of headers) title.append(element('th', label)); head.append(title); table.append(head);
  const body = element('tbody');
  for (const row of rows) { const tr = element('tr'); for (const value of row) tr.append(element('td', String(value))); body.append(tr); }
  table.append(body); wrap.append(table); return wrap;
}
function coinsChart(report: EconomyReport) {
  const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 620 155'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Coins owned by each character at day end, including escrow.');
  const colors = ['#c3f078', '#78dce8', '#edbc7c', '#c5a2ff'];
  const max = Math.max(1, report.initialCoins);
  Object.keys(report.people).forEach((id, index) => {
    const points = report.history.map((day, n) => `${35 + n / Math.max(1, report.days - 1) * 550},${120 - (day.balances[id]?.coins ?? 0) / max * 95}`).join(' ');
    const line = document.createElementNS(ns, 'polyline'); line.setAttribute('points', points); line.setAttribute('fill', 'none'); line.setAttribute('stroke', colors[index % colors.length]); line.setAttribute('stroke-width', '3'); svg.append(line);
    const label = document.createElementNS(ns, 'text'); label.setAttribute('x', String(25 + index * 145)); label.setAttribute('y', '150'); label.setAttribute('fill', colors[index % colors.length]); label.textContent = name(id); svg.append(label);
  });
  return svg;
}
export function renderEconomy(container: HTMLElement, report: EconomyReport | undefined) {
  container.replaceChildren(); container.hidden = !report;
  if (!report) return;
  container.append(element('h3', report.completed ? `Economy complete · ${report.days} days` : `Market · day ${report.day}/${report.days} · round ${report.round}/${report.roundsPerDay}`));
  container.append(element('p', `Operator view · ${report.publicWealth ? 'characters can see inventories' : 'inventories are private to each character'} · ${report.conservedCoins}/${report.initialCoins} coins conserved, including escrow.`));
  container.append(table(['Person', 'Available coins', 'In escrow', 'Food', 'Timber', 'Tools (uses)', 'Missed meals', 'Self / paid shifts'], Object.entries(report.people).map(([id, p]) => [name(id), p.inventory.coins, p.owned.coins - p.inventory.coins, p.inventory.food, p.inventory.timber, p.inventory.tools.join(', ') || '—', p.missedMeals, `${p.selfShifts} / ${p.paidShifts}`])));
  container.append(element('p', 'Inventories show spendable resources; tools list remaining uses. Paid shifts count started jobs. Completed jobs and payments appear below.'));
  if (report.history.length) { container.append(element('h4', 'Coins owned at day end')); container.append(coinsChart(report)); }
  container.append(element('h4', `Order book · ${report.offers.length} open or working`));
  container.append(table(['Owner → recipient', 'Offer', 'In return', 'Status / expires'], report.offers.map(o => [
    `${name(o.owner)} → ${o.to ? name(o.to) : 'anyone'}`, resources(o.give, o.giveToolMinUses), o.kind === 'job' ? `One ${o.task} shift${o.useTool ? ' with employer tool' : ''}` : resources(o.want, o.wantToolMinUses), `${o.status} / round ${o.expiresAt}`,
  ])));
  const trades = report.transactions.filter(t => t.kind === 'trade'); const jobs = report.transactions.filter(t => t.kind === 'wage');
  container.append(element('h4', `Settled exchanges · ${trades.length} trades · ${jobs.length} paid jobs`));
  container.append(table(['Round', 'Parties', 'Delivered', 'Received'], report.transactions.slice(-12).map(t => [t.tick, `${name(t.from)} → ${name(t.to)}`, resources(t.give, undefined, t.transferred?.give.tools), t.kind === 'wage' ? `${t.quantity} ${t.task} produced for employer` : resources(t.want, undefined, t.transferred?.want.tools)])));
  const priceTrades = trades.flatMap(t => {
    const only = (b: Record<string, number>, key: string) => Object.entries(b).every(([k, v]) => k === key || !v);
    if (t.give.food && t.want.coins && only(t.give, 'food') && only(t.want, 'coins')) return [t.want.coins / t.give.food];
    if (t.want.food && t.give.coins && only(t.want, 'food') && only(t.give, 'coins')) return [t.give.coins / t.want.food];
    return [];
  });
  container.append(element('p', priceTrades.length ? `Observed food prices: ${priceTrades.map(p => p.toFixed(2)).join(', ')} coins/unit. Barter and bundled deals are not assigned an invented price.` : 'No food-for-coins exchange has settled yet. Asking prices are not transaction prices.'));
  container.append(element('h4', 'Recent negotiations · operator can inspect private messages'));
  for (const message of report.messages.slice(-10)) container.append(element('p', `Round ${message.tick} · ${name(message.from)} → ${message.to ? name(message.to) + ' (private)' : 'everyone'}: ${message.text}`));
}
export function marketReports(events: RunEvent[]) { return recordedEconomyReports(events); }
export function downloadEconomy(report: EconomyReport) {
  const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([economyCsv(report)], { type: 'text/csv' }));
  link.href = url; link.download = 'simkind-economy-days.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
