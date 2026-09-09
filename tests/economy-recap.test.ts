import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaygroundSession } from '../playground/session.js';
import { economyRecap } from '../playground/economy-recap.js';
import { economyFixtureConnection } from '../examples/economy/fixture.js';
import { recordedEconomyReports } from '../examples/economy/report.js';
import type { ModelConnection } from '../src/runner/index.js';
import type { JsonObject } from '../src/format/index.js';
import { economyFrames, TurnCursor } from '../playground/turn-timeline.js';
const root = new URL('../examples/portable/scenarios', import.meta.url).pathname;
const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup(connection: ModelConnection) {
  const path = await mkdtemp(join(tmpdir(), 'simkind-recap-')); paths.push(path);
  const session = new PlaygroundSession(root, path, {}, connection);
  session.start(await session.template('small-economy.json')); return session;
}
const partial: ModelConnection = { public: { provider: 'fixture', model: 'partial', settings: {} }, capabilities: { text: true, json: true },
  fulfill: async context => {
    if (context.instanceId !== 'simkin:dev') throw new Error('Local test failure');
    return { output: { toolId: 'produce', arguments: { task: 'food', useTool: false } } };
  } };
describe('economy round explanations', () => {
  it('groups speech and counterparty trades under each character in recorded order', async () => {
    const session = await setup({ ...partial, fulfill: async context => {
      const observation = context.observations[0].content[0];
      if (observation.type !== 'data') throw new Error('fixture');
      const world = observation.data as { round: number; offers: { id: string }[] };
      if (context.instanceId === 'simkin:ada') return { output: world.round === 1
        ? { toolId: 'offer', arguments: { kind: 'trade', to: 'simkin:bram', give: { food: 1 }, want: { coins: 1 }, task: null, useTool: false, expiresAt: 4 } }
        : { toolId: 'say', arguments: { to: 'simkin:bram', text: 'One coin for the food. Agreed?' } } };
      if (context.instanceId === 'simkin:bram' && world.round === 2) return { output: { toolId: 'accept', arguments: { offerId: world.offers[0].id } } };
      return { output: { toolId: null, arguments: {} } };
    } });
    await session.step(); const first = session.state();
    await session.step(); const second = session.state();
    const recap = economyRecap(second.events!, second.economy!, { previous: first.economy! });
    const ada = recap.people[0]; const bram = recap.people[1];
    expect(ada.notes.map(n => n.text)).toEqual(['Said to Bram privately:', 'Traded 1 food to Bram for 1 coin.']);
    expect(ada.notes[0].quote).toBe('One coin for the food. Agreed?');
    expect(ada.notes[0].sequence).toBeLessThan(ada.notes[1].sequence!);
    expect(bram.notes.map(n => n.text)).toEqual(['Traded 1 coin to Ada for 1 food.']);
    expect(ada.changes).toBe('+1 coins'); // Food was already reserved in turn 1.
    expect(bram.changes).toBe('−1 coins, +1 food');
  });
  it('uses one frame per turn and never generates while browsing recorded history', async () => {
    const session = await setup(economyFixtureConnection); await session.step(); const first = session.state();
    await session.step(); const second = session.state();
    const frames = economyFrames(second.events!, second.economy!);
    expect(frames.map(f => f.report.tick)).toEqual([1, 2]);
    const cursor = new TurnCursor();
    expect(cursor.next(frames, true)).toBe('generate');
    cursor.seek(frames, 0); expect(cursor.next(frames, true)).toBe('recorded');
    cursor.seek(frames, 1); expect(cursor.next(frames, true)).toBe('end');
    expect(cursor.following).toBe(false);
    cursor.follow(); expect(cursor.next(frames, false)).toBe('end');
    const frozen = economyRecap(second.events!, frames[0].report, { throughSequence: frames[0].sequence });
    expect(frozen).toEqual(economyRecap(first.events!, first.economy!));
    expect(economyFrames(second.events!, { ...second.economy!, revision: 999 }).at(-1)?.report.revision).toBe(999);
  });
  it('distinguishes provider failures from decisions to idle and pending production from inventory gains', async () => {
    const session = await setup(partial); await session.step();
    const state = session.state(); const recap = economyRecap(state.events!, state.economy!);
    expect(recap).toMatchObject({ failures: 3, working: 1 });
    expect(recap.people[0].notes[0]).toMatchObject({ tone: 'error', text: expect.stringContaining('No decision was returned') });
    const dev = recap.people.find(p => p.actor === 'simkin:dev')!;
    expect(dev.pending).toBe('2 food due next turn.');
    expect(dev.changes).toBe('No inventory change');
    expect(recap.people.flatMap(p => p.notes).every(n => !n.text.includes('Chose to take no action'))).toBe(true);
    expect(dev.notes.find(n => n.sequence !== undefined)?.sequence).toBe(state.events!.filter(e => e.type === 'action').at(-1)?.sequence);
  });
  it('shows next-round completion once and keeps earlier playback free of future outcomes', async () => {
    const session = await setup(partial); await session.step(); const first = session.state();
    session.pause(); await session.step(); const second = session.state();
    expect('status' in second && second.status.requests).toBe(4);
    const completed = economyRecap(second.events!, second.economy!, { previous: first.economy! });
    expect(completed).toMatchObject({ failures: 0, working: 0 });
    const dev = completed.people.find(p => p.actor === 'simkin:dev')!;
    expect(dev.changes).toBe('+2 food');
    expect(dev.notes.map(n => n.text)).toEqual(['Produced 2 food.']);
    expect(economyRecap(second.events!, first.economy!, { throughSequence: first.events!.at(-1)!.sequence })).toEqual(economyRecap(first.events!, first.economy!));
  });
  it('explains escrow, job terms, wages, and genuine idle decisions from a deterministic market', async () => {
    const session = await setup(economyFixtureConnection); await session.step(); const first = session.state();
    const offer = economyRecap(first.events!, first.economy!);
    expect(offer.people[0].changes).toBe('−1 coins');
    expect(offer.people[0].notes[0].text).toContain('Offered Dev 1 coin for a food shift');
    expect(offer.people[1].notes[0].text).toBe('Chose to take no action.');
    await session.step(); const second = session.state();
    const working = economyRecap(second.events!, second.economy!, { previous: first.economy! });
    expect(working.people[3].notes.map(n => n.text).join(' ')).toContain('Accepted Ada’s food job for 1 coin');
    session.pause(); await session.step(); const third = session.state();
    const paid = economyRecap(third.events!, third.economy!, { previous: second.economy! });
    expect(paid.summary).toContain('1 job paid');
    expect(paid.people[3].changes).toBe('+1 coins');
    expect(paid.people[0].notes.map(n => n.text)).toEqual(['Produced 4 food.', 'Paid Dev 1 coin and received 2 food.']);
  });
  it('respects sequence boundaries within a round and ignores malformed free-form inventory content', async () => {
    const session = await setup(partial); await session.step(); const state = session.state();
    const events = structuredClone(state.events!);
    for (const e of events.filter(e => e.type === 'observation' && (e.data as JsonObject).recipient !== 'operator:market')) {
      (e.data as JsonObject).content = [{ type: 'data', data: { you: { inventory: { coins: 1 } } } }];
    }
    expect(() => economyRecap(events, state.economy!)).not.toThrow();
    const firstFailure = events.find(e => e.type === 'model-error')!;
    const early = economyRecap(events, { ...state.economy!, people: {} }, { throughSequence: firstFailure.sequence });
    expect(early.failures).toBe(1);
    const reports = events.filter(e => e.type === 'observation' && (e.data as JsonObject).recipient === 'operator:market');
    expect(recordedEconomyReports(reports).length).toBeGreaterThan(0);
    for (const event of reports) for (const content of (event.data as JsonObject).content as JsonObject[]) {
      if (content.type === 'data') (content.data as JsonObject).transactions = [{
        from: 'simkin:ada', to: 'simkin:bram', kind: 'trade', tick: 1,
        give: { tools: 1 }, want: { coins: 1 }, transferred: {},
      }];
    }
    expect(recordedEconomyReports(reports)).toEqual([]);
  });
  it('explains day-end meals and offer expiry instead of leaving resource changes unexplained', async () => {
    const session = await setup({ ...partial, fulfill: async context => ({ output: context.instanceId === 'simkin:ada'
      ? { toolId: 'offer', arguments: { kind: 'trade', to: null, give: { food: 2 }, want: { coins: 1 }, task: null, useTool: false, expiresAt: 5 } }
      : { toolId: null, arguments: {} } }) });
    await session.step(); session.pause(); await session.step(); await session.step(); await session.step();
    const before = session.state(); await session.step(); const after = session.state();
    const recap = economyRecap(after.events!, after.economy!, { previous: before.economy! });
    expect(recap.people[0].notes.map(n => n.text)).toEqual(['An open offer expired; its reserved resources were returned.', 'Ate 1 food at day end.']);
    expect(recap.people[0].changes).toBe('+1 food');
    expect(recap.people[1].changes).toBe('−1 food');
  });
});
