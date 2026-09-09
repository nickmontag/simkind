import type { JsonObject, RunEvent } from 'simkind/format';
import type { ShopReport } from '../examples/fabrication/report.js';
import { name, describe, goods } from '../examples/fabrication/model.js';

export interface ShopNote { actor: string; text: string; quote?: string; sequence?: number; tone: 'done' | 'pending' | 'error' | 'neutral' }
/** Factual host receipts plus provider lifecycle. No LLM-written observer narrative. */
export function shopRecap(events: readonly RunEvent[], report: ShopReport, throughSequence = Infinity, live = false): ShopNote[] {
  const visible = events.filter(e => e.sequence <= throughSequence && Number(e.time.value) <= report.tick);
  const round = visible.filter(e => e.time.value === report.tick);
  const notes: ShopNote[] = report.activity.map(a => ({ ...a, tone: 'done', sequence: a.actionId ? round.filter(e => e.type === 'action' && (e.data as JsonObject).actionId === a.actionId).at(-1)?.sequence : round.filter(e => e.type === 'observation' && (e.data as JsonObject).recipient === 'operator:shop').at(-1)?.sequence }));
  for (const e of round) {
    const d = e.data as JsonObject;
    if (e.type === 'action' && ['rejected', 'failed', 'cancelled'].includes(String(d.status))) {
      const p = visible.find(p => p.type === 'proposal' && (p.data as JsonObject).id === d.actionId)?.data as JsonObject | undefined;
      notes.push({ actor: String(d.actor), text: `${d.status === 'cancelled' ? 'Cancelled' : 'Could not complete'} ${String(p?.toolId ?? 'action').replaceAll('_', ' ')}. ${typeof d.reason === 'string' ? d.reason : ''}`, tone: 'error', sequence: e.sequence });
    }
    if (e.type === 'action' && d.status === 'succeeded') {
      const p = visible.find(p => p.type === 'proposal' && (p.data as JsonObject).id === d.actionId)?.data as JsonObject | undefined;
      if (p?.toolId === 'simkind.revise') notes.push({ actor: String(d.actor), text: 'Updated personal intentions or interpretations.', tone: 'neutral', sequence: e.sequence });
    }
    if (e.type === 'model-error' || e.type === 'model-timeout' || e.type === 'model-result') {
      const request = visible.find(r => r.type === 'request' && ((r.data as JsonObject).context as JsonObject)?.requestId === d.requestId);
      const context = (request?.data as JsonObject | undefined)?.context as JsonObject | undefined;
      if (!context) continue;
      const actor = String(context.instanceId), output = d.output as JsonObject | undefined;
      if (e.type !== 'model-result') notes.push({ actor, text: context.purpose === 'consolidation' ? 'Memory consolidation failed; earlier memory retained.' : e.type === 'model-timeout' ? 'Decision timed out.' : `Decision failed (${d.code ?? 'provider error'}).`, tone: 'error', sequence: e.sequence });
      else if (context.purpose === 'consolidation') notes.push({ actor, text: 'Consolidated older experiences into memory.', tone: 'neutral', sequence: e.sequence });
      else if (output?.toolId === 'simkind.recall') notes.push({ actor, text: 'Recalled earlier evidence before deciding.', tone: 'neutral', sequence: e.sequence });
      else if (output?.toolId === null) notes.push({ actor, text: 'Chose to take no action.', tone: 'neutral', sequence: e.sequence });
    }
    if (e.type === 'request') {
      const c = d.context as JsonObject;
      if (!visible.some(r => ['model-result', 'model-error', 'model-timeout'].includes(r.type) && (r.data as JsonObject).requestId === c.requestId)) notes.push({ actor: String(c.instanceId), text: live ? 'Deciding…' : 'No decision result recorded.', tone: live ? 'pending' : 'neutral', sequence: e.sequence });
    }
  }
  return notes.sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity));
}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
export function renderShopRecap(container: HTMLElement, report: ShopReport, notes: ShopNote[], previous: ShopReport | undefined, inspect: (sequence: number) => void) {
  container.replaceChildren();
  const summary = node('p', `Rent fund $${report.till} · ${report.arrears ? `$${report.arrears} overdue · production suspended` : `next rent $${report.rent}`} · customer revenue $${report.customerRevenue}`); summary.className = 'report-summary'; container.append(summary);
  for (const note of notes.filter(n => n.actor === 'operator:shop')) container.append(node('p', note.text));
  for (const [actor, person] of Object.entries(report.people)) {
    const card = node('article'); card.className = 'report-person'; card.setAttribute('aria-label', `${name(actor)} · Turn ${report.tick}`); card.append(node('h2', name(actor)));
    const list = node('ul'); list.className = 'activity-list';
    const activity = notes.filter(n => n.actor === actor);
    if (!activity.length) activity.push({ actor, text: report.tick === 0 ? 'Ready to negotiate the first orders.' : 'No new action this turn.', tone: 'neutral' });
    for (const note of activity) {
      const item = node('li'); item.className = `activity-${note.tone}`;
      if (note.sequence !== undefined) { const button = node('button', note.text); button.className = 'activity-evidence'; button.onclick = () => inspect(note.sequence!); item.append(button); }
      else item.append(node('span', note.text));
      if (note.quote) item.append(node('blockquote', note.quote)); list.append(item);
    }
    card.append(list);
    const before = previous?.people[actor]?.inventory, inventory = person.inventory;
    if (before) {
      const changes = goods.flatMap(g => { const delta = g === 'tools' ? inventory.tools.length - before.tools.length : inventory[g] - before[g]; return delta ? [`${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${g}`] : []; });
      if (changes.length) { const p = node('p', `Changed: ${changes.join(', ')}`); p.className = 'report-changes'; card.append(p); }
    }
    if (person.working) { const p = node('p', `${person.working.kind === 'repair' ? 'Repair' : 'Manufacturing'} in progress · due turn ${person.working.due}.`); p.className = 'report-pending'; card.append(p); }
    const details = node('details'); details.className = 'report-holdings';
    details.append(node('summary', `$${inventory.cash} · ${inventory.materials} materials · ${inventory.standard + inventory.premium} products · ${inventory.tools.length} equipment`));
    details.append(node('p', `Available: ${inventory.standard} standard, ${inventory.premium} premium. Equipment uses: ${inventory.tools.join(', ') || 'none'}. Owned cash including reservations: $${person.owned.cash}.`));
    const loans = report.loans.filter(l => l.borrower === actor); if (loans.length) details.append(node('p', loans.map(l => `Rented from ${name(l.owner)}: ${l.uses} uses, returns turn ${l.returnAt}.`).join(' ')));
    card.append(details); container.append(card);
  }
}
export function renderShopOrders(container: HTMLElement, report: ShopReport) {
  container.replaceChildren();
  for (const order of report.orders) {
    const card = node('article'); card.className = 'shop-order';
    card.append(node('h3', `${order.customer} · $${order.payment}`));
    card.append(node('p', `${order.quantity} ${order.quality} units · due turn ${order.deadline} · ${order.status}${order.claimant ? ` by ${name(order.claimant)}` : ''}`));
    const details = node('details'); details.append(node('summary', `${order.id} · revision ${order.revision} · ${order.recipient ? `private lead: ${name(order.recipient)}` : 'public'}`));
    details.append(node('p', order.brief)); card.append(details); container.append(card);
  }
}
export function renderShopWorld(container: HTMLElement, report: ShopReport) {
  container.hidden = false; container.replaceChildren();
  container.append(node('p', `Cash audit: $${report.cash} held + $${report.paidRent} rent paid + $${report.supplierCosts} supplier payments = $${report.initialCash} starting cash + $${report.customerRevenue} customer revenue.`));
  container.append(node('h3', 'Open agreements'));
  if (!report.offers.length) container.append(node('p', 'No open agreements.'));
  for (const o of report.offers) container.append(node('p', `${name(o.owner)} · ${o.kind}: ${describe(o.give)} for ${o.kind === 'job' ? `${o.quantity} manufactured units` : describe(o.want)} · ${o.status} · expires turn ${o.expiresAt}.`));
  container.append(node('p', 'Private inventories and leads here are operator information. Characters only see their own private observations. Spoken equity and commission promises are nonbinding.'));
}
