import type { JsonObject, ToolCatalog } from 'simkind/format';
const object = (properties: Record<string, JsonObject>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
export const bundleSchema: JsonObject = { type: 'object', additionalProperties: false, properties: Object.fromEntries(['coins', 'food', 'timber', 'tools'].map(g => [g, { type: 'integer', minimum: 0, maximum: 1000000 }])) };
const task = { type: 'string', enum: ['food', 'timber', 'tools'] };
const tool = (id: string, description: string, inputSchema: JsonObject, asynchronous = false) => ({ id, version: '1.0.0', description, inputSchema, lifecycle: { asynchronous, cancellable: asynchronous } });
export const economyCatalog: ToolCatalog = { specVersion: '0.2.0-draft.2', kind: 'tool-catalog', id: 'catalog:economy', host: { contractId: 'example.economy', version: '1.1.0' }, tools: [
  tool('produce', 'Spend your one work shift today. Output arrives next round. Food/timber need no materials; tools consume 2 timber. A borrowed/owned tool adds 2 food or timber, loses one of its 4 uses, and cannot boost tool crafting. Hunger halves output, minimum 1.', object({ task, useTool: { type: 'boolean' } }), true),
  tool('offer', 'Post a binding public offer, optionally restricted to one recipient. Trade: reserve give, request want, task=null/useTool=false. Job: reserve give as wage plus employer materials (2 timber for tools, one tool if useTool); want={}, task names production for employer. Worker accepts and completes next round, earning the wage. Maximum 3 open offers per owner; expiresAt is an absolute round, at most 3 days ahead.', object({ kind: { enum: ['trade', 'job'] }, to: { type: ['string', 'null'] }, give: bundleSchema, want: bundleSchema, task: { enum: ['food', 'timber', 'tools', null] }, useTool: { type: 'boolean' }, expiresAt: { type: 'integer', minimum: 1 } })),
  tool('accept', 'Accept a still-open offer by its exact ID. Trades exchange escrow atomically. Jobs consume your work shift and pay only on next-round completion; employer receives production and its worn tool. Admission rechecks funds, recipient, and deadline.', object({ offerId: { type: 'string' } }), true),
  tool('cancel', 'Withdraw one of your open offers and reclaim its escrow. Accepted jobs cannot be withdrawn through this tool.', object({ offerId: { type: 'string' } })),
  tool('say', 'Speak publicly (to=null) or privately to another participant. Speech alone never transfers goods or creates a binding job. You may negotiate prices, barter, explain, decline, or make nonbinding promises.', object({ text: { type: 'string', minLength: 1, maxLength: 1500 }, to: { type: ['string', 'null'] } })),
] };

// Quality belongs to this host's contract, not to the generic character runner.
const offer = economyCatalog.tools.find(tool => tool.id === 'offer')!;
offer.version = '1.1.0';
offer.description += ' Optional giveToolMinUses/wantToolMinUses (1–4) constrain remaining uses of each transferred tool; use 4 when promising or requesting a fresh tool. Omission accepts any usable tool.';
Object.assign((offer.inputSchema as { properties: JsonObject }).properties, {
  giveToolMinUses: { type: 'integer', minimum: 1, maximum: 4 },
  wantToolMinUses: { type: 'integer', minimum: 1, maximum: 4 },
});
