import type { JsonObject } from 'simkind/format';
import type { ModelConnection } from 'simkind/runner';
/** Scripted integration sample. This is not an emergent-behavior policy. */
export const fabricationFixture: ModelConnection = {
  public: { provider: 'fixture', model: 'fabrication-contract-check-v1', settings: {} }, capabilities: { text: true, json: true },
  fulfill: async context => {
    if (context.purpose === 'consolidation') return { output: { toolId: 'simkind.compact', arguments: { summary: 'Scripted contract check; original receipts remain searchable.', episodes: [] } } };
    const view = context.observations.flatMap(o => o.content).find(c => c.type === 'data' && c.schemaId === 'example.fabrication');
    const data = view?.type === 'data' ? view.data as JsonObject : {};
    const turn = Number(data.turn), actor = context.instanceId;
    const orders = data.orders as JsonObject[] ?? [], offers = data.offers as JsonObject[] ?? [], loans = data.loans as JsonObject[] ?? [];
    const output = (toolId: string | null, args: JsonObject = {}) => ({ output: { toolId, arguments: args } });
    if (turn === 1 && actor === 'simkin:cleo') return output('offer', { kind: 'job', to: 'simkin:bram', give: { cash: 10 }, want: {}, expiresAt: 5, minUses: 4, quantity: 4, rentalTurns: 0 });
    if (turn === 1 && actor === 'simkin:dev') return output('claim_order', { orderId: 'order:prototype', orderRevision: 1 });
    if (turn === 1 && actor === 'simkin:ada') return output('say', { to: null, text: 'Who is taking which order, and what will it cost to get them out the door?' });
    if (turn === 2 && actor === 'simkin:bram') return output('accept', { offerId: offers.find(o => o.kind === 'job')!.id });
    if (turn === 2 && actor === 'simkin:cleo') return output('claim_order', { orderId: 'order:pop-up', orderRevision: 1 });
    if (turn === 3 && actor === 'simkin:cleo') return output('deliver', { orderId: 'order:pop-up', orderRevision: orders.find(o => o.id === 'order:pop-up')!.revision });
    if (turn === 4 && actor === 'simkin:cleo') return output('offer', { kind: 'rental', to: 'simkin:dev', give: { tools: 1 }, want: { cash: 2 }, expiresAt: 8, minUses: 4, quantity: 0, rentalTurns: 4 });
    if (turn === 5 && actor === 'simkin:dev') return output('accept', { offerId: offers.find(o => o.kind === 'rental')!.id });
    if (turn === 6 && actor === 'simkin:dev') return output('make', { quantity: 1, equipment: loans.find(l => l.borrower === actor)!.id });
    return output(null);
  },
};
