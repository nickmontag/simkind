import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario, openArchivedRun } from '../src/runner/node.js';
import { createCharacterRunner, CharacterRunner, prepareLaunch, type DecisionContext, type ModelConnection } from '../src/runner/index.js';
import { economyFixtureConnection } from '../examples/economy/fixture.js';
import { economyHost } from '../examples/economy/host.js';
import { take, allCoins, type EconomyWorld } from '../examples/economy/model.js';
import { economyCsv, recordedEconomyReports } from '../examples/economy/report.js';
import { PlaygroundSession } from '../playground/session.js';
import type { ActionProposal, JsonObject } from '../src/format/index.js';
const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
const idle: ModelConnection = { public: { provider: 'fixture', model: 'idle', settings: {} }, capabilities: { text: true, json: true }, fulfill: async () => ({ output: { toolId: null, arguments: {} } }) };
async function setup() {
  const loaded = await loadScenario(root, 'small-economy.json', 'config-economy.json'); if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  const launch = prepareLaunch(loaded.value, economyHost, { primary: idle }, 'run:economy'); if (!launch.ok) throw new Error(JSON.stringify(launch.diagnostics));
  const host = economyHost.create(launch.value); let seq = 0;
  const proposal = (actor: string, toolId: string, args: JsonObject): ActionProposal => ({ id: `action:${++seq}`, runId: launch.value.runId, requestId: `request:${seq}`, actor: 'simkin:' + actor, observedRevision: host.revision(), toolId, toolVersion: economyHost.descriptor.toolCatalog.tools.find(tool => tool.id === toolId)?.version ?? '1.0.0', arguments: args });
  const act = (actor: string, toolId: string, args: JsonObject) => host.submit(proposal(actor, toolId, args));
  const world = () => (host.inspect() as unknown as { world: EconomyWorld }).world;
  return { host, world, act, proposal, bundle: loaded.value };
}
const trade = (give: JsonObject, want: JsonObject, to: string | null = null, expiresAt = 5) => ({ kind: 'trade', to, give, want, task: null, useTool: false, expiresAt });
const job = (give: JsonObject, task = 'food', useTool = false) => ({ kind: 'job', to: 'simkin:dev', give, want: {}, task, useTool, expiresAt: 5 });

describe('small economy contracts and accounting', () => {
  it('consumes crafting inputs, preserves minimum subsistence yield, and revalidates harvest interventions', async () => {
    const { host, world, act, proposal } = await setup(); host.advance();
    act('cleo', 'produce', { task: 'tools', useTool: false }); host.advance(); host.drainEvents();
    expect(world().people['simkin:cleo'].inventory).toMatchObject({ timber: 0, tools: [4, 4, 4, 4] });
    while ((host.time().value as number) < 13) host.advance();
    expect(world().people['simkin:dev'].hungry).toBe(true);
    const edit = { ...proposal('ada', 'operator.harvest', { multiplier: 0.25 }), actor: 'operator:test' };
    expect(host.previewIntervention!(edit).valid).toBe(true); host.intervene!(edit);
    const changed = world();
    expect(host.previewIntervention!(edit).valid).toBe(false);
    expect(host.intervene!({ ...edit, id: 'intervention:stale', requestId: 'intervention:stale' }).at(-1)?.status).toBe('rejected');
    expect(world()).toEqual(changed);
    act('dev', 'produce', { task: 'food', useTool: false }); host.advance(); host.drainEvents();
    expect(world().people['simkin:dev'].inventory.food).toBe(1);
  });
  it('produces asynchronously, spends one shift, wears tools, consumes food, and closes exactly 12 days', async () => {
    const { host, world, act } = await setup(); host.advance();
    expect(act('ada', 'produce', { task: 'food', useTool: true }).map(e => e.status)).toEqual(['accepted', 'running']);
    expect(world().people['simkin:ada'].inventory.food).toBe(8);
    host.advance(); expect(host.drainEvents()[0].status).toBe('succeeded');
    expect(world().people['simkin:ada'].inventory).toMatchObject({ food: 14, tools: [3] });
    expect(act('ada', 'produce', { task: 'food', useTool: false }).at(-1)?.status).toBe('rejected');
    while (host.time().value as number < 49) host.advance();
    expect(world().completed).toBe(true); expect(world().history).toHaveLength(12);
    expect(world().people['simkin:ada'].inventory.food).toBe(2);
    expect(world().people['simkin:dev'].missedMeals).toBe(10);
    expect(host.decisionActors()).toEqual([]); expect(allCoins(world())).toBe(65);
    host.advance(); expect(world().history).toHaveLength(12);
  });
  it('escrows and atomically settles a trade exactly once, preserving tool durability', async () => {
    const { host, world, proposal, act } = await setup(); host.advance();
    const p = proposal('ada', 'offer', trade({ tools: 1 }, { coins: 4 }, 'simkin:bram'));
    host.submit(p); const state = world();
    expect(state.people['simkin:ada'].inventory.tools).toEqual([]); expect(state.offers[0].escrow.tools).toEqual([4]);
    expect(host.submit(p)).toEqual([]); expect(world()).toEqual(state);
    expect(act('dev', 'accept', { offerId: p.id }).at(-1)?.status).toBe('rejected');
    expect(act('bram', 'accept', { offerId: p.id }).at(-1)?.status).toBe('succeeded');
    expect(world().people['simkin:bram'].inventory).toMatchObject({ coins: 4, tools: [4] });
    const settled = world();
    expect(act('bram', 'accept', { offerId: p.id }).at(-1)?.status).toBe('rejected'); expect(world()).toEqual(settled);
    expect(allCoins(world())).toBe(65);
  });
  it('pays wages only after work, gives output to the employer, and returns its worn tool', async () => {
    const { host, world, act } = await setup(); host.advance();
    act('ada', 'offer', job({ coins: 3 }, 'food', true)); const offer = world().offers[0];
    expect(world().people['simkin:ada'].inventory.coins).toBe(37);
    const accepted = act('dev', 'accept', { offerId: offer.id }); expect(accepted.at(-1)?.status).toBe('running');
    expect(world().people['simkin:dev'].inventory.coins).toBe(2); expect(allCoins(world())).toBe(65);
    host.advance(); host.drainEvents();
    expect(world().people['simkin:dev'].inventory.coins).toBe(5);
    expect(world().people['simkin:ada'].inventory).toMatchObject({ food: 12, tools: [3] });
    expect(world().transactions[0]).toMatchObject({ kind: 'wage', quantity: 4, task: 'food' });
    expect(allCoins(world())).toBe(65);
  });
  it('cancels work without manufacturing goods or wages, and expires open offers without losing coins', async () => {
    const { host, world, act } = await setup(); host.advance();
    act('ada', 'offer', job({ coins: 3 }, 'food', true)); const offer = world().offers[0];
    const accepted = act('dev', 'accept', { offerId: offer.id });
    expect(host.cancel(accepted[0].actionId).map(e => e.status)).toContain('cancelled');
    expect(world().people['simkin:ada'].inventory).toMatchObject({ coins: 40, food: 8, tools: [4] });
    expect(world().people['simkin:dev'].inventory.coins).toBe(2); expect(world().transactions).toEqual([]);
    expect(act('dev', 'produce', { task: 'food', useTool: false }).at(-1)?.status).toBe('rejected');
    act('ada', 'offer', trade({ coins: 10 }, { food: 1 }, null, 2));
    host.advance(); host.drainEvents(); expect(world().people['simkin:ada'].inventory.coins).toBe(40); expect(allCoins(world())).toBe(65);
  });
  it('rejects double-spending wages/materials and malformed terms with no world mutation', async () => {
    const { host, world, act } = await setup(); host.advance(); const before = world();
    for (const args of [job({ coins: 100 }), job({ tools: 1 }, 'food', true), { ...trade({ coins: 1 }, { food: 1 }), give: { coins: -1 } }, { ...trade({ coins: 1 }, { food: 1 }), expiresAt: 1 }, { ...trade({ coins: 1 }, { food: 1 }), task: 'tools' }]) {
      expect(act('ada', 'offer', args).at(-1)?.status).toBe('rejected'); expect(world()).toEqual(before);
    }
    act('ada', 'offer', trade({ coins: 30 }, { food: 1 })); const reserved = world();
    expect(act('ada', 'offer', trade({ coins: 20 }, { food: 1 })).at(-1)?.status).toBe('rejected'); expect(world()).toEqual(reserved);
  });
  it('records operator snapshots without leaking other balances or private messages to model contexts', async () => {
    const { bundle } = await setup(); const contexts: DecisionContext[] = [];
    const result = createCharacterRunner(bundle, economyHost, { primary: { ...idle, fulfill: async context => { contexts.push(context); return { output: context.instanceId === 'simkin:ada' ? { toolId: 'say', arguments: { text: 'Private price proposal.', to: 'simkin:dev' } } : { toolId: null, arguments: {} } }; } } }, 'run:private');
    if (!result.ok) throw new Error('fixture'); const runner = result.value;
    runner.step(); await runner.settleDecisions(); runner.step(); await runner.settleDecisions();
    const reports = recordedEconomyReports(runner.events()); expect(reports.at(-1)?.people['simkin:ada'].inventory.coins).toBe(40);
    for (const context of contexts) {
      expect(context.observations.every(o => o.recipient === context.instanceId)).toBe(true);
      const data = context.observations[0].content[0] as unknown as { data: { participants: Record<string, object> } };
      expect(Object.values(data.data.participants).every(p => !('inventory' in p))).toBe(true);
      if (context.instanceId === 'simkin:bram' || context.instanceId === 'simkin:cleo') expect(JSON.stringify(context)).not.toContain('Private price proposal.');
    }
    const checkpoint = runner.checkpoint(); const child = CharacterRunner.restore(checkpoint, economyHost, { primary: idle }, 'run:alternative');
    child.interveneHost({ operator: 'operator:test', operationId: 'operator.wealth', operationVersion: '1.0.0', expectedRevision: child.hostInterventions().revision, arguments: { visible: true } });
    expect(recordedEconomyReports(child.events()).at(-1)?.publicWealth).toBe(true);
    expect((runner.inspect().host as unknown as { world: EconomyWorld }).world.publicWealth).toBe(false);
    expect(CharacterRunner.restore(child.checkpoint(), economyHost, { primary: idle }).inspect()).toEqual(child.inspect());
  });
  it('automatically saves completed long runs as resumable archives and reconstructs the dashboard without a provider', async () => {
    const output = await mkdtemp(join(tmpdir(), 'simkind-economy-'));
    try {
      const session = new PlaygroundSession(root, output, {}, economyFixtureConnection);
      session.start(await session.template('small-economy.json'));
      await session.step(); const early = await session.save();
      for (let i = 1; i < 49; i++) await session.step();
      const state = session.state(); if (!('savedRecording' in state) || !state.savedRecording) throw new Error(JSON.stringify(state));
      const loaded = await openArchivedRun(join(output, state.savedRecording));
      const events = []; for (let offset = 0;; offset += 256) { const page = loaded.events(offset, 256); events.push(...page); if (page.length < 256) break; }
      expect(state.savedRecording).not.toBe(early);
      const reports = recordedEconomyReports(events);
      expect(reports.at(-1)).toMatchObject({ completed: true, conservedCoins: 65 });
      expect(reports.at(-1)?.history).toHaveLength(12);
      expect(reports.at(-1)?.transactions.filter(t => t.kind === 'wage')).toHaveLength(12);
      expect(reports.at(-1)?.transactions.filter(t => t.kind === 'trade').length).toBeGreaterThan(20);
      expect(loaded.manifest.capabilities.restore).toBe(true);
      loaded.close();
      expect(state.saveNote).toBeUndefined();
      expect(economyCsv(reports.at(-1)!)).toContain('"12","simkin:dev"');
      const malformed = structuredClone(events.filter(e => e.type === 'observation' && (e.data as JsonObject).recipient === 'operator:market').slice(-1));
      const payload = malformed[0].data as unknown as { content: { data: { people: object } }[] };
      payload.content[0].data.people = { broken: { inventory: null } };
      expect(recordedEconomyReports(malformed)).toEqual([]);
      await session.open(state.savedRecording); expect(session.state()).toMatchObject({ mode: 'playback', economy: { completed: true } });
    } finally { await rm(output, { recursive: true, force: true }); }
  }, 15000); // Full 49-turn disk/archive workload also runs beside the other test files.
});


describe('host-defined negotiated quality', () => {
  it('selects qualifying items, enforces both sides of a bargain and records actual durability', async () => {
    const stock = { coins: 0, food: 0, timber: 0, tools: [2, 4, 3] };
    expect(take(stock, { tools: 1 }, 4).tools).toEqual([4]);
    expect(stock.tools).toEqual([2, 3]);
    expect(() => take(stock, { tools: 1 }, 4)).toThrow('Insufficient');
    expect(stock.tools).toEqual([2, 3]);
    const { host, act, world } = await setup(); host.advance();
    act('cleo', 'produce', { task: 'food', useTool: true }); host.advance(); host.drainEvents();
    expect(world().people['simkin:cleo'].inventory.tools).toEqual([4, 3]);
    const offer = act('cleo', 'offer', { ...trade({ tools: 1 }, { coins: 2 }), giveToolMinUses: 4 });
    expect(offer.at(-1)?.result).toMatchObject({ effect: 'offer-posted-and-resources-reserved; no trade or job completed', offerStatus: 'open' });
    expect(world().transactions).toEqual([]);
    const accepted = act('dev', 'accept', { offerId: offer[0].actionId });
    expect(accepted.at(-1)?.status).toBe('succeeded');
    expect(world().people['simkin:dev'].inventory.tools).toEqual([4]);
    expect(world().transactions.at(-1)?.transferred?.give.tools).toEqual([4]);
    const wanted = act('ada', 'offer', { ...trade({ coins: 1 }, { tools: 1 }), wantToolMinUses: 4 });
    const before = world();
    expect(act('cleo', 'accept', { offerId: wanted[0].actionId }).at(-1)?.status).toBe('rejected');
    expect(world()).toEqual(before);
    expect(allCoins(world())).toBe(65);
  });
});
