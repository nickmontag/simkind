import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario, openArchivedRun } from '../src/runner/node.js';
import { prepareLaunch, type ModelConnection } from '../src/runner/index.js';
import type { ActionProposal, JsonObject } from '../src/format/index.js';
import { fabricationHost } from '../examples/fabrication/host.js';
import { fabricationFixture } from '../examples/fabrication/fixture.js';
import { cashTotal, check, type ShopWorld } from '../examples/fabrication/model.js';
import { recordedShopReports, shopReport } from '../examples/fabrication/report.js';
import { PlaygroundSession } from '../playground/session.js';
import { shopFrames, TurnCursor } from '../playground/turn-timeline.js';
import { shopRecap } from '../playground/shop-view.js';
import { observerEvent } from '../playground/evidence.js';
const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
const idle: ModelConnection = { public: { provider: 'fixture', model: 'idle', settings: {} }, capabilities: { text: true, json: true }, fulfill: async () => ({ output: { toolId: null, arguments: {} } }) };
async function setup(change?: (initial: ShopWorld) => void) {
  const loaded = await loadScenario(root, 'fabrication-shop.json', 'config-fabrication.json'); if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  const scene = loaded.value.documents[loaded.value.scenarioId]; if (scene.kind !== 'scenario') throw new Error('Expected scenario.');
  change?.(scene.initialConditions as unknown as ShopWorld);
  const prepared = prepareLaunch(loaded.value, fabricationHost, { primary: idle }, 'run:fabrication'); if (!prepared.ok) throw new Error(JSON.stringify(prepared.diagnostics));
  const host = fabricationHost.create(prepared.value); let seq = 0;
  const proposal = (actor: string, toolId: string, args: JsonObject): ActionProposal => ({ id: `action:${++seq}`, requestId: `request:${seq}`, runId: prepared.value.runId, actor: actor.startsWith('operator:') ? actor : `simkin:${actor}`, observedRevision: host.revision(), toolId, toolVersion: '1.0.0', arguments: args });
  const act = (actor: string, tool: string, args: JsonObject = {}) => host.submit(proposal(actor, tool, args));
  const world = () => (host.inspect() as unknown as { world: ShopWorld }).world;
  const advance = () => { host.advance(); return host.drainEvents(); };
  return { host, world, act, proposal, advance, launch: prepared.value };
}
const order = (id = 'order:new', recipient: string | null = null) => ({ id, customer: 'Test customer', quantity: 3, quality: 'premium', payment: 40, deadline: 20, recipient, brief: 'A new batch.' });
const offer = (kind = 'trade', extra: JsonObject = {}): JsonObject => ({ kind, to: null, give: { cash: 1 }, want: {}, expiresAt: 10, minUses: 1, quantity: 0, rentalTurns: 0, ...extra });

describe('fabrication shop orders and contracts', () => {
  it('keeps private leads private and admits recorded new orders only at the current revision', async () => {
    const { host, world, act, advance, proposal } = await setup(); advance();
    expect(JSON.stringify(host.observe('simkin:ada'))).not.toContain('Vector Robotics');
    expect(JSON.stringify(host.observe('simkin:dev'))).toContain('Vector Robotics');
    expect(act('ada', 'claim_order', { orderId: 'order:prototype', orderRevision: 1 }).at(-1)?.status).toBe('rejected');
    const edit = proposal('operator:test', 'operator.add_order', order('order:secret', 'simkin:bram'));
    const before = world(); expect(host.previewIntervention!(edit).valid).toBe(true); expect(world()).toEqual(before);
    expect(host.intervene!(edit).at(-1)?.status).toBe('succeeded');
    expect(JSON.stringify(host.observe('simkin:cleo'))).not.toContain('order:secret');
    expect(JSON.stringify(host.observe('simkin:bram'))).toContain('order:secret');
    expect(host.intervene!({ ...edit, id: 'action:stale', requestId: 'request:stale' }).at(-1)?.status).toBe('rejected');
    expect(act('bram', 'publish_lead', { orderId: 'order:secret' }).at(-1)?.status).toBe('succeeded');
    expect(JSON.stringify(host.observe('simkin:cleo'))).toContain('order:secret');
    expect(world().orders).toHaveLength(4);
  });
  it('revalidates amended orders, quantity, quality, and inclusive deadlines without partial delivery', async () => {
    const { host, world, act, advance, proposal } = await setup(w => { w.people['simkin:cleo'].inventory.premium = 4; }); advance();
    act('cleo', 'claim_order', { orderId: 'order:pop-up', orderRevision: 1 });
    const original = world().orders[0];
    const amended = { ...order(original.id), customer: original.customer, quantity: 5, deadline: 5 };
    expect(host.intervene!(proposal('operator:test', 'operator.amend_order', amended)).at(-1)?.status).toBe('succeeded');
    const before = world();
    expect(act('cleo', 'deliver', { orderId: original.id, orderRevision: 1 }).at(-1)?.reason).toContain('terms changed');
    expect(act('cleo', 'deliver', { orderId: original.id, orderRevision: 2 }).at(-1)?.status).toBe('rejected');
    expect(world()).toEqual(before);
    host.intervene!(proposal('operator:test', 'operator.amend_order', { ...amended, quantity: 4 }));
    while (host.time().value !== 5) advance();
    expect(act('cleo', 'deliver', { orderId: original.id, orderRevision: 3 }).at(-1)?.status).toBe('succeeded');
    expect(world().people['simkin:cleo'].inventory).toMatchObject({ premium: 0, cash: 70 });
    expect(world().customerRevenue).toBe(40);
    expect(act('cleo', 'deliver', { orderId: original.id, orderRevision: 3 }).at(-1)?.status).toBe('rejected'); check(world());
  });
  it('reserves job inputs atomically, pays only on completion, and preserves exact restoration', async () => {
    const { host, world, act, advance, launch } = await setup(); advance();
    const before = world();
    expect(act('cleo', 'offer', offer('job', { give: { materials: 6 }, quantity: 4, minUses: 4 })).at(-1)?.status).toBe('rejected');
    expect(world()).toEqual(before);
    const posted = act('cleo', 'offer', offer('job', { give: { cash: 10 }, quantity: 4, minUses: 4 }));
    expect(world().people['simkin:cleo'].inventory).toMatchObject({ cash: 20, materials: 2 });
    expect(act('dev', 'accept', { offerId: posted[0].actionId }).at(-1)?.status).toBe('rejected');
    expect(act('bram', 'accept', { offerId: posted[0].actionId }).at(-1)?.status).toBe('running');
    expect(world().people['simkin:bram'].inventory.cash).toBe(10);
    expect(act('bram', 'source', { quantity: 1 }).at(-1)?.status).toBe('rejected');
    expect(advance().at(-1)?.status).toBe('succeeded');
    expect(world().people['simkin:cleo'].inventory.premium).toBe(4);
    expect(world().people['simkin:bram'].inventory.cash).toBe(20);
    expect(world().people['simkin:cleo'].inventory.tools).toContain(3);
    const restored = fabricationHost.restore!(launch, host.checkpoint!());
    expect(restored.inspect()).toEqual(host.inspect()); check(world());
  });
  it('rents qualifying equipment, returns actual wear, and refunds cancelled work inputs', async () => {
    const { host, world, act, advance } = await setup(); advance();
    const posted = act('cleo', 'offer', offer('rental', { to: 'simkin:bram', give: { tools: 1 }, want: { cash: 2 }, minUses: 4, rentalTurns: 2 }));
    act('bram', 'accept', { offerId: posted[0].actionId });
    const work = act('bram', 'make', { quantity: 4, equipment: posted[0].actionId });
    expect(work.at(-1)?.status).toBe('running');
    expect(act('bram', 'return_tool', { loanId: posted[0].actionId }).at(-1)?.status).toBe('rejected');
    advance(); expect(world().people['simkin:bram'].inventory.premium).toBe(4);
    advance(); expect(world().loans).toHaveLength(0);
    expect(world().people['simkin:cleo'].inventory.tools).toEqual([4, 2, 3]);
    while (host.time().value !== 5) advance();
    const inputs = world().people['simkin:cleo'].inventory;
    const cancelled = act('cleo', 'repair');
    expect(host.cancel!(cancelled[0].actionId).map(e => e.status)).toContain('cancelled');
    const returned = world().people['simkin:cleo'].inventory;
    expect({ ...returned, tools: [...returned.tools].sort() }).toEqual({ ...inputs, tools: [...inputs.tools].sort() }); check(world());
  });
  it('accounts for external revenue, supplier costs and rent; arrears suspend only new production', async () => {
    const { host, world, act, advance } = await setup(w => { w.rentEvery = 4; w.till = 0; }); advance();
    act('dev', 'source', { quantity: 3 }); expect(world().supplierCosts).toBe(3);
    act('cleo', 'make', { quantity: 2, equipment: 'owned' }); advance();
    expect(world().people['simkin:cleo'].inventory.premium).toBe(2);
    while (host.time().value !== 5) advance();
    expect(world().arrears).toBe(12);
    expect(act('cleo', 'make', { quantity: 1, equipment: 'owned' }).at(-1)?.status).toBe('rejected');
    act('ada', 'fund_rent', { amount: 15 }); expect(world()).toMatchObject({ arrears: 0, till: 3, paidRent: 12 });
    expect(act('cleo', 'make', { quantity: 1, equipment: 'owned' }).at(-1)?.status).toBe('running');
    expect(cashTotal(world()) + world().supplierCosts + world().paidRent).toBe(world().initialCash); check(world());
  });
});

describe('fabrication operator experience', () => {
  it('runs a scripted trial, injects an order, saves, restores, and replays character receipts without future leakage', async () => {
    const output = await mkdtemp(join(tmpdir(), 'simkind-shop-'));
    const session = new PlaygroundSession(root, output, {}, fabricationFixture);
    try {
      const draft = await session.template('fabrication-shop.json'); session.start(draft);
      await session.step(); const first = session.state();
      expect(first.mode === 'live' && first.shop?.orders).toHaveLength(3);
      for (const event of first.events!.filter(e => e.type === 'request')) {
        const context = (event.data as JsonObject).context as JsonObject;
        if (context.instanceId === 'simkin:dev') expect(JSON.stringify(context)).toContain('Vector Robotics');
        else expect(JSON.stringify(context)).not.toContain('Vector Robotics');
      }
      await session.step(); await session.step();
      const third = session.state(); if (third.mode !== 'live' || !third.shop || !('interventions' in third) || !third.interventions) throw new Error('Expected live shop.');
      const recap = shopRecap(third.events!, third.shop);
      expect(recap.filter(n => n.actor === 'simkin:bram').map(n => n.text).join(' ')).toContain('Received $10');
      expect(recap.filter(n => n.actor === 'simkin:cleo').map(n => n.text).join(' ')).toContain('received $18');
      const edit = { operationId: 'operator.add_order', operationVersion: '1.0.0', expectedRevision: third.interventions.revision, arguments: order() };
      expect(session.previewWorld(edit).valid).toBe(true); session.interveneWorld(edit);
      for (let i = 3; i < 121; i++) await session.step();
      const final = session.state(); if (final.mode !== 'live' || !final.shop || !('savedRecording' in final)) throw new Error('Expected live shop.');
      expect(final.shop).toMatchObject({ completed: true, customerRevenue: 18, arrears: 52 });
      expect(final.shop.orders).toHaveLength(4);
      expect(final.events!.filter(e => ['model-error', 'model-timeout'].includes(e.type))).toEqual([]);
      expect(final.events!.filter(e => e.type === 'action' && (e.data as JsonObject).status === 'rejected')).toEqual([]);
      const name = final.savedRecording!; expect(name).toBeTruthy();
      const archive = await openArchivedRun(join(output, name));
      expect(archive.checkpoint).toBeDefined();
      const events = Array.from({ length: Math.ceil(archive.eventCount / 256) }, (_, i) => archive.events(i * 256, 256)).flat(); const frames = shopFrames(events.map(observerEvent));
      expect(frames.at(-1)?.report.tick).toBe(121);
      const firstFrame = frames.find(f => f.report.tick === 1)!;
      expect(recordedShopReports(events.filter(e => e.sequence <= firstFrame.sequence)).at(-1)?.orders).toHaveLength(3);
      const cursor = new TurnCursor(); cursor.seek(frames, 0); expect(cursor.next(frames, false)).toBe('recorded');
      const checkpoint = archive.checkpoint!;
      const restored = fabricationHost.restore!(checkpoint.launch, checkpoint.hostState, { storage: archive.storage });
      expect(shopReport(restored.inspect())).toEqual(final.shop);
      archive.close();
      await session.open(name); expect(session.state()).toMatchObject({ mode: 'playback', shop: { completed: true, customerRevenue: 18 } });
    } finally { session.dispose(); await rm(output, { recursive: true, force: true }); }
  }, 20000);
});
