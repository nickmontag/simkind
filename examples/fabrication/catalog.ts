import type { JsonObject, ToolCatalog } from 'simkind/format';
export const object = (properties: Record<string, JsonObject>): JsonObject => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
export const integer = (minimum = 0, maximum = 1000000): JsonObject => ({ type: 'integer', minimum, maximum });
const text = (maxLength = 100): JsonObject => ({ type: 'string', minLength: 1, maxLength });
export const stockSchema = object({ cash: integer(), materials: integer(), standard: integer(), premium: integer(), tools: { type: 'array', maxItems: 100, items: integer(1, 4) } });
export const bundleSchema: JsonObject = { type: 'object', additionalProperties: false, properties: Object.fromEntries(['cash', 'materials', 'standard', 'premium', 'tools'].map(g => [g, integer()])) };
export const orderSchema = object({
  id: { ...text(64), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$', title: 'Order ID' },
  customer: { ...text(), title: 'Customer' }, quantity: { ...integer(1, 100), title: 'Units' },
  quality: { type: 'string', enum: ['standard', 'premium'], title: 'Minimum quality' },
  payment: { ...integer(1, 100000), title: 'Total payment ($)' },
  deadline: { ...integer(1, 100000), title: 'Deadline (turn, inclusive)' },
  recipient: { type: ['string', 'null'], title: 'Private lead recipient', description: 'null makes this public; otherwise use a character ID.' },
  brief: { ...text(1000), title: 'Customer brief', description: 'Flavor and negotiation context. Enforced terms are quantity, quality, payment, and deadline.' },
});
const tool = (id: string, description: string, inputSchema: JsonObject, asynchronous = false) => ({ id, version: '1.0.0', description, inputSchema, lifecycle: { asynchronous, cancellable: asynchronous } });
export const fabricationCatalog: ToolCatalog = { specVersion: '0.2.0-draft.2', kind: 'tool-catalog', id: 'catalog:fabrication', host: { contractId: 'example.fabrication', version: '1.0.0' }, tools: [
  tool('say', 'Speak publicly (to=null) or privately. Speech, promises, ownership stakes, and commission claims are nonbinding; use offers for actual transfers and paid work.', object({ text: text(1500), to: { type: ['string', 'null'] } })),
  tool('claim_order', 'Claim an available customer order at its exact revision. No money or products move. Only the claimant can deliver; no exclusivity is created by speech.', object({ orderId: text(64), orderRevision: integer(1) })),
  tool('deliver', 'Deliver the complete order from your available stock by its inclusive deadline and collect payment. Premium stock can satisfy a standard order. Recheck its current revision after customer amendments.', object({ orderId: text(64), orderRevision: integer(1) })),
  tool('release_order', 'Release your claimed order so another eligible character can take it. No cancellation fee.', object({ orderId: text(64) })),
  tool('publish_lead', 'Make a private customer lead visible and claimable by everyone. This does not assign it or transfer revenue.', object({ orderId: text(64) })),
  tool('make', 'Spend one productive shift per 4-turn day. Consume one material per unit and one equipment use per batch; finish next turn. Quantity cannot exceed your fabrication skill. Equipment with 3–4 uses at admission makes premium; 1–2 makes standard. equipment="owned" selects your best available tool; otherwise supply a current rental ID.', object({ quantity: integer(1, 8), equipment: text(128) }), true),
  tool('repair', 'Spend your productive shift and one material to restore your most worn owned tool by your repair skill, maximum 4 uses. Completes next turn. Cannot repair rented equipment.', object({}), true),
  tool('source', 'Spend your productive shift to buy 1–8 materials from an external supplier at your published sourcing price. Cash leaves the shop economy; delivery is immediate.', object({ quantity: integer(1, 8) })),
  tool('offer', 'Post a binding offer, reserving give. Trade: exchange give for want (quantity=0,rentalTurns=0). Job: give is wage, want={}, quantity=1–8; reserve your materials and one tool with at least minUses for a worker to manufacture for you next turn (rentalTurns=0). Rental: give={tools:1}, want={cash:fee}, quantity=0, rentalTurns=1–12; lend equipment with at least minUses, automatically returned after that many turns, worn by use. minUses constrains tools on both sides of a trade. Maximum 3 open offers; expiresAt is an absolute turn at most 12 turns ahead.', object({ kind: { type: 'string', enum: ['trade', 'job', 'rental'] }, to: { type: ['string', 'null'] }, give: bundleSchema, want: bundleSchema, expiresAt: integer(1), minUses: integer(1, 4), quantity: integer(0, 8), rentalTurns: integer(0, 12) })),
  tool('accept', 'Accept a current offer. Trades and rental fees settle atomically. Jobs use your shift and pay on next-turn completion; employer receives output and worn equipment. Revalidates resources, recipient, deadline, and skill.', object({ offerId: text(128) }), true),
  tool('cancel', 'Cancel your open offer and reclaim reservations. Accepted work and rentals keep their terms.', object({ offerId: text(128) })),
  tool('return_tool', 'Return idle rented equipment early to its owner, with its actual remaining uses. Rental fees are not refunded.', object({ loanId: text(128) })),
  tool('fund_rent', 'Move your available cash into the shared rent fund. Outstanding rent is paid first; production resumes when arrears reach zero. This creates no ownership stake.', object({ amount: integer(1, 100000) })),
] };
