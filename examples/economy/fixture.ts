import type { ModelConnection } from 'simkind/runner';
import type { Offer, Person } from './model.js';
/** Deterministic plumbing exercise only. Never selected by the live playground. */
export const economyFixtureConnection: ModelConnection = {
  public: { provider: 'fixture', model: 'economy-contracts-v1', settings: {} }, capabilities: { text: true, json: true },
  async fulfill(context) {
    const content = context.observations[0].content[0]; if (content.type !== 'data') throw new Error('fixture');
    const data = content.data as unknown as { round: number; finalRound: number; you: Person & { shiftAvailable: boolean }; offers: Offer[] };
    const actor = context.instanceId; const phase = (data.round - 1) % 4 + 1;
    const accept = (owner: string, kind: string) => data.offers.find(o => o.owner === 'simkin:' + owner && o.kind === kind && o.status === 'open' && o.to === actor);
    const offering = (kind: string, to: string, give: object, want: object, task: string | null = null) => ({ toolId: 'offer', arguments: { kind, to: 'simkin:' + to, give, want, task, useTool: false, expiresAt: Math.min(data.round + 6, data.finalRound + 1) } });
    let output: unknown = { toolId: null, arguments: {} };
    if (actor === 'simkin:ada') {
      if (phase === 1) output = offering('job', 'dev', { coins: 1 }, {}, 'food');
      if (phase === 2 && data.you.shiftAvailable) output = { toolId: 'produce', arguments: { task: 'food', useTool: false } };
      const request = accept('dev', 'trade');
      if (phase === 3 && request) output = { toolId: 'accept', arguments: { offerId: request.id } };
      if (phase === 4) output = offering('trade', 'bram', { food: 2 }, { timber: 2 });
    }
    if (actor === 'simkin:bram') {
      const food = accept('ada', 'trade');
      if (phase === 1 && food && data.you.inventory.timber >= 2) output = { toolId: 'accept', arguments: { offerId: food.id } };
      if (phase === 2 && data.you.shiftAvailable) output = { toolId: 'produce', arguments: { task: 'timber', useTool: false } };
      if (phase === 3 && data.you.inventory.timber >= 2) output = offering('trade', 'cleo', { timber: 2 }, { coins: 1 });
    }
    if (actor === 'simkin:cleo') {
      const timber = accept('bram', 'trade');
      if (phase === 1 && timber && data.you.inventory.coins >= 1) output = { toolId: 'accept', arguments: { offerId: timber.id } };
      if (phase === 2 && data.you.shiftAvailable) output = { toolId: 'produce', arguments: { task: data.you.inventory.food < 2 ? 'food' : data.you.inventory.timber >= 2 ? 'tools' : 'timber', useTool: false } };
      if (phase === 4) output = { toolId: 'say', arguments: { text: 'I can make tools; let us discuss terms.', to: null } };
    }
    if (actor === 'simkin:dev') {
      const employment = accept('ada', 'job');
      if (phase === 2 && employment && data.you.shiftAvailable) output = { toolId: 'accept', arguments: { offerId: employment.id } };
      if (phase === 4 && data.you.inventory.coins >= 1) output = offering('trade', 'ada', { coins: 1 }, { food: 1 });
    }
    return { output };
  },
};
