import { toolQuality } from './economy-terms.js';
import type { JsonObject, RunEvent } from 'simkind/format';
import type { EconomyReport } from '../examples/economy/report.js';
import type { Holdings } from '../examples/economy/model.js';

export const personName = (id: string) => id.replace('simkin:', '').replace(/^./, c => c.toUpperCase());
const dataOf = (event: RunEvent) => event.data as JsonObject;
const resources = (value: unknown, minimum?: unknown, delivered?: unknown) => Object.entries((value ?? {}) as JsonObject).filter(([, n]) => Number(n) > 0).map(([g, n]) => `${n} ${Number(n) === 1 && g === 'coins' ? 'coin' : Number(n) === 1 && g === 'tools' ? 'tool' : g}${g === 'tools' ? toolQuality(minimum, delivered) : ''}`).join(', ') || 'nothing';
const stock = (value: unknown): value is Holdings => {
  if (!value || typeof value !== 'object') return false;
  const s = value as Holdings;
  return [s.coins, s.food, s.timber].every(n => Number.isSafeInteger(n) && n >= 0) && Array.isArray(s.tools) && s.tools.every(n => Number.isInteger(n) && n >= 1 && n <= 4);
};
type Note = { tone: 'error' | 'pending' | 'done' | 'neutral'; text: string; quote?: string; sequence?: number };

function attempt(tool: string, args: JsonObject): string {
  switch (tool) {
    case 'produce': return `produce ${args.task}`;
    case 'offer': return `offer ${resources(args.give, args.giveToolMinUses)} for ${args.kind === 'job' ? `a ${args.task} shift` : resources(args.want, args.wantToolMinUses)}`;
    case 'accept': return 'accept an offer';
    case 'cancel': return 'withdraw an offer';
    case 'say': return `send a message to ${args.to ? personName(String(args.to)) : 'everyone'}`;
    default: return tool;
  }
}

/** Derives a chronological activity list for each participant from recorded facts.
 * Admission/result rows collapse to one activity; transfers also appear for the counterparty. */
export function economyRecap(events: readonly RunEvent[], report: EconomyReport, options: { previous?: EconomyReport; throughSequence?: number; live?: boolean } = {}) {
  const visible = events.filter(e => e.sequence <= (options.throughSequence ?? Infinity) && typeof e.time.value === 'number' && e.time.value <= report.tick);
  const round = visible.filter(e => e.time.value === report.tick);
  const proposals = new Map(visible.filter(e => e.type === 'proposal').map(e => [String(dataOf(e).id), dataOf(e)]));
  const outcomes = new Map(round.filter(e => e.type === 'action').map(e => [String(dataOf(e).actionId), e]));
  const failures = round.filter(e => e.type === 'model-error' || e.type === 'model-timeout' || e.type === 'memory-retrieval' && ['failed', 'timeout'].includes(String(dataOf(e).phase)));
  const activity = new Map<string, Note[]>();
  function add(actor: string, note: Note) { const notes = activity.get(actor) ?? []; notes.push(note); activity.set(actor, notes); }
  for (const event of round.filter(e => e.type === 'memory-retrieval')) {
    const data = dataOf(event);
    if (data.phase === 'started' && options.live && !visible.some(e => e.type === 'memory-retrieval' && dataOf(e).requestId === data.requestId && dataOf(e).phase !== 'started')) add(String(data.actor), { tone: 'pending', sequence: event.sequence, text: 'Recalling relevant experiences…' });
    if (data.phase === 'failed' || data.phase === 'timeout') add(String(data.actor), { tone: 'error', sequence: event.sequence, text: data.phase === 'timeout' ? 'Memory retrieval timed out before deciding.' : 'Memory retrieval failed before deciding.' });
  }
  for (const request of visible.filter(e => e.type === 'request')) {
    const context = dataOf(request).context as JsonObject;
    if (!context) continue;
    const actor = String(context.instanceId);
    const failure = failures.find(e => dataOf(e).requestId === context.requestId);
    const result = visible.find(e => e.type === 'model-result' && dataOf(e).requestId === context.requestId);
    if (context.purpose === 'consolidation') {
      if (failure) add(actor, { tone: 'error', sequence: failure.sequence, text: 'Memory consolidation failed; previous memory was preserved.' });
      else if (result && result.time.value === report.tick) add(actor, { tone: 'neutral', sequence: result.sequence, text: 'Consolidated older experiences into memory.' });
      continue;
    }
    if (result && result.time.value === report.tick && (dataOf(result).output as JsonObject)?.toolId === 'simkind.recall') { add(actor, { tone: 'neutral', sequence: result.sequence, text: 'Recalled earlier experiences before deciding.' }); continue; }
    if (failure) {
      const code = dataOf(failure).code;
      const diagnostic = dataOf(failure).diagnostic as JsonObject | undefined;
      const explanation = diagnostic?.reason === 'OUTPUT_LIMIT' ? 'Ran out of output tokens before completing a decision.'
        : diagnostic?.reason === 'HTTP_ERROR' ? `Provider request failed${diagnostic.httpStatus ? ` (HTTP ${diagnostic.httpStatus})` : ''}.`
        : diagnostic?.reason === 'NETWORK_ERROR' ? 'Could not reach the model provider.'
        : diagnostic?.reason === 'MISSING_OUTPUT' ? 'Provider returned no decision text.'
        : diagnostic?.reason === 'INVALID_RESPONSE' ? 'Provider returned an unreadable response.' : 'Provider failed. No decision was returned.';
      add(actor, { tone: 'error', sequence: failure.sequence, text: failure.type === 'model-timeout' ? 'Decision timed out.'
        : code === 'PROVIDER_ERROR' ? explanation : `Decision failed (${code ?? 'invalid output'}).` });
    } else if (result && result.time.value === report.tick && (dataOf(result).output as JsonObject)?.toolId === null) {
      add(actor, { tone: 'neutral', sequence: result.sequence, text: 'Chose to take no action.' });
    } else if (request.time.value === report.tick && !result && !visible.some(e => (e.type === 'model-error' || e.type === 'model-timeout') && dataOf(e).requestId === context.requestId)) {
      add(actor, { tone: options.live ? 'pending' : 'neutral', sequence: request.sequence, text: options.live ? 'Deciding…' : 'No decision result recorded.' });
    }
  }
  for (const [actionId, event] of outcomes) {
    const outcome = dataOf(event); const actor = String(outcome.actor); const action = proposals.get(actionId);
    const args = action?.arguments as JsonObject ?? {};
    const status = String(outcome.status); const tool = String(action?.toolId ?? 'Action');
    const done = status === 'succeeded';
    if (['rejected', 'failed', 'cancelled'].includes(status)) {
      const reason = outcome.reason as JsonObject | string | undefined;
      const reasonText = typeof reason === 'string' ? reason : reason?.message ?? reason?.code;
      add(actor, { tone: 'error', sequence: event.sequence, text: `${status === 'cancelled' ? 'Cancelled attempt to' : 'Could not'} ${attempt(tool, args)}.${reasonText ? ` ${reasonText}` : ''}` });
      continue;
    }
    if (status === 'accepted') { add(actor, { tone: 'pending', sequence: event.sequence, text: `Accepted for execution: ${attempt(tool, args)}.` }); continue; }
    let text = `${done ? 'Completed' : 'Started'} ${tool}.`; let quote: string | undefined;
    const offer = proposals.get(String(args.offerId));
    const terms = offer?.toolId === 'offer' ? offer.arguments as JsonObject : undefined;
    if (tool === 'say') { text = `${done ? 'Said' : 'Sending a message'} to ${args.to ? personName(String(args.to)) + ' privately' : 'everyone'}:`; quote = String(args.text ?? ''); }
    if (tool === 'offer') text = args.kind === 'job' ? `Offered ${args.to ? personName(String(args.to)) : 'anyone'} ${resources(args.give, args.giveToolMinUses)} for a ${args.task} shift.`
      : `Proposed a trade${args.to ? ` with ${personName(String(args.to))}` : ''}: ${resources(args.give, args.giveToolMinUses)} for ${resources(args.want, args.wantToolMinUses)}.`;
    if (tool === 'produce') {
      const previous = options.previous?.people[actor]?.working;
      const quantity = previous?.actionId === actionId ? previous.quantity : undefined;
      text = done ? quantity !== undefined ? `Produced ${resources({ [String(args.task)]: quantity })}.` : `Finished producing ${args.task}.`
        : `Started ${args.task === 'tools' ? 'crafting tools' : `gathering ${args.task}`}${args.useTool ? ' with a tool' : ''}.`;
    }
    if (tool === 'cancel') text = 'Withdrew an open offer and reclaimed its reserved resources.';
    if (tool === 'simkind.revise') text = 'Updated personal intentions or interpretations.';
    if (tool === 'accept' && terms && offer) {
      const owner = String(offer.actor);
      if (terms.kind === 'trade') {
        const delivered = report.transactions.find(t => t.tick === report.tick && t.kind === 'trade' && t.from === owner && t.to === actor)?.transferred;
        text = `${done ? 'Traded' : 'Trading'} ${resources(terms.want, terms.wantToolMinUses, delivered?.want.tools)} to ${personName(owner)} for ${resources(terms.give, terms.giveToolMinUses, delivered?.give.tools)}.`;
        if (done) add(owner, { tone: 'done', sequence: event.sequence, text: `Traded ${resources(terms.give, terms.giveToolMinUses, delivered?.give.tools)} to ${personName(actor)} for ${resources(terms.want, terms.wantToolMinUses, delivered?.want.tools)}.` });
      } else {
        text = done ? `Finished ${personName(owner)}’s ${terms.task} job and earned ${resources(terms.give, terms.giveToolMinUses)}.`
          : `Accepted ${personName(owner)}’s ${terms.task} job for ${resources(terms.give, terms.giveToolMinUses)}.`;
        if (done) {
          const payment = report.transactions.find(t => t.tick === report.tick && t.kind === 'wage' && t.from === owner && t.to === actor && t.task === terms.task);
          add(owner, { tone: 'done', sequence: event.sequence, text: `Paid ${personName(actor)} ${resources(terms.give, terms.giveToolMinUses)}${payment ? ` and received ${payment.quantity} ${payment.task}` : ''}.` });
        }
      }
    }
    add(actor, { tone: done ? 'done' : 'pending', sequence: event.sequence, text, ...(quote ? { quote } : {}) });
  }
  const people = Object.entries(report.people).map(([actor, person]) => {
    const prior = options.previous;
    const boundarySequence = round.find(e => e.type === 'observation' && dataOf(e).recipient === actor)?.sequence ?? options.throughSequence ?? round.at(-1)?.sequence;
    for (const offer of prior?.offers ?? []) {
      if (offer.owner === actor && offer.status === 'open' && (offer.expiresAt <= report.tick || report.completed) && !report.offers.some(o => o.id === offer.id)) {
        add(actor, { tone: 'neutral', sequence: boundarySequence, text: 'An open offer expired; its reserved resources were returned.' });
      }
    }
    if (prior && (report.history.at(-1)?.day ?? 0) > (prior.history.at(-1)?.day ?? 0)) {
      const missed = person.missedMeals - (prior.people[actor]?.missedMeals ?? person.missedMeals);
      add(actor, { tone: missed ? 'error' : 'neutral', sequence: boundarySequence,
        text: missed ? 'Day ended without a meal. Next day’s production is reduced.' : 'Ate 1 food at day end.' });
    }
    const notes = (activity.get(actor) ?? []).sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity));
    if (!notes.length) notes.push({ tone: 'neutral', text: report.tick === 0 ? 'Ready for the first turn.' : 'No new action this turn.' });
    const work = person.working;
    const pending = work ? `${work.quantity} ${work.task}${work.owner !== actor ? ` for ${personName(work.owner)}` : ''} due ${work.due === report.tick + 1 ? 'next turn' : `turn ${work.due}`}.` : undefined;
    const opening = round.filter(e => e.type === 'observation' && dataOf(e).recipient === actor).flatMap(e => {
      const content = dataOf(e).content; if (!Array.isArray(content)) return [];
      return content.flatMap(c => { const you = ((c as JsonObject)?.data as JsonObject | undefined)?.you as JsonObject | undefined; return stock(you?.inventory) ? [you.inventory] : []; });
    })[0];
    const before = options.previous?.people[actor]?.inventory ?? opening;
    const changes: string[] = [];
    if (before) {
      for (const good of ['coins', 'food', 'timber', 'tools'] as const) {
        const delta = good === 'tools' ? person.inventory.tools.length - before.tools.length : person.inventory[good] - before[good];
        if (delta) changes.push(`${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${good}`);
      }
      const wear = person.inventory.tools.reduce((a, b) => a + b, 0) - before.tools.reduce((a, b) => a + b, 0);
      if (wear && person.inventory.tools.length === before.tools.length) changes.push(`${wear > 0 ? '+' : '−'}${Math.abs(wear)} tool uses`);
    }
    const reserved = { coins: person.owned.coins - person.inventory.coins, food: person.owned.food - person.inventory.food, timber: person.owned.timber - person.inventory.timber, tools: person.owned.tools.length - person.inventory.tools.length };
    return { actor, name: personName(actor), notes, pending, inventory: person.inventory, reserved: Object.values(reserved).some(n => n > 0) ? resources(reserved) : undefined,
      changes: before ? changes.join(', ') || 'No inventory change' : 'Opening inventory comparison unavailable' };
  });
  const trades = report.transactions.filter(t => t.tick === report.tick && t.kind === 'trade').length;
  const jobs = report.transactions.filter(t => t.tick === report.tick && t.kind === 'wage').length;
  const working = Object.values(report.people).filter(p => p.working).length;
  return { people, failures: failures.length, working, summary: report.tick === 0 ? 'Each character has different resources, skills, and goals.'
    : [failures.length ? `${failures.length} ${failures.length === 1 ? 'decision' : 'decisions'} failed` : '', working ? `${working} working` : '', trades ? `${trades} ${trades === 1 ? 'trade' : 'trades'}` : '', jobs ? `${jobs} ${jobs === 1 ? 'job' : 'jobs'} paid` : ''].filter(Boolean).join(' · ') };
}

export function renderEconomyRecap(container: HTMLElement, recap: ReturnType<typeof economyRecap>, report: EconomyReport, inspect: (sequence: number) => void) {
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const value = document.createElement(tag); if (text) value.textContent = text; return value; };
  container.replaceChildren();
  if (recap.summary) { const summary = node('p', recap.summary); summary.className = 'report-summary'; container.append(summary); }
  for (const person of recap.people) {
    const card = node('article'); card.className = 'report-person'; card.setAttribute('aria-label', `${person.name} · Turn ${report.tick}`);
    card.append(node('h2', person.name));
    const list = node('ul'); list.className = 'activity-list';
    for (const note of person.notes) {
      const item = node('li'); item.className = `activity-${note.tone}`;
      if (note.sequence !== undefined) { const button = node('button', note.text); button.className = 'activity-evidence'; button.setAttribute('aria-label', `Inspect evidence: ${person.name} — ${note.text}`); button.onclick = () => inspect(note.sequence!); item.append(button); }
      else item.append(node('span', note.text));
      if (note.quote) item.append(node('blockquote', note.quote));
      list.append(item);
    }
    card.append(list);
    if (person.changes !== 'No inventory change') { const changes = node('p', `Changed: ${person.changes}`); changes.className = 'report-changes'; card.append(changes); }
    if (person.pending) { const pending = node('p', `Pending: ${person.pending}`); pending.className = 'report-pending'; card.append(pending); }
    const holdings = node('details'); holdings.className = 'report-holdings';
    holdings.append(node('summary', `${person.inventory.coins} ${person.inventory.coins === 1 ? 'coin' : 'coins'} · ${person.inventory.food} food · ${person.inventory.timber} timber · ${person.inventory.tools.length} ${person.inventory.tools.length === 1 ? 'tool' : 'tools'}`));
    holdings.append(node('p', `Available resources. ${person.reserved ? `Reserved: ${person.reserved}. ` : ''}Tool uses remaining: ${person.inventory.tools.join(', ') || 'none'}.`));
    card.append(holdings); container.append(card);
  }
}
